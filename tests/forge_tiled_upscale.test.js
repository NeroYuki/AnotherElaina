const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const sharp = require('sharp');

const config = require('../utils/ai_server_config');
const {
    TILED_UPSCALE_SCRIPT,
    LEGACY_UPSCALE_SCRIPT,
    MAX_TARGET_DIMENSION,
    is_tiled_upscale_script,
    normalize_extra_script,
    normalize_upscale_config,
    prepare_tiled_upscale,
} = require('../utils/forge_img2img_scripts');

const MODEL = 'wai_nsfw_illustrious_v120.safetensors';

const base_img = (overrides = {}) => config.get_data_body_img2img(
    0,
    overrides.prompt ?? 'prompt',
    overrides.neg_prompt ?? 'negative',
    overrides.sampling_step ?? 20,
    overrides.cfg_scale ?? 7,
    overrides.seed ?? 1,
    'Euler',
    'Automatic',
    'session',
    overrides.height ?? 1024,
    overrides.width ?? 1024,
    overrides.attachment ?? 'data:image/png;base64,AAAA',
    null,
    overrides.denoising_strength ?? 0.5,
    overrides.mode ?? 0,
    4,
    'original',
    overrides.upscaler ?? 'None',
    overrides.is_using_adetailer ?? false,
    overrides.coupler_config ?? null,
    null,
    overrides.clip_skip ?? 2,
    overrides.enable_censor ?? false,
    overrides.freeu_config ?? null,
    overrides.dynamic_threshold_config ?? null,
    overrides.pag_config ?? null,
    overrides.inpaint_area ?? 'Whole picture',
    overrides.mask_padding ?? 32,
    false,
    false,
    null,
    overrides.current_model ?? MODEL,
    null,
    null,
    overrides.colorbalance_config ?? null,
    overrides.usersetting ?? null,
    null,
    overrides.upscale_config ?? null,
    overrides.extra_script ?? 'None',
    overrides.detail_daemon_config ?? null,
    null,
    overrides.latentmod_config ?? null,
    overrides.mahiro_config ?? null,
    overrides.teacache_config ?? null,
    null,
    overrides.daam_config ?? null,
);

test('tiled-upscale config normalizes defaults, legacy fields, and zero values', () => {
    assert.deepEqual(normalize_upscale_config(null), {
        scale: 2,
        method: 'Mixture of Diffusers',
        tile_width: 1024,
        tile_height: 1024,
        tile_overlap: 128,
        tile_batch_size: 1,
    });

    const legacy_raw = {
        scale: 3,
        tile_width: 1000,
        tile_height: 0,
        padding: 48,
        upscaler: 'R-ESRGAN 4x+',
        seam_fix: 'Band pass',
        seam_fix_denoise: 0.4,
        tile_pattern: 'Chess',
    };
    const legacy_copy = JSON.parse(JSON.stringify(legacy_raw));
    const legacy = normalize_upscale_config(legacy_raw);
    assert.equal(legacy.scale, 3);
    assert.equal(legacy.tile_width, 1024);       // snapped to 64px
    assert.equal(legacy.tile_height, 1024);      // legacy 0 means same as width
    assert.equal(legacy.tile_overlap, 96);       // legacy padding -> 2 * padding
    assert.equal(legacy.tile_batch_size, 1);
    assert.equal(legacy.upscaler, undefined);
    assert.equal(legacy.seam_fix, undefined);
    assert.deepEqual(legacy_raw, legacy_copy, 'normalization must not mutate the stored object');

    assert.equal(normalize_upscale_config({ tile_overlap: 0 }).tile_overlap, 0);
    assert.equal(normalize_upscale_config({ tile_height: 0, tile_width: 512 }).tile_height, 512);
    assert.equal(normalize_upscale_config('{"scale":1,"method":"MultiDiffusion"}').method, 'MultiDiffusion');

    assert.throws(() => normalize_upscale_config('{not json'), /valid JSON/);
    assert.throws(() => normalize_upscale_config({ scale: 'nope' }), /finite number/);
    assert.throws(() => normalize_upscale_config({ tile_width: NaN }), /finite number/);
    assert.throws(() => normalize_upscale_config({ method: 'Unknown' }), /Mixture of Diffusers/);
    assert.throws(
        () => normalize_upscale_config({ tile_width: 512, tile_height: 512, tile_overlap: 512 }),
        /smaller than both tile dimensions/,
    );
});

