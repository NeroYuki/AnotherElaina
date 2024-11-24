const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const { server_pool, get_prompt, get_negative_prompt, get_worker_server, model_name_hash_mapping, upscaler_selection, get_data_rembg } = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { loadImage, uploadDiscordImageToGradio } = require('../utils/load_discord_img');
const { clamp, convert_upload_path_to_file_data } = require('../utils/common_helper');

// const get_data_rembg = (input, rembg_model = "birefnet-general", edge_width = 0, edge_color = "#FFFFFF", alpha_mat = false, alpha_mat_fg = 240, alpha_mat_bg = 10, 
//     add_shadow = false, shadow_opacity = 0.5, shadow_blur = 5, adjust_color = false, brightness = 1, contrast = 1, saturation = 1
// )

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_rembg')
		.setDescription('Quickly remove background from an image')
		.addAttachmentOption(option =>
			option.setName('image')
				.setDescription('The image to be processed')
				.setRequired(true))
        .addStringOption(option =>
            option.setName('rembg_model')
                .setDescription('The model to use for removing background (default is "birefnet-general")')
                .addChoices(
                    { name: 'birefnet-general', value: 'birefnet-general' },
                    { name: 'birefnet-massive', value: 'birefnet-massive' },
                    { name: 'u2net', value: 'u2net' },
                    { name: 'u2netp', value: 'u2netp' },
                    { name: 'u2net-human-seg', value: 'u2net-human-seg' },
                    { name: 'u2net-cloth-seg', value: 'u2net-cloth-seg' },
                    { name: 'silueta', value: 'silueta' },
                    { name: 'isnet-general-use', value: 'isnet-general-use' },
                    { name: 'isnet-anime', value: 'isnet-anime' },
                ))
        .addNumberOption(option =>
            option.setName('edge_width')
                .setDescription('The width of the edge (default is "0", no edge will be added)'))
        .addStringOption(option =>
            option.setName('edge_color')
                .setDescription('The color of the edge (default is "#FFFFFF")'))
        .addBooleanOption(option =>
            option.setName('alpha_mat')
                .setDescription('Whether to use alpha matting (default is "false")'))
        .addNumberOption(option =>
            option.setName('alpha_mat_fg')
                .setDescription('The foreground alpha matting value (default is "240")'))
        .addNumberOption(option =>
            option.setName('alpha_mat_bg')
                .setDescription('The background alpha matting value (default is "10")'))
        .addNumberOption(option =>
            option.setName('shadow_opacity')
                .setDescription('The shadow opacity (default is "0", do not add shadow)'))
        .addNumberOption(option =>
            option.setName('shadow_blur')
                .setDescription('The shadow blur (default is "5")'))
        .addNumberOption(option =>
            option.setName('brightness')
                .setDescription('The brightness value (default is "1")'))
        .addNumberOption(option =>
            option.setName('contrast')
                .setDescription('The contrast value (default is "1")'))
        .addNumberOption(option =>
            option.setName('saturation')
                .setDescription('The saturation value (default is "1")'))
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
        const rembg_model = interaction.options.getString('rembg_model') || "birefnet-general"
        const edge_width = clamp(interaction.options.getNumber('edge_width') || 0, 0, 10)
        const edge_color = interaction.options.getString('edge_color') || "#FFFFFF"
        const alpha_mat = interaction.options.getBoolean('alpha_mat') || false
        const alpha_mat_fg = clamp(interaction.options.getNumber('alpha_mat_fg') || 240, 0, 255)
        const alpha_mat_bg = clamp(interaction.options.getNumber('alpha_mat_bg') || 10, 0, 255)
        const shadow_opacity = clamp(interaction.options.getNumber('shadow_opacity') || 0, 0, 1)
        const shadow_blur = clamp(interaction.options.getNumber('shadow_blur') || 5, 0, 20)
        const brightness = clamp(interaction.options.getNumber('brightness') || 1, 0, 2)
        const contrast = clamp(interaction.options.getNumber('contrast') || 1, 0, 2)
        const saturation = clamp(interaction.options.getNumber('saturation') || 1, 0, 2)

        const add_shadow = shadow_opacity > 0
        const adjust_color = brightness !== 1 || contrast !== 1 || saturation !== 1

        // const color_enhance_weight = clamp(interaction.options.getNumber('color_enhance_weight') || 0, 0, 1)

        //make a temporary reply to not get timeout'd
		await interaction.deferReply();

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
    
        const rembg_data = get_data_rembg(convert_upload_path_to_file_data(attachment_upload_path, WORKER_ENDPOINT), rembg_model, edge_width, edge_color, alpha_mat, alpha_mat_fg, 
            alpha_mat_bg, add_shadow, shadow_opacity, shadow_blur, adjust_color, brightness, contrast, saturation)

        // make option_init but for axios
        const option_init_axios = {
            data: {
                fn_index: server_pool[server_index].fn_index_rembg,
                session_hash: session_hash,
                data: rembg_data
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
                    const file_dir = final_res_obj.data[0]?.url
                    console.log(final_res_obj.data)
                    if (!file_dir) {
                        throw 'Request return no image'
                    }
                    // all server is remote
                    const img_res = await fetch(`${file_dir}`).catch(err => {
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

                    const reply_content = {embeds: [embeded]}
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
                await interaction.editReply({content: 'Error while remove background '})
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