const { SlashCommandBuilder } = require('@discordjs/builders');
const { controlnet_model_selection, controlnet_preprocessor_selection } = require('../utils/ai_server_config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_controlnet')
		.setDescription('Output a controlnet config string based on the settings, also set as your default config')
        .addStringOption(option =>
            option.setName('controlnet_model')
                .setDescription('The model to use for the controlnet (default is "T2I-Adapter - OpenPose")')
                .addChoices(...controlnet_model_selection))
        .addStringOption(option =>
            option.setName('controlnet_preprocessor')
                .setDescription('The preprocessor to use for the controlnet (default is "OpenPose")')
                .addChoices(...controlnet_preprocessor_selection))
        // clone the 3 options above for 2 other controlnet
        .addStringOption(option =>
            option.setName('controlnet_model_2')
                .setDescription('The model to use for the controlnet (default is "None")')
                .addChoices(...controlnet_model_selection))
        .addStringOption(option =>
            option.setName('controlnet_preprocessor_2')
                .setDescription('The preprocessor to use for the controlnet (default is "None")')
                .addChoices(...controlnet_preprocessor_selection))
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
                .setDescription('Show the annotation after preprocessing (default is "false")')),

	async execute(interaction, client) {
        const controlnet_model = interaction.options.getString('controlnet_model') || "t2iadapter_openpose_sd14v1 [7e267e5e]";
        const controlnet_preprocessor = interaction.options.getString('controlnet_preprocessor') || "openpose"; 
        const controlnet_model_2 = interaction.options.getString('controlnet_model_2') || "None";
        const controlnet_preprocessor_2 = interaction.options.getString('controlnet_preprocessor_2') || "none";
        const controlnet_model_3 = interaction.options.getString('controlnet_model_3') || "None";
        const controlnet_preprocessor_3 = interaction.options.getString('controlnet_preprocessor_3') || "none";
        const do_preview_annotation = interaction.options.getBoolean('do_preview_annotation') || false;

        const config = {
            control_net: [
                {
                    model: controlnet_model,
                    preprocessor: controlnet_preprocessor,
                },
                {
                    model: controlnet_model_2,
                    preprocessor: controlnet_preprocessor_2,
                },
                {
                    model: controlnet_model_3,
                    preprocessor: controlnet_preprocessor_3,
                },
            ],
            do_preview_annotation,
        }

        const config_string = JSON.stringify(config)

		await interaction.reply(config_string);

        client.controlnet_config.set(interaction.user.id, config_string);
	},
};