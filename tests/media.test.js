const test = require('node:test');
const assert = require('node:assert/strict');
const { videoShape, imageVideoShape, buildH3Workflow, buildPostProcessWorkflow, videoOutput, mediaReply, deliverFile } = require('../utils/comfy_media');
const { runComfyPrompt } = require('../utils/comfy_prompt');
const { createClient, selectMesh } = require('../utils/celforge_client');

function validLinks(workflow) {
    for (const node of Object.values(workflow)) {
        for (const value of Object.values(node.inputs)) {
            if (Array.isArray(value)) assert.ok(workflow[value[0]], `Missing link ${value[0]}`);
        }
    }
}

test('H3 keeps synchronized 24 fps audio, aligns frames, preserves seed zero, and supports both image anchors', () => {
    const shape = videoShape(1024, 768, 5);
    assert.equal(shape.length, 124);
    assert.equal(videoShape(768, 1024, 15).length, 362);
    assert.throws(() => videoShape(1344, 1344), /megapixels/);
    const portrait = imageVideoShape(800, 1200);
    assert.ok(portrait.height > portrait.width);
    assert.equal(portrait.width % 32, 0);
    for (const upscale of [true, false]) for (const optimize of [true, false]) {
        const workflow = buildH3Workflow({ prompt: 'A bird takes flight', shape, seed: 0, upscale, optimize,
            image: { name: 'first.png', subfolder: 'test' }, lastImage: { name: 'last.png' } });
        validLinks(workflow);
        assert.equal(workflow['105:15'].inputs.noise_seed, 0);
        assert.equal(workflow.input_image.inputs.image, 'test/first.png');
        assert.deepEqual(workflow['105:104'].inputs.last_frame, ['last_image', 0]);
        assert.equal(workflow['105:91'].inputs.fps, 24);
        assert.ok(workflow['105:91'].inputs.audio);
        assert.equal(workflow['105:104'].inputs.prompt, 'A bird takes flight');
        assert.equal(Object.values(workflow).some(node => node.class_type.startsWith('EbuLM')), false);
    }
});

test('all upscale branches preserve audio and use current RIFE/model/FPS inputs', () => {
    for (const color of ['None', 'mkl']) for (const upscaler of ['None', '2x-AnimeSharpV3.pth']) {
        for (const interpolation of ['None', 'rife49.pth']) for (const multiplier of [1, 2]) {
            if (color === 'None' && upscaler === 'None' && (interpolation === 'None' || multiplier === 1)) continue;
            const workflow = buildPostProcessWorkflow({ video: { name: 'source.mp4', subfolder: 'videos' },
                reference: { name: 'ref.png' }, color, strength: 0, upscaler, interpolation, multiplier });
            validLinks(workflow);
            assert.equal(workflow['1'].inputs.video, 'videos/source.mp4');
            assert.deepEqual(workflow['4'].inputs.audio, ['1', 2]);
            assert.deepEqual(workflow['13'].inputs['values.a'], ['8', 5]);
            if (workflow['7']) { assert.equal(workflow['7'].inputs.ckpt_name, 'rife49.pth'); assert.equal(workflow['7'].inputs.batch_size, 1); }
            if (workflow['5']) assert.equal(workflow['5'].inputs.model_name, upscaler);
            if (workflow['2']) assert.equal(workflow['2'].inputs.strength, 0);
        }
    }
    assert.throws(() => buildPostProcessWorkflow({ video: { name: 'v.mp4' }, color: 'mkl' }), /Reference/);
    assert.throws(() => buildPostProcessWorkflow({ video: { name: 'v.mp4' }, multiplier: 1.5 }), /whole number/);
});

test('native SaveVideo and VHS output metadata retain subfolder/type', () => {
    const file = { filename: 'out & test.mp4', subfolder: 'video', type: 'output' };
    assert.deepEqual(videoOutput({ preview: { images: [{ filename: 'preview.png' }] }, save: { images: [file] } }), file);
    assert.deepEqual(videoOutput({ save: { gifs: [file] } }), file);
});

test('Comfy HTTP completion handles cached results without a websocket and sends private workload metadata', async () => {
    const client = { HTTP_ENDPOINT: 'http://proxy', clientId: 'test', promptListener: [] };
    const notifications = [];
    const result = await runComfyPrompt(client, { '1': { class_type: 'Test', inputs: { text: 'PRIVATE PROMPT' } } }, {
        pollMs: 1,
        http: {
            async post(url, body, config) {
                assert.equal(config.headers['X-AI-Service'], 'comfyui');
                assert.ok(config.headers['X-AI-Job-ID']);
                assert.ok(!JSON.stringify(config.headers).includes('PRIVATE PROMPT'));
                return { data: { prompt_id: 'cached' } };
            },
            async get() { return { data: { cached: { status: { completed: true }, outputs: { '1': { images: [{ filename: 'cached.mp4' }] } } } } }; },
        }, notify: (id, outcome) => notifications.push(outcome),
    });
    assert.ok(result.outputs['1']);
    assert.equal(client.promptListener.length, 0);
    assert.deepEqual(notifications, ['success']);
});

