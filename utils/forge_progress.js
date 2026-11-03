'use strict';

// Progress polling goes through the orchestrator proxy. When the upstream
// Forge instance is busy, restarting, or times out, the proxy answers with a
// text/plain 5xx body such as "Upstream 'sdwebui-forge-neo' timed out."
// Calling response.json() on that body throws and used to escape the
// fire-and-forget progress loop. Progress is cosmetic, so a bad poll must be
// logged and skipped without affecting the generation request.

const DEFAULT_PROGRESS_TIMEOUT_MS = 15000;
const BODY_PREVIEW_LIMIT = 240;

function previewBody(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '<empty response>';
    return text.length > BODY_PREVIEW_LIMIT
        ? `${text.slice(0, BODY_PREVIEW_LIMIT)}...`
        : text;
}

function responseIsOk(response) {
    if (typeof response?.ok === 'boolean') return response.ok;
    const status = Number(response?.status);
    return status >= 200 && status < 300;
}

async function readProgressBody(response, logger = console) {
    const status = Number(response?.status);
    const statusLabel = Number.isFinite(status) && status > 0 ? `HTTP ${status}` : 'HTTP unknown';
    let body;
    try {
        if (typeof response?.text === 'function') {
            body = await response.text();
        }
        else if (typeof response?.json === 'function') {
            // Test doubles and older fetch wrappers may only expose json().
            return await response.json();
        }
        else {
            return null;
        }
    }
    catch (error) {
        logger?.log?.(`Progress poll could not read the response (${statusLabel}): ${error?.message || error}`);
        return null;
    }

    if (!responseIsOk(response)) {
        logger?.log?.(`Progress poll returned ${statusLabel}: ${previewBody(body)}`);
        return null;
    }
    if (!body) return {};
    try {
        return JSON.parse(body);
    }
    catch {
        logger?.log?.(`Progress poll returned non-JSON (${statusLabel}): ${previewBody(body)}`);
        return null;
    }
}

/**
 * Fetch one progress snapshot, returning null for any transient failure.
 * Never throws and never blocks longer than `timeoutMs`.
 */
async function fetchProgressJson(url, payload, options = {}) {
    const {
        fetchImpl = globalThis.fetch,
        headers = {},
        timeoutMs = DEFAULT_PROGRESS_TIMEOUT_MS,
        logger = console,
    } = options;

    if (typeof fetchImpl !== 'function') {
        logger?.log?.('Progress poll skipped: no fetch implementation is available');
        return null;
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    if (controller && timeoutMs > 0) {
        timer = setTimeout(() => controller.abort(), timeoutMs);
        timer.unref?.();
    }

    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
            headers: { 'Content-Type': 'application/json', ...headers },
            ...(controller ? { signal: controller.signal } : {}),
        });
        return await readProgressBody(response, logger);
    }
    catch (error) {
        if (error?.name === 'AbortError') {
            logger?.log?.(`Progress poll timed out after ${timeoutMs}ms`);
        }
        else {
            logger?.log?.(`Progress poll failed: ${error?.message || error}`);
        }
        return null;
    }
    finally {
        if (timer) clearTimeout(timer);
    }
}

module.exports = {
    DEFAULT_PROGRESS_TIMEOUT_MS,
    fetchProgressJson,
};
