// const { SlashCommandBuilder } = require('@discordjs/builders');
// const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
// const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const { default: axios } = require('axios');
const { server_pool, model_selection_flux } = require('./ai_server_config');
// const { loadImage } = require('../utils/load_discord_img');
// const sharp = require('sharp');

const cached_model = [
    "animaginexl_v31.safetensors",
    "dreamshaperxl_lightning.safetensors",
    "anythingv5.safetensors",
]

const flux_support_models = [
    "ae.safetensors",
    "clip_l.safetensors",
    "t5-v1_1-xxl-encoder-Q8_0.gguf"
]

async function support_model_change(models, session_hash) {
    return new Promise(async (resolve, reject) => {
        const option_init_axios = {
            data: {
                fn_index: server_pool[0].fn_index_change_support_model,
                session_hash: session_hash,
                data: [
                    models
                ]
            },
            config: {
                timeout: 900000
            }
        }  

        await axios.post(`http://192.168.196.142:7860/run/predict/`, option_init_axios.data, option_init_axios.config)
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
                        modelname
                    ]
                },
                config: {
                    timeout: 900000
                }
            }  
    
            await axios.post(`http://192.168.196.142:7860/run/predict/`, option_init_axios.data, option_init_axios.config)
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
                            await support_model_change(flux_support_models, session_hash).catch(err => {
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