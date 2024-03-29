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

module.exports = {
    get_coupler_config_from_prompt,
    get_color_grading_config_from_prompt
}