const axios = require('axios');
const { setTimeout: sleep } = require('timers/promises');
const { serviceHeaders } = require('./proxy_config');
const { comfyWorkload, workloadHeaders } = require('./orchestrator_workload');

async function runComfyPrompt(client, prompt, { onProgress = () => {}, timeoutMs = 60 * 60 * 1000,
    pollMs = 2000, http = axios, notify = () => {} } = {}) {
    const headers = workloadHeaders('comfyui', comfyWorkload(prompt), { 'Content-Type': 'application/json' });
    const jobId = headers['X-AI-Job-ID'];
    let listener, outcome;
    const outputs = {};
    let completed = false, executionError;
    try {
        const response = await http.post(`${client.HTTP_ENDPOINT}/prompt`, {
            prompt, client_id: client.clientId,
        }, { headers, timeout: timeoutMs });
        const promptId = response.data.prompt_id;
        if (!promptId) throw new Error('ComfyUI did not return a prompt ID.');
        listener = {
            prompt_id: promptId,
            progress_cb: onProgress,
            subprogress_cb: onProgress,
            success_cb(data) { if (data.output) outputs[data.node] = data.output; },
            error_cb(data) { executionError = new Error(data.exception_message || data.error || 'ComfyUI execution failed.'); },
            completed_cb() { completed = true; },
        };
        client.promptListener.push(listener);
        const deadline = Date.now() + timeoutMs;
        let lastPollError;
        while (Date.now() < deadline) {
            if (executionError) { outcome = 'error'; throw executionError; }
            if (completed && Object.keys(outputs).length) {
                outcome = 'success';
                return { prompt_id: promptId, outputs };
            }
            // History also covers cached outputs, missed/early WS events, and a
            // disconnected socket. HTTP still goes through the orchestrator.
            try {
                const { data } = await http.get(`${client.HTTP_ENDPOINT}/history/${encodeURIComponent(promptId)}`, {
                    headers: serviceHeaders('comfyui'), timeout: 30_000,
                });
                const history = data[promptId];
                if (history?.status?.status_str === 'error') {
                    const failure = history.status.messages?.find(([type]) => ['execution_error', 'execution_interrupted'].includes(type));
                    executionError = new Error(failure?.[1]?.exception_message || 'ComfyUI execution failed or was interrupted.');
                } else if (history?.status?.completed) {
                    outcome = 'success';
                    return { prompt_id: promptId, outputs: history.outputs || {} };
                }
                lastPollError = undefined;
            } catch (error) { lastPollError = error; }
            await sleep(pollMs);
        }
        // Do not release an orchestrator reservation for a possibly running
        // job on a consumer timeout. The backend owns its terminal state.
        throw new Error(`ComfyUI prompt ${promptId} timed out${lastPollError ? `: ${lastPollError.message}` : ''}. Check the backend history for retained output.`);
    } catch (error) {
        const response = error.response;
        const reason = response?.headers?.['x-ai-admission-reason'];
        if (response && !listener) outcome = 'error';
        if (reason) {
            const retry = response.headers['x-ai-retry-after'] || response.headers['retry-after'];
            throw new Error(`GPU orchestrator: ${reason}${retry ? `. Try again in ${retry}s.` : ''}`);
        }
        throw error;
    } finally {
        if (listener) client.promptListener = client.promptListener.filter(item => item !== listener);
        if (outcome) notify(jobId, outcome);
    }
}

module.exports = { runComfyPrompt };
