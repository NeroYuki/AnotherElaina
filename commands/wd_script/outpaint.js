const { SlashCommandBuilder } = require('@discordjs/builders');
const { truncate, try_parse_json_and_return_formated_string } = require('../../utils/common_helper');
const { normalize_outpaint_config } = require('../../utils/forge_outpaint');


module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_script_outpaint')
        .setDescription('Change your img2img outpaint script settings')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the img2img outpaint script setting'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the img2img outpaint script setting'))  
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Setup the img2img outpaint script setting, will persist through generation')
                .addIntegerOption(option =>
                    option.setName('size')
                        .setDescription('Padding per selected side, snapped up to 8px (0-512, default is 128)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('mask_blur')
                        .setDescription('Mask blur (0-64, default is 32)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('overlap')
                        .setDescription('Repaint this many pixels inside expanded source edges, snapped up to 8px (0-256, default is 64)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('direction')
                        .setDescription('Outpaint direction (default is LRUD, left right up down, case insensitive)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('top')
                        .setDescription('Override selected top padding (0-512, default 0 uses size)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('bottom')
                        .setDescription('Override selected bottom padding (0-512, default 0 uses size)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('left')
                        .setDescription('Override selected left padding (0-512, default 0 uses size)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('right')
                        .setDescription('Override selected right padding (0-512, default 0 uses size)')
                        .setRequired(false))
                )

    ,

	async execute(interaction, client) {

        if (interaction.options.getSubcommand() === 'reset') {
            client.img2img_outpaint_config.delete(interaction.user.id)
            await interaction.reply('img2img outpaint script setting has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.img2img_outpaint_config.get(interaction.user.id)
            if (config_string) {
                await interaction.reply("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");
            }
            else {
                await interaction.reply('No img2img outpaint script setting found');
            }
            return
        }

        let config
        try {
            config = normalize_outpaint_config({
                size: interaction.options.getInteger('size') ?? 128,
                mask_blur: interaction.options.getInteger('mask_blur') ?? 32,
                overlap: interaction.options.getInteger('overlap') ?? 64,
                direction: interaction.options.getString('direction') ?? 'LRUD',
                top: interaction.options.getInteger('top') ?? 0,
                bottom: interaction.options.getInteger('bottom') ?? 0,
                left: interaction.options.getInteger('left') ?? 0,
                right: interaction.options.getInteger('right') ?? 0,
            })
        }
        catch (err) {
            await interaction.reply(err.message)
            return
        }

        const config_string = JSON.stringify(config)

		await interaction.reply("img2img outpaint script setting has been set");
        await interaction.channel.send("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");

        client.img2img_outpaint_config.set(interaction.user.id, config_string);
	},
};
