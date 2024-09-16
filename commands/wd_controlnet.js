const { SlashCommandBuilder } = require('@discordjs/builders');
const { controlnet_model_selection, controlnet_preprocessor_selection, model_selection_xl } = require('../utils/ai_server_config');
const { cached_model } = require('../utils/model_change');
const { truncate, try_parse_json_and_return_formated_string } = require('../utils/common_helper');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_controlnet')
		.setDescription('Output a controlnet config string based on the settings, also set as your default config')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the controlnet config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the current ControlNet config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Setup the controlnet config, will persist through generation')
                .addStringOption(option =>
                    option.setName('controlnet_model')
                        .setDescription('The model to use for the controlnet (default is "T2I-Adapter - OpenPose")')
                        .addChoices(...controlnet_model_selection))
                .addStringOption(option =>
                    option.setName('controlnet_preprocessor')
                        .setDescription('The preprocessor to use for the controlnet (default is "OpenPose")')
                        .addChoices(...controlnet_preprocessor_selection))
                .addNumberOption(option =>
                    option.setName('controlnet_weight')
                        .setDescription('The weight of the controlnet (default is 1)'))
                .addNumberOption(option =>
                    option.setName('controlnet_resolution')
                        .setDescription('The resolution preprocessor to use for the controlnet (default is 512)'))
                .addStringOption(option =>
                    option.setName('controlnet_mode')
                        .setDescription('The mode of the controlnet (default is "Balanced")')
                        .addChoices(
                            { name: 'Balanced', value: 'Balanced' },
                            { name: 'Prompt', value: 'My prompt is more important' },
                            { name: 'ControlNet', value: 'ControlNet is more important' }))
                .addNumberOption(option =>
                    option.setName('controlnet_threshold_a')
                        .setDescription('The threshold of the controlnet (default is 100)'))
                .addNumberOption(option =>
                    option.setName('controlnet_threshold_b')
                        .setDescription('The threshold of the controlnet (default is 200)'))
                // clone the 3 options above for 2 other controlnet
                .addStringOption(option =>
                    option.setName('controlnet_model_2')
                        .setDescription('The model to use for the controlnet (default is "None")')
                        .addChoices(...controlnet_model_selection))
                .addStringOption(option =>
                    option.setName('controlnet_preprocessor_2')
                        .setDescription('The preprocessor to use for the controlnet (default is "None")')
                        .addChoices(...controlnet_preprocessor_selection))
                .addNumberOption(option =>
                    option.setName('controlnet_weight_2')
                        .setDescription('The weight of the controlnet (default is 1)'))
                .addNumberOption(option =>
                    option.setName('controlnet_resolution_2')
                        .setDescription('The resolution preprocessor to use for the controlnet (default is 512)'))
                .addStringOption(option =>
                    option.setName('controlnet_mode_2')
                        .setDescription('The mode of the controlnet (default is "Balanced")')
                        .addChoices(
                            { name: 'Balanced', value: 'Balanced' },
                            { name: 'Prompt', value: 'My prompt is more important' },
                            { name: 'ControlNet', value: 'ControlNet is more important' }))
                .addNumberOption(option =>
                    option.setName('controlnet_threshold_a_2')
                        .setDescription('The threshold of the controlnet (default is 100)'))
                .addNumberOption(option =>
                    option.setName('controlnet_threshold_b_2')
                        .setDescription('The threshold of the controlnet (default is 200)'))
                .addStringOption(option =>
                    option.setName('controlnet_model_3')
                        .setDescription('The model to use for the controlnet (default is "None")')
                        .addChoices(...controlnet_model_selection))
                .addStringOption(option =>
                    option.setName('controlnet_preprocessor_3')
                        .setDescription('The preprocessor to use for the controlnet (default is "None")')
                        .addChoices(...controlnet_preprocessor_selection))
                .addBooleanOption(option => 
                    option.setName('do_preview_annotation')
                        .setDescription('Show the annotation after preprocessing (default is "false")'))
                .addNumberOption(option =>
                    option.setName('controlnet_weight_3')
                        .setDescription('The weight of the controlnet (default is 1)'))
                .addNumberOption(option =>
                    option.setName('controlnet_resolution_3')
                        .setDescription('The resolution preprocessor to use for the controlnet (default is 512)'))
                .addStringOption(option =>
                    option.setName('controlnet_mode_3')
                        .setDescription('The mode of the controlnet (default is "Balanced")')
                        .addChoices(
                            { name: 'Balanced', value: 'Balanced' },
                            { name: 'Prompt', value: 'My prompt is more important' },
                            { name: 'ControlNet', value: 'ControlNet is more important' }))
                .addNumberOption(option =>
                    option.setName('controlnet_threshold_a_3')
                        .setDescription('The threshold of the controlnet (default is 100)'))
                .addNumberOption(option =>
                    option.setName('controlnet_threshold_b_3')
                        .setDescription('The threshold of the controlnet (default is 200)')))
    ,

	async execute(interaction, client) {

        if (interaction.options.getSubcommand() === 'reset') {
            client.controlnet_config.delete(interaction.user.id)
            await interaction.reply('ControlNet config has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.controlnet_config.get(interaction.user.id)
            if (config_string) {
                await interaction.reply("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 2000) + "\`\`\`");
            }
            else {
                await interaction.reply('No ControlNet config set');
            }
            return
        }

        let controlnet_model = interaction.options.getString('controlnet_model') || "t2iadapter_openpose_sd14v1 [7e267e5e]";
        const controlnet_preprocessor = interaction.options.getString('controlnet_preprocessor') || "openpose"; 
        const controlnet_weight = interaction.options.getNumber('controlnet_weight') || 1;
        const controlnet_resolution = interaction.options.getNumber('controlnet_resolution') || 512;
        const controlnet_mode = interaction.options.getString('controlnet_mode') || "Balanced";
        const controlnet_threshold_a = interaction.options.getNumber('controlnet_threshold_a') || 100;
        const controlnet_threshold_b = interaction.options.getNumber('controlnet_threshold_b') || 200;
        let controlnet_model_2 = interaction.options.getString('controlnet_model_2') || "None";
        const controlnet_preprocessor_2 = interaction.options.getString('controlnet_preprocessor_2') || "None";
        const controlnet_weight_2 = interaction.options.getNumber('controlnet_weight_2') || 1;
        const controlnet_resolution_2 = interaction.options.getNumber('controlnet_resolution_2') || 512;
        const controlnet_mode_2 = interaction.options.getString('controlnet_mode_2') || "Balanced";
        const controlnet_threshold_a_2 = interaction.options.getNumber('controlnet_threshold_a_2') || 100;
        const controlnet_threshold_b_2 = interaction.options.getNumber('controlnet_threshold_b_2') || 200;
        let controlnet_model_3 = interaction.options.getString('controlnet_model_3') || "None";
        const controlnet_preprocessor_3 = interaction.options.getString('controlnet_preprocessor_3') || "None";
        const controlnet_weight_3 = interaction.options.getNumber('controlnet_weight_3') || 1;
        const controlnet_resolution_3 = interaction.options.getNumber('controlnet_resolution_3') || 512;
        const controlnet_mode_3 = interaction.options.getString('controlnet_mode_3') || "Balanced";
        const controlnet_threshold_a_3 = interaction.options.getNumber('controlnet_threshold_a_3') || 100;
        const controlnet_threshold_b_3 = interaction.options.getNumber('controlnet_threshold_b_3') || 200;
        const do_preview_annotation = interaction.options.getBoolean('do_preview_annotation') || false;

        const config = {
            control_net: [
                {
                    model: controlnet_model,
                    preprocessor: controlnet_preprocessor,
                    weight: controlnet_weight,
                    mode: controlnet_mode,
                    resolution: controlnet_resolution,
                    t_a: controlnet_threshold_a,
                    t_b: controlnet_threshold_b,
                },
                {
                    model: controlnet_model_2,
                    preprocessor: controlnet_preprocessor_2,
                    weight: controlnet_weight_2,
                    mode: controlnet_mode_2,
                    resolution: controlnet_resolution_2,
                    t_a: controlnet_threshold_a_2,
                    t_b: controlnet_threshold_b_2,
                },
                {
                    model: controlnet_model_3,
                    preprocessor: controlnet_preprocessor_3,
                    weight: controlnet_weight_3,
                    mode: controlnet_mode_3,
                    resolution: controlnet_resolution_3,
                    t_a: controlnet_threshold_a_3,
                    t_b: controlnet_threshold_b_3,
                },
            ],
            do_preview_annotation,
        }

        const config_string = JSON.stringify(config)

		await interaction.reply(config_string);

        client.controlnet_config.set(interaction.user.id, config_string);
	},
};