'use strict';

// Shared Forge image inference/delivery path.
//
// The command executors own the Forge lease and the model/mode setup. This
// module only performs the queued Gradio prediction itself: progress polling,
// cancellation (including stale-button protection), image download/retry,
// final embed/file delivery, DAAM heatmaps, and PiD result selection.

const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { default: axios } = require('axios');
const { serviceHeaders } = require('./proxy_config');
const { workloadHeaders } = require('./orchestrator_workload');
const { fetchProgressJson } = require('./forge_progress');
const { createForgeCancellation } = require('./forge_cancel');

const SD_HEADERS = serviceHeaders('sdwebui');
const _nodeFetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const defaultFetch = (url, options = {}) => _nodeFetch(url, {
    ...options,
    headers: { ...SD_HEADERS, ...(options.headers || {}) },
});

function galleryPath(item) {
    if (!item) return null;
    if (typeof item === 'string') return item;
    if (typeof item === 'object') {
        if (typeof item.image?.path === 'string') return item.image.path;
        if (typeof item.path === 'string') return item.path;
    }
    return null;
}

function isTemporaryGradioPath(filePath) {
    return /(?:^|[\\/])(?:Temp|tmp)[\\/]gradio[\\/]/i.test(String(filePath || ''));
}

/**
 * Select the actual result from Forge's output gallery.
 *
 * Forge keeps DAAM heatmaps before the generated image(s). Inpaint and some
 * ControlNet paths append temporary mask/preview files after the real output.
 * PiD appends its upscaled result after the base images, so the last generated
 * candidate is the image the user asked for. Never assume the first gallery
 * item is a grid.
 */
function selectGalleryResult(value, { daamHeatmapCount = 0, pid = false } = {}) {
    const gallery = Array.isArray(value) ? value : [];
    const skip = Number.isInteger(daamHeatmapCount) && daamHeatmapCount > 0 ? daamHeatmapCount : 0;
    const paths = gallery.slice(skip).map(galleryPath).filter(Boolean);
    const generated = paths.filter(path => !isTemporaryGradioPath(path));
    const candidates = generated.length ? generated : paths;
    if (!candidates.length) return null;
    return pid ? candidates[candidates.length - 1] : candidates[0];
}

function dataUriToBuffer(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/^data:image\/[^;,]+;base64,(.+)$/s);
    if (!match) return null;
    return Buffer.from(match[1], 'base64');
}

function resolveFileUrl(endpoint, filePath) {
    if (typeof filePath !== 'string' || !filePath) return null;
    if (filePath.startsWith('data:image/')) return filePath;
    if (/^https?:\/\//i.test(filePath)) return filePath;
    return `${endpoint}/file=${filePath}`;
}

async function fetchImageBuffer({
    endpoint, filePath, fetchImpl = defaultFetch, retries = 3, retryDelayMs = 2000, sleep = defaultSleep, logger = console,
} = {}) {
    const inline = dataUriToBuffer(filePath);
    if (inline) return inline;

    const url = resolveFileUrl(endpoint, filePath);
    if (!url) throw new Error('Forge returned no image');

    let lastError = null;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await fetchImpl(url);
            if (response && (response.status === 200 || response.ok)) {
                return Buffer.from(await response.arrayBuffer());
            }
            lastError = new Error(`Image download returned status ${response?.status ?? 'unknown'}`);
        }
        catch (error) {
            lastError = error;
        }
        if (attempt + 1 < retries) {
            logger.log?.('Error while fetching image on remote server, retrying...');
            await sleep(retryDelayMs);
        }
    }
    throw lastError || new Error('Error while fetching image on remote server');
}

function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function safeJson(value, fallback) {
    try {
        return value ? JSON.parse(value) : fallback;
    }
    catch {
        return fallback;
    }
}

function abortSafePromise(value) {
    return Promise.resolve(value).catch(() => {});
}

function createCancelButton(customId) {
    return new MessageActionRow().addComponents(
        new MessageButton().setCustomId(customId).setLabel('Cancel').setStyle('DANGER'),
    );
}

/**
 * Run one Forge img2img prediction and deliver its result.
 *
 * The caller must already own the Forge session lease and any image-mode
 * context; cancellation will never abort once this job has finished or has
 * been released. All failure, cancellation and success paths stop the
 * collector and clear the progress timer.
 */
