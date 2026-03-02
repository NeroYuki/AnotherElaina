const { context_storage } = require('../utils/text_gen_store');
var { is_generating } = require('../utils/text_gen_store');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { text_completion_stream, text_completion } = require('../utils/lmstudio_request');
const { text_completion: gemini_text_completion, text_completion_stream: gemini_text_completion_stream } = require('../utils/gemini_request');
const { loadImage } = require('../utils/load_discord_img');
const { operatingMode2Config, buildPrompt } = require('../utils/chat_options');
const comfyClient = require('../utils/comfy_client');
const { getBestOperatingMode, getOperatingModeStatus } = require('../utils/operating_mode_selector');

async function responseToMessage(client, message, content, is_continue = false, is_regen = false, ctx_enc_len = 0) {

    let operating_mode = globalThis.operating_mode
    let forced_mode = null // Track if mode is forced by tokens
    let should_think = false // Track if thinking is enabled

    // Convert attachment_options from a map to an array if needed
    let attachment_options = Array.isArray(message.attachments)
        ? message.attachments.filter(attachment => attachment.contentType.startsWith('image'))
        : Array.from(message.attachments.values()).filter(attachment => attachment.contentType.startsWith('image'));
    if (attachment_options.length === 0 && message.embeds[0]?.image) {
        attachment_options = [message.embeds[0].image];
    }
    let attachments = []
    
    // Check for special tokens in the content and modify accordingly
    if (content) {
        // Check for <think> token - enables thinking mode
        if (content.includes('<think>')) {
            should_think = true
            content = content.replace(/<think>/g, '').trim()
            console.log('[Token Override] <think> token detected - enabling thinking mode')
        }
        
        // Check for <local> token - forces auto_local mode for this message
        if (content.includes('<local>')) {
            forced_mode = 'auto_local'
            content = content.replace(/<local>/g, '').trim()
            console.log('[Token Override] <local> token detected - forcing auto_local mode for this message')
        }
        
        // Check for <unsafe> token - forces uncensored mode
        if (content.includes('<unsafe>')) {
            forced_mode = 'uncensored'
            content = content.replace(/<unsafe>/g, '').trim()
            console.log(`[Token Override] <unsafe> token detected - forcing uncensored mode for this message`)
        }
    }

    // Use forced mode if available, otherwise use global operating mode
    const current_mode = forced_mode || globalThis.operating_mode

    if (current_mode === "auto" || current_mode === "auto_local") {
        const hasImages = attachment_options && attachment_options.length > 0
        
        // Determine if we should avoid online modes
        const localOnly = current_mode === "auto_local"
        
        // Get the best operating mode considering rate limits and system status
        operating_mode = getBestOperatingMode(hasImages, localOnly)
        
        // Special case: if thinking is enabled and we're in auto_local mode, 
        // and we haven't fallen back to saving mode, switch to uncensored_thinking for thinking capability
        if (should_think && localOnly && !hasImages && operating_mode !== 'saving') {
            console.log('[Thinking Mode] Switching to uncensored mode for thinking capability in auto_local')
            operating_mode = 'uncensored_thinking'
        }
        else if (localOnly && ['saving', 'standard'].includes(operating_mode)) {
            should_think = false // Reset thinking mode if not applicable
        }
        
        // Log the mode selection reasoning
        console.log(`[${current_mode.toUpperCase()} Mode] Selected operating mode:`, operating_mode)
        if (forced_mode) {
            console.log(`[Token Override] Mode forced by token: ${forced_mode}`)
        }
        if (localOnly) {
            console.log('[AUTO_LOCAL Mode] Online modes disabled by user preference')
        }
        if (should_think) {
            console.log('[Thinking Mode] Thinking enabled for this message')
        }
        
        // Load images if we have any (all modes now support vision)
        if (hasImages) {
            for (let i = 0; i < attachment_options.length; i++) {
                attachments.push(await loadImage(attachment_options[i].proxyURL, false, true).catch((err) => {
                    console.log(err)
                    message.channel.send("SYSTEM: I cannot load the image. Please try again with another image.")
                    return
                }))
            }
        }
    } else if (forced_mode) {
        // If mode is forced by token, use it directly
        operating_mode = forced_mode
        console.log(`[Forced Mode] Using ${operating_mode} mode due to token override`)
        
        // Load images if we have any (all modes now support vision)
        const hasImages = attachment_options && attachment_options.length > 0
        if (hasImages) {
            for (let i = 0; i < attachment_options.length; i++) {
                attachments.push(await loadImage(attachment_options[i].proxyURL, false, true).catch((err) => {
                    console.log(err)
                    message.channel.send("SYSTEM: I cannot load the image. Please try again with another image.")
                    return
                }))
            }
        }
        else if (should_think) {
            console.log('[Thinking Mode] Thinking enabled for this message in forced mode')
            operating_mode = operating_mode === 'uncensored' ? 'uncensored_thinking' : operating_mode
        }
    }

    if ((globalThis.operating_mode === "disabled" && !forced_mode) || !operatingMode2Config[operating_mode]) {
        if (!operatingMode2Config[operating_mode]) {
            message.channel.send(`SYSTEM: Operating mode "${operating_mode}" is not configured. Please contact an administrator.`)
        } else {
            message.channel.send("Elaina is sleeping right now. Please try again later.")
        }
        return
    }

    const prompt_config = operatingMode2Config[operating_mode].prompt_config

    // get the context from the context storage
    const context_meta = context_storage.get(message.author.id)
    let context = []
    let is_using_channel_context = false    
    if (context_meta?.use_channel_context ?? false) {
        if (context_storage.has(message.channel.id) && (context_storage.get(message.channel.id)?.is_channel_context ?? false)) {
            context = context_storage.get(message.channel.id).messages
        }
        else {
            context_storage.set(message.channel.id, {
                is_channel_context: true,
                messages: [],
            })
            context = context_storage.get(message.channel.id).messages
        }
        is_using_channel_context = true
    }
    else {
        context = context_storage.get(message.author.id)?.messages ?? []
    }

    if (content) {
        if (!context) {
            context = [{ role: message.author.username, content: content}]
        }
        else {
            context.push({ role: message.author.username, content: content })
        }
    }
    else {
        if (is_regen) {
            // find the last bot message and remove it
            let last_bot_message = context.findLastIndex((msg) => msg.role === "bot")
            if (last_bot_message === -1) {
                message.channel.send("SYSTEM: I cannot regenerate the response. Please try again.")
                return
            }
            context.splice(last_bot_message, 1)
        }
        else if (is_continue) {
            // this is intentionally left blank
        }
        else {
            message.channel.send("SYSTEM: You somehow sent an invalid chat. Please try again")
            return
        }
    }

    let options = operatingMode2Config[operating_mode].override_options

    // Trim context so it doesn't exceed ~num_ctx*4 characters before building the prompt
    let total_length = context.reduce((acc, val) => acc + val.content.length, 0)
    while (total_length > options.num_ctx * 4) {
        context.shift()
        total_length = context.reduce((acc, val) => acc + val.content.length, 0)
    }

    let prompt = ''
    if (["online", "online_lite"].includes(operating_mode)) {
        // Build prompt using prompt_config for Gemini API
        let scenario = prompt_config.scenario
        prompt = `${scenario}`
        for (let i = 0; i < context.length; i++) {
            if (context[i].role !== 'bot') {
                prompt += `${prompt_config.user_message(context[i].role).prefix}${context[i].content}${prompt_config.user_message(context[i].role).suffix}` + "\n"
            }
            else {
                prompt += `${prompt_config.bot_message.prefix}${context[i].content}${prompt_config.bot_message.suffix}` + "\n"
            }
        }
        if (is_continue) {
            // Gemini is a generative API, not a text completion API — can't leave a message "open".
            // Instead, add a continuation instruction so the model picks up where it left off.
            prompt += `${prompt_config.user_message("user").prefix}Continue your previous response seamlessly from where you stopped. Do not repeat what you already said, do not add greetings or preamble.${prompt_config.user_message("user").suffix}` + "\n"
            prompt += prompt_config.bot_message.prefix
        }
        else {
            prompt += prompt_config.bot_message.prefix
        }
    } else {
        // Build prompt using jinja template format for LM Studio local models
        prompt = buildPrompt(operatingMode2Config[operating_mode], context, is_continue, ['web-search'])
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
                .setLabel(is_using_channel_context ? '👥 User conversation' : '🌐 Channel conversation')
                .setStyle('SECONDARY'),
        );
        

    const filter = i => i.user.id === message.author.id;
    
    const collector = message.channel.createMessageComponentCollector({ filter, time: 180000 });

    // console.log("Constructed prompt:")
    // console.log(prompt)

    const msgRef = await message.channel.send("...").catch((err) => {
        console.log(err)
    })

    if (!msgRef) {
        return
    }

    try {
        let res_gen_elaina = ''
        let is_done = false
        let debug_info = {}
        if (globalThis.stream_response !== true) {
            if (["online", "online_lite"].includes(operating_mode)) {
                gemini_text_completion(operatingMode2Config[operating_mode], prompt, (value) => {
                    res_gen_elaina += value.response
                    debug_info = value
                    is_done = true
                }, attachments, operating_mode, should_think)
            }
            else {
                text_completion(operatingMode2Config[operating_mode], prompt, (value) => {
                    res_gen_elaina += value.response
                    debug_info = value
                    is_done = true
                }, attachments, should_think, context)
            }
        }
        else {
            if (["online", "online_lite"].includes(operating_mode)) {
                gemini_text_completion_stream(operatingMode2Config[operating_mode], prompt, (value, done) => {
                    if (!value || done) {
                        is_done = true
                        if (!value) return  
                        debug_info = value
                    }
                    res_gen_elaina += value.response
                }, attachments, operating_mode, should_think)
            }
            else {
                text_completion_stream(operatingMode2Config[operating_mode], prompt, (value, done) => {
                    if (!value || done) {
                        is_done = true
                        if (!value) return
                        debug_info = value
                    }
                    res_gen_elaina += value.response
                }, attachments, should_think, context)
            }
        }

        const intervalId = setInterval(() => {
            if (!res_gen_elaina) return
            // if operating mode is 'uncensored_thinking', we need to filter out the <think> to </think> portion (consider multi line text)
            if (operating_mode === 'uncensored_thinking') {
                const thinkRegex = /<think>[\s\S]*?<\/think>/g;
                res_gen_elaina = res_gen_elaina.replace(thinkRegex, '').trim();
                const thinkRegex2 = /^[\s\S]*?<\/think>/g;
                res_gen_elaina = res_gen_elaina.replace(thinkRegex2, '').trim();
            }
            
            msgRef.edit(`<@${message.author.id}> ${res_gen_elaina}`)

            if (is_done) {
                clearInterval(intervalId)
                console.log("done")
                if (["standard"].includes(operating_mode)) {
                    if (globalThis.llm_load_timer) {
                        console.log("LLM load timer resetted")
                        clearTimeout(globalThis.llm_load_timer)
                    }
                    console.log("LLM load timer started")
                    globalThis.llm_load_timer = setTimeout(() => {
                        globalThis.llm_load_timer = null
                        console.log("LLM load timer expired")
                    }, 1000 * (60 * 5 + 5))
                }

                if (context[context.length - 1].role === "bot") {
                    const previous_response = context.pop().content
                    context.push({ role: "bot", content: previous_response + res_gen_elaina })
                }
                else {
                    context.push({ role: "bot", content: res_gen_elaina })
                }

                context_storage.set(message.author.id, {
                    use_channel_context: is_using_channel_context,
                    messages: context,
                })

                msgRef.edit({ content: `<@${message.author.id}> ${res_gen_elaina}`, components: [row] })

                collector.on('collect', async i => {
                    if (i.customId === 'deleteContext_' + message.id) {
                        i.deferUpdate();
                        context_storage.delete(message.author.id)
                        message.channel.send(`<@${message.author.id}> Let's start over shall we?`)
                    }
                    else if (i.customId === 'continueResponse_' + message.id) {
                        i.deferUpdate();
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
                                { name: 'Context ID', value: `${is_using_channel_context ? "Channel" : "User"} ${is_using_channel_context ? message.channel.id : message.author.id}` },
                            )

                        message.channel.send({ embeds: [embed] })
                    }
                    else if (i.customId === 'regenerateResponse_' + message.id) {
                        i.deferUpdate();
                        responseToMessage(client, message, "", false, true, 0)
                    }
                    else if (i.customId === 'switchContext_' + message.id) {
                        i.deferUpdate();
                        // update message.author.id context_storage to have use_channel_context reversed
                        if (context_storage.has(message.author.id)) {
                            const is_cur_channel_context = context_storage.get(message.author.id)?.use_channel_context ?? false
                            context_storage.set(message.author.id, {
                                ...context_storage.get(message.author.id),
                                use_channel_context: !is_cur_channel_context,
                            })
                            message.channel.send(`<@${message.author.id}> Switched to ${!is_cur_channel_context ? "channel" : "user"} context`)
                        }
                        else {
                            context_storage.set(message.author.id, {
                                use_channel_context: true,
                                messages: context,
                            })
                        }
                        if (context_storage.get(message.author.id).use_channel_context) {
                            // if channel context is used but not message.channel.id entry is not found, create it and copy the context from message.author.id
                            if (context_storage.has(message.channel.id)) {
                                // if entry is found, append the context to it and avoid duplicate messages
                                let channel_context = context_storage.get(message.channel.id).messages
                                for (let i = 0; i < context.length; i++) {
                                    if (!channel_context.find((msg) => msg.role === context[i].role && msg.content === context[i].content)) {
                                        channel_context.push(context[i])
                                    }
                                }

                                context_storage.set(message.channel.id, {
                                    is_channel_context: true,
                                    messages: channel_context,
                                })
                            }
                            else {
                                context_storage.set(message.channel.id, {
                                    is_channel_context: true,
                                    // clone context to avoid reference issue
                                    messages: [...context]
                                })
                            }
                        }
                    }
                })
            }
        }, 2000)
    }
    catch (error) {
        console.log(error)
        await interaction.editReply(reponse +  "ERROR: " + error)
    }
}

module.exports = {
    responseToMessage
}