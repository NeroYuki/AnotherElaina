'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry, createDefaultToolRegistry } = require('../../chat/tools');
const { ToolRunner } = require('../../chat/tools/runner');
const { runNativeToolLoop, runFallbackToolLoop } = require('../../chat/tools/controller');

test('runner rejects unknown fields and caches random effects by turn and call ID', async () => {
    let value = 0;
    const registry = createDefaultToolRegistry({ randomInt: () => ++value });
    const runner = new ToolRunner({ registry });
    const call = { id: 'dice-1', function: { name: 'roll_dice', arguments: '{"count":2,"sides":6}' } };
    const first = await runner.run({ call, trustedContext: { turnId: 'turn-1' } });
    const second = await runner.run({ call, trustedContext: { turnId: 'turn-1' } });
    assert.deepEqual(first.data.rolls, [1, 2]);
    assert.deepEqual(second, first);
    assert.equal(value, 2);

    const invalid = await runner.run({
        call: { id: 'dice-2', function: { name: 'roll_dice', arguments: '{"count":1,"sides":6,"userId":"victim"}' } },
        trustedContext: { turnId: 'turn-1' },
    });
    assert.equal(invalid.error.code, 'INVALID_ARGUMENTS');
});

test('memory tool receives application trusted scope, not model scope', async () => {
    let received;
    const registry = createDefaultToolRegistry({
        memorySearch: async input => { received = input; return { matches: [], degraded: false }; },
    });
    const runner = new ToolRunner({ registry });
    const trustedContext = { turnId: 't', continuityId: 'continuity-safe', guildId: 'guild-safe' };
    const result = await runner.run({
        call: { id: 'm1', function: { name: 'memory_search', arguments: '{"query":"umbrella"}' } }, trustedContext,
    });
    assert.equal(result.ok, true);
    assert.equal(received.trustedContext, trustedContext);

    const forged = await runner.run({
        call: { id: 'm2', function: { name: 'memory_search', arguments: '{"query":"x","guildId":"other"}' } }, trustedContext,
    });
    assert.equal(forged.error.code, 'INVALID_ARGUMENTS');
});

test('native tool loop executes complete calls and returns supplied sources', async () => {
    const tool = {
        name: 'lookup', description: 'lookup', timeoutMs: 1000,
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
        outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false },
        execute: async () => ({ data: { answer: 'yes' }, sources: [{ id: 's1', url: 'https://example.com', title: 'Example' }] }),
    };
    const registry = new ToolRegistry([tool]);
    const runner = new ToolRunner({ registry });
    let calls = 0;
    const provider = {
        async generate(request) {
            calls++;
            if (calls === 1) return { text: 'speculative', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"query":"x"}' } }] };
            assert.equal(request.messages.at(-1).role, 'tool');
            return { text: 'Final answer', toolCalls: [], finishReason: 'stop' };
        },
    };
    const result = await runNativeToolLoop({ provider, registry, runner, messages: [], trustedContext: { turnId: 't1' } });
    assert.equal(result.text, 'Final answer');
    assert.equal(result.sources[0].id, 's1');
    assert.equal(calls, 2);
});

test('fallback controller repairs one invalid decision, validates it, and executes no prose JSON', async () => {
    const registry = createDefaultToolRegistry({ clock: () => new Date('2026-09-09T12:00:00Z') });
    const runner = new ToolRunner({ registry });
    const replies = [
        { text: '{"action":"execute_anything"}', toolCalls: [] },
        { text: '{"action":"tool","tool":"current_time","arguments":{"timezone":"UTC"}}', toolCalls: [] },
        { text: 'It is noon UTC.', toolCalls: [], finishReason: 'stop' },
    ];
    const provider = { generate: async () => replies.shift() };
    const result = await runFallbackToolLoop({ provider, registry, runner, messages: [], trustedContext: { turnId: 't1' }, maxRounds: 1 });
    assert.equal(result.text, 'It is noon UTC.');
    assert.equal(result.fallback, true);
    assert.match(result.messages.at(-1).content, /untrusted_tool_result/);
});

test('runner converts timeouts and unknown tools into structured errors', async () => {
    const registry = new ToolRegistry([{
        name: 'slow', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: { type: 'object', properties: {}, additionalProperties: false }, timeoutMs: 5,
        execute: () => new Promise(() => {}),
    }]);
    const runner = new ToolRunner({ registry });
    const timeout = await runner.run({ call: { id: 'c', function: { name: 'slow', arguments: '{}' } }, trustedContext: { turnId: 't' } });
    assert.equal(timeout.error.code, 'TOOL_TIMEOUT');
    const unknown = await runner.run({ call: { id: 'x', function: { name: 'shell', arguments: '{}' } }, trustedContext: { turnId: 't' } });
    assert.equal(unknown.error.code, 'UNKNOWN_TOOL');
});
