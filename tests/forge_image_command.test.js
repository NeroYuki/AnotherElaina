'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

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
    Module._load = function (request, parent, isMain) {
        if (request === '../config.json' || request === '../../config.json') {
            return { byPassUser: [], censorGuildIds: [], optOutGuildIds: [] };
        }
        if (String(request).includes('database_interaction')) return { queryRecordLimit() {} };
        return original_load.call(this, request, parent, isMain);
    };
    try {
        const commands = path.join(__dirname, '..', 'commands');
        return {
            img2img: require(path.join(commands, 'wd_img2img')),
            img2img_adv: require(path.join(commands, 'wd_img2img_adv')),
            ref2img: require(path.join(commands, 'wd_ref2img')),
            ref2img_adv: require(path.join(commands, 'wd_ref2img_adv')),
            inpaint: require(path.join(commands, 'wd_inpaint')),
            create: require(path.join(commands, 'wd_create')),
            create_adv: require(path.join(commands, 'wd_create_adv')),
            shared: require('../utils/forge_image_command'),
        };
    }
    finally {
        Module._load = original_load;
    }
}

const loaded = load_commands();
const image_commands = {
    wd_img2img: loaded.img2img,
    wd_img2img_adv: loaded.img2img_adv,
    wd_ref2img: loaded.ref2img,
    wd_ref2img_adv: loaded.ref2img_adv,
    wd_inpaint: loaded.inpaint,
    wd_create: loaded.create,
    wd_create_adv: loaded.create_adv,
};

test('generation commands offer PiD without changing the native Extras upscaler menu', () => {
    const config = require('../utils/ai_server_config');
    assert.equal(config.upscaler_selection.some(choice => choice.value === 'PiD'), false);
    assert.equal(config.generation_upscaler_selection.some(choice => choice.value === 'PiD'), true);

    for (const [name, command, option_name] of [
        ['wd_img2img', loaded.img2img, 'upscaler'],
        ['wd_img2img_adv', loaded.img2img_adv, 'upscaler'],
        ['wd_ref2img', loaded.ref2img, 'upscaler'],
        ['wd_ref2img_adv', loaded.ref2img_adv, 'upscaler'],
        ['wd_create', loaded.create, 'upscaler_mode'],
        ['wd_create_adv', loaded.create_adv, 'upscaler'],
    ]) {
        const option = find_option(command.data.toJSON().options, option_name);
        assert.ok(option, `${name}.${option_name}`);
        assert.ok(option.choices.some(choice => choice.value === 'PiD'), `${name}.${option_name} must offer PiD`);
    }
});

test('image commands keep <=25 options, unique names and <=25 choices', () => {
    for (const [name, command] of Object.entries(image_commands)) {
        const json = command.data.toJSON();
        assert.equal(json.name, name);
        assert.ok(json.options.length <= 25, `${name} has ${json.options.length} options`);
        const names = json.options.map(option => option.name);
        assert.equal(new Set(names).size, names.length, `${name} option names must be unique`);
        for (const option of json.options) {
            if (option.choices) {
                assert.ok(option.choices.length <= 25, `${name}.${option.name} has ${option.choices.length} choices`);
                const values = option.choices.map(choice => choice.value);
                assert.equal(new Set(values).size, values.length, `${name}.${option.name} choices must be unique`);
            }
        }
    }
});

