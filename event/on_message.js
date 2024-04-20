const { context_storage } = require('../utils/text_gen_store');
var { is_generating } = require('../utils/text_gen_store');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { chat_completion } = require('../utils/ollama_request');

async function responseToMessage(client, message, content) {
    let prompt = content

    if (globalThis.operating_mode === "disabled") {
        message.channel.send("Elaina is sleeping right now. Please try again later.")
        return
    }

    if (is_generating) {
        return
    }

    // get the context from the context storage
    let context = context_storage.get(message.author.id)
    if (context === undefined) {
        context = [{ role: "user", content: prompt }]
    }
    else {
        context.push({ role: "user", content: prompt })
    }

    // if the total length of content in the context is more than 40000 characters, remove the oldest content
    let total_length = context.reduce((acc, val) => acc + val.content.length, 0)
    while (total_length > 40000) {
        context.shift()
        total_length = context.reduce((acc, val) => acc + val.content.length, 0)
    }

    const row = new MessageActionRow()
        .addComponents(
            new MessageButton()
                .setCustomId('deleteContext_' + message.id)
                .setLabel('Forget everything we have said')
                .setStyle('DANGER'),
        );

    const filter = i => i.customId === ('deleteContext_' + message.id) && i.user.id === message.author.id;

    const collector = message.channel.createMessageComponentCollector({ filter, time: 180000 });

    collector.on('collect', async i => {
        if (i.customId === 'deleteContext_' + message.id) {
            i.deferUpdate();
            collector.stop()
            context_storage.delete(message.author.id)
            message.channel.send(`<@${message.author.id}> Let's start over shall we?`)
        }
    });

    try {
        is_generating = true
        // measure speed
        const start = Date.now()
        console.log(`Operating mode: ${globalThis.operating_mode}`)
        await message.channel.sendTyping();
        
        const res_gen = await chat_completion(globalThis.operating_mode === "6bit" ? "test" : "test4b", context)
        
        let res_gen_elaina = res_gen.message.content

        // sanitize the response
        // remove all marking token <|im_start|> and <|im_end|>
        res_gen_elaina = res_gen_elaina.replace(/<\|im_start\|>/g, "")
        res_gen_elaina = res_gen_elaina.replace(/<\|im_end\|>/g, "")
        // if res_gen_elaina end with "assistant", remove it
        if (res_gen_elaina.endsWith("assistant")) {
            res_gen_elaina = res_gen_elaina.slice(0, -9)
        }

        // add the response to the context
        context.push({ role: "assistant", content: res_gen_elaina })
        // store the context
        context_storage.set(message.author.id, context)
        is_generating = false

        // append message author mention to the response
        res_gen_elaina = `<@${message.author.id}> ${res_gen_elaina}`

        message.channel.send({ content: res_gen_elaina, components: [row] })
        console.log(`Time taken: ${Date.now() - start}ms`)

        
    } catch (err) {
        is_generating = false
        console.log(err)
        message.channel.send('SYSTEM: Something went wrong. Please try again later.')
        return
    }
}

module.exports = {
    responseToMessage
}