const test = require('node:test');
const assert = require('node:assert/strict');

const {
    server_pool,
    get_data_body,
    get_data_body_img2img,
} = require('../utils/ai_server_config');
const { PID_CHECKPOINT, PID_VAE, PID_TEXT_ENCODER } = require('../utils/forge_pid');

const SDXL_MODEL = 'wai_nsfw_illustrious_v120.safetensors';
const ATTACHMENT = 'data:image/png;base64,AAAA';

// Compact argument lists matching the existing positional signatures. Holes are
// intentionally left for defaulted parameters so only the fields under test
// need to be maintained here.
function txtArgs(overrides = {}) {
    const args = new Array(39);
    args[0] = 0;
    args[1] = overrides.prompt ?? 'prompt';
    args[2] = overrides.neg_prompt ?? 'negative';
    args[3] = overrides.sampling_step ?? 20;
    args[4] = overrides.cfg_scale ?? 7;
    args[5] = overrides.seed ?? 1;
    args[6] = 'Euler';
    args[7] = 'Automatic';
    args[8] = 'session';
    args[9] = overrides.height ?? 1024;
    args[10] = overrides.width ?? 1024;
    args[11] = overrides.upscale_multiplier ?? 1;
    args[12] = overrides.upscaler ?? 'None';
    args[13] = 0.5;
    args[14] = 20;
    args[15] = false;
    args[16] = false;
    args[19] = 2;
    args[20] = false;
    args[27] = overrides.current_model ?? '';
    args[29] = overrides.usersetting ?? null;
    args[35] = 1;
    args[36] = 1;
    args[38] = overrides.daam_config ?? null;
    return args;
}

function imgArgs(overrides = {}) {
    const args = new Array(46);
    args[0] = 0;
    args[1] = overrides.prompt ?? 'prompt';
    args[2] = overrides.neg_prompt ?? 'negative';
    args[3] = overrides.sampling_step ?? 20;
    args[4] = overrides.cfg_scale ?? 7;
    args[5] = overrides.seed ?? 1;
    args[6] = 'Euler';
    args[7] = 'Automatic';
    args[8] = 'session';
    args[9] = overrides.height ?? 1024;
    args[10] = overrides.width ?? 1024;
    args[11] = overrides.attachment ?? ATTACHMENT;
    args[12] = null;
    args[13] = overrides.denoising_strength ?? 0.5;
    args[14] = overrides.mode ?? 0;
    args[15] = 4;
    args[16] = 'original';
    args[17] = 'None';
    args[21] = 2;
    args[22] = false;
    args[26] = 'Whole picture';
    args[27] = 32;
    args[31] = overrides.current_model ?? '';
    args[32] = overrides.inpaint_img_upload_path ?? null;
    args[33] = overrides.inpaint_mask_upload_path ?? null;
    args[35] = overrides.usersetting ?? null;
    args[36] = overrides.outpaint_config ?? null;
    args[37] = overrides.upscale_config ?? null;
    args[38] = overrides.extra_script ?? 'None';
    args[45] = overrides.daam_config ?? null;
    return args;
}

const refs = [
    { image: { path: '/tmp/a.png', url: 'http://forge.test/file=/tmp/a.png' }, caption: null },
    { image: { path: '/tmp/b.png', url: 'http://forge.test/file=/tmp/b.png' }, caption: 'second' },
];

test('server_pool exposes the native reference-settings fn indexes', () => {
    assert.deepEqual(server_pool[0].fn_index_reference_settings, {
        klein: 1467,
        qwen21: 1468,
        anima: 1469,
        krea: 1470,
        moss: 1471,
    });
});

test('generation options stay an optional final argument and preserve ordinary payloads', () => {
    const txt = get_data_body(...txtArgs());
    const txt_null = get_data_body(...txtArgs(), null);
    const txt_empty = get_data_body(...txtArgs(), {});
    assert.equal(txt.length, 276);
    assert.equal(txt_null.length, 276);
    assert.deepEqual(txt_null, txt);
    assert.deepEqual(txt_empty, txt);

    const img = get_data_body_img2img(...imgArgs());
    const img_null = get_data_body_img2img(...imgArgs(), null);
    const img_empty = get_data_body_img2img(...imgArgs(), {});
    assert.equal(img.length, 310);
    assert.equal(img_null.length, 310);
    assert.deepEqual(img_null, img);
    assert.deepEqual(img_empty, img);

    assert.equal(txt[217], false);
    assert.deepEqual(txt[218], []);
    assert.equal(txt[219], 1024);
    assert.equal(img[244], false);
    assert.deepEqual(img[245], []);
    assert.equal(img[246], 1024);
});

test('native references map to the exact txt2img ImageStitch slots and are copied', () => {
    const original = structuredClone(refs);
    const data = get_data_body(...txtArgs({ current_model: SDXL_MODEL }), { references: refs, max_side: 1536 });

    assert.equal(data.length, 276);
    assert.equal(data[217], true);
    assert.deepEqual(data[218], refs);
    assert.notEqual(data[218], refs, 'the gallery array must be copied');
    assert.equal(data[219], 1536);
    assert.deepEqual(refs, original, 'caller references must not be mutated');

    const empty = get_data_body(...txtArgs({ current_model: SDXL_MODEL }), { references: [], max_side: 5000 });
    assert.equal(empty[217], false);
    assert.deepEqual(empty[218], []);
    assert.equal(empty[219], 1024, 'disabled defaults must not be affected by an unused max side');
});