test('tiled-upscale preparation accounts for scale and rejects unsupported families before submission', () => {
    const prepared = prepare_tiled_upscale({
        model: MODEL,
        width: 512,
        height: 768,
        config: { scale: 2, tile_width: 512, tile_height: 0, tile_overlap: 128 },
    });
    assert.equal(prepared.width, 1024);
    assert.equal(prepared.height, 1536);
    assert.equal(prepared.family, 'xl');
    assert.equal(prepared.config.tile_height, 512);

    const refinement = prepare_tiled_upscale({
        model: MODEL,
        width: 517,
        height: 513,
        config: { scale: 1 },
    });
    assert.equal(refinement.width, 520);
    assert.equal(refinement.height, 520);

    const inpaint = prepare_tiled_upscale({
        model: 'archive\\realvisxl_v3_inpaint.safetensors',
        width: 512,
        height: 512,
        config: { scale: 2 },
    });
    assert.equal(inpaint.family, 'xl');

    assert.throws(
        () => prepare_tiled_upscale({ model: 'flux1-dev-Q8_0.gguf', width: 512, height: 512, config: {} }),
        /SD1\/SDXL checkpoints only/,
    );
    assert.throws(
        () => prepare_tiled_upscale({ model: 'unknown.safetensors', width: 512, height: 512, config: {} }),
        /SD1\/SDXL checkpoints only/,
    );
    assert.throws(
        () => prepare_tiled_upscale({
            model: MODEL,
            width: MAX_TARGET_DIMENSION,
            height: 512,
            config: { scale: 4 },
        }),
        /exceeds the 8192px limit/,
    );
});

test('tiled-upscale script aliases normalize without reaching Forge', () => {
    assert.equal(is_tiled_upscale_script(TILED_UPSCALE_SCRIPT), true);
    assert.equal(is_tiled_upscale_script(LEGACY_UPSCALE_SCRIPT), true);
    assert.equal(is_tiled_upscale_script('Outpainting mk2'), false);
    assert.equal(normalize_extra_script(LEGACY_UPSCALE_SCRIPT), TILED_UPSCALE_SCRIPT);
    assert.equal(normalize_extra_script('Outpainting mk2'), 'Native Outpaint');
});

test('img2img payload uses exact tiled-upscale Gradio positions and leaves ordinary payload unchanged', () => {
    const ordinary = base_img();
    assert.equal(ordinary[27], 'Crop and Resize');
    assert.equal(ordinary[40], 'None');
    assert.equal(ordinary[235], false);
    assert.equal(ordinary[236], 'MultiDiffusion');
    assert.equal(ordinary[237], 768);
    assert.equal(ordinary[238], 768);
    assert.equal(ordinary[239], 64);
    assert.equal(ordinary[240], 4);
    assert.equal(ordinary[242], false);

    const ordinary_with_stored_config = base_img({
        extra_script: 'None',
        upscale_config: '{"scale":4,"tile_width":512,"tile_overlap":0}',
    });
    assert.equal(ordinary_with_stored_config[27], 'Crop and Resize');
    assert.equal(ordinary_with_stored_config[40], 'None');
    assert.equal(ordinary_with_stored_config[235], false);
    assert.equal(ordinary_with_stored_config[237], 768);
    assert.equal(ordinary_with_stored_config[239], 64);
    assert.equal(ordinary_with_stored_config[242], false);

    const usersetting = { seedvr2_model: 'seedvr2_ema_7b_sharp-Q4_K_M.gguf', do_preview: false };
    const data = base_img({
        extra_script: TILED_UPSCALE_SCRIPT,
        upscale_config: {
            scale: 2,
            method: 'Mixture of Diffusers',
            tile_width: 512,
            tile_height: 512,
            tile_overlap: 128,
            tile_batch_size: 1,
        },
        usersetting,
    });

    assert.equal(data[24], 1024);
    assert.equal(data[25], 1024);
    assert.equal(data[26], 1, 'native latent upscale must not double-apply the multiplier');
    assert.equal(data[27], 'Latent Upscale');
    assert.equal(data[40], 'None', 'SeedVR2 must not be selected behind the tiled mode');
    assert.equal(data[235], true);
    assert.equal(data[236], 'Mixture of Diffusers');
    assert.equal(data[237], 512);
    assert.equal(data[238], 512);
    assert.equal(data[239], 128);
    assert.equal(data[240], 1);
    assert.equal(data[242], true);

    const legacy_alias = base_img({
        extra_script: LEGACY_UPSCALE_SCRIPT,
        upscale_config: '{"scale":1,"tile_overlap":0}',
    });
    assert.equal(legacy_alias[27], 'Latent Upscale');
    assert.equal(legacy_alias[40], 'None');
    assert.equal(legacy_alias[239], 0);
});

