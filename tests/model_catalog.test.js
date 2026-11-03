const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const config = require('../utils/ai_server_config');
const imggen_default = require('../resources/imggen_default_config.json');
const { get_model_family, get_model_family_defaults } = require('../utils/model_defaults');
const { model_change, get_model_type, get_support_models } = require('../utils/model_change');

const QWEN21_MODELS = [
    'qwen_image_2.1_int8_convrot.safetensors',
    'qwen_image_2.1_turbo_int8_convrot.safetensors',
    'qwen-image-2.1-UC-int8_convrot.safetensors',
];
const MOSS_MODELS = [
    'moss_image_base_bf16.safetensors',
    'moss_image_sft_bf16.safetensors',
    'moss_image_sft_int8_convrot.safetensors',
];
const NEW_MODELS = [...QWEN21_MODELS, ...MOSS_MODELS];
const RETIRED_MODELS = [
    'comfy_sym\\svdq-fp4_r128-qwen-image.safetensors',
    'comfy_sym\\svdq-fp4_r128-qwen-image-edit-lightningv1.0-8steps.safetensors',
    'comfy_sym\\svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-8steps.safetensors',
];

const all_selections = () => [
    ...config.model_selection,
    ...config.model_selection_xl,
    ...config.model_selection_legacy,
    ...config.model_selection_curated,
    ...config.model_selection_experimental,
    ...config.model_selection_flux,
    ...config.model_selection_chroma,
    ...config.model_selection_flux_klein_4b,
    ...config.model_selection_flux_klein_9b,
    ...config.model_selection_anima,
    ...config.model_selection_lumina,
    ...config.model_selection_qwen21,
    ...config.model_selection_moss,
    ...config.model_selection_z_image,
    ...config.model_selection_krea,
    ...config.model_selection_inpaint.map(x => ({ value: x.value, name: x.value })),
];

const txt_payload = (current_model, cfg_scale = 1) => config.get_data_body(
    0, 'prompt', 'negative', 20, cfg_scale, 1, 'Euler', 'Automatic', 'session',
    1024, 1024, 1, 'None', 0.5, 20, false, false, null, null, 2, false,
    null, null, null, false, false, null, current_model, null, null, null,
    null, null, null, 1, 1, null, null,
);

const img_payload = (current_model, cfg_scale = 1) => config.get_data_body_img2img(
    0, 'prompt', 'negative', 20, cfg_scale, 1, 'Euler', 'Automatic', 'session',
    1024, 1024, 'data:image/png;base64,AAAA', null, 0.5, 0, 4, 'original', 'None',
    false, null, null, 2, false, null, null, null, 'Whole picture', 32, false, false,
    null, current_model, null, null, null, null, null, 'None', null, null, null,
    null, null,
);

function load_commands() {
    const original_load = Module._load;
    const config_stub = {
        byPassUser: 'test', censorGuildIds: [], optOutGuildIds: [],
        clientId: 'test', guildIds: [],
    };
    const database_stub = {
        addRecord() {}, queryRecord() {}, queryRecordLimit() {}, editRecords() {}, removeRecords() {},
    };
    Module._load = function (request, parent, isMain) {
        if (request === '../config.json' || request === '../../config.json') return config_stub;
        if (request === 'dotenv') return { config() {} };
        if (String(request).includes('database_interaction')) return database_stub;
        return original_load.call(this, request, parent, isMain);
    };
    try {
        const commands = path.join(__dirname, '..', 'commands');
        return {
            changemodel: require(path.join(commands, 'wd_changemodel')),
            setting: require(path.join(commands, 'wd_setting')),
            profile_add: require(path.join(commands, 'wd_profile', 'add')),
            create: require(path.join(commands, 'wd_create')),
            img2img: require(path.join(commands, 'wd_img2img')),
            create_adv: require(path.join(commands, 'wd_create_adv')),
            img2img_adv: require(path.join(commands, 'wd_img2img_adv')),
            inpaint: require(path.join(commands, 'wd_inpaint')),
        };
    }
    finally {
        Module._load = original_load;
    }
}

function find_options(options = [], predicate, found = []) {
    for (const option of options) {
        if (predicate(option)) found.push(option);
        if (option.options) find_options(option.options, predicate, found);
    }
    return found;
}

function checkpoint_options(command) {
    return find_options(command.data.toJSON().options, option => /checkpoint/.test(option.name));
}

test('retired Nunchaku Qwen image models are gone from every selectable model list', () => {
    const selectable = all_selections();
    for (const retired of RETIRED_MODELS) {
        assert.equal(selectable.some(x => x.value === retired), false, retired);
        assert.equal(get_model_family(retired), null);
        assert.equal(config.check_model_filename(retired), `${retired} (Testing)`);
    }
    assert.equal(config.model_selection_qwen_image, undefined);
    assert.deepEqual(Object.keys(imggen_default).filter(key => key.startsWith('qwen_')), []);
    assert.equal(
        config.model_selection_experimental.some(x => config.model_selection_legacy.some(y => y.value === x.value)),
        false,
    );
});

