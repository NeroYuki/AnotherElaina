const endpoint = 'http://127.0.0.1:11434'

function chat_completion(model, context) {
    return new Promise((resolve, reject) => {
        fetch(endpoint + '/api/chat', {
            method: 'POST',
            body: JSON.stringify({
                model: 'test_qwen_lite',
                stream: false,
                messages: context
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
            resolve(res)
        }).catch(err => {
            reject(err)
        })
    })
}

function text_completion(model, prompt, options, system_prompt, callback) {
    fetch(endpoint + '/api/generate', {
        method: 'POST',
        body: JSON.stringify({
            model: 'test_qwen_lite',
            stream: false,
            prompt: prompt,
            options: options,
            system: system_prompt
        }),
        headers: {
            'Content-Type': 'application/json'
        }
    }).then(async res => {
        if (res.ok) {
            const json = await res.json()
            callback(json)
        }
        else {
            let txt = await res.text()
            console.log(txt)
        }
    }).catch(err => {
        console.log(err)
    })
}

function text_completion_stream(model, prompt, options, system_prompt, callback) {
    fetch(endpoint + '/api/generate', {
        method: 'POST',
        body: JSON.stringify({
            model: 'test_qwen_lite',
            stream: true,
            prompt: prompt,
            options: options,
            system: system_prompt
        }),
        headers: {
            'Content-Type': 'application/json'
        }
    }).then(async res => {
        if (res.ok) {
            const reader = res.body.getReader()
            let decoder = new TextDecoder()
            let try_json = ''
            reader.read().then(function processText({ done, value }) {
                let text = decoder.decode(value, { stream: true })
                if (!text) {
                    callback(null, true)
                    return
                }
                //console.log(text)
                // if text is not a valid json, append it to malform_json and read next
                try_json += text
                try {
                    var obj = JSON.parse(try_json)
                    try_json = ''

                    if (done || obj.done) {
                        callback(obj, true)
                    }
                    else {
                        callback(obj, false)
                        return reader.read().then(processText)
                    }
                }
                catch (e) {
                    console.log('malformed json, attempting to read more...')
                    return reader.read().then(processText)
                }
            }).catch(err => {
                console.log(try_json)
                console.log(err)
            })
        }
        else {
            let txt = await res.text()
            console.log(txt)
        }
    }).catch(err => {
        console.log(err)
    })
}

function unload_model(model) {
    return new Promise((resolve, reject) => {
        fetch(endpoint + '/api/generate', {
            method: 'POST',
            body: JSON.stringify({
                model: 'test_qwen_lite',
                keep_alive: 0
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
            resolve("Model unloaded")
        }).catch(err => {
            reject(err)
        })
    })
}

function fallback_to_resource_saving() {
    return new Promise(async (resolve, reject) => {
        // unload the test model
        // if (globalThis.operating_mode === "6bit") {
        //     await unload_model('test')
        // }

        // if (globalThis.operating_mode === "uncensored") {
        //     await unload_model('test_uncen')
        // }

        // if (globalThis.operating_mode === "vision") {
        //     await unload_model('test_vision')
        // }
        if (globalThis.operating_mode === "disabled" || globalThis.operating_mode === "4bit") {
            return
        }

        if (globalThis.operating_mode === "6bit") {
            await unload_model('test_poppy_gpu').catch(err => {
                console.log(err)
            })
        }

        let previous_mode = globalThis.operating_mode
        globalThis.operating_mode = "4bit"

        // setup the timeout to load back the 6bit model
        setTimeout(async () => {
            if (globalThis.operating_mode === "disabled" || globalThis.operating_mode === "4bit") {
                return
            }

            await unload_model('test').catch(err => {
                console.log(err)
            })
            globalThis.operating_mode = previous_mode
        }, 1000 * 60 * 10)
    })
}

module.exports = {
    chat_completion,
    unload_model,
    fallback_to_resource_saving,
    text_completion_stream,
    text_completion
}