const { SlashCommandBuilder } = require('@discordjs/builders');
const og_workflow = require('../resources/skyreel_img2vid.json')
const wan_workflow = require('../resources/wan_img2vid.json')
const ComfyClient = require('../utils/comfy_client');
const { get_teacache_config_from_prompt } = require('../utils/prompt_analyzer');
const { clamp } = require('../utils/common_helper');
const { loadImage } = require('../utils/load_discord_img');

const preset_to_budget_allocation = {
    'fast': 20_000_000,
    'std': 24_000_000,
    'high': 32_000_000,
    'extreme': 40_000_000
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_img2vid')
            .setDescription('Generate a video from an image and a text prompt')
            .addAttachmentOption(option =>
                option.setName('image')
                    .setDescription('The image to be converted')
                    .setRequired(true))
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
                        { name: 'Fast (20M pixels)', value: 'fast' },
                        { name: 'Standard (24M pixels)', value: 'std' },
                        { name: 'High (32M pixels)', value: 'high' },
                        { name: 'Extreme (40M pixels)', value: 'extreme' },
                        { name: 'Custom', value: 'custom' }
                    ))
            .addIntegerOption(option =>
                option.setName('custom_budget')
                    .setDescription('Number of pixels allocate to the generation (max 24 million pixels)')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('length')
                    .setDescription('The length of the video in seconds (max 15 seconds, deafult 3)')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('fps')
                    .setDescription('The frame rate of the video (default 16, recommend max 24)')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('shift')
                    .setDescription('The shift rate for the video generation (default 3, higher shift = more motion)')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('model')
                    .setDescription('The model to use for the generation')
                    .addChoices(
                        { name: 'Skyreels Hunyuan I2V Q5 - Legacy', value: 'skyreels-hunyuan-I2V-Q5_K_M.gguf' },
                        { name: 'Skyreels Wan v2 I2V Q6', value: 'Skywork-SkyReels-V2-I2V-14B-720P-Q6_K.gguf' },
                        { name: 'Wan v2.1 I2V Q4_K_M', value: 'wan2.1-i2v-14b-720p-Q4_K_M.gguf' },
                        { name: 'AniWan v2.1 I2V fp8', value: 'aniWan2114BFp8E4m3fn_i2v720p.safetensors' }
                    ))
    ,

	async execute(interaction, client) {
        await interaction.deferReply();

        let prompt = interaction.options.getString('prompt');
        let neg_prompt = interaction.options.getString('neg_prompt') || '';
        const attachment_option = interaction.options.getAttachment('image');
        const preset = interaction.options.getString('preset') || 'std';
        const length = clamp(interaction.options.getInteger('length') || 3, 1, 15);
        const fps = clamp(interaction.options.getInteger('fps') || 16, 5, 24);
        const custom_budget = clamp(interaction.options.getInteger('custom_budget') || 24_000_000, 600_000, 50_000_000);
        const model = interaction.options.getString('model') || 'wan2.1-i2v-14b-720p-Q4_K_M.gguf';
        const shift = clamp(interaction.options.getInteger('shift') || 3, 1, 10);

        let workflow = JSON.parse(JSON.stringify(og_workflow))

        //download the image from attachment.proxyURL
        let attachment = await loadImage(attachment_option.proxyURL,
            /*getBuffer:*/ true).catch((err) => {
            console.log("Failed to retrieve image from discord", err)
            return
        })
        //set the image buffer to the workflow
        const image_info = await ComfyClient.uploadImage(attachment, Date.now() + "_" + attachment_option.name, attachment_option.contentType).catch((err) => {
            console.log("Failed to upload image", err)
            return
        })

        console.log(image_info)

        if (image_info == null) {
            interaction.editReply({ content: "Failed to receive input image" });
            return
        }

        // calculate the allocated bugdet to frame count and resolution
        const frame_count = length * fps
        const budget = preset_to_budget_allocation[preset] 
        if (preset === 'custom') {
            budget = custom_budget
        }

        if (model === 'skyreels-hunyuan-I2V-Q5_K_M.gguf') {
            // older less optimized workflow, divide budget by 2
            interaction.editReply({ content: "Using less optimized workflow, dividing budget by 2" });
            budget /= 2

            workflow["42"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 2_000_000_000)
            workflow["110"]["inputs"]["seed"] = Math.floor(Math.random() * 2_000_000_000)
            workflow["151"]["inputs"]["image"] = image_info.name
            workflow["140"]["inputs"]["float"] = budget
            workflow["153"]["inputs"]["int"] = frame_count
            workflow["50"]["inputs"]["frame_rate"] = fps

            workflow["45"]["inputs"]["text"] = "FPS-24, " + prompt
            if (neg_prompt !== '') {
                workflow["45"]["inputs"]["neg_text"] = "FPS-24, " + neg_prompt
            }
        }
        else {
            workflow = JSON.parse(JSON.stringify(wan_workflow))

            workflow["83"]["inputs"]["seed"] = Math.floor(Math.random() * 2_000_000_000)
            workflow["83"]["inputs"]["nag_scale"] = neg_prompt !== '' ? 8.0 : 1.0      
            workflow["33"]["inputs"]["image"] = image_info.name  
            workflow["5"]["inputs"]["frame_rate"] = fps
            workflow["18"]["inputs"]["float"] = budget
            workflow["23"]["inputs"]["int"] = frame_count
            workflow["14"]["inputs"]["shift"] = shift

            // select model
            workflow["10"]["inputs"]["unet_name"] = model
            if (model === 'aniWan2114BFp8E4m3fn_i2v720p.safetensors') {
                workflow["10"] = {
                    "inputs": {
                        "unet_name": "aniWan2114BFp8E4m3fn_i2v720p.safetensors",
                        "weight_dtype": "default"
                    },
                    "class_type": "UNETLoader",
                    "_meta": {
                        "title": "Load Diffusion Model"
                    }
                }
            }

            workflow["81"]["inputs"]["text"] = neg_prompt
            workflow["13"]["inputs"]["text"] = prompt;
        }

        ComfyClient.sendPrompt(workflow, (data) => {
            if (data.node !== null) interaction.editReply({ content: "Processing: " + workflow[data.node]["_meta"]["title"] });
        }, (data) => {
            console.log('received success')
            if ((!data.output?.gifs) || data.output.gifs.length === 0) {
                console.log('Output is not video')
                return
            }
            const filename = data.output.gifs[0].filename

            // fetch video from comfyUI
            ComfyClient.getImage(filename, '', '', /*only_filename*/ true).then(async (arraybuffer) => {
                // convert arraybuffer to buffer
                const buffer = Buffer.from(arraybuffer)

                await interaction.editReply({ content: "Generation Success", files: [{ attachment: buffer, name: filename }] });

                // TODO: allow user to post process the video (color matching, frame upscaling, frame interpolation)
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