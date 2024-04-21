var { operating_mode } = require('../../utils/text_gen_store');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { byPassUser } = require('../../config.json');
const { unload_model } = require('../../utils/ollama_request');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('chat_config')
		.setDescription('Allow bot owner to change the operation mode of the chatbot')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('The operation mode to change to')
                .setRequired(true)
                .addChoices(
                    { name: 'Disabled', value: 'disabled' },
                    { name: 'Saving', value: '4bit' },
                    { name: 'Standard', value: '6bit' },
                    { name: 'Uncensored', value: 'uncensored'}
                ))
    ,

	async execute(interaction) {
		// parse the option
        const mode = interaction.options.getString('mode');

        await interaction.deferReply();

        if (interaction.user.id != byPassUser) {
            await interaction.editReply("You are not authorized to use this command");
            return;
        }

        if (mode == "disabled" || mode == "4bit" || mode == "6bit" || mode == "uncensored") {
            globalThis.operating_mode = mode;
            if (mode !== "4bit") {
                unload_model("test4b");
            }
            if (mode !== "6bit") {
                unload_model("test");
            }
            if (mode !== "uncensored") {
                unload_model("test_uncen")
            }
            await interaction.editReply(`Operation mode changed to ${mode}`);
        }
        else {
            await interaction.editReply(`Invalid mode`);
        }
	},
};
