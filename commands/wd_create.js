const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser, censorGuildIds, optOutGuildIds } = require('../config.json');
const crypt = require('crypto');
const { server_pool, get_data_body, get_negative_prompt, initiate_server_heartbeat, get_worker_server, get_prompt, load_lora_from_prompt, model_name_hash_mapping, check_model_filename, model_selection, upscaler_selection, model_selection_xl, model_selection_curated, model_selection_inpaint, model_selection_flux } = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { model_change, cached_model } = require('../utils/model_change.js');
const { queryRecordLimit } = require('../database/database_interaction.js');
const { full_prompt_analyze, preview_coupler_setting, fetch_user_defined_wildcard } = require('../utils/prompt_analyzer.js');
const { fallback_to_resource_saving } = require('../utils/ollama_request.js');

function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

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

    ,

    // async init() {
    //     // setup heartbeat routine to check which server is alive
    //     initiate_server_heartbeat()
    // },

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
            let profile_data = null
            // attempt to query the profile name on the database
            profile_data = await queryRecordLimit('wd_profile', { name: profile_option, user_id: interaction.user.id }, 1)
            if (profile_data.length == 0) {
                // attempt to query global profile
                profile_data = await queryRecordLimit('wd_profile', { name: profile_option }, 1)
                if (profile_data.length == 0) {
                    // no profile found
                    interaction.channel.send({ content: `Profile ${profile_option} not found, fallback to default setting` });
                }
            }

            if (profile_data.length != 0) {
                profile = profile_data[0]
            }
        }

		let prompt = (profile?.prompt_pre || '') + (interaction.options.getString('prompt') || '') + (profile?.prompt || '')
		let neg_prompt = (profile?.neg_prompt_pre || '') + (interaction.options.getString('neg_prompt') || '') + (profile?.neg_prompt || '')

        let width = clamp(interaction.options.getInteger('width') || profile?.width || 512, 512, 2048) // this can only end well :)
        let height = clamp(interaction.options.getInteger('height') || profile?.height || 512, 512, 2048)

        let sampler =  profile?.sampler || 'Euler a'
        let cfg_scale = clamp(profile?.cfg_scale || 7, 0, 30)
        let sampling_step = clamp(profile?.sampling_step || 25, 1, 100)

        const default_neg_prompt = interaction.options.getString('default_neg_prompt') || 'q_sfw'
        const no_dynamic_lora_load = interaction.options.getBoolean('no_dynamic_lora_load') || false
        let default_lora_strength = 0.85

        const force_server_selection = -1

        const upscaler_mode = interaction.options.getString('upscaler_mode') || 'Lanczos'

        const upscale_step = (upscaler_mode === 'Latent' ? 25 : 15)
        const upscale_multiplier = clamp(interaction.options.getNumber('upscale_multiplier') || 1, 1, 4)
        const upscaler = upscaler_mode === 'Latent' ? 'Latent' : upscaler_mode === 'Lanczos' ? 'Lanczos' : '4x_UltraSharp' 
        const upscale_denoise_strength = (upscaler_mode === 'Latent' ? 0.65 : 0.25)

        const checkpoint = interaction.options.getString('checkpoint') || profile?.checkpoint  ||  null
        let clip_skip = clamp(profile?.clip_skip || 1, 1, 12)

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

            default_lora_strength = 1
        }

        if (cached_model[0] === 'aamxl_turbo.safetensors [8238e80fdd]') {
            sampler = 'Euler a'
            cfg_scale = 3.5
            sampling_step = 8
        }
        else if (cached_model[0] === 'dreamshaperxl_turbo.safetensors [4496b36d48]') {
            sampler = 'DPM++ SDE Karras'
            cfg_scale = 2
            sampling_step = 8
        }
        else if (cached_model[0] === 'juggernautxl_turbo.safetensors [c9e3e68f89]') {
            sampler = 'DPM++ 2M Karras'
            cfg_scale = 5
            sampling_step = 30
        }
        else if (cached_model[0] === 'juggernautxl_lightning.safetensors [c8df560d29]') {
            sampler = 'DPM++ SDE'
            cfg_scale = 2
            sampling_step = 4
        }
        else if (cached_model[0] === 'dreamshaperxl_lightning.safetensors [fdbe56354b]') {
            sampler = 'DPM++ SDE Karras'
            cfg_scale = 2
            sampling_step = 4
        }
        else if (model_selection.find(x => x.value === cached_model[0])) {
            sampler = 'DPM++ 2M Karras'
            cfg_scale = 7
            sampling_step = 30
        }

        // end forced config

        let server_index = get_worker_server(force_server_selection)

        if (server_index === -1) {
            await interaction.editReply({ content: "No server is available, please try again later"});
            return
        }

        const cooldown = (width * height * sampling_step + (upscale_multiplier > 1 ? (upscale_multiplier * height * upscale_multiplier * width * upscale_step) : 0) + (checkpoint ? 2000000 : 0)) / 1000000

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
        extra_config = full_prompt_analyze(prompt, is_xl)
        prompt = extra_config.prompt
        prompt = await fetch_user_defined_wildcard(prompt, interaction.user.id)

        if (extra_config.coupler_config && (height % 64 !== 0 || width % 64 !== 0)) {
            interaction.channel.send('Coupler detected, changing resolution to multiple of 64')
            height = Math.ceil(height / 64) * 64
            width = Math.ceil(width / 64) * 64
        }

        if (extra_config.coupler_config && extra_config.coupler_config.mode === 'Advanced') {
            preview_coupler_setting(interaction, width, height, extra_config, server_pool[server_index].fn_index_coupler_region_preview[0], session_hash)
        }

        const is_censor = ((interaction.guildId && censorGuildIds.includes(interaction.guildId)) || (interaction.channel && !interaction.channel.nsfw && !optOutGuildIds.includes(interaction.guildId))) ? true : false

        if (!no_dynamic_lora_load && !is_flux) {
            prompt = load_lora_from_prompt(prompt, default_lora_strength)
        }

        if (extra_config.use_booru_gen) {
            interaction.channel.send('Enhancing image with BooruGen prompt expansion engine.')
        }
    
        const create_data = get_data_body(server_index, prompt, neg_prompt, sampling_step, cfg_scale, 
            seed, sampler, session_hash, height, width, upscale_multiplier, upscaler, 
            upscale_denoise_strength, upscale_step, false, false, extra_config.coupler_config, extra_config.color_grading_config, clip_skip, is_censor,
            extra_config.freeu_config, extra_config.dynamic_threshold_config, extra_config.pag_config, override_neg_prompt ? false : true, extra_config.use_booru_gen, null, is_flux)

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
        fallback_to_resource_saving()

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
                    if (data.img && !data.catbox_url) {
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
                        let catbox_url = null
                        const file_dir = final_res_obj.data[0][0]?.image.path
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
                            duration: final_res_obj.duration,
                            catbox_url: catbox_url
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
        }, cooldown * 1000);
	},
};