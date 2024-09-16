const { SlashCommandBuilder } = require('@discordjs/builders');
const { controlnet_model_selection, controlnet_preprocessor_selection, model_selection_xl } = require('../utils/ai_server_config');
const { cached_model } = require('../utils/model_change');
const { clamp, truncate, try_parse_json_and_return_formated_string } = require('../utils/common_helper');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_colorbalance')
        .setDescription('Output a ColorBalance config string based on the settings, also set as your default config')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the color balance config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the current color balance config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Setup the color balance config, will persist through generation')
                .addNumberOption(option =>
                    option.setName('brightness')
                        .setDescription('The brightness value to use for the colorbalance (default is 0, -5 to 5)')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('contrast')
                        .setDescription('The contrast value to use for the colorbalance (default is 0, -5 to 5)')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('saturation')
                        .setDescription('The saturation value to use for the colorbalance (default is 1, 0.25 to 1.75)')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('red')
                        .setDescription('The red value to use for the colorbalance (default is 0, -4 to 4)')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('green')
                        .setDescription('The green value to use for the colorbalance (default is 0, -4 to 4)')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('blue')
                        .setDescription('The blue value to use for the colorbalance (default is 0, -4 to 4)')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('alt_mode')
                        .setDescription('Use the alternate mode for the colorbalance (stronger effect, default is false)')
                        .setRequired(false)))

    ,

	async execute(interaction, client) {

        if (interaction.options.getSubcommand() === 'reset') {
            client.colorbalance_config.delete(interaction.user.id)
            await interaction.reply('ColorBalance config has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.colorbalance_config.get(interaction.user.id)
            if (config_string) {
                await interaction.reply("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 2000) + "\`\`\`");
            }
            else {
                await interaction.reply('No color balance config set');
            }
            return
        }

        //parse the options (bcs is -5 to 5, rgb is -4 to 4)
        const brightness = clamp(interaction.options.getNumber('brightness') || 0, -5, 5)
        const contrast = clamp(interaction.options.getNumber('contrast') || 0, -5, 5)
        const saturation = clamp(interaction.options.getNumber('saturation') || 1, 0.25, 1.75)
        const red = clamp(interaction.options.getNumber('red') || 0, -4, 4)
        const green = clamp(interaction.options.getNumber('green') || 0, -4, 4)
        const blue = clamp(interaction.options.getNumber('blue') || 0, -4, 4)
        const alt_mode = interaction.options.getBoolean('alt_mode') || false

        const config = {
            "brightness": brightness,
            "contrast": contrast,
            "saturation": saturation,
            "red": red,
            "green": green,
            "blue": blue,
            "alt_mode": alt_mode
        }

        const config_string = JSON.stringify(config)

		await interaction.reply(config_string);

        client.colorbalance_config.set(interaction.user.id, config_string);

	},
};