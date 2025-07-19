require('dotenv').config()

const { rateLimiter } = require('./rate_limiter')

// Gemini API endpoint - you'll need to set your API key as an environment variable
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'your-api-key-here'
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Check if we can make a request based on the operating mode
 * @param {string} operatingMode - The operating mode (online, online_lite, etc.)
 * @returns {boolean} - true if request can be made, false if rate limited
 */
function canMakeGeminiRequest(operatingMode) {
    if (operatingMode === 'online' || operatingMode === 'online_lite') {
        return rateLimiter.canMakeRequest(operatingMode)
    }
    return true // No rate limiting for other modes
}

/**
 * Record a request for rate limiting purposes
 * @param {string} operatingMode - The operating mode (online, online_lite, etc.)
 */
function recordGeminiRequest(operatingMode) {
    if (operatingMode === 'online' || operatingMode === 'online_lite') {
        rateLimiter.recordRequest(operatingMode)
        rateLimiter.logStatus(operatingMode)
    }
}

/// <deprecated>
function chat_completion(model, context) {
    return new Promise((resolve, reject) => {
        // Convert messages to Gemini format
        const contents = context.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : msg.role,
            parts: [{ text: msg.content }]
        }))

        fetch(`${GEMINI_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            body: JSON.stringify({
                contents: contents,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 500,
                }
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
            // Convert Gemini response to ollama-like format
            const response = {
                message: {
                    role: 'assistant',
                    content: res.candidates?.[0]?.content?.parts?.[0]?.text || ''
                },
                done: true
            }
            resolve(response)
        }).catch(err => {
            reject(err)
        })
    })
}

function text_completion(config, prompt, callback, images = [] /* list of base64 encoded images */, operatingMode = 'online') {
    // Record the request for rate limiting
    recordGeminiRequest(operatingMode)
    
    const model = config.model || 'gemini-2.5-flash'
    const systemPrompt = config.prompt_config?.system_prompt || ''
    
    // Prepare the content parts
    const parts = []
    
    // Add system prompt if available
    if (systemPrompt) {
        parts.push({ text: systemPrompt + '\n\n' + prompt })
    } else {
        parts.push({ text: prompt })
    }
    
    // Add images if provided
    images.forEach(imageBase64 => {
        parts.push({
            inline_data: {
                mime_type: 'image/jpeg', // Assuming JPEG, you might want to detect this
                data: imageBase64
            }
        })
    })

    const requestBody = {
        contents: [{ parts: parts }],
        tools: [
            {
                google_search: {}
            }
        ],
        generationConfig: {
            thinkingConfig: {
                thinkingBudget: 0
            },
            temperature: config.override_options?.temperature || 0.7,
            maxOutputTokens: config.override_options?.max_tokens || 500,
            topP: config.override_options?.top_p || 0.9,
            topK: config.override_options?.top_k || 40,
        }
    }

    fetch(`${GEMINI_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
            'Content-Type': 'application/json'
        }
    }).then(async res => {
        if (res.ok) {
            const json = await res.json()
            // Convert to ollama-like response format
            const response = {
                response: json.candidates?.[0]?.content?.parts?.[0]?.text || '',
                done: true,
                context: [],
                total_duration: 0,
                load_duration: 0,
                prompt_eval_count: 0,
                prompt_eval_duration: 0,
                eval_count: 0,
                eval_duration: 0,
                model: model
            }
            callback(response)
        }
        else {
            let txt = await res.text()
            console.log(`[Gemini API Error] ${operatingMode}: Status ${res.status} - ${txt}`)
            
            // Handle rate limit errors
            if (res.status === 429) {
                console.log(`[Rate Limit] ${operatingMode} mode hit API rate limit`)
                // Call callback with error response
                callback({
                    response: `SYSTEM: ${operatingMode} mode temporarily unavailable due to rate limits. Please try again later.`,
                    done: true,
                    error: 'rate_limit',
                    model: model
                })
            } else {
                callback({
                    response: `SYSTEM: ${operatingMode} mode encountered an error. Please try again later.`,
                    done: true,
                    error: 'api_error',
                    model: model
                })
            }
        }
    }).catch(err => {
        console.log(`[Gemini Request Error] ${operatingMode}:`, err)
        callback({
            response: `SYSTEM: ${operatingMode} mode is currently unavailable due to network issues.`,
            done: true,
            error: 'network_error',
            model: model
        })
    })
}

