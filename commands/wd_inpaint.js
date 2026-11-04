const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser, censorGuildIds, optOutGuildIds } = require('../config.json');
const crypt = require('crypto');
const { server_pool, get_prompt, get_negative_prompt, get_worker_server, get_data_body_img2img, model_name_hash_mapping, model_selection_legacy, check_model_filename, model_selection, sampler_selection, model_selection_xl, model_selection_inpaint, model_selection_flux, scheduler_selection, sampler_to_comfy_name_mapping, scheduler_to_comfy_name_mapping } = require('../utils/ai_server_config.js');
const sharp = require('sharp');
const { serviceHeaders } = require('../utils/proxy_config');
const { forgeWorkload } = require('../utils/orchestrator_workload');
const SD_HEADERS = serviceHeaders('sdwebui');
const _nodeFetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
// Inject the sdwebui proxy routing header on every request in this command.
const fetch = (url, options = {}) => _nodeFetch(url, {
    ...options,
    headers: { ...SD_HEADERS, ...(options.headers || {}) },
});
const { loadImage, uploadDiscordImageToGradio, uploadPngBufferToGradio } = require('../utils/load_discord_img');
const { load_controlnet } = require('../utils/controlnet_execute');
const { cached_model, model_change, sync_active_model } = require('../utils/model_change');
const { segmentAnything_execute, groundingDino_execute, expandMask, unloadAllModel } = require('../utils/segment_execute.js');
const { full_prompt_analyze, fetch_user_defined_wildcard, preview_coupler_setting, get_teacache_config_from_prompt } = require('../utils/prompt_analyzer.js');
const { queryRecordLimit } = require('../database/database_interaction.js');
const { load_profile } = require('../utils/profile_helper.js');
const { clamp, parse_common_setting } = require('../utils/common_helper');
const { get_model_family_defaults } = require('../utils/model_defaults');
const { withForgeSession } = require('../utils/forge_session');
const { withForgeImageModeCompat } = require('../utils/forge_image_command');
const { runForgeImageJob, dataUriToBuffer } = require('../utils/forge_image_job');
const { get_anima_inpaint_unit, is_anima_model } = require('../utils/anima_inpaint');
const workflow_inpaint = require('../resources/flux_fill_inpaint.json')
const { runComfyImageJob } = require('../utils/comfy_image_job');

const normalize_model_name = value => typeof value === 'string'
    ? value.trim().replaceAll('\\', '/').split('/').pop().toLowerCase()
    : ''

function get_gradio_file_path(file) {
    if (!file) return null
    if (typeof file === 'string') {
        return file.startsWith('data:') ? null : file
    }
    if (typeof file.path === 'string' && file.path) return file.path
    return null
}

