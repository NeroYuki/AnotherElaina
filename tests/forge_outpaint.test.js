const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { normalize_outpaint_config, get_outpaint_geometry, prepare_native_outpaint } = require('../utils/forge_outpaint');
const { normalize_extra_script, prepare_tiled_upscale } = require('../utils/forge_img2img_scripts');
const { get_data_body_img2img } = require('../utils/ai_server_config');

const model = 'juggernautxl_inpaint.safetensors';

test('native outpaint migrates old settings, keeps explicit zeros, and validates geometry', () => {
    const defaults = normalize_outpaint_config({ size: 128, direction: 'LRUD' });
    assert.equal(defaults.mask_blur, 32);
    assert.equal(defaults.overlap, 64);
    // Stored configs from before overlap existed keep a custom mask blur.
    assert.equal(normalize_outpaint_config({ mask_blur: 24 }).mask_blur, 24);
    assert.equal(normalize_outpaint_config({ mask_blur: 0 }).mask_blur, 0);
    assert.equal(normalize_outpaint_config({ overlap: 0 }).overlap, 0);
    assert.equal(normalize_outpaint_config({ overlap: 12 }).overlap, 16);
    assert.equal(normalize_outpaint_config({ overlap: 400 }).overlap, 256);

    const legacy = { size: 127, mask_blur: 0, direction: ['left', 'right'], right: 64, falloff_exp: 1, color_var: 0.05 };
    const original = structuredClone(legacy);
    const result = get_outpaint_geometry({ model, width: 512, height: 512, config: JSON.stringify(legacy) });
    assert.equal(result.width, 704);
    assert.equal(result.height, 512);
    assert.equal(result.left, 128);
    assert.equal(result.right, 64);
    assert.equal(result.top, 0);
    assert.equal(result.config.mask_blur, 0);
    assert.equal(result.config.overlap, 64);
    assert.deepEqual(result.overlap, { left: 64, right: 64, top: 0, bottom: 0 });
    assert.equal(result.config.falloff_exp, undefined);
    assert.deepEqual(legacy, original);
    assert.deepEqual(normalize_outpaint_config({ direction: 'lUd' }).direction, ['left', 'up', 'down']);
    assert.throws(() => normalize_outpaint_config('{broken'), /valid JSON/);
    assert.throws(() => normalize_outpaint_config({ size: NaN }), /finite integer/);
    assert.throws(() => normalize_outpaint_config({ direction: 'north' }), /direction/);
    assert.throws(() => get_outpaint_geometry({ model, width: 512, height: 512, config: { size: 0 } }), /at least one/);
    assert.throws(() => get_outpaint_geometry({ model, width: 8192, height: 512 }), /limit/);
    for (const unsupported of ['qwen_image_2.1_int8_convrot.safetensors', 'moss_image_sft_bf16.safetensors', 'flux1-dev-Q8_0.gguf']) {
        assert.throws(() => get_outpaint_geometry({ model: unsupported, width: 512, height: 512 }), /SD1\/SDXL/);
    }
});

test('archived basenames and mapped inpaint models pass the SDXL gate', () => {
    for (const selected of ['juggernautxl_turbo.safetensors', 'archive\\realvisxl_v5.safetensors', 'realvisxl_v3_inpaint.safetensors', model]) {
        assert.equal(prepare_tiled_upscale({ model: selected, width: 512, height: 512, config: { scale: 1 } }).family, 'xl');
        assert.equal(get_outpaint_geometry({ model: selected, width: 512, height: 512 }).width, 768);
    }
});

test('outpaint overlap only applies to padded sides and is capped per axis', () => {
    const all_sides = get_outpaint_geometry({ model, width: 64, height: 32, config: { size: 8, direction: 'LRUD', overlap: 64 } });
    assert.deepEqual(all_sides.overlap, { left: 16, right: 16, top: 8, bottom: 8 });
    assert.equal(all_sides.width, 80);
    assert.equal(all_sides.height, 48);

    const left_only = get_outpaint_geometry({ model, width: 512, height: 512, config: { size: 16, direction: 'L' } });
    assert.deepEqual(left_only.overlap, { left: 64, right: 0, top: 0, bottom: 0 });
    assert.equal(left_only.right, 0);

    const disabled = get_outpaint_geometry({ model, width: 512, height: 512, config: { direction: 'R', overlap: 0 } });
    assert.deepEqual(disabled.overlap, { left: 0, right: 0, top: 0, bottom: 0 });

    // A source side only 8px long cannot spare a quarter of itself as a multiple of 8px.
    const tiny = get_outpaint_geometry({ model, width: 8, height: 16, config: { size: 8, direction: 'LRUD', overlap: 64 } });
    assert.deepEqual(tiny.overlap, { left: 0, right: 0, top: 0, bottom: 0 });
});

