// const { SlashCommandBuilder } = require('@discordjs/builders');
// const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
// const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const { default: axios } = require('axios');
const { server_pool, model_selection_flux, model_selection_xl, model_selection, model_selection_chroma, model_selection_z_image, model_selection_lumina, model_selection_anima, model_selection_qwen_image, model_selection_flux_klein_4b, model_selection_flux_klein_9b } = require('./ai_server_config');
// const { loadImage } = require('../utils/load_discord_img');
// const sharp = require('sharp');

const cached_model = [
    "noobaixl_v1_1.safetensors",
    "animaginexl_v40_opt.safetensors",
    "wai_nsfw_illustrious_v100.safetensors",
]

const flux_support_models = [
    "ae.safetensors",
    "clip_l.safetensors",
    "t5-v1_1-xxl-encoder-Q8_0.gguf"
]

const chroma_support_models = [
    "ae.safetensors",
    "t5-v1_1-xxl-encoder-Q8_0.gguf"
]

const flux_klein_9b_support_models = [
    "flux2-vae.safetensors",
    "Qwen3-8B-Q8_0.gguf"
]

const flux_klein_4b_support_models = [
    "flux2-vae.safetensors",
    "qwen_3_4b.safetensors"
]

const qwen_support_models = [
    "qwen_image_vae.safetensors",
    "qwen_2.5_vl_7b_fp8_scaled.safetensors"
]

const anima_support_models = [
    "qwen_image_vae.safetensors",
    "qwen_3_06b_base.safetensors"
]

const z_image_support_models = [
    "ae.safetensors",
    "qwen_3_4b.safetensors"
]

const lumina_support_models = [
    "ae.safetensors",
    "gemma_2_2b_fp16.safetensors"
]

async function support_model_change(models, session_hash, model_type) {
    const server_address = server_pool[0].url;
    return new Promise(async (resolve, reject) => {
        const option_init_axios = {
            data: {
                fn_index: server_pool[0].fn_index_change_support_model,
                session_hash: session_hash,
                data: [
                    models,
                    model_type
                ]
            },
            config: {
                timeout: 900000
            }
        }  

        await axios.post(`${server_address}/run/predict/`, option_init_axios.data, option_init_axios.config)
            .then(async (res) => {
                if(res.data) {
                    console.log('Support model change success', models)
                    resolve(true)
                }
                else {
                    console.log('Support model change failed')
                    reject('Support model change failed')
                }
            })
            .catch(async (err) => {
                console.log(err)
                console.log('Support model change failed')
                reject('Support model change failed: ' + err)
            })
    })
}

function model_change(modelname, forced = false) {
    const server_address = server_pool[0].url;

    const model_type = model_selection_xl.find(element => element.value === modelname) ? 'xl' :
                    [...model_selection_flux, ...model_selection_chroma].find(element => element.value === modelname) ? 'flux' :
                    [...model_selection_flux_klein_4b, ...model_selection_flux_klein_9b].find(element => element.value === modelname) ? 'klein' :
                    model_selection_qwen_image.find(element => element.value === modelname) ? 'qwen' :
                    model_selection_anima.find(element => element.value === modelname) ? 'anima' :
                    model_selection_lumina.find(element => element.value === modelname) ? 'lumina' :
                    model_selection_z_image.find(element => element.value === modelname) ? 'zit' : 'sd';
    
    return new Promise(async (resolve, reject) => {
        // change model then send the notification to discord channel where the action is executed
        // if modelname is in the cached_model or forced, return true

        if (forced || cached_model.includes(modelname)) {
            const session_hash = crypt.randomBytes(16).toString('base64');
            const option_init_axios = {
                data: {
                    fn_index: server_pool[0].fn_index_change_model,
                    session_hash: session_hash,
                    data: [
                        modelname,
                        model_type
                    ]
                },
                config: {
                    timeout: 900000
                }
            }

            await axios.post(`${server_address}/run/predict/`, option_init_axios.data, option_init_axios.config)
                .then(async (res) => {
                    if(res.data) {
                        // if model name is in the cache, remove it and unshift the new model name
                        // else, pop the last model name and unshift the new model name
                        
                        if (cached_model.length >= 3) {
                            if (cached_model.includes(modelname)) {
                                cached_model.splice(cached_model.indexOf(modelname), 1)
                            }
                            else {
                                cached_model.pop()
                            }
                        }
                        cached_model.unshift(modelname)

                        if (model_selection_flux.find(element => element.value === modelname)) {
                            await support_model_change(flux_support_models, session_hash, model_type).catch(err => {
                                console.log("support model cannot be changed due to failure")
                                // rollback the model change?
                            })
                        }
                        else if (model_selection_chroma.find(element => element.value === modelname)) {
                            await support_model_change(chroma_support_models, session_hash, model_type).catch(err => {
                                console.log("support model cannot be changed due to failure")
                                // rollback the model change?
                            })
                        }
                        else if (model_selection_flux_klein_9b.find(element => element.value === modelname)) {
                            await support_model_change(flux_klein_9b_support_models, session_hash, model_type).catch(err => {
                                console.log("support model cannot be changed due to failure")
                                // rollback the model change?
                            })
                        }
                        else if (model_selection_flux_klein_4b.find(element => element.value === modelname)) {
                            await support_model_change(flux_klein_4b_support_models, session_hash, model_type).catch(err => {
                                console.log("support model cannot be changed due to failure")
                                // rollback the model change?
                            })
                        }
                        else if (model_selection_qwen_image.find(element => element.value === modelname)) {
                            await support_model_change(qwen_support_models, session_hash, model_type).catch(err => {
                                console.log("support model cannot be changed due to failure")
                                // rollback the model change?
                            })
                        }
                        else if (model_selection_anima.find(element => element.value === modelname)) {
                            await support_model_change(anima_support_models, session_hash, model_type).catch(err => {
                                console.log("support model cannot be changed due to failure")
                                // rollback the model change?
                            })
                        }
                        else if (model_selection_lumina.find(element => element.value === modelname)) {
                            await support_model_change(lumina_support_models, session_hash, model_type).catch(err => {
                                console.log("support model cannot be changed due to failure")
                                // rollback the model change?
                            })
                        }
                        else if (model_selection_z_image.find(element => element.value === modelname)) {
                            await support_model_change(z_image_support_models, session_hash, model_type).catch(err => {
                                console.log("support model cannot be changed due to failure")
                                // rollback the model change?
                            })
                        }
                        else {
                            await support_model_change([], session_hash).catch(err => {
                                console.log("support model cannot be changed due to failure")
                                // rollback the model change?
                            })
                        }

                        resolve(true)
                    } else {
                        reject("Model not exists")
                    }
                })
                .catch(async (err) => {
                    console.log(err)
                    reject('Model change failed: ' + err)
                })
        }
        else {
            // if modelname is not in the cached_model and not forced, return false
            console.log('Model not in cache')
            resolve(false)
        }
    })
}

module.exports = {
    model_change,
    cached_model
}