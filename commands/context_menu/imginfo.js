const { ContextMenuCommandBuilder } = require('@discordjs/builders');
const { ApplicationCommandType } = require('discord-api-types/v9');
const { loadImage } = require('../../utils/load_discord_img');
const ExifReader = require('exifreader');
const { MessageEmbed } = require('discord.js');

function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

const allowed_extra_params = ["sampler", "steps", "cfg scale", "seed", "model hash", "vae hash", "clip skip"]

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('SD Image Info')
        .setType(ApplicationCommandType.Message)
    ,

	async execute(interaction) {

        let attachment_option = interaction.targetMessage.attachments.find(attachment => attachment.contentType.startsWith('image')) || interaction.targetMessage.embeds[0]?.image
        if (!attachment_option) {
            interaction.reply({ content: "No image found in the message", ephemeral: true });
            return
        }

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

            const neg_prompt_index = params.findIndex((x) => x.toLowerCase().includes("negative prompt: "))
            // 0 is prompt
            // 1 is negative prompt
            // 2 is list of extra parameters, splited by comma with <key>:<value>

            response_params = `
**Prompt**: ${params.slice(0, neg_prompt_index).join("\n")}
**Negative Prompt**: ${params[neg_prompt_index]?.replace(/negative prompt\: /i, "") ?? "Unknown"}
**Extra Parameters**: ${params[neg_prompt_index + 1] ? "\n" + params[neg_prompt_index + 1]
    .split(", ")
    .map((x) => [...x.split(": ")])
    .filter((x) => allowed_extra_params.includes(x[0].toLowerCase()))
    .map((x) => {
        if (x[0].toLowerCase() === "model hash") {
            x[0] = "Model"
            x[1] = model_name_hash_mapping.get(x[1]) ?? x[1]
        }
        return x
    })
    .map((x) => x.join(": "))
    .join("\n") : "None"}`    
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