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

const allowed_extra_params = ["sampler", "steps", "cfg scale", "seed", "model hash", "vae hash", "clip skip", "schedule type", "model"]

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
        let neg_prompt_param = "Unknown"
        let extra_param = "None"

        const isComfy = tags["workflow"]?.description != null 

        if (isComfy) {
            const prompt = tags["prompt"]?.description
            let pos_prompt, neg_prompt, sampler, step, cfg_model, seed, model, vae = null
            if (prompt) {
                const fields = parsePromptGraph(prompt)
                
                Object.entries(fields).forEach(([key, value]) => {
                    if (key.includes("text/positive/samples") && !pos_prompt) {
                        pos_prompt = {key: key, value: value}
                    }
                    if (key.includes("text/negative/samples") && !neg_prompt) {
                        neg_prompt = {key: key, value: value}
                    }
                    if (key.includes("sampler_name/samples") && !sampler) {
                        sampler = {key: key, value: value}
                    }
                    if (key.includes("steps/samples") && !step) {
                        step = {key: key, value: value}
                    }
                    if (key.includes("cfg/samples") && !cfg_model) {
                        cfg_model = {key: key, value: value}
                    }
                    if (key.includes("noise_seed/samples") && !seed) {
                        seed = {key: key, value: value}
                    }
                    if (key.includes("ckpt_name/model/samples") && !model) {
                        model = {key: key, value: value}
                    }
                    if (key.includes("ckpt_name/vae/images") && !vae) {
                        vae = {key: key, value: value}
                    }
                })

        // do not show extra parameters if they are not available
        response_params = `${pos_prompt?.value ?? "Unknown"}`
        neg_prompt_param = `${neg_prompt?.value ?? "Unknown"}`
        extra_param = `${sampler ? `Sampler: ${sampler.value}` : ""}
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

            response_params = `${params.slice(0, neg_prompt_index).join("\n")}`
            neg_prompt_param =  `${params[neg_prompt_index]?.replace(/negative prompt\: /i, "") ?? "Unknown"}`
            extra_param = `${params[neg_prompt_index + 1] ? "\n" + params[neg_prompt_index + 1]
    .split(", ")
    .map((x) => [...x.split(": ")])
    .filter((x) => allowed_extra_params.includes(x[0].toLowerCase()))
    .map((x) => {
        if (x[0].toLowerCase() === "model hash") {
            x[0] = "Model"
            x[1] = model_name_hash_mapping.get(x[1]) ?? x[1]
        }
        if (x[0].toLowerCase() === "model") {
            x[0] = "Model name"
            x[1] = x[1]
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
            .setDescription(`${response_params}`)
            .addFields(
                { name: 'Negative Prompt', value: neg_prompt_param ?? "Unknown" },
                { name: 'Extra Parameters', value: extra_param ?? "None" },
                { name: 'Image Size', value: `${tags["Image Width"]?.description ?? "Unknown"} x ${tags["Image Height"]?.description ?? "Unknown"}` },
                { name: 'File Type', value: tags["FileType"] ? tags["FileType"].description : "Non-image" },
            )
            .setFooter({text: "EXIF data may not be available for all images."});

        await interaction.editReply({ content: `**Stable Diffusion Parameter**: ${isComfy ? "[ComfyUI Workflow info is not complete]": ""}`, embeds: [embeded] });

	},
};