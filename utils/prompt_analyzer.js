const { server_pool } = require("./ai_server_config")

function get_coupler_config_from_prompt(prompt) {
    // check if if prompt contain <=> or ||
    // if found, return the value {direction: <Horizontal if <=>, Vertical if ||>, global: <"First Line" if first subject start with [GLOBAL], "Last Line" if last subject start with [GLOBAL], "None" otherwise>}

    const coupler_pattern = /(\|{2}|<=>)/gi

    const coupler_match = prompt.match(coupler_pattern)

    if (coupler_match && coupler_match[0]) {

        const comp = prompt.replace(coupler_pattern, '\n').split("\n")
        let global_config = 'None'
        let global_weight = 0

        // match for [GLOBAL] and [GLOBAL:<value>]
        const global_pattern_replace = /\[GLOBAL(:[0-9.]+)?\]/gi
        const global_pattern = /\[GLOBAL(:[0-9.]+)?\]/i

        if (comp[0].match(global_pattern)) {
            global_config = 'First Line'

            // if [GLOBAL:<value>] is found, parse the value
            const global_match = comp[0].match(global_pattern)
            if (global_match[1]) {
                global_weight = parseFloat(global_match[1].slice(1))
            }
        }
        else if (comp[comp.length - 1].match(global_pattern)) {
            global_config = 'Last Line'

            // if [GLOBAL:<value>] is found, parse the value
            const global_match = comp[comp.length - 1].match(global_pattern)
            if (global_match[1]) {
                global_weight = parseFloat(global_match[1].slice(1))
            }
        }

        adv_regions = []
        
        const adv_pattern_replace = /\|([0-9.]+):([0-9.]+),([0-9.]+):([0-9.]+),([0-9.]+)\|/gi
        // iterate through comp (except the global line) to check if it use advance region
        for (let i = 0; i < comp.length; i++) {
            // advance region syntax is |<x_start_fraction>:<x_end_fraction>,<y_start_fraction>:<y:end_fraction>,<w>|, all >=0 and <=1 and start < end
            // if found, push ["x_start:x_end", "y_start:y_end", "w"] to adv_region

            const adv_pattern = /\|([0-9.]+):([0-9.]+),([0-9.]+):([0-9.]+),([0-9.]+)\|/i
            const adv_match = comp[i].match(adv_pattern)

            if (adv_match) {
                console.log(adv_match)
                // value check
                const start_x = parseFloat(adv_match[1])
                const end_x = parseFloat(adv_match[2])
                const start_y = parseFloat(adv_match[3])
                const end_y = parseFloat(adv_match[4])
                const w = parseFloat(adv_match[5])

                if (start_x < 0 || start_x > 1 || end_x < 0 || end_x > 1 || start_x >= end_x) {
                    console.log(`Invalid x value in advance region: ${comp[i]}`)
                    continue
                }

                if (start_y < 0 || start_y > 1 || end_y < 0 || end_y > 1 || start_y >= end_y) {
                    console.log(`Invalid y value in advance region: ${comp[i]}`)
                    continue
                }

                if (w < 0) {
                    console.log(`Invalid w value in advance region: ${comp[i]}`)
                    continue
                }
                adv_regions.push([`${adv_match[1]}:${adv_match[2]}`, `${adv_match[3]}:${adv_match[4]}`, adv_match[5]])
            }
        }

        return {
            prompt: prompt.replace(coupler_pattern, '\n').replace(global_pattern_replace, '').replace(adv_pattern_replace, '').trim(),
            coupler_config: {
                direction: coupler_match[0] === '<=>' ? 'Horizontal' : 'Vertical',
                mode: adv_regions.length > 0 ? 'Advanced' : 'Basic',
                global: global_config,
                global_weight: global_weight || 0.5,
                adv_regions: adv_regions
            }
        }
    }

    return {
        prompt: prompt,
        coupler_config: null
    }

}

async function preview_coupler_setting(interaction, width, height, extra_config, index_preview_coupler, session_hash) {
            // ask for preview image
    const coupler_preview_data = [width, height, { "data": extra_config.coupler_config.adv_regions, "headers": ["x", "y", "weight"] }]
    const option_coupler_preview = {
        method: 'POST',
        body: JSON.stringify({
            fn_index: index_preview_coupler,
            session_hash: session_hash,
            data: coupler_preview_data
        }),
        headers: {
            'Content-Type': 'application/json'
        }
    }

    try {
        await fetch(`${WORKER_ENDPOINT}/run/predict/`, option_coupler_preview)
            .then(res => {
                if (res.status !== 200) {
                    throw 'Failed to setup coupler'
                }
                return res.json()
            })
            .then(async (res) => {
                // upload an image to the same channel as the interaction
                const img_dataURI = res.data[0]
                const img = Buffer.from(img_dataURI.split(",")[1], 'base64')
                if (extra_config.coupler_config && extra_config.coupler_config.mode === 'Advanced') {
                    const img_name = `preview_annotation.png`
                    await interaction.channel.send({files: [{attachment: img, name: img_name}]})
                }
                // dead code
            })
    }
    catch (err) {
        console.log(err)
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
    full_prompt_analyze,
    preview_coupler_setting
}