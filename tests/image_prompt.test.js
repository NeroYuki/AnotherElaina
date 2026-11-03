'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sharp = require('sharp');
const { enrichImagePrompts, normalizeImagePromptSettings, resolveImagePromptStyle } = require('../utils/image_prompt');
const { enrichVideoPrompt, QUALITIES } = require('../utils/video_prompt');
const { videoShape } = require('../utils/comfy_media');
const { parse_common_setting } = require('../utils/common_helper');

const PROMPT = '  mysteryTriggerPhrase, <lora:{dynamic_lora}:0.75>, <lora:plain:0.5>, __wildcard__, {red|blue}, [foo:bar:0.5], (smile:1.2), BREAK\nSECOND line  ';
const VIDEO_SCRIPT = {
    integrated_multimodal_description: '[Shot 1] A blue bird turns its head. The camera holds a static shot.',
    overall_soundscape: 'Leaves rustle and the bird chirps.',
    non_diegetic_music: 'N/A',
};

function fakeBackend(quality, { response = ['compatible detail'], finishReason = 'stop', wrongInstance = false,
    busy = false, statusMissing = false } = {}) {
    const profile = QUALITIES[quality];
    const events = [];
    const requests = [];
    let loaded = false;
    return { events, requests, fetchImpl: async (url, options) => {
        assert.equal(options.headers['X-AI-Service'], 'unsloth');
        assert.equal(options.headers['X-AI-Instance'], profile.instanceId);
        if (url.endsWith('/v1/chat/completions')) {
            events.push('generate');
            loaded = true;
            const body = JSON.parse(options.body);
            const workload = JSON.parse(Buffer.from(options.headers['X-AI-Workload'], 'base64url'));
            requests.push({ body, workload });
            assert.equal(body.model, profile.model);
            assert.equal(body.chat_template_kwargs.enable_thinking, false);
            assert.equal(workload.model.quantization, profile.quantization);
            const text = typeof response === 'function' ? response(body) : typeof response === 'string'
                ? response : JSON.stringify({ additions: response });
            return Response.json({ choices: [{ message: { content: text }, finish_reason: finishReason }] },
                { headers: { 'X-AI-Instance': wrongInstance ? 'unsloth-gpu9' : profile.instanceId } });
        }
        if (url.endsWith('/api/inference/status')) {
            events.push(loaded ? 'status-loaded' : 'status-empty');
            if (statusMissing) return Response.json({});
            return Response.json({ active_model: loaded ? profile.model : null, loaded: loaded ? [profile.model] : [], loading: [] });
        }
        assert.ok(url.endsWith('/api/inference/unload'));
        events.push('unload');
        if (busy) return new Response('Another chat is generating', { status: 409 });
        assert.deepEqual(JSON.parse(options.body), { model_path: profile.model, force_cancel_active: false });
        loaded = false;
        return Response.json({ status: 'unloaded' });
    } };
}

function imageArgs(overrides = {}) {
    return {
        prompt: PROMPT,
        model: 'pastelmix.safetensors',
        settings: { image_prompt_quality: 'standard', image_prompt_batch: 'all', image_prompt_style: 'tags' },
        ...overrides,
    };
}

test('off is a byte-exact no-op that bypasses providers, codecs, status and progress', async () => {
    const settings = {
        image_prompt_quality: 'off', image_prompt_batch: 'each', image_prompt_style: 'auto',
    };
    const result = await enrichImagePrompts({
        prompt: PROMPT, model: 'pastelmix.safetensors', count: 5, settings,
        images: [Buffer.from('not actually an image')], onProgress() { assert.fail('No progress expected'); },
    }, {
        fetchImpl() { assert.fail('No LLM request expected'); },
        provider: { generate() { assert.fail('No provider expected'); } },
    });
    assert.deepEqual(result, { prompts: [PROMPT], perImage: false, style: 'tags', quality: 'off' });
    assert.deepEqual(settings, {
        image_prompt_quality: 'off', image_prompt_batch: 'each', image_prompt_style: 'auto',
    });
});

