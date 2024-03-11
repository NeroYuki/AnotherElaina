const { SlashCommandBuilder } = require('@discordjs/builders');
const { do_heartbeat } = require('../utils/ai_server_config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Replies with Pong!'),

	async execute(interaction) {
		do_heartbeat();
		await interaction.reply('Pong! Attempting to do connect to the AI server...');
	},
};