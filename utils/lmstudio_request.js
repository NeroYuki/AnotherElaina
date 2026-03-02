const { server_pool } = require("./ai_server_config")
const { operatingMode2Config } = require("./chat_options")

/// <deprecated>
function chat_completion(model, context) {
    return new Promise((resolve, reject) => {
        const messages = context.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : (msg.role === 'system' ? 'system' : 'user'),
            content: msg.content
        }))

        fetch('http://127.0.0.1:1234/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({
                model: model,
                stream: false,
                messages: messages
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }).then(res => {
            if (res.ok) {
                return res.json()
            }
            else {
                reject(new Error('Request failed'))
            }
        }).then(res => {
            resolve({
                message: {
                    role: 'assistant',
                    content: res.choices?.[0]?.message?.content || ''
                },
                done: true
            })
        }).catch(err => {
            reject(err)
        })
    })
}

function text_completion(config, prompt, callback, images = [] /* list of base64 encoded images */, should_think = false, context = []) {
    console.log(should_think ? "Thinking mode enabled" : "Thinking mode disabled")
    const start_time = Date.now()
    const model = config.model

    // If images are provided and we have context, use /v1/chat/completions with multimodal messages
    if (images.length > 0 && context.length > 0) {
        const messages = [
            { role: "system", content: config.prompt_config.system_prompt },
            ...context.map(msg => ({
                role: msg.role === "bot" ? "assistant" : "user",
                ...(msg.role !== "bot" ? { name: msg.role.replace(/[^a-zA-Z0-9_-]/g, '_') } : {}),
                content: msg.content
            }))
        ]

        // Attach images to the last user message
        const lastUserIdx = messages.findLastIndex(m => m.role === "user")
        if (lastUserIdx !== -1) {
            const lastMsg = messages[lastUserIdx]
            messages[lastUserIdx] = {
                role: lastMsg.role,
                ...(lastMsg.name ? { name: lastMsg.name } : {}),
                content: [
                    { type: "text", text: typeof lastMsg.content === 'string' ? lastMsg.content : '' },
                    ...images.map(img => ({
                        type: "image_url",
                        image_url: { url: `data:image/jpeg;base64,${img}` }
                    }))
                ]
            }
        }

        fetch('http://' + config.server + '/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({
                model: model,
                stream: false,
                messages: messages,
                max_tokens: config.override_options?.num_predict || 400,
                stop: config.override_options?.stop || [],
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }).then(async res => {
            if (res.ok) {
                const json = await res.json()
                const end_time = Date.now()
                callback({
                    response: json.choices?.[0]?.message?.content || '',
                    done: true,
                    model: json.model || model,
                    total_duration: (end_time - start_time) * 1_000_000,
                    load_duration: 0,
                    prompt_eval_count: json.usage?.prompt_tokens || 0,
                    prompt_eval_duration: 0,
                    eval_count: json.usage?.completion_tokens || 0,
                    eval_duration: (end_time - start_time) * 1_000_000,
                })
            }
            else {
                let txt = await res.text()
                console.log(`[LM Studio API Error] ${txt}`)
            }
        }).catch(err => {
            console.log(err)
        })
    } else {
        // No images - use /v1/completions with raw prompt
        // System prompt is already included in the prompt via buildPrompt()

        fetch('http://' + config.server + '/v1/completions', {
            method: 'POST',
            body: JSON.stringify({
                model: model,
                stream: false,
                prompt: prompt,
                max_tokens: config.override_options?.num_predict || 400,
                stop: config.override_options?.stop || [],
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }).then(async res => {
            if (res.ok) {
                const json = await res.json()
                const end_time = Date.now()
                callback({
                    response: json.choices?.[0]?.text || '',
                    done: true,
                    model: json.model || model,
                    total_duration: (end_time - start_time) * 1_000_000,
                    load_duration: 0,
                    prompt_eval_count: json.usage?.prompt_tokens || 0,
                    prompt_eval_duration: 0,
                    eval_count: json.usage?.completion_tokens || 0,
                    eval_duration: (end_time - start_time) * 1_000_000,
                })
            }
            else {
                let txt = await res.text()
                console.log(`[LM Studio API Error] ${txt}`)
            }
        }).catch(err => {
            console.log(err)
        })
    }
}

function text_completion_stream(config, prompt, callback, images = [] /* list of base64 encoded images */, should_think = false, context = []) {
    const model = config.model
    const start_time = Date.now()

    const useChat = images.length > 0 && context.length > 0
    let url, body

    if (useChat) {
        // Use /v1/chat/completions for multimodal (image) requests
        const messages = [
            { role: "system", content: config.prompt_config.system_prompt },
            ...context.map(msg => ({
                role: msg.role === "bot" ? "assistant" : "user",
                ...(msg.role !== "bot" ? { name: msg.role.replace(/[^a-zA-Z0-9_-]/g, '_') } : {}),
                content: msg.content
            }))
        ]

        // Attach images to the last user message
        const lastUserIdx = messages.findLastIndex(m => m.role === "user")
        if (lastUserIdx !== -1) {
            const lastMsg = messages[lastUserIdx]
            messages[lastUserIdx] = {
                role: lastMsg.role,
                ...(lastMsg.name ? { name: lastMsg.name } : {}),
                content: [
                    { type: "text", text: typeof lastMsg.content === 'string' ? lastMsg.content : '' },
                    ...images.map(img => ({
                        type: "image_url",
                        image_url: { url: `data:image/jpeg;base64,${img}` }
                    }))
                ]
            }
        }

        url = 'http://' + config.server + '/v1/chat/completions'
        body = {
            model: model,
            stream: true,
            messages: messages,
            max_tokens: config.override_options?.num_predict || 400,
            stop: config.override_options?.stop || [],
        }
    } else {
        // Use /v1/completions with raw prompt
        // System prompt is already included via buildPrompt()

        url = 'http://' + config.server + '/v1/completions'
        body = {
            model: model,
            stream: true,
            prompt: prompt,
            max_tokens: config.override_options?.num_predict || 400,
            stop: config.override_options?.stop || [],
        }
    }

    fetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
            'Content-Type': 'application/json'
        }
    }).then(async res => {
        if (res.ok) {
            const reader = res.body.getReader()
            let decoder = new TextDecoder()
            let buffer = ''
            let completionTokens = 0
            let promptTokens = 0

            function finishStream() {
                const end_time = Date.now()
                callback({
                    response: '',
                    done: true,
                    model: model,
                    total_duration: (end_time - start_time) * 1_000_000,
                    load_duration: 0,
                    prompt_eval_count: promptTokens,
                    prompt_eval_duration: 0,
                    eval_count: completionTokens,
                    eval_duration: (end_time - start_time) * 1_000_000,
                }, true)
            }

            reader.read().then(function processText({ done, value }) {
                if (done) {
                    finishStream()
                    return
                }

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed || !trimmed.startsWith('data: ')) continue

                    const jsonStr = trimmed.substring(6)
                    if (jsonStr === '[DONE]') {
                        finishStream()
                        return
                    }

                    try {
                        const obj = JSON.parse(jsonStr)
                        let deltaText = useChat
                            ? (obj.choices?.[0]?.delta?.content || '')
                            : (obj.choices?.[0]?.text || '')

                        // Capture usage data if provided by the server
                        if (obj.usage) {
                            promptTokens = obj.usage.prompt_tokens || promptTokens
                            completionTokens = obj.usage.completion_tokens || completionTokens
                        }

                        if (deltaText) {
                            completionTokens++
                            callback({ response: deltaText, done: false }, false)
                        }
                    }
                    catch (e) {
                        // Incomplete JSON chunk, will be completed on next read
                    }
                }

                return reader.read().then(processText)
            }).catch(err => {
                console.log(err)
                callback(null, true)
            })
        }
        else {
            let txt = await res.text()
            console.log(`[LM Studio Streaming API Error] ${txt}`)
        }
    }).catch(err => {
        console.log(err)
    })
}

