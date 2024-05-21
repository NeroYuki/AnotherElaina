const { ContextMenuCommandBuilder } = require('@discordjs/builders');
const { ApplicationCommandType } = require('discord-api-types/v9');
const ExifReader = require('exifreader');
const { getsauce } = require('../../integration/saucenaoapi');
const { MessageEmbed } = require('discord.js');
const { loadImage } = require('../../utils/load_discord_img');

function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Find sauce')
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

        // check if image have 
        const isComfy = tags["workflow"]?.description != null 
        const isA1111 = tags["parameters"]?.description != null

        if (isComfy || isA1111) {
            interaction.editReply({ content: "This image is AI generated, abort sauce finding", ephemeral: true });
            return;
        }

        // send the image to sauceNAO
        let api_result = await getsauce(encodeURIComponent(attachment_option.url))
        if (api_result.message == -2) {
            interaction.editReply({ content: "Cannot connect to SauceNAO", ephemeral: true });
            return
        }
        else if (api_result.message == -1) {
            interaction.editReply({ content: "Unknown error happened", ephemeral: true });
            return
        }
        else if (api_result.message == 0) {
            interaction.editReply({ content: "No result found", ephemeral: true });
            return
        }
        else if (api_result.message == 1) {
            let mirrorLink = ""
            if (api_result.gelbooru_link) {
                mirrorLink += "[Gelbooru](" + api_result.gelbooru_link + ")\n"
            }
            if (api_result.sankaku_link) {
                mirrorLink += "[Sankaku](" + api_result.sankaku_link + ")\n"
            }
            if (api_result.danbooru_link) {
                mirrorLink += "[Danbooru](" + api_result.danbooru_link + ")\n"
            }
            if (api_result.yandere_link) {
                mirrorLink += "[Yandere](" + api_result.yandere_link + ")\n"
            }

            const embed = new MessageEmbed()
                .setTitle(api_result.title)
                .setDescription("Mirror:\n" + (mirrorLink ? mirrorLink : "Unknown"))
                .setURL(api_result.pixiv_link)
                .setColor(3270124)
                .setThumbnail(api_result.thumbnail)
                .setAuthor("Artist: " + (api_result.artist))
                .setFooter("Similarity: " + api_result.similarity + "%")
                .addFields(
                    { name: "From: " + api_result.material, value: (api_result.characters == "")? "Unknown" : api_result.characters }
                )

            if (api_result.source) {
                embed.addFields(
                    { name: "Source: ", value: api_result.source.startsWith('http') ? "[Link](" + api_result.source + ")"  : api_result.source }
                )
            }

            interaction.editReply({ embeds: [embed] });
        }
    }
};
