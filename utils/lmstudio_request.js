const { PROXY_URL, serviceHeaders } = require('./proxy_config');
const { lmstudioWorkload, workloadHeaders } = require('./orchestrator_workload');

const LM_HEADERS = serviceHeaders('unsloth');
const _nodeFetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
// Route local LLM requests through the orchestrator proxy. The service header
// selects Unsloth there; config.server is intentionally not
// used for request routing on the use-proxy branch.
const fetch = (url, options = {}) => _nodeFetch(url, {
    ...options,
    headers: { ...LM_HEADERS, ...(options.headers || {}) },
});

function completionHeaders(config, { vision = false, stream = false } = {}) {
    const contextLength = config?.override_options?.num_ctx || 8192;
    const maxTokens = config?.override_options?.num_predict || 400;
    return workloadHeaders('unsloth', lmstudioWorkload({
        model: config?.model,
        contextLength,
        maxTokens,
        vision,
        stream,
    }), { 'Content-Type': 'application/json' });
}

function openAIMessages(config, context = [], images = [], fallbackPrompt = '') {
    const messages = []
    const systemPrompt = config?.prompt_config?.system_prompt
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })

    for (const msg of context) {
        if (msg.role === 'bot') {
            messages.push({ role: 'assistant', content: msg.content || '' })
        } else if (msg.role === 'tool') {
            messages.push({ role: 'user', content: `[Tool result]\n${msg.content || ''}` })
        } else {
            // OpenAI-compatible servers disagree on `name` for user messages.
            // Keep the Discord speaker label in content instead.
            messages.push({ role: 'user', content: `${msg.role}: ${msg.content || ''}` })
        }
    }

    if (!messages.some(message => message.role === 'user') && fallbackPrompt) {
        messages.push({ role: 'user', content: fallbackPrompt })
    }

    if (messages.at(-1)?.role === 'assistant') {
        messages.push({
            role: 'user',
            content: 'Continue your previous response seamlessly. Do not repeat earlier text.'
        })
    }

    if (images.length > 0) {
        const lastUserIdx = messages.findLastIndex(m => m.role === 'user')
        if (lastUserIdx !== -1) {
            const text = typeof messages[lastUserIdx].content === 'string'
                ? messages[lastUserIdx].content : ''
            messages[lastUserIdx] = {
                role: 'user',
                content: [
                    { type: 'text', text },
                    ...images.map(img => ({
                        type: 'image_url',
                        image_url: { url: `data:image/jpeg;base64,${img}` }
                    }))
                ]
            }
        }
    }
    return messages
}

/// <deprecated>
function chat_completion(model, context) {
    return new Promise((resolve, reject) => {
        const messages = context.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : (msg.role === 'system' ? 'system' : 'user'),
            content: msg.content
        }))

        fetch(`${PROXY_URL}/v1/chat/completions`, {
            method: 'POST',
            body: JSON.stringify({
                model: model,
                stream: false,
                messages: messages
            }),
            headers: completionHeaders({ model, override_options: { num_ctx: 8192, num_predict: 400 } })
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

    const messages = openAIMessages(config, context, images, prompt)
    fetch(`${PROXY_URL}/v1/chat/completions`, {
            method: 'POST',
            body: JSON.stringify({
                model: model,
                stream: false,
                messages,
                max_tokens: config.override_options?.num_predict || 400,
                stop: config.override_options?.stop || [],
            }),
            headers: completionHeaders(config, { vision: images.length > 0 })
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
                console.log(`[Unsloth API Error] ${txt}`)
                callback({
                    response: '',
                    done: true,
                    error: `HTTP ${res.status}: ${txt}`,
                    retry_after: res.headers.get('retry-after'),
                })
            }
        }).catch(err => console.log(err))
}

function text_completion_stream(config, prompt, callback, images = [] /* list of base64 encoded images */, should_think = false, context = []) {
    const model = config.model
    const start_time = Date.now()

    const useVision = images.length > 0
    const url = `${PROXY_URL}/v1/chat/completions`
    const body = {
        model,
        stream: true,
        messages: openAIMessages(config, context, images, prompt),
        max_tokens: config.override_options?.num_predict || 400,
        stop: config.override_options?.stop || [],
    }

    fetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: completionHeaders(config, { vision: useVision, stream: true })
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
                        let deltaText = obj.choices?.[0]?.delta?.content || ''

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
            console.log(`[Unsloth Streaming API Error] ${txt}`)
            callback({
                response: '',
                done: true,
                error: `HTTP ${res.status}: ${txt}`,
                retry_after: res.headers.get('retry-after'),
            }, true)
        }
    }).catch(err => {
        console.log(err)
    })
}

function unload_model(model) {
    console.log(`[Unsloth] Unloading model "${model}" through the orchestrator proxy`)
    return fetch(`${PROXY_URL}/api/inference/unload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_path: model, force_cancel_active: false })
    }).then(res => {
        if (res.ok) {
            console.log(`[Unsloth] Model "${model}" unloaded successfully`)
            return true
        }
        return res.text().then(txt => {
            console.log(`[Unsloth] Failed to unload model "${model}": ${txt}`)
            return false
        })
    }).catch(err => {
        console.log(`[Unsloth] Error unloading model "${model}": ${err}`)
        return false
    })
}

function free_up_llm_resource() {
    return fetch(`${PROXY_URL}/api/inference/status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    }).then(res => {
        if (!res.ok) throw new Error(`Failed to list models: ${res.status}`)
        return res.json()
    }).then(data => {
        const model = data.active_model || data.loaded?.[0]
        if (!model) {
            console.log('[Unsloth] No loaded model to unload')
            return true
        }
        return fetch(`${PROXY_URL}/api/inference/unload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_path: model, force_cancel_active: false })
        }).then(res => {
            if (!res.ok) throw new Error(`Failed to unload model: ${res.status}`)
            return true
        })
    }).catch(err => {
        console.log(`[Unsloth] free_up_llm_resource error: ${err}`)
        throw err
    })
}

module.exports = {
    openAIMessages,
    chat_completion,
    unload_model,
    free_up_llm_resource,
    text_completion_stream,
    text_completion
}
