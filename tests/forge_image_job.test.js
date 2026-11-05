'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    runForgeImageJob,
    selectGalleryResult,
    fetchImageBuffer,
} = require('../utils/forge_image_job');
const { withForgeSession } = require('../utils/forge_session');
const { createForgeCancellation, sendForgeInterrupt } = require('../utils/forge_cancel');

const tick = () => new Promise(resolve => setImmediate(resolve));

function makeInteraction() {
    const edits = [];
    const sent = [];
    const collector = {
        handler: null,
        stopped: false,
        on(event, handler) {
            if (event === 'collect') this.handler = handler;
        },
        stop() { this.stopped = true; },
    };
    const interaction = {
        id: 'interaction-test',
        user: { id: 'owner' },
        channel: {
            nsfw: true,
            createMessageComponentCollector() { return collector; },
            async send(message) { sent.push(message); },
        },
        async editReply(message) { edits.push(message); },
    };
    return { interaction, edits, sent, collector };
}

function successResponse(path = '/tmp/result.png') {
    return {
        status: 200,
        data: {
            data: [
                { value: [{ image: { path } }] },
                null,
                JSON.stringify({ seed: 42, sd_model_hash: 'hash', sd_model_name: 'model' }),
            ],
            duration: 1.25,
        },
    };
}

function cancelComponent() {
    return {
        customId: 'cancel_img2img_interaction-test',
        user: { id: 'owner' },
        deferUpdate: async () => {},
        message: { delete: async () => {} },
    };
}

test('selectGalleryResult skips DAAM heatmaps and chooses the PiD final image', () => {
    const gallery = [
        { image: { path: 'heatmap-a.png' } },
        { image: { path: 'base.png' } },
        { image: { path: 'pid-4x.png' } },
    ];
    assert.equal(selectGalleryResult(gallery, { daamHeatmapCount: 1 }), 'base.png');
    assert.equal(selectGalleryResult(gallery, { daamHeatmapCount: 1, pid: true }), 'pid-4x.png');
    assert.equal(selectGalleryResult([{ path: 'only.png' }], { pid: true }), 'only.png');
    assert.equal(selectGalleryResult([], { pid: true }), null);
});

test('selectGalleryResult ignores temporary Gradio mask/preview files', () => {
    const temp = 'C:\\Users\\ADMIN\\AppData\\Local\\Temp\\gradio\\abc\\tmpmask.png';
    const tempLinux = '/tmp/gradio/abc/tmpmask.png';
    const actual = 'G:\\AIStuff\\sd-webui-forge-neo\\output\\img2img-images\\2026-11-03\\00036.png';
    assert.equal(selectGalleryResult([{ path: actual }, { path: temp }, { path: tempLinux }]), actual);
    assert.equal(
        selectGalleryResult([{ path: 'base.png' }, { path: 'pid.png' }, { path: temp }], { pid: true }),
        'pid.png',
    );
});

test('shared runner submits once and delivers the downloaded result', async () => {
    const { interaction, edits, collector } = makeInteraction();
    let posts = 0;
    const result = await runForgeImageJob({
        interaction,
        serverIndex: 0,
        sessionHash: 'session',
        endpoint: 'http://forge.test',
        fnIndex: 1338,
        abortFnIndex: 46,
        data: [1, 2, 3],
        workload: { schema_version: 1 },
        cancelCustomId: 'cancel_img2img_interaction-test',
        completionDelayMs: 0,
        progress: { enabled: false },
    }, {
        axios: {
            async post() {
                posts++;
                return successResponse();
            },
        },
        fetchImpl: async () => ({ status: 200, arrayBuffer: async () => Buffer.from('png-bytes') }),
        sleep: async () => {},
    });

    assert.equal(posts, 1);
    assert.equal(result.status, 'completed');
    assert.equal(result.seed, '42');
    assert.equal(collector.stopped, true);
    const completed = edits.at(-1);
    assert.ok(Array.isArray(completed.embeds));
    assert.equal(completed.components, undefined);
    assert.equal(completed.files[0].attachment.toString(), 'png-bytes');
});

test('shared runner reports submission failures coherently', async () => {
    const { interaction, edits, collector } = makeInteraction();
    const result = await runForgeImageJob({
        interaction,
        sessionHash: 'session',
        endpoint: 'http://forge.test',
        fnIndex: 1338,
        abortFnIndex: 46,
        data: [],
        cancelCustomId: 'cancel_img2img_interaction-test',
        completionDelayMs: 0,
        progress: { enabled: false },
    }, {
        axios: { async post() { throw new Error('captured'); } },
        fetchImpl: async () => ({ status: 200, arrayBuffer: async () => Buffer.from('') }),
        sleep: async () => {},
    });

    assert.equal(result.status, 'error');
    assert.equal(collector.stopped, true);
    assert.match(edits.at(-1).content, /Error while creating image/);
    assert.deepEqual(edits.at(-1).components, []);
});

