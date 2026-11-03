'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runComfyPrompt } = require('../utils/comfy_prompt');
const { runComfyImageJob } = require('../utils/comfy_image_job');
const { runVideo } = require('../utils/comfy_media');

const tick = () => new Promise(resolve => setImmediate(resolve));

test('a delayed Discord acknowledgement does not delay Comfy cancellation', async () => {
    const { interaction, collector } = makeInteraction('slow-ack');
    let acknowledge;
    const ack = new Promise(resolve => { acknowledge = resolve; });
    let backendCancelled = false;
    const job = runComfyImageJob(interaction, {}, {
        freeMemory: false,
        client: {
            runPrompt(_workflow, options) {
                return new Promise(resolve => options.signal.addEventListener('abort', () => {
                    backendCancelled = true;
                    resolve({ status: 'cancelled' });
                }, { once: true }));
            },
        },
    });
    await tick();
    collector.handler({ ...cancelComponent('slow-ack'), deferUpdate: () => ack });
    await tick();
    assert.equal(backendCancelled, true);
    acknowledge();
    assert.equal((await job).status, 'cancelled');
});

function makeInteraction(id = 'interaction-cancel') {
    const edits = [];
    const sent = [];
    const collector = {
        handler: null,
        stopped: false,
        on(event, handler) { if (event === 'collect') this.handler = handler; },
        stop() { this.stopped = true; },
    };
    const interaction = {
        id,
        user: { id: 'owner' },
        channel: {
            nsfw: true,
            createMessageComponentCollector() { return collector; },
            async send(payload) { sent.push(payload); },
        },
        async editReply(payload) { edits.push(payload); return payload; },
    };
    return { interaction, edits, sent, collector };
}

function cancelComponent(id = 'interaction-cancel') {
    return {
        customId: `cancel_comfy_${id}`,
        user: { id: 'owner' },
        deferUpdate: async () => {},
        message: { delete: async () => {} },
    };
}

function makeClient() {
    const client = {
        HTTP_ENDPOINT: 'http://proxy',
        clientId: 'test-client',
        promptListener: [],
    };
    client.updateOnMessage = require('../utils/comfy_client').updateOnMessage.bind(client);
    return client;
}

function promptResponse(promptId, instanceId = 'comfy-0') {
    return {
        status: 200,
        headers: instanceId ? { 'x-ai-instance': instanceId } : {},
        data: { prompt_id: promptId },
    };
}

function completedHistory(promptId, outputs = {}) {
    return {
        status: 200,
        data: { [promptId]: { status: { completed: true, status_str: 'success' }, outputs } },
    };
}

test('queued cancellation uses the exact job endpoint and confirms immediately', async () => {
    const client = makeClient();
    const cancelCalls = [];
    const notifications = [];
    const http = {
        async post(url, body, config) {
            if (url.endsWith('/prompt')) return promptResponse('queued-1', 'comfy-7');
            if (url.includes('/api/jobs/queued-1/cancel')) {
                cancelCalls.push({ url, config });
                return { status: 200, data: { status: 'dequeued' } };
            }
            throw new Error(`unexpected POST ${url}`);
        },
        async get(url, config) {
            assert.ok(config.headers['X-AI-Instance'] === 'comfy-7');
            return { status: 200, data: {} };
        },
    };

    const result = await runComfyPrompt(client, {}, {
        http,
        pollMs: 1,
        timeoutMs: 500,
        notify: (jobId, outcome) => notifications.push(outcome),
        onSubmitted(info) { info.cancel(); },
    });

    assert.equal(result.status, 'cancelled');
    assert.deepEqual(notifications, ['cancelled']);
    assert.equal(cancelCalls.length, 1);
    assert.equal(cancelCalls[0].url, 'http://proxy/api/jobs/queued-1/cancel');
    assert.equal(cancelCalls[0].config.headers['X-AI-Instance'], 'comfy-7');
    assert.ok(!cancelCalls[0].url.includes('/interrupt'));
    assert.equal(client.promptListener.length, 0);
});

