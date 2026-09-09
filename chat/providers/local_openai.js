'use strict';

const { PROXY_URL } = require('../../utils/proxy_config');
const { lmstudioWorkload, workloadHeaders } = require('../../utils/orchestrator_workload');
const { parseSSE } = require('./sse');
const {
    ProviderError,
    ProviderHttpError,
    ProviderStreamError,
    EmptyModelResponseError,
    isAbortError,
} = require('./errors');

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function retryAfterMs(value, now = Date.now()) {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function sleep(ms, signal) {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

function normalizeTools(tools) {
    return tools?.map(tool => tool.type === 'function' ? tool : {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema || tool.parameters,
        },
    });
}

function responseFormat(responseSchema) {
    if (!responseSchema) return undefined;
    if (responseSchema.type === 'json_schema' || responseSchema.type === 'json_object') {
        return responseSchema;
    }
    return {
        type: 'json_schema',
        json_schema: {
            name: responseSchema.name || 'response',
            strict: true,
            schema: responseSchema.schema || responseSchema,
        },
    };
}

function normalizeToolCall(call, index = 0) {
    return {
        id: String(call?.id || `call-${index}`),
        type: 'function',
        function: {
            name: String(call?.function?.name || call?.name || ''),
            arguments: typeof call?.function?.arguments === 'string'
                ? call.function.arguments
                : JSON.stringify(call?.function?.arguments ?? call?.arguments ?? {}),
        },
    };
}

function parseCompletion(json, fallbackModel) {
    const choice = json?.choices?.[0] || json?.response?.choices?.[0];
    const message = choice?.message || json?.message || {};
    const text = typeof message.content === 'string'
        ? message.content
        : typeof json?.content === 'string' ? json.content : '';
    const toolCalls = (message.tool_calls || json?.tool_calls || []).map(normalizeToolCall);
    return {
        text,
        toolCalls,
        finishReason: choice?.finish_reason || json?.finish_reason || null,
        usage: json?.usage || null,
        model: json?.model || fallbackModel,
        providerMeta: { id: json?.id || null, created: json?.created || null },
    };
}

class LocalOpenAIProvider {
    constructor({ endpoint = PROXY_URL, model = 'unsloth/gemma-4-12B-it-qat-GGUF',
        contextTokens = 8192, fetchImpl = globalThis.fetch, maxRetries = 1,
        maxRetryDelayMs = 10_000, sleepImpl = sleep, service = 'unsloth' } = {}) {
        if (typeof fetchImpl !== 'function') throw new TypeError('Native fetch is required');
        const parsed = new URL(endpoint);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('Invalid inference endpoint');
        if (/gemini/i.test(model)) throw new TypeError('Cloud inference models are forbidden');
        this.endpoint = parsed.toString().replace(/\/$/, '');
        this.model = model;
        this.contextTokens = contextTokens;
        this.fetch = fetchImpl;
        this.maxRetries = Math.max(0, Math.min(1, maxRetries));
        this.maxRetryDelayMs = maxRetryDelayMs;
        this.sleep = sleepImpl;
        this.service = service;
    }

    _body(request, stream) {
        const body = {
            model: request.model || this.model,
            messages: request.messages || [],
            stream,
            max_tokens: request.maxOutputTokens || 512,
            chat_template_kwargs: { enable_thinking: request.thinking === true },
        };
        if (request.temperature !== undefined) body.temperature = request.temperature;
        if (request.stop) body.stop = request.stop;
        if (request.tools?.length) {
            body.tools = normalizeTools(request.tools);
            body.tool_choice = request.toolChoice || 'auto';
        }
        const format = responseFormat(request.responseSchema);
        if (format) body.response_format = format;
        if (stream) body.stream_options = { include_usage: true };
        return body;
    }

    _headers(request, stream, body) {
        const workload = lmstudioWorkload({
            model: body.model,
            contextLength: request.contextTokens || this.contextTokens,
            maxTokens: body.max_tokens,
            vision: request.vision === true,
            stream,
        });
        const headers = workloadHeaders(this.service, workload, {
            'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json',
        });
        if (request.jobId) headers['X-AI-Job-ID'] = String(request.jobId);
        return headers;
    }

    async _request(request, stream) {
        const body = this._body(request, stream);
        let lastError;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            if (request.signal?.aborted) throw request.signal.reason || new DOMException('Aborted', 'AbortError');
            try {
                const response = await this.fetch(`${this.endpoint}/v1/chat/completions`, {
                    method: 'POST',
                    headers: this._headers(request, stream, body),
                    body: JSON.stringify(body),
                    signal: request.signal,
                });
                if (response.ok) return response;
                const text = (await response.text()).slice(0, 4096);
                const wait = retryAfterMs(response.headers.get('retry-after'));
                const error = new ProviderHttpError(`Local inference failed with HTTP ${response.status}`, {
                    code: 'INFERENCE_HTTP_ERROR', status: response.status,
                    retryable: RETRYABLE_STATUS.has(response.status), retryAfterMs: wait,
                    cause: text ? new Error(text) : null,
                });
                if (!error.retryable || attempt === this.maxRetries) throw error;
                lastError = error;
                await this.sleep(Math.min(wait ?? 250 * (attempt + 1), this.maxRetryDelayMs), request.signal);
            } catch (error) {
                if (isAbortError(error) || request.signal?.aborted) throw error;
                if (error instanceof ProviderHttpError) {
                    if (!error.retryable || attempt === this.maxRetries) throw error;
                    lastError = error;
                    continue;
                }
                const wrapped = new ProviderError('Local inference transport failed', {
                    code: 'INFERENCE_TRANSPORT_ERROR', retryable: true, cause: error,
                });
                if (attempt === this.maxRetries) throw wrapped;
                lastError = wrapped;
                await this.sleep(250 * (attempt + 1), request.signal);
            }
        }
        throw lastError;
    }

    async generate(request) {
        const response = await this._request(request, false);
        let json;
        try {
            json = await response.json();
        } catch (error) {
            if (isAbortError(error) || request.signal?.aborted) throw error;
            throw new ProviderError('Local inference returned invalid JSON', {
                code: 'INVALID_PROVIDER_JSON', cause: error,
            });
        }
        let result = parseCompletion(json, request.model || this.model);
        if (!result.text && result.toolCalls.length === 0) {
            if (request.thinking === true && result.finishReason === 'length' && request.retryWithoutThinking !== false) {
                result = await this.generate({ ...request, thinking: false, retryWithoutThinking: false });
            } else {
                throw new EmptyModelResponseError('Local model returned no visible text or tool calls', {
                    code: 'EMPTY_MODEL_RESPONSE', retryable: result.finishReason === 'length',
                });
            }
        }
        return result;
    }

    async *stream(request) {
        const response = await this._request(request, true);
        const toolCalls = new Map();
        let finishReason = null;
        let usage = null;
        let sawDone = false;
        let sawOutput = false;
        for await (const event of parseSSE(response.body, { signal: request.signal })) {
            if (!event.data) continue;
            if (event.data.trim() === '[DONE]') {
                sawDone = true;
                break;
            }
            let payload;
            try {
                payload = JSON.parse(event.data);
            } catch (error) {
                throw new ProviderStreamError('Malformed JSON in inference stream', {
                    code: 'MALFORMED_STREAM_EVENT', cause: error,
                });
            }
            if (payload.error) {
                throw new ProviderStreamError('Inference stream reported an error', {
                    code: 'REMOTE_STREAM_ERROR', cause: new Error(String(payload.error.message || payload.error)),
                });
            }
            if (payload.usage) {
                usage = payload.usage;
                yield { type: 'usage', usage };
            }
            const choice = payload?.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta || {};
            if (typeof delta.content === 'string' && delta.content) {
                sawOutput = true;
                yield { type: 'textDelta', text: delta.content };
            }
            for (const fragment of delta.tool_calls || []) {
                sawOutput = true;
                const key = fragment.index ?? fragment.id ?? 0;
                const current = toolCalls.get(key) || { id: '', type: 'function', function: { name: '', arguments: '' } };
                if (fragment.id) current.id = fragment.id;
                if (fragment.function?.name) current.function.name += fragment.function.name;
                if (fragment.function?.arguments) current.function.arguments += fragment.function.arguments;
                toolCalls.set(key, current);
                yield { type: 'toolCallDelta', index: key, id: fragment.id || null,
                    name: fragment.function?.name || '', arguments: fragment.function?.arguments || '' };
            }
            if (choice.finish_reason) finishReason = choice.finish_reason;
        }
        if (!sawOutput) {
            if (request.thinking === true && finishReason === 'length' && request.retryWithoutThinking !== false) {
                yield* this.stream({ ...request, thinking: false, retryWithoutThinking: false });
                return;
            }
            throw new EmptyModelResponseError('Local model stream returned no visible text or tool calls', {
                code: 'EMPTY_MODEL_RESPONSE', retryable: finishReason === 'length',
            });
        }
        yield {
            type: 'finished',
            finishReason,
            usage,
            model: request.model || this.model,
            toolCalls: [...toolCalls.entries()].sort(([a], [b]) => Number(a) - Number(b))
                .map(([, call], index) => normalizeToolCall(call, index)),
            doneMarker: sawDone,
        };
    }
}

function createLocalOpenAIProvider(options) {
    return new LocalOpenAIProvider(options);
}

module.exports = {
    LocalOpenAIProvider,
    createLocalOpenAIProvider,
    parseCompletion,
    retryAfterMs,
};
