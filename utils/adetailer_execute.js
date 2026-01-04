const { server_pool } = require('../utils/ai_server_config.js');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { cached_model } = require('./model_change.js');

// const config = [
//     {
//         "model": adetailer_model,
//         "object_to_detect": object_to_detect,
//         "prompt": adetailer_prompt,
//         "neg_prompt": adetailer_neg_prompt,
//         "detection_threshold": adetailer_detection_threshold,
//         "mask_blur": adetailer_mask_blur,
//         "mask_padding": adetailer_mask_padding,
//         "denoise_strength": adetailer_denoise_strength
//     },
//     {
//         "model": adetailer_model_2,
//         "prompt": adetailer_prompt_2,
//         "neg_prompt": adetailer_neg_prompt_2,
//         "object_to_detect": object_to_detect_2,
//         "detection_threshold": adetailer_detection_threshold_2,
//         "mask_blur": adetailer_mask_blur_2,
//         "mask_padding": adetailer_mask_padding_2,
//         "denoise_strength": adetailer_denoise_strength_2
//     },
//     {
//         "model": adetailer_model_3,
//         "prompt": adetailer_prompt_3,
//         "neg_prompt": adetailer_neg_prompt_3,
//         "object_to_detect": object_to_detect_3,
//         "detection_threshold": adetailer_detection_threshold_3,
//         "mask_blur": adetailer_mask_blur_3,
//         "mask_padding": adetailer_mask_padding_3,
//         "denoise_strength": adetailer_denoise_strength_3
//     }
// ]

function change_option_adetailer(value, fn_index, session_hash, server_url) {
    return new Promise(async (resolve, reject) => {
        const option_adetailer = {
            method: 'POST',
            body: JSON.stringify({
                fn_index: fn_index,
                session_hash: session_hash,
                data: [
                    null,
                    value
                ]
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }

        try {
            await fetch(`${server_url}/run/predict/`, option_adetailer)
                .then(res => {
                    // console.log(res.status)
                    if (res.status !== 200) {
                        throw 'Failed to change adetailer'
                    }
                })
        }
        catch (err) {
            console.log(err)
            reject(err)
            return
        }

        resolve()
    })
}

function load_adetailer(session_hash, server_index, adetailer_config, interaction, coupler_config, prompt, mode = 0) {
    return new Promise(async (resolve, reject) => {
        // parse config string here
        const WORKER_ENDPOINT = server_pool[server_index].url
        let adetailer_config_obj = []

        try {
            adetailer_config_obj = JSON.parse(adetailer_config)
        }
        catch (err) {
            reject("Failed to parse ADetailer config: " + err)
            return 
        }

        let adetailer_prompt = adetailer_config_obj[0]?.prompt || "";
        let adetailer_prompt_2 = adetailer_config_obj[1]?.prompt || "";
        let adetailer_prompt_3 = adetailer_config_obj[2]?.prompt || "";

        if (coupler_config) {
            const comp = prompt.split("\n")
            if (coupler_config.global === "First Line") {
                adetailer_prompt = adetailer_prompt === "" ? comp[0] : adetailer_prompt
                adetailer_prompt_2 = adetailer_prompt_2 === "" ? comp[0] : adetailer_prompt_2
                adetailer_prompt_3 = adetailer_prompt_3 === "" ? comp[0] : adetailer_prompt_3
            }
            else if (coupler_config.global === "Last Line") {
                adetailer_prompt = adetailer_prompt === "" ? comp[comp.length - 1] : adetailer_prompt
                adetailer_prompt_2 = adetailer_prompt_2 === "" ? comp[comp.length - 1] : adetailer_prompt_2
                adetailer_prompt_3 = adetailer_prompt_3 === "" ? comp[comp.length - 1] : adetailer_prompt_3
            }
        }
        //console.log(adetailer_model, adetailer_prompt, adetailer_model_2, adetailer_prompt_2)

        const base_index = server_pool[server_index].fn_index_change_adetailer_model1[mode]

        Promise.all(
            [
                change_option_adetailer(adetailer_config_obj[0]?.model || 'face_yolov8s.pt', base_index, session_hash,  WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[0]?.object_to_detect || "face", base_index + 1, session_hash, WORKER_ENDPOINT),
                // +3 = apply to hires fix only
                change_option_adetailer(adetailer_prompt, base_index + 4, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[0]?.neg_prompt || "", base_index + 5, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[0]?.detection_threshold || 0.3, base_index + 15, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[0]?.mask_blur || 4, base_index + 24, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[0]?.denoise_strength || 0.5, base_index + 25, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[0]?.mask_padding || 32, base_index + 27, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[1]?.model || "None", base_index + 68, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[1]?.object_to_detect || "face", base_index + 68 + 1, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_prompt_2, base_index + 68 + 4, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[1]?.neg_prompt || "", base_index + 68 + 5, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[1]?.detection_threshold || 0.3, base_index + 68 + 15, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[1]?.mask_blur || 4, base_index + 68 + 24, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[1]?.denoise_strength || 0.5, base_index + 68 + 25, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[1]?.mask_padding || 32, base_index + 68 + 27, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[2]?.model || "None", base_index + 136, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[2]?.object_to_detect || "face", base_index + 136 + 1, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_prompt_3, base_index + 136 + 4, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[2]?.neg_prompt || "", base_index + 136 + 5, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[2]?.detection_threshold || 0.3, base_index + 136 + 15, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[2]?.mask_blur || 4, base_index + 136 + 24, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[2]?.denoise_strength || 0.5, base_index + 136 + 25, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_config_obj[2]?.mask_padding || 32, base_index + 136 + 27, session_hash, WORKER_ENDPOINT),
            ]
        ).then(() => {
            interaction.channel.send("ADetailer config loaded")
            resolve()
        }).catch((err) => {
            interaction.channel.send("ADetailer config failed to load: " + err)
            reject(err)
        })
    })
}

module.exports = {
    load_adetailer
}