test('new Qwen 2.1 and MOSS checkpoints use the shared Stable-diffusion root names', () => {
    assert.deepEqual(config.model_selection_qwen21.map(x => x.value), QWEN21_MODELS);
    assert.deepEqual(config.model_selection_moss.map(x => x.value), MOSS_MODELS);

    const by_value = Object.fromEntries(all_selections().map(x => [x.value, x.name]));
    for (const value of NEW_MODELS) assert.ok(by_value[value], `${value} is selectable`);
    assert.match(by_value[QWEN21_MODELS[0]], /Qwen Image 2\.1.*Int8 ConvRot/);
    assert.match(by_value[QWEN21_MODELS[1]], /Qwen Image 2\.1.*Turbo.*Int8 ConvRot/);
    assert.match(by_value[QWEN21_MODELS[2]], /Qwen Image 2\.1.*Uncensored.*Int8 ConvRot/);
    assert.match(by_value[MOSS_MODELS[0]], /MOSS Image Base/);
    assert.match(by_value[MOSS_MODELS[1]], /MOSS Image SFT/);
    for (const value of [...QWEN21_MODELS, MOSS_MODELS[0], MOSS_MODELS[1]]) {
        assert.equal(config.model_selection_curated.some(x => x.value === value), true);
    }
});

test('Flux Fill/Kontext use the installed Q8 files and Kontext leaves experimental', () => {
    const flux = config.model_selection_flux.map(x => x.value);
    assert.ok(flux.includes('comfy_sym\\flux1-fill-dev-Q8_0.gguf'));
    assert.ok(flux.includes('comfy_sym\\flux1-kontext-dev-Q8_0.gguf'));
    assert.equal(flux.some(value => /flux1-(fill|kontext)-dev-Q6_K/i.test(value)), false);
    assert.deepEqual(config.model_selection_flux_dev.map(x => x.value), ['flux1-dev-Q8_0.gguf']);
    assert.deepEqual(config.model_selection_kontext.map(x => x.value), ['comfy_sym\\flux1-kontext-dev-Q8_0.gguf']);
    assert.equal(config.model_selection_experimental.some(x => /kontext/i.test(x.value)), false);
    assert.ok(config.model_selection_experimental.some(x => x.value === 'moss_image_sft_int8_convrot.safetensors'));
});

test('old profiles cannot reactivate retired Nunchaku Qwen checkpoints', async () => {
    for (const model of [...RETIRED_MODELS, 'semi-archive\\nunchaku_qwen_image_2512_best_quality_fp4.safetensors']) {
        await assert.rejects(model_change(model, true), /have been retired/);
    }
});

test('Qwen 2.1 and MOSS resolve the correct family defaults and per-variant steps', () => {
    for (const model of QWEN21_MODELS) {
        assert.equal(get_model_family(model), 'qwen21');
        for (const mode of ['t2i', 'i2i']) {
            const defaults = get_model_family_defaults(model, mode);
            assert.equal(defaults.sampler, 'Euler');
            assert.equal(defaults.scheduler, 'Simple');
            assert.equal(defaults.cfg, 1);
            assert.equal(defaults.dcfg, 1);
            assert.equal(defaults.step, model === QWEN21_MODELS[1] ? 8 : 40);
        }
    }
    assert.equal(get_model_family_defaults(QWEN21_MODELS[0], 't2i').hr_step, 40);
    assert.equal(get_model_family_defaults(QWEN21_MODELS[1], 't2i').hr_step, 8);
    assert.equal(get_model_family_defaults(QWEN21_MODELS[0], 't2i').hr_cfg, 1);
    assert.equal(get_model_family_defaults(QWEN21_MODELS[0], 't2i').hr_dcfg, 1);

    for (const model of MOSS_MODELS) {
        assert.equal(get_model_family(model), 'moss');
        for (const mode of ['t2i', 'i2i']) {
            const defaults = get_model_family_defaults(model, mode);
            assert.equal(defaults.sampler, 'Euler');
            assert.equal(defaults.scheduler, 'Simple');
            assert.equal(defaults.step, 36);
            assert.equal(defaults.cfg, 3);
            assert.equal(defaults.dcfg, 5);
        }
        assert.equal(get_model_family_defaults(model, 't2i').hr_step, 36);
        assert.equal(get_model_family_defaults(model, 't2i').hr_cfg, 3);
        assert.equal(get_model_family_defaults(model, 't2i').hr_dcfg, 5);
    }
});