test('Comfy propagates execution and admission errors and removes listeners', async () => {
    const client = { HTTP_ENDPOINT: 'http://proxy', clientId: 'test', promptListener: [] };
    const http = {
        async post() { return { data: { prompt_id: 'failed' } }; },
        async get() { return { data: { failed: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'Missing model' }]] } } } }; },
    };
    await assert.rejects(runComfyPrompt(client, {}, { http, pollMs: 1 }), /Missing model/);
    assert.equal(client.promptListener.length, 0);
    await assert.rejects(runComfyPrompt(client, {}, { http: { async post() {
        throw { response: { headers: { 'x-ai-admission-reason': 'busy', 'retry-after': '3' } } };
    } } }), /busy.*3s/);
});

test('consumer timeout keeps running GPU reservation and cleans up its listener', async () => {
    const notifications = [];
    const client = { HTTP_ENDPOINT: 'http://proxy', clientId: 'test', promptListener: [] };
    await assert.rejects(runComfyPrompt(client, {}, { timeoutMs: 3, pollMs: 1, notify: (...args) => notifications.push(args),
        http: { async post() { return { data: { prompt_id: 'slow' } }; }, async get() { return { data: {} }; } },
    }), /timed out/);
    assert.deepEqual(notifications, []);
    assert.equal(client.promptListener.length, 0);
});

test('Comfy websocket completion waits for the terminal event and ignores binary preview data', async () => {
    const shared = require('../utils/comfy_client');
    const client = Object.assign(Object.create(shared), { HTTP_ENDPOINT: 'http://proxy', promptListener: [] });
    const file = { filename: 'ws.mp4', subfolder: 'video', type: 'output' };
    const result = await runComfyPrompt(client, {}, { pollMs: 1, http: {
        async post() { return { data: { prompt_id: 'ws' } }; },
        async get() {
            client.updateOnMessage(Buffer.from([0, 1, 2, 3]));
            client.updateOnMessage(JSON.stringify({ type: 'executed', data: { prompt_id: 'ws', node: 'save', output: { images: [file] } } }));
            client.updateOnMessage(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'ws' } }));
            return { data: {} };
        },
    } });
    assert.deepEqual(result.outputs.save.images, [file]);
    assert.equal(client.promptListener.length, 0);
    const sockets = [{ readyState: 1 }, { readyState: 0 }];
    client.clients = sockets;
    assert.equal(client.init(), sockets);
});

test('CelForge uses durable case/run endpoints and returns the aligned selected GLB', async () => {
    const artifact = { id: 'aligned', kind: 'mesh', path: 'mesh/candidate-pixal.glb' };
    const run = { id: 'run1', status: 'succeeded', artifacts: [
        { id: 'raw', kind: 'mesh', path: 'mesh/raw/model.glb' }, artifact,
    ] };
    assert.equal(selectMesh(run), artifact);
    const calls = [];
    const client = createClient({ pollMs: 1, http: {
        async post(url, body) {
            calls.push(url);
            if (url === '/api/cases') { assert.ok(body.get('source') instanceof Blob); return { data: { id: 'case1' } }; }
            assert.deepEqual(body, { case_id: 'case1', recipe: 'trellis_1024_cascade', seed: 0 });
            return { data: { id: 'run1', status: 'queued' } };
        },
        async get(url) { calls.push(url); return { data: url.endsWith('/aligned') ? Buffer.from('glb') : run }; },
    } });
    const result = await client.generate(Buffer.from('png'), { seed: 0 });
    assert.equal(result.buffer.toString(), 'glb');
    assert.equal(calls.at(-1), '/api/runs/run1/artifacts/aligned');
});

test('final media result wins over queued progress and expired webhook falls back to channel', async () => {
    const messages = [];
    const interaction = { async editReply() { throw { code: 10015 }; }, channel: { async send(payload) { messages.push(payload); } } };
    const reply = mediaReply(interaction);
    reply.progress('Still running');
    await deliverFile(reply, interaction, Buffer.from('video'), 'sub/orbit.mp4', 'Model ready');
    reply.progress('Late progress');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, 'Model ready');
    assert.equal(messages[0].files[0].name, 'orbit.mp4');
});

test('oversized media is returned as a Catbox link without another Discord attachment', async t => {
    const axios = require('axios');
    t.mock.method(axios, 'post', async (url, form) => {
        assert.equal(url, 'https://catbox.moe/user/api.php');
        assert.equal(form.get('reqtype'), 'fileupload');
        assert.equal(form.get('fileToUpload').name, 'model.glb');
        return { data: 'https://files.catbox.moe/model.glb' };
    });
    let message;
    await deliverFile({ async finish(payload) { message = payload; } }, { attachmentSizeLimit: 1 }, Buffer.from('glb'), 'model.glb', 'Download');
    assert.equal(message.files, undefined);
    assert.match(message.content, /https:\/\/files.catbox.moe\/model.glb/);
});

test('all four Discord command schemas serialize with required inputs first', () => {
    for (const name of ['wd_img2model', 'wd_txt2vid', 'wd_img2vid', 'wd_vid_upscale']) {
        const data = require(`../commands/${name}`).data.toJSON();
        let optional = false;
        for (const option of data.options) { if (!option.required) optional = true; else assert.equal(optional, false); }
    }
});
