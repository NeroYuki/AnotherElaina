const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const { server_pool, get_prompt, get_negative_prompt, get_worker_server, model_name_hash_mapping, upscaler_selection } = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { loadImage, uploadDiscordImageToGradio } = require('../utils/load_discord_img');
const { clamp, convert_upload_path_to_file_data } = require('../utils/common_helper');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_upscale')
		.setDescription('Quickly upscale an image')
		.addAttachmentOption(option =>
			option.setName('image')
				.setDescription('The image to be upscaled')
				.setRequired(true))
        .addNumberOption(option =>
            option.setName('upscale_multiplier')
                .setDescription('The rate to upscale the generated image (default is "1, no upscaling")'))
        .addStringOption(option =>
            option.setName('upscaler')
                .setDescription('Specify the upscaler to use (default is "Lanczos")')
                .addChoices(...upscaler_selection))
        .addStringOption(option =>
            option.setName('upscaler_2')
                .setDescription('Specify the 2nd upscaler to use (default is "None")')
                .addChoices(...upscaler_selection))
        .addNumberOption(option =>
            option.setName('upscaler_2_visibility')
                .setDescription('The visibility of the 2nd upscaler (default is "0, no effect)'))
        .addNumberOption(option =>
            option.setName('gfpgan_visibility')
                .setDescription('The visibility of the GFPGAN model (default is "0, no effect)'))
        .addNumberOption(option =>
            option.setName('codeformer_visibility')
                .setDescription('The visibility of the Codeformer model (default is "0, no effect)'))
        .addNumberOption(option =>
            option.setName('codeformer_weight')
                .setDescription('The weight of the Codeformer model (default is "0, no effect)'))       
        .addBooleanOption(option =>
            option.setName('private_mode')
                .setDescription('Whether to use private mode for this generation (default is "false")'))
        // .addNumberOption(option =>
        //     option.setName('color_enhance_weight')
        //         .setDescription('The weight of the color enhancement script (default is "0, no enhancement")'))
    ,

	async execute(interaction, client) {
        if (client.cooldowns.has(interaction.user.id) && !byPassUser.includes(interaction.user.id)) {
            // cooldown not ended
            interaction.reply({ content: "Please wait for cooldown to end", ephemeral: true });
            return 
        }

        let attachment_option = interaction.options.getAttachment('image')
        const upscale_multiplier = clamp(interaction.options.getNumber('upscale_multiplier') || 1, 1, 6)
        const upscaler = interaction.options.getString('upscaler') || 'Lanczos'
        const upscaler_2 = interaction.options.getString('upscaler_2') || 'None'
        const upscaler_2_visibility = clamp(interaction.options.getNumber('upscaler_2_visibility') || 0, 0, 1)
        const gfpgan_visibility = clamp(interaction.options.getNumber('gfpgan_visibility') || 0, 0, 1)
        const codeformer_visibility = clamp(interaction.options.getNumber('codeformer_visibility') || 0, 0, 1)
        const codeformer_weight = clamp(interaction.options.getNumber('codeformer_weight') || 0, 0, 1)
        const private_mode = interaction.options.getBoolean('private_mode') != null ?  interaction.options.getBoolean('private_mode') : false
        // const color_enhance_weight = clamp(interaction.options.getNumber('color_enhance_weight') || 0, 0, 1)

        //make a temporary reply to not get timeout'd
		await interaction.deferReply({ephemeral: private_mode});

        //download the image from attachment.proxyURL
        // let attachment = await loadImage(attachment_option.proxyURL,
        //     /*getBuffer:*/ false, /*noDataURIHeader*/ false, /*safeMode*/ true).catch((err) => {
        //     console.log(err)
        //     interaction.reply({ content: "Failed to retrieve image", ephemeral: true });
        //     return
        // })

        let server_index = get_worker_server(-1)

		    if (server_index === -1) {
            await interaction.editReply({ content: "No server is available, please try again later"});
            return
        }

        // TODO: add progress ping
        const session_hash = crypt.randomBytes(16).toString('base64');

        const WORKER_ENDPOINT = server_pool[server_index].url

        let attachment_upload_path = await uploadDiscordImageToGradio(attachment_option.proxyURL, session_hash, WORKER_ENDPOINT).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to upload image to server", ephemeral: true });
            return
        })
    
        const upscale_data = [
            `task(${session_hash})`,
            0,
            convert_upload_path_to_file_data(attachment_upload_path, WORKER_ENDPOINT),
            null,
            "",
            "",
            true,
            true,
            false,
            0,
            upscale_multiplier,
            0,
            1024,
            1024,
            true,
            upscaler,     // upscaler 1
            upscaler_2,                 // upscaler 2
            upscaler_2_visibility,                      // upscaler 2 visibility
            gfpgan_visibility > 0 ? true : false,      // gfpgan
            gfpgan_visibility,
            codeformer_visibility > 0 ? true : false,      // codeformer
            codeformer_visibility,
            codeformer_weight,
            false,      // focal point crop
            0.9,
            0.15,
            0.5,
            false,
            false,      // nudenet
            true,
            false,
            false,
            "Variable blur",
            10,
            5,
            "#000000",
            "Ellipse",
            3,
            0,
            10,
            0.5,
            1,
        ]

        //console.log(upscale_data)

        // make option_init but for axios
        const option_init_axios = {
            data: {
                fn_index: server_pool[server_index].fn_index_upscale,
                session_hash: session_hash,
                data: upscale_data
            },
            config: {
                timeout: 900000
            }
        }

        try {
            await axios.post(`${WORKER_ENDPOINT}/run/predict/`, option_init_axios.data, option_init_axios.config )
                .then((res) => {
                    if (res.status !== 200) {
                        throw 'Server can be reached but returned non-200 status'
                    }
                    return res.data
                }) // fuck node fetch, all my homies use axios
                .then(async (final_res_obj) => {
                    // if server index == 0, get local image directory, else initiate request to get image from server
                    let img_buffer = null
                    //console.dir(final_res_obj, {depth: null})
                    const file_dir = final_res_obj.data[0][0]?.image.path
                    //console.log(final_res_obj.data)
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

                    console.log(final_res_obj.duration)
                    //console.log(img_buffer, seed)

                    // wait for 2 seconds before updating the interaction reply to avoid race condition
                    // await new Promise(resolve => setTimeout(resolve, 2000))

                    const output_data = {
                        img: img_buffer ? img_buffer : file_dir,
                        img_name: 'img.png',
                        duration: final_res_obj.duration
                    }

                    const embeded = new MessageEmbed()
                        .setColor('#22ff77')
                        .setTitle('Output')
                        .setDescription(`Here you go. Generated in ${output_data.duration.toFixed(2)} seconds.`)
                        .setImage(`attachment://${output_data.img_name}`)
                        .setFooter({text: `Putting ${Array("my RTX 4060 Ti","plub's RTX 3070")[server_index]} to good use!`});

                    const reply_content = {embeds: [embeded]};
                    if (output_data.img) {
                        reply_content.files = [{attachment: output_data.img, name: output_data.img_name}]
                    }

                    await interaction.editReply(reply_content)
                        .catch(err => {
                            console.log(err)
                            reject('Error while updating interaction reply')
                        })
                })
                .catch(err => {
                    throw err
                });
        }
        catch (err) {
            console.log(err)
            try {
                await interaction.editReply({content: 'Error while upscaling '})
            }
            catch (err) {
                console.log('cannot send error to discord', err)
            }
        }

        client.cooldowns.set(interaction.user.id, true);

        setTimeout(() => {
            client.cooldowns.delete(interaction.user.id);
        }, 10 * 1000);
	},
};