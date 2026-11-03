const { SlashCommandBuilder } = require('@discordjs/builders');
const { truncate, try_parse_json_and_return_formated_string } = require('../../utils/common_helper');
const { TILED_UPSCALE_METHODS, normalize_upscale_config } = require('../../utils/forge_img2img_scripts');

// Tiled Latent Upscale uses Forge's native Mixture of Diffusers/MultiDiffusion
// latent tiling. The persisted config contains only the controls below; legacy
// Ultimate SD Upscale properties are ignored (with legacy padding mapped to
// tile overlap by normalize_upscale_config).

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_script_upscale')
        .setDescription('Configure Tiled Latent Upscale (img2img) settings')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the Tiled Latent Upscale setting'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the Tiled Latent Upscale setting'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Setup the Tiled Latent Upscale settings, will persist through generation')
                .addNumberOption(option =>
                    option.setName('upscale_multiplier')
                        .setDescription('Output size multiplier (1-4, default is 2; 1 is useful for tiled refinement)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('method')
                        .setDescription('Tiling method (default is "Mixture of Diffusers")')
                        .addChoices(...TILED_UPSCALE_METHODS.map(method => ({ name: method, value: method }))))
                .addIntegerOption(option =>
                    option.setName('tile_width')
                        .setDescription('Tile width in pixels, snapped to 64px (256-2048, default is 1024)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('tile_height')
                        .setDescription('Tile height in pixels, snapped to 64px (256-2048, default is 0 - same as width)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('tile_overlap')
                        .setDescription('Tile overlap in pixels, snapped to 16px (0-min tile, default is 128)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('tile_batch_size')
                        .setDescription('Number of tiles processed per batch (1-8, default is 1)')
                        .setRequired(false))
                )

    ,

	async execute(interaction, client) {

        if (interaction.options.getSubcommand() === 'reset') {
            client.img2img_upscale_config.delete(interaction.user.id)
            await interaction.reply('Tiled Latent Upscale setting has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.img2img_upscale_config.get(interaction.user.id)
            if (config_string) {
                await interaction.reply("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");
            }
            else {
                await interaction.reply('No Tiled Latent Upscale setting found');
            }
            return
        }

        //parse the options without letting 0 fall back to the default
        const option_number = (name, fallback) => {
            const value = interaction.options.getNumber(name)
            return value === null || value === undefined ? fallback : value
        }
        const option_integer = (name, fallback) => {
            const value = interaction.options.getInteger(name)
            return value === null || value === undefined ? fallback : value
        }

        let config
        try {
            config = normalize_upscale_config({
                scale: option_number('upscale_multiplier', 2),
                method: interaction.options.getString('method') || 'Mixture of Diffusers',
                tile_width: option_integer('tile_width', 1024),
                tile_height: option_integer('tile_height', 0),
                tile_overlap: option_integer('tile_overlap', 128),
                tile_batch_size: option_integer('tile_batch_size', 1),
            })
        }
        catch (err) {
            await interaction.reply(err.message);
            return
        }

        const config_string = JSON.stringify(config)

		await interaction.reply("Tiled Latent Upscale setting has been set");
        await interaction.channel.send("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");

        client.img2img_upscale_config.set(interaction.user.id, config_string);

	},
};