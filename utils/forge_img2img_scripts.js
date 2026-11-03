// Shared helpers for the Forge img2img extra-script replacements.
//
// Keep this module free of top-level requires from ai_server_config/model_defaults:
// ai_server_config uses these helpers while building the positional Gradio payload,
// and model_defaults in turn reads ai_server_config. Unsupported-model checks are
// therefore resolved lazily inside prepare_tiled_upscale().

const TILED_UPSCALE_SCRIPT = 'Tiled Latent Upscale';
const LEGACY_UPSCALE_SCRIPT = 'Ultimate SD upscale';
const NATIVE_OUTPAINT_SCRIPT = 'Native Outpaint';
const LEGACY_OUTPAINT_SCRIPT = 'Outpainting mk2';
const TILED_UPSCALE_METHODS = ['Mixture of Diffusers', 'MultiDiffusion'];
const MAX_TARGET_DIMENSION = 8192;

const DEFAULT_TILED_UPSCALE_CONFIG = Object.freeze({
    scale: 2,
    method: 'Mixture of Diffusers',
    tile_width: 1024,
    tile_height: 0,
    tile_overlap: 128,
    tile_batch_size: 1,
});

function is_tiled_upscale_script(value) {
    return value === TILED_UPSCALE_SCRIPT || value === LEGACY_UPSCALE_SCRIPT;
}

// Stale Discord interactions can still submit the retired value. Normalize it
// before it reaches any command branch or the Forge payload.
function normalize_extra_script(value) {
    if (value === LEGACY_OUTPAINT_SCRIPT) return NATIVE_OUTPAINT_SCRIPT;
    return value === LEGACY_UPSCALE_SCRIPT ? TILED_UPSCALE_SCRIPT : value;
}

function config_error(message) {
    return new Error(`Invalid Tiled Latent Upscale config: ${message}`);
}

function read_finite_number(raw, key, fallback) {
    const value = raw[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean' || value === '') {
        throw config_error(`"${key}" must be a finite number.`);
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        throw config_error(`"${key}" must be a finite number.`);
    }
    return parsed;
}

function read_integer(raw, key, fallback) {
    const parsed = read_finite_number(raw, key, fallback);
    if (!Number.isInteger(parsed)) {
        throw config_error(`"${key}" must be an integer.`);
    }
    return parsed;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function align(value, step) {
    return Math.round(value / step) * step;
}

function normalize_method(value) {
    if (value === undefined || value === null) return DEFAULT_TILED_UPSCALE_CONFIG.method;
    if (typeof value !== 'string') throw config_error('"method" must be "Mixture of Diffusers" or "MultiDiffusion".');
    const method = TILED_UPSCALE_METHODS.find(candidate => candidate.toLowerCase() === value.toLowerCase());
    if (!method) throw config_error('"method" must be "Mixture of Diffusers" or "MultiDiffusion".');
    return method;
}

/**
 * Normalize a persisted/raw tiled-upscale config into a fresh object.
 *
 * Accepts either a JSON string or an object. Legacy Ultimate SD Upscale fields
 * (padding, seam_fix*, upscaler, ...) are tolerated but ignored, except padding
 * which provides the overlap when no tile_overlap was stored.
 */
function normalize_upscale_config(raw) {
    let value = raw;
    if (value === undefined || value === null) {
        value = {};
    }
    else if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        }
        catch (err) {
            throw config_error('the stored value is not valid JSON.');
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw config_error('expected a JSON object.');
    }

    const raw_scale = (value.scale !== undefined && value.scale !== null)
        ? read_finite_number(value, 'scale', DEFAULT_TILED_UPSCALE_CONFIG.scale)
        : read_finite_number(value, 'upscale_multiplier', DEFAULT_TILED_UPSCALE_CONFIG.scale);
    const scale = clamp(raw_scale, 1, 4);
    const method = normalize_method(value.method);
    const tile_width = clamp(
        align(read_integer(value, 'tile_width', DEFAULT_TILED_UPSCALE_CONFIG.tile_width), 64),
        256,
        2048,
    );

    const raw_tile_height = read_integer(value, 'tile_height', DEFAULT_TILED_UPSCALE_CONFIG.tile_height);
    const tile_height = raw_tile_height === 0
        ? tile_width
        : clamp(align(raw_tile_height, 64), 256, 2048);

    let raw_overlap;
    if (value.tile_overlap !== undefined && value.tile_overlap !== null) {
        raw_overlap = read_integer(value, 'tile_overlap', DEFAULT_TILED_UPSCALE_CONFIG.tile_overlap);
    }
    else if (value.padding !== undefined && value.padding !== null) {
        // Ultimate SD Upscale's padding added margin on each side of a tile.
        raw_overlap = 2 * read_integer(value, 'padding', 0);
    }
    else {
        raw_overlap = DEFAULT_TILED_UPSCALE_CONFIG.tile_overlap;
    }

    const tile_overlap = raw_overlap === 0 ? 0 : Math.min(1024, align(raw_overlap, 16));
    if (raw_overlap < 0) {
        throw config_error('"tile_overlap" cannot be negative.');
    }
    if (tile_overlap >= Math.min(tile_width, tile_height)) {
        throw config_error(`"tile_overlap" (${tile_overlap}) must be smaller than both tile dimensions (${tile_width}x${tile_height}).`);
    }

    const tile_batch_size = clamp(
        read_integer(value, 'tile_batch_size', DEFAULT_TILED_UPSCALE_CONFIG.tile_batch_size),
        1,
        8,
    );

    return {
        scale,
        method,
        tile_width,
        tile_height,
        tile_overlap,
        tile_batch_size,
    };
}

