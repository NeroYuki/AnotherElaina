const { SlashCommandBuilder } = require('@discordjs/builders');
const { clamp, truncate, try_parse_json_and_return_formated_string } = require('../../utils/common_helper');


// outpaint_config?.size || 128,       // outpainting mk2
// outpaint_config?.mask_blur || 8,
// // parse direction string "LRUD" (in any order, any case) to array ["left", "right", "up", "down"]
// outpaint_config?.direction || ["left", "right", "up", "down"],
// outpaint_config?.falloff_exp || 1,
// outpaint_config?.color_var || 0.05,

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
                        .setDescription('Output image size (0-256, default is 128)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('mask_blur')
                        .setDescription('Mask blur (0-64, default is 24)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('direction')
                        .setDescription('Outpaint direction (default is LRUD, left right up down, case insensitive)')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('falloff_exp')
                        .setDescription('Falloff exponent (0-4, default is 1)')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('color_var')
                        .setDescription('Color variance (0-1, default is 0.05)')
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

        //parse the options
        const size = clamp(interaction.options.getInteger('size') || 128, 0, 256)
        const mask_blur = clamp(interaction.options.getInteger('mask_blur') || 24, 0, 64)
        const direction = interaction.options.getString('direction') || "LRUD"
        const falloff_exp = clamp(interaction.options.getNumber('falloff_exp') || 1, 0, 4)
        const color_var = clamp(interaction.options.getNumber('color_var') || 0.05, 0, 1)

        // check if direction is valid (contains any of "LRUD" in any order, any case)
        if (!/^[LRUDlrud]+$/.test(direction)) {
            await interaction.reply('Invalid direction string, should contain any of "LRUD" in any order, any case');
            return
        }

        //setup the config
        const config = {
            size: size,
            mask_blur: mask_blur,
            direction: direction.toLowerCase().split("").map((c) => {
                if (c === "l") return "left"
                if (c === "r") return "right"
                if (c === "u") return "up"
                if (c === "d") return "down"
                return null
            }).filter((c) => c !== null),
            falloff_exp: falloff_exp,
            color_var: color_var
        }

        const config_string = JSON.stringify(config)

		await interaction.reply("img2img outpaint script setting has been set");
        await interaction.channel.send("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");

        client.img2img_outpaint_config.set(interaction.user.id, config_string);
	},
};