test('all batch makes one request for one shared addition and keeps the immutable prefix', async () => {
    const backend = fakeBackend('standard', { response: ['soft window light, shallow depth of field'] });
    const settings = { image_prompt_quality: 'standard', image_prompt_batch: 'all', image_prompt_style: 'natural' };
    const progress = [];
    const result = await enrichImagePrompts({
        prompt: PROMPT, model: 'flux1-dev-Q8_0.gguf', count: 9, settings, workflow: 'edit',
        onProgress: message => progress.push(message),
    }, backend);

    assert.deepEqual(backend.events, ['generate', 'status-loaded', 'unload', 'status-empty']);
    assert.equal(result.perImage, false);
    assert.equal(result.style, 'natural');
    assert.equal(result.quality, 'standard');
    assert.deepEqual(result.prompts, [`${PROMPT}\nsoft window light, shallow depth of field`]);
    assert.equal(result.prompts[0].slice(0, PROMPT.length), PROMPT);
    assert.equal(progress.length, 2);

    const { body, workload } = backend.requests[0];
    assert.equal(workload.features.vision, false);
    const context = body.messages[1].content[0].text;
    assert.match(context, /Workflow: edit/);
    assert.match(context, /Model: flux1-dev-Q8_0\.gguf/);
    assert.match(context, /Output style: natural/);
    assert.match(context, /Requested additions: 1 \(one shared addition for the whole batch\)/);
    const schema = body.response_format.json_schema.schema;
    assert.deepEqual(Object.keys(schema.properties), ['additions']);
    assert.equal(schema.properties.additions.minItems, 1);
    assert.equal(schema.properties.additions.maxItems, 1);
});

test('each batch requests exactly count variants in one call and returns count prefixed prompts', async () => {
    const backend = fakeBackend('high', { response: ['red scarf, winter street', 'blue scarf, rainy alley', 'green scarf, sunlit park'] });
    const settings = { image_prompt_quality: 'high', image_prompt_batch: 'each', image_prompt_style: 'tags' };
    const result = await enrichImagePrompts({
        prompt: PROMPT, model: 'pastelmix.safetensors', count: 3, settings, workflow: 'inpaint',
    }, backend);

    assert.equal(backend.events.filter(event => event === 'generate').length, 1);
    assert.deepEqual(backend.events, ['generate', 'status-loaded', 'unload', 'status-empty']);
    assert.equal(result.perImage, true);
    assert.equal(result.style, 'tags');
    assert.equal(result.quality, 'high');
    assert.equal(result.prompts.length, 3);
    assert.deepEqual(result.prompts, [
        `${PROMPT}, red scarf, winter street`,
        `${PROMPT}, blue scarf, rainy alley`,
        `${PROMPT}, green scarf, sunlit park`,
    ]);
    for (const prompt of result.prompts) assert.equal(prompt.slice(0, PROMPT.length), PROMPT);

    const { body } = backend.requests[0];
    assert.match(body.messages[1].content[0].text, /Requested additions: 3 \(one independent addition per generated image\)/);
    const schemaText = body.response_format
        ? JSON.stringify(body.response_format.json_schema.schema) : body.messages[0].content;
    assert.match(schemaText, /"minItems":3/);
    assert.match(schemaText, /"maxItems":3/);

    const single = fakeBackend('high', { response: ['only variant'] });
    const countOne = await enrichImagePrompts({
        prompt: PROMPT, model: 'pastelmix.safetensors', count: 1, settings,
    }, single);
    assert.equal(countOne.perImage, true);
    assert.deepEqual(countOne.prompts, [`${PROMPT}, only variant`]);
    assert.equal(single.events.filter(event => event === 'generate').length, 1);
});

test('auto and explicit styles use canonical families, archived basenames, and inpaint mappings', () => {
    for (const model of ['pastelmix.safetensors', 'animaginexl_v31.safetensors', 'anima-aesthetic-v1_1.safetensors']) {
        assert.equal(resolveImagePromptStyle(model, 'auto'), 'tags', model);
    }
    for (const model of ['flux1-dev-Q8_0.gguf', 'mystery-model.safetensors', null]) {
        assert.equal(resolveImagePromptStyle(model, 'auto'), 'natural', String(model));
    }
    assert.equal(resolveImagePromptStyle('meinamix_v11.safetensors', 'auto'), 'tags');
    assert.equal(resolveImagePromptStyle('juggernautxl_inpaint.safetensors', 'auto'), 'tags');
    assert.equal(resolveImagePromptStyle('pastelmix.safetensors', 'natural'), 'natural');
    assert.equal(resolveImagePromptStyle('flux1-dev-Q8_0.gguf', 'tags'), 'tags');
    assert.equal(resolveImagePromptStyle('pastelmix.safetensors', 'unknown'), 'tags');
    assert.equal(resolveImagePromptStyle('anima-aesthetic-v1_1.safetensors', 'auto', 'ref2img'), 'natural');
    assert.equal(resolveImagePromptStyle('anima-aesthetic-v1_1.safetensors', 'auto', 'inpaint'), 'tags');
    assert.equal(resolveImagePromptStyle('anima-aesthetic-v1_1.safetensors', 'tags', 'ref2img'), 'tags');

    assert.deepEqual(normalizeImagePromptSettings(null), { quality: 'off', batch: 'all', style: 'auto' });
    assert.deepEqual(normalizeImagePromptSettings({
        image_prompt_quality: 'high', image_prompt_batch: 'each', image_prompt_style: 'natural',
    }), { quality: 'high', batch: 'each', style: 'natural' });
    assert.deepEqual(normalizeImagePromptSettings({
        image_prompt_quality: 'bogus', image_prompt_batch: 'bogus', image_prompt_style: 'bogus',
    }), { quality: 'off', batch: 'all', style: 'auto' });
});

