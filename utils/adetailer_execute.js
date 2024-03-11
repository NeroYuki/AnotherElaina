// const { SlashCommandBuilder } = require('@discordjs/builders');
// const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
// const { byPassUser } = require('../config.json');
// const crypt = require('crypto');
const { server_pool } = require('../utils/ai_server_config.js');
// const { default: axios } = require('axios');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { cached_model } = require('./model_change.js');
// const { loadImage } = require('../utils/load_discord_img');
// const sharp = require('sharp');

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

function load_adetailer(session_hash, server_index, adetailer_config, interaction, mode = 0) {
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
        const adetailer_prompt = adetailer_config_obj[0].prompt
        const adetailer_neg_prompt = adetailer_config_obj[0].neg_prompt
        const adetailer_model_2 = adetailer_config_obj[1].model
        const adetailer_prompt_2 = adetailer_config_obj[1].prompt
        const adetailer_neg_prompt_2 = adetailer_config_obj[1].neg_prompt


        console.log(adetailer_model, adetailer_prompt, adetailer_model_2, adetailer_prompt_2)

        Promise.all(
            [
                change_option_adetailer(adetailer_model, server_pool[server_index].fn_index_change_adetailer_model1[mode], session_hash,  WORKER_ENDPOINT),
                change_option_adetailer(adetailer_prompt, server_pool[server_index].fn_index_change_adetailer_prompt1[mode], session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_neg_prompt, server_pool[server_index].fn_index_change_adetailer_neg_prompt1[mode], session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_model_2, server_pool[server_index].fn_index_change_adetailer_model2[mode], session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_prompt_2, server_pool[server_index].fn_index_change_adetailer_prompt2[mode], session_hash, WORKER_ENDPOINT),
                change_option_adetailer(adetailer_neg_prompt_2, server_pool[server_index].fn_index_change_adetailer_neg_prompt2[mode], session_hash, WORKER_ENDPOINT),
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