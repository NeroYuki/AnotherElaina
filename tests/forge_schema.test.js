const test = require('node:test');
const assert = require('node:assert/strict');

const fixture = require('./fixtures/forge-schema-20261103.json');
const {
    server_pool,
    get_data_body,
    get_data_body_img2img,
    get_data_controlnet,
    get_data_controlnet_annotation,
    get_data_rembg,
    get_data_upscale,
} = require('../utils/ai_server_config');

const TXT_INPUTS = fixture.txt2img.inputs;
const IMG_INPUTS = fixture.img2img.inputs;

function assert_schema_values(data, inputs) {
    inputs.forEach((input, i) => {
        const value = data[i];
        const label = `input ${i} (${input.label || input.type})`;
        if (input.type === 'checkbox') assert.equal(typeof value, 'boolean', label);
        if (input.type === 'slider' || input.type === 'number') assert.ok(Number.isFinite(value), label);
        if (input.type === 'rangeslider') {
            assert.ok(Array.isArray(value) && value.length === 2 && value.every(Number.isFinite), label);
        }
        if (input.choices?.length && value != null) {
            for (const choice of Array.isArray(value) ? value : [value]) {
                assert.ok(input.choices.includes(choice), `${label}: invalid choice ${choice}`);
            }
        }
    });
}

const base_txt = (overrides = {}) => get_data_body(
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
    overrides.upscale_multiplier ?? 1,
    overrides.upscaler ?? 'None',
    overrides.upscale_denoise_strength ?? 0.5,
    overrides.upscale_step ?? 20,
    false,
    overrides.is_using_adetailer ?? false,
    overrides.coupler_config ?? null,
    null,
    overrides.clip_skip ?? 2,
    overrides.enable_censor ?? false,
    overrides.freeu_config ?? null,
    overrides.dynamic_threshold_config ?? null,
    overrides.pag_config ?? null,
    false,
    false,
    null,
    overrides.current_model ?? '',
    overrides.colorbalance_config ?? null,
    overrides.usersetting ?? null,
    overrides.detail_daemon_config ?? null,
    null,
    overrides.latentmod_config ?? null,
    overrides.mahiro_config ?? null,
    overrides.teacache_config ?? null,
    overrides.batch_count ?? 1,
    overrides.batch_size ?? 1,
    null,
    overrides.daam_config ?? null,
);

const base_img = (overrides = {}) => get_data_body_img2img(
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
    overrides.current_model ?? '',
    null,
    null,
    overrides.colorbalance_config ?? null,
    overrides.usersetting ?? null,
    null,
    null,
    overrides.extra_script ?? 'None',
    overrides.detail_daemon_config ?? null,
    null,
    overrides.latentmod_config ?? null,
    overrides.mahiro_config ?? null,
    overrides.teacache_config ?? null,
    null,
    overrides.daam_config ?? null,
);

test('generation payloads match the refreshed positional schema and keep Gradio State slots null', () => {
    const txt = base_txt();
    const img = base_img();

    assert.equal(txt.length, 276);
    assert.equal(txt.length, TXT_INPUTS.length);
    assert.equal(img.length, 310);
    assert.equal(img.length, IMG_INPUTS.length);
    assert_schema_values(txt, TXT_INPUTS);
    assert_schema_values(img, IMG_INPUTS);

    TXT_INPUTS.forEach((input, i) => {
        if (input.type === 'state') assert.equal(txt[i], null, `txt2img state ${i} (${input.label})`);
    });
    IMG_INPUTS.forEach((input, i) => {
        if (input.type === 'state') assert.equal(img[i], null, `img2img state ${i} (${input.label})`);
    });
});