test('instruction editing uses natural additions in auto style while retaining explicit tag override', async () => {
    for (const requested of ['auto', 'tags']) {
        const backend = fakeBackend('standard', { response: ['Soft studio lighting.'] });
        const result = await enrichImagePrompts({
            prompt: PROMPT, model: 'anima-aesthetic-v1_1.safetensors', workflow: 'ref2img',
            settings: { image_prompt_quality: 'standard', image_prompt_style: requested },
        }, backend);
        assert.equal(result.style, requested === 'auto' ? 'natural' : 'tags');
        assert.match(backend.requests[0].body.messages[1].content[0].text, /Preserve the existing image content and layout/);
        assert.ok(result.prompts[0].startsWith(PROMPT));
    }
});

test('standard and high route their exact model profiles and bounded previews', async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'blue' } }).png().toBuffer();
    for (const quality of ['standard', 'high']) {
        const backend = fakeBackend(quality, { response: ['compatible detail'] });
        const result = await enrichImagePrompts({
            prompt: 'A lighthouse.', model: 'flux1-dev-Q8_0.gguf', images: quality === 'high' ? [png] : [],
            settings: { image_prompt_quality: quality, image_prompt_batch: 'all', image_prompt_style: 'natural' },
        }, backend);
        assert.equal(result.quality, quality);
        assert.equal(backend.requests[0].workload.features.vision, quality === 'high');
        const parts = backend.requests[0].body.messages[1].content;
        const previews = parts.filter(part => part.type === 'image_url');
        assert.equal(previews.length, quality === 'high' ? 1 : 0);
        if (quality === 'high') assert.match(previews[0].image_url.url, /^data:image\/jpeg;base64,/);
    }

    const tooMany = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer();
    await assert.rejects(enrichImagePrompts({
        prompt: 'A lighthouse.', model: 'flux1-dev-Q8_0.gguf', images: Array(5).fill(tooMany),
        settings: { image_prompt_quality: 'high' },
    }, { fetchImpl() { assert.fail('Validation must happen before any request'); } }), /at most 4 reference images/);
});

test('invalid enhancer output is rejected after verified unload with actionable errors', async () => {
    const args = imageArgs({
        prompt: 'A lighthouse.', count: 2,
        settings: { image_prompt_quality: 'standard', image_prompt_batch: 'each', image_prompt_style: 'tags' },
    });
    const cases = [
        [['ok', '<lora:extra:1>'], {}, /forbidden adapter or angle-bracket syntax/],
        [['ok', '__wildcard__'], {}, /forbidden wildcard syntax/],
        [['ok', '__folder/some_lora_name__'], {}, /forbidden wildcard syntax/],
        [['ok', '%%profile%%'], {}, /forbidden prompt-profile syntax/],
        [['ok', '{red|blue}'], {}, /forbidden choice syntax/],
        [['ok', '[rain:0.5]'], {}, /forbidden scheduled or weighted bracket syntax/],
        [['ok', '(smile:1.2)'], {}, /forbidden numeric weight syntax/],
        [['ok', 'BREAK'], {}, /forbidden control directive/],
        [['ok', 'AND'], {}, /forbidden control directive/],
        ['not json', {}, /invalid JSON/],
        [() => JSON.stringify({ additions: ['only one'] }), {}, /expected exactly 2/],
        [['ok', ''], {}, /empty addition/],
        [['ok', 'x'.repeat(1001)], {}, /longer than 1000 characters/],
        [() => JSON.stringify({ additions: ['ok', 'extra'], extra: true }), {}, /exactly one additions array/],
        [['ok', 'cut off'], { finishReason: 'length' }, /truncated/],
    ];
    for (const [response, options, reason] of cases) {
        const backend = fakeBackend('standard', { response, ...options });
        await assert.rejects(enrichImagePrompts(args, backend), reason);
        assert.equal(backend.events.filter(event => event === 'generate').length, 1);
        assert.ok(backend.events.includes('unload'), String(reason));
    }

    const wrongInstance = fakeBackend('standard', { response: ['ok', 'detail'], wrongInstance: true });
    await assert.rejects(enrichImagePrompts(args, wrongInstance), /X-AI-Instance routing/);
    assert.ok(wrongInstance.events.includes('unload'));

    const followUp = fakeBackend('standard', { response: ['works', 'again'] });
    const result = await enrichImagePrompts(args, followUp);
    assert.equal(result.prompts.length, 2);
});

