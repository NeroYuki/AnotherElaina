const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const { server_pool, get_prompt, get_negative_prompt, get_worker_server, get_data_body_img2img, load_lora_from_prompt, model_name_hash_mapping } = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const fetch = require('node-fetch');


// ["362dae27f8", "RefSlave v2"],
// ["bd518b9aee", "CetusMix v3 (Coda)"],
// ["fbcf965a62", "Anything v4.5"],
// ["a074b8864e", "Counterfeint v2.5"],
// ["e03274b1e7", "MeinaMix v7"],
// ["d01a68ae76", "PastelMix v2.1"],
// ["4b118b2d1b", "Yozora v1"],

let isReady = true

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_modelchange')
		.setDescription('Change current model the AI is using to generate image')
        .addStringOption(option => 
            option.setName('checkpoint')
                .setDescription('The checkpoint to be used')
                .addChoices(
					{ name: 'Anything v4.5', value: 'anything.ckpt [fbcf965a62]' },
                    { name: 'Pastel Mix v2.1', value: 'pastelmix.safetensors [d01a68ae76]' },
                    { name: 'Counterfeit v2.5', value: 'counterfeit.safetensors [a074b8864e]' },
                    { name: 'MeinaMix v7', value: 'meinamix.safetensors [e03274b1e7]' },
                    { name: 'CetusMix v3 (Coda)', value: 'cetusmix.safetensors [bd518b9aee]' },
                    { name: 'RefSlave v2', value: 'refslave.safetensors [362dae27f8]' },
                    { name: 'Anything v5', value: 'anythingv5.safetensors [7f96a1a9ca]' },
                    { name: 'Yozora v1', value: 'yozora.safetensors [4b118b2d1b]' },
                    { name: 'Anime-like 2D v2', value: 'animelikev2.safetensors [4d957c560b]' },
                    { name: 'DarkSushiMix', value: 'darksushi.safetensors [cca17b08da]' },
                    { name: 'CetusMix (Coda v2)', value: 'cetusmix_coda2.safetensors [68c0a27380]' },
                    { name: 'Momokos v1', value: 'momokos_v10.safetensors [d77922554c]' },
				)
                .setRequired(true))
    ,

	async execute(interaction) {
        const checkpoint = interaction.options.getString('checkpoint')

        if(!isReady) {
            await interaction.reply('There is a request not long ago, please let people use it first lol')
            return
        }

        //make a temporary reply to not get timeout'd
		await interaction.deferReply();

        const session_hash = crypt.randomBytes(16).toString('base64');

        const option_init_axios = {
            data: {
                fn_index: 673,
                session_hash: session_hash,
                data: [
                    checkpoint
                ]
            },
            config: {
                timeout: 900000
            }
        }

        await interaction.editReply(`Changing model to ${checkpoint}... , please wait`)

        await axios.post(`http://192.168.196.142:7860/run/predict/`, option_init_axios.data, option_init_axios.config)
            .then(async (res) => {
                if(res.data) {
                    await interaction.editReply('Model changed successfully to ' + checkpoint)
                    isReady = false
                } else {
                    await interaction.editReply('Model change failed')
                }
            })
            .catch(async (err) => {
                console.log(err)
                await interaction.editReply('Model change failed')
            })

        // set isReady to true after 30 minutes
        setTimeout(() => {
            isReady = true
        }, 1800000)
	},
};
