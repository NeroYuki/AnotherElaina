// Anima inpaint helpers.
//
// The supplied Anima ControlNet checkpoint (006) has a 3-channel input and no
// lllite.inpaint_masked_input metadata. Its author workflow black-fills the
// white-mask edit pixels before the control network, which matches Forge's
// generic `inpaint_noobai` preprocessor. Keep the model/preprocessor pair
// pinned: `inpaint_only` / `inpaint_global_harmonious` emit -1 sentinels and do
// not work with this older checkpoint.

const ANIMA_INPAINT_MODEL = 'animaLllite_006-inpainting'
const ANIMA_INPAINT_PREPROCESSOR = 'inpaint_noobai'

const ANIMA_INPAINT_UNIT_DEFAULTS = Object.freeze({
    model: 'controlnet_inpaint',
    preprocessor: ANIMA_INPAINT_PREPROCESSOR,
    type: 'Inpaint',
    weight: 1,
    mode: 'Balanced',
    resolution: 1024,
    t_a: 32,
    t_b: 200,
})

// Fields a saved/user first-unit config may replace. `model` and `type` stay
// pinned because the Anima replacement must be the inpaint-only model.
const OVERRIDABLE_UNIT_FIELDS = ['weight', 'mode', 'resolution', 't_a', 't_b']

function normalize_model_reference(value) {
    if (typeof value !== 'string') return ''
    return value
        .trim()
        .replaceAll('\\', '/')
        .split('/')
        .pop()
        .replace(/\s*\[[0-9a-f]{6,}\]\s*/gi, '')
        .toLowerCase()
}

function model_stem(value) {
    return normalize_model_reference(value).replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '')
}

/**
 * True when the filename/family belongs to the Anima model selection.
 * Lazy requires keep this module safe to import from ai_server_config without
 * creating a cycle.
 */
function is_anima_model(model) {
    if (!model || typeof model !== 'string') return false

    const { get_model_family } = require('./model_defaults')
    if (get_model_family(model) === 'anima') return true

    const { model_selection_anima } = require('./ai_server_config')
    const target = normalize_model_reference(model)
    if (!target) return false
    return model_selection_anima.some(entry => {
        const candidate = normalize_model_reference(entry.value)
        return candidate === target || model_stem(candidate) === model_stem(target)
    })
}

/**
 * Map any Anima ControlNet request to the one compatible installed checkpoint.
 * Returns the Forge dropdown stem (no extension/hash).
 */
function resolve_anima_controlnet_model(value) {
    if (value === undefined || value === null) return 'None'
    if (typeof value !== 'string') {
        throw new Error(
            `Anima models only support the inpaint ControlNet "${ANIMA_INPAINT_MODEL}"; ` +
            'select ControlNet - Inpaint or None.',
        )
    }

    const trimmed = value.trim()
    if (!trimmed || trimmed.toLowerCase() === 'none') return 'None'
    if (trimmed.toLowerCase() === 'controlnet_inpaint') return ANIMA_INPAINT_MODEL

    const canonical = ANIMA_INPAINT_MODEL.toLowerCase()
    if (normalize_model_reference(trimmed) === canonical || model_stem(trimmed) === canonical) {
        return ANIMA_INPAINT_MODEL
    }

    throw new Error(
        `Anima models only support the Anima inpaint ControlNet "${ANIMA_INPAINT_MODEL}" ` +
        `with the "${ANIMA_INPAINT_PREPROCESSOR}" preprocessor; "${value}" is not compatible. ` +
        'Select ControlNet - Inpaint, the Anima 006 checkpoint, or None.',
    )
}

function parse_overrides(overrides) {
    if (overrides === undefined || overrides === null) return null
    let value = overrides
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value)
        }
        catch (err) {
            throw new Error(`Invalid Anima inpaint overrides: the stored value is not valid JSON (${err.message}).`)
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid Anima inpaint overrides: expected a JSON object.')
    }
    return value
}

/**
 * Build a fresh first ControlNet unit for an Anima model, or null for any
 * other family. The caller owns the actual inference session; this helper only
 * configures the inpaint unit so old Anima LLLite does not multiply the
 * conditioning by the raw mask.
 */
function get_anima_inpaint_unit({ model, preprocessor_override = null, overrides = null } = {}) {
    if (!is_anima_model(model)) return null

    const source = parse_overrides(overrides)
    let preprocessor = ANIMA_INPAINT_PREPROCESSOR
    if (preprocessor_override !== undefined && preprocessor_override !== null) {
        preprocessor = preprocessor_override
    }
    else if (source && source.preprocessor !== undefined && source.preprocessor !== null) {
        preprocessor = source.preprocessor
    }

    if (preprocessor !== ANIMA_INPAINT_PREPROCESSOR) {
        throw new Error(
            `Anima inpaint requires the "${ANIMA_INPAINT_PREPROCESSOR}" preprocessor; ` +
            `"${preprocessor}" is not compatible with ${ANIMA_INPAINT_MODEL}. ` +
            `Use "${ANIMA_INPAINT_PREPROCESSOR}" to black-fill the masked edit pixels.`,
        )
    }

    const unit = { ...ANIMA_INPAINT_UNIT_DEFAULTS }
    if (source) {
        for (const field of OVERRIDABLE_UNIT_FIELDS) {
            const value = source[field]
            if (value !== undefined && value !== null) unit[field] = value
        }
    }
    unit.preprocessor = preprocessor
    return unit
}

module.exports = {
    ANIMA_INPAINT_MODEL,
    ANIMA_INPAINT_PREPROCESSOR,
    is_anima_model,
    resolve_anima_controlnet_model,
    get_anima_inpaint_unit,
}