test('txt2img keeps disabled feature defaults at their current positions', () => {
    const data = base_txt();

    assert.equal(data[0], 'task(session)');
    assert.equal(data[1], 'prompt');
    assert.equal(data[2], 'negative');
    assert.deepEqual(data[3], []);
    assert.equal(data[10], false);
    assert.equal(data[13], 'None');
    assert.equal(data[26], 'None');
    assert.equal(data[43], false);
    assert.equal(data[44], true);
    assert.equal(data[59], false);
    for (let i = 61; i <= 64; i++) assert.equal(data[i], null);
    assert.equal(data[52], false);
    assert.equal(data[53], 1.25);
    assert.deepEqual(data[54], [0.15, 0.85]);
    assert.equal(data[83], false);
    assert.equal(data[89], false);
    assert.equal(data[107], false);
    assert.equal(data[118], false);
    assert.equal(data[143], false);
    assert.equal(data[156], '');
    assert.equal(data[166], false);
    for (let i = 171; i <= 173; i++) assert.equal(data[i], null);
    assert.equal(data[174], false);
    assert.equal(data[186], false);
    assert.equal(data[191], false);
    assert.equal(data[193], false);
    assert.equal(data[263], 'seedvr2_ema_7b_sharp-Q4_K_M.gguf');
    assert.equal(data[265], -1);
    assert.equal(data[270], true);
    assert.equal(data[275], false);
});

test('txt2img keeps enabled feature mappings after schema shifts', () => {
    const usersetting = {
        hires_checkpoint: 'Use same checkpoint',
        hires_sampler: 'Euler a',
        hires_scheduler: 'Karras',
        hires_positive: 'hires prompt',
        hires_negative: 'hires negative',
        hires_cfg: 5,
        hires_shift: 4,
        do_preview: false,
        seedvr2_model: 'seedvr2_ema_7b_sharp-Q4_K_M.gguf',
        seedvr2_resolution: 1440,
    };
    const data = base_txt({
        prompt: 'cat',
        neg_prompt: 'dog',
        upscale_multiplier: 2,
        upscaler: '4x_UltraSharp',
        upscale_denoise_strength: 0.35,
        upscale_step: 12,
        is_using_adetailer: true,
        enable_censor: true,
        current_model: 'wai_nsfw_illustrious_v160.safetensors',
        usersetting,
        teacache_config: { type: 'TeaCache', threshold: 0.2 },
        coupler_config: {
            mode: 'Advanced',
            direction: 'Vertical',
            global: 'Last Line',
            global_weight: 0.7,
            adv_regions: [[0, 0.5, 0, 1, 1], [0.5, 1, 0, 1, 1]],
        },
        detail_daemon_config: { start: 0.1, end: 0.9, bias: 0.4, amount: 0.2, exponent: 2, start_offset: 1, end_offset: 2, fade: 3 },
        colorbalance_config: {
            alt_mode: true, brightness: 5, contrast: 6, saturation: 1.2, red: 7, green: 8, blue: 9,
        },
        daam_config: { prompt: 'cat ears' },
        dynamic_threshold_config: { mimic_scale: 8, mimic_percentile: 0.9 },
        freeu_config: { values: [1.1, 1.2, 0.8, 0.9] },
        pag_config: { pag_scale: 4 },
        latentmod_config: {
            mode: 'advanced', sharpness_multiplier: 2, sharpness_method: 'isotropic',
            tonemap_multiplier: 3, tonemap_method: 'reinhard', tonemap_percentile: 90,
            contrast_multiplier: 4, contrast_method: 'add', combat_cfg_drift: 5,
            rescale_cfg_phi: 6, extra_noise_type: 'uniform', extra_noise_method: 'multiply',
            extra_noise_multiplier: 7, extra_noise_lowpass: 50, divisive_norm_size: 64,
            divisive_norm_multiplier: 8, spectral_mod_mode: 'soft_clamp', spectral_mod_percentile: 10,
            spectral_mod_multiplier: 9, affect_uncond: 'Positive', dyncfg_augment: 'Positive',
        },
    });

    assert.equal(data[1], 'cat');
    assert.equal(data[2], 'dog');
    assert.equal(data[10], true);
    assert.equal(data[11], 0.35);
    assert.equal(data[12], 2);
    assert.equal(data[13], '4x_UltraSharp');
    assert.equal(data[14], 12);
    assert.equal(data[19], 'Euler a');
    assert.equal(data[20], 'Karras');
    assert.equal(data[21], 'hires prompt');
    assert.equal(data[22], 'hires negative');
    assert.equal(data[23], 5);
    assert.equal(data[24], 4);
    assert.equal(data[26], 'SeedVR2 Native Upscaler (24G)');
    assert.equal(data[43], true);
    assert.equal(data[44], false);
    assert.equal(data[59], true);
    assert.equal(data[83], true);
    assert.equal(data[84], 'TeaCache');
    assert.equal(data[85], 0.2);
    assert.equal(data[89], true);
    assert.equal(data[90], 'Advanced');
    assert.equal(data[92], 'Vertical');
    assert.equal(data[93], 'Last Line');
    assert.equal(data[94], 0.7);
    assert.deepEqual(data[95], [[0, 0.5, 0, 1, 1], [0.5, 1, 0, 1, 1]]);
    assert.equal(data[107], true);
    assert.equal(data[109], 0.1);
    assert.equal(data[110], 0.9);
    assert.equal(data[111], 0.4);
    assert.equal(data[112], 0.2);
    assert.equal(data[113], 2);
    assert.equal(data[114], 1);
    assert.equal(data[115], 2);
    assert.equal(data[116], 3);
    assert.equal(data[143], true);
    assert.equal(data[144], true);
    assert.equal(data[145], 5);
    assert.equal(data[146], 6);
    assert.equal(data[147], 1.2);
    assert.equal(data[148], 7);
    assert.equal(data[149], 8);
    assert.equal(data[150], 9);
    assert.equal(data[151], true);
    assert.equal(data[152], true);
    assert.equal(data[156], 'cat ears');
    assert.equal(data[166], true);
    assert.equal(data[174], true);
    assert.equal(data[175], 8);
    assert.equal(data[176], 0.9);
    assert.equal(data[186], true);
    assert.equal(data[187], 1.1);
    assert.equal(data[188], 1.2);
    assert.equal(data[189], 0.8);
    assert.equal(data[190], 0.9);
    assert.equal(data[191], true);
    assert.equal(data[192], 4);
    assert.equal(data[193], true);
    assert.equal(data[194], 2);
    assert.equal(data[195], 'isotropic');
    assert.equal(data[196], 3);
    assert.equal(data[198], 90);
    assert.equal(data[199], 4);
    assert.equal(data[200], 'add');
    assert.equal(data[201], 5);
    assert.equal(data[202], 6);
    assert.equal(data[203], 'uniform');
    assert.equal(data[204], 'multiply');
    assert.equal(data[205], 7);
    assert.equal(data[206], 50);
    assert.equal(data[207], 64);
    assert.equal(data[208], 8);
    assert.equal(data[209], 'soft_clamp');
    assert.equal(data[210], 10);
    assert.equal(data[211], 9);
    assert.equal(data[212], 'Positive');
    assert.equal(data[213], 'Positive');
    assert.equal(data[263], 'seedvr2_ema_7b_sharp-Q4_K_M.gguf');
    assert.equal(data[266], 1440);
});

