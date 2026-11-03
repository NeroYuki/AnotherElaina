const axios = require('axios');
const { setTimeout: sleep } = require('timers/promises');
const { serviceHeaders } = require('./proxy_config');
const { comfyWorkload, workloadHeaders } = require('./orchestrator_workload');

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const CANCEL_TIMEOUT_MS = 30_000;

function headerValue(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : null;
}

function affinityHeaders(instanceId, promptId, extra = {}) {
    const headers = serviceHeaders('comfyui', extra);
    if (instanceId) headers['X-AI-Instance'] = instanceId;
    // The proxy remembers this same key from the /prompt response. It is a
    // fallback for history/file reads only; cancellation itself requires an
    // exact X-AI-Instance so a miss can never become a global interrupt.
    else if (promptId) headers['X-AI-Affinity-Key'] = `comfy-prompt:${promptId}`;
    return headers;
}

function queuePromptIds(queue) {
    if (!queue || typeof queue !== 'object') return null;
    const entries = [...(queue.queue_running || []), ...(queue.queue_pending || [])];
    return entries.map(entry => Array.isArray(entry) ? entry[1] : (typeof entry === 'string' ? entry : entry?.prompt_id))
        .filter(value => typeof value === 'string' && value);
}

function queueHasPrompt(queue, promptId) {
    const ids = queuePromptIds(queue);
    return ids == null ? null : ids.includes(promptId);
}

function readHistory(data, promptId) {
    const entry = data?.[promptId] || (data?.prompt_id === promptId ? data : null);
    if (!entry) return null;
    const status = entry.status || {};
    const messages = Array.isArray(status.messages) ? status.messages : [];
    const messageType = message => Array.isArray(message) ? message[0] : message?.type;
    const messageData = message => Array.isArray(message) ? message[1] : message;
    const interrupted = messages.some(message => messageType(message) === 'execution_interrupted');
    const failure = messages.find(message => messageType(message) === 'execution_error');
    const failureData = failure ? messageData(failure) : null;
    const completed = !!status.completed || status.status_str === 'success';
    const failed = status.status_str === 'error' || !!failure || interrupted;
    return {
        outputs: entry.outputs || {},
        completed,
        failed,
        interrupted,
        error: failed && !interrupted
            ? new Error(failureData?.exception_message || failureData?.error || 'ComfyUI execution failed.')
            : null,
    };
}

// The backend's cancel response is intentionally small. A dequeued request is
// already terminal; a running request is only acknowledged until its execution
// actually stops. Unknown/not-found is not treated as confirmed cancellation.
function cancelDisposition(data) {
    if (data == null) return 'unknown';
    if (typeof data === 'string') {
        const text = data.toLowerCase();
        if (/dequeued|deleted|removed/.test(text) && !/interrupt/.test(text)) return 'terminal';
        if (/interrupt|running|dispatched|acknowledged/.test(text)) return 'dispatched';
        return 'unknown';
    }
    if (typeof data !== 'object') return 'unknown';
    if (data.dequeued === true || data.deleted === true || data.removed === true) return 'terminal';
    if (data.interrupted === true || data.dispatched === true) return 'dispatched';
    if (data.was_running === true) return 'dispatched';
    if (data.was_running === false && (data.cancelled === true || data.ok === true)) return 'terminal';
    const text = `${data.action || ''} ${data.status || ''} ${data.state || ''} ${data.result || ''} ${data.reason || ''}`
        .toLowerCase();
    if (/dequeued|deleted|removed|queue/.test(text) && !/interrupt/.test(text)) return 'terminal';
    if (/interrupt|running|dispatched|acknowledged/.test(text)) return 'dispatched';
    return 'unknown';
}

function admissionError(error) {
    const response = error?.response;
    if (!response) return null;
    const reason = headerValue(response.headers, 'x-ai-admission-reason');
    if (!reason) return null;
    const retry = headerValue(response.headers, 'x-ai-retry-after') || headerValue(response.headers, 'retry-after');
    return new Error(`GPU orchestrator: ${reason}${retry ? `. Try again in ${retry}s.` : ''}`);
}

