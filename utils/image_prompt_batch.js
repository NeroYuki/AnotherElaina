'use strict';

// Transport helper for txt2img image-prompt batches. The enhancement plan
// always keeps the original prompt as an immutable prefix; this module only
// handles the per-image Gradio submissions and the merged delivery shape.

const CANCELLED_CODE = 'IMAGE_PROMPT_BATCH_CANCELLED';

class ImagePromptBatchCancelled extends Error {
    constructor(message = 'Image generation was cancelled.') {
        super(message);
        this.name = 'ImagePromptBatchCancelled';
        this.code = CANCELLED_CODE;
    }
}

function isImagePromptBatchCancelled(error) {
    return Boolean(error && error.code === CANCELLED_CODE);
}

function parseMetadata(raw, index) {
    if (raw === undefined || raw === null || raw === '') return {};
    if (typeof raw !== 'string') {
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        throw new Error(`Image batch request ${index + 1} returned invalid metadata JSON.`);
    }
}

function readResponse(response, index) {
    if (!response || typeof response !== 'object') {
        throw new Error(`Image batch request ${index + 1} returned no response.`);
    }
    if (response.status !== 200) {
        throw new Error(`Image batch request ${index + 1} returned status ${response.status ?? 'unknown'}.`);
    }
    const payload = response.data;
    if (!payload || !Array.isArray(payload.data)) {
        throw new Error(`Image batch request ${index + 1} returned no Gradio data.`);
    }
    const rawValues = Array.isArray(payload.data[0]?.value) ? payload.data[0].value : [];
    const values = rawValues.filter(item => item && item.image && typeof item.image.path === 'string' && item.image.path);
    if (values.length === 0) {
        throw new Error(`Image batch request ${index + 1} returned no image paths.`);
    }
    return { payload, values, metadata: parseMetadata(payload.data[2], index) };
}

/**
 * Split one Gradio gallery into its leading heatmaps and actual generated
 * images. Forge receives heatmaps first, then an optional grid, then the real
 * images. `index_of_first_image` identifies the first non-grid image.
 */
function splitGallery(values, metadata, heatmapsPerImage, index) {
    if (values.length < heatmapsPerImage + 1) {
        throw new Error(`Image batch request ${index + 1} returned fewer images than the expected DAAM heatmaps.`);
    }
    const heatmaps = values.slice(0, heatmapsPerImage);
    let actualStart = heatmapsPerImage;
    const firstActual = Number(metadata.index_of_first_image);
    if (Number.isInteger(firstActual) && firstActual > actualStart) {
        if (firstActual >= values.length) {
            throw new Error(`Image batch request ${index + 1} returned no images after its grid.`);
        }
        actualStart = firstActual;
    }
    const actual = values.slice(actualStart);
    if (actual.length === 0) {
        throw new Error(`Image batch request ${index + 1} returned no images after filtering grids and heatmaps.`);
    }
    return { heatmaps, actual };
}

function mergeMetadata(metadataList, heatmapCount) {
    const merged = {};
    for (const metadata of metadataList) {
        for (const [key, value] of Object.entries(metadata)) {
            if (!(key in merged)) merged[key] = value;
        }
    }
    const arrayKeys = new Set();
    for (const metadata of metadataList) {
        for (const [key, value] of Object.entries(metadata)) {
            if (Array.isArray(value) && (key.startsWith('all_') || key === 'infotexts')) {
                arrayKeys.add(key);
            }
        }
    }
    for (const key of arrayKeys) {
        merged[key] = metadataList.flatMap(metadata => Array.isArray(metadata[key]) ? metadata[key] : []);
    }
    merged.index_of_first_image = heatmapCount;
    if (merged.seed === undefined || merged.seed === null) merged.seed = -1;
    if (merged.sd_model_hash === undefined) merged.sd_model_hash = '-';
    if (merged.sd_model_name === undefined) merged.sd_model_name = '-';
    return merged;
}

/**
 * Merge per-image Gradio responses into the packet shape the existing
 * commands already understand. Heatmaps are grouped in a prefix, synthetic
 * grids are dropped, actual images are concatenated, and only the envelope
 * `data[0].value` plus `data[2]` metadata are rebuilt.
 */