test('each batch rejects non-integer or out-of-range counts before inference', async () => {
    for (const count of [0, 17, 1.5, '3', -1]) {
        await assert.rejects(enrichImagePrompts(imageArgs({
            prompt: 'A lighthouse.', count,
            settings: { image_prompt_quality: 'standard', image_prompt_batch: 'each', image_prompt_style: 'tags' },
        }), { fetchImpl() { assert.fail('Validation must happen before any request'); } }), /integer count from 1 to 16/);
    }
});

test('request and verified-unload failures block generation without poisoning the shared queue', async () => {
    const args = imageArgs({ prompt: 'A lighthouse.' });

    const busy = fakeBackend('standard', { response: ['detail'], busy: true });
    await assert.rejects(enrichImagePrompts(args, busy), /not started.*HTTP 409/);
    assert.ok(busy.events.includes('unload'));

    const missingStatus = fakeBackend('standard', { response: ['detail'], statusMissing: true });
    await assert.rejects(enrichImagePrompts(args, missingStatus), /not started.*loaded and loading models/);
    assert.deepEqual(missingStatus.events, ['generate', 'status-loaded']);

    const providerFailure = fakeBackend('standard');
    await assert.rejects(enrichImagePrompts(args, {
        ...providerFailure,
        provider: { async generate() { throw new Error('inference failed'); } },
    }), /inference failed/);
    assert.deepEqual(providerFailure.events, ['status-empty']);

    const followUp = fakeBackend('standard', { response: ['detail after failure'] });
    const result = await enrichImagePrompts(args, followUp);
    assert.deepEqual(result.prompts, [`${args.prompt}, detail after failure`]);
    assert.deepEqual(followUp.events, ['generate', 'status-loaded', 'unload', 'status-empty']);
});

test('image and video enrichment serialize through one shared unload queue', async () => {
    const imageBackend = fakeBackend('standard', { response: ['image detail'] });
    const videoBackend = fakeBackend('standard', { response: JSON.stringify(VIDEO_SCRIPT) });
    const events = [];
    let active = false;
    const wrap = (label, backend) => async (url, options) => {
        if (url.endsWith('/v1/chat/completions')) {
            assert.equal(active, false, 'inference must not overlap');
            active = true;
            events.push(`${label}-generate`);
        }
        const response = await backend.fetchImpl(url, options);
        if (url.endsWith('/api/inference/unload')) {
            active = false;
            events.push(`${label}-unload`);
        }
        return response;
    };

    await Promise.all([
        enrichImagePrompts(imageArgs({ prompt: 'A lighthouse.' }), { fetchImpl: wrap('image', imageBackend) }),
        enrichVideoPrompt({ prompt: 'A blue bird turns.', shape: videoShape(768, 448), requestedSeconds: 5 },
            { fetchImpl: wrap('video', videoBackend) }),
    ]);
    assert.deepEqual(events, ['image-generate', 'image-unload', 'video-generate', 'video-unload']);
});

test('minor-form model families fall back to natural style without touching the prefix', async () => {
    const backend = fakeBackend('standard', { response: ['golden hour rim light', 'golden hour rim light'] });
    const result = await enrichImagePrompts({
        prompt: PROMPT, model: 'flux1-dev-Q8_0.gguf', count: 2,
        settings: { image_prompt_quality: 'standard', image_prompt_batch: 'each', image_prompt_style: 'auto' },
    }, backend);
    assert.equal(result.style, 'natural');
    assert.deepEqual(result.prompts, [`${PROMPT}\ngolden hour rim light`, `${PROMPT}\ngolden hour rim light`]);
    for (const prompt of result.prompts) assert.equal(prompt.slice(0, PROMPT.length), PROMPT);
});

