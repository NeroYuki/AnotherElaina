const crypto = require('crypto');
const axios = require('axios');
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

const H3_MODELS = Object.freeze({
    base: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    hybrid: 'minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors',
    reference: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    turbo: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
    turbo768: 'minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors',
});

function buildH3Workflow({ prompt, shape, seed = crypto.randomInt(0, 2_000_000_000), image, lastImage,
    reference, referenceOnly = false, steps, upscale = true, optimize = true }) {
    if (!prompt?.trim()) throw new Error('A video prompt is required.');
    if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('Seed must be a non-negative safe integer.');
    const turbo = optimize && !reference;
    steps ??= turbo ? 8 : 20;
    if (!Number.isInteger(steps) || steps < 1 || steps > 50) throw new Error('Steps must be between 1 and 50.');
    const node = (class_type, inputs, title) => ({ class_type, inputs, _meta: { title: title || class_type } });
    const workflow = {
        '105:6': node('UNETLoader', { unet_name: reference ? (referenceOnly ? H3_MODELS.reference : H3_MODELS.hybrid) : H3_MODELS.base, weight_dtype: 'default' }),
        '105:13': node('CLIPLoader', { clip_name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', type: 'minimax', device: 'default' }),
        '105:11': node('VAELoader', { vae_name: 'minimax_h3_video_vae_fp16.safetensors' }, 'Video VAE'),
        '105:24': node('VAELoader', { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' }, 'Audio VAE'),
        '105:120': node('ModelAttentionBackend', { model: ['105:6', 0], attention: 'comfy kitchen attention' }, 'Kitchen INT8 attention'),
        '105:104': node(reference ? 'MiniMaxH3ReferenceToVideo' : 'MiniMaxH3ImageToVideo', {
            clip: ['105:13', 0], vae: ['105:11', 0], prompt, width: shape.width, height: shape.height, length: shape.length,
        }),
        '105:15': node('RandomNoise', { noise_seed: seed }),
        '105:17': node('KSamplerSelect', { sampler_name: turbo ? 'euler' : 'res_multistep' }),
        '105:9': node('BasicScheduler', { model: ['105:120', 0], scheduler: 'simple', steps, denoise: 1 }),
        '105:16': node('BasicGuider', { model: ['105:120', 0], conditioning: ['105:104', 0] }),
        '105:14': node('SamplerCustomAdvanced', { noise: ['105:15', 0], guider: ['105:16', 0], sampler: ['105:17', 0],
            sigmas: ['105:9', 0], latent_image: ['105:104', 1] }),
        '105:10': node('VAEDecodeTiled', { samples: ['105:14', 0], vae: ['105:11', 0],
            tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 }),
        '105:23': node('VAEDecodeAudio', { samples: ['105:14', 0], vae: ['105:24', 0] }),
        '105:91': node('CreateVideo', { images: ['105:10', 0], audio: ['105:23', 0], fps: H3_FPS, bit_depth: 8 }),
        '92': node('SaveVideo', { video: ['105:91', 0], filename_prefix: 'video/AnotherElaina_H3',
            format: 'mp4', codec: 'h264', 'format.codec': 'h264' }),
    };
    if (turbo) {
        // The 768p adapter was trained with video/audio shifts 6/3; the
        // lower-resolution adapter uses 12/3. Neither is a Ref2VA adapter.
        const highResolution = Math.min(shape.width, shape.height) >= 704;
        workflow.turbo = node('LoraLoaderModelOnly', { model: ['105:6', 0],
            lora_name: highResolution ? H3_MODELS.turbo768 : H3_MODELS.turbo, strength_model: 1 });
        workflow.shift = node('MiniMaxH3SigmaShift', { model: ['turbo', 0], shift_video: highResolution ? 6 : 12, shift_audio: 3 });
        workflow['105:120'].inputs.model = ['shift', 0];
    }
    if (reference) {
        const inputs = workflow['105:104'].inputs;
        Object.assign(inputs, { audio_vae: ['105:24', 0], ref_image_size: 'match' });
        if (reference.kind === 'image') {
            workflow.reference = node('LoadImage', { image: inputPath(reference.upload) }, 'Reference <Picture 1>');
            inputs['ref_images.ref_image_0'] = ['reference', 0];
        } else if (reference.kind === 'video') {
            workflow.reference = node('VHS_LoadVideo', { video: inputPath(reference.upload), force_rate: H3_FPS,
                custom_width: shape.width, custom_height: shape.height, frame_load_cap: Math.min(shape.length, 360),
                skip_first_frames: 0, select_every_nth: 1, format: 'None' }, 'Reference <Video 1>');
            inputs['ref_videos.ref_video_0'] = ['reference', 0];
            if (reference.hasAudio) inputs['ref_video_audios.ref_video_audio_0'] = ['reference', 2];
        } else if (reference.kind === 'audio') {
            workflow.reference = node('LoadAudio', { audio: inputPath(reference.upload) }, 'Reference <Audio 1>');
            inputs['ref_audios.ref_audio_0'] = ['reference', 0];
        } else throw new Error('Reference must be an image, video, or audio attachment.');
    }
    let conditioning = ['105:104', 0];
    const anchor = (id, upload, frame_idx) => {
        workflow[id] = node('LoadImage', { image: inputPath(upload) });
        if (reference) {
            // Guides preserve the hybrid reference conditioning. Anchor images
            // are separate from the reference tokenizer's <Picture N> IDs.
            const guide = `${id}_guide`;
            workflow[guide] = node('MiniMaxH3AddGuide', { positive: conditioning, latent: ['105:104', 1],
                vae: ['105:11', 0], image: [id, 0], frame_idx });
            conditioning = [guide, 0];
        } else workflow['105:104'].inputs[frame_idx === 0 ? 'first_frame' : 'last_frame'] = [id, 0];
    };
    if (image) {
        anchor('input_image', image, 0);
    }
    if (lastImage) {
        anchor('last_image', lastImage, -1);
    }
    workflow['105:16'].inputs.conditioning = conditioning;
    if (upscale) {
        workflow['105:127'] = node('RTXVideoSuperResolution', { images: ['105:10', 0],
            resize_type: 'scale by multiplier', 'resize_type.scale': 2, quality: 'ULTRA' });
        workflow['105:91'].inputs.images = ['105:127', 0];
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

module.exports = { H3_FPS, H3_MODELS, videoShape, imageVideoShape, inputPath, buildH3Workflow, buildPostProcessWorkflow,
    videoOutput, errorMessage, mediaReply, deliverFile, runVideo };