function mergeBatchResponses(responses, heatmapsPerImage = 0, { pidImagesPerRequest = 0 } = {}) {
    if (!Array.isArray(responses) || responses.length === 0) {
        throw new Error('Image batch returned no responses to merge.');
    }
    const parsed = responses.map((response, index) => {
        const item = readResponse(response, index);
        const split = splitGallery(item.values, item.metadata, heatmapsPerImage, index);
        if (pidImagesPerRequest > 0) {
            if (split.actual.length < pidImagesPerRequest) {
                throw new Error(`Image batch request ${index + 1} returned fewer PiD images than expected.`);
            }
            split.actual = split.actual.slice(-pidImagesPerRequest);
        }
        return { ...item, ...split };
    });

    const heatmaps = [];
    const actual = [];
    let duration = 0;
    for (const item of parsed) {
        heatmaps.push(...item.heatmaps);
        actual.push(...item.actual);
        const value = Number(item.payload.duration);
        if (Number.isFinite(value)) duration += value;
    }

    const metadata = mergeMetadata(parsed.map(item => item.metadata), heatmaps.length);
    const firstPayload = parsed[0].payload;
    const firstData = Array.isArray(firstPayload.data) ? firstPayload.data : [];

    return {
        ...responses[0],
        status: 200,
        data: {
            ...firstPayload,
            data: [
                { ...(firstData[0] || {}), value: [...heatmaps, ...actual] },
                firstData[1] ?? null,
                JSON.stringify(metadata),
            ],
            duration,
        },
    };
}

function validatePlan(plan, count) {
    if (!plan || !Array.isArray(plan.prompts) || plan.prompts.length === 0) {
        throw new Error('Image prompt batch requires at least one prepared prompt.');
    }
    if (!Number.isInteger(count) || count < 1) {
        throw new Error('Image prompt batch requires a positive integer image count.');
    }
    if (plan.prompts.some(prompt => typeof prompt !== 'string')) {
        throw new Error('Image prompt batch prompts must be strings.');
    }
}

/**
 * Run the Gradio transport for a prepared image-prompt plan.
 *
 * - all/off (`plan.perImage === false`) sends exactly one request with the
 *   original session hash and returns the send() response unchanged.
 * - each (`plan.perImage === true`) sends `count` sequential requests, one per
 *   prepared prompt, with `<sessionHash>-image-<n>` sessions and seed+index.
 */
async function runImagePromptBatch({
    plan,
    count,
    seed,
    sessionHash,
    buildRequest,
    send,
    shouldCancel = () => false,
    onTask = () => {},
    heatmapsPerImage = 0,
    pidImagesPerRequest = 0,
} = {}) {
    validatePlan(plan, count);
    if (!Number.isInteger(heatmapsPerImage) || heatmapsPerImage < 0) {
        throw new Error('Image prompt batch heatmapsPerImage must be a non-negative integer.');
    }
    if (!Number.isInteger(pidImagesPerRequest) || pidImagesPerRequest < 0) {
        throw new Error('Image prompt batch pidImagesPerRequest must be a non-negative integer.');
    }
    if (typeof buildRequest !== 'function' || typeof send !== 'function') {
        throw new Error('Image prompt batch requires buildRequest and send functions.');
    }
    if (typeof sessionHash !== 'string' || sessionHash.length === 0) {
        throw new Error('Image prompt batch requires a session hash.');
    }

    if (!plan.perImage) {
        if (plan.prompts.length !== 1) {
            throw new Error(`Image prompt batch expected exactly 1 prepared prompt, received ${plan.prompts.length}.`);
        }
        if (shouldCancel()) throw new ImagePromptBatchCancelled();
        const request = await buildRequest({
            prompt: plan.prompts[0], seed, sessionHash, index: 0, perImage: false,
        });
        if (shouldCancel()) throw new ImagePromptBatchCancelled();
        await onTask({ sessionHash, index: 0, seed, perImage: false });
        const response = await send(request);
        if (shouldCancel()) throw new ImagePromptBatchCancelled();
        return response;
    }

    if (plan.prompts.length !== count) {
        throw new Error(`Image prompt batch expected ${count} prepared prompts, received ${plan.prompts.length}.`);
    }
    const responses = [];
    for (let index = 0; index < count; index++) {
        if (shouldCancel()) throw new ImagePromptBatchCancelled();
        const imageSession = `${sessionHash}-image-${index + 1}`;
        const imageSeed = Number.isInteger(seed) && seed >= 0 ? seed + index : -1;
        const request = await buildRequest({
            prompt: plan.prompts[index], seed: imageSeed, sessionHash: imageSession, index, perImage: true,
        });
        if (shouldCancel()) throw new ImagePromptBatchCancelled();
        await onTask({ sessionHash: imageSession, index, seed: imageSeed, perImage: true });
        responses.push(await send(request));
        if (shouldCancel()) throw new ImagePromptBatchCancelled();
    }
    return mergeBatchResponses(responses, heatmapsPerImage, { pidImagesPerRequest });
}

module.exports = {
    CANCELLED_CODE,
    ImagePromptBatchCancelled,
    isImagePromptBatchCancelled,
    mergeBatchResponses,
    runImagePromptBatch,
};
