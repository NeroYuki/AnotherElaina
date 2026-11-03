'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createForgeCancellation, sendForgeInterrupt } = require('../utils/forge_cancel');
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const initial of [null, {}, { active: false, queued: false, completed: false }]) {
    test(`unknown task ownership never sends a global Forge interrupt: ${JSON.stringify(initial)}`, async () => {
        const timers = [];
        let progress = initial;
        let interrupts = 0;
        const cancellation = createForgeCancellation({
            endpoint: 'http://forge.test', abortFnIndex: 46,
            logger: { log() {} },
            fetchImpl: async url => {
                if (url.endsWith('/internal/progress')) return {
                    status: progress === null ? 503 : 200,
                    text: async () => progress === null ? 'busy' : JSON.stringify(progress),
                };
                interrupts++;
                return { status: 200, text: async () => '{}' };
            },
            setTimeoutImpl: callback => { const timer = { callback }; timers.push(timer); return timer; },
            clearTimeoutImpl() {},
        });
        try {
            cancellation.beginTask({ sessionHash: 'owned-task' });
            cancellation.requestCancel();
            await tick();
            await cancellation.drain();
            assert.equal(interrupts, 0);
            assert.equal(timers.length, 1);
            progress = { active: true, queued: false, completed: false, progress: 0 };
            timers[0].callback();
            await tick();
            await cancellation.drain();
            assert.equal(interrupts, 1, 'the first proven active state dispatches the pending cancel');
        }
        finally { await cancellation.finish(); }
    });
}

test('a Gradio error in an HTTP 200 interrupt is reported as failure', async () => {
    const result = await sendForgeInterrupt({
        endpoint: 'http://forge.test', sessionHash: 'owner', abortFnIndex: 46,
        logger: { log() {} },
        fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ error: 'callback unavailable' }) }),
    });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /callback unavailable/);
});
