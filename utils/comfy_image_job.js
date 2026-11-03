'use strict';

// Shared ComfyUI job lifecycle for Discord commands.
//
// The runner in comfy_prompt owns submission, exact-instance cancellation,
// history/queue evidence and orchestrator notification. This module owns the
// Discord side: an owner-filtered Cancel button attached before any upload,
// progress edits that keep the button, and exactly one terminal reply. Output
// download/delivery only runs after a confirmed non-cancelled completion.

const { MessageActionRow, MessageButton } = require('discord.js');

function errorText(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    const detail = error.error;
    if (typeof detail === 'string') return detail;
    if (detail?.message) return detail.message;
    return error.message || String(error);
}

function createCancelRow(customId, label = 'Cancel') {
    return new MessageActionRow().addComponents(
        new MessageButton().setCustomId(customId).setLabel(label).setStyle('DANGER'),
    );
}

function outputEntries(outputs) {
    return Object.entries(outputs || {}).map(([node, output]) => ({ node, output }));
}

function firstImageFile(outputs) {
    for (const { output } of outputEntries(outputs)) {
        const file = output?.images?.find(item => item && item.filename);
        if (file) return file;
    }
    return null;
}

function firstMediaFile(outputs, pattern = /\.(png|jpe?g|webp|gif|mp4|webm|mkv|mov)$/i) {
    for (const { output } of outputEntries(outputs)) {
        for (const key of ['images', 'gifs', 'videos']) {
            const file = output?.[key]?.find(item => item && pattern.test(item.filename || ''));
            if (file) return file;
        }
    }
    return null;
}

function createReply(interaction, state, row, logger, progressThrottleMs) {
    let terminal = false;
    let chain = Promise.resolve();
    let lastProgress = 0;
    const send = async payload => {
        try { return await interaction.editReply(payload); }
        catch (error) {
            if ([10015, 10062, 50027].includes(error.code) && interaction.channel) {
                return interaction.channel.send(payload);
            }
            throw error;
        }
    };
    const finalPayload = payload => ({
        ...(payload || {}),
        components: payload?.components ?? [],
    });
    return {
        get terminal() { return terminal; },
        progress(content, extra = {}) {
            if (terminal || state.terminal || state.cancelRequested || !content) return;
            const now = Date.now();
            if (now - lastProgress < progressThrottleMs) return;
            lastProgress = now;
            chain = chain.then(async () => {
                if (terminal || state.terminal || state.cancelRequested) return;
                await interaction.editReply({
                    ...extra,
                    content,
                    components: state.showControls ? [row] : [],
                }).catch(error => logger.log?.(error));
            }).catch(error => logger.log?.(error));
        },
        async cancelPending(content = 'Cancelling…') {
            if (terminal) return;
            state.showControls = false;
            chain = chain.then(async () => {
                if (terminal) return;
                await interaction.editReply({ content, components: [] }).catch(error => logger.log?.(error));
            }).catch(error => logger.log?.(error));
            await chain;
        },
        async finish(payload) {
            if (terminal) return;
            terminal = true;
            state.terminal = true;
            state.showControls = false;
            await chain.catch(error => logger.log?.(error));
            return send(finalPayload(payload));
        },
    };
}

async function defaultImageDeliver(result, context, successContent) {
    if (context.cancelled) return null;
    const file = firstImageFile(result?.outputs);
    if (!file) throw new Error('ComfyUI finished without an image output.');
    const buffer = await context.download(file);
    if (context.cancelled) return null;
    return {
        content: successContent || 'Comfy backend returned file',
        files: [{ attachment: buffer, name: file.filename.split(/[\\/]/).pop() }],
    };
}

/**
 * Run one ComfyUI callback workflow with a Discord Cancel button.
 *
 * Options:
 * - workflow: graph object, or use prepare(ctx) when uploads must be cancellable.
 * - prepare(ctx): async upload/setup step. Runs after the Cancel button appears.
 * - progress(data, ctx): return a progress string for WS executing/progress.
 * - deliver(result, ctx): deliver a successful result. May call ctx.finish or
 *   return a Discord payload. Cancellation during delivery suppresses it.
 * - errorContent(error): final error text.
 * - initialContent, cancelContent, cancelFailedContent(reason).
 * - timeoutMs, pollMs, runOptions: passed to client.runPrompt.
 * - onProgress/onSubprogress/onExecuted: legacy callback adapters.
 * - client, logger, freeMemory, cancelCustomId, cancelLabel,
 *   progressThrottleMs, collectorTimeMs.
 *
 * ctx exposes uploadImage, download(file), freeMemory, promptId, instanceId,
 * cancelled, signal, reply, progress, finish and cancel.
 */
