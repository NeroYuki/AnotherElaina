const { SlashCommandBuilder } = require('@discordjs/builders');
const og_workflow = require('../resources/comfy_txt2vid.json')
const wan_workflow = require('../resources/wan_txt2vid.json')
const sf_workflow = require('../resources/wan_sf_txt2vid.json')
const ComfyClient = require('../utils/comfy_client');
const { get_teacache_config_from_prompt } = require('../utils/prompt_analyzer');
const { clamp } = require('../utils/common_helper');
const { sampler_selection, scheduler_selection, sampler_to_comfy_name_mapping, scheduler_to_comfy_name_mapping } = require('../utils/ai_server_config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_txt2vid')
            .setDescription('Generate a video from a text prompt')
            .addStringOption(option =>
                option.setName('prompt')
                    .setDescription('The text prompt to generate the video')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('neg_prompt')
                    .setDescription('The negative text prompt to generate the video')
                    .setRequired(false))
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
            .addNumberOption(option =>
                option.setName('seed')
                    .setDescription('The seed for the video generation (default is random, 0 to disable)')
                    .setRequired(false))
            .addBooleanOption(option =>
                option.setName('no_optimize')
                    .setDescription('Do not use fast video LoRA, generation time will be doubled')
                    .setRequired(false))
            // .addBooleanOption(option =>
            //     option.setName('do_upscale')
            //         .setDescription('Upscale the video to quadruple the resolution')
            //         .setRequired(false))
            // .addBooleanOption(option =>
            //     option.setName('do_frame_interpolation')
            //         .setDescription('Use frame interpolation to double the frame rate')
            //         .setRequired(false))
            // .addStringOption(option => 
            //     option.setName('sampler')
            //         .setDescription('The sampling method for the AI to generate art from (default is "Euler")')
            //         .addChoices(...sampler_selection))
            // .addStringOption(option => 
            //     option.setName('scheduler')
            //         .setDescription('The scheduling method for the AI to generate art from (default is "Normal")')
            //         .addChoices(...scheduler_selection))
            .addNumberOption(option => 
                option.setName('cfg_scale')
                    .setDescription('Lower value = more creative freedom (default is 1)'))
            .addIntegerOption(option =>
                option.setName('shift')
                    .setDescription('The shift rate for the video generation (default 5, higher shift = more motion)')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('model')
                    .setDescription('The model to use for the generation')
                    .addChoices(
                        { name: 'Hunyuan T2V Q5_K_M - Legacy', value: 'hunyuan-video-t2v-720p-Q5_K_M.gguf' },
                        { name: 'Wan v2.1 T2V Q8', value: 'wan2.1-t2v-14b-Q8_0.gguf' },
                        { name: 'Wan v2.1 T2V Q4_K_S', value: 'wan2.1-t2v-14b-Q4_K_S.gguf' },
                        { name: 'AniWan v2.1 T2V Q4_K_S', value: 'aniWan2114BFp8E4m3fn_t2v14BGGUFQ4KS.gguf' },
                        { name: 'Wan v2.1 T2V Self-forcing - Fast', value: 'self_forcing_dmd.pt' }
                    ))

    ,

    get_video_dimension(preset, custom_width, custom_height, custom_length, custom_fps, portrait) {
        let width = 512;
        let height = 320;
        let length = 51;
        let fps = 16;

        if (preset === 'fast') {
            width = 512;
            height = 320;
            length = 3 * 16; // 3 seconds
            fps = 16;
        } else if (preset === 'sd') {
            width = 640;
            height = 480;
            length = 3 * 16; // 3 seconds
            fps = 16;
        } else if (preset === 'long') {
            width = 512;
            height = 320;
            length = 5 * 16; // 5 seconds
            fps = 16;
        } else if (preset === 'custom') {
            width = custom_width || width;
            height = custom_height || height;
            fps = custom_fps || fps;
            length = custom_length * fps || length; // custom length in seconds
        }

        if (portrait) {
            // swap width and height
            [width, height] = [height, width];
        }

        return { width, height, length, fps };
    },

	async execute(interaction, client) {
        await interaction.deferReply();

        let prompt = interaction.options.getString('prompt');
        let neg_prompt = interaction.options.getString('neg_prompt') || '';
        const preset = interaction.options.getString('preset') || 'fast';
        const custom_width = clamp(interaction.options.getInteger('custom_width') || 512, 64, 1280);
        const custom_height = clamp(interaction.options.getInteger('custom_height') || 320, 64, 1280);
        const custom_length = clamp(interaction.options.getInteger('custom_length') || 3, 1, 5);
        const custom_fps = clamp(interaction.options.getInteger('custom_fps') || 16, 5, 24);
        const portrait = interaction.options.getBoolean('portrait') || false;
        const no_optimize = interaction.options.getBoolean('no_optimize') || false;
        const do_upscale = interaction.options.getBoolean('do_upscale') || false;
        const do_frame_interpolation = interaction.options.getBoolean('do_frame_interpolation') || false;
        const seed = interaction.options.getNumber('seed') || 0
        const sampler = interaction.options.getString('sampler') || 'Euler';
        const scheduler = interaction.options.getString('scheduler') || 'Normal'
        const cfg_scale = clamp(interaction.options.getNumber('cfg_scale') || 1, 1, 10);
        const model = interaction.options.getString('model') || 'wan2.1-t2v-14b-Q4_K_S.gguf';
        const shift = clamp(interaction.options.getInteger('shift') || 5, 1, 10);

        let workflow = JSON.parse(JSON.stringify(og_workflow))

        let dimensions = this.get_video_dimension(preset, custom_width, custom_height, custom_length, custom_fps, portrait);
        const budget = dimensions.width * dimensions.height * dimensions.length;

        if (model === 'hunyuan-video-t2v-720p-Q5_K_M.gguf') {
            interaction.channel.send({ content: "neg_prompt, seed, shift will be ignored for this workflow" });

            if (budget > 24_000_000) {
                interaction.editReply({ content: "Budget exceeded 24M pixels! My PC cannot handle this xd" });
                return
            }
            else if (budget > 16_000_000) {
                interaction.channel.send({ content: "Budget exceeded 16M pixels, generation may take quite a while" });
            }

            workflow["12"]["inputs"]["width"] = dimensions.width;
            workflow["12"]["inputs"]["height"] = dimensions.height;
            workflow["12"]["inputs"]["length"] = dimensions.length;
            workflow["41"]["inputs"]["frame_rate"] = dimensions.fps;

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

            workflow["8"]["inputs"]["sampler_name"] = sampler_to_comfy_name_mapping[sampler] ?? "euler"
            workflow["8"]["inputs"]["scheduler"] = scheduler_to_comfy_name_mapping[scheduler] ?? "normal"
            workflow["8"]["inputs"]["cfg"] = cfg_scale
        }
        else if (model === 'self_forcing_dmd.pt') {
            // self-forcing workflow
            workflow = JSON.parse(JSON.stringify(sf_workflow))
            interaction.channel.send({ content: "cfg_scale, neg_prompt, sampler, scheduler will be ignored for this workflow" });

            if (budget > 80_000_000) {
                interaction.editReply({ content: "Budget exceeded 80M pixels! My PC cannot handle this xd" });
                return
            }
            else if (budget > 50_000_000) {
                interaction.channel.send({ content: "Budget exceeded 50M pixels, generation may take quite a while" });
            }

            workflow["40"]["inputs"]["width"] = dimensions.width;
            workflow["40"]["inputs"]["height"] = dimensions.height;
            workflow["40"]["inputs"]["length"] = dimensions.length;
            workflow["49"]["inputs"]["frame_rate"] = dimensions.fps;

            workflow["48"]["inputs"]["shift"] = shift;
            workflow["3"]["inputs"]["seed"] = seed > 0 ? seed : Math.floor(Math.random() * 2_000_000_000);
            workflow["6"]["inputs"]["text"] = prompt;
        }
        else {
            // wan workflow
            workflow = JSON.parse(JSON.stringify(wan_workflow))
            interaction.channel.send({ content: "cfg_scale, sampler, scheduler will be ignored for this workflow" });

            if (budget > 50_000_000) {
                interaction.editReply({ content: "Budget exceeded 50M pixels! My PC cannot handle this xd" });
                return
            }
            else if (budget > 36_000_000) {
                interaction.channel.send({ content: "Budget exceeded 36M pixels, generation may take quite a while" });
            }

            workflow["40"]["inputs"]["width"] = dimensions.width;
            workflow["40"]["inputs"]["height"] = dimensions.height;
            workflow["40"]["inputs"]["length"] = dimensions.length;
            workflow["30"]["inputs"]["frame_rate"] = dimensions.fps;

            workflow["48"]["inputs"]["shift"] = shift;

            /// prompt
            workflow["6"]["inputs"]["text"] = prompt;
            workflow["7"]["inputs"]["text"] = neg_prompt;

            // model selection
            workflow["291"]["inputs"]["unet_name"] = model;

            // sampler
            workflow["295"]["inputs"]["seed"] = seed > 0 ? seed : Math.floor(Math.random() * 2_000_000_000);
            workflow["295"]["inputs"]["nag_scale"] = neg_prompt !== '' ? 8.0 : 1.0;
        }

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