test('reference commands rename ControlNet slots to references and remove incompatible fields', () => {
    for (const [name, command] of Object.entries({ wd_ref2img: loaded.ref2img, wd_ref2img_adv: loaded.ref2img_adv })) {
        const json = command.data.toJSON();
        const names = json.options.map(option => option.name);
        assert.ok(names.includes('reference_2'), name);
        assert.ok(names.includes('reference_3'), name);
        assert.ok(names.includes('reference_4'), name);
        assert.ok(names.includes('reference_layout'), name);
        assert.equal(names.includes('controlnet_input'), false, name);
        assert.equal(names.includes('controlnet_config'), false, name);
        assert.equal(names.includes('extra_script'), false, name);
        assert.equal(find_option(json.options, 'reference_layout').choices[0].value, 'native');

        const checkpoint = find_option(json.options, 'checkpoint');
        const families = checkpoint.choices.map(choice => choice.value);
        assert.ok(families.some(value => value.includes('anima')), `${name} should offer Anima`);
        assert.ok(families.some(value => value.includes('qwen')), `${name} should offer Qwen Image`);
        assert.ok(families.some(value => value.includes('moss')), `${name} should offer MOSS`);
        assert.ok(families.includes(loaded.shared.KONTEXT_MODEL), `${name} should offer Flux Kontext`);
        assert.ok(families.includes('flux1-dev-Q8_0.gguf'), `${name} should offer the Flux Dev alias`);
    }
    const basic_names = loaded.ref2img.data.toJSON().options.map(option => option.name);
    assert.ok(basic_names.includes('edit_variant'));
    const advanced_names = loaded.ref2img_adv.data.toJSON().options.map(option => option.name);
    assert.ok(advanced_names.includes('edit_variant'));
    assert.ok(advanced_names.includes('do_adetailer'));
    assert.ok(advanced_names.includes('controlnet_input') === false);
});

test('Flux Dev is mapped to Flux Kontext for reference commands', () => {
    const { KONTEXT_MODEL, resolve_reference_checkpoint } = loaded.shared;
    assert.equal(resolve_reference_checkpoint('flux1-dev-Q8_0.gguf'), KONTEXT_MODEL);
    assert.equal(resolve_reference_checkpoint('archive\\flux1-dev-Q6_K.gguf'), KONTEXT_MODEL);
    assert.equal(resolve_reference_checkpoint(KONTEXT_MODEL), KONTEXT_MODEL);
    assert.equal(resolve_reference_checkpoint('krea2_turbo_int8_convrot.safetensors'), 'krea2_turbo_int8_convrot.safetensors');
});

test('MOSS int8 checkpoints are mapped to their BF16 equivalent for reference commands', () => {
    const { MOSS_REFERENCE_MODEL, resolve_reference_checkpoint, is_moss_int8_checkpoint } = loaded.shared;
    assert.equal(is_moss_int8_checkpoint('moss_image_sft_int8_convrot.safetensors'), true);
    assert.equal(is_moss_int8_checkpoint('moss_image_sft_bf16.safetensors'), false);
    assert.equal(resolve_reference_checkpoint('moss_image_sft_int8_convrot.safetensors'), MOSS_REFERENCE_MODEL);
    assert.equal(resolve_reference_checkpoint('moss_image_sft_bf16.safetensors'), 'moss_image_sft_bf16.safetensors');
});

test('family defaults keep Klein CFG at 1 while using distilled/shift values for Flux and Z-Image', () => {
    const { resolve_family_cfg } = loaded.shared;
    assert.equal(resolve_family_cfg({ cfg: 1, dcfg: null }), 1);
    assert.equal(resolve_family_cfg({ cfg: null, dcfg: 3 }), 3);
    assert.equal(resolve_family_cfg({ cfg: 1, dcfg: 9 }), 9);
    assert.equal(resolve_family_cfg({ cfg: 4, dcfg: null }), 4);
    assert.equal(resolve_family_cfg({ cfg: null, dcfg: null }), null);

    const { get_model_family_defaults } = require('../utils/model_defaults');
    assert.equal(resolve_family_cfg(get_model_family_defaults('flux-2-klein-9b-kv-int8-convrot.safetensors', 'i2i')), 1);
    assert.equal(resolve_family_cfg(get_model_family_defaults('flux1-dev-Q8_0.gguf', 'i2i')), 3);
    assert.equal(resolve_family_cfg(get_model_family_defaults('wai_nsfw_illustrious_v120.safetensors', 'i2i')), null);
});

