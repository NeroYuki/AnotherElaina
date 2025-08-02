const { server_pool } = require("./ai_server_config")
const { operatingMode2Config } = require("./chat_options")

const endpoint = 'http://127.0.0.1:11434'

/// <deprecated>
function chat_completion(model, context) {
    return new Promise((resolve, reject) => {
        fetch(endpoint + '/api/chat', {
            method: 'POST',
            body: JSON.stringify({
                model: model,
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

function text_completion(config, prompt, callback, images = [] /* list of base64 encoded images */, should_think = false) {
    console.log(should_think ? "Thinking mode enabled" : "Thinking mode disabled")
    fetch('http://' + config.server + '/api/generate', {
        method: 'POST',
        body: JSON.stringify({
            model: config.model,
            stream: false,
            prompt: prompt,
            options: config.override_options,
            think: false,
            system: config.prompt_config.system_prompt,
            images: images
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

function text_completion_stream(config, prompt, callback, images = [] /* list of base64 encoded images */, should_think = false) {
    fetch('http://' + config.server +  '/api/generate', {
        method: 'POST',
        body: JSON.stringify({
            model: config.model,
            stream: true,
            prompt: prompt,
            options: config.override_options,
            system: config.prompt_config.system_prompt,
            think: false,
            images: images
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

function unload_model(config) {
    return new Promise((resolve, reject) => {
        // use /api/ps to get a list of running models and unload all of them with /api/generate no prompt and keep_alive = 0

        fetch('http://' + config.server + '/api/ps', {   
            method: 'GET',
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
            // unload all models wait until all models are unloaded before resolving
            let unload_promises = []

            for (let i = 0; i < res.models.length; i++) {
                let model = res.models[i]
                console.log('unloading model: ' + model.name)
                unload_promises.push(fetch('http://' + config.server + '/api/generate', {
                    method: 'POST',
                    body: JSON.stringify({
                        model: model.name,
                        stream: false,
                        keep_alive: 0,
                    }),
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }))
            }

            Promise.all(unload_promises).then(res => {
                // check if all models are unloaded
                let all_unloaded = true
                for (let i = 0; i < res.length; i++) {
                    if (!res[i].ok) {
                        all_unloaded = false
                        break
                    }
                }

                if (all_unloaded) {
                    resolve(true)
                }
                else {
                    reject(new Error('Failed to unload all models'))
                }
            })

        }).catch(err => {
            reject(err)
        })
    })
}

function free_up_llm_resource(server_url = server_pool[0].url) {
    return new Promise(async (resolve, reject) => {
        const ip_address_pattern = /(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/;
        const server_address = ip_address_pattern.exec(server_url)
        //console.log(server_address)
        if (!server_address) {
            reject(new Error('Invalid server address'))
            return
        }
        else {
            server_url = server_address[0]
            unload_model({
                server: server_url + ':11434'
            }).then(() => {
                resolve(true)
            }).catch(err => {
                reject(err)
            })
        }
    })
}

module.exports = {
    chat_completion,
    unload_model,
    free_up_llm_resource,
    text_completion_stream,
    text_completion
}