test('outpaint canvas extends nearest edge pixels and keeps the source exact', async () => {
    const source_width = 64;
    const source_height = 32;
    const raw = Buffer.alloc(source_width * source_height * 3);
    for (let y = 0; y < source_height; y++) {
        for (let x = 0; x < source_width; x++) {
            const index = (y * source_width + x) * 3;
            raw[index] = (x * 4 + y * 3) % 256;
            raw[index + 1] = (y * 8 + x) % 256;
            raw[index + 2] = (x * 7 + y * 13) % 256;
        }
    }
    const source = await sharp(raw, { raw: { width: source_width, height: source_height, channels: 3 } }).png().toBuffer();
    const prepared = await prepare_native_outpaint({
        image: source, model, width: source_width, height: source_height,
        config: { size: 8, direction: 'LRUD', overlap: 8, mask_blur: 0 },
    });
    assert.equal(prepared.width, 80);
    assert.equal(prepared.height, 48);
    const canvas = await sharp(prepared.canvas).removeAlpha().raw().toBuffer();
    assert.equal(canvas.length, 80 * 48 * 3);

    const expected = Buffer.alloc(80 * 48 * 3);
    for (let y = 0; y < 48; y++) {
        const source_y = Math.min(source_height - 1, Math.max(0, y - 8));
        for (let x = 0; x < 80; x++) {
            const source_x = Math.min(source_width - 1, Math.max(0, x - 8));
            const from = (source_y * source_width + source_x) * 3;
            raw.copy(expected, (y * 80 + x) * 3, from, from + 3);
        }
    }
    assert.ok(canvas.equals(expected), 'padding repeats the nearest edge pixel through the corners; source pixels stay exact');
    const canvas_pixel = (x, y) => canvas.subarray((y * 80 + x) * 3, (y * 80 + x) * 3 + 3);
    const source_pixel = (x, y) => raw.subarray((y * source_width + x) * 3, (y * source_width + x) * 3 + 3);
    assert.ok(canvas_pixel(0, 0).equals(source_pixel(0, 0)), 'top-left corner');
    assert.ok(canvas_pixel(79, 47).equals(source_pixel(source_width - 1, source_height - 1)), 'bottom-right corner');
});

test('outpaint canvas normalizes greyscale and alpha inputs to three channels', async () => {
    const grey = await sharp(Buffer.alloc(16 * 16, 77), { raw: { width: 16, height: 16, channels: 1 } }).png().toBuffer();
    const rgba = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
    for (const image of [grey, rgba]) {
        const prepared = await prepare_native_outpaint({
            image, model, width: 16, height: 16, config: { size: 8, direction: 'L', overlap: 0, mask_blur: 0 },
        });
        const metadata = await sharp(prepared.canvas).metadata();
        assert.equal(metadata.channels, 3);
    }
    const grey_prepared = await prepare_native_outpaint({
        image: grey, model, width: 16, height: 16, config: { size: 8, direction: 'L', overlap: 0, mask_blur: 0 },
    });
    const grey_canvas = await sharp(grey_prepared.canvas).raw().toBuffer();
    assert.ok(grey_canvas.every(value => value === 77));
});

