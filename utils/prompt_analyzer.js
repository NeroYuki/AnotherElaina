const { queryRecordLimit } = require("../database/database_interaction")
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
            // if found, push [x_start, x_end, y_start, y_end, w] to adv_regions

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
                adv_regions.push([
                    start_x, end_x, start_y, end_y, w
                ])
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

async function fetch_user_defined_wildcard(prompt, user_id) {
    // check for following pattern in prompt %%<profile_name>%% and extract it into a list of profile_name
    return new Promise(async (resolve, reject) => {
        const wildcard_pattern = /%%([a-zA-Z0-9_\/]+)%%/gi

        const wildcard_match = prompt.match(wildcard_pattern)

        if (!wildcard_match) {
            resolve(prompt)
            return
        }

        for (let i = 0; i < wildcard_match.length; i++) {
            wildcard_match[i] = wildcard_match[i].slice(2, -2)

            let profile_data = []
                // attempt to query the profile name on the database
            if (user_id != null) {
                profile_data = await queryRecordLimit('wd_profile', { name: wildcard_match[i], user_id: user_id }, 1)
            }
            if (profile_data.length == 0) {
                // attempt to query global profile
                profile_data = await queryRecordLimit('wd_profile', { name: wildcard_match[i] }, 1)
            }
            if (profile_data.length != 0) {
                // replace the wildcard with the prompt
                prompt = prompt.replace(`%%${wildcard_match[i]}%%`, profile_data[0].prompt)
            }
        }

        resolve(prompt)
    })
}