test('txt2img keeps flux model guards for coupler and color balance', () => {
    const data = base_txt({
        current_model: 'flux1-dev-Q8_0.gguf',
        coupler_config: { mode: 'Advanced' },
        colorbalance_config: { brightness: 5 },
    });

    assert.equal(data[89], false);
    assert.equal(data[143], false);
});

test('img2img keeps disabled defaults, current resize choice, and states at current positions', () => {
    const data = base_img();

    assert.equal(data[0], 'task(session)');
    assert.equal(data[1], 0);
    assert.equal(data[2], 'prompt');
    assert.equal(data[3], 'negative');
    assert.equal(data[5], 'data:image/png;base64,AAAA');
    assert.equal(data[12], null);
    assert.equal(data[13], null);
    assert.equal(data[27], 'Crop and Resize');
    assert.equal(data[28], 'Whole picture');
    assert.equal(data[29], 32);
    assert.equal(data[40], 'None');
    assert.equal(data[64], false);
    assert.equal(data[65], true);
    assert.equal(data[72], true);
    assert.equal(data[73], false);
    assert.equal(data[80], false);
    for (let i = 82; i <= 85; i++) assert.equal(data[i], null);
    assert.equal(data[104], false);
    assert.equal(data[110], false);
    assert.equal(data[128], false);
    assert.equal(data[139], false);
    assert.equal(data[164], false);
    assert.equal(data[177], '');
    assert.equal(data[187], false);
    for (let i = 192; i <= 194; i++) assert.equal(data[i], null);
    assert.equal(data[195], false);
    assert.equal(data[207], false);
    assert.equal(data[212], false);
    assert.equal(data[214], false);
    assert.equal(data[297], 'seedvr2_ema_7b_sharp-Q4_K_M.gguf');
    assert.equal(data[299], -1);
    assert.equal(data[304], true);
    assert.equal(data[309], false);
});