test('running cancellation waits for queue evidence before releasing the reservation', async () => {
    const client = makeClient();
    const notifications = [];
    let queuePolls = 0;
    let notificationsAtFirstPoll = null;
    const http = {
        async post(url) {
            if (url.endsWith('/prompt')) return promptResponse('running-1', 'comfy-2');
            if (url.includes('/api/jobs/running-1/cancel')) {
                return { status: 200, data: { status: 'interrupted' } };
            }
            throw new Error(`unexpected POST ${url}`);
        },
        async get(url, config) {
            assert.equal(config.headers['X-AI-Instance'], 'comfy-2');
            if (url.endsWith('/queue')) {
                queuePolls++;
                if (queuePolls === 1) notificationsAtFirstPoll = notifications.length;
                return {
                    status: 200,
                    data: queuePolls < 3
                        ? { queue_running: [[1, 'running-1']], queue_pending: [] }
                        : { queue_running: [], queue_pending: [] },
                };
            }
            return { status: 200, data: {} };
        },
    };

    const result = await runComfyPrompt(client, {}, {
        http,
        pollMs: 1,
        timeoutMs: 500,
        notify: (jobId, outcome) => notifications.push(outcome),
        onSubmitted(info) { info.cancel(); },
    });

    assert.equal(result.status, 'cancelled');
    assert.equal(notificationsAtFirstPoll, 0, 'must not notify while the target is still running');
    assert.deepEqual(notifications, ['cancelled']);
    assert.ok(queuePolls >= 3);
});

test('a websocket execution_interrupted event confirms a dispatched running cancel', async () => {
    const client = makeClient();
    const notifications = [];
    const http = {
        async post(url) {
            if (url.endsWith('/prompt')) return promptResponse('ws-interrupt', 'comfy-13');
            if (url.includes('/api/jobs/ws-interrupt/cancel')) {
                return { status: 200, data: { status: 'interrupted' } };
            }
            throw new Error(`unexpected POST ${url}`);
        },
        async get(url) {
            if (url.endsWith('/queue')) {
                client.updateOnMessage(JSON.stringify({
                    type: 'execution_interrupted',
                    data: { prompt_id: 'ws-interrupt' },
                }));
                return { status: 200, data: { queue_running: [[1, 'ws-interrupt']], queue_pending: [] } };
            }
            return { status: 200, data: {} };
        },
    };

    const result = await runComfyPrompt(client, {}, {
        http,
        pollMs: 1,
        timeoutMs: 500,
        notify: (jobId, outcome) => notifications.push(outcome),
        onSubmitted(info) { info.cancel(); },
    });

    assert.equal(result.status, 'cancelled');
    assert.deepEqual(notifications, ['cancelled']);
});

test('history execution_interrupted evidence confirms cancellation without a websocket', async () => {
    const client = makeClient();
    const notifications = [];
    const http = {
        async post(url) {
            if (url.endsWith('/prompt')) return promptResponse('history-interrupt', 'comfy-14');
            if (url.includes('/api/jobs/history-interrupt/cancel')) {
                return { status: 200, data: { status: 'interrupted' } };
            }
            throw new Error(`unexpected POST ${url}`);
        },
        async get(url) {
            if (url.endsWith('/queue')) {
                return { status: 200, data: { queue_running: [[1, 'history-interrupt']], queue_pending: [] } };
            }
            return {
                status: 200,
                data: {
                    'history-interrupt': {
                        status: {
                            status_str: 'error',
                            messages: [['execution_interrupted', {}]],
                        },
                    },
                },
            };
        },
    };

    const result = await runComfyPrompt(client, {}, {
        http,
        pollMs: 1,
        timeoutMs: 500,
        notify: (jobId, outcome) => notifications.push(outcome),
        onSubmitted(info) { info.cancel(); },
    });

    assert.equal(result.status, 'cancelled');
    assert.deepEqual(notifications, ['cancelled']);
});

test('cancelling before submission never posts an orphan prompt', async () => {
    const client = makeClient();
    let posts = 0;
    const notifications = [];
    const result = await runComfyPrompt(client, {}, {
        http: {
            async post() { posts++; throw new Error('should not submit'); },
            async get() { return { status: 200, data: {} }; },
        },
        pollMs: 1,
        timeoutMs: 100,
        notify: (jobId, outcome) => notifications.push(outcome),
        onController(controller) { controller.cancel(); },
    });

    assert.equal(result.status, 'cancelled');
    assert.equal(result.submitted, false);
    assert.equal(posts, 0);
    assert.deepEqual(notifications, []);
});

