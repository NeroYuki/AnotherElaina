// const { SlashCommandBuilder } = require('@discordjs/builders');
// const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
// const { byPassUser } = require('../config.json');
// const crypt = require('crypto');
const { server_pool, get_data_controlnet, get_data_controlnet_annotation, model_selection_xl, controlnet_model_selection, controlnet_model_selection_xl, model_selection_inpaint, model_selection_flux, controlnet_model_selection_flux, controlnet_model_selection_sd } = require('../utils/ai_server_config.js');
// const { default: axios } = require('axios');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { cached_model } = require('./model_change.js');
// const { loadImage } = require('../utils/load_discord_img');
// const sharp = require('sharp');

function pick_instantid_preprocessor(model, preprocessor) {
    if (model === "control_instant_id_sdxl [c5c25a50]")
        return "instant_id_face_keypoints"
    if (model === "ip-adapter_instant_id_sdxl [eb2d3ec0]")
        return "instant_id_face_embedding"
    return preprocessor
}

const FN_OFFSET_TXT2IMG = 47
const FN_OFFSET_IMG2IMG = 49
const FN_OFFSET_ANNOTATION = 8

// mode: 0 = txt2img, 1 = img2img
function load_controlnet(session_hash, server_index, controlnet_input, controlnet_input_2, controlnet_input_3, controlnet_config, interaction, mode = 0, mask = null, controlnet_mask = false, extra_data = {}) {
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

        let controlnet_preprocessor = controlnet_config_obj.control_net[0].preprocessor
        let controlnet_model = controlnet_config_obj.control_net[0].model
        const controlnet_weight = controlnet_config_obj.control_net[0].weight
        const controlnet_resolution = controlnet_config_obj.control_net[0].resolution
        const controlnet_mode = controlnet_config_obj.control_net[0].mode
        const controlnet_threshold_a = controlnet_config_obj.control_net[0].t_a
        const controlnet_threshold_b = controlnet_config_obj.control_net[0].t_b
        let controlnet_preprocessor_2 = controlnet_config_obj.control_net[1].preprocessor
        let controlnet_model_2 = controlnet_config_obj.control_net[1].model
        const controlnet_weight_2 = controlnet_config_obj.control_net[1].weight
        const controlnet_resolution_2 = controlnet_config_obj.control_net[1].resolution
        const controlnet_mode_2 = controlnet_config_obj.control_net[1].mode
        const controlnet_threshold_a_2 = controlnet_config_obj.control_net[1].t_a
        const controlnet_threshold_b_2 = controlnet_config_obj.control_net[1].t_b
        let controlnet_preprocessor_3 = controlnet_config_obj.control_net[2].preprocessor
        let controlnet_model_3 = controlnet_config_obj.control_net[2].model
        const controlnet_weight_3 = controlnet_config_obj.control_net[2].weight
        const controlnet_resolution_3 = controlnet_config_obj.control_net[2].resolution
        const controlnet_mode_3 = controlnet_config_obj.control_net[2].mode
        const controlnet_threshold_a_3 = controlnet_config_obj.control_net[2].t_a
        const controlnet_threshold_b_3 = controlnet_config_obj.control_net[2].t_b

        if (model_selection_xl.find(x => x.value === cached_model[0]) != null || model_selection_inpaint.find(x => x.inpaint === cached_model[0]) != null) {
            interaction.channel.send("Detected active XL model, translating controlnet model to XL version")
            // get the value with the same name from the controlnet_model_selection_xl
            controlnet_model = controlnet_model_selection_xl.find(x => x.name === controlnet_model)?.value || "None"
            controlnet_model_2 = controlnet_model_selection_xl.find(x => x.name === controlnet_model_2)?.value || "None"
            controlnet_model_3 = controlnet_model_selection_xl.find(x => x.name === controlnet_model_3)?.value || "None"
        }
        else if (model_selection_flux.find(x => x.value === cached_model[0]) != null) {
            interaction.channel.send("Detected active Flux model, translating controlnet model to Flux version")
            // get the value with the same name from the controlnet_model_selection_flux
            controlnet_model = controlnet_model_selection_flux.find(x => x.name === controlnet_model)?.value || "None"
            controlnet_model_2 = controlnet_model_selection_flux.find(x => x.name === controlnet_model_2)?.value || "None"
            controlnet_model_3 = controlnet_model_selection_flux.find(x => x.name === controlnet_model_3)?.value || "None"
        }
        else {
            interaction.channel.send("Detected active SD model, translating controlnet model to SD version")
            // search for the model name in the controlnet_model_selection_sd
            controlnet_model = controlnet_model_selection_sd.find(x => x.name === controlnet_model)?.value || "None"
            controlnet_model_2 = controlnet_model_selection_sd.find(x => x.name === controlnet_model_2)?.value || "None"
            controlnet_model_3 = controlnet_model_selection_sd.find(x => x.name === controlnet_model_3)?.value || "None"
        }

        const do_preview_annotation = controlnet_config_obj.do_preview_annotation

        controlnet_preprocessor = pick_instantid_preprocessor(controlnet_model, controlnet_preprocessor)
        controlnet_preprocessor_2 = pick_instantid_preprocessor(controlnet_model_2, controlnet_preprocessor_2)
        controlnet_preprocessor_3 = pick_instantid_preprocessor(controlnet_model_3, controlnet_preprocessor_3)

        // get controlnet request body
        const controlnet_data = get_data_controlnet(controlnet_preprocessor, controlnet_model, controlnet_input, controlnet_weight || 1, controlnet_mode, controlnet_resolution, 0, 1, mask, controlnet_threshold_a, controlnet_threshold_b)
        const controlnet_data_2 = get_data_controlnet(controlnet_preprocessor_2, controlnet_model_2, controlnet_input_2, controlnet_weight_2 || 1, controlnet_mode_2, controlnet_resolution_2, 0, 1, null, controlnet_threshold_a_2, controlnet_threshold_b_2)
        const controlnet_data_3 = get_data_controlnet(controlnet_preprocessor_3, controlnet_model_3, controlnet_input_3, controlnet_weight_3 || 1, controlnet_mode_3, controlnet_resolution_3, 0, 1, null, controlnet_threshold_a_3, controlnet_threshold_b_3)

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

        // console.log(server_pool[server_index].fn_index_controlnet[mode])

        // // mask control setup
        // const mask_control_data = [
        //     controlnet_mask,
        //     extra_data.height ?? 512,
        //     extra_data.width ?? 512,
        // ]

        // const option_mask_control = {
        //     method: 'POST',
        //     body: JSON.stringify({
        //         fn_index: 1088,
        //         session_hash: session_hash,
        //         data: mask_control_data
        //     }),
        //     headers: {
        //         'Content-Type': 'application/json'
        //     }
        // }

        // try {
        //     await fetch(`${WORKER_ENDPOINT}/run/predict/`, option_mask_control)
        //         .then(res => {
        //             if (res.status !== 200) {
        //                 throw 'Failed to change controlnet'
        //             }
        //         })
        // }
        // catch (err) {
        //     console.log(err)
        //     reject(err)
        //     return
        // }

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
                        const img_dataURI = res.data[1]
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
                        fn_index: server_pool[server_index].fn_index_controlnet_annotation[mode] + FN_OFFSET_ANNOTATION,
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
                            const img_dataURI = res.data[1]
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
                        fn_index: server_pool[server_index].fn_index_controlnet_annotation[mode] + (FN_OFFSET_ANNOTATION * 2),
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
                            const img_dataURI = res.data[1]
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
                    fn_index: server_pool[server_index].fn_index_controlnet[mode] + (mode === 0 ? FN_OFFSET_TXT2IMG : FN_OFFSET_IMG2IMG),
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
                    fn_index: server_pool[server_index].fn_index_controlnet[mode] + ((mode === 0 ? FN_OFFSET_TXT2IMG : FN_OFFSET_IMG2IMG) * 2),
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