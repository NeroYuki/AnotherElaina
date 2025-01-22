const { SlashCommandBuilder } = require('@discordjs/builders');
const { truncate, try_parse_json_and_return_formated_string } = require('../utils/common_helper');

function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_latentmod')
		.setDescription('[VERY ADVANCED] Output a Latent Modifier config string and set as your default config.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the Latent Modifier config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the current Latent Modifier config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Setup the Latent Modifier config, will persist through generation')
                .addNumberOption(option =>
                    option.setName('sharpness_multiplier')
                        .setDescription('The sharpness multiplier of the generated prompt')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('sharpness_method')
                        .setDescription('The sharpness method of the generated prompt')
                        .addChoices(
                            { name: 'Anisotropic', value: 'anisotropic' },
                            { name: 'Joint Anisotropic', value: 'joint-anisotropic' },
                            { name: 'Guassian', value: 'guassian' },
                            { name: 'CAS', value: 'cas' }
                        )
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('tonemap_multiplier')
                        .setDescription('The tonemap multiplier of the generated prompt')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('tonemap_method')
                        .setDescription('The tonemap method of the generated prompt')
                        .addChoices(
                            { name: 'Reinhard', value: 'reinhard' },
                            { name: 'Reinhard per Channel', value: 'reinhard_perchannel' },
                            { name: 'Arctangent', value: 'arctan' },
                            { name: 'Quantile', value: 'quantile' },
                            { name: 'Gated', value: 'gated' },
                            { name: 'CFG Mimic', value: 'cfg-mimic' },
                            { name: 'Spatial Norm', value: 'spatial-norm' },
                        )
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('tonemap_percentile')
                        .setDescription('The tonemap percentile of the generated prompt')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('contrast_multiplier')
                        .setDescription('The contrast multiplier of the generated prompt')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('contrast_method')
                        .setDescription('The contrast method of the generated prompt')
                        .addChoices(
                            { name: 'Subtract', value: 'subtract' },
                            { name: 'Subtract Channels', value: 'subtract_channel' },
                            { name: 'Subtract Median', value: 'subtract_median' },
                            { name: 'Sharpen', value: 'sharpen' }
                        )
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('combat_cfg_drift')
                        .setDescription('The combat cfg drift of the generated prompt')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('rescale_cfg_phi')
                        .setDescription('The rescale cfg phi of the generated prompt')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('extra_noise_type')
                        .setDescription('The extra noise type of the generated prompt')
                        .addChoices(
                            { name: 'Guassian', value: 'guassian' },
                            { name: 'Uniform', value: 'uniform' },
                            { name: 'Perlin', value: 'perlin' },
                            { name: 'Pink', value: 'pink' },
                            { name: 'Green', value: 'green' },
                            { name: 'Pyramid', value: 'pyramid' },
                        )
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('extra_noise_method')
                        .setDescription('The extra noise method of the generated prompt')
                        .addChoices(
                            { name: 'Add', value: 'add' },
                            { name: 'Add Scaled', value: 'add_scaled' },
                            { name: "Speckle", value: 'speckle' },
                            { name: "CADs", value: 'cads' },
                            { name: "CADs Rescaled", value: 'cads_rescaled' },
                            { name: "CADs Speckle", value: 'cads_speckle' },
                            { name: "CADs Speckle Rescaled", value: 'cads_speckle_rescaled' },
                        )
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('extra_noise_multiplier')
                        .setDescription('The extra noise multiplier of the generated prompt')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('extra_noise_lowpass')
                        .setDescription('The extra noise lowpass of the generated prompt')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('divisive_norm_size')
                        .setDescription('The divisive norm size of the generated prompt')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('divisive_norm_multiplier')
                        .setDescription('The divisive norm multiplier of the generated prompt')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('spectral_mod_mode')
                        .setDescription('The spectral mod mode of the generated prompt')
                        .addChoices(
                            { name: 'Hard Clamp', value: 'hard_clamp' },
                            { name: 'Soft Clamp', value: 'soft_clamp' }
                        )
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('spectral_mod_percentile')
                        .setDescription('The spectral mod percentile of the generated prompt')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('spectral_mod_multiplier')
                        .setDescription('The spectral mod multiplier of the generated prompt')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('affect_uncond')
                        .setDescription('The affect uncond of the generated prompt')
                        .addChoices(
                            { name: 'None', value: 'None' },
                            { name: 'Sharpness', value: 'Sharpness' },
                        )
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('dyncfg_augment')
                        .setDescription('The dyncfg augment of the generated prompt')
                        .addChoices(
                            { name: 'None', value: 'None' },
                            { name: 'Half-cosine', value: 'dyncfg-halfcosine' },
                            { name: 'Half-cosine Mimic', value: 'dyncfg-halfcosine-mimic' },
                        )
                        .setRequired(false))
        )
        
    ,

	async execute(interaction, client) {

        if (interaction.options.getSubcommand() === 'reset') {
            client.latentmod_config.delete(interaction.user.id)
            await interaction.reply('Latent Modifier config has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.latentmod_config.get(interaction.user.id)
            if (config_string) {
                await interaction.reply("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 2000) + "\`\`\`");
            }
            else {
                await interaction.reply('No Latent Modifier config set');
            }
            return
        }

        //parse the options
        const sharpness_multiplier = clamp(interaction.options.getNumber('sharpness_multiplier') || 0, -100, 100)
        const sharpness_method = interaction.options.getString('sharpness_method') || 'anisotropic'
        const tonemap_multiplier = clamp(interaction.options.getNumber('tonemap_multiplier') || 0, 0, 100)
        const tonemap_method = interaction.options.getString('tonemap_method') || 'reinhard'
        const tonemap_percentile = clamp(interaction.options.getNumber('tonemap_percentile') || 100, 0, 100)
        const contrast_multiplier = clamp(interaction.options.getNumber('contrast_multiplier') || 0, -100, 100)
        const contrast_method = interaction.options.getString('contrast_method') || 'subtract'
        const combat_cfg_drift = clamp(interaction.options.getNumber('combat_cfg_drift') || 0, -10, 10)
        const rescale_cfg_phi = clamp(interaction.options.getNumber('rescale_cfg_phi') || 0, -10, 10)
        const extra_noise_type = interaction.options.getString('extra_noise_type') || 'guassian'
        const extra_noise_method = interaction.options.getString('extra_noise_method') || 'add'
        const extra_noise_multiplier = clamp(interaction.options.getNumber('extra_noise_multiplier') || 0, 0, 100)
        const extra_noise_lowpass = clamp(interaction.options.getNumber('extra_noise_lowpass') || 100, 0, 1000)
        const divisive_norm_size = clamp(interaction.options.getNumber('divisive_norm_size') || 127, 1, 255)
        const divisive_norm_multiplier = clamp(interaction.options.getNumber('divisive_norm_multiplier') || 0, 0, 1)
        const spectral_mod_mode = interaction.options.getString('spectral_mod_mode') || 'hard_clamp'
        const spectral_mod_percentile = clamp(interaction.options.getNumber('spectral_mod_percentile') || 5, 0, 50)
        const spectral_mod_multiplier = clamp(interaction.options.getNumber('spectral_mod_multiplier') || 0, -15, 15)
        const affect_uncond = interaction.options.getString('affect_uncond') || 'None'
        const dyncfg_augment = interaction.options.getString('dyncfg_augment') || 'None'


        let config = {
            "sharpness_multiplier": sharpness_multiplier,
            "sharpness_method": sharpness_method,
            "tonemap_multiplier": tonemap_multiplier,
            "tonemap_method": tonemap_method,
            "tonemap_percentile": tonemap_percentile,
            "contrast_multiplier": contrast_multiplier,
            "contrast_method": contrast_method,
            "combat_cfg_drift": combat_cfg_drift,
            "rescale_cfg_phi": rescale_cfg_phi,
            "extra_noise_type": extra_noise_type,
            "extra_noise_method": extra_noise_method,
            "extra_noise_multiplier": extra_noise_multiplier,
            "extra_noise_lowpass": extra_noise_lowpass,
            "divisive_norm_size": divisive_norm_size,
            "divisive_norm_multiplier": divisive_norm_multiplier,
            "spectral_mod_mode": spectral_mod_mode,
            "spectral_mod_percentile": spectral_mod_percentile,
            "spectral_mod_multiplier": spectral_mod_multiplier,
            "affect_uncond": affect_uncond,
            "dyncfg_augment": dyncfg_augment
        }

        const config_string = JSON.stringify(config)

		await interaction.reply("Latent Modifier config has been set");
        await interaction.channel.send("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");

        client.latentmod_config.set(interaction.user.id, config_string);

	},
};