test('cancel aborts only the active owner job and stale buttons cannot abort again', async () => {
    const { interaction, collector } = makeInteraction();
    let resolvePost;
    const postPromise = new Promise(resolve => { resolvePost = resolve; });
    let abortCalls = 0;
    const fetchImpl = async url => {
        if (url.includes('/run/predict/')) {
            abortCalls++;
            return { status: 200, json: async () => ({}) };
        }
        if (String(url).includes('/internal/progress')) return { status: 200, json: async () => ({ active: true }) };
        return { status: 200, arrayBuffer: async () => Buffer.from('png') };
    };

    const jobPromise = runForgeImageJob({
        interaction,
        serverIndex: 0,
        sessionHash: 'session',
        endpoint: 'http://forge.test',
        fnIndex: 1338,
        abortFnIndex: 46,
        data: [],
        cancelCustomId: 'cancel_img2img_interaction-test',
        completionDelayMs: 0,
        progress: { enabled: false },
    }, {
        axios: { post: async () => postPromise },
        fetchImpl,
        sleep: async () => {},
    });

    await tick();
    assert.equal(typeof collector.handler, 'function');
    await collector.handler(cancelComponent());
    await tick();
    assert.equal(abortCalls, 1);

    // The prediction eventually returns, but a cancelled job must not deliver.
    resolvePost(successResponse());
    const result = await jobPromise;
    assert.equal(result.status, 'cancelled');
    assert.equal(collector.stopped, true);

    // A stale message component (or a late delivery from Discord) must not
    // issue a second abort after the lease has been released.
    await collector.handler(cancelComponent());
    await tick();
    assert.equal(abortCalls, 1);
});

test('progress polling timer is cleared on success and failure', async () => {
    for (const failure of [false, true]) {
        const { interaction } = makeInteraction();
        const timers = [];
        const cleared = [];
        const result = await runForgeImageJob({
            interaction,
            sessionHash: 'session',
            endpoint: 'http://forge.test',
            fnIndex: 1338,
            abortFnIndex: 46,
            data: [],
            cancelCustomId: 'cancel_img2img_interaction-test',
            completionDelayMs: 0,
            progress: { enabled: true, initialDelay: 1000, increment: 500 },
        }, {
            axios: {
                async post() {
                    if (failure) throw new Error('captured');
                    return successResponse();
                },
            },
            fetchImpl: async () => ({ status: 200, arrayBuffer: async () => Buffer.from('png') }),
            sleep: async () => {},
            setTimeout: callback => {
                const timer = { callback };
                timers.push(timer);
                return timer;
            },
            clearTimeout: timer => { cleared.push(timer); },
        });
        assert.equal(result.status, failure ? 'error' : 'completed');
        assert.ok(timers.length >= 1);
        assert.deepEqual(cleared, timers, failure ? 'failure clears progress timer' : 'success clears progress timer');
    }
});

test('progress polling survives a non-JSON upstream error', async () => {
    const { interaction } = makeInteraction();
    const logs = [];
    const result = await runForgeImageJob({
        interaction,
        sessionHash: 'session',
        endpoint: 'http://forge.test',
        fnIndex: 1338,
        data: [],
        cancelCustomId: 'cancel_img2img_progress-error-test',
        completionDelayMs: 0,
        progress: { enabled: true, initialDelay: 0, increment: 100, retries: 0 },
        logger: { log: (...args) => logs.push(args.map(value => String(value)).join(' ')) },
    }, {
        axios: {
            async post() {
                await new Promise(resolve => setTimeout(resolve, 60));
                return successResponse();
            },
        },
        fetchImpl: async url => {
            if (String(url).includes('/internal/progress')) {
                return {
                    status: 504,
                    ok: false,
                    text: async () => "Upstream 'sdwebui-forge-neo' timed out.",
                };
            }
            if (String(url).includes('/internal/progress')) return { status: 200, json: async () => ({ active: true }) };
        return { status: 200, arrayBuffer: async () => Buffer.from('png') };
        },
        sleep: async () => {},
    });

    assert.equal(result.status, 'completed');
    assert.ok(
        logs.some(line => line.includes("Upstream 'sdwebui-forge-neo' timed out")),
        `expected the progress failure to be logged, got: ${logs.join('\n')}`,
    );
});

