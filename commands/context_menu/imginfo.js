const { ContextMenuCommandBuilder } = require('@discordjs/builders');
const { ApplicationCommandType } = require('discord-api-types/v9');
const { loadImage } = require('../../utils/load_discord_img');
const ExifReader = require('exifreader');
const { MessageEmbed } = require('discord.js');
const { model_name_hash_mapping } = require('../../utils/ai_server_config');
const { parsePromptGraph } = require('../../utils/comfy_parser')

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

        let response_params = "Unknown"

        const isComfy = tags["workflow"]?.description != null 
        
        if (isComfy) {
            const prompt = tags["prompt"]?.description
            if (prompt) {
                const fields = parsePromptGraph(prompt)
                // find by key name
                const pos_prompt = fields.find((x) => x.key.includes("text/positive/samples"))
                const neg_prompt = fields.find((x) => x.key.includes("text/negative/samples"))
                const sampler = fields.find((x) => x.key.includes("sampler_name/samples"))
                const step = fields.find((x) => x.key.includes("steps/samples"))
                const cfg_model = fields.find((x) => x.key.includes("cfg/samples"))
                const seed = fields.find((x) => x.key.includes("noise_seed/samples"))
                const model = fields.find((x) => x.key.includes("ckpt_name/model/samples"))
                const vae = fields.find((x) => x.key.includes("ckpt_name/vae/images"))

                // do not show extra parameters if they are not available
                response_params = `
**Prompt**: ${pos_prompt?.value ?? "Unknown"}
**Negative Prompt**: ${neg_prompt?.value ?? "Unknown"}
**Extra Parameters**:
${sampler ? `Sampler: ${sampler.value}` : ""}
${step ? `Steps: ${step.value}` : ""}
${cfg_model ? `CFG Scale: ${cfg_model.value}` : ""}
${seed ? `Seed: ${seed.value}` : ""}
${model ? `Model: ${model.value}` : ""}
${vae ? `VAE: ${vae.value}` : ""}
`
            }
        }

        const raw_params = tags["parameters"]?.description

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

        // check for "model hash" line, and match its value with hash table
        // const model_hash = response_params.match(/model hash: ([a-f0-9]+)/i)
        // console.log(tags)

        embeded = new MessageEmbed()
            .setColor('#88ff88')
            .setTitle('Image Info')
            .setThumbnail(attachment_option.proxyURL)
            .setDescription(`**Stable Diffusion Parameter**: ${isComfy ? "[ComfyUI Workflow info is not complete]": ""} ${response_params}`)
            .addFields(
                { name: 'Image Size', value: `${tags["Image Width"]?.description ?? "Unknown"} x ${tags["Image Height"]?.description ?? "Unknown"}` },
                { name: 'File Type', value: tags["FileType"] ? tags["FileType"].description : "Non-image" },
            )
            .setFooter({text: "EXIF data may not be available for all images."});

        await interaction.editReply({ embeds: [embeded] });

	},
};