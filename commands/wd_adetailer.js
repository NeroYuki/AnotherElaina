const { SlashCommandBuilder } = require('@discordjs/builders');
const { controlnet_model_selection, controlnet_preprocessor_selection, model_selection_xl } = require('../utils/ai_server_config');
const { cached_model } = require('../utils/model_change');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_adetailer')
		.setDescription('Output an ADetailer config string based on the settings, also set as your default config')
        .addStringOption(option =>
            option.setName('adetailer_model')
                .setDescription('The model to use for the adetailer (default is "face_yolov8s.pt")')
                .addChoices(
                    { name: 'None', value: 'None'},
                    { name: 'YOLO Face v8s', value: 'face_yolov8s.pt' },
                    { name: 'YOLO Hand v8n', value: 'hand_yolov8n.pt' },
                    { name: 'YOLO Person v8s (Segment)', value: 'person_yolov8s-seg.pt'},
                    { name: 'YOLO World v8x', value: 'yolov8x_world.pt'}
                )
                .setRequired(false))
        .addStringOption(option =>
            option.setName('adetailer_prompt')
                .setDescription('The prompt to use for the adetailer (default is "" - Same as the original prompt)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('adetailer_neg_prompt')
                .setDescription('The negative prompt to use for the adetailer (default is "" - Same as the original prompt)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('adetailer_model_2')
                .setDescription('The 2nd model to use for the adetailer (default is "None")')
                .addChoices(
                    { name: 'None', value: 'None'},
                    { name: 'YOLO Face v8s', value: 'face_yolov8s.pt' },
                    { name: 'YOLO Hand v8n', value: 'hand_yolov8n.pt' },
                    { name: 'YOLO Person v8s (Segment)', value: 'person_yolov8s-seg.pt'},
                    { name: 'YOLO World v8x', value: 'yolov8x_world.pt'}
                )
                .setRequired(false))
        .addStringOption(option =>
            option.setName('adetailer_prompt_2')
                .setDescription('The 2nd prompt to use for the adetailer (default is "" - Same as the original prompt)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('adetailer_neg_prompt_2')
                .setDescription('The 2nd negative prompt to use for the adetailer (default is "" - Same as the original prompt)')
                .setRequired(false))
    ,

	async execute(interaction, client) {
        //parse the options
        const adetailer_model = interaction.options.getString('adetailer_model') || 'face_yolov8s.pt'
        const adetailer_prompt = interaction.options.getString('adetailer_prompt') || ''
        const adetailer_neg_prompt = interaction.options.getString('adetailer_neg_prompt') || ''
        const adetailer_model_2 = interaction.options.getString('adetailer_model_2') || 'None'
        const adetailer_prompt_2 = interaction.options.getString('adetailer_prompt_2') || ''
        const adetailer_neg_prompt_2 = interaction.options.getString('adetailer_neg_prompt_2') || ''

        const config = [
            {
                "model": adetailer_model,
                "prompt": adetailer_prompt,
                "neg_prompt": adetailer_neg_prompt
            },
            {
                "model": adetailer_model_2,
                "prompt": adetailer_prompt_2,
                "neg_prompt": adetailer_neg_prompt_2
            }
        ]

        const config_string = JSON.stringify(config)

		await interaction.reply(config_string);

        client.adetailer_config.set(interaction.user.id, config_string);
	},
};