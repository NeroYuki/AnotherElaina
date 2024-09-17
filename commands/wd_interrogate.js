const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const sharp = require('sharp');
const { server_pool, get_prompt, get_negative_prompt, get_worker_server, model_name_hash_mapping } = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const { loadImage } = require('../utils/load_discord_img');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_interrogate')
		.setDescription('Use CLIP interrogation to describe a picture you uploaded')
		.addAttachmentOption(option =>
			option.setName('image')
				.setDescription('The image to be described')
				.setRequired(true))
        .addStringOption(option =>
            option.setName('engine')
                .setDescription('The engine to use for the interrogation (default is "CLIP")')
                .addChoices(
                    { name: 'CLIP', value: 'CLIP' },
                    { name: 'Deepbooru', value: 'Deepbooru' },
                )
                .setRequired(false))
    ,

	async execute(interaction, client) {
        if (client.cooldowns.has(interaction.user.id) && !byPassUser.includes(interaction.user.id)) {
            // cooldown not ended
            interaction.reply({ content: "Please wait for cooldown to end", ephemeral: true });
            return 
        }

        let attachment_option = interaction.options.getAttachment('image')
        let engine = interaction.options.getString('engine') || 'CLIP'

        //make a temporary reply to not get timeout'd
		await interaction.deferReply();

        //download the image from attachment.proxyURL
        let attachment = await loadImage(attachment_option.proxyURL, true).catch((err) => {
            console.log(err)
            interaction.reply({ content: "Failed to retrieve image", ephemeral: true });
            return
        })

        if (engine === 'Deepbooru') {
            // load attachment_mask to resize image to the nearest size dividible by 8 then ((export to png data URI)) (use pipline to avoid memory leak)
            const attachment_process = sharp(attachment)

            await attachment_process
                .metadata()
                .then((metadata) => {
                    return attachment_process
                        .resize(Math.ceil(metadata.width / 8) * 8, Math.ceil(metadata.height / 8) * 8)
                        .png()
                        .toBuffer()
                })
                .then(async data => {
                    attachment = "data:image/png;base64," + data.toString('base64')
                })
                .catch((err) => {
                    console.log(err)
                    interaction.reply({ content: "Failed to resize image", ephemeral: true });
                    return
                })
        }
        else {
            // convert buffer to png data URI
            await sharp(attachment)
                .png()
                .toBuffer()
                .then(async data => {
                    attachment = "data:image/png;base64," + data.toString('base64')
                })
                .catch((err) => {
                    console.log(err)
                    interaction.reply({ content: "Failed to convert image to png", ephemeral: true });
                    return
                })
        }

        let server_index = get_worker_server(-1)

		    if (server_index === -1) {
            await interaction.editReply({ content: "No server is available, please try again later"});
            return
        }

        // TODO: add progress ping
        const session_hash = crypt.randomBytes(16).toString('base64');

        const WORKER_ENDPOINT = server_pool[server_index].url
    
        const interrogate_data = [
            0,
            "",
            "",
            attachment,
            "",
            "",
            "",
            null
        ]

        const fn_index_interrogate = engine === 'Deepbooru' ? server_pool[server_index].fn_index_interrogate_deepbooru : server_pool[server_index].fn_index_interrogate

        // make option_init but for axios
        const option_init_axios = {
            data: {
                fn_index: fn_index_interrogate,
                session_hash: session_hash,
                data: interrogate_data
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
                    const duration = final_res_obj.duration
                    const description = final_res_obj.data[0]
                    await interaction.editReply({content: `Description from ${engine}: ${description} (${duration.toFixed(2)}s)`, files: [{attachment: attachment_option.proxyURL, name: attachment.name}]})
                })
                .catch(err => {
                    throw err
                });
        }
        catch (err) {
            console.log(err)
            try {
                await interaction.editReply({content: 'Error while interrogating '})
            }
            catch (err) {
                console.log('cannot send error to discord', err)
            }
        }

        client.cooldowns.set(interaction.user.id, true);

        setTimeout(() => {
            client.cooldowns.delete(interaction.user.id);
        }, 5 * 1000);
	},
};