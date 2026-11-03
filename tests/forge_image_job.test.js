'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    runForgeImageJob,
    selectGalleryResult,
    fetchImageBuffer,
} = require('../utils/forge_image_job');

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
