const { SlashCommandBuilder } = require('@discordjs/builders');
const { controlnet_model_selection, controlnet_preprocessor_selection, model_selection_xl, model_selection, model_selection_flux, model_selection_legacy } = require('../utils/ai_server_config');
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
                .addStringOption(option => 
                    option.setName('hires_checkpoint')
                        .setDescription('Force a cached checkpoint to be used in hires (not all option is cached)')
                        .addChoices(...(model_selection.concat(model_selection_xl).concat(model_selection_flux).filter(x => !model_selection_legacy.map(y => y.value).includes(x.value)))))
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
        const do_preview = interaction.options.getBoolean('do_preview') !== null ? interaction.options.getBoolean('do_preview') : true
        const hires_checkpoint = interaction.options.getString('hires_checkpoint') || null

        //setup the config
        const config = {
            do_preview: do_preview,
            hires_checkpoint: hires_checkpoint
        }

        const config_string = JSON.stringify(config)

		await interaction.reply("Personal generation setting has been set");

        client.usersetting_config.set(interaction.user.id, config_string);

	},
};