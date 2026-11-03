const sharp = require('sharp');
const { MAX_TARGET_DIMENSION, resolve_supported_family } = require('./forge_img2img_scripts');

function normalize_outpaint_config(raw) {
    let value = raw ?? {};
    if (typeof value === 'string') {
        try { value = JSON.parse(value); }
        catch { throw new Error('Invalid Native Outpaint config: the stored value is not valid JSON.'); }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid Native Outpaint config: expected a JSON object.');
    }
    const integer = (key, fallback, maximum, step = 1) => {
        const raw_number = value[key] ?? fallback;
        const number = Number(raw_number);
        if (typeof raw_number === 'boolean' || raw_number === '' || !Number.isInteger(number)) {
            throw new Error(`Invalid Native Outpaint config: "${key}" must be a finite integer.`);
        }
        return Math.ceil(Math.min(maximum, Math.max(0, number)) / step) * step;
    };
    const names = { l: 'left', r: 'right', u: 'up', d: 'down' };
    let direction = value.direction ?? ['left', 'right', 'up', 'down'];
    if (typeof direction === 'string' && /^[lrud]+$/i.test(direction)) {
        direction = direction.toLowerCase().split('').map(letter => names[letter]);
    }
    if (!Array.isArray(direction) || !direction.length || direction.some(side => !Object.values(names).includes(side))) {
        throw new Error('Invalid outpaint direction: use LRUD or a list of left, right, up, down.');
    }
    // Old falloff_exp/color_var fields belonged to the removed script and are ignored.
    return {
        size: integer('size', 128, 512, 8),
        mask_blur: integer('mask_blur', 32, 64),
        overlap: integer('overlap', 64, 256, 8),
        direction: [...new Set(direction)],
        top: integer('top', 0, 512, 8),
        bottom: integer('bottom', 0, 512, 8),
        left: integer('left', 0, 512, 8),
        right: integer('right', 0, 512, 8),
    };
}

function get_outpaint_geometry({ model, width, height, config } = {}) {
    const family = resolve_supported_family(model);
    if (family !== 'sd' && family !== 'xl') {
        throw new Error('Native Outpaint supports SD1/SDXL checkpoints only. Select an SD1/SDXL checkpoint; Qwen/MOSS masked outpainting is not supported.');
    }
    const normalized = normalize_outpaint_config(config);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width % 8 || height % 8) {
        throw new Error('Native Outpaint requires positive base dimensions divisible by 8.');
    }
    const padding = Object.fromEntries(Object.entries({ left: 'left', right: 'right', top: 'up', bottom: 'down' })
        .map(([side, direction]) => [side, normalized.direction.includes(direction) ? normalized[side] || normalized.size : 0]));
    if (!Object.values(padding).some(Boolean)) throw new Error('Native Outpaint needs padding on at least one selected side.');
    // Only sides that actually grow get an overlap strip, capped per axis so at least half of the source stays protected.
    const horizontal_cap = Math.floor(width / 4 / 8) * 8;
    const vertical_cap = Math.floor(height / 4 / 8) * 8;
    const overlap = Object.fromEntries(Object.keys(padding).map(side => {
        const cap = side === 'left' || side === 'right' ? horizontal_cap : vertical_cap;
        return [side, padding[side] ? Math.min(normalized.overlap, cap) : 0];
    }));
    const target_width = width + padding.left + padding.right;
    const target_height = height + padding.top + padding.bottom;
    if (target_width > MAX_TARGET_DIMENSION || target_height > MAX_TARGET_DIMENSION) {
        throw new Error(`Native Outpaint target exceeds the ${MAX_TARGET_DIMENSION}px limit. Use a smaller source or padding.`);
    }
    return { width: target_width, height: target_height, source_width: width, source_height: height, family, ...padding, overlap, config: normalized };
}

async function prepare_native_outpaint({ image, ...options }) {
    const geometry = get_outpaint_geometry(options);
    let input = image;
    if (typeof input === 'string') {
        const match = input.match(/^data:image\/[^;,]+;base64,(.+)$/s);
        if (!match) throw new Error('Native Outpaint requires an image attachment.');
        input = Buffer.from(match[1], 'base64');
    }
    if (!Buffer.isBuffer(input)) throw new Error('Native Outpaint requires an image attachment.');
    const { width, height, source_width, source_height, left, top, overlap } = geometry;
    const resized = await sharp(input).resize(source_width, source_height, { fit: 'cover' })
        .removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    const source = resized.data;
    const canvas_pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
        const source_y = Math.min(source_height - 1, Math.max(0, y - top));
        const source_row = source_y * source_width * 3;
        const row = y * width * 3;
        // Extend each source row's first/last pixel into the padding, so edges and corners are nearest-edge colour.
        canvas_pixels.fill(source.subarray(source_row, source_row + 3), row, row + left * 3);
        source.copy(canvas_pixels, row + left * 3, source_row, source_row + source_width * 3);
        canvas_pixels.fill(source.subarray(source_row + (source_width - 1) * 3, source_row + source_width * 3),
            row + (left + source_width) * 3, row + width * 3);
    }
    const canvas = await sharp(canvas_pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    // White in the padding and overlap strips; black protects the core that native inpainting must not repaint.
    const mask_pixels = Buffer.alloc(width * height, 255);
    const core_left = left + overlap.left;
    const core_right = left + source_width - overlap.right;
    const core_top = top + overlap.top;
    const core_bottom = top + source_height - overlap.bottom;
    for (let y = core_top; y < core_bottom; y++) mask_pixels.fill(0, y * width + core_left, y * width + core_right);
    const mask = await sharp(mask_pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
    return { ...geometry, canvas, mask };
}

module.exports = { normalize_outpaint_config, get_outpaint_geometry, prepare_native_outpaint };
