const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const { server_pool, get_prompt, get_negative_prompt, get_worker_server, get_data_body_img2img, load_lora_from_prompt, model_name_hash_mapping } = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const fetch = require('node-fetch');
const { loadImage } = require('../utils/load_discord_img');

function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

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
                .addChoices(
                    { name: 'Lanczos - Fast', value: 'Lanczos' },
                    { name: 'ESRGAN_4x', value: 'ESRGAN_4x' },
                    { name: 'R-ESRGAN 4x+ Anime6B', value: 'R-ESRGAN 4x+ Anime6B' },
                    { name: 'SwinIR 4x', value: 'SwinIR_4x' }
				)),

	async execute(interaction, client) {
        if (client.cooldowns.has(interaction.user.id) && !byPassUser.includes(interaction.user.id)) {
            // cooldown not ended
            interaction.reply({ content: "Please wait for cooldown to end", ephemeral: true });
            return 
        }

        let attachment_option = interaction.options.getAttachment('image')
        const upscale_multiplier = clamp(interaction.options.getNumber('upscale_multiplier') || 1, 1, 6)
        const upscaler = interaction.options.getString('upscaler') || 'Lanczos'

        //make a temporary reply to not get timeout'd
		await interaction.deferReply();

        //download the image from attachment.proxyURL
        let attachment = await loadImage(attachment_option.proxyURL).catch((err) => {
            console.log(err)
            interaction.reply({ content: "Failed to retrieve image", ephemeral: true });
            return
        })

        let server_index = get_worker_server(-1)

		    if (server_index === -1) {
            await interaction.editReply({ content: "No server is available, please try again later"});
            return
        }

        // TODO: add progress ping
        const session_hash = crypt.randomBytes(16).toString('base64');

        const WORKER_ENDPOINT = server_pool[server_index].url
    
        const upscale_data = [
            null,
            attachment,
            null,
            "",
            "",
            true,
            null,
            upscale_multiplier,
            512,
            512,
            true,
            upscaler,
            "None",
            0,
            0,
            0,
            0
        ]

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
                        .setFooter({text: `Putting ${Array("my RTX 3060","plub's RTX 3070")[server_index]} to good use!`});

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