async function runComfyJob(interaction, {
    client = require('./comfy_client'),
    workflow = null,
    prepare = null,
    initialContent = 'Submitting ComfyUI job…',
    progress = null,
    deliver = null,
    successContent = 'Comfy backend returned file',
    errorContent = errorText,
    cancelContent = 'Cancelled.',
    cancelFailedContent = reason => `Cancel failed: ${reason}`,
    timeoutMs,
    pollMs,
    runOptions = {},
    cancelCustomId = `cancel_comfy_${interaction?.id ?? 'unknown'}`,
    cancelLabel = 'Cancel',
    collectorTimeMs,
    progressThrottleMs = 2500,
    freeMemory = true,
    logger = console,
    onProgress = null,
    onSubprogress = null,
    onExecuted = null,
    onSubmitted = null,
} = {}) {
    if (!interaction) throw new Error('runComfyJob requires an interaction');
    if (!client?.runPrompt) throw new Error('runComfyJob requires a ComfyUI client with runPrompt.');

    const row = createCancelRow(cancelCustomId, cancelLabel);
    const state = {
        terminal: false,
        showControls: true,
        cancelRequested: false,
        cancelConfirmed: false,
        cancelled: false,
        promptId: null,
        instanceId: null,
    };
    const abortController = new AbortController();
    const reply = createReply(interaction, state, row, logger, progressThrottleMs);
    let collector = null;
    let runnerController = null;
    let runError = null;
    let cancelledResult = false;

    const stopCollector = () => {
        try { collector?.stop?.(); }
        catch (error) { logger.log?.(error); }
        collector = null;
    };

    const context = {
        interaction,
        client,
        reply,
        signal: abortController.signal,
        get cancelled() { return state.cancelRequested; },
        get confirmed() { return state.cancelConfirmed; },
        get promptId() { return state.promptId; },
        get prompt_id() { return state.promptId; },
        get instanceId() { return state.instanceId; },
        get instance_id() { return state.instanceId; },
        progress(content, extra) { return reply.progress(content, extra); },
        finish(payload) { return reply.finish(payload); },
        async uploadImage(...args) { return client.uploadImage(...args); },
        async download(file, options = {}) {
            const buffer = await client.getImage(
                file.filename,
                options.subfolder ?? file.subfolder ?? '',
                options.filetype ?? file.type ?? 'output',
                options.onlyFilename ?? false,
                {
                    instanceId: state.instanceId,
                    affinityKey: state.promptId ? `comfy-prompt:${state.promptId}` : undefined,
                },
            );
            return Buffer.from(buffer);
        },
        freeMemory() {
            if (!state.instanceId || !client.freeMemory) return Promise.resolve();
            return Promise.resolve(client.freeMemory(true, { instanceId: state.instanceId }));
        },
    };

    const requestCancel = async () => {
        if (state.terminal) return { status: 'finished' };
        if (!state.cancelRequested) {
            state.cancelRequested = true;
            state.showControls = false;
            abortController.abort();
        }
        if (runnerController?.cancel) {
            try { return await runnerController.cancel(); }
            catch (error) { return { status: 'error', error }; }
        }
        return { status: 'pending' };
    };
    context.cancel = requestCancel;

    const onCancel = async component => {
        // A stale button from a finished/released job must not cancel the next
        // prompt. Acknowledge it without touching any backend state.
        if (state.terminal || state.cancelRequested) {
            await Promise.resolve(component?.deferUpdate?.()).catch(() => {});
            return;
        }
        state.cancelRequested = true;
        state.showControls = false;
        stopCollector();
        // Request the exact backend cancellation before spending a round-trip
        // on the Discord progress edit.
        abortController.abort();
        if (runnerController?.cancel) {
            runnerController.cancel().catch(error => logger.log?.(error));
        }
        await Promise.resolve(component?.deferUpdate?.()).catch(() => {});
        await reply.cancelPending().catch(error => logger.log?.(error));
    };

    if (typeof interaction.channel?.createMessageComponentCollector === 'function') {
        collector = interaction.channel.createMessageComponentCollector({
            filter: component => component.customId === cancelCustomId && component.user?.id === interaction.user?.id,
            time: collectorTimeMs ?? Math.min(5 * 60 * 60 * 1000, (timeoutMs || 60 * 60 * 1000) + 60_000),
        });
        collector.on?.('collect', component => {
            onCancel(component).catch(error => logger.log?.(error));
        });
    }

    try {
        // Attach the owner-filtered button before upload/submission, so a
        // cancellation while an attachment is still uploading is actionable.
        try { await interaction.editReply({ content: initialContent, components: [row] }); }
        catch (error) { logger.log?.(error); }
        if (state.cancelRequested) {
            state.cancelConfirmed = true;
            state.cancelled = true;
            cancelledResult = true;
            await reply.finish({ content: cancelContent });
            return { status: 'cancelled', submitted: false };
        }

        let graph = workflow;
        if (typeof prepare === 'function') graph = await prepare(context);
        if (state.cancelRequested) {
            state.cancelConfirmed = true;
            state.cancelled = true;
            cancelledResult = true;
            await reply.finish({ content: cancelContent });
            return { status: 'cancelled', submitted: false };
        }
        if (!graph) throw new Error('ComfyUI workflow was not provided.');

        const result = await client.runPrompt(graph, {
            ...runOptions,
            ...(timeoutMs ? { timeoutMs } : {}),
            ...(pollMs ? { pollMs } : {}),
            signal: abortController.signal,
            onController(controller) {
                runnerController = controller;
                runOptions.onController?.(controller);
            },
            onSubmitted(info) {
                state.promptId = info.prompt_id;
                state.instanceId = info.instance_id;
                try { onSubmitted?.(info, context); }
                catch (error) { logger.log?.(error); }
            },
            onProgress(data) {
                if (state.cancelRequested || state.terminal) return;
                try {
                    const message = progress?.(data, context);
                    if (message) reply.progress(message);
                    onProgress?.(data, context);
                }
                catch (error) { logger.log?.(error); }
            },
            onSubprogress(data) {
                if (state.cancelRequested || state.terminal) return;
                try {
                    const message = progress?.(data, context);
                    if (message) reply.progress(message);
                    onSubprogress?.(data, context);
                }
                catch (error) { logger.log?.(error); }
            },
            onExecuted(data) {
                try { onExecuted?.(data, context); }
                catch (error) { logger.log?.(error); }
            },
        });

        if (result?.status === 'cancelled') {
            state.cancelConfirmed = true;
            state.cancelled = true;
            cancelledResult = true;
            await reply.finish({ content: cancelContent });
            return {
                status: 'cancelled',
                result,
                promptId: state.promptId,
                instanceId: state.instanceId,
            };
        }
        if (result?.status === 'cancel-failed') {
            await reply.finish({
                content: cancelFailedContent(result.reason || 'ComfyUI did not confirm the job stopped.'),
            });
            return {
                status: 'cancel-failed',
                result,
                reason: result.reason,
                promptId: state.promptId,
                instanceId: state.instanceId,
            };
        }
        if (state.cancelRequested) {
            await reply.finish({
                content: cancelFailedContent('the job finished before cancellation was confirmed.'),
            });
            return {
                status: 'cancel-failed',
                result,
                reason: 'completed-before-cancel',
                promptId: state.promptId,
                instanceId: state.instanceId,
            };
        }

        const payload = deliver
            ? await deliver(result, context)
            : await defaultImageDeliver(result, context, successContent);
        if (!reply.terminal) {
            if (state.cancelRequested) {
                await reply.finish({
                    content: cancelFailedContent('the job finished before cancellation was confirmed.'),
                });
            }
            else if (payload) await reply.finish(payload);
            else await reply.finish({ content: successContent });
        }
        return {
            status: 'completed',
            result,
            promptId: state.promptId,
            instanceId: state.instanceId,
        };
    }
    catch (error) {
        runError = error;
        const cancellationFailure = state.cancelRequested &&
            (error?.cancelError || error?.jobMayBeRunning);
        const content = cancellationFailure
            ? `Cancel failed: ${errorText(error)}`
            : errorContent(error);
        await reply.finish({ content }).catch(finishError => logger.log?.(finishError));
        return {
            status: 'error',
            error,
            promptId: state.promptId,
            instanceId: state.instanceId,
        };
    }
    finally {
        state.terminal = true;
        state.showControls = false;
        stopCollector();
        // Never free a shared instance while a timed-out/uncertain job may still
        // be executing. A cancelled job also skips cleanup because a queued
        // cancellation may leave another prompt running on the same instance.
        // Downloads and cleanup both use the submission affinity.
        if (freeMemory && !cancelledResult && state.instanceId && !runError?.jobMayBeRunning) {
            try { await context.freeMemory(); }
            catch (error) { logger.log?.(error); }
        }
    }
}

function runComfyImageJob(interaction, workflow, options = {}) {
    const {
        deliver = (result, context) => defaultImageDeliver(result, context, options.successContent),
        ...rest
    } = options;
    return runComfyJob(interaction, { ...rest, workflow, deliver });
}

module.exports = {
    runComfyJob,
    runComfyImageJob,
    defaultImageDeliver,
    firstImageFile,
    firstMediaFile,
    createCancelRow,
    errorText,
};
