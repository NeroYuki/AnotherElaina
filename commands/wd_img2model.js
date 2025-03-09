const { SlashCommandBuilder } = require('@discordjs/builders');
const ComfyClient = require('../utils/comfy_client');
const workflow_og = require('../resources/comfy_img2model.json');
const { loadImage } = require('../utils/load_discord_img');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_img2model')
            .setDescription('Convert an image to a 3d model')
            .addAttachmentOption(option =>
                option.setName('image')
                    .setDescription('The image to be converted')
                    .setRequired(true))
            .addBooleanOption(option => 
                option.setName('remove_background')
                    .setDescription('Force remove background from input image'))

    ,

    async init() {
        // setup heartbeat routine to check which server is alive
        ComfyClient.init();
    },

	async execute(interaction, client) {
        await interaction.deferReply();

        const workflow = JSON.parse(JSON.stringify(workflow_og))

        const attachment_option = interaction.options.getAttachment('image');
        const remove_background = interaction.options.getBoolean('remove_background') || false;

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

        workflow["2"]["inputs"]["seed"] = Math.floor(Math.random() * 2_000_000_000)
        workflow["4"]["inputs"]["image"] = image_info.name
        workflow["2"]["inputs"]["preprocess_image"] = remove_background

        ComfyClient.sendPrompt(workflow, (data) => {
            if (data.node !== null) interaction.editReply({ content: "Processing: " + workflow[data.node]["_meta"]["title"] });
        }, (data) => {
            console.log('received success')
            const comp = data.output.text[0].split('/')
            const filename = comp[comp.length - 1].replace('_0.glb', '_gs.mp4')

            // fetch video from comfyUI
            ComfyClient.getImage(filename, '', '', /*only_filename*/ true).then(async (arraybuffer) => {
                // convert arraybuffer to buffer
                const buffer = Buffer.from(arraybuffer)

                await interaction.editReply({ content: "Conversion Success", files: [{ attachment: buffer, name: filename }] });
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
        })

        await interaction.editReply('Success backend execution');
	},
};