function unload_model(model) {
    // Find which server hosts this model from operatingMode2Config
    const { operatingMode2Config } = require('./chat_options')
    let server = null
    for (const config of Object.values(operatingMode2Config)) {
        if (config.model === model && config.server && !config.server.startsWith('https://')) {
            server = config.server
            break
        }
    }
    if (!server) {
        console.log(`[LM Studio] No local server found for model "${model}", skipping unload`)
        return Promise.resolve(false)
    }

    console.log(`[LM Studio] Unloading model "${model}" from ${server}`)
    return fetch(`http://${server}/api/v1/models/unload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance_id: model })
    }).then(res => {
        if (res.ok) {
            console.log(`[LM Studio] Model "${model}" unloaded successfully`)
            return true
        }
        return res.text().then(txt => {
            console.log(`[LM Studio] Failed to unload model "${model}": ${txt}`)
            return false
        })
    }).catch(err => {
        console.log(`[LM Studio] Error unloading model "${model}": ${err}`)
        return false
    })
}

function free_up_llm_resource(server_url = server_pool[0].url) {
    const ip_address_pattern = /(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/
    const match = ip_address_pattern.exec(server_url)
    if (!match) {
        return Promise.reject(new Error('[LM Studio] Invalid server address for free_up_llm_resource'))
    }
    const lm_server = `http://${match[0]}:1234`

    return fetch(`${lm_server}/api/v1/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    }).then(res => {
        if (!res.ok) throw new Error(`Failed to list models: ${res.status}`)
        return res.json()
    }).then(data => {
        const unload_promises = []
        for (const model of data.models) {
            for (const instance of model.loaded_instances) {
                console.log(`[LM Studio] Unloading instance: ${instance.id}`)
                unload_promises.push(
                    fetch(`${lm_server}/api/v1/models/unload`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ instance_id: instance.id })
                    })
                )
            }
        }
        if (unload_promises.length === 0) {
            console.log(`[LM Studio] No loaded models to unload on ${lm_server}`)
            return true
        }
        return Promise.all(unload_promises).then(results => {
            const all_ok = results.every(r => r.ok)
            if (!all_ok) throw new Error('Some models failed to unload')
            console.log(`[LM Studio] All models unloaded from ${lm_server}`)
            return true
        })
    }).catch(err => {
        console.log(`[LM Studio] free_up_llm_resource error: ${err}`)
        throw err
    })
}

module.exports = {
    chat_completion,
    unload_model,
    free_up_llm_resource,
    text_completion_stream,
    text_completion
}