function text_completion_stream(config, prompt, callback, images = [] /* list of base64 encoded images */, operatingMode = 'online') {
    // Record the request for rate limiting
    recordGeminiRequest(operatingMode)
    
    const model = config.model || 'gemini-2.5-flash'
    const systemPrompt = config.prompt_config?.system_prompt || ''
    
    // Prepare the content parts
    const parts = []
    
    // Add system prompt if available
    if (systemPrompt) {
        parts.push({ text: systemPrompt + '\n\n' + prompt })
    } else {
        parts.push({ text: prompt })
    }
    
    // Add images if provided
    images.forEach(imageBase64 => {
        parts.push({
            inline_data: {
                mime_type: 'image/jpeg',
                data: imageBase64
            }
        })
    })

    const requestBody = {
        contents: [{ parts: parts }],
        generationConfig: {
            temperature: config.override_options?.temperature || 0.7,
            maxOutputTokens: config.override_options?.max_tokens || 500,
            topP: config.override_options?.top_p || 0.9,
            topK: config.override_options?.top_k || 40,
        }
    }

    fetch(`${GEMINI_BASE_URL}/${model}:streamGenerateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
            'Content-Type': 'application/json'
        }
    }).then(async res => {
        if (res.ok) {
            const reader = res.body.getReader()
            let decoder = new TextDecoder()
            let buffer = ''
            
            reader.read().then(function processText({ done, value }) {
                if (done) {
                    callback({ response: '', done: true }, true)
                    return
                }
                
                let text = decoder.decode(value, { stream: true })
                buffer += text
                
                // Process complete JSON objects in the buffer
                const lines = buffer.split('\n')
                buffer = lines.pop() || '' // Keep incomplete line in buffer
                
                for (const line of lines) {
                    if (line.trim() && line.startsWith('data: ')) {
                        try {
                            const jsonStr = line.substring(6) // Remove 'data: ' prefix
                            if (jsonStr.trim() === '[DONE]') {
                                callback({ response: '', done: true }, true)
                                return
                            }
                            
                            const obj = JSON.parse(jsonStr)
                            const deltaText = obj.candidates?.[0]?.content?.parts?.[0]?.text || ''
                            
                            if (deltaText) {
                                const response = {
                                    response: deltaText,
                                    done: false
                                }
                                callback(response, false)
                            }
                        } catch (e) {
                            console.log('Error parsing streaming response:', e)
                        }
                    }
                }
                
                return reader.read().then(processText)
            }).catch(err => {
                console.log('Stream reading error:', err)
                callback({ response: '', done: true }, true)
            })
        }
        else {
            let txt = await res.text()
            console.log(`[Gemini Streaming API Error] ${operatingMode}: Status ${res.status} - ${txt}`)
            
            // Handle rate limit errors
            if (res.status === 429) {
                console.log(`[Rate Limit] ${operatingMode} mode hit API rate limit (streaming)`)
                callback({
                    response: `SYSTEM: ${operatingMode} mode temporarily unavailable due to rate limits. Please try again later.`,
                    done: true,
                    error: 'rate_limit',
                    model: model
                }, true)
            } else {
                callback({
                    response: `SYSTEM: ${operatingMode} mode encountered an error. Please try again later.`,
                    done: true,
                    error: 'api_error',
                    model: model
                }, true)
            }
        }
    }).catch(err => {
        console.log(`[Gemini Streaming Request Error] ${operatingMode}:`, err)
        callback({
            response: `SYSTEM: ${operatingMode} mode is currently unavailable due to network issues.`,
            done: true,
            error: 'network_error',
            model: model
        }, true)
    })
}

module.exports = {
    chat_completion,
    text_completion_stream,
    text_completion,
    canMakeGeminiRequest,
    recordGeminiRequest
}
