'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSSE } = require('../../chat/providers/sse');
const { LocalOpenAIProvider } = require('../../chat/providers/local_openai');

function streamChunks(chunks) {
    return new ReadableStream({
        start(controller) {
            chunks.forEach(chunk => controller.enqueue(chunk));
            controller.close();
        },
    });
}

test('SSE parser handles Unicode byte boundaries, CRLF, multiline data, and final buffers', async () => {
    const bytes = new TextEncoder().encode('data: {"text":"witch 🧙"}\r\n\r\ndata: first\ndata: second\n\ndata: tail');
    const chunks = [bytes.slice(0, 24), bytes.slice(24, 29), bytes.slice(29, 41), bytes.slice(41)];
    const events = [];
    for await (const event of parseSSE(streamChunks(chunks))) events.push(event.data);
    assert.deepEqual(events, ['{"text":"witch 🧙"}', 'first\nsecond', 'tail']);
});

test('local provider sends workload, job and thinking controls and retries Retry-After once', async () => {
    const requests = [];
    let attempt = 0;
    const provider = new LocalOpenAIProvider({
        endpoint: 'http://127.0.0.1:11230', model: 'gemma-local',
        sleepImpl: async ms => assert.equal(ms, 0),
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            attempt++;
            if (attempt === 1) return new Response('busy', { status: 503, headers: { 'Retry-After': '0' } });
            return Response.json({ model: 'gemma-local', choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] });
        },
    });
    const result = await provider.generate({ messages: [{ role: 'user', content: 'Hi' }], thinking: false, jobId: 'turn-7' });
    assert.equal(result.text, 'Hello');
    assert.equal(requests.length, 2);
    const body = JSON.parse(requests[1].options.body);
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(requests[1].options.headers['X-AI-Job-ID'], 'turn-7');
    assert.equal(requests[1].options.headers['X-AI-Service'], 'unsloth');
    assert.ok(requests[1].options.headers['X-AI-Workload']);
});

test('thinking-only length response gets one fresh thinking-disabled retry', async () => {
    const bodies = [];
    const provider = new LocalOpenAIProvider({
        endpoint: 'http://127.0.0.1:11230', model: 'gemma-local', maxRetries: 0,
        fetchImpl: async (url, options) => {
            bodies.push(JSON.parse(options.body));
            if (bodies.length === 1) return Response.json({ choices: [{ message: { content: '', reasoning_content: 'private' }, finish_reason: 'length' }] });
            return Response.json({ choices: [{ message: { content: 'Visible' }, finish_reason: 'stop' }] });
        },
    });
    const result = await provider.generate({ messages: [], thinking: true });
    assert.equal(result.text, 'Visible');
    assert.deepEqual(bodies.map(body => body.chat_template_kwargs.enable_thinking), [true, false]);
    assert.equal(JSON.stringify(result).includes('private'), false);
});

test('provider stream accumulates fragmented tool calls and tolerates usage-only events and EOF', async () => {
    const sse = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"web_","arguments":"{\\"q"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"search","arguments":"uery\\":\\"node\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[]}\n\n',
    ].join('');
    const bytes = new TextEncoder().encode(sse);
    const provider = new LocalOpenAIProvider({
        endpoint: 'http://127.0.0.1:11230', model: 'gemma-local', maxRetries: 0,
        fetchImpl: async () => new Response(streamChunks([bytes.slice(0, 17), bytes.slice(17, 91), bytes.slice(91)]), {
            headers: { 'Content-Type': 'text/event-stream' },
        }),
    });
    const events = [];
    for await (const event of provider.stream({ messages: [] })) events.push(event);
    const finished = events.at(-1);
    assert.equal(finished.type, 'finished');
    assert.equal(finished.doneMarker, false);
    assert.equal(finished.finishReason, 'tool_calls');
    assert.equal(finished.toolCalls[0].function.name, 'web_search');
    assert.deepEqual(JSON.parse(finished.toolCalls[0].function.arguments), { query: 'node' });
    assert.equal(events.some(event => event.type === 'usage'), true);
});

test('empty model stream fails explicitly instead of hanging', async () => {
    const provider = new LocalOpenAIProvider({
        endpoint: 'http://127.0.0.1:11230', model: 'gemma-local', maxRetries: 0,
        fetchImpl: async () => new Response('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'),
    });
    await assert.rejects(async () => {
        for await (const event of provider.stream({ messages: [], thinking: false })) void event;
    }, { code: 'EMPTY_MODEL_RESPONSE' });
});

test('aborted provider request is not retried', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    let calls = 0;
    const provider = new LocalOpenAIProvider({ endpoint: 'http://127.0.0.1', model: 'gemma-local', fetchImpl: async () => { calls++; } });
    await assert.rejects(provider.generate({ messages: [], signal: controller.signal }), { name: 'AbortError' });
    assert.equal(calls, 0);
});