test('a PiD restore failure in the postpass is reported to the user', async () => {
    const { interaction, edits } = makeInteraction();
    const restoreError = new Error('PiD postpass completed, but the original Forge checkpoint could not be restored: boom');
    restoreError.code = 'PID_POSTPASS_RESTORE_FAILED';

    const result = await runForgeImageJob({
        interaction,
        sessionHash: 'base-session',
        endpoint: 'http://forge.test',
        fnIndex: 1338,
        abortFnIndex: 46,
        data: [],
        cancelCustomId: 'cancel_img2img_interaction-test',
        completionDelayMs: 0,
        progress: { enabled: false },
        postpass: async () => { throw restoreError; },
    }, {
        axios: { async post() { return successResponse('/tmp/base.png'); } },
        fetchImpl: async () => ({ status: 200, arrayBuffer: async () => Buffer.from('base') }),
        sleep: async () => {},
    });

    assert.equal(result.status, 'error');
    assert.match(edits.at(-1).content, /could not be restored/);
    assert.deepEqual(edits.at(-1).components, []);
});

test('postpass replaces the delivered image and uses a new task session', async () => {
    const { interaction, edits } = makeInteraction();
    let posts = 0;
    let seenSession = null;
    let predicted = null;
    const result = await runForgeImageJob({
        interaction,
        serverIndex: 0,
        sessionHash: 'base-session',
        endpoint: 'http://forge.test',
        fnIndex: 1338,
        abortFnIndex: 46,
        data: [],
        cancelCustomId: 'cancel_img2img_interaction-test',
        completionDelayMs: 0,
        progress: { enabled: false },
        postpass: async context => {
            seenSession = context.sessionHash;
            assert.equal(context.packet.data[0].value[0].image.path, '/tmp/base.png');
            assert.equal(context.seed, 42);
            predicted = await context.predict({
                fn_index: 1338,
                session_hash: context.sessionHash,
                data: [1],
            });
            return {
                data: [
                    { value: [{ image: { path: '/tmp/final.png' } }] },
                    null,
                    JSON.stringify({ seed: 42, sd_model_hash: 'pid-hash', sd_model_name: 'pid-model' }),
                ],
                duration: 2.5,
            };
        },
    }, {
        axios: {
            async post() {
                posts++;
                return posts === 1 ? successResponse('/tmp/base.png') : successResponse('/tmp/final.png');
            },
        },
        fetchImpl: async url => ({
            status: 200,
            arrayBuffer: async () => Buffer.from(url.includes('final') ? 'final-bytes' : 'base-bytes'),
        }),
        sleep: async () => {},
    });

    assert.equal(posts, 2);
    assert.equal(seenSession, 'base-session-pid');
    assert.equal(predicted.data[0].value[0].image.path, '/tmp/final.png');
    assert.equal(result.status, 'completed');
    assert.equal(edits.at(-1).files[0].attachment.toString(), 'final-bytes');
});

test('fetchImageBuffer decodes inline data URIs without touching the network', async () => {
    const bytes = Buffer.from('inline-image');
    let calls = 0;
    const buffer = await fetchImageBuffer({
        endpoint: 'http://forge.test',
        filePath: `data:image/png;base64,${bytes.toString('base64')}`,
        fetchImpl: async () => { calls++; throw new Error('should not fetch'); },
        retryDelayMs: 0,
        sleep: async () => {},
    });
    assert.equal(calls, 0);
    assert.deepEqual(buffer, bytes);
});

test('interrupt transport keeps JSON, service and explicit instance routing', async () => {
    let captured = null;
    const result = await sendForgeInterrupt({
        endpoint: 'http://forge.test',
        sessionHash: 'session-1',
        abortFnIndex: 46,
        headers: { 'X-AI-Instance': 'forge-gpu0' },
        fetchImpl: async (url, options) => {
            captured = { url, options };
            return { status: 200, text: async () => '{}' };
        },
    });

    assert.equal(result.ok, true);
    assert.equal(captured.url, 'http://forge.test/run/predict/');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers['Content-Type'], 'application/json');
    assert.equal(captured.options.headers['X-AI-Service'], 'sdwebui-forge-neo');
    assert.equal(captured.options.headers['X-AI-Instance'], 'forge-gpu0');
    assert.deepEqual(JSON.parse(captured.options.body), {
        fn_index: 46,
        session_hash: 'session-1',
        data: [],
    });
});