function normalizeSubmissionError(error, response) {
    const admission = admissionError({ response: { headers: response?.headers } });
    if (admission) return admission;
    const data = response?.data;
    if (data?.error) {
        const detail = data.error?.message || data.error;
        return new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return error;
}

async function runComfyPrompt(client, prompt, {
    onProgress = () => {},
    onSubprogress = onProgress,
    onExecuted = () => {},
    onError = () => {},
    onSubmitted = null,
    onController = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollMs = 2000,
    http = axios,
    notify = () => {},
    signal = null,
    cancelTimeoutMs = CANCEL_TIMEOUT_MS,
} = {}) {
    const headers = workloadHeaders('comfyui', comfyWorkload(prompt), { 'Content-Type': 'application/json' });
    const jobId = headers['X-AI-Job-ID'];
    let listener = null;
    let promptId = null;
    let instanceId = null;
    let submitted = false;
    let finalized = false;
    let notified = false;
    let cancelRequested = false;
    let cancelConfirmed = false;
    let cancelDispositionState = 'none';
    let cancelError = null;
    let cancelPromise = null;
    let cancelStarted = false;
    let queueAbsentPolls = 0;
    let terminalSuccess = false;
    let historyCompleted = false;
    let terminalInterrupted = false;
    let terminalError = null;
    let lastPollError = null;
    let abortHandler = null;
    const outputs = {};
    const executed = [];

    const notifyOnce = outcome => {
        if (notified) return;
        notified = true;
        try { notify(jobId, outcome); }
        catch (error) { console.log('Orchestrator completion notification failed:', error); }
    };

    const cancelResult = () => ({
        status: 'cancelled',
        cancelled: true,
        prompt_id: promptId,
        instance_id: instanceId,
        outputs,
        executed,
        submitted,
    });

    const successResult = () => ({
        status: 'completed',
        prompt_id: promptId,
        instance_id: instanceId,
        outputs,
        executed,
        submitted: true,
    });

    const cancelFailedResult = reason => ({
        status: 'cancel-failed',
        reason: `${reason}${cancelError ? ` Cancellation error: ${cancelError.message}` : ''}`,
        cancel_error: cancelError?.message || null,
        prompt_id: promptId,
        instance_id: instanceId,
        outputs,
        executed,
        submitted: true,
        completed: true,
    });

    async function performCancel() {
        if (!promptId) return { status: 'pending-submission' };
        if (!instanceId) {
            cancelError = new Error(
                'ComfyUI cancellation requires the exact X-AI-Instance affinity returned by submission.',
            );
            cancelDispositionState = 'error';
            return { status: 'error', error: cancelError };
        }
        const cancelHeaders = affinityHeaders(instanceId, promptId, { 'Content-Type': 'application/json' });
        try {
            const response = await http.post(
                `${client.HTTP_ENDPOINT}/api/jobs/${encodeURIComponent(promptId)}/cancel`,
                {},
                { headers: cancelHeaders, timeout: cancelTimeoutMs },
            );
            if (response?.status && (response.status < 200 || response.status >= 300)) {
                throw new Error(`ComfyUI cancel endpoint returned HTTP ${response.status}`);
            }
            cancelDispositionState = cancelDisposition(response?.data);
            if (cancelDispositionState === 'terminal') cancelConfirmed = true;
            cancelError = null;
            return { status: cancelDispositionState, response };
        }
        catch (error) {
            const status = error?.response?.status;
            cancelError = new Error(
                `ComfyUI cancel failed${status ? ` (HTTP ${status})` : ''}: ${error?.message || String(error)}`,
            );
            cancelDispositionState = 'error';
            return { status: 'error', error: cancelError };
        }
    }

    function requestCancel() {
        if (finalized) return Promise.resolve({ status: 'finished' });
        if (!cancelRequested) {
            cancelRequested = true;
            if (listener) listener.cancelRequested = true;
        }
        if (cancelPromise) return cancelPromise;
        if (!promptId) {
            cancelPromise = Promise.resolve({ status: 'pending-submission' });
            return cancelPromise;
        }
        if (!cancelStarted) {
            cancelStarted = true;
            cancelPromise = performCancel();
        }
        return cancelPromise;
    }

    const controller = {
        cancel: requestCancel,
        get prompt_id() { return promptId; },
        get promptId() { return promptId; },
        get instance_id() { return instanceId; },
        get instanceId() { return instanceId; },
        get cancelled() { return cancelRequested; },
        get confirmed() { return cancelConfirmed; },
        get finalized() { return finalized; },
    };

    if (signal) {
        abortHandler = () => { requestCancel().catch(() => {}); };
        if (signal.aborted) abortHandler();
        else signal.addEventListener('abort', abortHandler, { once: true });
    }
    try { onController?.(controller); }
    catch (error) { console.log('ComfyUI controller callback failed:', error); }

    const historyFor = async () => {
        const { data } = await http.get(`${client.HTTP_ENDPOINT}/history/${encodeURIComponent(promptId)}`, {
            headers: affinityHeaders(instanceId, promptId),
            timeout: 30_000,
        });
        return readHistory(data, promptId);
    };

    const queueFor = async () => {
        const { data } = await http.get(`${client.HTTP_ENDPOINT}/queue`, {
            headers: affinityHeaders(instanceId, promptId),
            timeout: 30_000,
        });
        return queueHasPrompt(data, promptId);
    };

    const recordHistory = state => {
        if (!state) return;
        if (state.outputs) Object.assign(outputs, state.outputs);
    };

    try {
        if (cancelRequested) {
            finalized = true;
            return { status: 'cancelled', cancelled: true, prompt_id: null, instance_id: null, outputs, executed, submitted: false };
        }

        const response = await http.post(`${client.HTTP_ENDPOINT}/prompt`, {
            prompt, client_id: client.clientId,
        }, { headers, timeout: timeoutMs });
        if (response?.status && response.status !== 200) {
            throw normalizeSubmissionError(new Error(`ComfyUI submission returned HTTP ${response.status}`), response);
        }
        promptId = response?.data?.prompt_id;
        if (!promptId) throw new Error('ComfyUI did not return a prompt ID.');
        instanceId = headerValue(response?.headers, 'x-ai-instance') || response?.data?.instance_id || null;
        submitted = true;

        listener = {
            managed: true,
            prompt_id: promptId,
            progress_cb(data) { try { onProgress(data); } catch (error) { console.log(error); } },
            subprogress_cb(data) { try { onSubprogress(data); } catch (error) { console.log(error); } },
            success_cb(data) {
                executed.push(data);
                if (data?.output) outputs[data.node] = data.output;
                try { onExecuted(data); } catch (error) { console.log(error); }
            },
            completed_cb() { terminalSuccess = true; },
            error_cb(data) {
                terminalError = new Error(data?.exception_message || data?.error || 'ComfyUI execution failed.');
            },
            interrupted_cb() { terminalInterrupted = true; },
            cancelRequested,
        };
        client.promptListener.push(listener);

        try {
            // Do not await this callback: it may be used to request a cancel,
            // and waiting for confirmation here would deadlock the poll loop.
            const pending = onSubmitted?.({
                prompt_id: promptId,
                promptId,
                instance_id: instanceId,
                instanceId,
                job_id: jobId,
                jobId,
                cancel: requestCancel,
                controller,
            });
            if (pending?.catch) pending.catch(error => console.log('ComfyUI submitted callback failed:', error));
        }
        catch (error) { console.log('ComfyUI submitted callback failed:', error); }

        if (cancelRequested) {
            if (!cancelStarted) {
                cancelStarted = true;
                cancelPromise = performCancel();
            }
            await cancelPromise;
        }

        const deadline = Date.now() + timeoutMs;
        while (true) {
            if (cancelConfirmed) {
                finalized = true;
                notifyOnce('cancelled');
                return cancelResult();
            }

            if (terminalInterrupted) {
                if (cancelRequested) {
                    cancelConfirmed = true;
                    continue;
                }
                terminalError = new Error('ComfyUI execution was interrupted.');
            }
            if (terminalError) throw terminalError;

            let history = null;
            try {
                history = await historyFor();
                lastPollError = undefined;
            }
            catch (error) { lastPollError = error; }

            if (history) {
                recordHistory(history);
                if (history.interrupted) {
                    if (cancelRequested) {
                        cancelConfirmed = true;
                        continue;
                    }
                    terminalError = new Error('ComfyUI execution was interrupted.');
                }
                else if (history.error) terminalError = history.error;
                else if (history.completed) {
                    terminalSuccess = true;
                    historyCompleted = true;
                }
            }
            if (terminalError) throw terminalError;

            if (cancelRequested && !cancelConfirmed) {
                // Completion wins over a late cancel: the backend may have
                // finished just before the interrupt was dispatched.
                if (history?.completed || terminalSuccess) {
                    finalized = true;
                    notifyOnce('success');
                    return cancelFailedResult('the job completed before cancellation was confirmed.');
                }
                // A failed/unsupported cancellation must never be reported as
                // cancelled. Keep tracking the exact job instead of releasing
                // its orchestrator reservation early.
                if (cancelDispositionState !== 'error') {
                    let inQueue = null;
                    try { inQueue = await queueFor(); }
                    catch (error) { lastPollError = error; }
                    if (inQueue === false) {
                        // Two consecutive successful queue reads avoid the
                        // dequeue -> running hand-off gap being mistaken for a
                        // stopped job. WS/history interruption confirms at once.
                        queueAbsentPolls++;
                        if (queueAbsentPolls >= 2) {
                            cancelConfirmed = true;
                            continue;
                        }
                    }
                    else queueAbsentPolls = 0;
                }
            }

            if (terminalSuccess) {
                if (cancelRequested && !cancelConfirmed) {
                    finalized = true;
                    notifyOnce('success');
                    return cancelFailedResult('the job completed before cancellation was confirmed.');
                }
                if (historyCompleted || Object.keys(outputs).length || executed.length) {
                    finalized = true;
                    notifyOnce('success');
                    return successResult();
                }
            }

            if (Date.now() >= deadline) {
                const detail = cancelError ? ` Cancellation also failed: ${cancelError.message}` : '';
                const error = new Error(
                    `ComfyUI prompt ${promptId} timed out${lastPollError ? `: ${lastPollError.message}` : ''}.${detail} ` +
                    'Check the backend history for retained output.',
                );
                error.jobMayBeRunning = true;
                throw error;
            }
            await sleep(pollMs);
        }
    }
    catch (error) {
        const admission = admissionError(error);
        if (admission) error = admission;
        // Let the Discord layer distinguish a cancellation failure from an
        // independent execution error while keeping the original message.
        if (error && (typeof error === 'object' || typeof error === 'function')) {
            error.cancelRequested = cancelRequested;
            if (cancelError) error.cancelError = cancelError;
        }
        if (cancelConfirmed) {
            finalized = true;
            notifyOnce('cancelled');
            return cancelResult();
        }
        // A consumer timeout does not prove the backend stopped. Keep the
        // orchestrator reservation intact rather than releasing it early.
        if (!finalized) {
            finalized = true;
            if (!error?.jobMayBeRunning) notifyOnce('error');
        }
        try { onError(error); }
        catch (callbackError) { console.log(callbackError); }
        throw error;
    }
    finally {
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        if (listener) client.promptListener = client.promptListener.filter(item => item !== listener);
    }
}

module.exports = { runComfyPrompt, cancelDisposition, queueHasPrompt, readHistory };
