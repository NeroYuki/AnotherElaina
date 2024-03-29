const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const { server_pool, get_prompt, get_negative_prompt, get_worker_server, get_data_body_img2img, load_lora_from_prompt, model_name_hash_mapping, check_model_filename, model_selection } = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const sharp = require('sharp');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { loadImage } = require('../utils/load_discord_img');
const { load_controlnet } = require('../utils/controlnet_execute');
const { cached_model, model_change } = require('../utils/model_change');

function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_inpaint')
		.setDescription('(Attempt) to regenerate the image with an inpaint mask')
		.addAttachmentOption(option =>
			option.setName('image')
				.setDescription('The image to be regenerate')
				.setRequired(true))
        .addAttachmentOption(option =>
            option.setName('mask')
                .setDescription('The mask marking where the image should be regenerated')
                .setRequired(true))
		.addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt for the AI to generate art from')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('neg_prompt')
                .setDescription('The negative prompt for the AI to avoid generate art from'))
        .addNumberOption(option => 
            option.setName('denoising_strength')
                .setDescription('How much the image is noised before regen, closer to 0 = closer to original (0 - 1, default 0.7)'))
        .addIntegerOption(option =>
            option.setName('mask_blur')
                .setDescription('How much pixel is the mask being blurred, closer to 0 = closer to original (0 - 64, default 4)'))
        .addStringOption(option => 
            option.setName('mask_content')
                .setDescription('The content that should fill the mask (default is "original")')
                .addChoices(
                    { name: 'Fill', value: 'fill' },
                    { name: 'Original', value: 'original' },
                    { name: 'Latent Noise', value: 'latent noise' },
                    { name: 'Latent Nothing', value: 'latent nothing' },
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
                ))
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
                    { name: 'LMS', value: 'LMS' },
                    { name: 'DPM++ 2S a', value: 'DPM++ 2S a' },
                    { name: 'DPM2 a Karras', value: 'DPM2 a Karras' },
                    { name: 'DPM++ 2M Karras', value: 'DPM++ 2M Karras' },
                    { name: 'DPM++ 3M SDE', value: 'DPM++ 3M SDE' },
                    { name: 'LCM', value: 'LCM' },
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
        .addIntegerOption(option =>
            option.setName('force_server_selection')
                .setDescription('Force the server to use (default is "-1 - Random")'))
        .addStringOption(option => 
            option.setName('checkpoint')
                .setDescription('Force a cached checkpoint to be used (not all option is cached)')
                .addChoices(...model_selection))
    ,

	async execute(interaction, client) {
        if (client.cooldowns.has(interaction.user.id) && !byPassUser.includes(interaction.user.id)) {
            // cooldown not ended
            interaction.reply({ content: "Please wait for cooldown to end", ephemeral: true });
            return 
        }

		// load the option with default value
        let prompt = interaction.options.getString('prompt')
		let neg_prompt = interaction.options.getString('neg_prompt') || '' 
        const width = clamp(interaction.options.getInteger('width') || 512, 64, 1920)
        const height = clamp(interaction.options.getInteger('height') || 512, 64, 1080)
        const denoising_strength = clamp(interaction.options.getNumber('denoising_strength') || 0.7, 0, 1)
        const mask_blur = clamp(interaction.options.getInteger('mask_blur') || 4, 0, 64)
        const mask_content = interaction.options.getString('mask_content') || 'original'
        const mask_color = interaction.options.getString('mask_color') || 'black'
        const sampler = interaction.options.getString('sampler') || 'Euler a'
        const cfg_scale = clamp(interaction.options.getNumber('cfg_scale') || 7, 0, 30)
        const sampling_step = clamp(interaction.options.getInteger('sampling_step') || 20, 1, 100)
        const override_neg_prompt = interaction.options.getBoolean('override_neg_prompt') || false
        const remove_nsfw_restriction = interaction.options.getBoolean('remove_nsfw_restriction') || false
        const no_dynamic_lora_load = interaction.options.getBoolean('no_dynamic_lora_load') || false
        const default_lora_strength = clamp(interaction.options.getNumber('default_lora_strength') || 0.85, 0, 3)
        const force_server_selection = clamp(interaction.options.getInteger('force_server_selection') !== null ? interaction.options.getInteger('force_server_selection') : -1 , -1, 1)
        const controlnet_input_option = interaction.options.getAttachment('controlnet_input') || null
        const controlnet_input_option_2 = interaction.options.getAttachment('controlnet_input_2') || null
        const controlnet_input_option_3 = interaction.options.getAttachment('controlnet_input_3') || null
        const controlnet_config = interaction.options.getString('controlnet_config') || client.controlnet_config.has(interaction.user.id) ? client.controlnet_config.get(interaction.user.id) : null
        const checkpoint = interaction.options.getString('checkpoint') || null

        let seed = -1
        try {
            seed = parseInt(interaction.options.getString('seed')) || parseInt('-1')
        }
        catch {
            seed = parseInt('-1')
        }
        let attachment_option = interaction.options.getAttachment('image')
        let attachment_mask_option = interaction.options.getAttachment('mask')

        //make a temporary reply to not get timeout'd
		await interaction.deferReply();

        //download the image from attachment.proxyURL
        let attachment = await loadImage(attachment_option.proxyURL).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to retrieve image", ephemeral: true });
            return
        })

        let attachment_mask = await loadImage(attachment_mask_option.proxyURL, true).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to retrieve mask image", ephemeral: true });
            return
        })

        let controlnet_input = controlnet_input_option ? await loadImage(controlnet_input_option.proxyURL).catch((err) => {
            console.log(err)
            interaction.reply({ content: "Failed to retrieve control net image", ephemeral: true });
        }) : null

        let controlnet_input_2 = controlnet_input_option_2 ? await loadImage(controlnet_input_option_2.proxyURL).catch((err) => {
            console.log(err)
            interaction.reply({ content: "Failed to retrieve control net image 2", ephemeral: true });
        }) : null

        let controlnet_input_3 = controlnet_input_option_3 ? await loadImage(controlnet_input_option_3.proxyURL).catch((err) => {
            console.log(err)
            interaction.reply({ content: "Failed to retrieve control net image 3", ephemeral: true });
        }) : null

        let sharp_mask_data_uri = ""
        if (mask_color === 'black') {
            // load attachment_mask to sharp, negate, blur (guassian 4 pixels radius), and turn all non-white pixel to black and ((export to png data URI)) (use pipline to avoid memory leak)
            await sharp(attachment_mask)
                .negate({alpha: false})
                .blur(3)
                .threshold(255)
                .toFormat('png')
                .toBuffer()
                .then(data => {
                    sharp_mask_data_uri = "data:image/png;base64," + data.toString('base64')
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
                .then(data => {
                    sharp_mask_data_uri = "data:image/png;base64," + data.toString('base64')
                })
                .catch(err => {
                    console.log('error in mask conversion:', err)
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
                    sharp_mask_data_uri = "data:image/png;base64," + data.toString('base64')
                })
                .catch(err => {
                    console.log(err)
                    interaction.editReply({ content: "Failed to process mask image", ephemeral: true });
                    return
                })
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

        if (controlnet_input && controlnet_config) {
            await load_controlnet(session_hash, server_index, controlnet_input, controlnet_input_2, controlnet_input_3, controlnet_config, interaction, 1)
                .catch(err => {
                    console.log(err)
                    interaction.editReply({ content: "Failed to load control net:" + err });
                });
        }


        const WORKER_ENDPOINT = server_pool[server_index].url

        const row = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setCustomId('cancel')
					.setLabel('Cancel')
					.setStyle('DANGER'),
			);

        const filter = i => i.customId === 'cancel_img2img' && i.user.id === interaction.user.id;

        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 300000 });

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

        // DEBUG: convert mask_uri to png and spit it out

        // const mask_uri = sharp_mask_data_uri
        // await sharp(Buffer.from(mask_uri.replace(/^data:image\/\w+;base64,/, ""), 'base64'))
        //     .toFormat('png')
        //     .toBuffer()
        //     .then(data => {
        //         interaction.editReply({ content: "Debug mask conversion", files: [{attachment: data, name: "debug_mask.png"}] })
        //     })
        //     .catch(err => {
        //         console.log(err)
        //         return ""
        //     })

        // return 


        neg_prompt = get_negative_prompt(neg_prompt, override_neg_prompt, remove_nsfw_restriction)

        prompt = get_prompt(prompt, remove_nsfw_restriction)
        
        if (!no_dynamic_lora_load) {
            prompt = load_lora_from_prompt(prompt, default_lora_strength)
        }
    
        const create_data = get_data_body_img2img(server_index, prompt, neg_prompt, sampling_step, cfg_scale,
            seed, sampler, session_hash, height, width, attachment, sharp_mask_data_uri, denoising_strength, 4, mask_blur, mask_content)

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
        }, client.COOLDOWN_SECONDS * 1000);
	},
};