test('img2img commands retain extra scripts and ControlNet options', () => {
    for (const [name, command] of Object.entries({ wd_img2img: loaded.img2img, wd_img2img_adv: loaded.img2img_adv })) {
        const json = command.data.toJSON();
        const names = json.options.map(option => option.name);
        assert.ok(names.includes('extra_script'), name);
        const script = find_option(json.options, 'extra_script');
        assert.ok(script.choices.some(choice => choice.value === 'Native Outpaint'), name);
        assert.ok(script.choices.some(choice => choice.value === 'Tiled Latent Upscale'), name);
    }
    assert.ok(loaded.img2img_adv.data.toJSON().options.map(option => option.name).includes('controlnet_config'));
    assert.equal(loaded.img2img.data.toJSON().options.map(option => option.name).includes('controlnet_config'), false);
});

test('generation options carry uploaded references at the final Gradio inputs', () => {
    const references = [
        { image: { path: '/tmp/reference-2.png' } },
        { image: { path: '/tmp/reference-3.png' } },
    ];
    const generationOptions = loaded.shared.build_generation_options({ references });
    assert.deepEqual(generationOptions, {
        references,
        reference_max_side: 1024,
    });

    const payload = loaded.shared.build_img2img_payload({
        serverIndex: 0,
        prompt: 'edit this',
        negPrompt: 'bad',
        samplingStep: 20,
        cfgScale: 7,
        seed: 1,
        sampler: 'Euler',
        scheduler: 'Automatic',
        sessionHash: 'session',
        height: 1024,
        width: 1024,
        attachment: 'data:image/png;base64,AAAA',
        denoisingStrength: 1,
        currentModel: 'wai_nsfw_illustrious_v120.safetensors',
        generationOptions,
    });
    assert.equal(payload.length, 310);
    assert.equal(payload[244], true, 'image stitch enabled');
    assert.deepEqual(payload[245], references, 'native gallery references forwarded');
    assert.equal(payload[246], 1024, 'reference max side forwarded');
});

test('image mode wrapper forwards denoise and reference workflows', async () => {
    const seen = [];
    const mode = async (options, callback) => {
        seen.push(options);
        return callback();
    };
    assert.equal(await loaded.shared.withForgeImageModeCompat({ workflow: 'denoise' }, async () => 1, { withForgeImageMode: mode }), 1);
    assert.equal(await loaded.shared.withForgeImageModeCompat({ workflow: 'reference', editVariant: 'identity' }, async () => 2, { withForgeImageMode: mode }), 2);
    assert.deepEqual(seen.map(item => item.workflow), ['denoise', 'reference']);
    assert.equal(seen[1].editVariant, 'identity');
});

