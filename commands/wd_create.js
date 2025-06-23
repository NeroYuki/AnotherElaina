const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser, censorGuildIds, optOutGuildIds } = require('../config.json');
const crypt = require('crypto');
const { server_pool, get_data_body, get_negative_prompt, initiate_server_heartbeat, get_worker_server, get_prompt, model_name_hash_mapping, check_model_filename, model_selection, upscaler_selection, model_selection_xl, model_selection_curated, model_selection_inpaint, model_selection_flux, sampler_to_comfy_name_mapping, scheduler_to_comfy_name_mapping } = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { model_change, cached_model } = require('../utils/model_change.js');
const { queryRecordLimit } = require('../database/database_interaction.js');
const { full_prompt_analyze, preview_coupler_setting, fetch_user_defined_wildcard, get_teacache_config_from_prompt } = require('../utils/prompt_analyzer.js');
const { load_profile } = require('../utils/profile_helper.js');
const { load_adetailer } = require('../utils/adetailer_execute.js');
const { clamp, calculateOptimalGrid, parseImageCount } = require('../utils/common_helper');
const workflow_og = require('../resources/flux_lora.json')
const ComfyClient = require('../utils/comfy_client');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_create')
		.setDescription('Create an AI art via my own Stable Diffusion Web UI instance')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt for the AI to generate art from'))
        .addStringOption(option => 
            option.setName('neg_prompt')
                .setDescription('The negative prompt for the AI to avoid generate art from'))
        .addIntegerOption(option => 
            option.setName('width')
                .setDescription('The width of the generated image (default is 512, 1024 if XL model is used)'))
        .addIntegerOption(option =>
            option.setName('height')
                .setDescription('The height of the generated image (default is 512, 1024 if XL model is used)'))
        .addStringOption(option => 
            option.setName('seed')
                .setDescription('Random seed for AI generate art from (default is "-1 - Random")'))
        .addStringOption(option =>
            option.setName('default_neg_prompt')
                .setDescription('Define the default negative prompt for the user (default is "Quality - No NSFW")')
                .addChoices(
                    { name: 'Quality - SFW', value: 'q_sfw' },
                    { name: 'Quality - NSFW', value: 'q_nsfw' },
                    { name: 'None - SFW', value: 'n_sfw' },
                    { name: 'No Default', value: 'n_nsfw' },
                ))
        .addNumberOption(option =>
            option.setName('upscale_multiplier')
                .setDescription('The rate to upscale the generated image (default is 1) - EXTREMELY SLOW. Use wd_upscale instead'))
        .addStringOption(option =>
            option.setName('upscaler_mode')
                .setDescription('Specify the upscaler to use (default is "Lanczos")')
                .addChoices(
					{ name: 'Latent - VERY SLOW', value: 'Latent' },
                    { name: 'ERSGAN - Normal', value: 'ERSGAN' },
                    { name: 'Lanczos - Fastest', value: 'Lanczos' },
				))
        // .addIntegerOption(option =>
        //     option.setName('force_server_selection')
        //         .setDescription('Force the server to use (default is "-1")'))
        .addStringOption(option => 
            option.setName('checkpoint')
                .setDescription('Force a cached checkpoint to be used (not all option is cached)')
                .addChoices(...model_selection_curated))
        .addStringOption(option =>
            option.setName('profile')
                .setDescription('Specify the profile to use (default is No Profile)'))
        .addStringOption(option =>
            option.setName('bulk_size')
                .setDescription('Generate multiple images at once (default is 1, max is 6 for user, forge backend only)'))

    ,

    // async init() {
    //     // setup heartbeat routine to check which server is alive
    //     initiate_server_heartbeat()
    // },

    async execute_comfy(interaction, client, data) {
        const workflow = JSON.parse(JSON.stringify(workflow_og))

        workflow["5"]["inputs"]["width"] = data.width
        workflow["5"]["inputs"]["height"] = data.height
        workflow["17"]["inputs"]["steps"] = data.sampling_step
        workflow["6"]["inputs"]["text"] = data.prompt
        workflow["27"]["inputs"]["unet_name"] = "sd\\" + data.model
        workflow["16"]["inputs"]["sampler_name"] = data.sampler
        workflow["17"]["inputs"]["scheduler"] = data.scheduler
        workflow["25"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 2_000_000_000)
        workflow["28"]["inputs"]["rel_l1_thresh"] = data.teacache_strength

        // extract lora name and strength from syntax <lora:<name>:<strength>>, adjust node 6 clip to last node being created, 28 model to last node being created
        const lora_regex = /<lora:([^:]+):([^>]+)>/g
        let previous_model_node = "27", previous_clip_node = "11", lora_count = 0
        while ((lora_match = lora_regex.exec(data.prompt)) !== null) {
            lora_count++
            const lora_node = {
                "inputs": {
                    "lora_name": "sd\\flux_lora\\" + lora_match[1] + ".safetensors",
                    "strength_model": parseFloat(lora_match[2]),
                    "strength_clip": 1,
                    "model": [
                        previous_model_node,
                        0
                    ],
                    "clip": [
                        previous_clip_node,
                        previous_clip_node === "11" ? 0 : 1
                    ]
                },
                "class_type": "LoraLoader",
                "_meta": {
                    "title": "Load LoRA"
                }
            }

            workflow[(999 + lora_count).toString()] = lora_node
            previous_model_node = previous_clip_node = (999 + lora_count).toString()
            
            // remove the lora syntax from the prompt
            data.prompt = data.prompt.replace(lora_match[0], '')
        }

        if (lora_count > 0) {
            // adjust the input to point to the last lora model and clip node
            workflow["6"]["inputs"]["clip"] = [previous_clip_node, 1]
            workflow["28"]["inputs"]["model"] = [previous_model_node, 0]
        }

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

		let prompt = (profile?.prompt_pre || '') + (interaction.options.getString('prompt') || '') + (profile?.prompt || '')
		let neg_prompt = (profile?.neg_prompt_pre || '') + (interaction.options.getString('neg_prompt') || '') + (profile?.neg_prompt || '')

        let width = clamp(interaction.options.getInteger('width') || profile?.width || 512, 512, 2048) // this can only end well :)
        let height = clamp(interaction.options.getInteger('height') || profile?.height || 512, 512, 2048)

        let sampler =  profile?.sampler || 'Euler'
        let scheduler = profile?.scheduler || 'Automatic'
        let cfg_scale = clamp(profile?.cfg_scale || 7, 0, 30)
        let sampling_step = clamp(profile?.sampling_step || 25, 1, 100)

        const default_neg_prompt = interaction.options.getString('default_neg_prompt') || 'q_sfw'

        const force_server_selection = -1

        const upscaler_mode = interaction.options.getString('upscaler_mode') || 'Lanczos'

        const upscale_step = (upscaler_mode === 'Latent' ? 25 : 15)
        const upscale_multiplier = clamp(interaction.options.getNumber('upscale_multiplier') || 1, 1, 4)
        const upscaler = upscaler_mode === 'Latent' ? 'Latent' : upscaler_mode === 'Lanczos' ? 'Lanczos' : '4x_UltraSharp' 
        const upscale_denoise_strength = (upscaler_mode === 'Latent' ? 0.65 : 0.25)

        const checkpoint = interaction.options.getString('checkpoint') || profile?.checkpoint  ||  null
        let clip_skip = clamp(profile?.clip_skip || 1, 1, 12)
        const adetailer_config = profile?.adetailer_config ||
            (client.adetailer_config.has(interaction.user.id) ? client.adetailer_config.get(interaction.user.id) : null)
        const booru_gen_config = profile?.boorugen_config || (client.boorugen_config.has(interaction.user.id) ? client.boorugen_config.get(interaction.user.id) : null)
        const latentmod_config = profile?.latentmod_config || (client.latentmod_config.has(interaction.user.id) ? client.latentmod_config.get(interaction.user.id) : null)
        const colorbalance_config = profile?.colorbalance_config ||
            (client.colorbalance_config.has(interaction.user.id) ? client.colorbalance_config.get(interaction.user.id) : null)
        const bulk_size_input = interaction.options.getString('bulk_size') || '1'

        // calculate batch count and size
        let { bulk_size, batch_count, batch_size } = parseImageCount(bulk_size_input, height, width, upscale_multiplier, byPassUser.includes(interaction.user.id) ? 16 : 6)
        // // parse the user setting config
        // const usersetting_config = client.usersetting_config.has(interaction.user.id) ? client.usersetting_config.get(interaction.user.id) : null
        let do_preview = false

        // try {
        //     const usersetting_config_obj = JSON.parse(usersetting_config)
        //     do_preview = usersetting_config_obj.do_preview
        // }
        // catch (err) {
        //     console.log("Failed to parse usersetting config:", err)
        // }
        
        let seed = -1
        try {
            seed = parseInt(interaction.options.getString('seed')) || parseInt(profile?.seed || '-1')
        }
        catch {
            seed = parseInt('-1')
        }
        
        if (height % 8 !== 0 || width % 8 !== 0) {
            height = Math.ceil(height / 8) * 8
            width = Math.ceil(width / 8) * 8
        }

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
        if (cached_model[0].includes('_inpaint')) {
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

        //TODO: refactor all forced config

        if (model_selection_xl.find(x => x.value === cached_model[0])) {
            if (width === 512 && height === 512) {
                interaction.channel.send('default resolution detected while XL model is selected, changing resolution to 1024x1024')
                width = 1024
                height = 1024
            }
        }
        else if (model_selection_flux.find(x => x.value === cached_model[0])) {
            if (width === 512 && height === 512) {
                interaction.channel.send('default resolution detected while Flux model is selected, changing resolution to 1024x1024, disabling dynamic lora load')
                width = 1024
                height = 1024
            }
        }

        if (cached_model[0] === 'dreamshaperxl_turbo.safetensors') {
            sampler = 'DPM++ SDE'
            scheduler = 'Karras'
            cfg_scale = 2
            sampling_step = 8
        }
        else if (cached_model[0] === 'juggernautxl_turbo.safetensors') {
            sampler = 'DPM++ 2M'
            scheduler = 'Karras'
            cfg_scale = 5
            sampling_step = 30
        }
        else if (cached_model[0] === 'juggernautxl_lightning.safetensors') {
            sampler = 'DPM++ SDE'
            cfg_scale = 2
            sampling_step = 4
        }
        else if (cached_model[0] === 'dreamshaperxl_lightning.safetensors') {
            sampler = 'DPM++ SDE'
            scheduler = 'Karras'
            cfg_scale = 2
            sampling_step = 4
        }
        else if (cached_model[0] === 'noobaixl_vpred_v1.safetensors') {
            sampler = 'Euler'
            scheduler = 'Automatic'
            cfg_scale = 5.5
            sampling_step = 30
        }
        else if (cached_model[0] === 'noobaixl_v1_1.safetensors') {
            sampler = 'DPM++ 2M'
            scheduler = 'Automatic'
            cfg_scale = 5.5
            sampling_step = 30
        }
        else if (cached_model[0] === 'animaginexl_v40_opt.safetensors') {
            sampler = 'Euler a CFG++'
            scheduler = 'SGM Uniform'
            cfg_scale = 1.5
            sampling_step = 28
        }
        else if (cached_model[0] === 'illumiyumexl_vpred_v31.safetensors') {
            sampler = 'Euler a'
            scheduler = 'SGM Uniform'
            cfg_scale = 5.5
            sampling_step = 28
        }
        else if (cached_model[0] === 'wai_nsfw_illustrious_v120.safetensors') {
            sampler = 'Euler a CFG++'
            scheduler = 'SGM Uniform'
            cfg_scale = 1.5
            sampling_step = 28
        }
        else if (cached_model[0].includes('vpred')) {
            sampler = 'Euler a'
            scheduler = 'SGM Uniform'
            cfg_scale = 4
            sampling_step = 28
        }
        else if (model_selection_flux.find(x => x.value === cached_model[0])) {
            sampler = 'Euler'
            scheduler = 'SGM Uniform'
            cfg_scale = 3.5
            sampling_step = 20
        }
        else if (model_selection.find(x => x.value === cached_model[0])) {
            sampler = 'DPM++ 2M'
            scheduler = 'Karras'
            cfg_scale = 7
            sampling_step = 30
        }
        else {
            sampler = profile?.sampler ?? 'DPM++ 2M'
            scheduler = profile?.scheduler ?? 'Align Your Steps'
            cfg_scale = profile?.cfg_scale ?? 7
            sampling_step = profile?.sampling_step ?? 12
        }

        // end forced config

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

        const WORKER_ENDPOINT = server_pool[server_index].url

        const row = new MessageActionRow()
    			.addComponents(
    				new MessageButton()
    					.setCustomId('cancel_simple_' + interaction.id)
    					.setLabel('Cancel')
    					.setStyle('DANGER'),
    			);

        const filter = i => i.customId === 'cancel_simple_' + interaction.id && i.user.id === interaction.user.id;

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

        const is_xl = model_selection_xl.find(x => x.value === cached_model[0]) != null
        const is_flux = model_selection_flux.find(x => x.value === cached_model[0]) != null
        const is_vpred = cached_model[0].includes('vpred')
        extra_config = full_prompt_analyze(prompt, is_xl)
        prompt = extra_config.prompt
        prompt = await fetch_user_defined_wildcard(prompt, interaction.user.id)

        if (is_flux ? width * height > 1_800_000 : is_xl ? width * height > 1_200_000 : width * height > 640_000) {
            await interaction.channel.send(`:warning: Image size is too large for model's capability and may introduce distorsion, please consider using smaller image size unless you know what you're doing`);
        }

        const slow_sampler = ['DPM++ SDE', 'DPM++ 2M SDE', 'DPM++ 2M SDE Heun', 'Restart']
        // calculate cooldown (first pass)
        let compute = width * height * sampling_step * (is_flux ? 3 : (is_xl ? 1.5 : 1)) * (slow_sampler.includes(sampler) ? 1.5 : 1)
        // calculate compute (adetailer)
        compute = compute * (adetailer_config ? 1.5 : 1)
        // reduce time if use teacache
        const teacache_check = get_teacache_config_from_prompt(prompt, true)
        if (teacache_check.teacache_config) {
            compute = compute * Math.pow(1 - (teacache_check.teacache_config.threshold || 0.1), 2)
        }
        // calculate compute (upscale)
        compute += upscale_multiplier > 1 ? (upscale_multiplier * height * upscale_multiplier * width * upscale_step * (slow_sampler.includes(sampler) ? 1.5 : 1)) : 0
        // calculate compute (change model)
        compute += checkpoint ? 2_000_000 : 0

        const cooldown = compute * bulk_size / (bulk_size > 1 ? 1_850_000 : 1_700_000)

        const force_legacy_flux = prompt.includes('[FLUX_FORGE]')
        prompt = prompt.replace('[FLUX_FORGE]', '')
        // search for lora load call <lora:...:...>
        if (is_flux && !force_legacy_flux) {
            // flux lora is broken in forge backend, switch to comfyUI backend
            interaction.channel.send({ content: `Detected Flux, switching to ComfyUI backend, some options will be ignore. You can create another image in ${cooldown.toFixed(2)} seconds ${teacache_check.teacache_config ? "(Teacache activated: -" + (100 * (1 - Math.pow(1 - teacache_check.teacache_config?.threshold || 0.1, 2))).toFixed(0) + "%)" : ""}` });
            if (ComfyClient.promptListener.length == 0 && ComfyClient.comfyStat.gpu_vram_used > 6) {
                await interaction.editReply({ content: 'Not enough resource can be allocated to finish this command, please try again later' });
                return;
            }
            this.execute_comfy(interaction, client, {
                prompt,
                width,
                height,
                sampling_step,
                model: cached_model[0],
                sampler: sampler_to_comfy_name_mapping[sampler] ?? "euler",
                scheduler: scheduler_to_comfy_name_mapping[scheduler] ?? "normal",
                teacache_strength: teacache_check.teacache_config ? teacache_check.teacache_config.threshold : 0
            })

            client.cooldowns.set(interaction.user.id, true);

            setTimeout(() => {
                client.cooldowns.delete(interaction.user.id);
            }, cooldown * 1000);
            return
        }

        await interaction.editReply({ content: `Generating image, you can create another image in ${cooldown.toFixed(2)} seconds ${teacache_check.teacache_config ? "(Teacache activated: -" + (100 * (1 - Math.pow(1 - teacache_check.teacache_config?.threshold || 0.1, 2))).toFixed(0) + "%)" : ""}` });

        if (extra_config.coupler_config && (height % 64 !== 0 || width % 64 !== 0)) {
            interaction.channel.send('Coupler detected, changing resolution to multiple of 64')
            height = Math.ceil(height / 64) * 64
            width = Math.ceil(width / 64) * 64
        }

        if (extra_config.coupler_config && extra_config.coupler_config.mode === 'Advanced') {
            preview_coupler_setting(interaction, width, height, extra_config, server_pool[server_index].fn_index_coupler_region_preview[0], session_hash)
        }

        const is_censor = ((interaction.guildId && censorGuildIds.includes(interaction.guildId)) || (interaction.channel && !interaction.channel.nsfw && !optOutGuildIds.includes(interaction.guildId))) ? true : false

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

        let use_adetailer = false
        // check if adetailer config is not null and at least 1 of config's model is not None
        if (adetailer_config && (adetailer_config[0].model !== 'None' || adetailer_config[1].model !== 'None')) {
            await load_adetailer(session_hash, server_index, adetailer_config, interaction, extra_config.coupler_config, prompt)
                .catch(err => {
                    console.log(err)
                    interaction.editReply({ content: "Failed to load adetailer:" + err });
                });
            use_adetailer = true
        }
    
        const create_data = get_data_body(server_index, prompt, neg_prompt, sampling_step, cfg_scale, 
            seed, sampler, scheduler, session_hash, height, width, upscale_multiplier, upscaler, 
            upscale_denoise_strength, upscale_step, false, use_adetailer, extra_config.coupler_config, extra_config.color_grading_config, clip_skip, is_censor,
            extra_config.freeu_config, extra_config.dynamic_threshold_config, extra_config.pag_config, override_neg_prompt ? false : true, extra_config.use_booru_gen, 
            booru_gen_config_obj, is_flux, colorbalance_config_obj, do_preview, extra_config.detail_daemon_config, extra_config.tipo_input, latentmod_config_obj,
            extra_config.mahiro_config, extra_config.teacache_config, batch_count, batch_size)

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
                        .setImage(data.catbox_url ? data.catbox_url : `attachment://${data.img_name}`)
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
                    if (data.img && !data.catbox_url) {
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
                    if (isCancelled) return
                    if (final_res_obj.data) {
                        // if server index == 0, get local image directory, else initiate request to get image from server
                        let catbox_url = null
                        // Extract all image paths from the response
                        const imagePaths = final_res_obj.data[0].map(item => item?.image?.path).filter(Boolean);
                        //console.dir(final_res_obj.data, {depth: null});

                        if (imagePaths.length === 0) {
                            // error from python server side, we bail
                            throw 'Request return no images';
                        }
                        // if imagePath.length > 1, it mean the first image will be the grid, check if the gird w/h exceed 2000 pixel, if yes we will use jpg file of the same name
                        if (imagePaths.length > 1 && bulk_size > 1) {
                            // calculate most efficient grid size, consider initial width and height as well
                            const gridInfo = calculateOptimalGrid(width, height, imagePaths.length - 1);
                            console.log(`Creating grid with ${gridInfo.columns}x${gridInfo.rows} layout for ${imagePaths.length - 1} images`);
                            
                            // Check if the grid dimensions exceed 2000 pixels
                            if (gridInfo.gridWidth > 3000 || gridInfo.gridHeight > 3000) {
                                console.log(`Grid dimensions (${gridInfo.gridWidth}x${gridInfo.gridHeight}) exceed 2000 pixels, will use JPG format`);
                                // Here you could add code to change the file extension to jpg if needed
                                imagePaths[0] = imagePaths[0].replace(/\.png$/, '.jpg');
                            }
                        }

                        // Process metadata from response
                        const metadataObj = JSON.parse(final_res_obj.data[1] || JSON.stringify({
                            seed: -1,
                            sd_model_hash: "-",
                            sd_model_name: "-"
                        }));
                        const seed = metadataObj.seed.toString();
                        const model_hash = metadataObj.sd_model_hash;
                        const model_name = metadataObj.sd_model_name;
                        console.log(final_res_obj.duration);

                        // Fetch all images and prepare result
                        const imageResults = [];

                        for (let i = 0; i < imagePaths.length; i++) {
                            // all server is now remote
                            // retry fetch before throwing
                            let fetch_final_retry_count = 0;
                            let img_res = null;
                            while (fetch_final_retry_count < 3 && !img_res) {
                                img_res = await fetch(`${WORKER_ENDPOINT}/file=${imagePaths[i]}`).catch(err => {
                                    console.log(`Error while fetching image ${i+1} on remote server, retrying...`);
                                });
                                fetch_final_retry_count++;
                                // wait for 1 second before retry
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                            
                            if (!img_res) {
                                console.log(`Warning: Could not fetch image ${i+1} at path ${imagePaths[i]}`);
                                continue;
                            }
                            
                            if (img_res.status === 200) {
                                const img_buffer = Buffer.from(await img_res.arrayBuffer());
                                imageResults.push({
                                    buffer: img_buffer,
                                    path: imagePaths[i]
                                });
                                
                                if (i === 0) {
                                    // wait for 2 seconds before updating the interaction reply to avoid race condition
                                    await new Promise(resolve => setTimeout(resolve, 2000));

                                    if (imageResults.length === 0) {
                                        throw 'Failed to fetch any images from remote server';
                                    }

                                    // Update the interaction reply with the first image and info about total count
                                    await updateInteractionReply({
                                        img: imageResults[0].buffer || imageResults[0].path,
                                        img_name: 'img_combined.png',
                                        seed: seed,
                                        model: model_hash,
                                        model_name: model_name,
                                        duration: final_res_obj.duration,
                                        catbox_url: catbox_url,
                                    }, 'completed').catch(err => {
                                        console.log(err);
                                    });
                                }
                                else if (bulk_size > 1) {
                                    // send additional images as file in the channel the interaction was created
                                    await interaction.channel.send({
                                        content: `Additional image ${i} of ${imagePaths.length - 1}`,
                                        files: [{
                                            attachment: img_buffer,
                                            name: `img_${i}.png`
                                        }]
                                    });
                                }
                            }
                        }

                        isDone = true;
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
        }, cooldown * 1000);
	},
};