test('a queued Forge task is interrupted only after it starts sampling', async () => {
    let progressCalls = 0;
    let interruptCalls = 0;
    const timers = [];
    const logs = [];
    const cancellation = createForgeCancellation({
        interaction: { id: 'queued', user: { id: 'owner' }, channel: {} },
        customId: 'cancel_queued',
        fetchImpl: async url => {
            if (String(url).includes('/internal/progress')) {
                progressCalls++;
                return {
                    status: 200,
                    text: async () => JSON.stringify(
                        progressCalls === 1 ? { queued: true } : { progress: 0.25 },
                    ),
                };
            }
            interruptCalls++;
            return { status: 200, text: async () => '{}' };
        },
        setTimeoutImpl: callback => {
            const timer = { callback, unref() {} };
            timers.push(timer);
            return timer;
        },
        clearTimeoutImpl: () => {},
        logger: { log: (...args) => logs.push(args.join(' ')) },
    });

    const task = cancellation.beginTask({
        sessionHash: 'queued-session',
        endpoint: 'http://forge.test',
        abortFnIndex: 46,
    });
    assert.ok(task);
    cancellation.requestCancel();
    await tick();
    await tick();

    assert.equal(interruptCalls, 0, 'queued work must not abort the running owner');
    assert.equal(timers.length, 1);

    timers[0].callback();
    await tick();
    await tick();
    assert.equal(interruptCalls, 1, 'the pending cancel fires once the task starts');
    await cancellation.finish();
    assert.deepEqual(logs, []);
});

test('delayed cancel acknowledgement cannot abort the next lease owner', async () => {
    const first = makeInteraction();
    const second = makeInteraction();
    let resolveAck;
    const ack = new Promise(resolve => { resolveAck = resolve; });
    let resolvePost;
    const delayedResponse = new Promise(resolve => { resolvePost = resolve; });
    let interrupts = 0;

    const fetchImpl = async url => {
        if (String(url).includes('/run/predict/')) {
            interrupts++;
            return { status: 200, text: async () => '{}' };
        }
        if (String(url).includes('/internal/progress')) return { status: 200, json: async () => ({ active: true }) };
        return { status: 200, arrayBuffer: async () => Buffer.from('png') };
    };

    let firstResult = null;
    await withForgeSession(async () => {
        const job = runForgeImageJob({
            interaction: first.interaction,
            serverIndex: 0,
            sessionHash: 'first-session',
            endpoint: 'http://forge.test',
            fnIndex: 1338,
            abortFnIndex: 46,
            data: [],
            cancelCustomId: 'cancel_img2img_interaction-test',
            completionDelayMs: 0,
            progress: { enabled: false },
        }, {
            axios: { post: async () => delayedResponse },
            fetchImpl,
            sleep: async () => {},
        });

        await tick();
        const component = { ...cancelComponent(), deferUpdate: () => ack };
        await first.collector.handler(component);
        await tick();
        await tick();
        assert.equal(interrupts, 1, 'interrupt is sent before Discord acknowledges');

        resolvePost(successResponse());
        firstResult = await job;
        assert.equal(firstResult.status, 'cancelled');
    });

    // The first lease is released while deferUpdate is still pending.
    const secondResult = await withForgeSession(async () => runForgeImageJob({
        interaction: second.interaction,
        serverIndex: 0,
        sessionHash: 'second-session',
        endpoint: 'http://forge.test',
        fnIndex: 1338,
        abortFnIndex: 46,
        data: [],
        cancelCustomId: 'cancel_img2img_interaction-second',
        completionDelayMs: 0,
        progress: { enabled: false },
    }, {
        axios: { post: async () => successResponse() },
        fetchImpl,
        sleep: async () => {},
    }));

    resolveAck();
    await tick();
    await tick();

    assert.equal(secondResult.status, 'completed');
    assert.equal(interrupts, 1, 'a late acknowledgement must not abort the next owner');
});

test('an interrupt transport failure is shown instead of a silent cancel', async () => {
    const { interaction, edits, collector } = makeInteraction();
    let resolvePost;
    const delayedResponse = new Promise(resolve => { resolvePost = resolve; });

    const job = runForgeImageJob({
        interaction,
        serverIndex: 0,
        sessionHash: 'failed-interrupt',
        endpoint: 'http://forge.test',
        fnIndex: 1338,
        abortFnIndex: 46,
        data: [],
        cancelCustomId: 'cancel_img2img_interaction-test',
        completionDelayMs: 0,
        progress: { enabled: false },
    }, {
        axios: { post: async () => delayedResponse },
        fetchImpl: async url => {
            if (String(url).includes('/run/predict/')) {
                return { status: 500, text: async () => 'interrupt rejected' };
            }
            if (String(url).includes('/internal/progress')) return { status: 200, json: async () => ({ active: true }) };
        return { status: 200, arrayBuffer: async () => Buffer.from('png') };
        },
        sleep: async () => {},
    });

    await tick();
    await collector.handler(cancelComponent());
    await tick();
    resolvePost(successResponse());
    const result = await job;

    assert.equal(result.status, 'cancelled');
    assert.match(edits.at(-1).content, /Forge interrupt failed/);
    assert.match(edits.at(-1).content, /HTTP 500/);
    assert.deepEqual(edits.at(-1).components, []);
});
