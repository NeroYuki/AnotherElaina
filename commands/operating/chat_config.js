var { operating_mode } = require('../../utils/text_gen_store');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { queryRecord, queryRecordLimit } = require('../../database/database_interaction');
const { byPassUser } = require('../../config.json');

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
                    { name: 'Standard', value: '6bit' }
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

        if (mode == "disabled" || mode == "4bit" || mode == "6bit") {
            operating_mode = mode
            await interaction.editReply(`Operation mode changed to ${mode}`);
        }
        else {
            await interaction.editReply(`Invalid mode`);
        }
	},
};
