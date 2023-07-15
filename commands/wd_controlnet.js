const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_controlnet')
		.setDescription('Output a controlnet config string based on the settings, also set as your default config')
        .addStringOption(option =>
            option.setName('controlnet_model')
                .setDescription('The model to use for the controlnet (default is "T2I-Adapter - OpenPose")')
                .addChoices(
                    { name: 'None', value: 'None' },
                    { name: 'T2I-Adapter - Canny', value: 't2iadapter_canny_sd14v1 [80bfd79b]' },
                    { name: 'T2I-Adapter - Color', value: 't2iadapter_color_sd14v1 [8522029d]' },
                    { name: 'T2I-Adapter - Depth', value: 't2iadapter_depth_sd14v1 [fa476002]' },
                    { name: 'T2I-Adapter - OpenPose', value: 't2iadapter_openpose_sd14v1 [7e267e5e]' },
                    { name: 'T2I-Adapter - Seg', value: 't2iadapter_seg_sd14v1 [6387afb5]' },
                    { name: 'T2I-Adapter - Sketch', value: 't2iadapter_sketch_sd14v1 [e5d4b846]' },
                    { name: 'T2I-Adapter - Style', value: 't2iadapter_style_sd14v1 [202e85cc]' },
                    { name: 'ControlNet - OpenPose', value: 'control_v11p_sd15_openpose [cab727d4]'},
                    { name: 'ControlNet - SoftEdge', value: 'control_v11p_sd15_softedge [a8575a2a]'},
                    { name: 'ControlNet - Lineart Anime', value: 'control_v11p_sd15s2_lineart_anime [3825e83e]'},
                ))
        .addStringOption(option =>
            option.setName('controlnet_preprocessor')
                .setDescription('The preprocessor to use for the controlnet (default is "OpenPose")')
                .addChoices(
                    { name: 'None', value: 'none' },
                    { name: 'Canny', value: 'canny' },
                    { name: 'Depth', value: 'depth_midas' },
                    { name: 'Depth (LERes)', value: 'depth_leres++' },
                    { name: 'HED', value: 'softedge_hed' },
                    { name: 'Lineart Anime', value: 'lineart_anime' },
                    { name: 'OpenPose', value: 'openpose' },
                    { name: 'OpenPose (Face)', value: 'openpose_face' },
                    { name: 'OpenPose (Hand)', value: 'openpose_hand' },
                    { name: 'OpenPose (Full)', value: 'openpose_full' },
                    { name: 'Segmentation', value: 'seg_ufade20k' },
                    { name: 'CLIP Vision', value: 't2ia_style_clipvision' },
                    { name: 'Color', value: 't2ia_color_grid' },
                    { name: 'Sketch', value: 't2ia_sketch_pidi' },
                ))
        // clone the 3 options above for 2 other controlnet
        .addStringOption(option =>
            option.setName('controlnet_model_2')
                .setDescription('The model to use for the controlnet (default is "None")')
                .addChoices(
                    { name: 'None', value: 'None' },
                    { name: 'T2I-Adapter - Canny', value: 't2iadapter_canny_sd14v1 [80bfd79b]' },
                    { name: 'T2I-Adapter - Color', value: 't2iadapter_color_sd14v1 [8522029d]' },
                    { name: 'T2I-Adapter - Depth', value: 't2iadapter_depth_sd14v1 [fa476002]' },
                    { name: 'T2I-Adapter - OpenPose', value: 't2iadapter_openpose_sd14v1 [7e267e5e]' },
                    { name: 'T2I-Adapter - Seg', value: 't2iadapter_seg_sd14v1 [6387afb5]' },
                    { name: 'T2I-Adapter - Sketch', value: 't2iadapter_sketch_sd14v1 [e5d4b846]' },
                    { name: 'T2I-Adapter - Style', value: 't2iadapter_style_sd14v1 [202e85cc]' },
                    { name: 'ControlNet - OpenPose', value: 'control_v11p_sd15_openpose [cab727d4]'},
                    { name: 'ControlNet - SoftEdge', value: 'control_v11p_sd15_softedge [a8575a2a]'},
                    { name: 'ControlNet - Lineart Anime', value: 'control_v11p_sd15s2_lineart_anime [3825e83e]'},
                ))
        .addStringOption(option =>
            option.setName('controlnet_preprocessor_2')
                .setDescription('The preprocessor to use for the controlnet (default is "None")')
                .addChoices(
                    { name: 'None', value: 'none' },
                    { name: 'Canny', value: 'canny' },
                    { name: 'Depth', value: 'depth_midas' },
                    { name: 'Depth (LERes)', value: 'depth_leres++' },
                    { name: 'HED', value: 'softedge_hed' },
                    { name: 'Lineart Anime', value: 'lineart_anime' },
                    { name: 'OpenPose', value: 'openpose' },
                    { name: 'OpenPose (Face)', value: 'openpose_face' },
                    { name: 'OpenPose (Hand)', value: 'openpose_hand' },
                    { name: 'OpenPose (Full)', value: 'openpose_full' },
                    { name: 'Segmentation', value: 'seg_ufade20k' },
                    { name: 'CLIP Vision', value: 't2ia_style_clipvision' },
                    { name: 'Color', value: 't2ia_color_grid' },
                    { name: 'Sketch', value: 't2ia_sketch_pidi' },
                ))
        .addStringOption(option =>
            option.setName('controlnet_model_3')
                .setDescription('The model to use for the controlnet (default is "None")')
                .addChoices(
                    { name: 'None', value: 'None' },
                    { name: 'T2I-Adapter - Canny', value: 't2iadapter_canny_sd14v1 [80bfd79b]' },
                    { name: 'T2I-Adapter - Color', value: 't2iadapter_color_sd14v1 [8522029d]' },
                    { name: 'T2I-Adapter - Depth', value: 't2iadapter_depth_sd14v1 [fa476002]' },
                    { name: 'T2I-Adapter - KeyPose', value: 't2iadapter_keypose_sd14v1 [ba1d909a]' },
                    { name: 'T2I-Adapter - OpenPose', value: 't2iadapter_openpose_sd14v1 [7e267e5e]' },
                    { name: 'T2I-Adapter - Seg', value: 't2iadapter_seg_sd14v1 [6387afb5]' },
                    { name: 'T2I-Adapter - Sketch', value: 't2iadapter_sketch_sd14v1 [e5d4b846]' },
                    { name: 'T2I-Adapter - Style', value: 't2iadapter_style_sd14v1 [202e85cc]' },
                    { name: 'ControlNet - HED', value: 'control_hed-fp16 [13fee50b]' },
                ))
        .addStringOption(option =>
            option.setName('controlnet_preprocessor_3')
                .setDescription('The preprocessor to use for the controlnet (default is "None")')
                .addChoices(
                    { name: 'None', value: 'none' },
                    { name: 'Canny', value: 'canny' },
                    { name: 'Depth', value: 'depth' },
                    { name: 'Depth (LERes)', value: 'depth_leres' },
                    { name: 'HED', value: 'hed' },
                    { name: 'OpenPose', value: 'openpose' },
                    { name: 'Segmentation', value: 'segmentation' },
                    { name: 'CLIP Vision', value: 'clip_vision' },
                    { name: 'Color', value: 'color' },
                ))
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