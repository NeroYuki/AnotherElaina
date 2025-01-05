const { SlashCommandBuilder } = require('@discordjs/builders');
const { do_heartbeat } = require('../utils/ai_server_config');
const ComfyClient = require('../utils/comfy_client');
const ws = require('ws');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Replies with Pong!'),

	async execute(interaction) {
		do_heartbeat();
		if (ComfyClient.client?.readyState !== ws.OPEN) {
			ComfyClient.init();
		}
		await interaction.reply('Pong! Attempting to do connect to the AI server...');
	},
};