test('cancellation during submission finishes submission then cancels that exact prompt', async () => {
    const client = makeClient();
    let resolveSubmit;
    let cancelUrl = null;
    const submit = new Promise(resolve => { resolveSubmit = resolve; });
    let controller = null;
    const http = {
        async post(url, body, config) {
            if (url.endsWith('/prompt')) return submit;
            if (url.includes('/api/jobs/late-1/cancel')) {
                cancelUrl = url;
                assert.equal(config.headers['X-AI-Instance'], 'comfy-9');
                return { status: 200, data: { status: 'dequeued' } };
            }
            throw new Error(`unexpected POST ${url}`);
        },
        async get() { return { status: 200, data: {} }; },
    };

    const promise = runComfyPrompt(client, {}, {
        http,
        pollMs: 1,
        timeoutMs: 500,
        onController(value) { controller = value; },
    });
    await tick();
    const pending = controller.cancel();
    assert.equal((await pending).status, 'pending-submission');
    resolveSubmit(promptResponse('late-1', 'comfy-9'));

    const result = await promise;
    assert.equal(result.status, 'cancelled');
    assert.equal(cancelUrl, 'http://proxy/api/jobs/late-1/cancel');
});

test('terminal completion notifies once and a late cancel cannot touch a new job', async () => {
    const client = makeClient();
    const notifications = [];
    const cancelCalls = [];
    let controller = null;
    const outputs = { save: { images: [{ filename: 'result.png' }] } };
    const http = {
        async post(url) {
            if (url.endsWith('/prompt')) return promptResponse('done-1', 'comfy-3');
            cancelCalls.push(url);
            return { status: 200, data: { status: 'dequeued' } };
        },
        async get() {
            client.updateOnMessage(JSON.stringify({
                type: 'executed',
                data: { prompt_id: 'done-1', node: 'save', output: outputs.save },
            }));
            client.updateOnMessage(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'done-1' } }));
            return completedHistory('done-1', outputs);
        },
    };

    const result = await runComfyPrompt(client, {}, {
        http,
        pollMs: 1,
        timeoutMs: 500,
        notify: (jobId, outcome) => notifications.push(outcome),
        onController(value) { controller = value; },
    });
    assert.equal(result.status, 'completed');
    assert.deepEqual(notifications, ['success']);
    assert.equal(client.promptListener.length, 0);

    const late = await controller.cancel();
    assert.equal(late.status, 'finished');
    assert.equal(cancelCalls.length, 0, 'late cancel must not call the backend');
});

test('missing instance affinity surfaces cancellation failure instead of a global interrupt', async () => {
    const client = makeClient();
    const notifications = [];
    const cancelCalls = [];
    const http = {
        async post(url) {
            if (url.endsWith('/prompt')) return promptResponse('no-affinity', null);
            cancelCalls.push(url);
            return { status: 200, data: { status: 'dequeued' } };
        },
        async get() { return completedHistory('no-affinity', { save: { images: [{ filename: 'x.png' }] } }); },
    };

    const result = await runComfyPrompt(client, {}, {
        http,
        pollMs: 1,
        timeoutMs: 500,
        notify: (jobId, outcome) => notifications.push(outcome),
        onSubmitted(info) { info.cancel(); },
    });

    assert.equal(result.status, 'cancel-failed');
    assert.match(result.reason, /completed before cancellation/);
    assert.equal(cancelCalls.length, 0);
    assert.deepEqual(notifications, ['success']);
});

test('cancel HTTP failure keeps tracking the running job and never reports cancelled', async () => {
    const client = makeClient();
    const notifications = [];
    let historyPolls = 0;
    const http = {
        async post(url) {
            if (url.endsWith('/prompt')) return promptResponse('fail-1', 'comfy-4');
            if (url.includes('/api/jobs/fail-1/cancel')) {
                return { status: 500, data: { error: 'unsupported' } };
            }
            throw new Error(`unexpected POST ${url}`);
        },
        async get(url) {
            if (url.endsWith('/queue')) return { status: 200, data: { queue_running: [[1, 'fail-1']], queue_pending: [] } };
            historyPolls++;
            if (historyPolls < 3) return { status: 200, data: {} };
            return completedHistory('fail-1', { save: { images: [{ filename: 'done.png' }] } });
        },
    };

    const result = await runComfyPrompt(client, {}, {
        http,
        pollMs: 1,
        timeoutMs: 500,
        notify: (jobId, outcome) => notifications.push(outcome),
        onSubmitted(info) { info.cancel(); },
    });

    assert.equal(result.status, 'cancel-failed');
    assert.ok(historyPolls >= 3, 'must keep polling the exact job after cancel HTTP failure');
    assert.deepEqual(notifications, ['success']);
    assert.ok(!notifications.includes('cancelled'));
});

