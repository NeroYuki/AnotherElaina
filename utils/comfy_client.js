const ws = require('ws');
const crypto = require("crypto");
const { on } = require('events');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { default: axios } = require('axios');

const SERVER_ENDPOINT = '192.168.196.142:8188'

// singleton comfy client
const comfyClient = {
    client: null,
    comfyStat: {
        cpu_usage: 0,
        ram_total: 0,
        ram_used: 0,
        ram_percent: 0,
        gpu_usage: 0,
        gpu_temp: 0,
        gpu_vram_total: 0,
        gpu_vram_used: 0,
        gpu_memory_percent: 0,
    },
    clientId: crypto.randomUUID(),
    promptListener: [],
    init: function() {
        const client = new ws(`ws://${SERVER_ENDPOINT}/ws?clientId=${this.clientId}`)
        client.on('open', () => {
            console.log('Connected to ComfyUI server');
        });

        client.on('message', (data) => {
            this.updateOnMessage(data);
        });

        client.on('close', () => {
            console.log('Disconnected from server');
        });

        client.on('error', (error) => {
            console.log('Error:', error);
        });

        this.client = client;

        return this.client;
    },

    sendPrompt: function(prompt, progress_cb = () => {}, success_cb = () => {}, error_cb = () => {}, subprogress_cb = () => {}) {
        if (!this.client || this.client.readyState !== ws.OPEN) {
            console.log('Client is not connected');
            return;
        }

        const data = {
            prompt: prompt,
            client_id: this.clientId
        }

        fetch(`http://${SERVER_ENDPOINT}/prompt`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' }
        })
            .then(async res => {
                if (res.status !== 200) {
                    let err_data = await res.json();
                    throw (err_data?.error) ? (err_data.error?.message || "Unknown server error") : "Unknown connection error";
                }
                return res.json();
            })
            .then(data => {
                console.log('Prompt sent:', data);
                this.promptListener.push({
                    prompt_id: data.prompt_id,
                    progress_cb: progress_cb,
                    success_cb: success_cb,
                    error_cb: error_cb,
                    subprogress_cb: subprogress_cb
                });

                // setup a timer of 15 minutes before the prompt is considered failed and remove from listener
                setTimeout(() => {
                    for (let i = 0; i < this.promptListener.length; i++) {
                        if (this.promptListener[i].prompt_id === data.prompt_id) {
                            this.promptListener[i].error_cb({ error: 'Prompt timed out' });
                            this.promptListener.splice(i, 1);
                        }
                    }
                }, 15 * 60 * 1000);
            })
            .catch(err => {
                console.log('Error:', err);
                error_cb({ error: err});
            });
    },

    updateOnMessage: function(data) {
        const parsed = JSON.parse(data);
        //console.log("ws message: ", parsed.type);

        if (parsed.type === 'crystools.monitor') {
            input_stat = parsed.data;
            if (!input_stat) {
                console.log('No stat data');
                return;
            }
            this.comfyStat.cpu_usage = input_stat.cpu_utilization ?? 0;
            this.comfyStat.ram_total = (input_stat.ram_total ?? 0) / (1024 * 1024 * 1024);
            this.comfyStat.ram_used = (input_stat.ram_used ?? 0) / (1024 * 1024 * 1024);
            this.comfyStat.ram_percent = (input_stat.ram_used_percent ?? 0);
            this.comfyStat.gpu_usage = (input_stat.gpus[0].gpu_utilization ?? 0);
            this.comfyStat.gpu_temp = (input_stat.gpus[0].gpu_temperature ?? 0);
            this.comfyStat.gpu_vram_total = (input_stat.gpus[0].vram_total ?? 0) / (1024 * 1024 * 1024);
            this.comfyStat.gpu_vram_used = (input_stat.gpus[0].vram_used ?? 0) / (1024 * 1024 * 1024);
            this.comfyStat.gpu_memory_percent = (input_stat.gpus[0].vram_used_percent ?? 0);
        }

        if (parsed.type === 'status') {
            console.log('Status:', parsed.data);
        }

        if (parsed.type === 'executing') {
            //console.log('Executing:', parsed.data);
            if (parsed.data.node !== null) {
                for (let i = 0; i < this.promptListener.length; i++) {
                    if (this.promptListener[i].prompt_id === parsed.data.prompt_id) {
                        console.log('found active listener:', this.promptListener[i].prompt_id);
                        this.promptListener[i].progress_cb(parsed.data);
                    }
                }
            }
        }

        if (parsed.type === 'executed') {
            //console.log('Complete:', parsed.data);
            for (let i = 0; i < this.promptListener.length; i++) {
                if (this.promptListener[i].prompt_id === parsed.data.prompt_id) {
                    this.promptListener[i].success_cb(parsed.data);
                    this.promptListener.splice(i, 1);
                }
            }
        }

        if (parsed.type === 'execution_error') {
            console.log('Error:', parsed.data);
            for (let i = 0; i < this.promptListener.length; i++) {
                if (this.promptListener[i].prompt_id === parsed.data.prompt_id) {
                    this.promptListener[i].error_cb(parsed.data);
                    this.promptListener.splice(i, 1);
                }
            }
        }

        if (parsed.type === 'progress') {
            //console.log('Progress:', parsed.data);
            for (let i = 0; i < this.promptListener.length; i++) {
                if (this.promptListener[i].prompt_id === parsed.data.prompt_id) {
                    this.promptListener[i].subprogress_cb(parsed.data);
                }
            }
        }
    },

    getImage: function(filename, subfolder, filetype = "output", only_filename = false) {
        const url = only_filename ? `http://${SERVER_ENDPOINT}/view?filename=${filename}` : `http://${SERVER_ENDPOINT}/view?filename=${filename}&subfolder=${subfolder}&type=${filetype}`;

        console.log('Fetching files:', url);

        return new Promise((resolve, reject) => {
            fetch(url)
                .then(res => {
                    if (res.status !== 200) {
                        reject('Failed to get image');
                    }
                    return res.arrayBuffer();
                })
                .then(buffer => {
                    resolve(buffer);
                })
                .catch(err => {
                    reject(err);
                });
        });
    },

    uploadImage: function(buffer, filename, mimetype) {
        const url = `http://${SERVER_ENDPOINT}/api/upload/image`;

        // with follow form data format
        // -----------------------------45417822730903170364248702972
        // Content-Disposition: form-data; name="image"; filename="img (3).png"
        // Content-Type: image/png

        return new Promise((resolve, reject) => {
            const blob = new Blob([buffer], { type: mimetype });
            const form_data = new FormData();
            form_data.append('image', blob, filename);

            axios.post(url, form_data, 
                { headers: {
                    'Content-Type': 'multipart/form-data',
                }})
                .then((res) => {
                    resolve(res.data);
                })
                .catch((err) => {
                    console.log(err);
                    reject(err);
                })
        });
    },

    freeMemory: function(shouldFreeCache) {
        const url = `http://${SERVER_ENDPOINT}/api/free`;
        const body = {
            unload_models: true, 
            free_memory: shouldFreeCache
        }

        console.log('Fetching files:', url);

        return new Promise((resolve, reject) => {
            fetch(url, {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' }
            })

            resolve("free memory request sent");
        });
    }
}

module.exports = comfyClient;