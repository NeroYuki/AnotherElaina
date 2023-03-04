const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const http = require('http');
const { server_pool, get_data_body, get_negative_prompt } = require('../utils/ai_server_config.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_inpaint')
		.setDescription('Replies with Pong!')
		.addAttachmentOption(option =>
			option.setName('image')
				.setDescription('The image to be inpainted')
				.setRequired(true))
		.addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt for the AI to generate art from')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('neg_prompt')
                .setDescription('The negative prompt for the AI to avoid generate art from'))
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
                    { name: 'Heun', value: 'Heun' },
                    { name: 'LMS', value: 'LMS' },
                    { name: 'DPM++ 2S a', value: 'DPM++ 2S a' },
                    { name: 'DPM2', value: 'DPM2' },
                    { name: 'DPM++ 2M Karras', value: 'DPM++ 2M Karras' },
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
        .addIntegerOption(option =>
            option.setName('force_server_selection')
                .setDescription('Force the server to use (default is "-1 - Random")')),

	async execute(interaction) {
		// load the option with default value
		const image = interaction.options.getAttachment('image');
		const prompt = interaction.options.getString('prompt');
		const neg_prompt = interaction.options.getString('neg_prompt') || '';
		const width = interaction.options.getInteger('width') || 512;
		const height = interaction.options.getInteger('height') || 512;
		const sampler = interaction.options.getString('sampler') || 'Euler a';
		const cfg_scale = interaction.options.getNumber('cfg_scale') || 7;
		const sampling_step = interaction.options.getInteger('sampling_step') || 20;
		const seed = interaction.options.getString('seed') || '-1';
		const override_neg_prompt = interaction.options.getBoolean('override_neg_prompt') || false;
		const remove_nsfw_restriction = interaction.options.getBoolean('remove_nsfw_restriction') || false;
		const force_server_selection = interaction.options.getInteger('force_server_selection') || -1;

		// random between server index with is_online = true
        let server_index = 0
        if (force_server_selection === -1) {
            // random server
            const online_server_pool = server_pool.filter(server => server.is_online)
            server_index = Math.floor(Math.random() * online_server_pool.length)
        }
        else {
            // force server
            server_index = force_server_selection
        }


		await interaction.reply('Pong!');
	},
};