test('main and hires model changes wire the new typing and companion files', () => {
    for (const model of QWEN21_MODELS) {
        assert.equal(get_model_type(model), 'qwen21');
        assert.deepEqual(get_support_models(model), [
            'qwen_image_2.1_vae_bf16.safetensors',
            'qwen3vl_8b_int8_convrot.safetensors',
        ]);
        assert.deepEqual(config.resolve_hires_models({ hires_checkpoint: model }, 'current.safetensors').support_models, [
            'qwen_image_2.1_vae_bf16.safetensors',
            'qwen3vl_8b_int8_convrot.safetensors',
        ]);
    }
    for (const model of MOSS_MODELS) {
        assert.equal(get_model_type(model), 'moss');
        assert.deepEqual(get_support_models(model), [
            'flux2-vae.safetensors',
            'qwen3.5_9b_int8_convrot.safetensors',
        ]);
        assert.deepEqual(config.resolve_hires_models({ hires_checkpoint: model }, 'current.safetensors').support_models, [
            'flux2-vae.safetensors',
            'qwen3.5_9b_int8_convrot.safetensors',
        ]);
    }
    assert.deepEqual(
        config.resolve_hires_models({ hires_checkpoint: 'Use same checkpoint' }, QWEN21_MODELS[0]),
        { requested_checkpoint: 'Use same checkpoint', checkpoint: QWEN21_MODELS[0], support_models: [] },
    );
});

test('MOSS keeps CFG and shift distinct in actual txt2img/img2img payloads', () => {
    for (const model of MOSS_MODELS) {
        const txt = txt_payload(model, 3);
        assert.equal(txt[6], 3);
        assert.equal(txt[7], 5);
        assert.equal(txt[23], 3);
        assert.equal(txt[24], 5);

        const custom = txt_payload(model, 6);
        assert.equal(custom[6], 6);
        assert.equal(custom[7], 5);

        const img = img_payload(model, 3);
        assert.equal(img[19], 3);
        assert.equal(img[20], 5);
    }

    const qwen = txt_payload(QWEN21_MODELS[0], 1);
    assert.equal(qwen[6], 1);
    assert.equal(qwen[7], 3);
    assert.equal(img_payload(QWEN21_MODELS[1], 1)[19], 1);
});

test('serialized Discord model menus stay within 25 options and include sentinels', () => {
    const commands = load_commands();

    const changemodel = checkpoint_options(commands.changemodel);
    const standard = changemodel.find(x => x.name === 'checkpoint');
    const experimental = changemodel.find(x => x.name === 'experimental_checkpoint');
    assert.equal(standard.choices.length, 24);
    assert.ok(standard.choices.some(x => x.value === 'legacy'));
    assert.equal(experimental.choices.length, 25);
    for (const model of NEW_MODELS) assert.ok(experimental.choices.some(x => x.value === model));
    for (const retired of RETIRED_MODELS) {
        assert.equal(standard.choices.some(x => x.value === retired), false);
        assert.equal(experimental.choices.some(x => x.value === retired), false);
    }

    const setting = checkpoint_options(commands.setting).find(x => x.name === 'hires_checkpoint');
    assert.equal(setting.choices.length, 25);
    assert.ok(setting.choices.some(x => x.value === 'legacy'));
    assert.ok(setting.choices.some(x => x.value === 'experimental'));

    const profile = checkpoint_options(commands.profile_add).find(x => x.name === 'checkpoint');
    assert.equal(profile.choices.length, 25);
    assert.ok(profile.choices.some(x => x.value === 'legacy'));
    assert.ok(profile.choices.some(x => x.value === 'experimental'));

    for (const command of [commands.create, commands.img2img]) {
        const checkpoint = checkpoint_options(command).find(x => x.name === 'checkpoint');
        assert.equal(checkpoint.choices.length, config.model_selection_curated.length);
        for (const model of [...QWEN21_MODELS, MOSS_MODELS[0], MOSS_MODELS[1]]) {
            assert.ok(checkpoint.choices.some(x => x.value === model));
        }
    }

    const active_models = config.model_selection
        .concat(config.model_selection_xl)
        .filter(x => !config.model_selection_legacy.map(y => y.value).includes(x.value));
    for (const command of [commands.create_adv, commands.img2img_adv, commands.inpaint]) {
        const checkpoint = checkpoint_options(command).find(x => x.name === 'checkpoint');
        assert.equal(checkpoint.choices.length, active_models.length);
        for (const retired of RETIRED_MODELS) {
            assert.equal(checkpoint.choices.some(x => x.value === retired), false);
        }
    }

    for (const command of Object.values(commands)) {
        for (const option of checkpoint_options(command)) {
            assert.ok(option.choices.length <= 25, `${command.data.name}.${option.name}`);
        }
    }

    assert.equal(config.model_selection_experimental.length, 25);
    assert.equal(config.model_selection_legacy.length, 25);
});
