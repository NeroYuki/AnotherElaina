'use strict';

const { SourceRegistry } = require('./source_registry');

class SearxngError extends Error {
    constructor(message, code, retryable = false) {
        super(message);
        this.name = 'SearxngError';
        this.code = code;
        this.retryable = retryable;
    }
}

function createSearxngClient({ endpoint = process.env.SEARXNG_URL || 'http://127.0.0.1:8088',
    fetchImpl = globalThis.fetch, sourceRegistry = new SourceRegistry(), timeoutMs = 12_000 } = {}) {
    const base = new URL(endpoint);
    if (!['http:', 'https:'].includes(base.protocol)) throw new TypeError('Invalid SearXNG endpoint');
    return {
        sourceRegistry,
        async search({ query, language, timeRange, limit = 5, signal }) {
            const url = new URL('/search', base);
            url.searchParams.set('q', query);
            url.searchParams.set('format', 'json');
            url.searchParams.set('categories', 'general');
            url.searchParams.set('safesearch', '1');
            if (language) url.searchParams.set('language', language);
            if (timeRange) url.searchParams.set('time_range', timeRange);
            const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
            let response;
            try {
                response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: requestSignal });
            } catch (error) {
                if (signal?.aborted) throw error;
                throw new SearxngError('SearXNG request failed', error?.name === 'TimeoutError' ? 'SEARCH_TIMEOUT' : 'SEARCH_UNAVAILABLE', true);
            }
            if (!response.ok) throw new SearxngError(`SearXNG returned HTTP ${response.status}`, 'SEARCH_HTTP_ERROR', response.status >= 500 || response.status === 429);
            let payload;
            try { payload = await response.json(); } catch { throw new SearxngError('SearXNG returned invalid JSON', 'SEARCH_INVALID_RESPONSE'); }
            const results = [];
            for (const item of payload.results || []) {
                if (results.length >= Math.min(5, limit)) break;
                try {
                    const parsed = new URL(item.url);
                    if (!['http:', 'https:'].includes(parsed.protocol)) continue;
                    const source = sourceRegistry.add({
                        url: parsed.toString(), title: item.title || parsed.hostname,
                        snippet: item.content || '', retrievedAt: new Date().toISOString(),
                    });
                    results.push(source);
                } catch {
                    continue;
                }
            }
            return { query, results, retrievedAt: new Date().toISOString() };
        },
    };
}

module.exports = { createSearxngClient, SearxngError };
