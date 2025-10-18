const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const sharp = require('sharp');
const { server_pool, get_prompt, get_negative_prompt, get_worker_server, model_name_hash_mapping } = require('../utils/ai_server_config.js');
const { default: axios } = require('axios');
const { loadImage } = require('../utils/load_discord_img');
const workflow_og = require('../resources/florence_simple.json');
const ComfyClient = require('../utils/comfy_client');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_interrogate')
		.setDescription('Use CLIP interrogation to describe a picture you uploaded')
		.addAttachmentOption(option =>
			option.setName('image')
				.setDescription('The image to be described')
				.setRequired(true))
        .addStringOption(option =>
            option.setName('engine')
                .setDescription('The engine to use for the interrogation (default is "Florence 2")')
                .addChoices(
                    { name: 'Florence 2', value: 'microsoft/Florence-2-large' },
                    { name: 'Florence 2 Finetuned', value: 'microsoft/Florence-2-large-ft' },
                    { name: 'Florence 2 PromptGen', value: 'MiaoshouAI/Florence-2-large-PromptGen-v2.0' },
                    // { name: '(Legacy) CLIP', value: 'CLIP' },
                    // { name: '(Legacy) Deepbooru', value: 'Deepbooru' },
                )
                .setRequired(false))
        .addStringOption(option =>
            option.setName('florence_task')
                .setDescription('The task to use for Florence 2 engine')
                .addChoices(
                    { name: 'Caption', value: 'caption' },
                    { name: 'Caption (Detailed)', value: 'detailed_caption' },
                    { name: 'Caption (Extra Detailed)', value: 'more_detailed_caption' },
                    { name: 'Caption (Booru Tags)', value: 'prompt_gen_tags' },
                    { name: 'Caption (Mixed)', value: 'prompt_gen_mixed_caption' },
                    { name: 'Caption (Analyze)', value: 'prompt_gen_analyze' },
                    { name: 'Region Caption', value: 'region_caption' },
                    { name: 'Region Caption (Detailed)', value: 'dense_region_caption' },
                    { name: 'OCR (Region Highlight)', value: 'ocr_with_region' },
                    { name: 'Find Object', value: 'caption_to_phrase_grounding' },
                    { name: 'Find Object Segment', value: 'referring_expression_segmentation' },
                    { name: 'Document Visual Question Answering', value: 'docvqa' }
                )
                .setRequired(false))
        .addStringOption(option =>
            option.setName('florence_prompt')
                .setDescription('The prompt to use for Florence 2 engine (apply to find object and docvqa)')
                .setRequired(false))

    ,

    async execute_comfy(interaction, client, data) {
        const workflow = JSON.parse(JSON.stringify(workflow_og))

        //set the image buffer to the workflow
        const image_info = await ComfyClient.uploadImage(data.attachment, Date.now() + "_" + data.attachment_option.name, data.attachment_option.contentType).catch((err) => {
            console.log("Failed to upload image", err)
            return
        })

        if (image_info == null) {
            interaction.editReply({ content: "Failed to receive input image" });
            return
        }

        workflow["1"]["inputs"]["seed"] = Math.floor(Math.random() * 2_000_000_000)
        workflow["2"]["inputs"]["model"] = data.engine
        workflow["1"]["inputs"]["task"] = data.florence_task
        workflow["3"]["inputs"]["image"] = image_info.name

        // change engine based on selected task
        if (data.florence_task.includes('prompt_gen')) {
            interaction.channel.send('PromptGen task detected, changing engine to Florence 2 PromptGen')
            workflow["2"]["inputs"]["model"] = "MiaoshouAI/Florence-2-large-PromptGen-v2.0"
        }
        else if (data.florence_task === 'docvqa') {
            interaction.channel.send('DocVQA task detected, changing engine to Florence 2 DocVQA')
            workflow["2"]["inputs"]["model"] = "HuggingFaceM4/Florence-2-DocVQA"
        }

        if (['caption_to_phrase_grounding', 'referring_expression_segmentation', 'docvqa'].includes(data.florence_task)) {
            workflow["1"]["inputs"]["text_input"] = data.florence_prompt
        }

        let buffer = null
        let output_text = null
        let output_filename = null
        const task = data.florence_task

        ComfyClient.sendPrompt(workflow, (comfy_data) => {
            if (comfy_data.node !== null) interaction.editReply({ content: "Processing: " + workflow[comfy_data.node]["_meta"]["title"] });
        }, async (comfy_data) => {
            console.log('received success')

            if (comfy_data.output.text) {
                if (['region_caption',
                    'dense_region_caption',
                    'caption_to_phrase_grounding',
                    'referring_expression_segmentation',
                    'region_proposal'].includes(task))
                {
                    output_text = 'Region defined in the output image'
                }
                else {
                    output_text = comfy_data.output.text[0]
                }
            }
            else if (comfy_data.output.images) {
                if (['caption',
                    'detailed_caption',
                    'more_detailed_caption',
                    'prompt_gen_tags',
                    'prompt_gen_mixed_caption',
                    'prompt_gen_analyze',
                    'docvqa',
                    ].includes(task))
                {
                    output_filename = data.attachment_option.name
                    buffer = data.attachment_option.proxyURL
                }
                else {
                    output_filename = comfy_data.output.images[0].filename

                    // fetch image from comfyUI
                    await ComfyClient.getImage(output_filename, '', 'temp', /*only_filename*/ false).then(async (arraybuffer) => {
                            // convert arraybuffer to buffer
                            buffer = Buffer.from(arraybuffer)
                        }).catch((err) => {
                            console.log("Failed to retrieve image", err)
                            interaction.editReply({ content: "Failed to retrieve image" });
                        }).finally(() => {
                            ComfyClient.freeMemory(true)
                        })
                }
            }

            if (buffer !== null && output_text !== null) {
                await interaction.editReply({ content: "Output: " + output_text, files: [{ attachment: buffer, name: output_filename }] });
            }

        }, (comfy_data) => {
            console.log('received error')
            interaction.editReply({ content: comfy_data.error });
            ComfyClient.freeMemory(true)
        })
    },


	async execute(interaction, client) {
        if (client.cooldowns.has(interaction.user.id) && !byPassUser.includes(interaction.user.id)) {
            // cooldown not ended
            interaction.reply({ content: "Please wait for cooldown to end", ephemeral: true });
            return 
        }

        let attachment_option = interaction.options.getAttachment('image')
        let engine = interaction.options.getString('engine') || 'microsoft/Florence-2-large'
        let florence_task = interaction.options.getString('florence_task') || 'caption'
        let florence_prompt = interaction.options.getString('florence_prompt') || ''

        //make a temporary reply to not get timeout'd
		await interaction.deferReply();

        //download the image from attachment.proxyURL
        let attachment = await loadImage(attachment_option.proxyURL, true).catch((err) => {
            console.log(err)
            interaction.reply({ content: "Failed to retrieve image", ephemeral: true });
            return
        })

        if (engine.includes('Florence')) {
            // switch to comfy backend
            this.execute_comfy(interaction, client, {
                attachment_option: attachment_option,
                attachment: attachment,
                engine: engine,
                florence_task: florence_task,
                florence_prompt: florence_prompt
            })

            return;
        }
        else {
            await interaction.channel.send('Legacy engine no longer supported, please use Florence 2 engine instead.')
        }

        return;
	},
};