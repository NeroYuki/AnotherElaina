const { SlashCommandBuilder } = require('@discordjs/builders');
const { controlnet_model_selection, controlnet_preprocessor_selection, model_selection_xl } = require('../utils/ai_server_config');
const { cached_model } = require('../utils/model_change');
const { clamp, truncate, try_parse_json_and_return_formated_string } = require('../utils/common_helper');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_setting')
        .setDescription('Change your personal generation settings, more to come, i guess')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the personal generation setting'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the personal generation setting'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Setup the personal generation setting, will persist through generation')
                .addBooleanOption(option =>
                    option.setName('do_preview')
                        .setDescription('Do preview during image generation (default is false, will be slightly slower if true)')
                        .setRequired(false))
                )

    ,

	async execute(interaction, client) {

        if (interaction.options.getSubcommand() === 'reset') {
            client.usersetting_config.delete(interaction.user.id)
            await interaction.reply('Personal generation setting has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.usersetting_config.get(interaction.user.id)
            if (config_string) {
                await interaction.reply("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");
            }
            else {
                await interaction.reply('No personal generation setting found');
            }
            return
        }

        //parse the options
        const do_preview = interaction.options.getBoolean('do_preview') || false

        //setup the config
        const config = {
            do_preview: do_preview
        }

        const config_string = JSON.stringify(config)

		await interaction.reply("Personal generation setting has been set");

        client.usersetting_config.set(interaction.user.id, config_string);

	},
};