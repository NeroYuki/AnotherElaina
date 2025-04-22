const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser, censorGuildIds, optOutGuildIds } = require('../config.json');
const crypt = require('crypto');
const { server_pool, get_prompt, get_negative_prompt, get_worker_server, get_data_body_img2img, model_name_hash_mapping, check_model_filename, model_selection, model_selection_xl, upscaler_selection, model_selection_curated, model_selection_inpaint, model_selection_flux } = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { loadImage } = require('../utils/load_discord_img.js');
const { cached_model, model_change } = require('../utils/model_change.js');
const { queryRecordLimit } = require('../database/database_interaction.js');
const { full_prompt_analyze, preview_coupler_setting, fetch_user_defined_wildcard, get_teacache_config_from_prompt } = require('../utils/prompt_analyzer.js');
const { load_profile } = require('../utils/profile_helper.js');
const { clamp } = require('../utils/common_helper');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_img2img')
		.setDescription('Request my Diffusion instance to generate art from an image')
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
        .addBooleanOption(option => 
            option.setName('no_dynamic_lora_load')
                .setDescription('Do not use the bot\'s dynamic LoRA loading (default is "false")'))
        .addStringOption(option => 
            option.setName('checkpoint')
                .setDescription('Force a cached checkpoint to be used (not all option is cached)')
                .addChoices(...model_selection_curated))
        .addStringOption(option =>
            option.setName('upscaler')
                .setDescription('The upscaler to use (default is "None")')
                .addChoices(...upscaler_selection))
        .addStringOption(option =>
            option.setName('profile')
                .setDescription('Specify the profile to use (default is No Profile)'))
                
    ,

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

        let sampler =  profile?.sampler || 'Euler'
        let scheduler = profile?.scheduler || 'Automatic'
        let cfg_scale = clamp(profile?.cfg_scale || 7, 0, 30)
        let sampling_step = clamp(profile?.sampling_step || 25, 1, 100)

        const default_neg_prompt = interaction.options.getString('default_neg_prompt') || 'q_sfw'

        const denoising_strength = clamp(interaction.options.getNumber('denoising_strength') || 0.7, 0, 1)
        const force_server_selection = -1
        const checkpoint = interaction.options.getString('checkpoint')|| profile?.checkpoint || null
        const upscaler = interaction.options.getString('upscaler') || 'None'
        let clip_skip = clamp(profile?.clip_skip || 1, 1, 12)
        const adetailer_config = profile?.adetailer_config ||
            (client.adetailer_config.has(interaction.user.id) ? client.adetailer_config.get(interaction.user.id) : null)
        const booru_gen_config = profile?.boorugen_config || (client.boorugen_config.has(interaction.user.id) ? client.boorugen_config.get(interaction.user.id) : null)
        const latentmod_config = profile?.latentmod_config || (client.latentmod_config.has(interaction.user.id) ? client.latentmod_config.get(interaction.user.id) : null)
        const colorbalance_config = profile?.colorbalance_config ||
            (client.colorbalance_config.has(interaction.user.id) ? client.colorbalance_config.get(interaction.user.id) : null)

        // parse the user setting config
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
            seed = parseInt(interaction.options.getString('seed')) || parseInt('-1')
        }
        catch {
            seed = parseInt('-1')
        }

        let attachment_option = interaction.options.getAttachment('image')

        //download the image from attachment.proxyURL
        let attachment = await loadImage(attachment_option.proxyURL,
            /*getBuffer:*/ false, /*noDataURIHeader*/ false, /*safeMode*/ true).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to retrieve image", ephemeral: true });
            return
        })

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
        else if (cached_model[0] === 'animaginexl_v40.safetensors') {
            sampler = 'Euler a'
            scheduler = 'Automatic'
            cfg_scale = 6
            sampling_step = 30
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
            scheduler = profile?.scheduler ?? 'Align Your Step'
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
    					.setCustomId('cancel_img2img_simple_' + interaction.id)
    					.setLabel('Cancel')
    					.setStyle('DANGER'),
    			);

        const filter = i => i.customId === 'cancel_img2img_simple_' + interaction.id && i.user.id === interaction.user.id;

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
        extra_config = full_prompt_analyze(prompt, is_xl)
        prompt = extra_config.prompt
        prompt = await fetch_user_defined_wildcard(prompt, interaction.user.id)

        if (is_flux ? width * height > 1_800_000 : is_xl ? width * height > 1_200_000 : width * height > 640_000) {
            await interaction.channel.send(`:warning: Image size is too large for model's capability and may introduce distorsion, please consider using smaller image size unless you know what you're doing`);
        }

        const slow_sampler = ['DPM++ SDE', 'DPM++ 2M SDE', 'DPM++ 2M SDE Heun', 'Restart']
        // calculate cooldown (first pass)
        let compute = width * height * sampling_step * (is_flux ? 3 : (is_xl ? 1.5 : 1)) * (slow_sampler.includes(sampler) ? 1.5 : 1) * denoising_strength
        // calculate compute (adetailer)
        compute = compute * (adetailer_config ? 1.5 : 1)
        // reduce time if use teacache
        const teacache_check = get_teacache_config_from_prompt(prompt, true)
        if (teacache_check.teacache_config) {
            compute = compute * Math.pow(1 - (teacache_check.teacache_config.threshold || 0.1), 2)
        }
        // calculate compute (change model)
        compute += checkpoint ? 2_000_000 : 0

        const cooldown = compute / 1_700_000

        await interaction.editReply({ content: `Generating image, you can create another image in ${cooldown.toFixed(2)} seconds ${teacache_check.teacache_config ? "(Teacache activated: -" + (100 * (1 - Math.pow(1 - teacache_check.teacache_config?.threshold || 0.1, 2))).toFixed(0) + "%)" : ""}` });

        if (extra_config.coupler_config && (height % 64 !== 0 || width % 64 !== 0)) {
            interaction.channel.send('Coupler detected, changing resolution to multiple of 64')
            height = Math.ceil(height / 64) * 64
            width = Math.ceil(width / 64) * 64
        }

        const is_censor = ((interaction.guildId && censorGuildIds.includes(interaction.guildId)) || (interaction.channel && !interaction.channel.nsfw && !optOutGuildIds.includes(interaction.guildId))) ? true : false

        if (extra_config.coupler_config && extra_config.coupler_config.mode === 'Advanced') {
            preview_coupler_setting(interaction, width, height, extra_config, server_pool[server_index].fn_index_coupler_region_preview[1], session_hash)
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
            false, extra_config.coupler_config, extra_config.color_grading_config, clip_skip, is_censor,
            extra_config.freeu_config, extra_config.dynamic_threshold_config, extra_config.pag_config, "Whole picture", 32, 
            override_neg_prompt ? false : true, extra_config.use_booru_gen, booru_gen_config_obj, is_flux, null, null, colorbalance_config_obj, do_preview, 
            null, null, "None", extra_config.detail_daemon_config, extra_config.tipo_input, latentmod_config,
            extra_config.mahiro_config, extra_config.teacache_config)

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
                        const file_dir = final_res_obj.data[0][0]?.image.path
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
                        const seed = JSON.parse(final_res_obj.data[1] || JSON.stringify({seed: -1})).seed.toString()
                        const model_hash = JSON.parse(final_res_obj.data[1] || JSON.stringify({sd_model_hash: "-"})).sd_model_hash
                        const model_name = JSON.parse(final_res_obj.data[1] || JSON.stringify({sd_model_name: "-"})).sd_model_name
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