async function runForgeImageJob({
    interaction,
    serverIndex = 0,
    sessionHash,
    endpoint,
    fnIndex,
    abortFnIndex = null,
    data,
    workload = null,
    customIdPrefix = 'cancel_img2img_',
    cancelCustomId = `${customIdPrefix}${interaction?.id ?? 'unknown'}`,
    title = 'Output',
    completionFooter = null,
    completionFields = [],
    daamHeatmapCount = 0,
    pid = null,
    pidExpectedWidth = null,
    pidExpectedHeight = null,
    postpass = null,
    postpassExpectedWidth = null,
    postpassExpectedHeight = null,
    completionDelayMs = 2000,
    retryDelayMs = 2000,
    fetchRetries = 3,
    progress = {},
    logger = console,
} = {}, deps = {}) {
    const axiosImpl = deps.axios || axios;
    const fetchImpl = deps.fetchImpl || defaultFetch;
    const sleep = deps.sleep || defaultSleep;
    const setTimeoutImpl = deps.setTimeout || setTimeout;
    const clearTimeoutImpl = deps.clearTimeout || clearTimeout;
    const now = deps.now || Date.now;

    if (!interaction) throw new Error('runForgeImageJob requires an interaction');
    if (!endpoint) throw new Error('runForgeImageJob requires a Forge endpoint');
    if (!Number.isInteger(fnIndex)) throw new Error('runForgeImageJob requires a fn_index');

    const progressOptions = {
        enabled: true,
        initialDelay: 2000,
        increment: 500,
        ...progress,
    };
    const row = createCancelButton(cancelCustomId);
    const state = {
        active: true,
        submitted: false,
        completed: false,
        cancelled: false,
        failed: false,
    };

    let progressTimer = null;
    let progressDelay = progressOptions.initialDelay;
    let currentPreviewId = 0;
    let currentSessionHash = sessionHash;

    const cancellation = createForgeCancellation({
        interaction,
        customId: cancelCustomId,
        endpoint,
        abortFnIndex,
        headers: SD_HEADERS,
        fetchImpl,
        setTimeoutImpl,
        clearTimeoutImpl,
        logger,
        onCancel: () => {
            // Stale buttons are ignored by the controller before this callback
            // runs. For a live job, stop all cosmetic work immediately; the
            // interrupt itself was already dispatched synchronously.
            state.cancelled = true;
            state.active = false;
            stopProgress();
        },
    });

    const stopProgress = () => {
        if (progressTimer !== null) {
            clearTimeoutImpl(progressTimer);
            progressTimer = null;
        }
    };

    const stopCollector = () => cancellation.stopCollector();
    const isCancelled = () => state.cancelled || cancellation.isCancelled();

    const shouldUpdate = () => state.active && !state.completed && !isCancelled();

    const updateInteractionReply = async (payload, phase = 'queued') => {
        if (!shouldUpdate() && phase !== 'completed') return;
        let embed = null;
        if (phase === 'completed') {
            embed = new MessageEmbed()
                .setColor('#22ff77')
                .setTitle(title)
                .setDescription(`Here you go. Generated in ${Number(payload.duration || 0).toFixed(2)} seconds.`)
                .addField('Random seed', String(payload.seed ?? '-1'), true)
                .addField('Model used', `${payload.model_name || 'Unknown Model'} (${payload.model || '-'})`, true)
                .setImage(`attachment://${payload.img_name}`);
            const footer = completionFooter || `Putting ${Array('my RTX 3090 Ti', "plub's RTX 3070")[serverIndex] ?? 'the GPU'} to good use!`;
            embed.setFooter({ text: footer });
            for (const field of completionFields || []) {
                if (field?.name && field?.value !== undefined) embed.addField(field.name, String(field.value), !!field.inline);
            }
        }
        else if (phase === 'progress') {
            embed = new MessageEmbed()
                .setColor('#ffff00')
                .setTitle('Progress')
                .setDescription('Image creation in progress')
                .addField('Progress (ETA)', `${(Number(payload.progress || 0) * 100).toFixed(2)}% (${(Number(payload.eta) || 0).toFixed(2)}s)`)
                .setFooter({ text: 'Working on it...' });
            if (payload.img) embed.setImage(`attachment://${payload.img_name}`);
        }
        else if (phase === 'queued') {
            embed = new MessageEmbed()
                .setColor('#444444')
                .setTitle('Queueing')
                .setDescription('Waiting for the previous creation to be done')
                .setFooter({ text: 'Imagine not having a 4090 instead kekw' });
        }
        if (!embed) return;

        const replyContent = { embeds: [embed] };
        if (phase !== 'completed') replyContent.components = [row];
        if (payload.img) replyContent.files = [{ attachment: payload.img, name: payload.img_name || 'image.png' }];
        await interaction.editReply(replyContent).catch(error => {
            logger.log?.(error);
        });
    };

    const pollProgress = async () => {
        if (!shouldUpdate()) return;
        let completed = false;
        try {
            const progressObject = await fetchProgressJson(
                `${endpoint}/internal/progress`,
                {
                    id_task: `task(${currentSessionHash})`,
                    id_live_preview: currentPreviewId,
                },
                {
                    fetchImpl,
                    headers: SD_HEADERS,
                    logger,
                    retries: progressOptions.retries,
                    retryDelayMs: progressOptions.retryDelayMs,
                },
            );
            if (!shouldUpdate() || !progressObject) return;
            if (progressObject?.completed) {
                cancellation.setTaskState('completed', { sessionHash: currentSessionHash });
                completed = true;
                return;
            }
            if (progressObject.queued || progressObject.active === true ||
                (progressObject.active !== false && Number(progressObject.progress) > 0)) {
                cancellation.setTaskState(progressObject.queued ? 'queued' : 'running', {
                    sessionHash: currentSessionHash,
                });
            }
            if (progressObject?.queued) {
                await updateInteractionReply({}, 'queued');
                return;
            }
            currentPreviewId = progressObject?.id_live_preview ?? currentPreviewId;
            const previewUri = progressObject?.live_preview;
            await updateInteractionReply({
                img: previewUri ? Buffer.from(previewUri.split(',')[1] || '', 'base64') : null,
                img_name: 'progress_img.png',
                progress: progressObject?.progress,
                eta: progressObject?.eta,
            }, 'progress');
        }
        catch (error) {
            logger.log?.(error);
        }
        finally {
            if (!completed && shouldUpdate()) {
                progressDelay += progressOptions.increment;
                scheduleProgress();
            }
        }
    };

    function scheduleProgress() {
        if (!progressOptions.enabled || !shouldUpdate()) return;
        progressTimer = setTimeoutImpl(() => {
            progressTimer = null;
            pollProgress();
        }, progressDelay);
    }

    // Buttons are installed before submission so a cancel that arrives while
    // this job is still waiting for the local Forge lease records a pending
    // cancellation instead of aborting the current owner.
    cancellation.installCollector({ interaction, customId: cancelCustomId });

    try {
        if (isCancelled()) return { status: 'cancelled' };
        scheduleProgress();
        const mainTask = cancellation.beginTask({
            sessionHash,
            endpoint,
            abortFnIndex,
            headers: SD_HEADERS,
        });
        if (!mainTask) return { status: 'cancelled' };
        state.submitted = true;
        let response;
        try {
            response = await axiosImpl.post(`${endpoint}/run/predict/`, {
                fn_index: fnIndex,
                session_hash: sessionHash,
                data,
            }, {
                headers: workload ? workloadHeaders('sdwebui', workload, SD_HEADERS) : SD_HEADERS,
                timeout: 900000,
            });
        }
        finally {
            cancellation.endTask(mainTask);
            await cancellation.drain();
        }

        if (isCancelled()) return { status: 'cancelled' };
        if (response?.status !== 200) throw new Error('Server can be reached but returned non-200 status');
        let finalResult = response.data;
        if (!finalResult?.data) throw new Error('Request return non-JSON data');

        let galleryValue = finalResult.data[0]?.value;
        const baseGalleryValue = galleryValue;
        let resultPath = selectGalleryResult(galleryValue, { daamHeatmapCount, pid: !!pid });
        if (!resultPath) throw new Error('Request return no image');

        let imageBuffer = await fetchImageBuffer({
            endpoint, filePath: resultPath, fetchImpl, retries: fetchRetries, retryDelayMs, sleep, logger,
        });
        let info = safeJson(finalResult.data[2], {});
        let seed = info.seed ?? -1;
        let modelHash = info.sd_model_hash ?? '-';
        let modelName = info.sd_model_name ?? '-';

        const validatePidDimensions = async (buffer, expectedWidth, expectedHeight) => {
            if (!expectedWidth || !expectedHeight) return null;
            try {
                const sharp = require('sharp');
                const metadata = await sharp(buffer).metadata();
                if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
                    const warning = `PiD returned ${metadata.width}x${metadata.height}; expected ` +
                        `${expectedWidth}x${expectedHeight}.`;
                    logger.warn?.(warning);
                    return warning;
                }
            }
            catch (error) {
                logger.log?.('Unable to validate PiD output dimensions:', error);
            }
            return null;
        };

        let pidWarning = pid ? await validatePidDimensions(imageBuffer, pidExpectedWidth, pidExpectedHeight) : null;

        if (postpass) {
            if (isCancelled()) return { status: 'cancelled' };
            currentSessionHash = `${sessionHash}-pid`;
            currentPreviewId = 0;
            progressDelay = progressOptions.increment;
            scheduleProgress();

            const predictPostpass = async ({ fn_index, session_hash, data: postpassData }) => {
                const postpassTask = cancellation.beginTask({
                    sessionHash: session_hash,
                    endpoint,
                    abortFnIndex,
                    headers: SD_HEADERS,
                });
                if (!postpassTask) return { data: [] };
                let postpassResponse;
                try {
                    postpassResponse = await axiosImpl.post(`${endpoint}/run/predict/`, {
                        fn_index,
                        session_hash,
                        data: postpassData,
                    }, {
                        headers: SD_HEADERS,
                        timeout: 900000,
                    });
                }
                finally {
                    cancellation.endTask(postpassTask);
                    await cancellation.drain();
                }
                if (isCancelled()) return { data: [] };
                if (postpassResponse?.status !== 200) {
                    throw new Error('Server can be reached but returned non-200 status');
                }
                return postpassResponse.data;
            };

            const postpassResult = await postpass({
                packet: finalResult,
                imageBuffer,
                galleryValue: baseGalleryValue,
                info,
                seed,
                sessionHash: currentSessionHash,
                endpoint,
                daamHeatmapCount,
                shouldCancel: () => isCancelled(),
                predict: predictPostpass,
            });
            if (isCancelled()) return { status: 'cancelled' };
            if (!postpassResult?.data?.[0]?.value) throw new Error('PiD postpass returned no result');

            finalResult = postpassResult;
            galleryValue = finalResult.data[0].value;
            resultPath = selectGalleryResult(galleryValue, { daamHeatmapCount: 0, pid: true });
            if (!resultPath) throw new Error('PiD postpass returned no image');
            imageBuffer = await fetchImageBuffer({
                endpoint, filePath: resultPath, fetchImpl, retries: fetchRetries, retryDelayMs, sleep, logger,
            });
            info = safeJson(finalResult.data[2], {});
            seed = info.seed ?? seed;
            modelHash = info.sd_model_hash ?? modelHash;
            modelName = info.sd_model_name ?? modelName;
            pidWarning = await validatePidDimensions(imageBuffer, postpassExpectedWidth, postpassExpectedHeight);
        }

        if (completionDelayMs > 0) await sleep(completionDelayMs);
        if (isCancelled()) return { status: 'cancelled' };

        state.completed = true;
        state.active = false;
        stopProgress();
        stopCollector();

        await updateInteractionReply({
            img: imageBuffer,
            img_name: 'img.png',
            seed: String(seed),
            model: modelHash,
            model_name: modelName,
            duration: Number(finalResult.duration) || 0,
        }, 'completed');

        if (daamHeatmapCount > 0 && typeof interaction.channel?.send === 'function') {
            const allPaths = (Array.isArray(baseGalleryValue) ? baseGalleryValue : [])
                .slice(0, daamHeatmapCount)
                .map(galleryPath)
                .filter(Boolean);
            for (let index = 0; index < allPaths.length; index++) {
                try {
                    const heatmap = await fetchImageBuffer({
                        endpoint, filePath: allPaths[index], fetchImpl, retries: 1, retryDelayMs, sleep, logger,
                    });
                    await interaction.channel.send({
                        content: `DAAM heatmap ${index + 1} of ${daamHeatmapCount}`,
                        files: [{ attachment: heatmap, name: `daam_${index}.png` }],
                    });
                }
                catch (error) {
                    logger.log?.(`Error fetching heatmap ${index + 1}:`, error);
                }
            }
        }

        return {
            status: 'completed',
            imageBuffer,
            seed: String(seed),
            modelHash,
            modelName,
            duration: Number(finalResult.duration) || 0,
            gallery: Array.isArray(galleryValue) ? galleryValue : [],
            pidWarning,
            completedAt: now(),
        };
    }
    catch (error) {
        // A PiD restore failure leaves Forge on the wrong global checkpoint;
        // report it even when the user also cancelled instead of presenting a
        // clean cancellation.
        const restoreFailure = error?.code === 'PID_POSTPASS_RESTORE_FAILED';
        if (isCancelled() && !restoreFailure) return { status: 'cancelled' };
        state.failed = true;
        logger.log?.(error);
        await abortSafePromise(interaction.editReply({
            content: 'Error while creating image: ' + error,
            components: [],
        }));
        return { status: 'error', error };
    }
    finally {
        state.active = false;
        stopProgress();
        stopCollector();
        if (isCancelled() && !state.completed && !state.failed) {
            await cancellation.reportCancelled();
        }
        await cancellation.finish();
    }
}

module.exports = {
    runForgeImageJob,
    selectGalleryResult,
    fetchImageBuffer,
    dataUriToBuffer,
    galleryPath,
    resolveFileUrl,
};