function find_option(options, name) {
    for (const option of options || []) {
        if (option.name === name) return option;
        const nested = find_option(option.options, name);
        if (nested) return nested;
    }
    return null;
}

function load_commands() {
    const original_load = Module._load;
    const axios_calls = [];
    const workloads = [];
    const sent = [];
    const uploads = [];

    const real_config = require('../utils/ai_server_config');
    const real_workload = require('../utils/orchestrator_workload');
    const ai_config_stub = {
        ...real_config,
        get_worker_server: () => 0,
        get_prompt: prompt => prompt,
        get_negative_prompt: neg_prompt => neg_prompt,
    };
    const workload_stub = {
        ...real_workload,
        workloadHeaders(service, workload) {
            workloads.push(workload);
            return { 'X-AI-Workload': Buffer.from(JSON.stringify(workload)).toString('base64url') };
        },
    };
    const model_change_stub = {
        cached_model: [MODEL],
        changes: [],
        model_change: async (checkpoint, force) => {
            model_change_stub.changes.push({ checkpoint, force });
            model_change_stub.cached_model[0] = checkpoint.replaceAll('\\', '/').split('/').pop();
            return true;
        },
        sync_active_model: async () => {},
    };
    const axios_stub = {
        default: {
            async post(url, body, request_config) {
                axios_calls.push({ url, body, config: request_config });
                throw new Error('captured');
            },
        },
    };
    const prompt_analyzer_stub = {
        full_prompt_analyze(prompt, neg_prompt) {
            return {
                prompt,
                neg_prompt,
                coupler_config: null,
                color_grading_config: null,
                freeu_config: null,
                dynamic_threshold_config: null,
                pag_config: null,
                detail_daemon_config: null,
                mahiro_config: null,
                teacache_config: null,
                modulation_config: null,
                tipo_input: null,
                use_booru_gen: false,
                use_foocus: false,
            };
        },
        preview_coupler_setting() {},
        async fetch_user_defined_wildcard(prompt) { return prompt; },
        get_teacache_config_from_prompt() { return { teacache_config: null }; },
        get_debug_prompt_analyze(prompt, neg_prompt) {
            return { prompt, neg_prompt, debug_prompt: null };
        },
    };

    Module._load = function (request, parent, isMain) {
        if (request === '../config.json' || request === '../../config.json') {
            return { byPassUser: [], censorGuildIds: [], optOutGuildIds: [] };
        }
        if (request === 'dotenv') return { config() {} };
        if (String(request).includes('database_interaction')) {
            return { queryRecordLimit() {} };
        }
        if (String(request).endsWith('ai_server_config.js')) return ai_config_stub;
        if (String(request).endsWith('orchestrator_workload')) return workload_stub;
        if (String(request).endsWith('proxy_config')) {
            return { PROXY_URL: 'http://proxy.test', serviceHeaders: () => ({}) };
        }
        if (String(request).endsWith('load_discord_img.js')) {
            return {
                loadImage: async () => 'data:image/png;base64,' + (await sharp({ create: { width: 512, height: 512, channels: 3, background: '#ac1832' } }).png().toBuffer()).toString('base64'),
                async uploadPngBufferToGradio(buffer) {
                    uploads.push(buffer);
                    await Promise.resolve();
                    return `/tmp/outpaint-${uploads.length}.png`;
                },
            };
        }
        if (String(request).endsWith('model_change.js')) {
            return model_change_stub;
        }
        if (String(request).endsWith('prompt_analyzer.js')) return prompt_analyzer_stub;
        if (String(request).endsWith('profile_helper.js')) return { load_profile: async () => null };
        if (String(request).endsWith('comfy_client')) return {};
        if (String(request).endsWith('controlnet_execute.js')) return { load_controlnet: async () => {} };
        if (String(request).endsWith('adetailer_execute.js')) return { load_adetailer: async () => {} };
        if (request === 'axios') return axios_stub;
        return original_load.call(this, request, parent, isMain);
    };
    try {
        const commands = path.join(__dirname, '..', 'commands');
        return {
            commands: {
                img2img: require(path.join(commands, 'wd_img2img')),
                img2img_adv: require(path.join(commands, 'wd_img2img_adv')),
                script_upscale: require(path.join(commands, 'wd_script', 'upscale')),
            },
            axios_calls,
            workloads,
            sent,
            uploads,
            model_change_stub,
        };
    }
    finally {
        Module._load = original_load;
    }
}

