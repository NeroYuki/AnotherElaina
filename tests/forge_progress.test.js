'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchProgressJson } = require('../utils/forge_progress');

function collectLogger() {
    const messages = [];
    return {
        messages,
        log: (...args) => messages.push(args.map(value => String(value)).join(' ')),
    };
}

function textResponse(status, body) {
    return {
        status,
        ok: status >= 200 && status < 300,
        text: async () => body,
    };
}

test('progress polling sends JSON with the supplied routing headers', async () => {
    let seen = null;
    const result = await fetchProgressJson(
        'http://proxy.test/internal/progress',
        { id_task: 'task(abc)', id_live_preview: 4 },
        {
            headers: { 'X-AI-Service': 'sdwebui-forge-neo' },
            fetchImpl: async (url, options) => {
                seen = { url, options };
                return textResponse(200, '{"progress":0.5,"completed":false}');
            },
        },
    );

    assert.deepEqual(result, { progress: 0.5, completed: false });
    assert.equal(seen.url, 'http://proxy.test/internal/progress');
    assert.equal(seen.options.method, 'POST');
    assert.equal(seen.options.headers['Content-Type'], 'application/json');
    assert.equal(seen.options.headers['X-AI-Service'], 'sdwebui-forge-neo');
    assert.deepEqual(JSON.parse(seen.options.body), { id_task: 'task(abc)', id_live_preview: 4 });
});

test('a 504 upstream timeout body is logged and skipped', async () => {
    const logger = collectLogger();
    const result = await fetchProgressJson(
        'http://proxy.test/internal/progress',
        {},
        {
            logger,
            fetchImpl: async () => textResponse(504, "Upstream 'sdwebui-forge-neo' timed out."),
        },
    );

    assert.equal(result, null);
    assert.match(logger.messages.join('\n'), /HTTP 504/);
    assert.match(logger.messages.join('\n'), /Upstream 'sdwebui-forge-neo' timed out/);
});

test('a 502 upstream error body is logged and skipped', async () => {
    const logger = collectLogger();
    const result = await fetchProgressJson(
        'http://proxy.test/internal/progress',
        {},
        {
            logger,
            fetchImpl: async () => textResponse(502, "Upstream 'sdwebui-forge-neo' error: peer closed connection"),
        },
    );

    assert.equal(result, null);
    assert.match(logger.messages.join('\n'), /HTTP 502/);
    assert.match(logger.messages.join('\n'), /peer closed connection/);
});

test('a 200 response with malformed JSON is skipped', async () => {
    const logger = collectLogger();
    const result = await fetchProgressJson(
        'http://proxy.test/internal/progress',
        {},
        { logger, fetchImpl: async () => textResponse(200, 'not json') },
    );

    assert.equal(result, null);
    assert.match(logger.messages.join('\n'), /non-JSON/);
    assert.match(logger.messages.join('\n'), /not json/);
});

test('a transport error is logged and skipped', async () => {
    const logger = collectLogger();
    const result = await fetchProgressJson(
        'http://proxy.test/internal/progress',
        {},
        {
            logger,
            fetchImpl: async () => { throw new Error('socket hang up'); },
        },
    );

    assert.equal(result, null);
    assert.match(logger.messages.join('\n'), /socket hang up/);
});

test('a hung progress poll is aborted instead of blocking the loop', async () => {
    const logger = collectLogger();
    const started = Date.now();
    const result = await fetchProgressJson(
        'http://proxy.test/internal/progress',
        {},
        {
            logger,
            timeoutMs: 20,
            fetchImpl: (url, options) => new Promise((resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                    const error = new Error('aborted');
                    error.name = 'AbortError';
                    reject(error);
                }, { once: true });
            }),
        },
    );

    assert.equal(result, null);
    assert.ok(Date.now() - started < 1000, 'abort fired promptly');
    assert.match(logger.messages.join('\n'), /timed out after 20ms/);
});

test('an empty 200 body is a valid empty snapshot', async () => {
    const result = await fetchProgressJson(
        'http://proxy.test/internal/progress',
        {},
        { fetchImpl: async () => textResponse(200, '') },
    );

    assert.deepEqual(result, {});
});
