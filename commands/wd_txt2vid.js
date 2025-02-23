const { SlashCommandBuilder } = require('@discordjs/builders');
const og_workflow = require('../resources/comfy_txt2vid.json')
const ComfyClient = require('../utils/comfy_client');
const { get_teacache_config_from_prompt } = require('../utils/prompt_analyzer');
const { clamp } = require('../utils/common_helper');

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
                        { name: 'Custom', value: 'custom' }
                    ))
            .addIntegerOption(option =>
                option.setName('custom_width')
                    .setDescription('The width of the video in pixels (max 1280, default 512)')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('custom_height')
                    .setDescription('The height of the video in pixels (max 1280, default 320)')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('custom_length')
                    .setDescription('The length of the video in seconds (max 5 seconds, deafult 3)')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('custom_fps')
                    .setDescription('The frame rate of the video (default 16, recommend max 24)')
                    .setRequired(false))
            .addBooleanOption(option =>
                option.setName('portrait')
                    .setDescription('Generate a portrait video, no effect on custom preset')
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
        const custom_width = clamp(interaction.options.getInteger('custom_width') || 512, 64, 1280);
        const custom_height = clamp(interaction.options.getInteger('custom_height') || 320, 64, 1280);
        const custom_length = clamp(interaction.options.getInteger('custom_length') || 3, 1, 5);
        const custom_fps = clamp(interaction.options.getInteger('custom_fps') || 16, 5, 24);
        const portrait = interaction.options.getBoolean('portrait') || false;
        const no_optimize = interaction.options.getBoolean('no_optimize') || false;
        const do_upscale = interaction.options.getBoolean('do_upscale') || false;
        const do_frame_interpolation = interaction.options.getBoolean('do_frame_interpolation') || false;

        let workflow = JSON.parse(JSON.stringify(og_workflow))

        const forceHighPrecision = prompt.includes("[FORCE_Q6]")
        if (forceHighPrecision) {
            prompt = prompt.replace("[FORCE_Q6]", "")
            workflow["11"]["inputs"]["unet_name"] = "hunyuan-video-t2v-720p-Q6_K.gguf"
        }

        if (preset == 'fast') {
            workflow["12"]["inputs"]["width"] = 512
            workflow["12"]["inputs"]["height"] = 320
            workflow["12"]["inputs"]["length"] = 49
        }
        else if (preset == 'sd') {
            workflow["12"]["inputs"]["width"] = 640
            workflow["12"]["inputs"]["height"] = 480
            workflow["12"]["inputs"]["length"] = 49
        }
        else if (preset == 'long') {
            workflow["12"]["inputs"]["width"] = 512
            workflow["12"]["inputs"]["height"] = 320
            workflow["12"]["inputs"]["length"] = 81
        }
        else {
            // calculate budget
            const budget = custom_width * custom_height * custom_fps * custom_length
            if (budget > 24_000_000) {
                interaction.editReply({ content: "Budget exceeded 24M pixels! My PC cannot handle this xd" });
                return
            }
            else if (budget > 16_000_000) {
                interaction.channel.send({ content: "Budget exceeded 16M pixels, generation may take quite a while" });
            }

            workflow["12"]["inputs"]["width"] = custom_width
            workflow["12"]["inputs"]["height"] = custom_height
            workflow["12"]["inputs"]["length"] = custom_length * custom_fps
            workflow["41"]["inputs"]["frame_rate"] = custom_fps
        }

        if (portrait && preset != 'custom') {
            // swap width and height
            var a = workflow["12"]["inputs"]["width"]
            workflow["12"]["inputs"]["width"] = workflow["12"]["inputs"]["height"]
            workflow["12"]["inputs"]["height"] = a
        }

        if (no_optimize) {
            delete workflow["51"]
            workflow["8"]["inputs"]["model"] = ["45", 0]
            workflow["8"]["inputs"]["steps"] = 30
        }

        if (!do_upscale) {
            delete workflow["55"]
            delete workflow["56"]
            workflow["46"]["inputs"]["frames"] = ["37", 0]
        }

        if (do_frame_interpolation) {
            workflow["47"]["inputs"]["Value"] = 2
            workflow["41"]["inputs"]["frame_rate"] = preset == 'custom' ? custom_fps * 2 : 32
        }

        await interaction.deferReply();

        // check if user want to use teacache
        const teacache_check = get_teacache_config_from_prompt(prompt)
        if (teacache_check.teacache_config) {
            workflow["45"]["inputs"]["rel_l1_thresh"] = teacache_check.teacache_config.threshold
        }
        prompt = teacache_check.prompt

        workflow["15"]["inputs"]["text"] = prompt

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
            interaction.editReply({ content: data.error });
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