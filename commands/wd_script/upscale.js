const { SlashCommandBuilder } = require('@discordjs/builders');
const { clamp, truncate, try_parse_json_and_return_formated_string } = require('../../utils/common_helper');
const { upscaler_selection } = require('../../utils/ai_server_config');

// upscale_config?.tile_width || 1024,       // upscale
// upscale_config?.tile_height || 0,
// upscale_config?.mask_blur || 16,
// upscale_config?.padding || 32,
// upscale_config?.seam_fix_width || 64,
// upscale_config?.seam_fix_denoise || 0.35,
// upscale_config?.seam_fix_padding || 32,
// upscale_config?.upscaler || "R-ESRGAN 4x+",
// true,
// upscale_config?.tile_pattern || "Linear",
// false,
// upscale_config?.seam_fix_mask_blur || 8,
// upscale_config.seam_fix || "None", 
// "Scale from image size",
// 2048,
// 2048,
// upscale_config?.scale || 2,

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_script_upscale')
        .setDescription('Change your img2img upscale script settings')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the img2img upscale script setting'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the img2img upscale script setting'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Setup the img2img upscale script setting, will persist through generation')
                .addNumberOption(option =>
                    option.setName('upscale_multiplier')
                        .setDescription('Upscale multiplier (1-4, default is 2)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('upscaler')
                        .setDescription('Upscaler (default is "R-ESRGAN 4x+")')
                        .addChoices(...upscaler_selection))
                .addIntegerOption(option =>
                    option.setName('tile_width')
                        .setDescription('Tile width (0-2048, default is 1024)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('tile_height')
                        .setDescription('Tile height (0-2048, default is 0 - same as width)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('mask_blur')
                        .setDescription('Mask blur (0-64, default is 16)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('padding')
                        .setDescription('Padding (0-512, default is 32)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('tile_pattern')
                        .setDescription('Tile pattern (default is "Linear")')
                        .addChoices(
                            { name: 'Linear', value: 'Linear'},
                            { name: 'Chess', value: 'Chess' },
                            { name: 'None', value: 'None' },
                        ))
                .addStringOption(option =>
                    option.setName('seam_fix')
                        .setDescription('Seam fix (default is "None")')
                        .addChoices(
                            { name: 'None', value: 'None'},
                            { name: 'Band pass', value: 'Band pass' },
                            { name: 'Half tile offset pass', value: 'Half tile offset pass' },
                            { name: 'Half tile offset pass + intersections', value: 'Half tile offset pass + intersections' },
                        ))
                .addIntegerOption(option =>
                    option.setName('seam_fix_width')
                        .setDescription('Seam fix width (0-128, default is 64)')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('seam_fix_denoise')
                        .setDescription('Seam fix denoise (0-1, default is 0.35)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('seam_fix_padding')
                        .setDescription('Seam fix padding (0-512, default is 32)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('seam_fix_mask_blur')
                        .setDescription('Seam fix mask blur (0-64, default is 8)')
                        .setRequired(false))
                )

    ,

	async execute(interaction, client) {

        if (interaction.options.getSubcommand() === 'reset') {
            client.img2img_upscale_config.delete(interaction.user.id)
            await interaction.reply('img2img upscale script setting has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.img2img_upscale_config.get(interaction.user.id)
            if (config_string) {
                await interaction.reply("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");
            }
            else {
                await interaction.reply('No img2img upscale script setting found');
            }
            return
        }

        //parse the options
        const upscale_multiplier = clamp(interaction.options.getNumber('upscale_multiplier') || 2, 1, 4)
        const upscaler = interaction.options.getString('upscaler') || "R-ESRGAN 4x+"
        const tile_width = clamp(interaction.options.getInteger('tile_width') || 1024, 0, 2048)
        const tile_height = clamp(interaction.options.getInteger('tile_height') || 0, 0, 2048)
        const mask_blur = clamp(interaction.options.getInteger('mask_blur') || 16, 0, 64)
        const padding = clamp(interaction.options.getInteger('padding') || 32, 0, 512)
        const tile_pattern = interaction.options.getString('tile_pattern') || "Linear"
        const seam_fix = interaction.options.getString('seam_fix') || "None"
        const seam_fix_width = clamp(interaction.options.getInteger('seam_fix_width') || 64, 0, 128)
        const seam_fix_denoise = clamp(interaction.options.getNumber('seam_fix_denoise') || 0.35, 0, 1)
        const seam_fix_padding = clamp(interaction.options.getInteger('seam_fix_padding') || 32, 0, 512)
        const seam_fix_mask_blur = clamp(interaction.options.getInteger('seam_fix_mask_blur') || 8, 0, 64)

        const config = {
            scale: upscale_multiplier,
            upscaler: upscaler,
            tile_width: tile_width,
            tile_height: tile_height,
            mask_blur: mask_blur,
            padding: padding,
            tile_pattern: tile_pattern,
            seam_fix: seam_fix,
            seam_fix_width: seam_fix_width,
            seam_fix_denoise: seam_fix_denoise,
            seam_fix_padding: seam_fix_padding,
            seam_fix_mask_blur: seam_fix_mask_blur
        }

        const config_string = JSON.stringify(config)

		await interaction.reply("img2img upscale script setting has been set");
        await interaction.channel.send("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");

        client.img2img_upscale_config.set(interaction.user.id, config_string);

	},
};