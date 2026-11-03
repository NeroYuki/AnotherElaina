'use strict';

// Shared Forge cancellation controller.
//
// Forge's Gradio interrupt callback is global to the Forge instance: posting
// the interrupt fn_index aborts whatever is *currently* sampling, regardless
// of which session submitted it. A stale Discord button (or a cancel that
// arrives while this job is still queued behind another request) therefore
// must never fire an interrupt blindly. This module owns the "is this POST
// actually ours and sampling right now?" state and serialises interrupt
// delivery so a released Forge lease cannot be followed by a late abort.
//
// Only the inference POST itself is marked active. Model changes, uploads,
// prompt enhancement, result rendering and the PiD restore step are not
// interruptible: cancelling during those phases records a pending cancellation
// and suppresses the next submission instead of aborting unrelated work.

const { serviceHeaders } = require('./proxy_config');
const { fetchProgressJson } = require('./forge_progress');

const CANCELLED_MESSAGE = 'Image generation cancelled.';
const DEFAULT_INTERRUPT_TIMEOUT_MS = 30000;
const DEFAULT_PROBE_INTERVAL_MS = 750;
const BODY_PREVIEW_LIMIT = 240;

function previewBody(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '<empty response>';
    return text.length > BODY_PREVIEW_LIMIT
        ? `${text.slice(0, BODY_PREVIEW_LIMIT)}...`
        : text;
}

function taskIdFor(sessionHash) {
    return `task(${sessionHash})`;
}

function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function readInterruptBody(response) {
    if (!response) return;
    if (typeof response.text === 'function') {
        let text;
        try {
            text = await response.text();
        }
        catch (error) {
            throw new Error(`Forge interrupt response body could not be read: ${error?.message || error}`);
        }
        if (!text || !text.trim()) return;
        try {
            const data = JSON.parse(text);
            if (data?.error) throw new Error(`Forge interrupt failed: ${data.error}`);
        }
        catch {
            throw new Error(`Forge interrupt returned an invalid response: ${previewBody(text)}`);
        }
        return;
    }
    if (typeof response.json === 'function') {
        try {
            const data = await response.json();
            if (data?.error) throw new Error(`Forge interrupt failed: ${data.error}`);
        }
        catch (error) {
            throw new Error(`Forge interrupt returned invalid JSON: ${error?.message || error}`);
        }
    }
}

/**
 * Send the validated Forge interrupt callback. This is intentionally a plain
 * Gradio /run/predict/ request: generation and interruption must stay on the
 * same transport and target the same instance/service.
 */
