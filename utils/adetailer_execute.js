const { server_pool } = require('../utils/ai_server_config.js');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { cached_model } = require('./model_change.js');

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
                    console.log(res.status)
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
        let adetailer_config_obj = {}

        try {
            adetailer_config_obj = JSON.parse(adetailer_config)
        }
        catch (err) {
            reject("Failed to parse ADetailer config: " + err)
            return 
        }

        const adetailer_model = adetailer_config_obj[0].model
        let adetailer_prompt = adetailer_config_obj[0].prompt
        const adetailer_neg_prompt = adetailer_config_obj[0].neg_prompt
        const adetailer_model_2 = adetailer_config_obj[1].model
        let adetailer_prompt_2 = adetailer_config_obj[1].prompt
        const adetailer_neg_prompt_2 = adetailer_config_obj[1].neg_prompt

        if (coupler_config) {
            const comp = prompt.split("\n")
            if (coupler_config.global === "First Line") {
                adetailer_prompt = adetailer_prompt === "" ? comp[0] : adetailer_prompt
                adetailer_prompt_2 = adetailer_prompt_2 === "" ? comp[0] : adetailer_prompt_2
            }
            else if (coupler_config.global === "Last Line") {
                adetailer_prompt = adetailer_prompt === "" ? comp[comp.length - 1] : adetailer_prompt
                adetailer_prompt_2 = adetailer_prompt_2 === "" ? comp[comp.length - 1] : adetailer_prompt_2
            }
        }
        console.log(adetailer_model, adetailer_prompt, adetailer_model_2, adetailer_prompt_2)

        const base_index = server_pool[server_index].fn_index_change_adetailer_model1[mode]

        Promise.all(
            [
                change_option_adetailer(adetailer_model, base_index, session_hash,  WORKER_ENDPOINT),
                change_option_adetailer(adetailer_prompt, base_index + 3, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_neg_prompt, base_index + 4, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_model_2, base_index + 51, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_prompt_2, base_index + 54, session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_neg_prompt_2, base_index + 55, session_hash, WORKER_ENDPOINT),
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