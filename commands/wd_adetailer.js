const { SlashCommandBuilder } = require('@discordjs/builders');
const { controlnet_model_selection, controlnet_preprocessor_selection, model_selection_xl } = require('../utils/ai_server_config');
const { cached_model } = require('../utils/model_change');
const { truncate, try_parse_json_and_return_formated_string, clamp } = require('../utils/common_helper');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_adetailer')
		.setDescription('Output an ADetailer config string based on the settings, also set as your default config')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the ADetailer config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the current ADetailer config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Setup the ADetailer config, will persist through generation')
                .addStringOption(option =>
                    option.setName('adetailer_model')
                        .setDescription('The model to use for the adetailer (default is "face_yolov8s.pt")')
                        .addChoices(
                            { name: 'None', value: 'None'},
                            { name: 'YOLO Face v8s', value: 'face_yolov8s.pt' },
                            { name: 'YOLO Hand v8n', value: 'hand_yolov8n.pt' },
                            { name: 'YOLO Eyes (Segment)', value: 'Anzhc Eyes -seg-hd.pt'},
                            { name: 'YOLO Person v8s (Segment)', value: 'person_yolov8n-seg.pt'},
                            { name: 'YOLO World v8x', value: 'yolov8x_world.pt'}
                        )
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('object_to_detect')
                        .setDescription('Detect object listing if using wolrd model (default is "person", COCO class only)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('adetailer_prompt')
                        .setDescription('The prompt to use for the adetailer (default is "" - Same as the original prompt)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('adetailer_neg_prompt')
                        .setDescription('The negative prompt to use for the adetailer (default is "" - Same as the original prompt)')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('adetailer_detection_threshold')
                        .setDescription('The detection threshold for object to apply detailer (default is 0.3)'))
                .addIntegerOption(option =>
                    option.setName('adetailer_mask_blur')
                        .setDescription('The radius of the blur applied to the mask (default is 4)'))
                .addIntegerOption(option =>
                    option.setName('adetailer_mask_padding')
                        .setDescription('The padding size applied to the mask (default is 32)'))
                .addNumberOption(option =>
                    option.setName('adetailer_denoise_strength')
                        .setDescription('The denoise strength for the adetailer (default is 0.4)'))
                .addStringOption(option =>
                    option.setName('adetailer_model_2')
                        .setDescription('The model to use for the 2nd adetailer (default is "face_yolov8s.pt")')
                        .addChoices(
                            { name: 'None', value: 'None'},
                            { name: 'YOLO Face v8s', value: 'face_yolov8s.pt' },
                            { name: 'YOLO Hand v8n', value: 'hand_yolov8n.pt' },
                            { name: 'YOLO Eyes (Segment)', value: 'Anzhc Eyes -seg-hd.pt'},
                            { name: 'YOLO Person v8s (Segment)', value: 'person_yolov8n-seg.pt'},
                            { name: 'YOLO World v8x', value: 'yolov8x_world.pt'}
                        )
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('object_to_detect_2')
                        .setDescription('2nd detect object listing if using wolrd model (default is "person", COCO class only)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('adetailer_prompt_2')
                        .setDescription('The prompt to use for the 2nd adetailer (default is "" - Same as the original prompt)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('adetailer_neg_prompt_2')
                        .setDescription('The negative prompt to use for the 2nd adetailer (default is "" - Same as the original prompt)')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('adetailer_detection_threshold_2')
                        .setDescription('The detection threshold for object to apply the 2nd detailer (default is 0.3)'))
                .addIntegerOption(option =>
                    option.setName('adetailer_mask_blur_2')
                        .setDescription('The radius of the blur applied to the 2nd mask (default is 4)'))
                .addIntegerOption(option =>
                    option.setName('adetailer_mask_padding_2')
                        .setDescription('The padding size applied to the 2nd mask (default is 32)'))
                .addNumberOption(option =>
                    option.setName('adetailer_denoise_strength_2')
                        .setDescription('The denoise strength for the 2nd adetailer (default is 0.4)'))
                .addStringOption(option =>
                    option.setName('adetailer_model_3')
                        .setDescription('The model to use for the 3rd adetailer (default is "face_yolov8s.pt")')
                        .addChoices(
                            { name: 'None', value: 'None'},
                            { name: 'YOLO Face v8s', value: 'face_yolov8s.pt' },
                            { name: 'YOLO Hand v8n', value: 'hand_yolov8n.pt' },
                            { name: 'YOLO Eyes (Segment)', value: 'Anzhc Eyes -seg-hd.pt'},
                            { name: 'YOLO Person v8s (Segment)', value: 'person_yolov8n-seg.pt'},
                            { name: 'YOLO World v8x', value: 'yolov8x_world.pt'}
                        )
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('object_to_detect_3')
                        .setDescription('3rd detect object listing if using wolrd model (default is "person", COCO class only)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('adetailer_prompt_3')
                        .setDescription('The prompt to use for the 3rd adetailer (default is "" - Same as the original prompt)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('adetailer_neg_prompt_3')
                        .setDescription('The negative prompt to use for the 3rd adetailer (default is "" - Same as the original prompt)')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('adetailer_detection_threshold_3')
                        .setDescription('The detection threshold for object to apply the 3rd detailer (default is 0.3)'))
                .addIntegerOption(option =>
                    option.setName('adetailer_mask_blur_3')
                        .setDescription('The radius of the blur applied to the 3rd mask (default is 4)'))
                .addIntegerOption(option =>
                    option.setName('adetailer_mask_padding_3')
                        .setDescription('The padding size applied to the 3rd mask (default is 32)'))
                .addNumberOption(option =>
                    option.setName('adetailer_denoise_strength_3')
                        .setDescription('The denoise strength for the 3rd adetailer (default is 0.4)'))
        )
        
    ,

	async execute(interaction, client) {

        if (interaction.options.getSubcommand() === 'reset') {
            client.adetailer_config.delete(interaction.user.id)
            await interaction.reply('ADetailer config has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.adetailer_config.get(interaction.user.id)
            if (config_string) {
                await interaction.reply("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 2000) + "\`\`\`");
            }
            else {
                await interaction.reply('No ADetailer config set');
            }
            return
        }

        //parse the options
        const adetailer_model = interaction.options.getString('adetailer_model') || 'face_yolov8s.pt'
        const object_to_detect = interaction.options.getString('object_to_detect') || 'person'
        const adetailer_prompt = interaction.options.getString('adetailer_prompt') || ''
        const adetailer_neg_prompt = interaction.options.getString('adetailer_neg_prompt') || ''
        const adetailer_detection_threshold = clamp(interaction.options.getNumber('adetailer_detection_threshold') || 0.3, 0, 1)
        const adetailer_mask_blur = clamp(interaction.options.getInteger('adetailer_mask_blur') || 4, 0, 128)
        const adetailer_mask_padding = clamp(interaction.options.getInteger('adetailer_mask_padding') || 32, 0, 256)
        const adetailer_denoise_strength = clamp(interaction.options.getNumber('adetailer_denoise_strength') || 0.4, 0, 1)

        const adetailer_model_2 = interaction.options.getString('adetailer_model_2') || 'None'
        const object_to_detect_2 = interaction.options.getString('object_to_detect_2') || 'person'
        const adetailer_prompt_2 = interaction.options.getString('adetailer_prompt_2') || ''
        const adetailer_neg_prompt_2 = interaction.options.getString('adetailer_neg_prompt_2') || ''
        const adetailer_detection_threshold_2 = clamp(interaction.options.getNumber('adetailer_detection_threshold_2') || 0.3, 0, 1)
        const adetailer_mask_blur_2 = clamp(interaction.options.getInteger('adetailer_mask_blur_2') || 4, 0, 128)
        const adetailer_mask_padding_2 = clamp(interaction.options.getInteger('adetailer_mask_padding_2') || 32, 0, 256)
        const adetailer_denoise_strength_2 = clamp(interaction.options.getNumber('adetailer_denoise_strength_2') || 0.4, 0, 1)

        const adetailer_model_3 = interaction.options.getString('adetailer_model_3') || 'None'
        const object_to_detect_3 = interaction.options.getString('object_to_detect_3') || 'person'
        const adetailer_prompt_3 = interaction.options.getString('adetailer_prompt_3') || ''
        const adetailer_neg_prompt_3 = interaction.options.getString('adetailer_neg_prompt_3') || ''
        const adetailer_detection_threshold_3 = clamp(interaction.options.getNumber('adetailer_detection_threshold_3') || 0.3, 0, 1)
        const adetailer_mask_blur_3 = clamp(interaction.options.getInteger('adetailer_mask_blur_3') || 4, 0, 128)
        const adetailer_mask_padding_3 = clamp(interaction.options.getInteger('adetailer_mask_padding_3') || 32, 0, 256)
        const adetailer_denoise_strength_3 = clamp(interaction.options.getNumber('adetailer_denoise_strength_3') || 0.4, 0, 1)


        const config = [
            {
                "model": adetailer_model,
                "object_to_detect": object_to_detect,
                "prompt": adetailer_prompt,
                "neg_prompt": adetailer_neg_prompt,
                "detection_threshold": adetailer_detection_threshold,
                "mask_blur": adetailer_mask_blur,
                "mask_padding": adetailer_mask_padding,
                "denoise_strength": adetailer_denoise_strength
            },
            {
                "model": adetailer_model_2,
                "prompt": adetailer_prompt_2,
                "neg_prompt": adetailer_neg_prompt_2,
                "object_to_detect": object_to_detect_2,
                "detection_threshold": adetailer_detection_threshold_2,
                "mask_blur": adetailer_mask_blur_2,
                "mask_padding": adetailer_mask_padding_2,
                "denoise_strength": adetailer_denoise_strength_2
            },
            {
                "model": adetailer_model_3,
                "prompt": adetailer_prompt_3,
                "neg_prompt": adetailer_neg_prompt_3,
                "object_to_detect": object_to_detect_3,
                "detection_threshold": adetailer_detection_threshold_3,
                "mask_blur": adetailer_mask_blur_3,
                "mask_padding": adetailer_mask_padding_3,
                "denoise_strength": adetailer_denoise_strength_3
            }
        ]

        const config_string = JSON.stringify(config)

        await interaction.reply("ADetailer config has been set");
        await interaction.channel.send("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");

        client.adetailer_config.set(interaction.user.id, config_string);
	},
};