async function fetch_gradio_file(endpoint, file, label) {
    if (typeof file === 'string' && file.startsWith('data:image/')) {
        const buffer = dataUriToBuffer(file)
        if (!buffer || buffer.length === 0) throw new Error(`${label} returned an empty inline image`)
        return buffer
    }
    const file_path = get_gradio_file_path(file)
    if (!file_path) throw new Error(`${label} returned no file path`)
    const response = await fetch(`${endpoint}/file=${encodeURI(file_path)}`)
    if (!response || response.status !== 200) {
        throw new Error(`${label} download failed with status ${response?.status ?? 'unknown'}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) throw new Error(`${label} download returned an empty file`)
    return buffer
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_inpaint')
		.setDescription('(Attempt) to regenerate the image with an inpaint mask')
		.addAttachmentOption(option =>
			option.setName('image')
				.setDescription('The image to be regenerate')
				.setRequired(true))
		.addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt for the AI to generate art from')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('mask')
                .setDescription('The mask marking where the image should be regenerated'))
        .addStringOption(option => 
            option.setName('neg_prompt')
                .setDescription('The negative prompt for the AI to avoid generate art from'))
        .addNumberOption(option => 
            option.setName('denoising_strength')
                .setDescription('How much the image is noised before regen, closer to 0 = closer to original (0 - 1, default 1)'))
        .addIntegerOption(option =>
            option.setName('mask_blur')
                .setDescription('How much pixel is the mask being blurred, closer to 0 = closer to original (0 - 64, default 4)'))
        .addStringOption(option => 
            option.setName('mask_content')
                .setDescription('The content that should fill the mask (default is "latent nothing")')
                .addChoices(
                    { name: 'Fill - Keep color', value: 'fill' },
                    { name: 'Original - Keep both color and comp.', value: 'original' },
                    { name: 'Latent Noise - Keep composition', value: 'latent noise' },
                    { name: 'Latent Nothing - Keep nothing', value: 'latent nothing' },
                ))
        .addStringOption(option => 
            option.setName('mask_color')
                .setDescription('Which color are you picking for the mask (default is "black")')
                .addChoices(
                    { name: 'White (#FFFFFF)', value: 'white' },
                    { name: 'Black (#000000)', value: 'black' },
                    { name: 'Pure Red (#FF0000)', value: 'red' },
                    { name: 'Pure Green (#00FF00)', value: 'green' },
                    { name: 'Pure Blue (#0000FF)', value: 'blue' },
                    { name: 'Raw - No detection', value: 'raw'}
                ))
        .addIntegerOption(option => 
            option.setName('width')
                .setDescription('The width of the generated image (default is image upload size, recommended max is 768)'))
        .addIntegerOption(option =>
            option.setName('height')
                .setDescription('The height of the generated image (default is image upload size, recommended max is 768)'))
        .addStringOption(option => 
            option.setName('sampler')
                .setDescription('The sampling method for the AI to generate art from (default is "Euler a")')
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
        .addStringOption(option =>
            option.setName('inpaint_area')
                .setDescription('The area to inpaint (default is "Whole picture", only change if you know what you\'re doing)')
                .addChoices(
                    { name: 'Whole picture', value: 'Whole picture' },
                    { name: 'Whole picture - Masked control', value: 'Whole picture_M' },
                    { name: 'Only masked', value: 'Only masked' },
                ))
        .addStringOption(option =>
            option.setName('segment_anything_prompt')
                .setDescription('Prompt for segment anything'))
        .addAttachmentOption(option =>
            option.setName('controlnet_input_2')
                .setDescription('The input image of the controlnet'))
        .addAttachmentOption(option =>
            option.setName('controlnet_input_3')
                .setDescription('The input image of the controlnet'))
        .addStringOption(option =>
            option.setName('controlnet_preprocessor_override')
                .setDescription('Override the preprocessor for inpaint model (default is "Fill")')
                .addChoices(
                    { name: 'None - No preprocessor', value: 'None' }, 
                    { name: 'Fill', value: 'fill' },
                    { name: 'Inpaint', value: 'inpaint_only' },
                    { name: 'Inpaint NoobAI', value: 'inpaint_noobai' },
                ))
        .addStringOption(option =>
            option.setName('controlnet_config')
                .setDescription('Config string for the controlnet (use wd_controlnet to generate)'))
        .addIntegerOption(option =>
            option.setName('mask_increase_padding')
                .setDescription('How many px the mask will expand, 0 = no expand (0-64, default 24)"'))
        .addStringOption(option => 
            option.setName('checkpoint')
                .setDescription('Force a cached checkpoint to be used (not all option is cached)')
                .addChoices(...(model_selection.concat(model_selection_xl).filter(x => !model_selection_legacy.map(y => y.value).includes(x.value)))))
        .addStringOption(option =>
            option.setName('profile')
                .setDescription('Specify the profile to use (default is No Profile)'))
    ,

    async execute_comfy_flux_inpaint(interaction, client, data) {
        const workflow = JSON.parse(JSON.stringify(workflow_inpaint))

        workflow["3"]["inputs"]["steps"] = data.sampling_step
        workflow["23"]["inputs"]["text"] = data.prompt

        workflow["3"]["inputs"]["sampler_name"] = data.sampler
        workflow["3"]["inputs"]["scheduler"] = data.scheduler
        workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 2_000_000_000)
        workflow["3"]["inputs"]["denoise"] = data.denoising_strength
        workflow["50"]["inputs"]["rel_l1_thresh"] = data.teacache_strength
        workflow["38"]["inputs"]["noise_mask"] = data.inpaint_area === 'Whole picture' ? false : true

        return runComfyImageJob(interaction, workflow, {
            initialContent: 'Submitting ComfyUI Flux inpaint workflow…',
            successContent: 'Comfy backend returned file',
            async prepare(context) {
                // Uploads happen after the Cancel button is attached, so a
                // cancellation while either upload is pending is still safe.
                const image_info = await context.uploadImage(
                    data.attachment,
                    Date.now() + "_" + data.attachment_option.name,
                    data.attachment_option.contentType,
                ).catch((err) => {
                    console.log("Failed to upload image", err)
                    return null
                })
                if (image_info == null) throw new Error('Failed to receive input image')

                const mask_info = await context.uploadImage(
                    data.mask,
                    Date.now() + "_" + data.mask_option.name,
                    data.mask_option.contentType,
                ).catch((err) => {
                    console.log("Failed to upload mask", err)
                    return null
                })
                if (mask_info == null) throw new Error('Failed to receive input mask')

                workflow["17"]["inputs"]["image"] = image_info.name
                workflow["48"]["inputs"]["image"] = mask_info.name

                // Unload Forge model before using ComfyUI
                const { unloadForgeCheckpoint } = require('../utils/forge_api_execute');
                await unloadForgeCheckpoint();
                return workflow
            },
            progress: progress => {
                if (progress?.node == null) return null
                const title = workflow[progress.node]?._meta?.title || workflow[progress.node]?.class_type
                return "Processing: " + (title || 'ComfyUI') +
                    (progress.max ? ` (${progress.value}/${progress.max})` : '')
            },
            errorContent: error => error?.error || error?.message || String(error),
        })
    },

	async execute(interaction, client) {
        if (client.cooldowns.has(interaction.user.id) && !byPassUser.includes(interaction.user.id)) {
            // cooldown not ended
            interaction.reply({ content: "Please wait for cooldown to end", ephemeral: true });
            return 
        }

        //make a temporary reply to not get timeout'd
		await interaction.deferReply();

        await sync_active_model()

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
        const denoising_strength = clamp(interaction.options.getNumber('denoising_strength') || 1, 0, 1)
        const mask_blur = clamp(interaction.options.getInteger('mask_blur') || 4, 0, 64)
        const mask_content = interaction.options.getString('mask_content') || 'latent nothing'
        const mask_color = interaction.options.getString('mask_color') || 'black'
        const user_sampler = interaction.options.getString('sampler')
        const user_scheduler = interaction.options.getString('scheduler')
        const user_cfg = interaction.options.getNumber('cfg_scale')
        const user_step = interaction.options.getInteger('sampling_step')
        let sampler = user_sampler || profile?.sampler || 'Euler a'
        let scheduler = user_scheduler || profile?.scheduler || 'Automatic'
        let cfg_scale = clamp(user_cfg ?? profile?.cfg_scale ?? 7, 0, 30)
        let sampling_step = clamp(user_step ?? profile?.sampling_step ?? 20, 1, 100)
        const default_neg_prompt = interaction.options.getString('default_neg_prompt') || 'n_sfw'
        
        // Force cfg_scale to 1 if no negative prompt is specified at all
        if (default_neg_prompt === 'n_nsfw' && neg_prompt.trim() === '') {
            cfg_scale = 1;
        }
        
        let inpaint_area = interaction.options.getString('inpaint_area') || 'Whole picture'
        let should_mask_control = false
        if (inpaint_area === 'Whole picture_M') {
            inpaint_area = 'Whole picture'
            should_mask_control = true
        }
        const force_server_selection = 0
        const mask_increase_padding = clamp(interaction.options.getInteger('mask_increase_padding') || 24, 0, 64)
        let segment_anything_prompt = interaction.options.getString('segment_anything_prompt') || null
        const controlnet_input_option_2 = interaction.options.getAttachment('controlnet_input_2') || null
        const controlnet_input_option_3 = interaction.options.getAttachment('controlnet_input_3') || null
        const controlnet_config = interaction.options.getString('controlnet_config') || 
            profile?.controlnet_config ||
            (client.controlnet_config.has(interaction.user.id) ? client.controlnet_config.get(interaction.user.id) : null)
        let checkpoint = interaction.options.getString('checkpoint') || profile?.checkpoint || null
        const booru_gen_config = client.boorugen_config.has(interaction.user.id) ? client.boorugen_config.get(interaction.user.id) : null
        const latentmod_config = client.latentmod_config.has(interaction.user.id) ? client.latentmod_config.get(interaction.user.id) : null
        const colorbalance_config = profile?.colorbalance_config ||
            (client.colorbalance_config.has(interaction.user.id) ? client.colorbalance_config.get(interaction.user.id) : null)

        const should_override_1st_controlnet = (interaction.options.getString('controlnet_config') || profile?.controlnet_config)? true : false
        const controlnet_preprocessor_override = interaction.options.getString('controlnet_preprocessor_override') || null
        const self = this;
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
        let attachment_mask_option = interaction.options.getAttachment('mask')

        if (!height) {
            height = attachment_option.height
            console.log('height not set, using attachment height:', height)
            if (!height) {
                height = 512
                console.log('height not set, using default height:', height)
            }
        }
        if (!width) {
            width = attachment_option.width
            console.log('width not set, using attachment width:', width)
            if (!width) {
                width = 512
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

        // finally make sure the width and height is divisible by 8
        if (height % 8 !== 0 || width % 8 !== 0) {
            height = Math.ceil(height / 8) * 8
            width = Math.ceil(width / 8) * 8
            console.log('width and height not divisible by 8, round up to:', width, height)
        }


        const session_hash = crypt.randomBytes(16).toString('base64');
        const WORKER_ENDPOINT = server_pool[0].url
        let mask_data = null
        let mask_data_uri = ""
        let mask_upload_path = ""

        let is_swinb = false
        let dino_threshold = null

        if (segment_anything_prompt) {
            // check for embedded groundingDINO config in segment_anything_prompt (if prompt include "(swinb)" and (t=<value>))
            is_swinb = segment_anything_prompt.includes('(swinb)')
            dino_threshold = segment_anything_prompt.match(/\(t=[0-9.]+\)/)
            
            if (is_swinb) {
                segment_anything_prompt = segment_anything_prompt.replace('(swinb)', '')
            }
            if (dino_threshold) {
                dino_threshold = parseFloat(dino_threshold[0].replace('(t=', '').replace(')', ''))
                segment_anything_prompt = segment_anything_prompt.replace(/\(t=[0-9.]+\)/, '')
            }

            segment_anything_prompt = segment_anything_prompt.trim()
            console.log('is_swinb:', is_swinb, 'threshold:', dino_threshold)
        }


        //download the image from attachment.proxyURL
        let attachment = await loadImage(attachment_option.proxyURL,
            /*getBuffer:*/ false, /*noDataURIHeader*/ false, /*safeMode*/ true).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to retrieve image", ephemeral: true }).catch(() => {});
            return
        })

        if (segment_anything_prompt && !attachment) return

        let attachment_upload_path = await uploadDiscordImageToGradio(attachment_option.proxyURL, session_hash, WORKER_ENDPOINT).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to upload image to server", ephemeral: true }).catch(() => {});
            return
        })
        //console.log(attachment_upload_path)

        if (segment_anything_prompt) {
            if (!attachment_upload_path) return

            await interaction.editReply({ content: "Starting auto segmentation process" })
                .catch(err => console.log('Failed to update auto segmentation status', err))

            let boundingBox = null
            try {
                boundingBox = await groundingDino_execute(segment_anything_prompt, attachment_upload_path, session_hash, is_swinb, dino_threshold)
            }
            catch (err) {
                console.log(err)
                await interaction.editReply({ content: "Failed to get bounding box", ephemeral: true }).catch(() => {})
                return
            }

            const bb_count = Number(boundingBox?.bb_num)
            if (!Number.isInteger(bb_count) || bb_count < 1) {
                console.log('GroundingDINO returned no usable bounding boxes', boundingBox)
                await interaction.editReply({ content: "No bounding box found, try a different segment_anything_prompt", ephemeral: true }).catch(() => {})
                return
            }

            const shown_bb_count = Math.min(bb_count, 20)
            const rows = new Array(Math.ceil(shown_bb_count / 5))

            for (let i = 0; i < rows.length; i++) {
                rows[i] = new MessageActionRow()
            }

            for (let i = 0; i < shown_bb_count; i++) {
                rows[Math.floor(i / 5)].addComponents(
                    new MessageButton()
                        .setCustomId(`bbSelect_${i}_${interaction.id}`)
                        .setLabel(`${i}`)
                        .setStyle('SECONDARY'))
            }

            // for the last action row, add a button to submit the selected bounding box
            rows.push(new MessageActionRow().addComponents(
                new MessageButton()
                    .setCustomId(`bbSubmit_${interaction.id}`)
                    .setLabel(`Submit`)
                    .setStyle('SUCCESS')))

            let bb_img = null
            try {
                bb_img = await fetch_gradio_file(WORKER_ENDPOINT, boundingBox.bb, 'bounding box preview')
            }
            catch (err) {
                console.log(err)
                await interaction.editReply({ content: "Failed to fetch bounding box image", ephemeral: true }).catch(() => {})
                return
            }

            let bb_select_msg = null
            try {
                const bb_img_name = `preview_annotation.png`
                await interaction.channel.send({ files: [{ attachment: bb_img, name: bb_img_name }] })
                bb_select_msg = await interaction.channel.send({ content: "Please select your desired bounding box before submit", components: rows })
            }
            catch (err) {
                console.log(err)
                await interaction.editReply({ content: "Failed to show bounding box selection", ephemeral: true }).catch(() => {})
                return
            }

            const bb_filter = i => i.user.id === interaction.user.id
            const bb_collector = bb_select_msg.createMessageComponentCollector({ filter: bb_filter, time: 800000 })
            const bb_indices = []

            bb_collector.on('collect', async i => {
                try {
                    if (i.customId.startsWith('bbSelect') && i.customId.endsWith(interaction.id)) {
                        const bb_index = i.customId.split('_')[1]
                        const bb_index_num = Number(bb_index)
                        await i.deferUpdate()
                        if (bb_collector.ended) return
                        if (!Number.isInteger(bb_index_num) || bb_index_num < 0 || bb_index_num >= shown_bb_count) {
                            await interaction.editReply({ content: "Invalid bounding box selected", ephemeral: true }).catch(() => {})
                            return
                        }
                        // add to bb_indices, change the button to primary and text to deselect, edit bb_select_msg with the altered button
                        if (bb_indices.includes(bb_index)) {
                            bb_indices.splice(bb_indices.indexOf(bb_index), 1)
                            rows[Math.floor(bb_index_num / 5)].components[bb_index_num % 5].setStyle('SECONDARY')
                        }
                        else {
                            bb_indices.push(bb_index)
                            rows[Math.floor(bb_index_num / 5)].components[bb_index_num % 5].setStyle('PRIMARY')
                        }
                        await bb_select_msg.edit({ content: "Please select your desired bounding box, press the same button again to deselect", components: rows })
                            .catch(err => console.log('Failed to update bounding box selection', err))
                        return
                    }

                    if (!(i.customId.startsWith('bbSubmit_') && i.customId.endsWith(interaction.id))) {
                        return
                    }

                    await i.deferUpdate()
                    if (bb_collector.ended) return
                    if (bb_indices.length === 0) {
                        await interaction.editReply({ content: "No bounding box selected, please select at least one before submit", ephemeral: true }).catch(() => {})
                        return
                    }

                    bb_collector.stop()

                    let segment_output = null
                    try {
                        segment_output = await segmentAnything_execute(segment_anything_prompt, bb_indices, attachment_upload_path, session_hash, is_swinb, dino_threshold)
                    }
                    catch (err) {
                        console.log(err)
                        await interaction.editReply({ content: "Failed to segment image", ephemeral: true }).catch(() => {})
                        return
                    }

                    const is_multiple_box = bb_indices.length > 1
                    const segment_start = is_multiple_box ? 6 : 0
                    const segment_end = is_multiple_box ? 9 : 3
                    const segment_candidates = Array.isArray(segment_output)
                        ? segment_output.slice(segment_start, segment_end)
                        : []

                    if (segment_candidates.length !== 3 || segment_candidates.some(candidate => !candidate)) {
                        console.log('SegmentAnything returned no usable results', segment_output)
                        await interaction.editReply({ content: "Failed to segment image", ephemeral: true }).catch(() => {})
                        return
                    }

                    if (is_multiple_box) {
                        await interaction.channel.send("⚠️ Due to issues with showing transparent layers when there are multiple bounding box selected, we will instead show the cut out image of the segmentation result")
                            .catch(err => console.log('Failed to send multi-box notice', err))
                    }

                    const img_buffers = []
                    try {
                        for (const segment of segment_candidates) {
                            img_buffers.push(await fetch_gradio_file(
                                WORKER_ENDPOINT,
                                segment?.image ?? segment,
                                'segmentation preview',
                            ))
                        }
                    }
                    catch (err) {
                        console.log(err)
                        await interaction.editReply({ content: "Failed to fetch segmentation preview", ephemeral: true }).catch(() => {})
                        return
                    }

                    const seg_row = new MessageActionRow()
                    for (let i = 0; i < img_buffers.length; i++) {
                        seg_row.addComponents(
                            new MessageButton()
                                .setCustomId(`segSelect_${i}_${interaction.id}`)
                                .setLabel(`Select ${i}`)
                                .setStyle('PRIMARY'))
                    }

                    let seg_select_msg
                    try {
                        seg_select_msg = await interaction.channel.send({
                            files: img_buffers.map((x, i) => { return { attachment: x, name: `segment_output_${i}.png` } }),
                            components: [seg_row],
                        })
                    }
                    catch (err) {
                        console.log(err)
                        await interaction.editReply({ content: "Failed to send segmentation preview", ephemeral: true }).catch(() => {})
                        return
                    }

                    const seg_filter = i => i.user.id === interaction.user.id
                    const seg_collector = seg_select_msg.createMessageComponentCollector({ filter: seg_filter, time: 800000 })

                    seg_collector.on('collect', async i => {
                        try {
                            if (!(i.customId.startsWith('segSelect') && i.customId.endsWith(interaction.id))) {
                                return
                            }

                            const seg_index = i.customId.split('_')[1]
                            const seg_index_num = Number(seg_index)
                            await i.deferUpdate()
                            if (seg_collector.ended) return
                            if (!Number.isInteger(seg_index_num) || seg_index_num < 0 || seg_index_num >= img_buffers.length) {
                                await interaction.editReply({ content: "Invalid mask selected", ephemeral: true }).catch(() => {})
                                return
                            }

                            seg_collector.stop()

                            let expanded_mask = null
                            try {
                                expanded_mask = await expandMask(segment_output, attachment_upload_path, seg_index, session_hash, mask_increase_padding)
                            }
                            catch (err) {
                                console.log(err)
                                await interaction.editReply({ content: "Failed to expand mask", ephemeral: true }).catch(() => {})
                                return
                            }

                            const final_mask_entry = Array.isArray(expanded_mask) ? expanded_mask[1] : null
                            const final_mask_file = final_mask_entry?.image ?? final_mask_entry
                            const final_mask_dir = get_gradio_file_path(final_mask_file)
                            if (!final_mask_dir) {
                                console.log('Mask expansion returned no final mask', expanded_mask)
                                await interaction.editReply({ content: "Failed to expand mask", ephemeral: true }).catch(() => {})
                                return
                            }

                            let final_mask_buffer = null
                            try {
                                final_mask_buffer = await fetch_gradio_file(WORKER_ENDPOINT, final_mask_file, 'final mask')
                            }
                            catch (err) {
                                console.log(err)
                                await interaction.editReply({ content: "Failed to fetch final mask", ephemeral: true }).catch(() => {})
                                return
                            }

                            mask_upload_path = final_mask_dir
                            mask_data = final_mask_buffer
                            mask_data_uri = "data:image/png;base64," + final_mask_buffer.toString('base64')

                            await interaction.channel.send({ files: [{ attachment: final_mask_buffer, name: `final_mask.png` }] })
                                .catch(err => console.log('Failed to send final mask preview', err))

                            try {
                                await unloadAllModel(session_hash)
                            }
                            catch (err) {
                                console.log('Failed to unload segmentation model', err)
                            }

                            execute_inpaint().catch(err => {
                                console.log(err)
                                interaction.editReply({ content: 'Error while creating image: ' + err, components: [] }).catch(() => {})
                            })
                        }
                        catch (err) {
                            console.log('Automatic mask selection failed', err)
                            await interaction.editReply({ content: "Failed to process selected mask", ephemeral: true }).catch(() => {})
                        }
                    })
                }
                catch (err) {
                    console.log('Automatic segmentation selection failed', err)
                    await interaction.editReply({ content: "Failed to process segmentation selection", ephemeral: true }).catch(() => {})
                }
            })
        }
        else if (attachment_mask_option) {
            let attachment_mask = await loadImage(attachment_mask_option.proxyURL, true).catch((err) => {
                console.log(err)
                interaction.editReply({ content: "Failed to retrieve mask image", ephemeral: true });
                return
            })

            if (mask_color === 'black') {
                // load attachment_mask to sharp, negate, blur (guassian 4 pixels radius), and turn all non-white pixel to black and ((export to png data URI)) (use pipline to avoid memory leak)
                await sharp(attachment_mask)
                    .negate({alpha: false})
                    .blur(3)
                    .threshold(255)
                    .toFormat('png')
                    .toBuffer()
                    .then(async data => {
                        mask_data_uri = "data:image/png;base64," + data.toString('base64')
                        mask_data = data
                        mask_upload_path = await uploadPngBufferToGradio(data, session_hash, WORKER_ENDPOINT).catch((err) => {
                            console.log(err)
                            interaction.editReply({ content: "Failed to upload mask image to server", ephemeral: true });
                            return
                        })
                    })
                    .catch(err => {
                        console.log(err)
                        interaction.editReply({ content: "Failed to process mask image", ephemeral: true });
                        return
                    })
            }
            else if (mask_color === 'red' || mask_color === 'green' || mask_color === 'blue') {
                // load attachment_mask to sharp, only take the pure red/green/blue channel respective to the mask_color, 
                //blur (guassian 4 pixels radius), and turn all non-white pixel to black and ((export to png data URI)) (use pipline to avoid memory leak)
                let mono_img = null
                await sharp(attachment_mask)
                    .toColourspace('b-w')
                    .toBuffer()
                    .then(data => {
                        mono_img = data
                    })
                    .catch(err => {
                        console.log(err)
                        interaction.editReply({ content: "Failed to process mask image", ephemeral: true });
                        return
                    })

                await sharp(mono_img)
                    .blur(3)
                    .threshold(255)
                    .toFormat('png')
                    .toBuffer()
                    .then(async data => {
                        mask_data_uri = "data:image/png;base64," + data.toString('base64')
                        mask_data = data
                        mask_upload_path = await uploadPngBufferToGradio(data, session_hash, WORKER_ENDPOINT).catch((err) => {
                            console.log(err)
                            interaction.editReply({ content: "Failed to upload mask image to server", ephemeral: true });
                            return
                        })
                    })
                    .catch(err => {
                        console.log('error in mask conversion:', err)
                        interaction.editReply({ content: "Failed to process mask image", ephemeral: true });
                        return
                    })
            }
            else if (mask_color === 'raw') {
                await sharp(attachment_mask)
                    .toFormat('png')
                    .toBuffer()
                    .then(async data => {
                        mask_data_uri = "data:image/png;base64," + data.toString('base64')
                        mask_data = data
                        mask_upload_path = await uploadPngBufferToGradio(data, session_hash, WORKER_ENDPOINT).catch((err) => {
                            console.log(err)
                            interaction.editReply({ content: "Failed to upload mask image to server", ephemeral: true });
                            return
                        })
                    })
                    .catch(err => {
                        console.log(err)
                        interaction.editReply({ content: "Failed to process mask image", ephemeral: true });
                        return
                    })
            }

            else {
                // load attachment_mask to sharp, blur (guassian 4 pixels radius), turn all non-white pixel to black and ((export to png data URI)) (use pipline to avoid memory leak)
                await sharp(attachment_mask)
                    .blur(3)
                    .threshold(255)
                    .toFormat('png')
                    .toBuffer()
                    .then(data => {
                        mask_data = data
                        mask_data_uri = "data:image/png;base64," + data.toString('base64')
                    })
                    .catch(err => {
                        console.log(err)
                        interaction.editReply({ content: "Failed to process mask image", ephemeral: true });
                        return
                    })
            }

            execute_inpaint().catch(err => {
                console.log(err)
                interaction.editReply({ content: 'Error while creating image: ' + err, components: [] }).catch(() => {})
            })
        }
        else {
            interaction.editReply({ content: "No mask image provided", ephemeral: true });
            return
        }

        async function execute_inpaint() {
            interaction.editReply({ content: "Starting inpaint process, please wait..." });

            const is_flux_prompt = prompt.startsWith('[FLUX]');
            await sync_active_model();
            let frozen_model = checkpoint || cached_model[0];
            const frozen_was_active = normalize_model_name(cached_model[0]) === normalize_model_name(frozen_model);
            let mapped_inpaint = null;
            if (!is_flux_prompt && checkpoint) {
                mapped_inpaint = model_selection_inpaint.find(x => x.value === checkpoint) || null;
                if (mapped_inpaint) frozen_model = mapped_inpaint.inpaint;
            }

            // Prompt enrichment is an LLM call; keep it outside the Forge lease.
            try {
                const { enrichImagePrompts } = require('../utils/image_prompt');
                const enrichment = await enrichImagePrompts({
                    prompt,
                    model: frozen_model,
                    count: 1,
                    settings: usersetting,
                    workflow: 'inpaint',
                    images: [dataUriToBuffer(attachment)].filter(Boolean),
                    onProgress: message => interaction.editReply({ content: message }).catch(() => {}),
                });
                prompt = enrichment.prompts[0];
            }
            catch (err) {
                await interaction.editReply({ content: 'Image prompt enrichment failed: ' + err.message }).catch(() => {});
                return;
            }

            // if prompt start with [FLUX], use flux inpaint workflow
            if (prompt.startsWith('[FLUX]')) {
                prompt = prompt.replace('[FLUX]', '').trim()
                // remove the teacache config from the prompt
                const teacache_check = get_teacache_config_from_prompt(prompt, false)

                const attachment_buffer = await loadImage(attachment_option.proxyURL,
                    /*getBuffer:*/ true).catch((err) => {
                    console.log("Failed to retrieve image from discord", err)
                    return
                })

                interaction.channel.send('Flux Inpaint Mode is selected, switching to comfy backend, not all features are supported')
                await self.execute_comfy_flux_inpaint(interaction, client, {
                    prompt: prompt,
                    neg_prompt: neg_prompt,
                    sampling_step: sampling_step,
                    cfg_scale: cfg_scale,
                    seed: seed,
                    sampler: sampler_to_comfy_name_mapping[sampler] ?? "euler",
                    scheduler: scheduler_to_comfy_name_mapping[scheduler] ?? "normal",
                    teacache_strength: teacache_check.teacache_config ? teacache_check.teacache_config.threshold : 0,
                    session_hash: session_hash,
                    attachment: attachment_buffer,
                    attachment_option: attachment_option,
                    mask: mask_data,
                    mask_option: attachment_mask_option ?? {
                        name: 'generated_mask.png',
                        contentType: 'image/png',
                    },
                    inpaint_area: inpaint_area,
                    denoising_strength: denoising_strength,
                })

                return
            }

            let controlnet_input_2 = controlnet_input_option_2 ? await loadImage(controlnet_input_option_2.proxyURL,
                /*getBuffer:*/ false, /*noDataURIHeader*/ false, /*safeMode*/ true).catch((err) => {
                console.log(err)
                interaction.reply({ content: "Failed to retrieve control net image 2", ephemeral: true });
                return null
            }) : null

            let controlnet_input_3 = controlnet_input_option_3 ? await loadImage(controlnet_input_option_3.proxyURL,
                /*getBuffer:*/ false, /*noDataURIHeader*/ false, /*safeMode*/ true).catch((err) => {
                console.log(err)
                interaction.reply({ content: "Failed to retrieve control net image 3", ephemeral: true });
                return null
            }) : null

            try {
                return await withForgeSession(async () => {
                    await sync_active_model()

                    let target_checkpoint = checkpoint
                    let force = false
                    if (checkpoint) {
                        target_checkpoint = mapped_inpaint ? mapped_inpaint.inpaint : checkpoint
                        force = !!mapped_inpaint
                    }

                    if (target_checkpoint) {
                        if (mapped_inpaint) {
                            await interaction.channel.send(`Try to switch to inpaint model: **${check_model_filename(mapped_inpaint.inpaint)}**`)
                        }
                        else if (checkpoint) {
                            await interaction.channel.send('Inpaint model not found, keep using normal model')
                        }
                        let change_result = await model_change(target_checkpoint, force).catch(err => {
                            console.log(err)
                            return false
                        })
                        if (!change_result && frozen_was_active && !force) {
                            change_result = await model_change(target_checkpoint, true).catch(err => {
                                console.log(err)
                                return false
                            })
                        }

                        if (!change_result) {
                            await interaction.channel.send(`Model is not cached or model change failed, fallback to **${check_model_filename(cached_model[0])}**
    currently cached models: ${cached_model.map(x => check_model_filename(x)).join(', ')}`)
                        }
                        else {
                            await interaction.channel.send(`Active model changed to **${check_model_filename(target_checkpoint)}**
    currently cached models: ${cached_model.map(x => check_model_filename(x)).join(', ')}`)
                        }
                    }
                    else if (normalize_model_name(cached_model[0]) !== normalize_model_name(frozen_model)) {
                        const restored = await model_change(frozen_model, true).catch(err => {
                            console.log(err)
                            return false
                        })
                        if (!restored) {
                            throw new Error(`The model **${frozen_model}** that was active before prompt enhancement could not be restored.`)
                        }
                        await interaction.channel.send(`Active model changed to **${check_model_filename(frozen_model)}**
    currently cached models: ${cached_model.map(x => check_model_filename(x)).join(', ')}`)
                    }

                    let server_index = get_worker_server(force_server_selection)

                    if (server_index === -1) {
                        await interaction.editReply({ content: "No server is available, please try again later" });
                        return
                    }

                    const is_xl = model_selection_xl.find(x => x.value === cached_model[0]) != null || model_selection_inpaint.find(x => x.inpaint === cached_model[0]) != null
                    const is_flux = model_selection_flux.find(x => x.value === cached_model[0]) != null
                    const is_vpred = cached_model[0].includes('vpred')

                    // Apply family defaults when user and profile did not explicitly set the values
                    const family_def_inp = get_model_family_defaults(cached_model[0], 'i2i')
                    if (family_def_inp) {
                        if (!user_sampler && !profile?.sampler && family_def_inp.sampler)
                            sampler = family_def_inp.sampler
                        if (!user_scheduler && !profile?.scheduler && family_def_inp.scheduler)
                            scheduler = family_def_inp.scheduler
                        if (user_step === null && !profile?.sampling_step && family_def_inp.step !== null)
                            sampling_step = family_def_inp.step
                        if (cfg_scale !== 1 && user_cfg === null && !profile?.cfg_scale) {
                            const f_cfg = family_def_inp.cfg !== 1 ? (family_def_inp.cfg ?? 1) : family_def_inp.dcfg
                            if (f_cfg !== null) cfg_scale = f_cfg
                        }
                    }

                    if (is_vpred) {
                        await interaction.channel.send(`:information_source: This model is using v-prediction method, which may not be compatible with every setting of the command`);
                    }

                    // override controlnet_config[0] with config exclusively for inpainting
                    let controlnet_config_obj = {
                        control_net: [
                            {
                                model: is_xl ? "controlnet_inpaint" : "None",
                                preprocessor: controlnet_preprocessor_override ?? 'fill',
                                type: (controlnet_preprocessor_override ?? 'fill').includes('inpaint') ? "Inpaint" : "All",
                                weight: 1,
                                mode: "My prompt is more important",
                                resolution: is_xl ? 768 : 512,
                                t_a: 32,
                                t_b: 200
                            },
                            {
                                model: "None",
                                preprocessor: "None",
                                type: "All",
                                weight: 1,
                                mode: "Balanced",
                                resolution: 512,
                                t_a: 100,
                                t_b: 200
                            },
                            {
                                model: "None",
                                preprocessor: "None",
                                type: "All",
                                weight: 1,
                                mode: "Balanced",
                                resolution: 512,
                                t_a: 100,
                                t_b: 200
                            }
                        ],
                        do_preview_annotation: false
                    }

                    // try to parse controlnet_config and replace [1] and [2] with the parsed config if exists
                    let imported_controlnet = null
                    if (controlnet_config && !is_flux) {
                        try {
                            imported_controlnet = JSON.parse(controlnet_config)
                        }
                        catch (err) {
                            console.log(err)
                            interaction.channel.send({ content: "Failed to parse controlnet config:" + err });
                        }
                    }

                    if (is_anima_model(cached_model[0])) {
                        try {
                            const first_unit_override = imported_controlnet?.control_net?.[0]?.model === "controlnet_inpaint"
                                ? imported_controlnet.control_net[0] : null
                            controlnet_config_obj.control_net[0] = get_anima_inpaint_unit({
                                model: cached_model[0],
                                preprocessor_override: controlnet_preprocessor_override,
                                overrides: first_unit_override,
                            })
                            if (imported_controlnet) {
                                controlnet_config_obj.control_net[1] = imported_controlnet.control_net[1] || controlnet_config_obj.control_net[1]
                                controlnet_config_obj.control_net[2] = imported_controlnet.control_net[2] || controlnet_config_obj.control_net[2]
                            }
                            interaction.channel.send('Using Anima inpaint ControlNet unit (inpaint_noobai, 1024)')
                        }
                        catch (err) {
                            await interaction.editReply({ content: err.message })
                            return
                        }
                    }
                    else if (imported_controlnet) {
                        if (imported_controlnet.control_net[0] && imported_controlnet.control_net[0].model === "controlnet_inpaint") {
                            controlnet_config_obj.control_net[0].preprocessor = imported_controlnet.control_net[0].preprocessor || controlnet_config_obj.control_net[0].preprocessor
                            controlnet_config_obj.control_net[0].weight = imported_controlnet.control_net[0].weight || controlnet_config_obj.control_net[0].weight
                            controlnet_config_obj.control_net[0].type = imported_controlnet.control_net[0].type || controlnet_config_obj.control_net[0].type
                            controlnet_config_obj.control_net[0].mode = imported_controlnet.control_net[0].mode || controlnet_config_obj.control_net[0].mode
                            controlnet_config_obj.control_net[0].resolution = imported_controlnet.control_net[0].resolution || controlnet_config_obj.control_net[0].resolution
                            controlnet_config_obj.control_net[0].t_a = imported_controlnet.control_net[0].t_a || controlnet_config_obj.control_net[0].t_a
                            controlnet_config_obj.control_net[0].t_b = imported_controlnet.control_net[0].t_b || controlnet_config_obj.control_net[0].t_b

                            interaction.channel.send('dedicated controlnet config (from command/profile) or inpaint-specific config detected, overriding first controlnet config')
                        }
                        controlnet_config_obj.control_net[1] = imported_controlnet.control_net[1] || controlnet_config_obj.control_net[1]
                        controlnet_config_obj.control_net[2] = imported_controlnet.control_net[2] || controlnet_config_obj.control_net[2]
                    }

                    const WORKER_ENDPOINT = server_pool[server_index].url
                    const mode_headers = serviceHeaders('sdwebui')

                    return await withForgeImageModeCompat({
                        model: cached_model[0],
                        workflow: 'inpaint',
                        session_hash: session_hash,
                        endpoint: WORKER_ENDPOINT,
                        headers: mode_headers,
                    }, async () => {
                        await load_controlnet(session_hash, server_index, attachment, controlnet_input_2, controlnet_input_3, JSON.stringify(controlnet_config_obj), interaction, 1, mask_data_uri, should_mask_control || is_anima_model(cached_model[0]), {
                            width: width,
                            height: height,
                        })
                            .catch(err => {
                                console.log(err)
                                interaction.editReply({ content: "Failed to load control net:" + err });
                            });

                        const default_neg_prompt_comp = default_neg_prompt.split('_')
                        const override_neg_prompt = default_neg_prompt_comp[0] === 'n'
                        const remove_nsfw_restriction = default_neg_prompt_comp[1] === 'nsfw'

                        neg_prompt = get_negative_prompt(neg_prompt, override_neg_prompt, remove_nsfw_restriction, cached_model[0])
                        prompt = get_prompt(prompt, remove_nsfw_restriction, cached_model[0])

                        const extra_config = full_prompt_analyze(prompt, is_xl)
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

                        let mask_padding = 32
                        if (mask_increase_padding && !segment_anything_prompt && inpaint_area === 'Only masked') {
                            interaction.channel.send("Expand mask padding setting will be applied to uploaded mask")
                            mask_padding = mask_increase_padding
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
                            try {
                                latentmod_config_obj = JSON.parse(latentmod_config)
                                interaction.channel.send('Applying Latent Modifier config')
                            }
                            catch (err) {
                                interaction.channel.send("Failed to parse Latent Modifier config")
                                return
                            }
                        }

                        // Set default latentmod config for vpred models if not already set
                        if (cached_model[0].toLowerCase().includes('vpred') && !latentmod_config_obj) {
                            latentmod_config_obj = {
                                mode: 'simple',
                                rescale_cfg_phi: 0.5,
                            }
                        }

                        const create_data = get_data_body_img2img(server_index, prompt, neg_prompt, sampling_step, cfg_scale,
                            seed, sampler, scheduler, session_hash, height, width, attachment, mask_data_uri, denoising_strength, 4, mask_blur, mask_content, "None", false,
                            extra_config.coupler_config, extra_config.color_grading_config, 1, is_censor, extra_config.freeu_config, extra_config.dynamic_threshold_config, extra_config.pag_config,
                            inpaint_area, mask_padding, extra_config.use_foocus, extra_config.use_booru_gen, booru_gen_config_obj, cached_model[0], attachment_upload_path, mask_upload_path,
                            colorbalance_config_obj, usersetting, null, null, "None", extra_config.detail_daemon_config, extra_config.tipo_input, latentmod_config_obj,
                            extra_config.mahiro_config, extra_config.teacache_config, extra_config.modulation_config)

                        const workload = forgeWorkload({
                            taskKind: 'inpaint', checkpoint: cached_model[0], width, height,
                            tiledVae: width * height > 3000000,
                            features: { inpaint_area },
                        })

                        return await runForgeImageJob({
                            interaction,
                            client,
                            serverIndex: server_index,
                            sessionHash: session_hash,
                            endpoint: WORKER_ENDPOINT,
                            fnIndex: server_pool[server_index].fn_index_img2img,
                            abortFnIndex: server_pool[server_index].fn_index_abort,
                            data: create_data,
                            workload,
                            customIdPrefix: 'cancel_inpaint_',
                            title: 'Output',
                            daamHeatmapCount: 0,
                        })
                    })
                })
            }
            catch (err) {
                console.log(err)
                try {
                    await interaction.editReply({ content: 'Error while creating image: ' + err, components: [] })
                }
                catch (reply_err) {
                    console.log('cannot send error to discord', reply_err)
                }
            }
        }


        client.cooldowns.set(interaction.user.id, true);

        setTimeout(() => {
            client.cooldowns.delete(interaction.user.id);
        }, client.COOLDOWN_SECONDS * 1000);
	},
};
