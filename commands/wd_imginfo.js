const { SlashCommandBuilder } = require('@discordjs/builders');
const { loadImage } = require('../utils/load_discord_img');
const ExifReader = require('exifreader');
const { MessageEmbed } = require('discord.js');

function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

const allowed_extra_params = ["sampler", "steps", "cfg scale", "seed", "model hash", "vae hash", "clip skip"]

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_imginfo')
		.setDescription('Inspect an image you uploaded (if EXIF data is available)')
		.addAttachmentOption(option =>
			option.setName('image')
				.setDescription('The image to be inspected')
				.setRequired(true)),

	async execute(interaction) {

        let attachment_option = interaction.options.getAttachment('image')

        //make a temporary reply to not get timeout'd
		await interaction.deferReply();

        //download the image from attachment.proxyURL
        let attachment = await loadImage(attachment_option.proxyURL, true).catch((err) => {
            console.log(err)
            interaction.reply({ content: "Failed to retrieve image", ephemeral: true });
            return
        })

        let tags = {}
        try {
            tags = ExifReader.load(attachment);
        }
        catch (err) {
            interaction.editReply({ content: "Failed to load EXIF data", ephemeral: true });
            return;
        }

        const raw_params = tags["parameters"]?.description
        let response_params = "Unknown"

        if (raw_params) {
            const params = raw_params.split("\n")
            // 0 is prompt
            // 1 is negative prompt
            // 2 is list of extra parameters, splited by comma with <key>:<value>

            response_params = `
**Prompt**: ${params[0]}
**Negative Prompt**: ${params[1]?.replace(/negative prompt\: /i, "") ?? "Unknown"}
**Extra Parameters**: ${params[2] ? "\n" + params[2].split(", ").map((x) => [...x.split(": ")]).filter((x) => allowed_extra_params.includes(x[0].toLowerCase())).map((x) => x.join(": ")).join("\n") : "None"}`    
        }

        // console.log(tags)

        embeded = new MessageEmbed()
            .setColor('#88ff88')
            .setTitle('Image Info')
            .setThumbnail(attachment_option.proxyURL)
            .setDescription(`**Stable Diffusion Parameter**: ${response_params}`)
            .addFields(
                { name: 'Image Size', value: `${tags["Image Width"]?.description ?? "Unknown"} x ${tags["Image Height"]?.description ?? "Unknown"}` },
                { name: 'File Type', value: tags["FileType"] ? tags["FileType"].description : "Non-image" },
            )
            .setFooter({text: "EXIF data may not be available for all images."});

        await interaction.editReply({ embeds: [embeded] });
        
	},
};