const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser, censorGuildIds, optOutGuildIds } = require('../config.json');
const crypt = require('crypto');
const { server_pool, get_prompt, get_negative_prompt, get_worker_server, get_data_body_img2img, model_name_hash_mapping, check_model_filename, 
    model_selection, model_selection_xl, model_selection_legacy, upscaler_selection, sampler_selection, model_selection_inpaint, model_selection_flux, scheduler_selection, 
    sampler_to_comfy_name_mapping,
    scheduler_to_comfy_name_mapping} = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { loadImage } = require('../utils/load_discord_img.js');
const { load_controlnet } = require('../utils/controlnet_execute.js');
const { cached_model, model_change } = require('../utils/model_change.js');
const { queryRecordLimit } = require('../database/database_interaction.js');
const { load_adetailer } = require('../utils/adetailer_execute.js');
const { full_prompt_analyze, preview_coupler_setting, fetch_user_defined_wildcard, get_teacache_config_from_prompt } = require('../utils/prompt_analyzer.js');
const { load_profile } = require('../utils/profile_helper.js');
const { clamp, parse_common_setting } = require('../utils/common_helper');
const workflow_outpaint = require('../resources/flux_fill_outpaint.json')
const workflow_kontext = require('../resources/flux_kontext.json')
const ComfyClient = require('../utils/comfy_client');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_img2img_adv')
		.setDescription('Request my Diffusion instance to generate art from an image - Advanced Mode')
		.addAttachmentOption(option =>
			option.setName('image')
				.setDescription('The image to be regenerate')
				.setRequired(true))
		.addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt for the AI to generate art from'))
        .addStringOption(option => 
            option.setName('neg_prompt')
                .setDescription('The negative prompt for the AI to avoid generate art from'))
        .addNumberOption(option => 
            option.setName('denoising_strength')
                .setDescription('How much the image is noised before regen, closer to 0 = closer to original (0 - 1, default 0.7)'))
        .addIntegerOption(option => 
            option.setName('width')
                .setDescription('The width of the generated image (default is image upload size, recommended max is 768)'))
        .addIntegerOption(option =>
            option.setName('height')
                .setDescription('The height of the generated image (default is image upload size, recommended max is 768)'))
        .addStringOption(option => 
            option.setName('sampler')
                .setDescription('The sampling method for the AI to generate art from (default is "Euler")')
                .addChoices(...sampler_selection))
        .addStringOption(option => 
            option.setName('scheduler')
                .setDescription('The scheduling method for the AI to generate art from (default is "Automatic")')
                .addChoices(...scheduler_selection))
        .addNumberOption(option => 
            option.setName('cfg_scale')
                .setDescription('Lower value = more creative freedom (default is 7, recommended max is 10)'))
        .addIntegerOption(option =>
            option.setName('sampling_step')
                .setDescription('More sampling step = longer generation (default is 20, recommended max is 40)'))
        .addStringOption(option => 
            option.setName('seed')
                .setDescription('Random seed for AI generate art from (default is "-1 - Random")'))
        .addStringOption(option =>
            option.setName('default_neg_prompt')
                .setDescription('Define the default negative prompt for the user (default is "None - No NSFW")')
                .addChoices(
                    { name: 'Quality - SFW', value: 'q_sfw' },
                    { name: 'Quality - NSFW', value: 'q_nsfw' },
                    { name: 'None - SFW', value: 'n_sfw' },
                    { name: 'No Default', value: 'n_nsfw' },
                ))
        // .addIntegerOption(option =>
        //     option.setName('force_server_selection')
        //         .setDescription('Force the server to use (default is "-1 - Random")'))
        .addIntegerOption(option =>
            option.setName('clip_skip')
                .setDescription('Early stopping parameter for CLIP model (default is 1, recommend 1 and 2)'))
        .addAttachmentOption(option =>
            option.setName('controlnet_input')
                .setDescription('The input image of the controlnet'))
        .addAttachmentOption(option =>
            option.setName('controlnet_input_2')
                .setDescription('The input image of the controlnet'))
        .addAttachmentOption(option =>
            option.setName('controlnet_input_3')
                .setDescription('The input image of the controlnet'))
        .addStringOption(option =>
            option.setName('controlnet_config')
                .setDescription('Config string for the controlnet (use wd_controlnet to generate)'))
        .addStringOption(option => 
            option.setName('checkpoint')
                .setDescription('Force a cached checkpoint to be used (not all option is cached)')
                .addChoices(...(model_selection.concat(model_selection_xl).concat(model_selection_flux).filter(x => !model_selection_legacy.map(y => y.value).includes(x.value)))))
        .addStringOption(option =>
            option.setName('upscaler')
                .setDescription('The upscaler to use (default is "None")')
                .addChoices(...upscaler_selection))
        .addStringOption(option =>
            option.setName('profile')
                .setDescription('Specify the profile to use (default is No Profile)'))
        .addBooleanOption(option =>
            option.setName('do_adetailer')
                .setDescription('[Experimental] Attempt to fix hands and face details (default is "false")'))
        .addStringOption(option =>
            option.setName('adetailer_config')
                .setDescription('Config string for the adetailer (use wd_adetailer to generate)'))
        .addStringOption(option =>
            option.setName('extra_script')
                .setDescription('Specify an extra script to be used during the process')
                .addChoices(
                    { name: 'None', value: 'None' },
                    // { name: 'Img2Img Upscale', value: 'Ultimate SD upscale' },
                    // { name: 'Outpainting', value: 'Outpainting mk2' },
                    { name: 'Flux Outpaint', value: 'Flux Outpaint' },
                    { name: 'Flux Kontext', value: 'Flux Kontext' },
                ))
                
    ,

    async execute_comfy_flux_kontext(interaction, client, data) {
        const workflow = JSON.parse(JSON.stringify(workflow_kontext))

        workflow["27"]["inputs"]["width"] = workflow["30"]["inputs"]["width"] = data.width
        workflow["30"]["inputs"]["height"] = workflow["30"]["inputs"]["width"] = data.height
        workflow["6"]["inputs"]["text"] = data.prompt

        workflow["16"]["inputs"]["sampler_name"] = data.sampler
        workflow["17"]["inputs"]["steps"] = data.sampling_step
        workflow["17"]["inputs"]["scheduler"] = data.scheduler
        workflow["26"]["inputs"]["guidance"] = data.cfg_scale
        workflow["25"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 2_000_000_000)
        workflow["60"]["inputs"]["rel_l1_thresh"] = data.teacache_strength

        //set the image buffer to the workflow
        const image_info = await ComfyClient.uploadImage(data.attachment, Date.now() + "_" + data.attachment_option.name, data.attachment_option.contentType).catch((err) => {
            console.log("Failed to upload image", err)
            return
        })

        console.log(image_info)

        if (image_info == null) {
            interaction.editReply({ content: "Failed to receive input image" });
            return
        }

        workflow["41"]["inputs"]["image"] = image_info.name

        ComfyClient.sendPrompt(workflow, (data) => {
            if (data.node !== null) interaction.editReply({ content: "Processing: " + workflow[data.node]["_meta"]["title"] });
        }, (data) => {
            console.log('received success')
            const filename = data.output.images[0].filename

            // fetch video from comfyUI
            ComfyClient.getImage(filename, '', '', /*only_filename*/ true).then(async (arraybuffer) => {
                // convert arraybuffer to buffer
                const buffer = Buffer.from(arraybuffer)

                await interaction.editReply({ content: "Generation Success", files: [{ attachment: buffer, name: filename }] });
            }).catch((err) => {
                console.log("Failed to retrieve image", err)
                interaction.editReply({ content: "Failed to retrieve image" });
            }).finally(() => {
                ComfyClient.freeMemory(true)
            })

        }, (data) => {
            console.log('received error')
            interaction.editReply({ content: data.error });
            ComfyClient.freeMemory(true)
        }, (data) => {
            console.log('received progress')
            interaction.editReply({ content: "Processing: " + workflow[data.node]["_meta"]["title"] + ` (${data.value}/${data.max})` });
        });
    },

    async execute_comfy_flux_outpaint(interaction, client, data) {
        const workflow = JSON.parse(JSON.stringify(workflow_outpaint))

        workflow["3"]["inputs"]["steps"] = data.sampling_step
        workflow["23"]["inputs"]["text"] = data.prompt

        workflow["3"]["inputs"]["sampler_name"] = data.sampler
        workflow["3"]["inputs"]["scheduler"] = data.scheduler
        workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 2_000_000_000)
        workflow["46"]["inputs"]["rel_l1_thresh"] = data.teacache_strength

        // extract outpaint config
        const outpaint_config = {
            top: (data.outpaint_config_obj?.direction.includes('up') ? data.outpaint_config_obj.top || data.outpaint_config_obj.size : 0),
            bottom: (data.outpaint_config_obj?.direction.includes('down') ? data.outpaint_config_obj.bottom || data.outpaint_config_obj.size : 0),
            left: (data.outpaint_config_obj?.direction.includes('left') ? data.outpaint_config_obj.left || data.outpaint_config_obj.size : 0),
            right: (data.outpaint_config_obj?.direction.includes('right') ? data.outpaint_config_obj.right || data.outpaint_config_obj.size : 0),
            feathering: data.outpaint_config_obj?.mask_blur || 24,
        }

        workflow["44"]["inputs"]["top"] = outpaint_config.top
        workflow["44"]["inputs"]["bottom"] = outpaint_config.bottom
        workflow["44"]["inputs"]["left"] = outpaint_config.left
        workflow["44"]["inputs"]["right"] = outpaint_config.right
        workflow["44"]["inputs"]["feathering"] = outpaint_config.feathering

        //set the image buffer to the workflow
        const image_info = await ComfyClient.uploadImage(data.attachment, Date.now() + "_" + data.attachment_option.name, data.attachment_option.contentType).catch((err) => {
            console.log("Failed to upload image", err)
            return
        })

        console.log(image_info)

        if (image_info == null) {
            interaction.editReply({ content: "Failed to receive input image" });
            return
        }

        workflow["17"]["inputs"]["image"] = image_info.name

        ComfyClient.sendPrompt(workflow, (data) => {
            if (data.node !== null) interaction.editReply({ content: "Processing: " + workflow[data.node]["_meta"]["title"] });
        }, (data) => {
            console.log('received success')
            const filename = data.output.images[0].filename

            // fetch video from comfyUI
            ComfyClient.getImage(filename, '', '', /*only_filename*/ true).then(async (arraybuffer) => {
                // convert arraybuffer to buffer
                const buffer = Buffer.from(arraybuffer)

                await interaction.editReply({ content: "Generation Success", files: [{ attachment: buffer, name: filename }] });
            }).catch((err) => {
                console.log("Failed to retrieve image", err)
                interaction.editReply({ content: "Failed to retrieve image" });
            }).finally(() => {
                ComfyClient.freeMemory(true)
            })

        }, (data) => {
            console.log('received error')
            interaction.editReply({ content: data.error });
            ComfyClient.freeMemory(true)
        }, (data) => {
            console.log('received progress')
            interaction.editReply({ content: "Processing: " + workflow[data.node]["_meta"]["title"] + ` (${data.value}/${data.max})` });
        });
    },

	async execute(interaction, client) {
        if (client.cooldowns.has(interaction.user.id) && !byPassUser.includes(interaction.user.id)) {
            // cooldown not ended
            interaction.reply({ content: "Please wait for cooldown to end", ephemeral: true });
            return 
        }

        //make a temporary reply to not get timeout'd
		await interaction.deferReply();

        const profile_option = interaction.options.getString('profile') || null
        let profile = null
        if (profile_option != null) {
            profile = await load_profile(profile_option, interaction.user.id).catch(err => {
                interaction.channel.send(err)
            })
        }

		// load the option with default value
		let prompt = (profile?.prompt_pre || '') + (interaction.options.getString('prompt') || '') + (profile?.prompt || '')
		let neg_prompt = (profile?.neg_prompt_pre || '') + (interaction.options.getString('neg_prompt') || '') + (profile?.neg_prompt || '')
        let width = interaction.options.getInteger('width') || profile?.width 
        let height = interaction.options.getInteger('height') || profile?.height
        const denoising_strength = clamp(interaction.options.getNumber('denoising_strength') || 0.7, 0, 1)
        const sampler = interaction.options.getString('sampler') || profile?.sampler || 'Euler'
        const scheduler = interaction.options.getString('scheduler') || profile?.scheduler || 'Automatic'
        const cfg_scale = clamp(interaction.options.getNumber('cfg_scale') || profile?.cfg_scale || 7, 0, 30)
        const sampling_step = clamp(interaction.options.getInteger('sampling_step') || profile?.sampling_step || 20, 1, 100)
        const default_neg_prompt = interaction.options.getString('default_neg_prompt') || 'n_sfw'
        const force_server_selection = clamp(interaction.options.getInteger('force_server_selection') !== null ? interaction.options.getInteger('force_server_selection') : -1 , -1, 1)
        const controlnet_input_option = interaction.options.getAttachment('controlnet_input') || null
        const controlnet_input_option_2 = interaction.options.getAttachment('controlnet_input_2') || null
        const controlnet_input_option_3 = interaction.options.getAttachment('controlnet_input_3') || null
        const controlnet_config = interaction.options.getString('controlnet_config') || 
            profile?.controlnet_config ||
            (client.controlnet_config.has(interaction.user.id) ? client.controlnet_config.get(interaction.user.id) : null)
        const checkpoint = interaction.options.getString('checkpoint') || profile?.checkpoint || null
        const upscaler = interaction.options.getString('upscaler') || 'None'
        const clip_skip = clamp(interaction.options.getInteger('clip_skip') || profile?.clip_skip || 1, 1, 12)
        const do_adetailer = interaction.options.getBoolean('do_adetailer') || false
        const adetailer_config = interaction.options.getString('adetailer_config') || 
            profile?.adetailer_config ||
            (client.adetailer_config.has(interaction.user.id) ? client.adetailer_config.get(interaction.user.id) : null)
        const booru_gen_config = profile?.boorugen_config || (client.boorugen_config.has(interaction.user.id) ? client.boorugen_config.get(interaction.user.id) : null)
        const latentmod_config = profile?.latentmod_config || (client.latentmod_config.has(interaction.user.id) ? client.latentmod_config.get(interaction.user.id) : null)
        const colorbalance_config = interaction.options.getString('colorbalance_config') ||
            profile?.colorbalance_config ||
            (client.colorbalance_config.has(interaction.user.id) ? client.colorbalance_config.get(interaction.user.id) : null)
        const extra_script = interaction.options.getString('extra_script') || 'None'
        const outpaint_config = profile?.script_outpaint_config || 
            (client.img2img_outpaint_config.has(interaction.user.id) ? client.img2img_outpaint_config.get(interaction.user.id) : null)
        const upscale_config = profile?.script_upscale_config ||
            (client.img2img_upscale_config.has(interaction.user.id) ? client.img2img_upscale_config.get(interaction.user.id) : null)
    
        // parse the user setting config
        const usersetting_config = client.usersetting_config.has(interaction.user.id) ? client.usersetting_config.get(interaction.user.id) : null
        const usersetting = parse_common_setting(usersetting_config)
        
        let seed = -1
        try {
            seed = parseInt(interaction.options.getString('seed')) || parseInt('-1')
        }
        catch {
            seed = parseInt('-1')
        }

        let attachment_option = interaction.options.getAttachment('image')

        //download the image from attachment.proxyURL
        let attachment = null
        if (extra_script === 'Flux Kontext' || extra_script === 'Flux Outpaint') {
            // if the extra script is flux kontext or flux outpaint, use comfyUI
            attachment = await loadImage(attachment_option.proxyURL,
                /*getBuffer:*/ true).catch((err) => {
                console.log("Failed to retrieve image from discord", err)
                return
            })
        }
        else {
            attachment = await loadImage(attachment_option.proxyURL,
                /*getBuffer:*/ false, /*noDataURIHeader*/ false, /*safeMode*/ true).catch((err) => {
                console.log(err)
                interaction.editReply({ content: "Failed to retrieve image", ephemeral: true });
                return
            })
        }

        if (!attachment) {
            interaction.editReply({ content: "Failed to retrieve image", ephemeral: true });
            return
        }

        let controlnet_input = controlnet_input_option ? await loadImage(controlnet_input_option.proxyURL,
            /*getBuffer:*/ false, /*noDataURIHeader*/ false, /*safeMode*/ true).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to retrieve control net image", ephemeral: true });
        }) : null

        let controlnet_input_2 = controlnet_input_option_2 ? await loadImage(controlnet_input_option_2.proxyURL,
            /*getBuffer:*/ false, /*noDataURIHeader*/ false, /*safeMode*/ true).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to retrieve control net image 2", ephemeral: true });
        }) : null

        let controlnet_input_3 = controlnet_input_option_3 ? await loadImage(controlnet_input_option_3.proxyURL,
            /*getBuffer:*/ false, /*noDataURIHeader*/ false, /*safeMode*/ true).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to retrieve control net image 3", ephemeral: true });
        }) : null

        if (checkpoint) {
            const change_result = await model_change(checkpoint, false).catch(err => {
                console.log(err)
            })
    
            if (!change_result) {
                await interaction.channel.send(`Model is not cached or model change failed, fallback to to **${check_model_filename(cached_model[0])}**
currently cached models: ${cached_model.map(x => check_model_filename(x)).join(', ')}`)
            }
            else {
                await interaction.channel.send(`Active model changed to **${check_model_filename(checkpoint)}**
currently cached models: ${cached_model.map(x => check_model_filename(x)).join(', ')}`)
            }
        }

        // if cached_model[0] is inpaint model, force change to the main model
        if (cached_model[0].includes('_inpaint') && extra_script !== 'Outpainting mk2') {
            interaction.channel.send(`Active model is inpaint model, changing to main model`)
            const main_model = model_selection_inpaint.find(x => x.inpaint === cached_model[0])?.value || cached_model[0]
            const change_result = await model_change(main_model, true).catch(err => 
                console.log(err)
            )

            if (!change_result) {
                await interaction.channel.send(`Model is not cached or model change failed, fallback to to **${check_model_filename(cached_model[0])}**
currently cached models: ${cached_model.map(x => check_model_filename(x)).join(', ')}`)
            }
            else {
                await interaction.channel.send(`Active model changed to **${check_model_filename(main_model)}**
currently cached models: ${cached_model.map(x => check_model_filename(x)).join(', ')}`)
            }
        }

        if (!height) {
            height = attachment_option.height
            console.log('height not set, using attachment height:', height)
            if (!height) {
                height = 1024
                console.log('height not set, using default height:', height)
            }
        }
        if (!width) {
            width = attachment_option.width
            console.log('width not set, using attachment width:', width)
            if (!width) {
                width = 1024
                console.log('width not set, using default width:', width)
            }
        }

        // if the width and height is too big (exceed 2048) attempt to shrink width and height with the same ratio
        if (width > 2048 || height > 2048) {
            const ratio = width / height
            if (width > height) {
                width = 2048
                height = Math.floor(2048 / ratio)
            }
            else {
                height = 2048
                width = Math.floor(2048 * ratio)
            }
            console.log('width and height exceed 2048, shrink to:', width, height)
        }

        if (height % 8 !== 0 || width % 8 !== 0) {
            height = Math.ceil(height / 8) * 8
            width = Math.ceil(width / 8) * 8
        }

        let server_index = get_worker_server(force_server_selection)

		if (server_index === -1) {
            await interaction.editReply({ content: "No server is available, please try again later"});
            return
        }

        // TODO: add progress ping
        let current_preview_id = 0
        const session_hash = crypt.randomBytes(16).toString('base64');
        let isDone = false
        let isCancelled = false
        let progress_ping_delay = 2000
        const is_xl = model_selection_xl.find(x => x.value === cached_model[0]) != null
        const is_flux = model_selection_flux.find(x => x.value === cached_model[0]) != null
        const is_vpred = cached_model[0].includes('vpred')

        if (is_flux ? width * height > 1_800_000 : is_xl ? width * height > 1_200_000 : width * height > 640_000) {
            await interaction.channel.send(`:warning: Image size is too large for model's capability and may introduce distorsion, please consider using smaller image size unless you know what you're doing`);
        }
        if (is_vpred) {
            await interaction.channel.send(`:information_source: This model is using v-prediction method, which may not be compatible with every setting of the command`);
        }

        const slow_sampler = ['DPM++ SDE', 'DPM++ 2M SDE', 'DPM++ 2M SDE Heun', 'Restart']
        // calculate cooldown (first pass)
        let compute = width * height * sampling_step * (is_flux ? 3 : (is_xl ? 1.5 : 1)) * (slow_sampler.includes(sampler) ? 1.5 : 1) * denoising_strength
        // calculate cooldown (controlnet)
        compute = compute * (1 + (controlnet_input ? 0.5 : 0) + (controlnet_input_2 ? 0.5 : 0) + (controlnet_input_3 ? 0.5 : 0))
        // calculate compute (adetailer)
        compute = compute * (do_adetailer ? 1.5 : 1)
        // reduce time if use teacache
        const teacache_check = get_teacache_config_from_prompt(prompt, true)
        if (teacache_check.teacache_config) {
            compute = compute * Math.pow(1 - (teacache_check.teacache_config.threshold || 0.1), 2)
        }
        // calculate compute (change model)
        compute += checkpoint ? 2_000_000 : 0

        const cooldown = compute / 1_700_000
        
        await interaction.editReply({ content: `Generating image, you can create another image in ${cooldown.toFixed(2)} seconds ${teacache_check.teacache_config ? "(Teacache activated: -" + (100 * (1 - Math.pow(1 - teacache_check.teacache_config?.threshold || 0.1, 2))).toFixed(0) + "%)" : ""}` });

        if (controlnet_input && controlnet_config && !is_flux) {
            await load_controlnet(session_hash, server_index, controlnet_input, controlnet_input_2, controlnet_input_3, controlnet_config, interaction, 1)
                .catch(err => {
                    console.log(err)
                    interaction.editReply({ content: "Failed to load control net:" + err });
                });
        }

        // load extra script
        let outpaint_config_obj = null
        let upscale_config_obj = null
        if (extra_script === 'Outpainting mk2') {
            if (!outpaint_config) {
                interaction.editReply({ content: "Outpainting config is not set, please set it first using /wd_script_outpaint"});
                return
            }

            // parse the config string
            try {
                outpaint_config_obj = JSON.parse(outpaint_config)
            }
            catch (err) {
                interaction.editReply({ content: "Failed to parse Outpainting config"});
                return
            }

            interaction.channel.send('Outpainting mk2 script loaded')
        }
        else if (extra_script === 'Ultimate SD upscale') {
            if (!upscale_config) {
                interaction.editReply({ content: "Upscale config is not set, please set it first using /wd_script_upscale"});
                return
            }
            //console.log(upscale_config)
            // parse the config string
            try {
                upscale_config_obj = JSON.parse(upscale_config)
            }
            catch (err) {
                //console.log(err)
                interaction.editReply({ content: "Failed to parse Upscale config"});
                return
            }

            interaction.channel.send('Ultimate SD upscale script loaded')
        }
        else if (extra_script === 'Flux Outpaint') {
            if (!outpaint_config) {
                interaction.editReply({ content: "Flux Outpaint config is not set, please set it first using /wd_script_outpaint"});
                return
            }
            // parse the config string
            try {
                outpaint_config_obj = JSON.parse(outpaint_config)
            }
            catch (err) {
                interaction.editReply({ content: "Failed to parse Flux Outpaint config"});
                return
            }
            // remove the teacache config from the prompt
            get_teacache_config_from_prompt(prompt, false)

            interaction.channel.send('Flux Outpaint is selected, switching to comfy backend, not all features are supported')
            this.execute_comfy_flux_outpaint(interaction, client, {
                prompt: prompt,
                neg_prompt: neg_prompt,
                sampling_step: sampling_step,
                cfg_scale: cfg_scale,
                seed: seed,
                sampler: sampler_to_comfy_name_mapping[sampler] ?? "euler",
                scheduler: scheduler_to_comfy_name_mapping[scheduler] ?? "normal",
                teacache_strength: teacache_check.teacache_config ? teacache_check.teacache_config.threshold : 0,
                session_hash: session_hash,
                height: height,
                width: width,
                attachment: attachment,
                attachment_option: attachment_option,
                outpaint_config_obj: outpaint_config_obj,
            })
            return
        }
        else if (extra_script === 'Flux Kontext') {
            interaction.channel.send('Flux Kontext is selected, switching to comfy backend, not all features are supported')
            // remove the teacache config from the prompt
            get_teacache_config_from_prompt(prompt, false)

            this.execute_comfy_flux_kontext(interaction, client, {
                prompt: prompt,
                neg_prompt: neg_prompt,
                sampling_step: sampling_step,
                cfg_scale: cfg_scale,
                seed: seed,
                sampler: sampler_to_comfy_name_mapping[sampler] ?? "euler",
                scheduler: scheduler_to_comfy_name_mapping[scheduler] ?? "normal",
                teacache_strength: teacache_check.teacache_config ? teacache_check.teacache_config.threshold : 0,
                session_hash: session_hash,
                height: height,
                width: width,
                attachment: attachment,
                attachment_option: attachment_option,
            })
            return
        }

        const WORKER_ENDPOINT = server_pool[server_index].url

        const row = new MessageActionRow()
    			.addComponents(
    				new MessageButton()
    					.setCustomId('cancel_img2img_' + interaction.id)
    					.setLabel('Cancel')
    					.setStyle('DANGER'),
    			);

        const filter = i => i.customId === 'cancel_img2img_' + interaction.id && i.user.id === interaction.user.id;

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

        // TODO: remove button after collector period has ended
        const default_neg_prompt_comp = default_neg_prompt.split('_')
        const override_neg_prompt = default_neg_prompt_comp[0] === 'n'
        const remove_nsfw_restriction = default_neg_prompt_comp[1] === 'nsfw'
        let extra_config = null

        neg_prompt = get_negative_prompt(neg_prompt, override_neg_prompt, remove_nsfw_restriction, cached_model[0])

        prompt = get_prompt(prompt, remove_nsfw_restriction, cached_model[0])
        extra_config = full_prompt_analyze(prompt, is_xl)
        prompt = extra_config.prompt
        prompt = await fetch_user_defined_wildcard(prompt, interaction.user.id)

        if (extra_config.coupler_config && (height % 64 !== 0 || width % 64 !== 0)) {
            interaction.channel.send('Coupler detected, changing resolution to multiple of 64')
            height = Math.ceil(height / 64) * 64
            width = Math.ceil(width / 64) * 64
        }

        if (extra_config.coupler_config && extra_config.coupler_config.mode === 'Advanced') {
            preview_coupler_setting(interaction, width, height, extra_config, server_pool[server_index].fn_index_coupler_region_preview[1], session_hash)
        }

        const is_censor = ((interaction.guildId && censorGuildIds.includes(interaction.guildId)) || (interaction.channel && !interaction.channel.nsfw && !optOutGuildIds.includes(interaction.guildId))) ? true : false

        if (do_adetailer && adetailer_config) {
            await load_adetailer(session_hash, server_index, adetailer_config, interaction, extra_config.coupler_config, prompt, 1)
                .catch(err => {
                    console.log(err)
                    interaction.editReply({ content: "Failed to load adetailer:" + err });
                });
        }
        
        if (extra_config.use_foocus) {
            interaction.channel.send('Enhancing image with Foocus prompt expansion engine.')
        }
        if (extra_config.use_booru_gen) {
            interaction.channel.send('Enhancing image with BooruGen prompt expansion engine.')
        }
        if (extra_config.tipo_input) {
            interaction.channel.send('Enhancing image with TIPO input expansion engine.')
        }
        let booru_gen_config_obj = null
        if (booru_gen_config) {
            // try parse the config string
            try {
                booru_gen_config_obj = JSON.parse(booru_gen_config)
                interaction.channel.send('Applying BooruGen config')
            }
            catch (err) {
                interaction.channel.send("Failed to parse BooruGen config")
                return
            }
        }
        let colorbalance_config_obj = null
        if (colorbalance_config) {
            // try parse the config string
            try {
                colorbalance_config_obj = JSON.parse(colorbalance_config)
                interaction.channel.send('Applying color balance to the vectorscope plugin')
            }
            catch (err) {
                interaction.channel.send("Failed to parse ColorBalance config")
                return
            }
        }
        let latentmod_config_obj = null
        if (latentmod_config) {
            // try parse the config string
            try {
                latentmod_config_obj = JSON.parse(latentmod_config)
                interaction.channel.send('Applying Latent Modifier config')
            }
            catch (err) {
                interaction.channel.send("Failed to parse Latent Modifier config")
                return
            }
        }
    
        const create_data = get_data_body_img2img(server_index, prompt, neg_prompt, sampling_step, cfg_scale,
            seed, sampler, scheduler, session_hash, height, width, attachment, null, denoising_strength, /*img2img mode*/ 0, 4, "original", upscaler, 
            do_adetailer, extra_config.coupler_config, extra_config.color_grading_config, clip_skip, is_censor,
            extra_config.freeu_config, extra_config.dynamic_threshold_config, extra_config.pag_config, "Whole picture", 32, 
            extra_config.use_foocus, extra_config.use_booru_gen, booru_gen_config_obj, is_flux, null, null, colorbalance_config_obj, usersetting, outpaint_config_obj, 
            upscale_config_obj, extra_script, extra_config.detail_daemon_config, extra_config.tipo_input, latentmod_config,
            extra_config.mahiro_config, extra_config.teacache_config)

        // console.log(JSON.stringify(create_data.filter((x, i) => i !== 5), null, 2))

        // make option_init but for axios
        const option_init_axios = {
            data: {
                fn_index: server_pool[server_index].fn_index_img2img,
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
                        .addField('Model used', `${data.model_name || "Unknown Model"} (${data.model})`, true)
                        .setImage(`attachment://${data.img_name}`)
                        .setFooter({text: `Putting ${Array("my RTX 4060 Ti","plub's RTX 3070")[server_index]} to good use!`});
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

                    // if completed, only allow edit if the state is completed
                    if ((state === 'progress' || state === 'queued') && (isDone || isCancelled)) {
                        resolve()
                        return
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

                }
                catch (err) {
                    console.log(err)
                }
                finally {
                    progress_ping_delay += 500
                    fetch_progress()
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
                    if (final_res_obj.data) {
                        // if server index == 0, get local image directory, else initiate request to get image from server
                        let img_buffer = null
                        const file_dir = final_res_obj.data[0].value[0]?.image.path
                        console.log(final_res_obj.data)
                        if (!file_dir) {
                            // error from python server side, we bail
                            throw 'Request return no image'
                        }
                        // all server is now remote
                        // retry fetch before throwing
                        let fetch_final_retry_count = 0
                        let img_res = null
                        while (fetch_final_retry_count < 3 && !img_res) {
                            img_res = await fetch(`${WORKER_ENDPOINT}/file=${file_dir}`).catch(err => {
                                console.log('Error while fetching image on remote server, retrying...')
                            })
                            fetch_final_retry_count++
                            // wait for 2 seconds before retry
                            await new Promise(resolve => setTimeout(resolve, 2000))
                        }
                        if (!img_res) {
                            throw 'Error while fetching image on remote server'
                        }

                        if (img_res && img_res.status === 200) {
                            img_buffer = Buffer.from(await img_res.arrayBuffer())
                        }

                        // attempt to get the image seed (-1 if failed to do so)
                        const seed = JSON.parse(final_res_obj.data[2] || JSON.stringify({seed: -1})).seed.toString()
                        const model_hash = JSON.parse(final_res_obj.data[2] || JSON.stringify({sd_model_hash: "-"})).sd_model_hash
                        const model_name = JSON.parse(final_res_obj.data[2] || JSON.stringify({sd_model_name: "-"})).sd_model_name
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
                            model_name: model_name,
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
                })
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
        }, cooldown);
	},
};