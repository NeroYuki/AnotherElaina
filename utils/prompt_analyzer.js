function get_coupler_config_from_prompt(prompt) {
    // check if if prompt contain <=> or ||
    // if found, return the value {direction: <Horizontal if <=>, Vertical if ||>, global: <"First Line" if first subject start with [GLOBAL], "Last Line" if last subject start with [GLOBAL], "None" otherwise>}

    const coupler_pattern = /(\|{2}|<=>)/gi

    const coupler_match = prompt.match(coupler_pattern)

    if (coupler_match && coupler_match[0]) {

        const comp = prompt.replace(coupler_pattern, '\n').split("\n")
        let global_config = 'None'

        if (comp[0].includes('[GLOBAL]')) {
            global_config = 'First Line'
        }

        if (comp[comp.length - 1].includes('[GLOBAL]')) {
            global_config = 'Last Line'
        }

        return {
            prompt: prompt.replace(coupler_pattern, '\n').replace('[GLOBAL]', '').trim(),
            coupler_config: {
                direction: coupler_match[0] === '<=>' ? 'Horizontal' : 'Vertical',
                global: global_config
            }
        }
    }

    return {
        prompt: prompt,
        coupler_config: null
    }

}

function get_color_grading_config_from_prompt(prompt, is_xl) {
    // check for following pattern in prompt: |cg: <value>, norm|
    // if found, return the value {method: is_xl ? 'XL' : '1.5', weight: <value>, normalizer: <if norm is found>}
    // else return null

    const cg_pattern = /\|cg: ([0-9.]+).*\|/i

    const cg_match = prompt.match(cg_pattern)

    if (cg_match && cg_match[0]) {
        const norm_pattern = /norm/i
        const norm_match = cg_match[0].match(norm_pattern)
        const weight_pattern = /([0-9.]+)/i
        const weight_match = cg_match[0].match(weight_pattern)

        return {
            prompt: prompt.replace(cg_pattern, ''),
            color_grading_config: {
                method: is_xl ? 'XL' : '1.5',
                weight: parseFloat(weight_match[0] || 0),
                normalize: norm_match ? true : false
            }
        }
    }
    
    return {
        prompt: prompt,
        color_grading_config: null
    }
}

function get_freeu_config_from_prompt(prompt) {
    // check for following pattern in prompt |freeu: <value, value, value, value>|
    // if found, return the value {values: <array of values>}
    // else return null

    const freeu_pattern = /\|freeu: ([0-9., ]+).*\|/i

    const freeu_match = prompt.match(freeu_pattern)

    if (freeu_match && freeu_match[0]) {
        const values_pattern = /([0-9.]+)/gi
        const values_match = freeu_match[0].match(values_pattern)

        const temp_value = new Array(4).fill(1)
        values_match.forEach((x, i) => {
            if (i < 4) temp_value[i] = parseFloat(x)
        })

        return {
            prompt: prompt.replace(freeu_pattern, ''),
            freeu_config: {
                values: temp_value
            }
        }
    }

    return {
        prompt: prompt,
        freeu_config: null
    }
}

function get_dynamic_threshold_config_from_prompt(prompt) {
    // check for following pattern in prompt |dt: <mimic_scale>, <mimic percentile>|
    // if found, return the value {mimic_scale: <value>, mimic_percentile: <value>}
    // else return null

    const dt_pattern = /\|dt: ([0-9.]+), ([0-9.]+).*\|/i

    const dt_match = prompt.match(dt_pattern)

    if (dt_match && dt_match[0]) {
        const values_pattern = /([0-9.]+)/gi
        const values_match = dt_match[0].match(values_pattern)

        return {
            prompt: prompt.replace(dt_pattern, ''),
            dynamic_threshold_config: {
                mimic_scale: parseFloat(values_match[0]) || 7,
                mimic_percentile: parseFloat(values_match[1]) || 0.95
            }
        }
    }

    return {
        prompt: prompt,
        dynamic_threshold_config: null
    }
}

function full_prompt_analyze(prompt, is_xl) {
    let coupler_config = get_coupler_config_from_prompt(prompt)
    let color_grading_config = get_color_grading_config_from_prompt(coupler_config.prompt, is_xl)
    let freeu_config = get_freeu_config_from_prompt(color_grading_config.prompt)
    let dynamic_threshold_config = get_dynamic_threshold_config_from_prompt(freeu_config.prompt)

    return {
        prompt: dynamic_threshold_config.prompt,
        coupler_config: coupler_config.coupler_config,
        color_grading_config: color_grading_config.color_grading_config,
        freeu_config: freeu_config.freeu_config,
        dynamic_threshold_config: dynamic_threshold_config.dynamic_threshold_config
    }
}

module.exports = {
    get_coupler_config_from_prompt,
    get_color_grading_config_from_prompt,
    get_freeu_config_from_prompt,
    get_dynamic_threshold_config_from_prompt,
    full_prompt_analyze
}