test('outpaint mask covers padding and overlap while protecting the core', async () => {
    const source = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#ac1832' } }).png().toBuffer();
    const prepared = await prepare_native_outpaint({
        image: source, model, width: 64, height: 32, config: { size: 8, direction: 'LRUD', overlap: 8, mask_blur: 0 },
    });
    const mask = await sharp(prepared.mask).greyscale().raw().toBuffer();
    const expected = Buffer.alloc(80 * 48, 255);
    for (let y = 16; y < 32; y++) expected.fill(0, y * 80 + 16, y * 80 + 64);
    assert.ok(mask.equals(expected));
    assert.equal(mask[24 * 80 + 8], 255, 'left overlap strip inside the source is repainted');
    assert.equal(mask[24 * 80 + 15], 255);
    assert.equal(mask[24 * 80 + 16], 0, 'protected core starts after the overlap');
    assert.equal(mask[15 * 80 + 32], 255, 'top overlap strip inside the source is repainted');
    assert.equal(mask[16 * 80 + 32], 0);
    assert.equal(mask[8 * 80 + 20], 255, 'padding stays white');

    const plain = await prepare_native_outpaint({
        image: source, model, width: 64, height: 32, config: { size: 8, direction: 'LRUD', overlap: 0, mask_blur: 0 },
    });
    const plain_mask = await sharp(plain.mask).greyscale().raw().toBuffer();
    assert.equal(plain_mask[0], 255);
    assert.equal(plain_mask[8 * 80 + 7], 255);
    for (let y = 8; y < 40; y++) {
        for (let x = 8; x < 72; x++) assert.equal(plain_mask[y * 80 + x], 0);
    }
});

test('old and new outpaint selections produce supported native Gradio inpainting payloads', () => {
    for (const script of ['Native Outpaint', 'Outpainting mk2']) {
        assert.equal(normalize_extra_script(script), 'Native Outpaint');
        const args = [0, 'scene', '', 24, 5, 1234, 'Euler', 'Normal', 'session', 512, 768, null, null, 1];
        args[31] = model;
        args[32] = '/tmp/canvas.png';
        args[33] = '/tmp/mask.png';
        args[35] = { seedvr2_model: 'example.gguf' };
        args[36] = { mask_blur: 24 };
        args[38] = script;
        const data = get_data_body_img2img(...args);
        assert.equal(data.length, 310);
        assert.equal(data[1], 4);
        assert.equal(data[5], null);
        assert.equal(data[12].path, '/tmp/canvas.png');
        assert.equal(data[13].path, '/tmp/mask.png');
        assert.equal(data[14], 24);
        assert.equal(data[16], 'fill');
        assert.equal(data[27], 'Just Resize');
        assert.equal(data[28], 'Whole picture');
        assert.equal(data[40], 'None');
        assert.equal(data[235], false);
        args[36] = {};
        assert.equal(get_data_body_img2img(...args)[14], 32, 'new default mask blur');
        args[36] = { mask_blur: 0 };
        assert.equal(get_data_body_img2img(...args)[14], 0, 'explicit zero is kept');
        args[33] = null;
        assert.throws(() => get_data_body_img2img(...args), /uploads/);
    }
});

test('outpaint settings keep explicit zero and omit controls from the removed script', async () => {
    const command = require('../commands/wd_script/outpaint');
    const option = command.data.toJSON().options.find(option => option.name === 'set');
    const names = option.options.map(option => option.name);
    assert.equal(names.includes('overlap'), true, 'overlap is exposed');
    assert.equal(names.some(name => ['falloff_exp', 'color_var'].includes(name)), false);
    assert.match(option.options.find(option => option.name === 'overlap').description, /default is 64/);
    assert.match(option.options.find(option => option.name === 'mask_blur').description, /default is 32/);

    const client = { img2img_outpaint_config: new Map() };
    const interaction = {
        user: { id: 'test' },
        options: { getSubcommand: () => 'set', getInteger: name => name === 'mask_blur' || name === 'overlap' ? 0 : null, getString: () => 'LR' },
        async reply() {}, channel: { async send() {} },
    };
    await command.execute(interaction, client);
    const saved = JSON.parse(client.img2img_outpaint_config.get('test'));
    assert.equal(saved.mask_blur, 0);
    assert.equal(saved.overlap, 0);
    assert.equal(saved.size, 128);

    const defaults_interaction = {
        user: { id: 'defaults' },
        options: { getSubcommand: () => 'set', getInteger: () => null, getString: () => 'LR' },
        async reply() {}, channel: { async send() {} },
    };
    await command.execute(defaults_interaction, client);
    const defaulted = JSON.parse(client.img2img_outpaint_config.get('defaults'));
    assert.equal(defaulted.mask_blur, 32);
    assert.equal(defaulted.overlap, 64);
});