const loaded = load_commands();

test('both commands translate native outpaint into sequential mask uploads and final dimensions', async () => {
    const previous_model = loaded.model_change_stub.cached_model[0];
    loaded.model_change_stub.cached_model[0] = 'juggernautxl_inpaint.safetensors';
    try {
        for (const [name, command] of Object.entries({ img2img: loaded.commands.img2img, img2img_adv: loaded.commands.img2img_adv })) {
            loaded.model_change_stub.cached_model[0] = name === 'img2img' ? 'juggernautxl_turbo.safetensors' : 'juggernautxl_inpaint.safetensors';
            const id = `outpaint-${name}`;
            const client = make_client(id, null);
            client.img2img_outpaint_config.set(id, JSON.stringify({ size: 128, direction: 'LR', right: 64, mask_blur: 24 }));
            const before_calls = loaded.axios_calls.length;
            const before_uploads = loaded.uploads.length;
            const before_changes = loaded.model_change_stub.changes.length;
            await command.execute(make_interaction(id, { extra_script: name === 'img2img' ? 'Outpainting mk2' : 'Native Outpaint', denoising_strength: null }), client);
            assert.equal(loaded.axios_calls.length, before_calls + 1, name);
            assert.equal(loaded.uploads.length, before_uploads + 2, name);
            const data = loaded.axios_calls.at(-1).body.data;
            assert.equal(data[1], 4, name);
            assert.equal(data[12].path, `/tmp/outpaint-${before_uploads + 1}.png`, name);
            assert.equal(data[13].path, `/tmp/outpaint-${before_uploads + 2}.png`, name);
            assert.equal(data[14], 24, name);
            assert.equal(data[16], 'fill', name);
            assert.equal(data[22], 1, name);
            assert.equal(data[24], 512, name);
            assert.equal(data[25], 704, name);
            assert.equal(data[40], 'None', name);
            assert.equal(loaded.model_change_stub.cached_model[0], 'juggernautxl_inpaint.safetensors', name);
            assert.equal(loaded.model_change_stub.changes.length - before_changes, name === 'img2img' ? 1 : 0, name);
            if (name === 'img2img') assert.deepEqual(loaded.model_change_stub.changes.at(-1), { checkpoint: 'juggernautxl_inpaint.safetensors', force: true });
            assert.equal(loaded.workloads.at(-1).shape.width, 704, name);
            const metadata = await sharp(loaded.uploads[before_uploads]).metadata();
            assert.equal(metadata.width, 704, name);
            assert.equal(metadata.height, 512, name);
        }
    }
    finally { loaded.model_change_stub.cached_model[0] = previous_model; }
    await new Promise(resolve => setTimeout(resolve, 1100));
});

