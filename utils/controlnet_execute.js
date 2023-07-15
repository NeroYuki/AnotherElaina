// const { SlashCommandBuilder } = require('@discordjs/builders');
// const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
// const { byPassUser } = require('../config.json');
// const crypt = require('crypto');
const { server_pool, get_data_controlnet, get_data_controlnet_annotation } = require('../utils/ai_server_config.js');
// const { default: axios } = require('axios');
const fetch = require('node-fetch');
// const { loadImage } = require('../utils/load_discord_img');
// const sharp = require('sharp');

// mode: 0 = txt2img, 1 = img2img
function load_controlnet(session_hash, server_index, controlnet_input, controlnet_input_2, controlnet_input_3, controlnet_config, interaction, mode = 0) {
    return new Promise(async (resolve, reject) => {
        // parse config string here
        const WORKER_ENDPOINT = server_pool[server_index].url
        let controlnet_config_obj = {}

        try {
            controlnet_config_obj = JSON.parse(controlnet_config)
        }
        catch (err) {
            reject("control net config parsing error: " + err)
            return 
        }

        const controlnet_preprocessor = controlnet_config_obj.control_net[0].preprocessor
        const controlnet_model = controlnet_config_obj.control_net[0].model
        const controlnet_preprocessor_2 = controlnet_config_obj.control_net[1].preprocessor
        const controlnet_model_2 = controlnet_config_obj.control_net[1].model
        const controlnet_preprocessor_3 = controlnet_config_obj.control_net[2].preprocessor
        const controlnet_model_3 = controlnet_config_obj.control_net[2].model

        const do_preview_annotation = controlnet_config_obj.do_preview_annotation

        // get controlnet request body
        const controlnet_data = get_data_controlnet(controlnet_preprocessor, controlnet_model, controlnet_input, controlnet_model?.includes("sketch") ? 0.8 : 1)
        const controlnet_data_2 = get_data_controlnet(controlnet_preprocessor_2, controlnet_model_2, controlnet_input_2, controlnet_model_2?.includes("sketch") ? 0.8 : 1)
        const controlnet_data_3 = get_data_controlnet(controlnet_preprocessor_3, controlnet_model_3, controlnet_input_3, controlnet_model_3?.includes("sketch") ? 0.8 : 1)

        const option_controlnet = {
            method: 'POST',
            body: JSON.stringify({
                fn_index: server_pool[server_index].fn_index_controlnet[mode],
                session_hash: session_hash,
                data: controlnet_data
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }

        console.log(server_pool[server_index].fn_index_controlnet[mode])

        if (do_preview_annotation) {
            const controlnet_annotation_data = get_data_controlnet_annotation(controlnet_preprocessor, controlnet_input)
            const option_controlnet_annotation = {
                method: 'POST',
                body: JSON.stringify({
                    fn_index: server_pool[server_index].fn_index_controlnet_annotation[mode],
                    session_hash: session_hash,
                    data: controlnet_annotation_data
                }),
                headers: {
                    'Content-Type': 'application/json'
                }
            }

            try {
                await fetch(`${WORKER_ENDPOINT}/run/predict/`, option_controlnet_annotation)
                    .then(res => {
                        if (res.status !== 200) {
                            throw 'Failed to change controlnet'
                        }
                        return res.json()
                    })
                    .then(async (res) => {
                        // upload an image to the same channel as the interaction
                        const img_dataURI = res.data[0].value
                        const img = Buffer.from(img_dataURI.split(",")[1], 'base64')
                        if (do_preview_annotation) {
                            const img_name = `preview_annotation.png`
                            await interaction.channel.send({files: [{attachment: img, name: img_name}]})
                        }
                        // dead code
                    })
            }
            catch (err) {
                console.log(err)
                reject(err)
                return
            }

            if (controlnet_input_2 && controlnet_model_2 != "None") {
                const controlnet_annotation_data_2 = get_data_controlnet_annotation(controlnet_preprocessor_2, controlnet_input_2)
                const option_controlnet_annotation_2 = {
                    method: 'POST',
                    body: JSON.stringify({
                        fn_index: server_pool[server_index].fn_index_controlnet_annotation_2[mode],
                        session_hash: session_hash,
                        data: controlnet_annotation_data_2
                    }),
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }

                try {
                    await fetch(`${WORKER_ENDPOINT}/run/predict/`, option_controlnet_annotation_2)
                        .then(res => {
                            if (res.status !== 200) {
                                throw 'Failed to change controlnet'
                            }
                            return res.json()
                        })
                        .then(async (res) => {
                            // upload an image to the same channel as the interaction
                            const img_dataURI = res.data[0].value
                            const img = Buffer.from(img_dataURI.split(",")[1], 'base64')
                            if (do_preview_annotation) {
                                const img_name = `preview_annotation_2.png`
                                await interaction.channel.send({files: [{attachment: img, name: img_name}]})
                            }
                            // dead code
                        })
                }
                catch (err) {
                    console.log(err)
                    reject(err)
                    return
                }
            }

            if (controlnet_input_3 && controlnet_model_3 != "None") {
                const controlnet_annotation_data_3 = get_data_controlnet_annotation(controlnet_preprocessor_3, controlnet_input_3)
                const option_controlnet_annotation_3 = {
                    method: 'POST',
                    body: JSON.stringify({
                        fn_index: server_pool[server_index].fn_index_controlnet_annotation_3[mode],
                        session_hash: session_hash,
                        data: controlnet_annotation_data_3
                    }),
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }

                try {
                    await fetch(`${WORKER_ENDPOINT}/run/predict/`, option_controlnet_annotation_3)
                        .then(res => {
                            if (res.status !== 200) {
                                throw 'Failed to change controlnet'
                            }
                            return res.json()
                        })
                        .then(async (res) => {
                            // upload an image to the same channel as the interaction
                            const img_dataURI = res.data[0].value
                            const img = Buffer.from(img_dataURI.split(",")[1], 'base64')
                            if (do_preview_annotation) {
                                const img_name = `preview_annotation_3.png`
                                await interaction.channel.send({files: [{attachment: img, name: img_name}]})
                            }
                            // dead code
                        })
                }
                catch (err) {
                    console.log(err)
                    reject(err)
                    return
                }
            }
        }

        try {
            await fetch(`${WORKER_ENDPOINT}/run/predict/`, option_controlnet)
                .then(res => {
                    if (res.status !== 200) {
                        throw 'Failed to change controlnet'
                    }
                })
        }
        catch (err) {
            console.log(err)
            reject(err)
            return
        }

        if (controlnet_input_2 && controlnet_model_2 != "None") {
            const option_controlnet_2 = {
                method: 'POST',
                body: JSON.stringify({
                    fn_index: server_pool[server_index].fn_index_controlnet_2[mode],
                    session_hash: session_hash,
                    data: controlnet_data_2
                }),
                headers: {
                    'Content-Type': 'application/json'
                }
            }

            try {
                await fetch(`${WORKER_ENDPOINT}/run/predict/`, option_controlnet_2)
                    .then(res => {
                        if (res.status !== 200) {
                            throw 'Failed to change controlnet'
                        }
                    })
            }
            catch (err) {
                console.log(err)
                reject(err)
                return
            }
        }

        if (controlnet_input_3 && controlnet_model_3 != "None") {
            const option_controlnet_3 = {
                method: 'POST',
                body: JSON.stringify({
                    fn_index: server_pool[server_index].fn_index_controlnet_3[mode],
                    session_hash: session_hash,
                    data: controlnet_data_3
                }),
                headers: {
                    'Content-Type': 'application/json'
                }
            }

            try {
                await fetch(`${WORKER_ENDPOINT}/run/predict/`, option_controlnet_3)
                    .then(res => {
                        if (res.status !== 200) {
                            throw 'Failed to change controlnet'
                        }
                    })
            }
            catch (err) {
                console.log(err)
                reject(err)
                return
            }
        }

        resolve()
    })
}

module.exports = {
    load_controlnet
}