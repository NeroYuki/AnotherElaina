const { context_storage } = require('../utils/text_gen_store');
var { is_generating } = require('../utils/text_gen_store');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { chat_completion } = require('../utils/ollama_request');
const { loadImage } = require('../utils/load_discord_img');

async function responseToMessage(client, message, content, is_continue = false, is_regen = false) {
    let prompt = content

    if (globalThis.operating_mode === "disabled") {
        message.channel.send("Elaina is sleeping right now. Please try again later.")
        return
    }

    // ìf its running on gpu mode, just queue them till the end of time, otherwise if queue is more than 3 messages, just ignore it
    if (globalThis.operating_mode === "4bit" && is_generating.length > 3) {
        return
    }

    let images = null
    if (globalThis.operating_mode === "vision") {
        images = []
        // check if there is an image attachment, get proxyURL
        if (message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                if (attachment.url.endsWith(".png") || attachment.url.endsWith(".jpg") || attachment.url.endsWith(".jpeg")) {
                    let loaded_image = await loadImage(attachment.proxyURL, false, true).catch(err => {
                        console.log(err)
                        return
                    })

                    if (loaded_image) {
                        images.push(loaded_image)
                    }
                }
            }
        }
    }

    // get the context from the context storage
    let context = context_storage.get(message.author.id)
    if (content) {
        if (context === undefined) {
            context = [{ role: "user", content: prompt, images: images}]
        }
        else {
            context.push({ role: "user", content: prompt, images: images})
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

    // if the total length of content in the context is more than 80000 characters, remove the oldest content
    let total_length = context.reduce((acc, val) => acc + val.content.length, 0)
    while (total_length > 80000) {
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
        );

    const filter = i => i.user.id === message.author.id;
    
    const collector = message.channel.createMessageComponentCollector({ filter, time: 180000 });

    try {
        is_generating.push(message.id)
        // measure speed
        const start = Date.now()
        console.log(`Operating mode: ${globalThis.operating_mode}`)
        await message.channel.sendTyping();
        
        const res_gen = await chat_completion(globalThis.operating_mode === "uncensored" ? "test_uncen" :  globalThis.operating_mode === "vision" ? "test_vision" : globalThis.operating_mode === "6bit" ? "test" : "test4b", context)
        
        let res_gen_elaina = res_gen.message.content
        let debug_info = res_gen

        // sanitize the response
        // remove all marking token <|im_start|> and <|im_end|> and <br> and <br/> and </br>
        res_gen_elaina = res_gen_elaina.replace(/\|im_start\|/g, "")
        res_gen_elaina = res_gen_elaina.replace(/\|im_end\|/g, "")
        res_gen_elaina = res_gen_elaina.replace(/<br>/g, "")
        res_gen_elaina = res_gen_elaina.replace(/<br\/>/g, "")
        res_gen_elaina = res_gen_elaina.replace(/<\/br>/g, "")
        // if res_gen_elaina end with "assistant", remove it
        if (res_gen_elaina.endsWith("assistant")) {
            res_gen_elaina = res_gen_elaina.slice(0, -9)
        }

        // add the response to the context
        if (context[context.length - 1].role === "assistant") {
            const previous_response = context.pop().content
            context.push({ role: "assistant", content: previous_response + res_gen_elaina })
        }
        else {
            context.push({ role: "assistant", content: res_gen_elaina })
        }
        // only keep the most recent 5 images in the context
        let image_count = 0
        for (let i = context.length - 1; i >= 0; i--) {
            if (context[i].images) {
                image_count += context[i].images.length
            }
            if (image_count > 5) {
                context[i].images = null
            }
        }
        // store the context
        context_storage.set(message.author.id, context)
        if (is_generating.indexOf(message.id) === -1) 
            is_generating.splice(is_generating.indexOf(message.id), 1)

        // append message author mention to the response
        res_gen_elaina = `<@${message.author.id}> ${res_gen_elaina}`

        message.channel.send({ content: res_gen_elaina, components: [row] })
        console.log(`Time taken: ${Date.now() - start}ms`)

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
                const context_limit = actual_operating_mode === "6bit" ? 16384 : 8192
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
                responseToMessage(client, message, "", false, true)
            }
        });
        
    } catch (err) {
        if (is_generating.indexOf(message.id) === -1) 
            is_generating.splice(is_generating.indexOf(message.id), 1)
        console.log(err)
        message.channel.send('SYSTEM: Something went wrong. Please try again later.')
        return
    }
}

module.exports = {
    responseToMessage
}