test('both img2img commands offer Tiled Latent Upscale and no retired Ultimate SD Upscale option', () => {
    for (const command of [loaded.commands.img2img, loaded.commands.img2img_adv]) {
        const option = find_option(command.data.toJSON().options, 'extra_script');
        assert.ok(option, 'extra_script option');
        const values = option.choices.map(choice => choice.value);
        assert.ok(values.includes(TILED_UPSCALE_SCRIPT), command.data.name);
        assert.equal(values.includes(LEGACY_UPSCALE_SCRIPT), false, command.data.name);
        assert.equal(values.includes('Img2Img Upscale'), false, command.data.name);
        assert.equal(values.includes('Outpainting mk2'), false, command.data.name);
        assert.ok(values.includes('Native Outpaint'), command.data.name);
        assert.ok(values.includes('Flux Outpaint'), command.data.name);
        assert.ok(values.includes('Flux Kontext'), command.data.name);
    }
});

function make_interaction(user_id, overrides = {}) {
    const values = {
        image: { proxyURL: 'https://example.test/a.png', width: 512, height: 512, name: 'a.png', contentType: 'image/png' },
        prompt: '',
        neg_prompt: '',
        denoising_strength: 0.35,
        width: 512,
        height: 512,
        seed: '-1',
        default_neg_prompt: 'n_nsfw',
        checkpoint: null,
        upscaler: 'None',
        profile: null,
        extra_script: TILED_UPSCALE_SCRIPT,
        sampler: null,
        scheduler: null,
        cfg_scale: null,
        sampling_step: null,
        clip_skip: null,
        controlnet_input: null,
        controlnet_input_2: null,
        controlnet_input_3: null,
        controlnet_config: null,
        do_adetailer: false,
        adetailer_config: null,
        force_server_selection: null,
        colorbalance_config: null,
        ...overrides,
    };
    const options = {
        getString: name => values[name] ?? null,
        getInteger: name => values[name] ?? null,
        getNumber: name => values[name] ?? null,
        getBoolean: name => values[name] ?? null,
        getAttachment: name => values[name] ?? null,
    };
    const interaction = {
        id: `interaction-${user_id}`,
        user: { id: user_id },
        guildId: null,
        options,
        channel: {
            nsfw: true,
            async send(message) { loaded.sent.push(message); },
            createMessageComponentCollector() { return { on() {}, stop() {} }; },
        },
        async deferReply() {},
        async reply(message) { loaded.sent.push(message); },
        async editReply(message) { loaded.sent.push(message); },
    };
    return interaction;
}

function make_client(user_id, upscale_config) {
    return {
        cooldowns: new Map(),
        img2img_upscale_config: new Map([[user_id, upscale_config]]),
        img2img_outpaint_config: new Map(),
        usersetting_config: new Map([[user_id, JSON.stringify({
            seedvr2_model: 'seedvr2_ema_7b_sharp-Q4_K_M.gguf',
            seedvr2_resolution: 1600,
            do_preview: false,
        })]]),
        adetailer_config: new Map(),
        booru_gen_config: new Map(),
        boorugen_config: new Map(),
        latentmod_config: new Map(),
        colorbalance_config: new Map(),
        controlnet_config: new Map(),
    };
}

test('settings command persists new fields and keeps explicit zero values', async () => {
    const values = {
        subcommand: 'set',
        upscale_multiplier: null,
        method: null,
        tile_width: null,
        tile_height: 0,
        tile_overlap: 0,
        tile_batch_size: null,
    };
    const interaction = {
        user: { id: 'settings-user' },
        options: {
            getSubcommand: () => values.subcommand,
            getNumber: name => values[name] ?? null,
            getInteger: name => values[name] ?? null,
            getString: name => values[name] ?? null,
        },
        async reply() {},
        channel: { async send() {} },
    };
    const client = { img2img_upscale_config: new Map() };

    await loaded.commands.script_upscale.execute(interaction, client);
    assert.deepEqual(JSON.parse(client.img2img_upscale_config.get('settings-user')), {
        scale: 2,
        method: 'Mixture of Diffusers',
        tile_width: 1024,
        tile_height: 1024,
        tile_overlap: 0,
        tile_batch_size: 1,
    });

    values.tile_width = 512;
    values.tile_height = 512;
    values.tile_overlap = 512;
    const replies = [];
    interaction.reply = async message => { replies.push(message); };
    await loaded.commands.script_upscale.execute(interaction, client);
    assert.match(String(replies[0]), /smaller than both tile dimensions/);
    assert.deepEqual(JSON.parse(client.img2img_upscale_config.get('settings-user')), {
        scale: 2,
        method: 'Mixture of Diffusers',
        tile_width: 1024,
        tile_height: 1024,
        tile_overlap: 0,
        tile_batch_size: 1,
    });
});

