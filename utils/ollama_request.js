const endpoint = 'http://192.168.196.142:11434'

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

function unload_model(model) {
    return new Promise((resolve, reject) => {
        fetch(endpoint + '/api/generate', {
            method: 'POST',
            body: JSON.stringify({
                model: model,
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
        if (globalThis.operating_mode === "6bit") {
            await unload_model('test')
            globalThis.operating_mode = "4bit"
        }

        // setup the timeout to load back the 6bit model
        setTimeout(async () => {
            await unload_model('test4b')
            globalThis.operating_mode = "6bit"
        }, 1000 * 60 * 10)
    })
}

module.exports = {
    chat_completion,
    unload_model,
    fallback_to_resource_saving
}