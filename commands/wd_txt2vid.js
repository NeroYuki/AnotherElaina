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

    ,

	async execute(interaction, client) {
        const prompt = interaction.options.getString('prompt');

        workflow["15"]["inputs"]["text"] = prompt

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