async function sendForgeInterrupt({
    endpoint,
    sessionHash,
    abortFnIndex,
    headers = {},
    service = 'sdwebui',
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_INTERRUPT_TIMEOUT_MS,
    logger = console,
} = {}) {
    if (!endpoint) throw new Error('Forge interrupt requires an endpoint.');
    if (typeof sessionHash !== 'string' || !sessionHash) {
        throw new Error('Forge interrupt requires a non-empty session hash.');
    }
    if (!Number.isInteger(abortFnIndex) || typeof abortFnIndex === 'boolean') {
        throw new Error('Forge interrupt requires an integer fn_index.');
    }
    if (typeof fetchImpl !== 'function') {
        throw new Error('Forge interrupt requires a fetch implementation.');
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    if (controller && timeoutMs > 0) {
        timer = setTimeout(() => controller.abort(), timeoutMs);
        timer.unref?.();
    }

    try {
        const response = await fetchImpl(`${endpoint}/run/predict/`, {
            method: 'POST',
            body: JSON.stringify({
                fn_index: abortFnIndex,
                session_hash: sessionHash,
                data: [],
            }),
            headers: {
                ...serviceHeaders(service),
                ...headers,
                'Content-Type': 'application/json',
            },
            ...(controller ? { signal: controller.signal } : {}),
        });
        const status = Number(response?.status);
        if (!(status >= 200 && status < 300)) {
            let body = '';
            try {
                body = typeof response?.text === 'function'
                    ? await response.text()
                    : typeof response?.json === 'function'
                        ? JSON.stringify(await response.json())
                        : '';
            }
            catch {
                // The status is already enough to report a useful failure.
            }
            throw new Error(
                `Forge interrupt returned HTTP ${Number.isFinite(status) ? status : 'unknown'}` +
                (body ? `: ${previewBody(body)}` : ''),
            );
        }
        await readInterruptBody(response);
        return { ok: true, status };
    }
    catch (error) {
        const message = error?.name === 'AbortError'
            ? `Forge interrupt timed out after ${timeoutMs}ms`
            : (error?.message || String(error));
        logger?.log?.(`Forge interrupt failed: ${message}`);
        return { ok: false, status: null, error: new Error(message) };
    }
    finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Create a cancellation controller for one command invocation.
 *
 * The controller is deliberately stateful and idempotent:
 *   - requestCancel() is synchronous and never waits for Discord;
 *   - an interrupt is only issued while `beginTask()` is active;
 *   - queued/unknown task state is probed and re-checked until it starts;
 *   - endTask()/drain() guarantee an in-flight interrupt is settled before the
 *     caller releases its Forge lease;
 *   - finish() clears the collector and any pending probe timer.
 */
function createForgeCancellation({
    interaction = null,
    customId = null,
    endpoint = null,
    abortFnIndex = null,
    headers = {},
    service = 'sdwebui',
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    now = Date.now,
    probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
    interruptTimeoutMs = DEFAULT_INTERRUPT_TIMEOUT_MS,
    logger = console,
    onCancel = null,
    collectorTimeMs = 800000,
} = {}) {
    let cancelled = false;
    let terminal = false;
    let activeTask = null;
    let collector = null;
    let collectorHandler = null;
    let collectorStopped = false;
    let reportPromise = null;
    let lastInterrupt = null;
    let probePromise = null;
    const interruptPromises = new Set();

    const isCancelled = () => cancelled;

    const stopCollector = () => {
        if (collectorStopped) return;
        collectorStopped = true;
        try { collector?.stop?.(); }
        catch (error) { logger?.log?.(error); }
        if (collectorHandler && collector?.removeListener) {
            try { collector.removeListener('collect', collectorHandler); }
            catch (error) { logger?.log?.(error); }
        }
        collector = null;
        collectorHandler = null;
    };

    const clearProbeTimer = task => {
        if (!task?.probeTimer) return;
        try { clearTimeoutImpl(task.probeTimer); }
        catch (error) { logger?.log?.(error); }
        task.probeTimer = null;
    };

    const interruptTask = task => {
        if (!task || task.interruptPromise || task.state === 'completed') return task?.interruptPromise || null;
        if (!Number.isInteger(task.abortFnIndex)) return null;
        const promise = sendForgeInterrupt({
            endpoint: task.endpoint,
            sessionHash: task.sessionHash,
            abortFnIndex: task.abortFnIndex,
            headers: task.headers,
            service: task.service,
            fetchImpl,
            timeoutMs: interruptTimeoutMs,
            logger,
        }).then(result => {
            lastInterrupt = result;
            return result;
        });
        task.interruptPromise = promise;
        interruptPromises.add(promise);
        promise.finally(() => interruptPromises.delete(promise));
        return promise;
    };

    const classifyProgress = progress => {
        if (!progress || typeof progress !== 'object') return 'unknown';
        if (progress.completed) return 'completed';
        if (progress.queued === true) return 'queued';
        if (progress.active === true) return 'running';
        if (progress.active === false) return 'unknown';
        const current = progress.current_task ?? progress.currentTask ?? progress.id_task ?? progress.task_id;
        if (typeof current === 'string' && current && current.trim()) {
            return current.trim();
        }
        if (progress.state === 'running' || progress.state === 'progress') return 'running';
        if (Number(progress.progress) > 0 || progress.live_preview) return 'running';
        return 'unknown';
    };

    const probeTask = async task => {
        if (!task) return 'idle';
        if (task.state === 'running' || task.state === 'completed') {
            return task.state;
        }
        const progress = await fetchProgressJson(
            `${task.endpoint}/internal/progress`,
            {
                id_task: taskIdFor(task.sessionHash),
                id_live_preview: 0,
            },
            { fetchImpl, headers: task.headers, logger },
        );
        if (!progress) {
            // A failed probe cannot prove ownership of the global interrupt.
            // Keep cancellation pending without touching another task.
            return task.state === 'queued' ? 'queued' : 'unknown';
        }
        const classified = classifyProgress(progress);
        if (['running', 'queued', 'completed', 'unknown'].includes(classified)) {
            return classified;
        }
        // A different task id means ours is still behind the current one.
        if (classified !== taskIdFor(task.sessionHash)) return 'queued';
        return 'running';
    };

    const scheduleProbe = task => {
        if (!task || task.probeTimer) return;
        task.probeTimer = setTimeoutImpl(() => {
            task.probeTimer = null;
            if (!cancelled || activeTask !== task || task.state === 'completed') return;
            const promise = probeAndHandle(task);
            probePromise = promise;
            promise.finally(() => {
                if (probePromise === promise) probePromise = null;
            });
        }, probeIntervalMs);
        task.probeTimer?.unref?.();
    };

    const probeAndHandle = async task => {
        if (!task || activeTask !== task || task.state === 'completed') return;
        if (task.probing) return;
        task.probing = true;
        let state = task.state;
        try {
            state = await probeTask(task);
        }
        finally {
            task.probing = false;
        }
        if (!cancelled || activeTask !== task) return;
        if (state === 'completed') {
            task.state = 'completed';
            clearProbeTimer(task);
            return;
        }
        task.state = state;
        if (task.state === 'queued' || task.state === 'unknown') {
            scheduleProbe(task);
            return;
        }
        interruptTask(task);
    };

    const maybeInterrupt = task => {
        if (!task || !cancelled || task.state === 'completed') return;
        if (task.state === 'running') {
            interruptTask(task);
            return;
        }
        if (task.state === 'queued') {
            scheduleProbe(task);
            return;
        }
        const promise = probeAndHandle(task);
        probePromise = promise;
        promise.finally(() => {
            if (probePromise === promise) probePromise = null;
        });
    };

    const requestCancel = () => {
        if (terminal || cancelled) return false;
        cancelled = true;
        maybeInterrupt(activeTask);
        return true;
    };

    const setTaskState = (state, { sessionHash = null } = {}) => {
        if (!activeTask || activeTask.state === 'completed') return;
        if (sessionHash && sessionHash !== activeTask.sessionHash) return;
        if (state === 'running' || state === 'queued' || state === 'completed') {
            activeTask.state = state;
        }
        if (state === 'completed') {
            clearProbeTimer(activeTask);
            return;
        }
        if (cancelled) maybeInterrupt(activeTask);
    };

    const beginTask = (task = {}) => {
        if (terminal || cancelled) return null;
        const sessionHash = task.sessionHash;
        if (typeof sessionHash !== 'string' || !sessionHash) {
            throw new Error('Forge cancellation requires a non-empty session hash.');
        }
        const active = {
            token: Symbol('forge-task'),
            sessionHash,
            taskId: taskIdFor(sessionHash),
            endpoint: task.endpoint || endpoint,
            abortFnIndex: Number.isInteger(task.abortFnIndex) ? task.abortFnIndex : abortFnIndex,
            headers: { ...headers, ...(task.headers || {}) },
            service: task.service || service,
            state: task.state || 'unknown',
            startedAt: now(),
            interruptPromise: null,
            probeTimer: null,
            probing: false,
        };
        activeTask = active;
        if (cancelled) {
            active.state = 'completed';
            activeTask = null;
            return null;
        }
        return active;
    };

    const endTask = task => {
        const target = task?.token ? task : activeTask;
        if (!target || activeTask !== target) return false;
        target.state = 'completed';
        clearProbeTimer(target);
        activeTask = null;
        return true;
    };

    const drain = async () => {
        if (probePromise) {
            try { await probePromise; }
            catch (error) { logger?.log?.(error); }
        }
        while (interruptPromises.size > 0) {
            try {
                await Promise.allSettled([...interruptPromises]);
            }
            catch (error) {
                logger?.log?.(error);
            }
        }
        return lastInterrupt;
    };

    const installCollector = options => {
        if (collector || terminal) return collector;
        const targetInteraction = options?.interaction || interaction;
        const targetCustomId = options?.customId || customId;
        if (!targetInteraction?.channel?.createMessageComponentCollector || !targetCustomId) return null;
        const ownerId = targetInteraction.user?.id;
        collectorStopped = false;
        collector = targetInteraction.channel.createMessageComponentCollector({
            filter: component => component?.customId === targetCustomId &&
                (!ownerId || component?.user?.id === ownerId),
            time: options?.time ?? collectorTimeMs,
        });
        collectorHandler = component => {
            // No await before requestCancel(): a delayed Discord acknowledgement
            // must never postpone the Forge interrupt until after the lease is
            // released.
            const accepted = requestCancel();
            stopCollector();
            Promise.resolve()
                .then(() => component?.deferUpdate?.())
                .catch(error => logger?.log?.(error));
            const cancelCallback = options?.onCancel || onCancel;
            if (cancelCallback) {
                Promise.resolve()
                    .then(() => cancelCallback(component, accepted))
                    .catch(error => logger?.log?.(error));
            }
        };
        collector.on('collect', collectorHandler);
        return collector;
    };

    const cancelledMessage = () => {
        if (!lastInterrupt || lastInterrupt.ok) return CANCELLED_MESSAGE;
        const detail = lastInterrupt.error?.message || String(lastInterrupt.error || 'unknown error');
        return `${CANCELLED_MESSAGE}\nForge interrupt failed: ${detail}`;
    };

    const reportCancelled = () => {
        if (reportPromise) return reportPromise;
        reportPromise = (async () => {
            await drain();
            const target = interaction;
            if (!target?.editReply) return;
            try {
                await target.editReply({ content: cancelledMessage(), components: [] });
            }
            catch (error) {
                logger?.log?.(error);
            }
        })();
        return reportPromise;
    };

    const finish = async () => {
        terminal = true;
        stopCollector();
        if (activeTask) {
            clearProbeTimer(activeTask);
            activeTask.state = 'completed';
            activeTask = null;
        }
        await drain();
    };

    return {
        CANCELLED_MESSAGE,
        isCancelled,
        requestCancel,
        beginTask,
        endTask,
        setTaskState,
        drain,
        installCollector,
        stopCollector,
        reportCancelled,
        cancelledMessage,
        finish,
        get activeTask() { return activeTask; },
        get lastInterrupt() { return lastInterrupt; },
    };
}

module.exports = {
    CANCELLED_MESSAGE,
    DEFAULT_INTERRUPT_TIMEOUT_MS,
    DEFAULT_PROBE_INTERVAL_MS,
    createForgeCancellation,
    sendForgeInterrupt,
};
