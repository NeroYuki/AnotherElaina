const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichVideoPrompt, scriptPrompt, QUALITIES } = require('../utils/video_prompt');
const { videoShape } = require('../utils/comfy_media');

const script = {
    integrated_multimodal_description: '[Shot 1] Cinematic, a blue bird turns its head. The camera holds a static shot.',
    overall_soundscape: 'Leaves rustle and the bird chirps.',
    non_diegetic_music: 'N/A',
};

function fakeBackend(quality, { busy = false, malformed = false, wrongInstance = false } = {}) {
    const profile = QUALITIES[quality];
    const events = [];
    let loaded = false;
    return { events, fetchImpl: async (url, options) => {
        assert.equal(options.headers['X-AI-Service'], 'unsloth');
        assert.equal(options.headers['X-AI-Instance'], profile.instanceId);
        if (url.endsWith('/v1/chat/completions')) {
            events.push('generate');
            loaded = true;
            const body = JSON.parse(options.body);
            assert.equal(body.model, profile.model);
            assert.equal(body.chat_template_kwargs.enable_thinking, false);
            const workload = JSON.parse(Buffer.from(options.headers['X-AI-Workload'], 'base64url'));
            assert.equal(workload.model.quantization, profile.quantization);
            assert.equal(workload.features.vision, quality === 'high');
            assert.match(body.messages[1].content[0].text, /Requested duration: 5 seconds.*Effective playback duration: 5.17 seconds/);
            if (quality === 'high') {
                const images = body.messages[1].content.filter(part => part.type === 'image_url');
                assert.equal(images.length, 2);
                assert.match(images[1].image_url.url, /^data:image\/jpeg;base64,/);
            }
            return Response.json({ choices: [{ message: { content: malformed ? '{}' : JSON.stringify(script) }, finish_reason: 'stop' }] },
                { headers: { 'X-AI-Instance': wrongInstance ? 'unsloth-gpu9' : profile.instanceId } });
        }
        if (url.endsWith('/api/inference/status')) {
            events.push(loaded ? 'status-loaded' : 'status-empty');
            return Response.json({ active_model: loaded ? profile.model : null, loaded: loaded ? [profile.model] : [], loading: [] });
        }
        assert.ok(url.endsWith('/api/inference/unload'));
        events.push('unload');
        assert.deepEqual(JSON.parse(options.body), { model_path: profile.model, force_cancel_active: false });
        if (busy) return new Response('Another chat is generating', { status: 409 });
        loaded = false;
        return Response.json({ status: 'unloaded' });
    } };
}

test('standard and high route exact model variants and await verified unload, with both image anchors', async () => {
    for (const quality of ['standard', 'high']) {
        const backend = fakeBackend(quality);
        const result = await enrichVideoPrompt({ prompt: 'A blue bird turns.', shape: videoShape(768, 448),
            requestedSeconds: 5, quality, images: quality === 'high' ? [Buffer.from('first'), Buffer.from('last')] : [] }, backend);
        assert.deepEqual(backend.events, ['generate', 'status-loaded', 'unload', 'status-empty']);
        assert.match(result, /integrated_multimodal_description: \[Shot 1\]/);
        if (quality === 'high') assert.match(result, /^How the reference pictures align.*Picture 2 \(from Shot 1\).*5.17-second/);
        else assert.ok(result.startsWith('integrated_multimodal_description:'));
    }
});

test('LLM errors still unload; unload refusal and unsupported routing prevent workflow submission', async () => {
    const args = { prompt: 'A blue bird turns.', shape: videoShape(768, 448), requestedSeconds: 5 };
    for (const [settings, reason] of [[{ malformed: true }, /three audiovisual fields/],
        [{ busy: true }, /not started.*HTTP 409/], [{ wrongInstance: true }, /X-AI-Instance routing/]]) {
        const backend = fakeBackend('standard', settings);
        await assert.rejects(enrichVideoPrompt(args, backend), reason);
        assert.ok(backend.events.includes('unload'));
    }
    const backend = fakeBackend('standard');
    await assert.rejects(enrichVideoPrompt(args, { ...backend, provider: { async generate() { throw new Error('inference failed'); } } }), /inference failed/);
    assert.deepEqual(backend.events, ['status-empty']);
});

test('script validation enforces sequential cuts inside the duration and builds opening alignment', () => {
    assert.match(scriptPrompt(JSON.stringify(script), 5.17, 1), /^For the target video, at 0.00 seconds.*\n\nintegrated_/);
    const description = '[Shot 1] A bird lands. [Shot 2] At 00:03.500, the camera cuts to its face.';
    assert.match(scriptPrompt(JSON.stringify({ ...script, integrated_multimodal_description: description }), 5.17, 2), /Picture 2 \(from Shot 2\)/);
    for (const invalid of [description.replace('03.500', '06.000'), description.replace('Shot 2', 'Shot 3'),
        description.replace('At 00:03.500,', ''), description.replace('A bird lands.', 'At 00:00.000, A bird lands.')]) {
        assert.throws(() => scriptPrompt(JSON.stringify({ ...script, integrated_multimodal_description: invalid }), 5.17, 0));
    }
});