function loadSettingCommand() {
    const originalLoad = Module._load;
    const configStub = {
        byPassUser: 'test', censorGuildIds: [], optOutGuildIds: [],
        clientId: 'test', guildIds: [],
    };
    const databaseStub = {
        addRecord() {}, queryRecord() {}, queryRecordLimit() {}, editRecords() {}, removeRecords() {},
    };
    Module._load = function (request, parent, isMain) {
        if (request === '../config.json' || request === '../../config.json') return configStub;
        if (request === 'dotenv') return { config() {} };
        if (String(request).includes('database_interaction')) return databaseStub;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const resolved = require.resolve('../commands/wd_setting');
        delete require.cache[resolved];
        return require(resolved);
    } finally {
        Module._load = originalLoad;
    }
}

test('wd_setting exposes bounded enhancer options and persists them through common parsing', async () => {
    const command = loadSettingCommand();
    const serialized = command.data.toJSON();
    const set = serialized.options.find(option => option.name === 'set');
    assert.ok(set.options.length <= 25);
    for (const option of set.options) {
        if (option.choices) assert.ok(option.choices.length <= 25, option.name);
    }
    const enhancers = Object.fromEntries(set.options
        .filter(option => option.name.startsWith('image_prompt_'))
        .map(option => [option.name, option.choices.map(choice => choice.value)]));
    assert.deepEqual(enhancers, {
        image_prompt_quality: ['off', 'standard', 'high'],
        image_prompt_batch: ['all', 'each'],
        image_prompt_style: ['auto', 'tags', 'natural'],
        image_prompt_layout: ['off', 'auto', 'moss', 'coupler'],
    });
    assert.ok(set.options.some(option => option.name === 'hires_checkpoint'));
    assert.ok(set.options.some(option => option.name === 'seedvr2_resolution'));

    const stored = new Map();
    const client = { usersetting_config: stored };
    const values = {
        image_prompt_quality: 'high', image_prompt_batch: 'each', image_prompt_style: 'natural',
        image_prompt_layout: 'auto',
    };
    const interaction = {
        user: { id: 'user-1' },
        options: {
            getSubcommand: () => 'set',
            getString: key => values[key] ?? null,
            getBoolean: () => null,
            getNumber: () => null,
            getInteger: () => null,
        },
        async deferReply() {},
        async editReply() {},
    };
    await command.execute(interaction, client);
    const config = JSON.parse(stored.get('user-1'));
    assert.equal(config.image_prompt_quality, 'high');
    assert.equal(config.image_prompt_batch, 'each');
    assert.equal(config.image_prompt_style, 'natural');
    assert.equal(config.image_prompt_layout, 'auto');
    const parsed = parse_common_setting(stored.get('user-1'));
    assert.equal(parsed.image_prompt_quality, 'high');
    assert.equal(parsed.image_prompt_batch, 'each');
    assert.equal(parsed.image_prompt_style, 'natural');
    assert.equal(parsed.image_prompt_layout, 'auto');
    assert.equal(parsed.do_preview, true);
    assert.equal(parsed.hires_checkpoint, 'Use same checkpoint');

    const emptyInteraction = {
        user: { id: 'user-1' },
        options: {
            getSubcommand: () => 'set',
            getString: () => null,
            getBoolean: () => null,
            getNumber: () => null,
            getInteger: () => null,
        },
        async deferReply() {},
        async editReply() {},
    };
    await command.execute(emptyInteraction, client);
    const defaults = parse_common_setting(stored.get('user-1'));
    assert.equal(defaults.image_prompt_quality, 'off');
    assert.equal(defaults.image_prompt_batch, 'all');
    assert.equal(defaults.image_prompt_style, 'auto');
    assert.equal(defaults.image_prompt_layout, 'off');
    assert.equal(parse_common_setting(null).image_prompt_quality, 'off');
    assert.equal(parse_common_setting(null).image_prompt_batch, 'all');
    assert.equal(parse_common_setting(null).image_prompt_style, 'auto');
    assert.equal(parse_common_setting(null).image_prompt_layout, 'off');
});
