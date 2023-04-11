const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const { server_pool, get_data_body, get_negative_prompt, initiate_server_heartbeat, get_worker_server, get_prompt, load_lora_from_prompt, model_name_hash_mapping, get_data_controlnet, get_data_controlnet_annotation } = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const fetch = require('node-fetch');
const { loadImage } = require('../utils/load_discord_img');
const sharp = require('sharp');


function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}


module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_create')
		.setDescription('Create an AI art via my own Stable Diffusion Web UI instance')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt for the AI to generate art from')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('neg_prompt')
                .setDescription('The negative prompt for the AI to avoid generate art from'))
        .addIntegerOption(option => 
            option.setName('width')
                .setDescription('The width of the generated image (default is 512, recommended max is 768)'))
        .addIntegerOption(option =>
            option.setName('height')
                .setDescription('The height of the generated image (default is 512, recommended max is 768)'))
        .addStringOption(option => 
            option.setName('sampler')
                .setDescription('The sampling method for the AI to generate art from (default is "Euler a")')
                .addChoices(
					{ name: 'Euler a', value: 'Euler a' },
                    { name: 'Euler', value: 'Euler' },
                    { name: 'Heun', value: 'Heun' },
                    { name: 'LMS', value: 'LMS' },
                    { name: 'DPM++ 2S a', value: 'DPM++ 2S a' },
                    { name: 'DPM2', value: 'DPM2' },
                    { name: 'DPM++ 2M Karras', value: 'DPM++ 2M Karras' },
				))
        .addNumberOption(option => 
            option.setName('cfg_scale')
                .setDescription('Lower value = more creative freedom (default is 7, recommended max is 10)'))
        .addIntegerOption(option =>
            option.setName('sampling_step')
                .setDescription('More sampling step = longer generation (default is 20, recommended max is 40)'))
        .addStringOption(option => 
            option.setName('seed')
                .setDescription('Random seed for AI generate art from (default is "-1 - Random")'))
        .addBooleanOption(option =>
            option.setName('override_neg_prompt')
                .setDescription('Override the default negative prompt (default is "false")'))
        .addBooleanOption(option => 
            option.setName('remove_nsfw_restriction')
                .setDescription('Force the removal of nsfw negative prompt (default is "false")'))
        .addBooleanOption(option => 
            option.setName('no_dynamic_lora_load')
                .setDescription('Do not use the bot\'s dynamic LoRA loading (default is "false")'))
        .addNumberOption(option =>
            option.setName('default_lora_strength')
                .setDescription('The strength of lora if loaded dynamically (default is "0.85")'))
        .addNumberOption(option =>
            option.setName('upscale_multiplier')
                .setDescription('The rate to upscale the generated image (default is "1, no upscaling")'))
        .addStringOption(option =>
            option.setName('upscaler')
                .setDescription('Specify the upscaler to use (default is "Lanczos")')
                .addChoices(
                    { name: 'Lanczos - Fast', value: 'Lanczos' },
                    { name: 'ESRGAN_4x', value: 'ESRGAN_4x' },
                    { name: 'R-ESRGAN 4x+ Anime6B', value: 'R-ESRGAN 4x+ Anime6B' },
                    { name: 'SwinIR 4x', value: 'SwinIR 4x' },
					{ name: 'Latent - Slow', value: 'Latent' },
                    { name: 'Latent (antialiased)', value: 'Latent (antialiased)' },
                    { name: 'Latent (nearest)', value: 'Latent (nearest)' },
                    { name: 'Latent (nearest-exact)', value: 'Latent (nearest-exact)' },
                    { name: 'Latent (bicubic)', value: 'Latent (bicubic)' },
				))
        .addNumberOption(option =>
            option.setName('upscale_denoise_strength')
                .setDescription('Lower to 0 mean nothing should change, higher to 1 may output unrelated image (default is "0.7")'))
        .addIntegerOption(option =>
            option.setName('upscale_step')
                .setDescription('Number of upscaling step (default is "20")'))
        .addAttachmentOption(option =>
            option.setName('controlnet_input')
                .setDescription('The input image of the controlnet'))
        .addStringOption(option =>
            option.setName('controlnet_model')
                .setDescription('The model to use for the controlnet (default is "T2I-Adapter - OpenPose")')
                .addChoices(
                    { name: 'None', value: 'None' },
                    { name: 'T2I-Adapter - Canny', value: 't2iadapter_canny_sd14v1 [80bfd79b]' },
                    { name: 'T2I-Adapter - Color', value: 't2iadapter_color_sd14v1 [8522029d]' },
                    { name: 'T2I-Adapter - Depth', value: 't2iadapter_depth_sd14v1 [fa476002]' },
                    { name: 'T2I-Adapter - KeyPose', value: 't2iadapter_keypose_sd14v1 [ba1d909a]' },
                    { name: 'T2I-Adapter - OpenPose', value: 't2iadapter_openpose_sd14v1 [7e267e5e]' },
                    { name: 'T2I-Adapter - Seg', value: 't2iadapter_seg_sd14v1 [6387afb5]' },
                    { name: 'T2I-Adapter - Sketch', value: 't2iadapter_sketch_sd14v1 [e5d4b846]' },
                    { name: 'T2I-Adapter - Style', value: 't2iadapter_style_sd14v1 [202e85cc]' },
                    { name: 'ControlNet - HED', value: 'control_hed-fp16 [13fee50b]' },
                ))
        .addStringOption(option =>
            option.setName('controlnet_preprocessor')
                .setDescription('The preprocessor to use for the controlnet (default is "OpenPose")')
                .addChoices(
                    { name: 'None', value: 'none' },
                    { name: 'Canny', value: 'canny' },
                    { name: 'Depth', value: 'depth' },
                    { name: 'Depth (LERes)', value: 'depth_leres' },
                    { name: 'HED', value: 'hed' },
                    { name: 'OpenPose', value: 'openpose' },
                    { name: 'Segmentation', value: 'segmentation' },
                    { name: 'CLIP Vision', value: 'clip_vision' },
                    { name: 'Color', value: 'color' },
                ))
        // clone the 3 options above for 2 other controlnet
        .addAttachmentOption(option =>
            option.setName('controlnet_input_2')
                .setDescription('The input image of the controlnet'))
        .addStringOption(option =>
            option.setName('controlnet_model_2')
                .setDescription('The model to use for the controlnet (default is "None")')
                .addChoices(
                    { name: 'None', value: 'None' },
                    { name: 'T2I-Adapter - Canny', value: 't2iadapter_canny_sd14v1 [80bfd79b]' },
                    { name: 'T2I-Adapter - Color', value: 't2iadapter_color_sd14v1 [8522029d]' },
                    { name: 'T2I-Adapter - Depth', value: 't2iadapter_depth_sd14v1 [fa476002]' },
                    { name: 'T2I-Adapter - KeyPose', value: 't2iadapter_keypose_sd14v1 [ba1d909a]' },
                    { name: 'T2I-Adapter - OpenPose', value: 't2iadapter_openpose_sd14v1 [7e267e5e]' },
                    { name: 'T2I-Adapter - Seg', value: 't2iadapter_seg_sd14v1 [6387afb5]' },
                    { name: 'T2I-Adapter - Sketch', value: 't2iadapter_sketch_sd14v1 [e5d4b846]' },
                    { name: 'T2I-Adapter - Style', value: 't2iadapter_style_sd14v1 [202e85cc]' },
                    { name: 'ControlNet - HED', value: 'control_hed-fp16 [13fee50b]' },
                ))
        .addStringOption(option =>
            option.setName('controlnet_preprocessor_2')
                .setDescription('The preprocessor to use for the controlnet (default is "None")')
                .addChoices(
                    { name: 'None', value: 'none' },
                    { name: 'Canny', value: 'canny' },
                    { name: 'Depth', value: 'depth' },
                    { name: 'Depth (LERes)', value: 'depth_leres' },
                    { name: 'HED', value: 'hed' },
                    { name: 'OpenPose', value: 'openpose' },
                    { name: 'Segmentation', value: 'segmentation' },
                    { name: 'CLIP Vision', value: 'clip_vision' },
                    { name: 'Color', value: 'color' },
                ))
        // .addAttachmentOption(option =>
        //     option.setName('controlnet_input_3')
        //         .setDescription('The input image of the controlnet'))
        // .addStringOption(option =>
        //     option.setName('controlnet_model_3')
        //         .setDescription('The model to use for the controlnet (default is "None")')
        //         .addChoices(
        //             { name: 'None', value: 'None' },
        //             { name: 'T2I-Adapter - Canny', value: 't2iadapter_canny_sd14v1 [80bfd79b]' },
        //             { name: 'T2I-Adapter - Color', value: 't2iadapter_color_sd14v1 [8522029d]' },
        //             { name: 'T2I-Adapter - Depth', value: 't2iadapter_depth_sd14v1 [fa476002]' },
        //             { name: 'T2I-Adapter - KeyPose', value: 't2iadapter_keypose_sd14v1 [ba1d909a]' },
        //             { name: 'T2I-Adapter - OpenPose', value: 't2iadapter_openpose_sd14v1 [7e267e5e]' },
        //             { name: 'T2I-Adapter - Seg', value: 't2iadapter_seg_sd14v1 [6387afb5]' },
        //             { name: 'T2I-Adapter - Sketch', value: 't2iadapter_sketch_sd14v1 [e5d4b846]' },
        //             { name: 'T2I-Adapter - Style', value: 't2iadapter_style_sd14v1 [202e85cc]' },
        //             { name: 'ControlNet - HED', value: 'control_hed-fp16 [13fee50b]' },
        //         ))
        // .addStringOption(option =>
        //     option.setName('controlnet_preprocessor_3')
        //         .setDescription('The preprocessor to use for the controlnet (default is "None")')
        //         .addChoices(
        //             { name: 'None', value: 'none' },
        //             { name: 'Canny', value: 'canny' },
        //             { name: 'Depth', value: 'depth' },
        //             { name: 'Depth (LERes)', value: 'depth_leres' },
        //             { name: 'HED', value: 'hed' },
        //             { name: 'OpenPose', value: 'openpose' },
        //             { name: 'Segmentation', value: 'segmentation' },
        //             { name: 'CLIP Vision', value: 'clip_vision' },
        //             { name: 'Color', value: 'color' },
        //         ))
        .addBooleanOption(option => 
            option.setName('do_preview_annotation')
                .setDescription('Preview the annotation after preprocessing (default is "false")'))
        .addIntegerOption(option =>
            option.setName('force_server_selection')
                .setDescription('Force the server to use (default is "-1 - Random")'))
    ,

    async init() {
        // setup heartbeat routine to check which server is alive
        initiate_server_heartbeat()
    },

	async execute(interaction, client) {
        if (client.cooldowns.has(interaction.user.id) && !byPassUser.includes(interaction.user.id)) {
            // cooldown not ended
            interaction.reply({ content: "Please wait for cooldown to end", ephemeral: true });
            return 
        }

		let prompt = interaction.options.getString('prompt')
		let neg_prompt = interaction.options.getString('neg_prompt') || '' 
        let width = clamp(interaction.options.getInteger('width') || 512, 64, 1024)
        let height = clamp(interaction.options.getInteger('height') || 512, 64, 1024)
        const sampler = interaction.options.getString('sampler') || 'Euler a'
        const cfg_scale = clamp(interaction.options.getNumber('cfg_scale') || 7, 0, 30)
        const sampling_step = clamp(interaction.options.getInteger('sampling_step') || 20, 1, 100)
        const override_neg_prompt = interaction.options.getBoolean('override_neg_prompt') || false
        const remove_nsfw_restriction = interaction.options.getBoolean('remove_nsfw_restriction') || false
        const no_dynamic_lora_load = interaction.options.getBoolean('no_dynamic_lora_load') || false
        const default_lora_strength = clamp(interaction.options.getNumber('default_lora_strength') || 0.85, 0, 3)
        const upscale_multiplier = clamp(interaction.options.getNumber('upscale_multiplier') || 1, 1, 4)
        const upscaler = interaction.options.getString('upscaler') || 'Lanczos'
        const upscale_denoise_strength = clamp(interaction.options.getNumber('upscale_denoise_strength') || 0.7, 0, 1)
        const force_server_selection = clamp(interaction.options.getInteger('force_server_selection') !== null ? interaction.options.getInteger('force_server_selection') : -1 , -1, 1)
        const upscale_step = clamp(interaction.options.getInteger('upscale_step') || 20, 1, 100)
        const controlnet_input_option = interaction.options.getAttachment('controlnet_input') || null
        const controlnet_model = interaction.options.getString('controlnet_model') || 't2iadapter_openpose_sd14v1 [7e267e5e]'
        let controlnet_preprocessor = interaction.options.getString('controlnet_preprocessor') || 'openpose'
        const controlnet_input_option_2 = interaction.options.getAttachment('controlnet_input_2') || null
        const controlnet_model_2 = interaction.options.getString('controlnet_model_2') || 'none'
        let controlnet_preprocessor_2 = interaction.options.getString('controlnet_preprocessor_2') || 'None'
        // const controlnet_input_option_3 = interaction.options.getAttachment('controlnet_input_3') || null
        // const controlnet_model_3 = interaction.options.getString('controlnet_model_3') || 'none'
        // let controlnet_preprocessor_3 = interaction.options.getString('controlnet_preprocessor_3') || 'None'
        const do_preview_annotation = interaction.options.getBoolean('do_preview_annotation') || false

        let seed = -1
        try {
            seed = parseInt(interaction.options.getString('seed')) || parseInt('-1')
        }
        catch {
            seed = parseInt('-1')
        }

        let controlnet_input = controlnet_input_option ? await loadImage(controlnet_input_option.proxyURL).catch((err) => {
            console.log(err)
            interaction.reply({ content: "Failed to retrieve control net image", ephemeral: true });
        }) : null

        let controlnet_input_2 = controlnet_input_option_2 ? await loadImage(controlnet_input_option_2.proxyURL).catch((err) => {
            console.log(err)
            interaction.reply({ content: "Failed to retrieve control net image 2", ephemeral: true });
        }) : null
        
        // if width or height of the controlnet_input image is not divisible by 8, then it will be resized to the nearest divisible by 8, using sharp
        // if (controlnet_input_option.width % 8 !== 0 || controlnet_input_option.height % 8 !== 0) {
        //     controlnet_input = await sharp(controlnet_input.split(',')[1])
        //         .resize(Math.ceil(controlnet_input_option.width / 8) * 8, Math.ceil(controlnet_input_option.height / 8) * 8)
        //         .png()
        //         .toBuffer()
        //         .then((data) => {
        //             return `data:image/png;base64,${data.toString('base64')}`
        //         })
        //         .catch((err) => {
        //             console.log(err)
        //             interaction.reply({ content: "Failed to resize controlnet image", ephemeral: true });
        //         })
        // }
        if (height % 8 !== 0 || width % 8 !== 0) {
            height = Math.ceil(height / 8) * 8
            width = Math.ceil(width / 8) * 8
        }

        //make a temporary reply to not get timeout'd
		    await interaction.deferReply();

        let server_index = get_worker_server(force_server_selection)

        if (server_index === -1) {
            await interaction.editReply({ content: "No server is available, please try again later"});
            return
        }

        const cooldown = (width * height * sampling_step + (upscale_multiplier > 1 ? (upscale_multiplier * height * upscale_multiplier * width * upscale_step) : 0)) / 1000000

        await interaction.editReply({ content: `Generating image, you can create another image in ${cooldown.toFixed(2)} seconds`});

        // TODO: add progress ping
        let current_preview_id = 0
        const session_hash = crypt.randomBytes(16).toString('base64');
        let isDone = false
        let isCancelled = false
        let progress_ping_delay = 2000

        const WORKER_ENDPOINT = server_pool[server_index].url

        const row = new MessageActionRow()
    			.addComponents(
    				new MessageButton()
    					.setCustomId('cancel')
    					.setLabel('Cancel')
    					.setStyle('DANGER'),
    			);

        const filter = i => i.customId === 'cancel' && i.user.id === interaction.user.id;

        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 800000 });

        collector.on('collect', async i => {
            isCancelled = true
            collector.stop()

            // attempt to stop the generating
            const option_cancel = {
                method: 'POST',
                body: JSON.stringify({
                    fn_index: server_pool[server_index].fn_index_abort,
                    session_hash: session_hash,
                    data: []
                })
            }

            fetch(`${WORKER_ENDPOINT}/run/predict/`, option_cancel)

            try {
                i.message.delete()
                throw "Cancelled"
            }
            catch (err) {
                console.log(err)
            }
        });
        
        if (do_preview_annotation) {
            const controlnet_annotation_data = get_data_controlnet_annotation(controlnet_preprocessor, controlnet_input)
            const option_controlnet_annotation = {
                method: 'POST',
                body: JSON.stringify({
                    fn_index: server_pool[server_index].fn_index_controlnet_annotation,
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
            }

            if (controlnet_input_2) {
                const controlnet_annotation_data_2 = get_data_controlnet_annotation(controlnet_preprocessor_2, controlnet_input_2)
                const option_controlnet_annotation_2 = {
                    method: 'POST',
                    body: JSON.stringify({
                        fn_index: server_pool[server_index].fn_index_controlnet_annotation_2,
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
                }
            }
        }

        // TODO: remove button after collector period has ended

        neg_prompt = get_negative_prompt(neg_prompt, override_neg_prompt, remove_nsfw_restriction)

        prompt = get_prompt(prompt, remove_nsfw_restriction)
        
        if (!no_dynamic_lora_load) {
            prompt = load_lora_from_prompt(prompt, default_lora_strength)
        }
    
        const create_data = get_data_body(server_index, prompt, neg_prompt, sampling_step, cfg_scale, 
            seed, sampler, session_hash, height, width, upscale_multiplier, upscaler, 
            upscale_denoise_strength, upscale_step)

        const controlnet_data = get_data_controlnet(controlnet_preprocessor, controlnet_model, controlnet_input, controlnet_model.includes("sketch") ? 0.8 : 1)
        const controlnet_data_2 = get_data_controlnet(controlnet_preprocessor_2, controlnet_model_2, controlnet_input_2, controlnet_model_2.includes("sketch") ? 0.8 : 1)

        // make option_init but for axios
        const option_init_axios = {
            data: {
                fn_index: server_pool[server_index].fn_index_create,
                session_hash: session_hash,
                data: create_data
            },
            config: {
                timeout: 900000
            }
        }

        const option_progress = {
            method: 'POST',
            body: JSON.stringify({
                id_task: `task(${session_hash})`,
                id_live_preview: current_preview_id,
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }

        const option_controlnet = {
            method: 'POST',
            body: JSON.stringify({
                fn_index: server_pool[server_index].fn_index_controlnet,
                session_hash: session_hash,
                data: controlnet_data
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }

        console.log(`requesting: ${WORKER_ENDPOINT}/run/predict/`)

        function updateInteractionReply(data, state = 'queued') {
            return new Promise(async (resolve, reject) => {
                let embeded = null
                if (state === 'completed') {
                    embeded = new MessageEmbed()
                        .setColor('#22ff77')
                        .setTitle('Output')
                        .setDescription(`Here you go. Generated in ${data.duration.toFixed(2)} seconds.`)
                        .addField('Random seed', data.seed, true)
                        .addField('Model used', `${model_name_hash_mapping.get(data.model) || "Unknown Model"} (${data.model})`, true)
                        .setImage(`attachment://${data.img_name}`)
                        .setFooter({text: `Putting ${Array("my RTX 3060","plub's RTX 3070")[server_index]} to good use!`});
                }
                else if (state === 'progress') {
                    embeded = new MessageEmbed()
                        .setColor('#ffff00')
                        .setTitle('Progress')
                        .setDescription(`Image creation in progress`)
                        .addField('Progress (ETA)', `${(data.progress * 100).toFixed(2)}% (${(data.eta || 0).toFixed(2)}s)`)
                        .setFooter({text: "Working on it..."});

                    if (data.img) {
                        embeded.setImage(`attachment://${data.img_name}`)
                    }
                }
                else if (state === 'queued') {
                    embeded = new MessageEmbed()
                        .setColor('#444444')
                        .setTitle('Queueing')
                        .setDescription('Waiting for the previous creation to be done')
                        .setFooter({text: 'Imagine not having a 4090 instead kekw'})
                }

                if (embeded) {
                    const reply_content = {embeds: [embeded], components: [row]}
                    if (data.img) {
                        reply_content.files = [{attachment: data.img, name: data.img_name}]
                    }

                    await interaction.editReply(reply_content)
                        .catch(err => {
                            console.log(err)
                            reject('Error while updating interaction reply')
                        })

                    resolve()
                }
                else {
                    reject('Attempted to send empty embeded message')
                }
            })
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
        }

        if (controlnet_input_2) {
            const option_controlnet_2 = {
                method: 'POST',
                body: JSON.stringify({
                    fn_index: server_pool[server_index].fn_index_controlnet_2,
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
            }
        }


        function fetch_progress() {
            setTimeout(async () => {
                if (isDone || isCancelled) return
                try {
                    await fetch(`${WORKER_ENDPOINT}/internal/progress`, option_progress)
                        .then(async (res) => res.json())
                        .then(async (progress_res_obj) => {
                            if (progress_res_obj.completed) return
                            if (progress_res_obj.queued) {
                                await updateInteractionReply({}, 'queued').catch(err => {
                                    console.log(err)
                                })
                                return
                            }
                            current_preview_id = progress_res_obj.id_live_preview
                            const img_dataURI = progress_res_obj.live_preview

                            await updateInteractionReply({
                                img: img_dataURI ? Buffer.from(img_dataURI.split(",")[1], 'base64') : null,
                                img_name: 'progress_img.png',
                                progress: progress_res_obj.progress,
                                eta: progress_res_obj.eta
                            }, 'progress').catch(err => {
                                console.log(err)
                            })
                        })
                        .catch(err => {
                            throw err
                        })

                    progress_ping_delay += 500
                    fetch_progress()
                }
                catch (err) {
                    console.log(err)
                }
            }, progress_ping_delay);
        }

        try {
            // initiate the request for image, this fucker refuse to be caught unless put into synchronous by await
            // setTimeout of 1 second before start progress fetching due to this weird behaviour
            setTimeout(() => fetch_progress(), 1000)

            await axios.post(`${WORKER_ENDPOINT}/run/predict/`, option_init_axios.data, option_init_axios.config )
                .then((res) => {
                    if (res.status !== 200) {
                        throw 'Server can be reached but returned non-200 status'
                    }
                    return res.data
                }) // fuck node fetch, all my homies use axios
                .then(async (final_res_obj) => {
                    if (isCancelled) return
                    if (final_res_obj.data) {
                        // if server index == 0, get local image directory, else initiate request to get image from server
                        let img_buffer = null
                        const file_dir = final_res_obj.data[0][0]?.name
                        console.log(final_res_obj.data)
                        if (!file_dir) {
                            throw 'Request return no image'
                        }
                        // all server is remote
                        const img_res = await fetch(`${WORKER_ENDPOINT}/file=${file_dir}`).catch(err => {
                            throw 'Error while fetching image on remote server'
                        })

                        if (img_res && img_res.status === 200) {
                            img_buffer = Buffer.from(await img_res.arrayBuffer())
                        }

                        // attempt to get the image seed (-1 if failed to do so)
                        const seed = JSON.parse(final_res_obj.data[1] || JSON.stringify({seed: -1})).seed.toString()
                        const model_hash = JSON.parse(final_res_obj.data[1] || JSON.stringify({sd_model_hash: "-"})).sd_model_hash
                        console.log(final_res_obj.duration)
                        //console.log(img_buffer, seed)

                        // wait for 2 seconds before updating the interaction reply to avoid race condition
                        await new Promise(resolve => setTimeout(resolve, 2000))

                        // update the interaction reply
                        await updateInteractionReply({
                            img: img_buffer ? img_buffer : file_dir,
                            img_name: 'img.png',
                            seed: seed,
                            model: model_hash,
                            duration: final_res_obj.duration
                        }, 'completed').catch(err => {
                            console.log(err)
                        })

                        isDone = true
                    }
                    else {
                        isCancelled = true
                        throw 'Request return non-JSON data'
                    }
                })
                .catch(err => {
                    isCancelled = true
                    throw err
                });
        }
        catch (err) {
            console.log(err)
            try {
                await interaction.editReply({content: 'Error while creating image: ' + err, components: []})
            }
            catch (err) {
                console.log('cannot send error to discord', err)
            }
        }

        client.cooldowns.set(interaction.user.id, true);

        setTimeout(() => {
            client.cooldowns.delete(interaction.user.id);
        }, cooldown * 1000);
	},
};