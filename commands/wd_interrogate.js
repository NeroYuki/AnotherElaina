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
		.setName('wd_interrogate')
		.setDescription('Use CLIP interrogation to describe a picture you uploaded')
		.addAttachmentOption(option =>
			option.setName('image')
				.setDescription('The image to be described')
				.setRequired(true)),

	async execute(interaction, client) {
        if (client.cooldowns.has(interaction.user.id) && !byPassUser.includes(interaction.user.id)) {
            // cooldown not ended
            interaction.reply({ content: "Please wait for cooldown to end", ephemeral: true });
            return 
        }

        let attachment_option = interaction.options.getAttachment('image')

        //make a temporary reply to not get timeout'd
		await interaction.deferReply();

        //download the image from attachment.proxyURL
        let attachment = await loadImage(attachment_option.proxyURL).catch((err) => {
            console.log(err)
            interaction.reply({ content: "Failed to retrieve image", ephemeral: true });
            return
        })

        let server_index = get_worker_server(force_server_selection)

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
            null,
            null,
            null,
            null
        ]

        // make option_init but for axios
        const option_init_axios = {
            data: {
                fn_index: server_pool[server_index].fn_index_interrogate,
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
                    await interaction.editReply({content: `Description from CLIP: ${description} (${duration.toFixed(2)}s)`})
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