function resolve_supported_family(model) {
    if (!model) return null;

    // Lazy requires avoid a cycle with ai_server_config, which imports this file.
    const { get_model_family } = require('./model_defaults');
    const { model_selection_inpaint, model_selection, model_selection_xl } = require('./ai_server_config');

    let family = get_model_family(model);
    if (family) return family;

    // Forge's active-model cache stores basenames, including for archive models.
    const basename = value => value.replaceAll('\\', '/').split('/').pop().toLowerCase();
    const mapped = model_selection_inpaint.find(entry => basename(entry.inpaint) === basename(model));
    if (mapped) family = get_model_family(mapped.value);
    if (!family && model_selection_xl.some(entry => basename(entry.value) === basename(model))) family = 'xl';
    if (!family && model_selection.some(entry => basename(entry.value) === basename(model))) family = 'sd';

    return family;
}

/**
 * Validate a tiled-upscale request and calculate the final output dimensions.
 * The source image stays the img2img input; only width/height need to be scaled
 * because Forge's Latent Upscale resize mode handles the latent expansion.
 */
function prepare_tiled_upscale({ model, width, height, config } = {}) {
    const normalized = normalize_upscale_config(config);

    const base_width = Number(width);
    const base_height = Number(height);
    if (!Number.isFinite(base_width) || base_width <= 0) {
        throw new Error('Tiled Latent Upscale requires a positive base width.');
    }
    if (!Number.isFinite(base_height) || base_height <= 0) {
        throw new Error('Tiled Latent Upscale requires a positive base height.');
    }

    const family = resolve_supported_family(model);
    if (family !== 'sd' && family !== 'xl') {
        throw new Error(
            `Tiled Latent Upscale supports SD1/SDXL checkpoints only; "${model || 'unknown'}" is not supported. ` +
            'Select an SD1/SDXL checkpoint or choose another extra script.',
        );
    }

    const target_width = Math.ceil((base_width * normalized.scale) / 8) * 8;
    const target_height = Math.ceil((base_height * normalized.scale) / 8) * 8;
    if (target_width > MAX_TARGET_DIMENSION || target_height > MAX_TARGET_DIMENSION) {
        throw new Error(
            `Tiled Latent Upscale target size ${target_width}x${target_height} exceeds the ${MAX_TARGET_DIMENSION}px limit. ` +
            'Use a smaller base size or lower scale.',
        );
    }

    // The normalizer validates overlap < tile dimensions; assert the stride
    // explicitly so a future default change cannot produce a non-advancing tiler.
    if (normalized.tile_width - normalized.tile_overlap <= 0 || normalized.tile_height - normalized.tile_overlap <= 0) {
        throw config_error('tile overlap must leave a positive tile stride.');
    }

    return {
        width: target_width,
        height: target_height,
        config: normalized,
        family,
    };
}

module.exports = {
    TILED_UPSCALE_SCRIPT,
    LEGACY_UPSCALE_SCRIPT,
    NATIVE_OUTPAINT_SCRIPT,
    LEGACY_OUTPAINT_SCRIPT,
    TILED_UPSCALE_METHODS,
    MAX_TARGET_DIMENSION,
    DEFAULT_TILED_UPSCALE_CONFIG,
    is_tiled_upscale_script,
    normalize_extra_script,
    normalize_upscale_config,
    prepare_tiled_upscale,
    resolve_supported_family,
};
