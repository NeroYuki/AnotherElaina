const { SlashCommandBuilder } = require('@discordjs/builders');
const { text_completion_stream } = require('../../utils/ollama_request');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('test_api')
		.setDescription('use to test api'),

	async execute(interaction) {

        await interaction.reply({ content: "Testing API", ephemeral: true });
	},
};