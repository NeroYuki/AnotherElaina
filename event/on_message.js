const { context_storage } = require('../utils/text_gen_store');
var { is_generating } = require('../utils/text_gen_store');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { text_completion_stream, text_completion } = require('../utils/ollama_request');
const { loadImage } = require('../utils/load_discord_img');
const { operatingMode2Config } = require('../utils/chat_options');
const comfyClient = require('../utils/comfy_client');

async function responseToMessage(client, message, content, is_continue = false, is_regen = false, ctx_enc_len = 0) {

    let operating_mode = globalThis.operating_mode
    let attachment_option = message.attachments.find(attachment => attachment.contentType.startsWith('image')) || message.embeds[0]?.image

    if (globalThis.operating_mode === "auto") {
        if (comfyClient.comfyStat.gpu_vram_used < 3 && !globalThis.llm_load_timer) {
            if (attachment_option) {
                operating_mode = "vision"
            }
            else {
                operating_mode = "standard"
            }
        }
        else {
            operating_mode = "saving"
        }
    }

    if (globalThis.operating_mode === "disabled" || !operatingMode2Config[operating_mode]) {
        message.channel.send("Elaina is sleeping right now. Please try again later.")
        return
    }

    const prompt_config = operatingMode2Config[operating_mode].prompt_config

    // get the context from the context storage
    let context = context_storage.get(message.author.id)
    if (content) {
        if (context === undefined) {
            context = [{ role: message.author.username, content: content}]
        }
        else {
            context.push({ role: message.author.username, content: content })
        }
    }
    else {
        if (is_regen) {
            context.pop()
        }
        else if (is_continue) {
            // this is intentionally left blank
        }
        else {
            message.channel.send("SYSTEM: You somehow sent an invalid chat. Please try again")
            return
        }
    }

    let system_prompt = prompt_config.system_prompt

    let options = operatingMode2Config[operating_mode].override_options

    let prompt = ''
    let scenario = prompt_config.scenario

    // build back prompt
    prompt = `${scenario}`

    console.log(context)
    for (let i = 0; i < context.length; i++) {
        if (context[i].role !== 'bot') {
            prompt += `${prompt_config.user_message(context[i].role).prefix}${context[i].content}${prompt_config.user_message(context[i].role).suffix}` + "\n"
        }
        else {
            prompt += `${prompt_config.bot_message.prefix}${context[i].content}${prompt_config.bot_message.suffix}` + "\n"
        }
    }

    // if the total length of content in the context is more than 80000 characters, remove the oldest content
    let total_length = context.reduce((acc, val) => acc + val.content.length, 0)
    while (total_length > options.num_ctx * 4) {
        context.shift()
        total_length = context.reduce((acc, val) => acc + val.content.length, 0)
    }

    const row = new MessageActionRow()
        .addComponents(
            new MessageButton()
                .setCustomId('deleteContext_' + message.id)
                .setEmoji("<:nuke:338322910018142208>")
                .setLabel('Forget Everything')
                .setStyle('DANGER'),
        )
        .addComponents(
            new MessageButton()
                .setCustomId('continueResponse_' + message.id)
                .setLabel('▶️ Continue')
                .setStyle('PRIMARY'),
        )
        .addComponents(
            new MessageButton()
                .setCustomId('regenerateResponse_' + message.id)
                .setLabel('🔁 Regenerate')
                .setStyle('SECONDARY'),
        )
        .addComponents(
            new MessageButton()
                .setCustomId('debugResponse_' + message.id)
                .setLabel('🔎 Debug')
                .setStyle('SECONDARY'),
        )        
        .addComponents(
            new MessageButton()
                .setCustomId('switchContext_' + message.id)
                .setLabel('🌐 Switch conversation scope')
                .setStyle('SECONDARY'),
        );
        

    const filter = i => i.user.id === message.author.id;
    
    const collector = message.channel.createMessageComponentCollector({ filter, time: 180000 });

    // console.log(prompt)
    // if is_continue, strip the bot_message.suffix at the end of the prompt if found
    if (is_continue) {
        const suffix = prompt_config.bot_message.suffix
        if (prompt.endsWith(suffix)) {
            prompt = prompt.slice(0, -suffix.length)
        }
    }
    else {
        prompt += prompt_config.bot_message.prefix
    }

    console.log(prompt)

    try {
        let res_gen_elaina = ''
        let is_done = false
        let debug_info = {}
        if (globalThis.stream_response !== true) {
            text_completion(operatingMode2Config[operating_mode], prompt, (value) => {
                res_gen_elaina += value.response
                debug_info = value
                is_done = true
            })
        }
        else {
            text_completion_stream(operatingMode2Config[operating_mode], prompt, (value, done) => {
                if (!value || done) {
                    is_done = true
                    if (!value) return
                    debug_info = value
                }
                res_gen_elaina += value.response
            })
        }

        const msgRef = await message.channel.send("...");

        const intervalId = setInterval(() => {
            if (!res_gen_elaina) return
            msgRef.edit(`<@${message.author.id}> ${res_gen_elaina}`)

            if (is_done) {
                clearInterval(intervalId)
                console.log("done")
                if (["vision", "standard"].includes(operating_mode)) {
                    globalThis.llm_load_timer = setTimeout(() => {
                        globalThis.llm_load_timer = null
                    }, 1000 * (60 * 5 + 15))
                }

                if (context[context.length - 1].role === "bot") {
                    const previous_response = context.pop().content
                    context.push({ role: "bot", content: previous_response + res_gen_elaina })
                }
                else {
                    context.push({ role: "bot", content: res_gen_elaina })
                }

                context_storage.set(message.author.id, context)
                msgRef.edit({ content: `<@${message.author.id}> ${res_gen_elaina}`, components: [row] })

                collector.on('collect', async i => {
                    if (i.customId === 'deleteContext_' + message.id) {
                        i.deferUpdate();
                        collector.stop()
                        context_storage.delete(message.author.id)
                        message.channel.send(`<@${message.author.id}> Let's start over shall we?`)
                    }
                    else if (i.customId === 'continueResponse_' + message.id) {
                        i.deferUpdate();
                        collector.stop()
                        responseToMessage(client, message, "", true)
                    }
                    else if (i.customId === 'debugResponse_' + message.id) {
                        i.deferUpdate();
                        const model_used = debug_info.model
                        const context_limit = options.num_ctx
                        const embed = new MessageEmbed()
                            .setColor('#8888ff')
                            .setTitle('Debug Info')
                            .setDescription('Debug information for the response')
                            .addFields(
                                { name: 'Operating mode', value: model_used },
                                { name: 'Duration', value: `${(debug_info.total_duration / 1_000_000_000).toFixed(4)}s (Load: ${(debug_info.load_duration / 1_000_000_000).toFixed(4)}s, Evalulate: ${(debug_info.prompt_eval_duration / 1_000_000_000).toFixed(4)}s, Generate: ${(debug_info.eval_duration / 1_000_000_000).toFixed(4)}s)` },
                                { name: 'Context Length', value: `${debug_info.prompt_eval_count + debug_info.eval_count}/${context_limit} tokens (${((debug_info.prompt_eval_count + debug_info.eval_count)/context_limit*100).toFixed(2)}%, +${debug_info.eval_count} tokens)` },
                            )

                        message.channel.send({ embeds: [embed] })
                    }
                    else if (i.customId === 'regenerateResponse_' + message.id) {
                        i.deferUpdate();
                        collector.stop()
                        responseToMessage(client, message, "", false, true, 0)
                    }
                    else if (i.customId === 'switchContext_' + message.id) {
                        i.deferUpdate();
                        collector.stop()
                        
                    }
                })
            }
        }, 1000)
    }
    catch (error) {
        console.log(error)
        await interaction.editReply(reponse +  "ERROR: " + error)
    }
}

module.exports = {
    responseToMessage
}