test('the agreed singular reference_max_side alias is honoured', () => {
    const data = get_data_body(
        ...txtArgs({ current_model: SDXL_MODEL }),
        { references: refs, reference_max_side: 1536 },
    );
    assert.equal(data[217], true);
    assert.equal(data[219], 1536);

    const img = get_data_body_img2img(
        ...imgArgs({ current_model: SDXL_MODEL }),
        { references: refs, reference_max_side: 2048 },
    );
    assert.equal(img[244], true);
    assert.equal(img[246], 2048);
});

test('native references map to the exact img2img ImageStitch slots without replacing the init image', () => {
    const data = get_data_body_img2img(...imgArgs({ current_model: SDXL_MODEL }), { references: refs, max_side: 2048 });

    assert.equal(data.length, 310);
    assert.equal(data[5], ATTACHMENT, 'the init image stays in its normal slot');
    assert.equal(data[244], true);
    assert.deepEqual(data[245], refs);
    assert.notEqual(data[245], refs, 'the gallery array must be copied');
    assert.equal(data[246], 2048);
});

test('reference validation rejects malformed galleries but ignores disabled max side', () => {
    assert.throws(
        () => get_data_body(...txtArgs(), { references: 'not-an-array' }),
        /references must be an array/,
    );
    assert.throws(
        () => get_data_body(...txtArgs(), { references: [{ image: { url: 'missing-path' } }] }),
        /missing an uploaded file path/,
    );
    assert.throws(
        () => get_data_body(...txtArgs(), { references: [null] }),
        /must be a native Gradio gallery object/,
    );
    for (const max_side of [0, -1, 4097, Infinity, 'wide']) {
        assert.throws(
            () => get_data_body(...txtArgs(), { references: refs, max_side }),
            /maximum side length/,
        );
    }
    assert.doesNotThrow(() => get_data_body(...txtArgs(), { references: [], max_side: 9999 }));
});

test('txt2img PiD disables Hires Fix and writes the exact native PiD slots', () => {
    const data = get_data_body(
        ...txtArgs({ height: 768, width: 1024, upscale_multiplier: 2, upscaler: '4x_UltraSharp', current_model: SDXL_MODEL }),
        { pid: { prompt: 'hires cleanup', degrade_sigma: 0, color_correction: false } },
    );

    assert.equal(data[10], false, 'ordinary Hires Fix must be off');
    assert.equal(data[12], 1, 'native hires scale must be benign');
    assert.equal(data[13], 'None', 'native hires upscaler must be benign');
    assert.equal(data[45], true);
    assert.equal(data[46], 'hires cleanup');
    assert.equal(data[47], PID_CHECKPOINT);
    assert.equal(data[48], PID_VAE);
    assert.equal(data[49], PID_TEXT_ENCODER);
    assert.equal(data[50], 0);
    assert.equal(data[51], false);

    assert.throws(
        () => get_data_body(...txtArgs({ current_model: 'flux1-dev-Q8_0.gguf' }), { pid: {} }),
        /PiD postpass for flux models must run through run_pid_postpass/,
    );
});

test('txt2img PiD ignores object model/width/height and rejects an oversized base', () => {
    const data = get_data_body(
        ...txtArgs({ height: 512, width: 768, current_model: SDXL_MODEL }),
        { pid: { model: 'flux1-dev-Q8_0.gguf', width: 1, height: 1, prompt: 'kept' } },
    );
    assert.equal(data[46], 'kept');
    assert.equal(data[47], PID_CHECKPOINT);

    assert.throws(
        () => get_data_body(...txtArgs({ height: 512, width: 1032, current_model: SDXL_MODEL }), { pid: {} }),
        /positive integer divisible by 8/,
    );
});

test('img2img PiD forces the native script to None and writes the exact PiD slots', () => {
    const data = get_data_body_img2img(
        ...imgArgs({
            height: 768,
            width: 1024,
            current_model: SDXL_MODEL,
            usersetting: { seedvr2_model: 'seedvr2_ema_7b_sharp-Q4_K_M.gguf' },
            extra_script: 'SeedVR2 Native Upscaler (24G)',
        }),
        { pid: { prompt: 'post pass', degrade_sigma: 0.5, color_correction: true } },
    );

    assert.equal(data.length, 310);
    assert.equal(data[40], 'None', 'SeedVR2 must not be selected alongside PiD');
    assert.equal(data[269], 'None', 'the native img2img upscaler must not receive literal PiD');
    assert.equal(data[66], true);
    assert.equal(data[67], 'post pass');
    assert.equal(data[68], PID_CHECKPOINT);
    assert.equal(data[69], PID_VAE);
    assert.equal(data[70], PID_TEXT_ENCODER);
    assert.equal(data[71], 0.5);
    assert.equal(data[72], true);
});

test('img2img PiD rejects incompatible native post-processing paths', () => {
    assert.throws(
        () => get_data_body_img2img(
            ...imgArgs({ current_model: SDXL_MODEL, extra_script: 'Tiled Latent Upscale', upscale_config: { scale: 2 } }),
            { pid: {} },
        ),
        /cannot be combined with Native Outpaint or Tiled Latent Upscale/,
    );

    assert.throws(
        () => get_data_body_img2img(
            ...imgArgs({
                current_model: SDXL_MODEL,
                extra_script: 'Native Outpaint',
                inpaint_img_upload_path: '/tmp/canvas.png',
                inpaint_mask_upload_path: '/tmp/mask.png',
                outpaint_config: { size: 8, direction: 'L' },
            }),
            { pid: {} },
        ),
        /cannot be combined with Native Outpaint or Tiled Latent Upscale/,
    );
});
