// Explicit backend smoke checks. No Discord messages or public uploads.
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const { execFileSync } = require('child_process');
const { PROXY_URL } = require('../utils/proxy_config');
const { comfyWorkload, workloadHeaders } = require('../utils/orchestrator_workload');
const { buildH3Workflow, buildPostProcessWorkflow, videoShape, videoOutput } = require('../utils/comfy_media');
const comfy = require('../utils/comfy_client');

async function validate() {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#84a9cc' } }).png().toBuffer();
    const image = await comfy.uploadImage(png, 'anotherelaina-validation.png', 'image/png');
    for (const mode of ['text', 'image']) {
        const workflow = buildH3Workflow({ prompt: 'A small blue bird turns its head.', shape: videoShape(1024, 768),
            seed: 0, image: mode === 'image' ? image : undefined });
        // An intentionally invalid noise input prevents execution while making
        // ComfyUI validate every ancestor of the real SaveVideo output.
        workflow['105:15'].inputs.noise_seed = 'VALIDATION_ONLY';
        const headers = workloadHeaders('comfyui', comfyWorkload(workflow), { 'Content-Type': 'application/json' });
        const response = await axios.post(`${PROXY_URL}/prompt`, { prompt: workflow, client_id: 'anotherelaina-validation' },
            { headers, timeout: 120_000, validateStatus: () => true });
        const errors = response.data.node_errors || {};
        console.log(mode, response.status, JSON.stringify(errors));
        if (response.status !== 400 || !errors['105:15'] || Object.keys(errors).some(id => id !== '105:15')) {
            throw new Error(`Unexpected ${mode} workflow validation result: ${JSON.stringify(response.data)}`);
        }
    }
}

async function postprocess() {
    await fs.mkdir(path.resolve('temp'), { recursive: true });
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        '-i', 'testsrc2=size=64x64:rate=4:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'temp/media-smoke-input.mp4'], { windowsHide: true });
    const video = await comfy.uploadImage(await fs.readFile('temp/media-smoke-input.mp4'), 'anotherelaina-smoke.mp4', 'video/mp4');
    const workflow = buildPostProcessWorkflow({ video, upscaler: '2x-AnimeSharpV3.pth', interpolation: 'rife49.pth', multiplier: 2 });
    const result = await comfy.runPrompt(workflow, { timeoutMs: 180_000 });
    const file = videoOutput(result.outputs);
    const data = await comfy.getImage(file.filename, file.subfolder || '', file.type || 'output');
    await fs.writeFile('temp/media-smoke-output.mp4', Buffer.from(data));
    const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', 'temp/media-smoke-output.mp4'], { encoding: 'utf8', windowsHide: true }));
    const image = probe.streams.find(stream => stream.codec_type === 'video');
    const audio = probe.streams.find(stream => stream.codec_type === 'audio');
    if (image?.width !== 128 || image?.height !== 128 || image?.r_frame_rate !== '8/1' || !audio) {
        throw new Error(`Unexpected processed output: ${JSON.stringify(probe)}`);
    }
    console.log('Live upscale + RIFE passed: 128×128, 8 fps, audio retained. temp/media-smoke-output.mp4');
}

async function orbit(input) {
    const { renderOrbit } = require('../utils/model_orbit');
    const buffer = await renderOrbit(await fs.readFile(input));
    await fs.mkdir('temp', { recursive: true });
    await fs.writeFile('temp/model-orbit-smoke.mp4', buffer);
    const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', 'temp/model-orbit-smoke.mp4'], { encoding: 'utf8', windowsHide: true }));
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    if (video?.width !== 512 || video?.height !== 512 || video?.nb_frames !== '120' || video?.r_frame_rate !== '24/1') {
        throw new Error(`Unexpected orbit output: ${JSON.stringify(probe)}`);
    }
    console.log('Orbit render passed: 512×512, 120 frames, 24 fps. temp/model-orbit-smoke.mp4');
}

async function model(input) {
    const { createClient } = require('../utils/celforge_client');
    const png = await sharp(await fs.readFile(input)).rotate().png().toBuffer();
    let last;
    const result = await createClient().generate(png, { recipe: 'trellis_512', seed: 0, onProgress(message) {
        if (last !== message) console.log(message);
        last = message;
    } });
    await fs.mkdir('temp', { recursive: true });
    await fs.writeFile('temp/model-generation-smoke.glb', result.buffer);
    console.log(`CelForge generation passed: ${result.runId}, ${result.buffer.length} GLB bytes.`);
    await orbit('temp/model-generation-smoke.glb');
}

async function generateVideo() {
    const shape = videoShape(768, 448, 5);
    const workflow = buildH3Workflow({ prompt: 'integrated_multimodal_description: [Shot 1] A small blue bird sits on a branch and turns its head. The camera holds a static shot.\n\noverall_soundscape: Soft wind rustles leaves and the bird chirps.\n\nnon_diegetic_music: N/A',
        shape, seed: 0, steps: 4 });
    console.log('Running a five-second H3 generation with four sampling steps for a runtime smoke check.');
    const result = await comfy.runPrompt(workflow, { timeoutMs: 20 * 60 * 1000 });
    const file = videoOutput(result.outputs);
    await fs.mkdir('temp', { recursive: true });
    await fs.writeFile('temp/h3-generation-smoke.mp4', Buffer.from(await comfy.getImage(file.filename, file.subfolder || '', file.type || 'output')));
    const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', 'temp/h3-generation-smoke.mp4'], { encoding: 'utf8', windowsHide: true }));
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    if (video?.width !== 1536 || video?.height !== 896 || video?.nb_frames !== '124' || video?.r_frame_rate !== '24/1'
        || !probe.streams.some(stream => stream.codec_type === 'audio')) throw new Error(`Unexpected H3 output: ${JSON.stringify(probe)}`);
    console.log('H3 generation passed: 1536×896 after RTX 2×, 124 frames, 24 fps, audio retained. temp/h3-generation-smoke.mp4');
}

(async () => {
    const [flag, input] = process.argv.slice(2);
    if (flag === '--validate') await validate();
    else if (flag === '--postprocess') await postprocess();
    else if (flag === '--orbit' && input) await orbit(input);
    else if (flag === '--model' && input) await model(input);
    else if (flag === '--generate') await generateVideo();
    else throw new Error('Usage: node scripts/media_smoke.cjs --validate | --postprocess | --orbit MODEL.glb | --model IMAGE.png | --generate');
})().catch(error => { console.error(error.response?.data || error); process.exitCode = 1; });