test('img2img keeps enabled feature mappings after schema shifts', () => {
    const usersetting = {
        do_preview: false,
        seedvr2_model: 'seedvr2_ema_7b_sharp-Q4_K_M.gguf',
        seedvr2_resolution: 1440,
    };
    const data = base_img({
        prompt: 'cat',
        neg_prompt: 'dog',
        is_using_adetailer: true,
        enable_censor: true,
        current_model: 'wai_nsfw_illustrious_v160.safetensors',
        usersetting,
        teacache_config: { type: 'TeaCache', threshold: 0.2 },
        coupler_config: {
            mode: 'Advanced',
            direction: 'Vertical',
            global: 'Last Line',
            global_weight: 0.7,
            adv_regions: [[0, 0.5, 0, 1, 1], [0.5, 1, 0, 1, 1]],
        },
        detail_daemon_config: { start: 0.1, end: 0.9, bias: 0.4, amount: 0.2, exponent: 2, start_offset: 1, end_offset: 2, fade: 3 },
        colorbalance_config: {
            alt_mode: true, brightness: 5, contrast: 6, saturation: 1.2, red: 7, green: 8, blue: 9,
        },
        daam_config: { prompt: 'cat ears' },
        dynamic_threshold_config: { mimic_scale: 8, mimic_percentile: 0.9 },
        freeu_config: { values: [1.1, 1.2, 0.8, 0.9] },
        pag_config: { pag_scale: 4 },
        latentmod_config: {
            mode: 'advanced', sharpness_multiplier: 2, sharpness_method: 'isotropic',
            tonemap_multiplier: 3, tonemap_method: 'reinhard', tonemap_percentile: 90,
            contrast_multiplier: 4, contrast_method: 'add', combat_cfg_drift: 5,
            rescale_cfg_phi: 6, extra_noise_type: 'uniform', extra_noise_method: 'multiply',
            extra_noise_multiplier: 7, extra_noise_lowpass: 50, divisive_norm_size: 64,
            divisive_norm_multiplier: 8, spectral_mod_mode: 'soft_clamp', spectral_mod_percentile: 10,
            spectral_mod_multiplier: 9, affect_uncond: 'Positive', dyncfg_augment: 'Positive',
        },
    });

    assert.equal(data[2], 'cat');
    assert.equal(data[3], 'dog');
    assert.equal(data[27], 'Crop and Resize');
    assert.equal(data[64], true);
    assert.equal(data[65], false);
    assert.equal(data[80], true);
    assert.equal(data[104], true);
    assert.equal(data[105], 'TeaCache');
    assert.equal(data[106], 0.2);
    assert.equal(data[110], true);
    assert.equal(data[111], 'Advanced');
    assert.equal(data[113], 'Vertical');
    assert.equal(data[114], 'Last Line');
    assert.equal(data[115], 0.7);
    assert.equal(data[128], true);
    assert.equal(data[130], 0.1);
    assert.equal(data[131], 0.9);
    assert.equal(data[139], false);
    assert.equal(data[164], true);
    assert.equal(data[165], true);
    assert.equal(data[166], 5);
    assert.equal(data[167], 6);
    assert.equal(data[168], 1.2);
    assert.equal(data[169], 7);
    assert.equal(data[170], 8);
    assert.equal(data[171], 9);
    assert.equal(data[177], 'cat ears');
    assert.equal(data[187], true);
    assert.equal(data[195], true);
    assert.equal(data[196], 8);
    assert.equal(data[197], 0.9);
    assert.equal(data[207], true);
    assert.equal(data[208], 1.1);
    assert.equal(data[209], 1.2);
    assert.equal(data[210], 0.8);
    assert.equal(data[211], 0.9);
    assert.equal(data[212], true);
    assert.equal(data[213], 4);
    assert.equal(data[214], true);
    assert.equal(data[215], 2);
    assert.equal(data[216], 'isotropic');
    assert.equal(data[219], 90);
    assert.equal(data[220], 4);
    assert.equal(data[221], 'add');
    assert.equal(data[222], 5);
    assert.equal(data[223], 6);
    assert.equal(data[224], 'uniform');
    assert.equal(data[225], 'multiply');
    assert.equal(data[226], 7);
    assert.equal(data[227], 50);
    assert.equal(data[228], 64);
    assert.equal(data[229], 8);
    assert.equal(data[230], 'soft_clamp');
    assert.equal(data[231], 10);
    assert.equal(data[232], 9);
    assert.equal(data[233], 'Positive');
    assert.equal(data[234], 'Positive');
    assert.equal(data[297], 'seedvr2_ema_7b_sharp-Q4_K_M.gguf');
    assert.equal(data[300], 1440);
});

