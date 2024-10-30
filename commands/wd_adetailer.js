const { SlashCommandBuilder } = require('@discordjs/builders');
const { controlnet_model_selection, controlnet_preprocessor_selection, model_selection_xl } = require('../utils/ai_server_config');
const { cached_model } = require('../utils/model_change');
const { truncate, try_parse_json_and_return_formated_string } = require('../utils/common_helper');

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
                        .setRequired(false)))
        
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

        await interaction.reply("ADetailer config has been set");
        await interaction.channel.send("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");

        client.adetailer_config.set(interaction.user.id, config_string);
	},
};