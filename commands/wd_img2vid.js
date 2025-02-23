const { SlashCommandBuilder } = require('@discordjs/builders');
const og_workflow = require('../resources/skyreel_img2vid.json')
const ComfyClient = require('../utils/comfy_client');
const { get_teacache_config_from_prompt } = require('../utils/prompt_analyzer');
const { clamp } = require('../utils/common_helper');
const { loadImage } = require('../utils/load_discord_img');

const preset_to_budget_allocation = {
    'fast': 10_000_000,
    'std': 12_000_000,
    'high': 16_000_000,
    'extreme': 20_000_000
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
                        { name: 'Fast (10M pixels)', value: 'fast' },
                        { name: 'Standard (12M pixels)', value: 'std' },
                        { name: 'High (16M pixels)', value: 'high' },
                        { name: 'Extreme (20M pixels)', value: 'extreme' },
                        { name: 'Custom', value: 'custom' }
                    ))
            .addIntegerOption(option =>
                option.setName('custom_budget')
                    .setDescription('Number of pixels allocate to the generation (max 24 million pixels)')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('length')
                    .setDescription('The length of the video in seconds (max 5 seconds, deafult 3)')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('fps')
                    .setDescription('The frame rate of the video (default 16, recommend max 24)')
                    .setRequired(false))
    ,

	async execute(interaction, client) {
        await interaction.deferReply();

        let prompt = interaction.options.getString('prompt');
        let neg_prompt = interaction.options.getString('neg_prompt') || '';
        const attachment_option = interaction.options.getAttachment('image');
        const preset = interaction.options.getString('preset') || 'std';
        const length = clamp(interaction.options.getInteger('length') || 3, 1, 5);
        const fps = clamp(interaction.options.getInteger('fps') || 16, 5, 24);
        const custom_budget = clamp(interaction.options.getInteger('custom_budget') || 12_000_000, 300_000, 24_000_000);

        let workflow = JSON.parse(JSON.stringify(og_workflow))

        const forceHighPrecision = prompt.includes("[FORCE_Q6]")
        if (forceHighPrecision) {
            prompt = prompt.replace("[FORCE_Q6]", "")
            workflow["120"]["inputs"]["unet_name"] = "skyreels-hunyuan-I2V-Q6_K.gguf"
        }

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