// const { SlashCommandBuilder } = require('@discordjs/builders');
// const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
// const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const { default: axios } = require('axios');
// const { loadImage } = require('../utils/load_discord_img');
// const sharp = require('sharp');

const cached_model = [
    "anythingv5.safetensors [7f96a1a9ca]",
    "cetusmix_coda2.safetensors [68c0a27380]",
    "momokos_v10.safetensors [d77922554c]",
]

function model_change(modelname, forced = false) {
    return new Promise(async (resolve, reject) => {
        // change model then send the notification to discord channel where the action is executed
        // if modelname is in the cached_model or forced, return true

        if (forced || cached_model.includes(modelname)) {
            const session_hash = crypt.randomBytes(16).toString('base64');
            const option_init_axios = {
                data: {
                    fn_index: 751,
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