const imggen_default = require('../resources/imggen_default_config.json')
const {
    model_selection, model_selection_xl, model_selection_flux, model_selection_chroma,
    model_selection_flux_klein_4b, model_selection_flux_klein_9b,
    model_selection_anima, model_selection_lumina, model_selection_qwen21, model_selection_moss,
    model_selection_z_image, model_selection_krea
} = require('./ai_server_config')

// Variant-specific default key prefixes. Values fall back to the base family.
const MODEL_DEFAULT_VARIANTS = {
    'qwen_image_2.1_turbo_int8_convrot.safetensors': 'qwen21_turbo',
}

/**
 * Determines the model family string (matches JSON key prefix) for a given checkpoint.
 * Returns null for unknown/unlisted models.
 */
function get_model_family(modelName) {
    if (!modelName) return null
    if (model_selection_flux.find(x => x.value === modelName) || model_selection_chroma.find(x => x.value === modelName)) return 'flux'
    if (model_selection_flux_klein_4b.find(x => x.value === modelName) || model_selection_flux_klein_9b.find(x => x.value === modelName)) return 'klein'
    if (model_selection_anima.find(x => x.value === modelName))       return 'anima'
    if (model_selection_lumina.find(x => x.value === modelName))      return 'lumina'
    if (model_selection_qwen21.find(x => x.value === modelName))      return 'qwen21'
    if (model_selection_moss.find(x => x.value === modelName))        return 'moss'
    if (model_selection_z_image.find(x => x.value === modelName))     return 'zit'
    if (model_selection_krea.find(x => x.value === modelName))        return 'krea'
    if (model_selection_xl.find(x => x.value === modelName))          return 'xl'
    if (model_selection.find(x => x.value === modelName))             return 'sd'
    return null
}

/**
 * Returns per-family generation defaults from imggen_default_config.json.
 * Fields not defined for a family are returned as null (meaning "no override").
 * @param {string} modelName  - Checkpoint filename (value from model_selection arrays)
 * @param {'t2i'|'i2i'} type  - Generation mode; hires (hr) values always use the t2i variant
 * @returns {{ sampler, scheduler, step, hr_step, cfg, hr_cfg, dcfg, hr_dcfg } | null}
 */
function get_model_family_defaults(modelName, type = 't2i') {
    const family = get_model_family(modelName)
    if (!family) return null

    const d = imggen_default
    const t = type
    const variant = MODEL_DEFAULT_VARIANTS[modelName]
    const prefixes = variant ? [variant, family] : [family]
    const read = (field) => {
        for (const prefix of prefixes) {
            const value = d[`${prefix}_${field}`]
            if (value !== undefined && value !== null) return value
        }
        return null
    }

    return {
        sampler:    read(`${t}_sampler`),
        scheduler:  read(`${t}_scheduler`),
        step:       read(`${t}_step`),
        hr_step:    read(`t2i_hr_step`),     // hires only applies to t2i
        cfg:        read(`${t}_cfg`),
        hr_cfg:     read(`t2i_hr_cfg`),
        dcfg:       read(`${t}_dcfg`),
        hr_dcfg:    read(`t2i_hr_dcfg`),
    }
}

module.exports = { get_model_family_defaults, get_model_family }