test('helper payloads and fn indexes target the current Forge dependencies', () => {
    const deps = fixture.dependencies;
    const pool = server_pool[0];

    assert.equal(deps[pool.fn_index_create].api_name, 'txt2img_1');
    assert.equal(deps[pool.fn_index_create].target_elem_id, 'txt2img_generate');
    assert.equal(deps[pool.fn_index_img2img].api_name, 'img2img_1');
    assert.equal(deps[pool.fn_index_img2img].target_elem_id, 'img2img_generate');
    assert.equal(deps[pool.fn_index_abort].target_elem_id, 'txt2img_interrupt');
    assert.equal(deps[pool.fn_index_change_model].api_name, 'checkpoint_change');
    assert.equal(deps[pool.fn_index_change_support_model].api_name, 'modules_change');

    assert.deepEqual(pool.fn_index_controlnet, [468, 1150]);
    for (const index of pool.fn_index_controlnet) {
        assert.equal(deps[index].event, 'click');
        assert.equal(deps[index].inputs, 20);
        assert.equal(deps[index].outputs, 1);
        assert.deepEqual(deps[index].input_types.slice(15, 17), ['state', 'state']);
    }
    assert.equal(deps[512].id - deps[pool.fn_index_controlnet[0]].id, 44);
    assert.equal(deps[556].id - deps[512].id, 44);
    assert.equal(deps[1196].id - deps[pool.fn_index_controlnet[1]].id, 46);
    assert.equal(deps[1242].id - deps[1196].id, 46);

    assert.deepEqual(pool.fn_index_controlnet_annotation, [1264, 1282]);
    assert.equal(deps[1264].api_name, 'run_annotator');
    assert.equal(deps[1282].api_name, 'run_annotator_3');
    assert.equal(deps[1264].outputs, 4);
    assert.equal(deps[1282].outputs, 4);
    assert.equal(deps[1270].id - deps[1264].id, 6);
    assert.equal(deps[1276].id - deps[1270].id, 6);

    assert.deepEqual(pool.fn_index_controlnet_type_select, [472, 1154]);
    assert.equal(deps[472].target_label, 'Control Type');
    assert.equal(deps[1154].target_label, 'Control Type');
    assert.equal(deps[472].inputs, 1);
    assert.equal(deps[1154].inputs, 1);

    assert.deepEqual(pool.fn_index_coupler_region_preview, [356, 1036]);
    assert.equal(deps[356].api_name, 'visualize_mapping');
    assert.equal(deps[1036].api_name, 'visualize_mapping_1');
    assert.equal(deps[356].inputs, 3);

    assert.deepEqual(pool.fn_index_change_adetailer_model1, [90, 770]);
    assert.equal(deps[90].target_label, 'ADetailer detector');
    assert.equal(deps[770].target_label, 'ADetailer detector');
    assert.deepEqual(deps[90].input_types, ['state', 'dropdown']);
    assert.equal(deps[158].id - deps[90].id, 68);
    assert.equal(deps[226].id - deps[158].id, 68);
    assert.equal(deps[838].id - deps[770].id, 68);
    assert.equal(deps[906].id - deps[838].id, 68);

    assert.equal(pool.fn_index_execute_segment_anything, 1094);
    assert.equal(deps[1091].api_name, 'dino_predict_1');
    assert.equal(deps[1095].api_name, 'update_mask_2');
    assert.equal(deps[1111].target_label, 'Unload all models from memory');
    assert.equal(deps[1094].id - 3, deps[1091].id);
    assert.equal(deps[1094].id + 1, deps[1095].id);
    assert.equal(deps[1094].id + 17, deps[1111].id);

    assert.equal(pool.fn_index_upscale, 1413);
    assert.equal(deps[1413].api_name, 'run_postprocessing_webui');
    assert.equal(deps[1413].inputs, 35);
    assert.equal(pool.fn_index_rembg, 1426);
    assert.equal(deps[1426].api_name, 'run_geeky_remb');
    assert.equal(deps[1426].inputs, 48);
    assert.equal(pool.fn_fetch_wildcards, 1427);
    assert.equal(deps[1427].api_name, 'handle_message');
    assert.equal(deps[1427].inputs, 1);
    assert.equal(server_pool[1].fn_index_create, 114);
});

