const { SlashCommandBuilder } = require('@discordjs/builders');
const workflow = require('../resources/comfy_txt2vid.json')
const ComfyClient = require('../utils/comfy_client');
const { get_teacache_config_from_prompt } = require('../utils/prompt_analyzer');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_txt2vid')
            .setDescription('Generate a video from a text prompt')
            .addStringOption(option =>
                option.setName('prompt')
                    .setDescription('The text prompt to generate the video')
                    .setRequired(true))
            .addStringOption(option => 
                option.setName('preset')
                    .setDescription('The preset to use for the generation')
                    .addChoices(
                        { name: '512x320 - 3 secs', value: 'fast' },
                        { name: '640x480 - 3 secs', value: 'sd' },
                        { name: '512x320 - 5 secs', value: 'long' },
                    ))
            .addBooleanOption(option =>
                option.setName('portrait')
                    .setDescription('Generate a portrait video')
                    .setRequired(false))
            .addBooleanOption(option =>
                option.setName('no_optimize')
                    .setDescription('Do not use fast video LoRA, generation time will be doubled')
                    .setRequired(false))
            .addBooleanOption(option =>
                option.setName('do_upscale')
                    .setDescription('Upscale the video to quadruple the resolution')
                    .setRequired(false))
            .addBooleanOption(option =>
                option.setName('do_frame_interpolation')
                    .setDescription('Use frame interpolation to double the frame rate')
                    .setRequired(false))

    ,

	async execute(interaction, client) {
        let prompt = interaction.options.getString('prompt');
        const preset = interaction.options.getString('preset') || 'fast';
        const portrait = interaction.options.getBoolean('portrait') || false;
        const no_optimize = interaction.options.getBoolean('no_optimize') || false;
        const do_upscale = interaction.options.getBoolean('do_upscale') || false;
        const do_frame_interpolation = interaction.options.getBoolean('do_frame_interpolation') || false;

        workflow["15"]["inputs"]["text"] = prompt

        if (preset == 'fast') {
            workflow["12"]["inputs"]["width"] = 512
            workflow["12"]["inputs"]["height"] = 320
            workflow["12"]["inputs"]["length"] = 49
        }
        if (preset == 'sd') {
            workflow["12"]["inputs"]["width"] = 640
            workflow["12"]["inputs"]["height"] = 480
            workflow["12"]["inputs"]["length"] = 49
        }
        if (preset == 'long') {
            workflow["12"]["inputs"]["width"] = 512
            workflow["12"]["inputs"]["height"] = 320
            workflow["12"]["inputs"]["length"] = 81
        }

        if (portrait) {
            // swap width and height
            var a = workflow["12"]["inputs"]["width"]
            workflow["12"]["inputs"]["width"] = workflow["12"]["inputs"]["height"]
            workflow["12"]["inputs"]["height"] = a
        }

        if (no_optimize) {
            delete workflow["51"]
            workflow["8"]["inputs"]["model"] = ["45", 0]
        }

        if (!do_upscale) {
            delete workflow["55"]
            delete workflow["56"]
            workflow["46"]["inputs"]["frames"] = ["37", 0]
        }

        if (!do_frame_interpolation) {
            workflow["47"]["inputs"]["Value"] = 1
        }

        await interaction.deferReply();

        // check if user want to use teacache
        const teacache_check = get_teacache_config_from_prompt(prompt)
        if (teacache_check.teacache_config) {
            workflow["45"]["inputs"]["rel_l1_thresh"] = teacache_check.teacache_config.threshold
        }
        prompt = teacache_check.prompt

        ComfyClient.sendPrompt(workflow, (data) => {
            if (data.node !== null) interaction.editReply({ content: "Processing: " + workflow[data.node]["_meta"]["title"] });
        }, (data) => {
            console.log('received success')
            const filename = data.output.gifs[0].filename

            // fetch video from comfyUI
            ComfyClient.getImage(filename, '', '', /*only_filename*/ true).then(async (arraybuffer) => {
                // convert arraybuffer to buffer
                const buffer = Buffer.from(arraybuffer)

                await interaction.editReply({ content: "Generation Success", files: [{ attachment: buffer, name: filename }] });
            }).catch((err) => {
                console.log("Failed to retrieve video", err)
                interaction.editReply({ content: "Failed to retrieve video" });
            }).finally(() => {
                ComfyClient.freeMemory(true)
            })

        }, (data) => {
            console.log('received error')
            interaction.editReply(data.error);
            ComfyClient.freeMemory(true)
        }, (data) => {
            console.log('received progress')

            // skip video combine node update progress (too spammy)
            if (workflow[data.node]["_meta"]["title"] === "Video Combine 🎥🅥🅗🅢") return

            interaction.editReply({ content: "Processing: " + workflow[data.node]["_meta"]["title"] + ` (${data.value}/${data.max})` });
        });

        // await interaction.editReply('This command is not implemented yet');
	},
};