const crypto = require('crypto');
const axios = require('axios');
const h3Template = require('../resources/video_minimax_h3_t2v.json');
const postTemplate = require('../resources/video_post_process.json');

const H3_FPS = 24;
const MAX_PIXELS = 1344 * 768;

function videoShape(width, height, seconds = 5) {
    if (![width, height, seconds].every(Number.isFinite) || width < 32 || height < 32 || seconds < 1 || seconds > 15) {
        throw new Error('Video dimensions must be at least 32 pixels and duration must be 1–15 seconds.');
    }
    width = Math.max(32, Math.round(width / 32) * 32);
    height = Math.max(32, Math.round(height / 32) * 32);
    if (width * height > MAX_PIXELS) throw new Error('MiniMax H3 supports at most 1.03 megapixels per frame.');
    const requested = Math.max(5, Math.round(seconds * H3_FPS));
    const length = requested + (5 - requested % 17 + 17) % 17;
    return { width, height, length, fps: H3_FPS, seconds: length / H3_FPS };
}

function imageVideoShape(width, height, megapixels = 0.8, seconds = 5) {
    const scale = Math.sqrt(megapixels * 1_000_000 / (width * height));
    // Round down so the aligned dimensions cannot exceed the model's area cap.
    return videoShape(Math.max(32, Math.floor(width * scale / 32) * 32),
        Math.max(32, Math.floor(height * scale / 32) * 32), seconds);
}

function inputPath(upload) {
    if (!upload?.name) throw new Error('ComfyUI did not return an uploaded filename.');
    return [upload.subfolder, upload.name].filter(Boolean).join('/');
}

function buildH3Workflow({ prompt, shape, seed = crypto.randomInt(0, 2_000_000_000), image, lastImage, steps = 20, upscale = true, optimize = true }) {
    if (!prompt?.trim()) throw new Error('A video prompt is required.');
    if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('Seed must be a non-negative safe integer.');
    if (!Number.isInteger(steps) || steps < 1 || steps > 50) throw new Error('Steps must be between 1 and 50.');
    const workflow = JSON.parse(JSON.stringify(h3Template));
    // The bot enriches the prompt and unloads its LLM before submission, so the
    // desktop template's LM Studio and preview nodes are unnecessary here.
    for (const id of ['115', '142', '143', '144', '145', '146', '148', '105:107', '105:111']) delete workflow[id];
    Object.assign(workflow['105:104'].inputs, { prompt, width: shape.width, height: shape.height, length: shape.length });
    workflow['105:15'].inputs.noise_seed = seed;
    workflow['105:9'].inputs.steps = steps;
    workflow['105:91'].inputs.fps = H3_FPS;
    Object.assign(workflow['92'].inputs, { format: 'mp4', codec: 'h264', 'format.codec': 'h264' });
    if (image) {
        workflow.input_image = { class_type: 'LoadImage', inputs: { image: inputPath(image) } };
        workflow['105:104'].inputs.first_frame = ['input_image', 0];
    }
    if (lastImage) {
        workflow.last_image = { class_type: 'LoadImage', inputs: { image: inputPath(lastImage) } };
        workflow['105:104'].inputs.last_frame = ['last_image', 0];
    }
    if (!upscale) {
        delete workflow['105:127'];
        workflow['105:91'].inputs.images = ['105:10', 0];
    }
    if (!optimize) {
        delete workflow['105:124'];
        workflow['105:9'].inputs.model = ['105:120', 0];
        workflow['105:16'].inputs.model = ['105:120', 0];
    }
    return workflow;
}

function buildPostProcessWorkflow({ video, reference, color = 'None', strength = 1, upscaler = 'None', interpolation = 'None', multiplier = 2 }) {
    if (!Number.isInteger(multiplier) || multiplier < 1 || multiplier > 10) throw new Error('FPS multiplier must be a whole number from 1 to 10.');
    if (color !== 'None' && !reference) throw new Error('Reference image is required for color correction.');
    const interpolate = interpolation !== 'None' && multiplier > 1;
    if (color === 'None' && upscaler === 'None' && !interpolate) throw new Error('No post processing options selected, nothing to do.');
    const workflow = JSON.parse(JSON.stringify(postTemplate));
    workflow['1'].inputs.video = inputPath(video);
    workflow['1'].inputs.format = 'None';
    delete workflow['1'].inputs.force_size;
    let frames = ['1', 0];
    if (color === 'None') {
        delete workflow['2'];
        delete workflow['3'];
    } else {
        Object.assign(workflow['2'].inputs, { method: color, strength });
        workflow['3'].inputs.image = inputPath(reference);
        frames = ['2', 0];
    }
    if (upscaler === 'None') {
        delete workflow['5'];
        delete workflow['6'];
    } else {
        workflow['5'].inputs.model_name = upscaler;
        workflow['6'].inputs.image = frames;
        frames = ['6', 0];
    }
    if (interpolate) {
        Object.assign(workflow['7'].inputs, {
            ckpt_name: interpolation, multiplier, frames, dtype: 'float32', torch_compile: false, batch_size: 1,
        });
        frames = ['7', 0];
    } else delete workflow['7'];
    delete workflow['9'];
    delete workflow['14'];
    // The installed core math node replaces the removed Derf/JW custom nodes.
    workflow['13'] = { class_type: 'ComfyMathExpression', inputs: {
        expression: `a * ${interpolate ? multiplier : 1}`, 'values.a': ['8', 5],
    } };
    Object.assign(workflow['4'].inputs, { images: frames, audio: ['1', 2], frame_rate: ['13', 0] });
    return workflow;
}

