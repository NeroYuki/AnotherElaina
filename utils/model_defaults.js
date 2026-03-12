const imggen_default = require('../resources/imggen_default_config.json')
const {
    model_selection, model_selection_xl, model_selection_flux, model_selection_chroma,
    model_selection_flux_klein_4b, model_selection_flux_klein_9b,
    model_selection_anima, model_selection_lumina, model_selection_qwen_image, model_selection_z_image
} = require('./ai_server_config')

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
    if (model_selection_qwen_image.find(x => x.value === modelName))  return 'qwen'
    if (model_selection_z_image.find(x => x.value === modelName))     return 'zit'
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
    const f = family
    const t = type

    return {
        sampler:    d[`${f}_${t}_sampler`]    ?? null,
        scheduler:  d[`${f}_${t}_scheduler`]  ?? null,
        step:       d[`${f}_${t}_step`]       ?? null,
        hr_step:    d[`${f}_t2i_hr_step`]     ?? null,   // hires only applies to t2i
        cfg:        d[`${f}_${t}_cfg`]        ?? null,
        hr_cfg:     d[`${f}_t2i_hr_cfg`]      ?? null,
        dcfg:       d[`${f}_${t}_dcfg`]       ?? null,
        hr_dcfg:    d[`${f}_t2i_hr_dcfg`]     ?? null,
    }
}

module.exports = { get_model_family_defaults, get_model_family }