test('reference executor freezes the model, runs LLM outside the lease and forwards gallery references', async () => {
    const calls = {
        enrich: null,
        referenceInputs: null,
        prompt: null,
        mode: null,
        job: null,
        lease: 0,
    };
    const cached = ['anima-base-v1.safetensors'];
    const emptyMap = new Map();
    const client = {
        cooldowns: new Map(),
        controlnet_config: emptyMap,
        adetailer_config: emptyMap,
        colorbalance_config: emptyMap,
        boorugen_config: emptyMap,
        latentmod_config: emptyMap,
        usersetting_config: emptyMap,
        img2img_outpaint_config: emptyMap,
        img2img_upscale_config: emptyMap,
    };
    const options = {
        image: { proxyURL: 'https://example.test/primary.png', width: 8, height: 8, name: 'primary.png', contentType: 'image/png' },
        prompt: 'make it blue',
        neg_prompt: '',
        denoising_strength: 0,
        width: 8,
        height: 8,
        seed: '-1',
        default_neg_prompt: 'n_nsfw',
        reference_layout: 'native',
        edit_variant: 'identity',
        checkpoint: null,
        upscaler: 'None',
        profile: null,
        reference_2: { proxyURL: 'https://example.test/second.png', width: 8, height: 8, name: 'second.png', contentType: 'image/png' },
        reference_3: null,
        reference_4: null,
    };
    const edits = [];
    const interaction = {
        id: 'ref-test',
        user: { id: 'owner' },
        guildId: null,
        channel: {
            nsfw: true,
            async send() {},
            createMessageComponentCollector() { return { on() {}, stop() {} }; },
        },
        options: {
            getString: name => options[name] ?? null,
            getInteger: name => options[name] ?? null,
            getNumber: name => options[name] ?? null,
            getBoolean: name => options[name] ?? null,
            getAttachment: name => options[name] ?? null,
        },
        async deferReply() {},
        async reply() {},
        async editReply(message) { edits.push(message); },
    };

    const references = [{ image: { path: '/tmp/second.png' } }];
    const deps = {
        cached_model: cached,
        sync_active_model: async () => cached[0],
        load_profile: async () => null,
        model_change: async () => true,
        loadImage: async () => Buffer.from('reference-image'),
        get_worker_server: () => 0,
        withForgeSession: async callback => {
            calls.lease++;
            return callback();
        },
        enrichImagePrompts: async input => {
            calls.enrich = input;
            return { prompts: [input.prompt] };
        },
        getReferencePolicy: (model, policy) => {
            calls.policy = { model, policy };
            return { family: 'anima' };
        },
        prepareReferencePromptWithLLM: async (prompt, model, options) => {
            calls.prompt = { prompt, model, options };
            return `${prompt} <lora:anime_edit:1>`;
        },
        prepareReferenceInputs: async input => {
            calls.referenceInputs = input;
            return {
                attachment: 'data:image/png;base64,AAAA',
                references,
                imageCount: 2,
                layout: 'native',
            };
        },
        withForgeImageMode: async (modeOptions, callback) => {
            calls.mode = modeOptions;
            return callback();
        },
        runForgeImageJob: async jobOptions => {
            calls.job = jobOptions;
            return { status: 'completed' };
        },
        get_model_family_defaults: () => null,
        get_negative_prompt: (value) => value,
        get_prompt: value => value,
        get_debug_prompt_analyze: (prompt, negPrompt) => ({ prompt, neg_prompt: negPrompt, debug_prompt: null }),
        full_prompt_analyze: prompt => ({
            prompt,
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
        }),
        fetch_user_defined_wildcard: async prompt => prompt,
        get_teacache_config_from_prompt: prompt => ({ prompt, teacache_config: null }),
        is_pid_upscaler: () => false,
        prepare_pid_upscale: () => { throw new Error('PiD should not be prepared'); },
        load_controlnet: async () => {},
        load_adetailer: async () => {},
        preview_coupler_setting: () => {},
    };

    await loaded.shared.execute_forge_image_command(interaction, client, {
        advanced: false,
        workflow: 'reference',
        allowControlNet: false,
        allowAdetailer: false,
        allowExtraScript: false,
    }, deps);

    assert.equal(calls.lease, 1);
    assert.equal(calls.prompt.model, 'anima-base-v1.safetensors');
    assert.match(calls.prompt.prompt, /make it blue/);
    assert.equal(calls.prompt.options.images.length, 2);
    assert.equal(typeof calls.prompt.options.onProgress, 'function');
    assert.equal(calls.referenceInputs.layout, 'native');
    assert.equal(calls.referenceInputs.images.length, 2);
    assert.equal(calls.referenceInputs.match_output_size, true);
    assert.equal(calls.enrich.model, 'anima-base-v1.safetensors');
    assert.equal(calls.enrich.workflow, 'ref2img');
    assert.equal(calls.mode.workflow, 'reference');
    assert.equal(calls.mode.editVariant, 'identity');
    assert.equal(calls.job.data[244], true);
    assert.deepEqual(calls.job.data[245], references);
    assert.equal(calls.job.data[246], 1024);
    assert.equal(calls.job.workload.task_kind, 'ref2img');
    assert.equal(edits.some(message => /Image prompt enrichment failed/.test(message?.content || '')), false);
});
