const { context_storage } = require('../utils/text_gen_store');
var { is_generating } = require('../utils/text_gen_store');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { chat_completion, text_completion_stream, text_completion } = require('../utils/ollama_request');
const { loadImage } = require('../utils/load_discord_img');
const { maid, poppy, hermes, qwen } = require('../utils/chat_options');

const USE_NATIVE_EMBEDDING = false
const persona = qwen

async function responseToMessage(client, message, content, is_continue = false, is_regen = false, ctx_enc_len = 0) {
    // let prompt = content

    if (globalThis.operating_mode === "disabled") {
        message.channel.send("Elaina is sleeping right now. Please try again later.")
        return
    }

    // get the context from the context storage
    let context = context_storage.get(message.author.id)
    let old_ctx = []
    if (USE_NATIVE_EMBEDDING) {
        if (!context) {
            context = []
        }
        old_ctx = [...context]
        if (is_regen) {
            // remove all element out of context since ctx_enc length
            context = context.slice(0, ctx_enc_len.length)
        }
    }
    else {
        if (content) {
            if (context === undefined) {
                context = [{ role: "user", content: content}]
            }
            else {
                context.push({ role: "user", content: content})
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
    }

    let system_prompt = persona.system_prompt

    let options = persona.options

    if (globalThis.operating_mode === "6bit") {
        options.num_ctx = 16_384
    }

    let prompt = ''
    let scenario = persona.scenario

    if (USE_NATIVE_EMBEDDING) {
        if (context.length === 0) {
            prompt = `${scenario}`
        }

        if (!is_continue) {
            prompt += `${persona.user_message.prefix} ${content} ${persona.user_message.suffix}` + "\n"
        }

    }
    else {
        // build back prompt
        prompt = `${scenario}` + "\n"
    
        for (let i = 0; i < context.length; i++) {
            if (context[i].role === 'user') {
                prompt += `${persona.user_message.prefix} ${context[i].content} ${persona.user_message.suffix}` + "\n"
            }
            else {
                prompt += `${persona.bot_message.prefix} ${context[i].content} ${persona.bot_message.suffix}` + "\n"
            }
        }

        // if the total length of content in the context is more than 80000 characters, remove the oldest content
        let total_length = context.reduce((acc, val) => acc + val.content.length, 0)
        while (total_length > 100_000) {
            context.shift()
            total_length = context.reduce((acc, val) => acc + val.content.length, 0)
        }
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
        );

    const filter = i => i.user.id === message.author.id;
    
    const collector = message.channel.createMessageComponentCollector({ filter, time: 180000 });

    // build prompt from context
    
    if (USE_NATIVE_EMBEDDING) {
        console.log(context)
        console.log(prompt)
    }
    else {
        // console.log(prompt)
        // if is_continue, strip the <|eot_id|> from the end of the prompt
        if (is_continue) {
            prompt = prompt.trimEnd().replace(/<\|eot_id\|>$/, "")
        }
    }

    try {
        let res_gen_elaina = ''
        let is_done = false
        let debug_info = {}
        if (globalThis.stream_response !== true) {
            text_completion(globalThis.operating_mode === '4bit' ? 'test_poppy' : 'test_poppy_gpu', prompt, options, system_prompt, (value) => {
                res_gen_elaina += value.response
                debug_info = value
                is_done = true
            })
        }
        else {
            text_completion_stream(globalThis.operating_mode === '4bit' ? 'test_poppy' : 'test_poppy_gpu', prompt, options, system_prompt, (value, done) => {
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

                if (USE_NATIVE_EMBEDDING) {
                    context = debug_info.context
                }
                else {
                    if (context[context.length - 1].role === "bot") {
                        const previous_response = context.pop().content
                        context.push({ role: "bot", content: previous_response + res_gen_elaina })
                    }
                    else {
                        context.push({ role: "bot", content: res_gen_elaina })
                    }
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
                        const actual_operating_mode = debug_info.model === "test" ? "6bit" : debug_info.model === "test4b" ? "4bit" : debug_info.model === "test_vision" ? "vision" : "uncensored"
                        const context_limit = options.num_ctx
                        const embed = new MessageEmbed()
                            .setColor('#8888ff')
                            .setTitle('Debug Info')
                            .setDescription('Debug information for the response')
                            .addFields(
                                { name: 'Operating mode', value: actual_operating_mode },
                                { name: 'Duration', value: `${(debug_info.total_duration / 1_000_000_000).toFixed(4)}s (Load: ${(debug_info.load_duration / 1_000_000_000).toFixed(4)}s, Evalulate: ${(debug_info.prompt_eval_duration / 1_000_000_000).toFixed(4)}s, Generate: ${(debug_info.eval_duration / 1_000_000_000).toFixed(4)}s)` },
                                { name: 'Context Length', value: `${debug_info.prompt_eval_count + debug_info.eval_count}/${context_limit} tokens (${((debug_info.prompt_eval_count + debug_info.eval_count)/context_limit*100).toFixed(2)}%, +${debug_info.eval_count} tokens)` },
                            )

                        message.channel.send({ embeds: [embed] })
                    }
                    else if (i.customId === 'regenerateResponse_' + message.id) {
                        i.deferUpdate();
                        collector.stop()
                        responseToMessage(client, message, USE_NATIVE_EMBEDDING ? content : "", false, true, USE_NATIVE_EMBEDDING ? old_ctx.length : 0)
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