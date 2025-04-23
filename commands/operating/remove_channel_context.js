var { operating_mode, context_storage } = require('../../utils/text_gen_store');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { byPassUser } = require('../../config.json');
const { unload_model } = require('../../utils/ollama_request');
const { operatingMode2Config } = require('../../utils/chat_options');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('remove_channel_context')
		.setDescription('Allow bot owner to reset the context of the channel')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to reset the context')
                .setRequired(true)
        )
    ,

	async execute(interaction) {
		// parse the option
        const channel = interaction.options.getChannel('channel');
        await interaction.deferReply();

        // remove context_storage entry of channel.id
        context_storage.delete(channel.id)

        await interaction.editReply(`Channel context has been removed`);
	},
};