test('unsupported model families are rejected before any Forge submission', async () => {
    const previous = loaded.model_change_stub.cached_model[0];
    const upscale_config = JSON.stringify({ scale: 2 });
    try {
        loaded.model_change_stub.cached_model[0] = 'flux1-dev-Q8_0.gguf';
        for (const [name, command] of Object.entries({
            img2img: loaded.commands.img2img,
            img2img_adv: loaded.commands.img2img_adv,
        })) {
            const user_id = `unsupported-${name}`;
            const before_calls = loaded.axios_calls.length;
            const before_sent = loaded.sent.length;
            await command.execute(make_interaction(user_id), make_client(user_id, upscale_config));

            assert.equal(loaded.axios_calls.length, before_calls, `${name} must not submit`);
            const messages = loaded.sent.slice(before_sent)
                .map(message => typeof message === 'string' ? message : message?.content || '');
            assert.ok(
                messages.some(message => /SD1\/SDXL checkpoints only/.test(message)),
                `${name} should explain the supported families`,
            );
        }
    }
    finally {
        loaded.model_change_stub.cached_model[0] = previous;
    }
});

test('both command paths submit prepared final dimensions and normalized tiled config', async () => {
    const upscale_config = JSON.stringify({
        scale: 2,
        method: 'Mixture of Diffusers',
        tile_width: 512,
        tile_height: 512,
        tile_overlap: 128,
        tile_batch_size: 1,
    });

    for (const [name, command] of Object.entries({
        img2img: loaded.commands.img2img,
        img2img_adv: loaded.commands.img2img_adv,
    })) {
        const user_id = `user-${name}`;
        const before_calls = loaded.axios_calls.length;
        const before_workloads = loaded.workloads.length;
        const before_sent = loaded.sent.length;
        await command.execute(make_interaction(user_id), make_client(user_id, upscale_config));

        assert.equal(loaded.axios_calls.length, before_calls + 1, `${name} should submit once`);
        const call = loaded.axios_calls[loaded.axios_calls.length - 1];
        assert.equal(call.body.fn_index, config.server_pool[0].fn_index_img2img, name);
        const data = call.body.data;
        assert.equal(data.length, 310, name);
        assert.equal(data[24], 1024, `${name} final height`);
        assert.equal(data[25], 1024, `${name} final width`);
        assert.equal(data[27], 'Latent Upscale', name);
        assert.equal(data[40], 'None', `${name} must not run automatic SeedVR2`);
        assert.equal(data[235], true, name);
        assert.equal(data[236], 'Mixture of Diffusers', name);
        assert.equal(data[237], 512, name);
        assert.equal(data[238], 512, name);
        assert.equal(data[239], 128, name);
        assert.equal(data[240], 1, name);
        assert.equal(data[242], true, name);

        assert.equal(loaded.workloads.length, before_workloads + 1, name);
        const workload = loaded.workloads[loaded.workloads.length - 1];
        assert.equal(workload.shape.width, 1024, `${name} workload width`);
        assert.equal(workload.shape.height, 1024, `${name} workload height`);
        assert.equal(workload.features.tiled_vae, true, `${name} workload tiled VAE`);

        const messages = loaded.sent.slice(before_sent).map(message => typeof message === 'string' ? message : message?.content || '');
        assert.equal(messages.some(message => /SeedVR2 upscaling active/.test(message)), false, `${name} must not announce SeedVR2`);
        assert.ok(messages.some(message => /Tiled Latent Upscale loaded \(1024x1024/.test(message)), `${name} should report final size`);
    }

    // Let the one-shot progress timers clear now that every run is cancelled.
    await new Promise(resolve => setTimeout(resolve, 1100));
});