test('queued target cancellation leaves a different running prompt untouched', async () => {
    const client = makeClient();
    let cancelUrl = null;
    const http = {
        async post(url) {
            if (url.endsWith('/prompt')) return promptResponse('target-1', 'comfy-5');
            if (url.includes('/api/jobs/target-1/cancel')) {
                cancelUrl = url;
                return { status: 200, data: { status: 'dequeued' } };
            }
            throw new Error(`unexpected POST ${url}`);
        },
        async get(url) {
            if (url.endsWith('/queue')) {
                return { status: 200, data: { queue_running: [[2, 'other-2']], queue_pending: [] } };
            }
            return { status: 200, data: {} };
        },
    };

    const result = await runComfyPrompt(client, {}, {
        http,
        pollMs: 1,
        timeoutMs: 500,
        onSubmitted(info) { info.cancel(); },
    });

    assert.equal(result.status, 'cancelled');
    assert.equal(cancelUrl, 'http://proxy/api/jobs/target-1/cancel');
});

test('image helper attaches an owner Cancel button, delivers once and cleans the exact instance', async () => {
    const { interaction, edits, collector } = makeInteraction('image-job');
    const calls = { downloads: [], freed: [] };
    const fakeClient = {
        async runPrompt(workflow, options) {
            options.onSubmitted({ prompt_id: 'img-1', instance_id: 'comfy-6' });
            options.onProgress({ node: 'save', value: 1, max: 2 });
            return {
                status: 'completed',
                outputs: { save: { images: [{ filename: 'image.png', subfolder: 'out', type: 'output' }] } },
                executed: [{ node: 'save', output: { images: [{ filename: 'image.png', subfolder: 'out', type: 'output' }] } }],
            };
        },
        async getImage(filename, subfolder, filetype, onlyFilename, options) {
            calls.downloads.push({ filename, subfolder, filetype, options });
            return Buffer.from('image-bytes');
        },
        async freeMemory(value, options) { calls.freed.push({ value, options }); },
    };

    const result = await runComfyImageJob(interaction, {}, {
        client: fakeClient,
        progressThrottleMs: 0,
        progress: data => `Processing: ${data.node}`,
    });

    assert.equal(result.status, 'completed');
    assert.equal(collector.stopped, true);
    assert.equal(edits[0].components[0].components[0].customId, 'cancel_comfy_image-job');
    assert.ok(edits.some(edit => edit.components?.[0]?.components?.[0]?.customId === 'cancel_comfy_image-job'),
        'progress edits keep the Cancel button');
    const final = edits.at(-1);
    assert.deepEqual(final.components, []);
    assert.equal(final.files[0].name, 'image.png');
    assert.equal(calls.downloads[0].options.instanceId, 'comfy-6');
    assert.deepEqual(calls.freed[0].options, { instanceId: 'comfy-6' });
});

test('image helper cancellation during upload skips submission and shows cancelled only once confirmed', async () => {
    const { interaction, edits, collector } = makeInteraction('upload-cancel');
    let resolveUpload;
    let submitted = 0;
    const upload = new Promise(resolve => { resolveUpload = resolve; });
    const fakeClient = {
        async runPrompt() { submitted++; return { status: 'completed', outputs: {} }; },
        async getImage() { throw new Error('must not download'); },
        async freeMemory() {},
    };

    const promise = runComfyImageJob(interaction, null, {
        client: fakeClient,
        async prepare() { await upload; return {}; },
    });
    await tick();
    await collector.handler(cancelComponent('upload-cancel'));
    resolveUpload({});

    const result = await promise;
    assert.equal(result.status, 'cancelled');
    assert.equal(submitted, 0);
    assert.equal(collector.stopped, true);
    assert.equal(edits.at(-1).content, 'Cancelled.');
    assert.deepEqual(edits.at(-1).components, []);
});

test('confirmed cancellation does not free a shared instance', async () => {
    const { interaction, edits } = makeInteraction('cancel-free');
    let freed = 0;
    const fakeClient = {
        async runPrompt(workflow, options) {
            options.onSubmitted({ prompt_id: 'cancel-free-1', instance_id: 'comfy-15' });
            return { status: 'cancelled', outputs: {} };
        },
        async getImage() { throw new Error('must not download'); },
        async freeMemory() { freed++; },
    };

    const result = await runComfyImageJob(interaction, {}, { client: fakeClient });
    assert.equal(result.status, 'cancelled');
    assert.equal(freed, 0);
    assert.equal(edits.at(-1).content, 'Cancelled.');
});