test('off bypasses all LLM calls and preserves an already written prompt verbatim', async () => {
    const prompt = 'My exact prompt.\n\nMusic: none.';
    assert.equal(await enrichVideoPrompt({ prompt, quality: 'off' }, { fetchImpl() { assert.fail('No LLM request expected'); } }), prompt);
});

test('concurrent rewrites serialize inference through unload', async () => {
    const events = [];
    let active = false;
    const args = { prompt: 'A blue bird turns.', shape: videoShape(768, 448), requestedSeconds: 5 };
    const backend = fakeBackend('standard');
    const fetchImpl = async (...request) => {
        if (request[0].endsWith('/v1/chat/completions')) {
            assert.equal(active, false);
            active = true;
            events.push('generate');
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        const response = await backend.fetchImpl(...request);
        if (request[0].endsWith('/api/inference/unload')) { active = false; events.push('unload'); }
        return response;
    };
    await Promise.all([enrichVideoPrompt(args, { fetchImpl }), enrichVideoPrompt(args, { fetchImpl })]);
    assert.deepEqual(events, ['generate', 'unload', 'generate', 'unload']);
});

test('unload acknowledgement waits for empty status; missing status fields block generation', async () => {
    const args = { prompt: 'A blue bird turns.', shape: videoShape(768, 448), requestedSeconds: 5 };
    const backend = fakeBackend('standard');
    let acknowledged = false, lag = 2, polls = 0;
    await enrichVideoPrompt(args, { async fetchImpl(url, options) {
        const response = await backend.fetchImpl(url, options);
        if (url.endsWith('/api/inference/unload')) acknowledged = true;
        if (acknowledged && url.endsWith('/api/inference/status') && lag-- > 0) {
            return Response.json({ loaded: [QUALITIES.standard.model], loading: [] });
        }
        return response;
    }, async sleepImpl() { polls++; } });
    assert.equal(polls, 2);
    const malformedBackend = fakeBackend('standard');
    await assert.rejects(enrichVideoPrompt(args, { async fetchImpl(url, options) {
        if (url.endsWith('/api/inference/status')) return Response.json({});
        return malformedBackend.fetchImpl(url, options);
    } }), /not started.*loaded and loading models/);
});

test('both Discord commands pass duration and references into enrichment before building the workflow', async t => {
    const prompts = require('../utils/video_prompt');
    const media = require('../utils/comfy_media');
    const comfy = require('../utils/comfy_client');
    const loader = require('../utils/load_discord_img');
    const sharp = require('sharp');
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'blue' } }).png().toBuffer();
    const enriched = 'Enriched prompt, ready after unload.';
    const args = [];
    let reject = false, submissions = 0;
    t.mock.method(prompts, 'enrichVideoPrompt', async options => {
        args.push(options);
        if (reject) throw new Error('unload refused');
        return enriched;
    });
    t.mock.method(loader, 'loadImage', async () => png);
    t.mock.method(comfy, 'uploadImage', async () => ({ name: 'image.png' }));
    t.mock.method(media, 'runVideo', async (_interaction, workflow) => {
        submissions++;
        assert.equal(workflow['105:104'].inputs.prompt, enriched);
    });
    for (const name of ['wd_txt2vid', 'wd_img2vid']) {
        const commandPath = require.resolve(`../commands/${name}`);
        delete require.cache[commandPath];
        const command = require(commandPath);
        const messages = [];
        const interaction = { async deferReply() {}, async editReply(payload) { messages.push(payload.content); }, options: {
            getString: key => ({ prompt: 'Original idea', prompt_quality: 'high', preset: name === 'wd_txt2vid' ? 'custom' : 'std' })[key] ?? null,
            getInteger: key => ['custom_length', 'length'].includes(key) ? 10 : null,
            getBoolean: () => null, getNumber: () => null,
            getAttachment: () => ({ url: 'https://example.com/image.png' }),
        } };
        reject = false;
        await command.execute(interaction);
        const options = args.at(-1);
        assert.equal(options.requestedSeconds, 10);
        assert.equal(options.shape.seconds, videoShape(768, 448, 10).seconds);
        assert.equal(options.quality, 'high');
        assert.equal(options.prompt, 'Original idea');
        if (name === 'wd_img2vid') assert.equal(options.images.length, 2);
        const before = submissions;
        reject = true;
        await command.execute(interaction);
        assert.equal(submissions, before);
        assert.match(messages.at(-1), /Video failed: unload refused/);
        delete require.cache[commandPath];
    }
    assert.equal(submissions, 2);
});
