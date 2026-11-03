const ws = require('ws');
const crypto = require("crypto");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { default: axios } = require('axios');
const { PROXY_URL, serviceHeaders } = require('./proxy_config');

// Header used to route HTTP traffic to comfyui through the orchestrator proxy.
const COMFY_HEADERS = serviceHeaders('comfyui');

// Completion is sent to the proxy, not ComfyUI. It carries only the opaque
// job ID and terminal outcome; the proxy already owns the workload manifest.
function notifyOrchestrator(jobId, outcome) {
    if (!jobId) return;
    fetch(`${PROXY_URL}/internal/orchestrator/jobs/${jobId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
    }).catch(err => console.log('Orchestrator completion notification failed:', err));
}

// singleton comfy client
const comfyClient = {
    client: null,
    clients: [],
    comfyStat: {
        is_running: false,
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
    // Keep one socket open to each routable ComfyUI instance. HTTP submission
    // may land on either instance, and only that instance emits its prompt
    // events. Both sockets use the same client ID so the matching event reaches
    // the shared prompt listener below.
    SERVER_ENDPOINTS: process.env.BOT_ENV === 'lan'
        ? ['192.168.1.2:8188', '192.168.1.2:8189']
        : ['192.168.196.142:8188', '192.168.196.142:8189'],
    HTTP_ENDPOINT: PROXY_URL,
    init: function() {
        const active = client => client && [ws.OPEN, ws.CONNECTING].includes(client.readyState);
        if (this.clients.length === this.SERVER_ENDPOINTS.length && this.clients.every(active)) return this.clients;
        const previousClients = this.clients;
        this.clients = this.SERVER_ENDPOINTS.map((endpoint, index) => {
            if (active(previousClients[index])) return previousClients[index];
            const client = new ws(`ws://${endpoint}/ws?clientId=${this.clientId}`)
            client.on('open', () => {
                console.log(`Connected to ComfyUI server ${endpoint}`);
                this.comfyStat.is_running = true;
            });
            client.on('message', (data, isBinary) => {
                if (isBinary) return; // ComfyUI also sends binary preview frames.
                this.updateOnMessage(data);
                this.comfyStat.is_running = true;
            });
            client.on('close', () => {
                console.log(`Disconnected from ComfyUI server ${endpoint}`);
                this.comfyStat.is_running = this.clients.some(item => item.readyState === ws.OPEN);
            });
            client.on('error', error => {
                console.log(`ComfyUI ${endpoint} error:`, error);
                this.comfyStat.is_running = this.clients.some(item => item.readyState === ws.OPEN);
            });
            return client;
        });
        this.client = this.clients[0] || null;
        return this.clients;
    },

    runPrompt: function(prompt, options = {}) {
        return require('./comfy_prompt').runComfyPrompt(this, prompt, {
            ...options,
            notify: options.notify || notifyOrchestrator,
        });
    },

    // Legacy callback API. It now runs through the same managed runner as
    // runPrompt, so it gains exact-job cancellation, history polling and
    // listener cleanup without a second divergent execution engine.
    sendPrompt: function(prompt, progress_cb = () => {}, success_cb = () => {}, error_cb = () => {}, subprogress_cb = () => {}) {
        if (!this.clients.some(client => client.readyState === ws.OPEN)) {
            console.log('Client is not connected');
            return;
        }
        const promise = this.runPrompt(prompt, {
            onProgress: data => progress_cb(data),
            onSubprogress: data => subprogress_cb(data),
            onExecuted: data => success_cb(data),
            onError: error => error_cb({ error: error?.message || String(error) }),
        });
        // Existing callers do not await sendPrompt. Keep callback compatibility
        // without turning a backend failure into an unhandled rejection.
        promise.catch(() => {});
        return promise;
    },

    updateOnMessage: function(data) {
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { return; }
        //console.log("ws message: ", parsed.type);

        if (parsed.type === 'crystools.monitor') {
            const input_stat = parsed.data;
            if (!input_stat) {
                console.log('No stat data');
                return;
            }
            this.comfyStat.is_running = true
            this.comfyStat.cpu_usage = input_stat.cpu_utilization ?? 0;
            this.comfyStat.ram_total = (input_stat.ram_total ?? 0) / (1024 * 1024 * 1024);
            this.comfyStat.ram_used = (input_stat.ram_used ?? 0) / (1024 * 1024 * 1024);
            this.comfyStat.ram_percent = (input_stat.ram_used_percent ?? 0);
            this.comfyStat.gpu_usage = (input_stat.gpus?.[0]?.gpu_utilization ?? 0);
            this.comfyStat.gpu_temp = (input_stat.gpus?.[0]?.gpu_temperature ?? 0);
            this.comfyStat.gpu_vram_total = (input_stat.gpus?.[0]?.vram_total ?? 0) / (1024 * 1024 * 1024);
            this.comfyStat.gpu_vram_used = (input_stat.gpus?.[0]?.vram_used ?? 0) / (1024 * 1024 * 1024);
            this.comfyStat.gpu_memory_percent = (input_stat.gpus?.[0]?.vram_used_percent ?? 0);
        }

        if (parsed.type === 'status') {
            console.log('Status:', parsed.data);
        }

        const promptId = parsed.data?.prompt_id;
        if (!promptId) return;
        const matched = this.promptListener.filter(listener => listener.prompt_id === promptId);
        if (!matched.length) return;
        const removed = [];

        const call = (listener, name, payload) => {
            try { listener[name]?.(payload); }
            catch (error) { console.log(`ComfyUI ${name} callback failed:`, error); }
        };

        if (parsed.type === 'executing') {
            if (parsed.data.node !== null) {
                for (const listener of matched) call(listener, 'progress_cb', parsed.data);
            }
        }

        if (parsed.type === 'executed') {
            for (const listener of matched) call(listener, 'success_cb', parsed.data);
        }

        if (parsed.type === 'execution_success') {
            for (const listener of matched) {
                if (listener.managed) {
                    call(listener, 'completed_cb', parsed.data);
                    continue;
                }
                // Compatibility for any raw listener pushed directly into the
                // array: keep the old self-cleaning behavior. Managed listeners
                // are finalized exactly once by runComfyPrompt.
                notifyOrchestrator(listener.orchestrator_job_id, 'success');
                call(listener, 'completed_cb');
                removed.push(listener);
            }
        }

        if (parsed.type === 'execution_error') {
            console.log('Error:', parsed.data);
            for (const listener of matched) {
                if (listener.managed) {
                    call(listener, 'error_cb', parsed.data);
                    continue;
                }
                notifyOrchestrator(listener.orchestrator_job_id, 'error');
                call(listener, 'error_cb', parsed.data);
                removed.push(listener);
            }
        }

        if (parsed.type === 'execution_interrupted') {
            console.log('Interrupted:', parsed.data);
            for (const listener of matched) {
                if (listener.managed) {
                    if (listener.interrupted_cb) call(listener, 'interrupted_cb', parsed.data);
                    else call(listener, 'error_cb', parsed.data);
                    continue;
                }
                notifyOrchestrator(listener.orchestrator_job_id, 'error');
                call(listener, 'error_cb', parsed.data);
                removed.push(listener);
            }
        }

        if (parsed.type === 'progress') {
            for (const listener of matched) call(listener, 'subprogress_cb', parsed.data);
        }

        if (removed.length) {
            this.promptListener = this.promptListener.filter(listener => !removed.includes(listener));
        }
    },

    getImage: function(filename, subfolder, filetype = "output", only_filename = false, options = {}) {
        const query = new URLSearchParams({ filename });
        if (!only_filename) { query.set('subfolder', subfolder || ''); query.set('type', filetype || 'output'); }
        const url = `${this.HTTP_ENDPOINT}/view?${query}`;
        const headers = { ...COMFY_HEADERS };
        if (options.instanceId) headers['X-AI-Instance'] = options.instanceId;
        else if (options.affinityKey) headers['X-AI-Affinity-Key'] = options.affinityKey;

        console.log('Fetching files:', url);

        return new Promise((resolve, reject) => {
            fetch(url, { headers })
                .then(res => {
                    if (res.status !== 200) {
                        throw new Error(`Failed to retrieve ComfyUI output (HTTP ${res.status})`);
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
        if (!buffer?.length) return Promise.reject(new Error('Input attachment is empty.'));
        const url = `${this.HTTP_ENDPOINT}/api/upload/image`;

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
                    ...COMFY_HEADERS,
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

    freeMemory: function(shouldFreeCache, options = {}) {
        const url = `${this.HTTP_ENDPOINT}/api/free`;
        const body = {
            unload_models: true, 
            free_memory: shouldFreeCache
        }
        const headers = { ...COMFY_HEADERS, 'Content-Type': 'application/json' };
        // Only clean the exact instance that ran the job. A global free while
        // another prompt is executing would evict its models or workspace.
        if (options.instanceId) headers['X-AI-Instance'] = options.instanceId;
        else if (options.affinityKey) headers['X-AI-Affinity-Key'] = options.affinityKey;

        console.log('Fetching files:', url);

        return fetch(url, {
            method: 'POST',
            body: JSON.stringify(body),
            headers
        }).then(async response => {
            if (!response.ok) {
                const retryAfter = response.headers.get('retry-after');
                const detail = await response.text();
                throw new Error(
                    `ComfyUI cleanup refused (HTTP ${response.status}` +
                    `${retryAfter ? `, retry after ${retryAfter}s` : ''}): ${detail}`
                );
            }
            return "free memory request completed";
        });
    }
}

module.exports = comfyClient;
