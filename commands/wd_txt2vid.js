const { SlashCommandBuilder } = require('@discordjs/builders');
const workflow = require('../resources/comfy_txt2vid.json')
const ComfyClient = require('../utils/comfy_client');

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

    ,

	async execute(interaction, client) {
        const prompt = interaction.options.getString('prompt');
        const preset = interaction.options.getString('preset') || 'fast';
        const portrait = interaction.options.getBoolean('portrait') || false;

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

        await interaction.deferReply();

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
            interaction.editReply({ content: "Processing: " + workflow[data.node]["_meta"]["title"] + ` (${data.value}/${data.max})` });
        });

        // await interaction.editReply('This command is not implemented yet');
	},
};