function videoOutput(outputs) {
    for (const output of Object.values(outputs || {})) {
        for (const key of ['images', 'gifs', 'videos']) {
            const file = output?.[key]?.find(item => /\.(mp4|webm|mkv|mov)$/i.test(item.filename || ''));
            if (file) return file;
        }
    }
    throw new Error('ComfyUI finished without a saved video. Check the SaveVideo/VideoCombine output.');
}

function errorMessage(error) {
    const detail = error?.response?.data;
    const nodes = detail?.node_errors;
    const nodeErrors = nodes && Object.entries(nodes).map(([id, node]) =>
        `${id}: ${(node.errors || []).map(item => item.message + (item.details ? ` (${item.details})` : '')).join('; ')}`).join('\n');
    const message = nodeErrors || detail?.detail || detail?.error?.message || error?.exception_message || error?.error || error?.message || String(error);
    return (typeof message === 'string' ? message : JSON.stringify(message)).slice(0, 1800);
}

// Serialize and throttle edits so progress cannot overwrite the final result.
function mediaReply(interaction) {
    let terminal = false, lastUpdate = 0, chain = Promise.resolve();
    async function send(payload) {
        try { return await interaction.editReply(payload); }
        catch (error) {
            if ([10015, 10062, 50027].includes(error.code) && interaction.channel) return interaction.channel.send(payload);
            throw error;
        }
    }
    return {
        progress(content) {
            if (terminal || Date.now() - lastUpdate < 3000) return;
            lastUpdate = Date.now();
            // Progress may outlive Discord's interaction token. Only the final
            // result falls back to a channel message; progress stays quiet.
            chain = chain.then(() => terminal ? undefined : interaction.editReply({ content })).catch(() => {});
        },
        async finish(payload) {
            terminal = true;
            await chain;
            return send(payload);
        },
    };
}

async function deliverFile(reply, interaction, buffer, filename, content) {
    filename = filename.split(/[\\/]/).pop();
    const limit = interaction.attachmentSizeLimit || 9_800_000;
    if (buffer.length <= limit) return reply.finish({ content, files: [{ attachment: buffer, name: filename }] });
    // The old catbox helper now calls an image-only host. Upload videos/GLBs
    // to Catbox itself and send a link instead of re-attaching an oversized file.
    if (buffer.length > 200 * 1024 * 1024) throw new Error('Output exceeds Catbox’s 200 MiB upload limit. Use a smaller generation.');
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([buffer]), filename);
    const response = await axios.post('https://catbox.moe/user/api.php', form, { timeout: 120_000, maxBodyLength: Infinity });
    const url = String(response.data).trim();
    if (!/^https:\/\/files\.catbox\.moe\/[\w.-]+$/.test(url)) throw new Error(`File hosting failed: ${url.slice(0, 200)}`);
    return reply.finish({ content: `${content}\n${url}` });
}

async function runVideo(interaction, workflow, shape) {
    const comfy = require('./comfy_client');
    const reply = mediaReply(interaction);
    try {
        reply.progress('Submitting video workflow…');
        const result = await comfy.runPrompt(workflow, {
            onProgress(data) {
                const title = workflow[data.node]?._meta?.title || workflow[data.node]?.class_type;
                if (title) reply.progress(`Processing: ${title}${data.max ? ` (${data.value}/${data.max})` : ''}`);
            },
        });
        const file = videoOutput(result.outputs);
        const buffer = Buffer.from(await comfy.getImage(file.filename, file.subfolder || '', file.type || 'output'));
        const description = shape ? `Video ready (${shape.width}×${shape.height}, ${shape.seconds.toFixed(2)}s, 24 fps before upscaling).` : 'Video processing complete.';
        await deliverFile(reply, interaction, buffer, file.filename, description);
    } catch (error) {
        await reply.finish({ content: `Video failed: ${errorMessage(error)}` });
    }
}

module.exports = { H3_FPS, videoShape, imageVideoShape, inputPath, buildH3Workflow, buildPostProcessWorkflow,
    videoOutput, errorMessage, mediaReply, deliverFile, runVideo };