test('image helper suppresses download and delivery after a late cancel', async () => {
    const { interaction, edits, collector } = makeInteraction('late-image');
    let resolveRun;
    let resolveStarted;
    let downloads = 0;
    const started = new Promise(resolve => { resolveStarted = resolve; });
    const fakeClient = {
        async runPrompt(workflow, options) {
            options.onController({ cancel: async () => ({ status: 'cancelled' }) });
            options.onSubmitted({ prompt_id: 'late-img', instance_id: 'comfy-8' });
            resolveStarted();
            return new Promise(resolve => { resolveRun = resolve; });
        },
        async getImage() { downloads++; return Buffer.from('image'); },
        async freeMemory() {},
    };

    const promise = runComfyImageJob(interaction, {}, { client: fakeClient });
    await started;
    await collector.handler(cancelComponent('late-image'));
    resolveRun({
        status: 'completed',
        outputs: { save: { images: [{ filename: 'must-not-send.png' }] } },
    });

    const result = await promise;
    assert.equal(result.status, 'cancel-failed');
    assert.equal(downloads, 0, 'cancelled job must not download output');
    assert.match(edits.at(-1).content, /Cancel failed/);
    assert.equal(edits.at(-1).files, undefined);
});

test('video runVideo gets the same Cancel button and affinity-bound download', async t => {
    const { interaction, edits, collector } = makeInteraction('video-job');
    const comfy = require('../utils/comfy_client');
    const calls = { downloads: [], freed: [] };
    t.mock.method(comfy, 'runPrompt', async (workflow, options) => {
        options.onSubmitted({ prompt_id: 'vid-1', instance_id: 'comfy-11' });
        options.onProgress({ node: '92', value: 3, max: 5 });
        return {
            status: 'completed',
            outputs: { '92': { images: [{ filename: 'clip.mp4', subfolder: 'video', type: 'output' }] } },
        };
    });
    t.mock.method(comfy, 'getImage', async (filename, subfolder, filetype, onlyFilename, options) => {
        calls.downloads.push({ filename, subfolder, filetype, options });
        return Buffer.from('video-bytes');
    });
    t.mock.method(comfy, 'freeMemory', async (value, options) => { calls.freed.push({ value, options }); });

    const result = await runVideo(interaction, { '92': { _meta: { title: 'SaveVideo' } } }, null);

    assert.equal(result.status, 'completed');
    assert.equal(edits[0].components[0].components[0].customId, 'cancel_comfy_video-job');
    assert.equal(collector.stopped, true);
    assert.equal(edits.at(-1).files[0].name, 'clip.mp4');
    assert.deepEqual(edits.at(-1).components, []);
    assert.equal(calls.downloads[0].options.instanceId, 'comfy-11');
    assert.deepEqual(calls.freed[0].options, { instanceId: 'comfy-11' });
});

test('legacy sendPrompt callbacks still receive progress, executed output and terminal cleanup', async () => {
    const shared = require('../utils/comfy_client');
    const client = Object.assign(Object.create(shared), {
        HTTP_ENDPOINT: 'http://proxy',
        clientId: 'legacy-client',
        promptListener: [],
        clients: [{ readyState: 1 }],
    });
    const events = [];
    const outputs = { save: { images: [{ filename: 'legacy.png' }] } };
    const http = {
        async post(url) {
            assert.ok(url.endsWith('/prompt'));
            return promptResponse('legacy-1', 'comfy-12');
        },
        async get() {
            client.updateOnMessage(JSON.stringify({ type: 'executing', data: { prompt_id: 'legacy-1', node: 'save' } }));
            client.updateOnMessage(JSON.stringify({ type: 'progress', data: { prompt_id: 'legacy-1', value: 1, max: 2 } }));
            client.updateOnMessage(JSON.stringify({
                type: 'executed',
                data: { prompt_id: 'legacy-1', node: 'save', output: outputs.save },
            }));
            client.updateOnMessage(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'legacy-1' } }));
            return completedHistory('legacy-1', outputs);
        },
    };
    client.runPrompt = function(prompt, options) {
        return shared.runPrompt.call(this, prompt, { ...options, http, pollMs: 1, timeoutMs: 500 });
    };

    const promise = client.sendPrompt(
        {},
        data => events.push(['progress', data.node]),
        data => events.push(['success', data.output.images[0].filename]),
        error => events.push(['error', error]),
        data => events.push(['subprogress', data.value]),
    );
    const result = await promise;

    assert.equal(result.status, 'completed');
    assert.deepEqual(events, [
        ['progress', 'save'],
        ['subprogress', 1],
        ['success', 'legacy.png'],
    ]);
    assert.equal(client.promptListener.length, 0);
});