async function preview_coupler_setting(interaction, width, height, extra_config, index_preview_coupler, session_hash, endpoint = 'http://192.168.196.142:7860') {
    // ask for preview image
    const coupler_preview_data = ["Advanced", `${width}x${height}`, extra_config.coupler_config.adv_regions]
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

    console.log(option_coupler_preview.body)

    try {
        await fetch(`${endpoint}/run/predict/`, option_coupler_preview)
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

function get_detail_daemon_config_from_prompt(prompt) {
    // check for following pattern in prompt |dd: <amount>| or |dd: <amount>, <start>-<end>, <bias>| or |dd: <amount>, <start>-<end>| or |dd: <amount>, <bias>| WHITE SPACE CAN BE OMITTED
    // if found, return the value {values: <array of values>}
    // else return null

    // white space can be omitted
    const dd_pattern = /\|dd: ([0-9.]+)(,\s*([0-9.]+)-([0-9.]+)(,\s*([0-9.]+))?)?\||([0-9.]+)(,\s*([0-9.]+))?\|/i

    const dd_match = prompt.match(dd_pattern)

    if (dd_match && dd_match[0]) {
        const values_pattern = /([0-9.]+)/gi
        const values_match = dd_match[0].match(values_pattern)

        let temp_value = new Array(4).fill(null)
        temp_value[0] = parseFloat(values_match[0])

        if (values_match.length > 1) {
            if (values_match.length === 2) {
                temp_value[3] = parseFloat(values_match[1])
            }
            else if (values_match.length === 3) {
                temp_value[1] = parseFloat(values_match[1])
                temp_value[2] = parseFloat(values_match[2])
            }
            else if (values_match.length === 4) {
                temp_value[1] = parseFloat(values_match[1])
                temp_value[2] = parseFloat(values_match[2])
                temp_value[3] = parseFloat(values_match[3])
            }
        }

        return {
            prompt: prompt.replace(dd_pattern, ''),
            detail_daemon_config: {
                amount: temp_value[0],
                start: temp_value[1],
                end: temp_value[2],
                bias: temp_value[3]
            }
        }
    }

    return {
        prompt: prompt,
        detail_daemon_config: null
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

function get_pag_config_from_prompt(prompt) {
    // check for following pattern in prompt |pag: <pag scale>,<adaptive scale>| or |pag: <pag scale>|
    // if found, return the value {pag_scale: <value>, adaptive_scale: <value>}
    // else return null

    const pag_pattern = /\|pag:\s*([0-9.]+),([0-9.]+).*\|/i
    const pag_pattern_simple = /\|pag:\s*([0-9.]+).*\|/i

    const pag_match = prompt.match(pag_pattern)

    if (pag_match && pag_match[0]) {
        const values_pattern = /([0-9.]+)/gi
        const values_match = pag_match[0].match(values_pattern)

        return {
            prompt: prompt.replace(pag_pattern, ''),
            pag_config: {
                pag_scale: parseFloat(values_match[0]) || 3,
                adaptive_scale: parseFloat(values_match[1]) || 0
            }
        }
    }

    const pag_match_simple = prompt.match(pag_pattern_simple)

    if (pag_match_simple && pag_match_simple[0]) {
        const values_pattern = /([0-9.]+)/gi
        const values_match = pag_match_simple[0].match(values_pattern)

        return {
            prompt: prompt.replace(pag_pattern_simple, ''),
            pag_config: {
                pag_scale: parseFloat(values_match[0]) || 3,
                adaptive_scale: 0
            }
        }
    }

    return {
        prompt: prompt,
        pag_config: null
    }
}

function get_mahiro_config_from_prompt(prompt) {
    // check for following pattern in prompt |mahiro|
    // if found, return the value {mahiro: true}
    // else return null

    const mahiro_pattern = /\|mahiro\|/i

    const mahiro_match = prompt.match(mahiro_pattern)

    if (mahiro_match && mahiro_match[0]) {
        return {
            prompt: prompt.replace(mahiro_pattern, ''),
            mahiro_config: {
                mahiro: true
            }
        }
    }

    return {
        prompt: prompt,
        mahiro_config: null
    }
}

function get_prompt_enhancer_call(prompt) {
    // if prompt contain [BOORU] return booru_gen = true in result object
    // if prompt contain [FOOCUS] return foocus = true in result object

    const booru_pattern = /\[BOORU\]/i
    const foocus_pattern = /\[FOOCUS\]/i
    const tipo_pattern = /\[TIPO\]/i

    const booru_match = prompt.match(booru_pattern)
    const foocus_match = prompt.match(foocus_pattern)
    const tipo_match = prompt.match(tipo_pattern)

    // if tipo_match, parse the prompt with following syntax [TIPO]<raw prompt>===<tag prompt>===<nl prompt>, tag prompt, nl prompt and === must be removed from the prompt
    if (tipo_match) {
        const component = prompt.split("===")

        if (component && component.length > 0) {
            return {
                prompt: prompt.replace(tipo_match, "").replace(/===(.*)/g, "").trim(),
                booru_gen: booru_match ? true : false,
                foocus: foocus_match ? true : false,
                tipo: {
                    tag: component[1] || "",
                    nl: component[2] || ""
                }
            }
        }
    }

    // remove the [BOORU] and [FOOCUS] from the prompt
    prompt = prompt.replace(booru_pattern, '').replace(foocus_pattern, '').replace(tipo_pattern, '')

    return {
        prompt: prompt,
        booru_gen: booru_match ? true : false,
        foocus: false,
        tipo: null
    }
}

function get_teacache_config_from_prompt(prompt, dry_check = false) {
    // check for following pattern in prompt (>> <fbc|tc> <value>) or (>> <value>)
    // if found, return the value {type: <First Block Cache if fbc, TeaCache if tc or (>> <value>) if found>, threshold: <value>}
    // else return null

    const teacache_pattern_full = />>\s*(fbc|tc)?\s*([0-9.]+)?/i
    const teacache_pattern_simple = />>\s*([0-9.]+)/i

    const teacache_match_full = prompt.match(teacache_pattern_full)
    const teacache_match_simple = prompt.match(teacache_pattern_simple)

    if (teacache_match_full && teacache_match_full[0]) {
        return {
            prompt: dry_check ? prompt : prompt.replace(teacache_pattern_full, ''),
            teacache_config: {
                type: teacache_match_full[1] ? (teacache_match_full[1] === 'fbc' ? 'First Block Cache' : 'TeaCache') : 'TeaCache',
                threshold: parseFloat(teacache_match_full[2])
            }
        }
    }
    else if (teacache_match_simple && teacache_match_simple[0]) {
        return {
            prompt: dry_check ? prompt : prompt.replace(teacache_pattern_simple, ''),
            teacache_config: {
                type: 'TeaCache',
                threshold: parseFloat(teacache_match_simple[1])
            }
        }
    }

    return {
        prompt: prompt,
        teacache_config: null
    }
}

function full_prompt_analyze(prompt, is_xl) {
    let coupler_config = get_coupler_config_from_prompt(prompt)
    let color_grading_config = get_color_grading_config_from_prompt(coupler_config.prompt, is_xl)
    let freeu_config = get_freeu_config_from_prompt(color_grading_config.prompt)
    let dynamic_threshold_config = get_dynamic_threshold_config_from_prompt(freeu_config.prompt)
    let pag_config = get_pag_config_from_prompt(dynamic_threshold_config.prompt)
    let mahiro_config = get_mahiro_config_from_prompt(pag_config.prompt)
    let prompt_enhancer = get_prompt_enhancer_call(mahiro_config.prompt)
    let detail_daemon_config = get_detail_daemon_config_from_prompt(prompt_enhancer.prompt)
    let teacache_config = get_teacache_config_from_prompt(detail_daemon_config.prompt)

    return {
        prompt: teacache_config.prompt,
        coupler_config: coupler_config.coupler_config,
        color_grading_config: color_grading_config.color_grading_config,
        freeu_config: freeu_config.freeu_config,
        dynamic_threshold_config: dynamic_threshold_config.dynamic_threshold_config,
        detail_daemon_config: detail_daemon_config.detail_daemon_config,
        pag_config: pag_config.pag_config,
        mahiro_config: mahiro_config.mahiro_config,
        use_foocus: prompt_enhancer.foocus,
        use_booru_gen: prompt_enhancer.booru_gen,
        tipo_input: prompt_enhancer.tipo,
        teacache_config: teacache_config.teacache_config
    }
}

module.exports = {
    get_coupler_config_from_prompt,
    get_color_grading_config_from_prompt,
    get_freeu_config_from_prompt,
    get_dynamic_threshold_config_from_prompt,
    get_pag_config_from_prompt,
    get_prompt_enhancer_call,
    full_prompt_analyze,
    preview_coupler_setting,
    fetch_user_defined_wildcard,
    get_teacache_config_from_prompt,
}