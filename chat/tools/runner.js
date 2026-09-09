'use strict';

const crypto = require('node:crypto');

function resultError(code, retryable = false, message) {
    return { ok: false, data: null, sources: [], error: { code, retryable, ...(message ? { message } : {}) } };
}

function composeSignal(signal, timeoutMs) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function runWithSignal(operation, signal) {
    if (signal.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    let onAbort;
    const aborted = new Promise((resolve, reject) => {
        onAbort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([Promise.resolve().then(operation), aborted]);
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}

function hashArguments(name, args) {
    return crypto.createHash('sha256').update(name).update('\0').update(JSON.stringify(args)).digest('hex');
}

class ToolRunner {
    constructor({ registry, cache = new Map(), persistResult = null } = {}) {
        if (!registry) throw new TypeError('ToolRunner requires a registry');
        this.registry = registry;
        this.cache = cache;
        this.persistResult = persistResult;
    }

    async _cacheGet(key) {
        return typeof this.cache.get === 'function' ? this.cache.get(key) : null;
    }

    async _cacheSet(key, value) {
        if (typeof this.cache.set === 'function') await this.cache.set(key, value);
    }

    async run({ call, trustedContext = {}, signal }) {
        const name = call?.function?.name || call?.name;
        const callId = String(call?.id || '');
        const tool = this.registry.get(name);
        if (!tool) return resultError('UNKNOWN_TOOL', false);
        if (!callId || !trustedContext.turnId) return resultError('MISSING_CALL_ID', false);
        if (tool.authorization(trustedContext) === false) return resultError('TOOL_FORBIDDEN', false);

        let args;
        try {
            const raw = call?.function?.arguments ?? call?.arguments ?? '{}';
            args = typeof raw === 'string' ? JSON.parse(raw) : raw;
            this.registry.validateInput(tool, args);
        } catch (error) {
            return resultError('INVALID_ARGUMENTS', false, error.message);
        }

        const key = `${trustedContext.turnId}:${callId}`;
        const previous = await this._cacheGet(key);
        if (previous) return previous;
        const argumentHash = hashArguments(name, args);
        const startedAt = new Date().toISOString();
        let result;
        try {
            const toolSignal = composeSignal(signal, tool.timeoutMs);
            const output = await runWithSignal(() => tool.execute({
                args, trustedContext, signal: toolSignal, callId,
            }), toolSignal);
            const data = output?.data ?? output;
            const sources = Array.isArray(output?.sources) ? output.sources : [];
            this.registry.validateOutput(tool, data);
            if (Buffer.byteLength(JSON.stringify({ data, sources }), 'utf8') > tool.maxResultBytes) {
                result = resultError('RESULT_TOO_LARGE', false);
            } else {
                result = { ok: true, data, sources, error: null };
            }
        } catch (error) {
            const timedOut = error?.name === 'TimeoutError';
            const aborted = signal?.aborted;
            result = resultError(aborted ? 'CANCELLED' : timedOut ? 'TOOL_TIMEOUT' : (error.code || 'TOOL_FAILED'),
                Boolean(error.retryable), aborted || timedOut ? undefined : error.message);
        }
        await this._cacheSet(key, result);
        if (this.persistResult) {
            await this.persistResult({
                turnId: trustedContext.turnId, callId, tool: name, version: tool.version,
                argumentHash, startedAt, completedAt: new Date().toISOString(), result,
            });
        }
        return result;
    }
}

module.exports = { ToolRunner, resultError, hashArguments, runWithSignal };