test('controlnet, annotation, and rembg positional helpers match their refreshed signatures', () => {
    const controlnet = get_data_controlnet(
        'canny', 'controlnet_union', 'data:image/png;base64,AAAA', 0.8, 'Balanced', 768, 0, 1, null, 100, 200, 'Canny',
    );
    assert.equal(controlnet.length, 20);
    assert.equal(controlnet[5], true);
    assert.equal(controlnet[6], 'canny');
    assert.equal(controlnet[7], 'controlnet_union');
    assert.equal(controlnet[8], 0.8);
    assert.equal(controlnet[9], 'data:image/png;base64,AAAA');
    assert.equal(controlnet[11], 'Crop and Resize');
    assert.equal(controlnet[12], 768);
    assert.equal(controlnet[13], 100);
    assert.equal(controlnet[14], 200);
    assert.equal(controlnet[15], null);
    assert.equal(controlnet[16], null);
    assert.equal(controlnet[18], 'Balanced');
    assert.equal(controlnet[19], 'Canny');

    const annotation = get_data_controlnet_annotation('canny', 'data:image/png;base64,AAAA');
    assert.equal(annotation.length, 10);
    assert.equal(annotation[2], 'canny');
    assert.equal(annotation[3], 512);
    assert.equal(annotation[4], 100);
    assert.equal(annotation[5], 200);
    assert.equal(annotation[9], 'Crop and Resize');

    const rembg = get_data_rembg('data:image/png;base64,AAAA', 'birefnet-general', 4, '#112233', true, 200, 20, true, 0.4, 6, true, 1, 2, 3);
    assert.equal(rembg.length, 48);
    assert.equal(rembg[1], 'data:image/png;base64,AAAA');
    assert.equal(rembg[4], 'birefnet-general');
    assert.equal(rembg[6], true);
    assert.equal(rembg[7], 200);
    assert.equal(rembg[8], 20);
    assert.equal(rembg[14], '#000000');
    assert.equal(rembg[19], true);
    assert.equal(rembg[20], 4);
    assert.equal(rembg[21], '#112233');
    assert.equal(rembg[22], true);
    assert.equal(rembg[23], 6);
    assert.equal(rembg[24], 0.4);
    assert.equal(rembg[25], true);
    assert.equal(rembg[26], 1);
    assert.equal(rembg[27], 2);
    assert.equal(rembg[28], 3);

    const upscale = get_data_upscale('session', 'data:image/png;base64,AAAA', 2.5, '4x_UltraSharp', 'Lanczos', 0.4);
    assert.equal(upscale.length, 35);
    assert.equal(upscale[0], 'task(session)');
    assert.equal(upscale[1], 0);
    assert.equal(upscale[2], 'data:image/png;base64,AAAA');
    assert.equal(upscale[6], true);
    assert.equal(upscale[8], false);
    assert.equal(upscale[10], true);
    assert.equal(upscale[11], false);
    assert.equal(upscale[13], 2.5);
    assert.equal(upscale[14], 0);
    assert.equal(upscale[15], 1024);
    assert.equal(upscale[16], 1024);
    assert.equal(upscale[17], true);
    assert.equal(upscale[18], '4x_UltraSharp');
    assert.equal(upscale[19], 'Lanczos');
    assert.equal(upscale[20], 0.4);
    assert.equal(upscale[21], false);
    assert.equal(upscale[22], true);
    assert.equal(upscale[25], 'Variable blur');
    assert.equal(upscale[34], 1);
});
