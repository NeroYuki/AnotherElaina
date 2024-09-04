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
                    { name: 'Uncensored', value: 'uncensored'},
                    { name: 'Standard Vision', value: 'vision'}
                ))
        .addBooleanOption(option =>
            option.setName('stream')
                .setDescription('Stream the response by constantly edit the message')
                .setRequired(false)
        )
    ,

	async execute(interaction) {
		// parse the option
        const mode = interaction.options.getString('mode');
        const is_stream = interaction.options.getBoolean('stream') || false;

        await interaction.deferReply();

        if (interaction.user.id != byPassUser) {
            await interaction.editReply("You are not authorized to use this command");
            return;
        }

        if (mode == "disabled" || mode == "4bit" || mode == "6bit" || mode == "uncensored" || mode == "vision") {

            if (globalThis.operating_mode === "4bit") {
                unload_model("test");
            }
            if (globalThis.operating_mode === "6bit") {
                unload_model("test_poppy_gpu");
            }
            if (globalThis.operating_mode === "uncensored") {
                unload_model("test_uncen")
            }
            if (globalThis.operating_mode === "vision") {
                unload_model("test_vision")
            }
            globalThis.operating_mode = mode;
            globalThis.stream_response = is_stream;
            await interaction.editReply(`Operation mode changed to ${mode}`);
        }
        else {
            await interaction.editReply(`Invalid mode`);
        }
	},
};
