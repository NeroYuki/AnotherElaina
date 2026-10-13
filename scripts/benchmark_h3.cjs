// Local GPU benchmark. Outputs stay on disk; nothing is sent to Discord.
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const { execFile } = require('child_process');
const { promisify } = require('util');
const comfy = require('../utils/comfy_client');
const { buildH3Workflow, videoShape, videoOutput } = require('../utils/comfy_media');

const execute = promisify(execFile);
const instance = 'comfyui-gpu0';
const http = axios.create({ headers: { 'X-AI-Instance': instance } });
const prompt = 'integrated_multimodal_description: [Shot 1] A stylized orange sphere rolls slowly across a dark green tabletop. The camera stays still.\n\noverall_soundscape: A quiet rolling sound.\n\nnon_diegetic_music: N/A';

async function main() {
    const mode = process.argv[2] || 'short';
    const root = path.resolve('temp', `h3-benchmark-${mode}-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const image = await comfy.uploadImage(await fs.readFile('temp/h3-reference.png'), 'h3-benchmark-reference.png', 'image/png');
    comfy.SERVER_ENDPOINTS = ['127.0.0.1:8188'];
    comfy.init();
    const cases = mode === 'short' ? [
        { name: 'turbo-fast-cold' }, { name: 'turbo-fast-warm-1' }, { name: 'turbo-fast-warm-2' },
        { name: 'turbo-fast-pytorch', attention: 'pytorch attention' },
        { name: 'turbo-image', image },
        { name: 'turbo-standard', width: 1024, height: 768 },
        { name: 'turbo-standard-upscale', width: 1024, height: 768, upscale: true },
        { name: 'hybrid-reference', reference: { kind: 'image', upload: image } },
        { name: 'ref2va-reference', reference: { kind: 'image', upload: image }, referenceOnly: true },
    ] : mode === 'extended' ? [
        { name: 'turbo-20s', seconds: 20, upscale: true },
        { name: 'hybrid-16s-anchors-reference', seconds: 16, image, lastImage: image, reference: { kind: 'image', upload: image } },
    ] : (() => { throw new Error('Use short or extended'); })();
    const report = { created: new Date().toISOString(), instance, gpu: 'RTX 3090 Ti',
        note: 'Wall time includes queue/model loading/conditioning/sampling/decode/encoding and up to 2s completion polling; excludes enrichment, upload and download. Warm repetitions reuse text encoding but use different seeds. Peak VRAM is total GPU usage sampled every second.', runs: [] };
    for (const [index, item] of cases.entries()) {
        const shape = videoShape(item.width || 768, item.height || 448, item.seconds || 5);
        const clipPrompt = process.argv.includes('--enriched') && item.name === 'hybrid-16s-anchors-reference'
            ? JSON.parse(await fs.readFile('temp/h3-extended-enriched.json', 'utf8')) : prompt;
        const workflow = buildH3Workflow({ ...item, prompt: clipPrompt, shape, seed: 2026101300 + index, upscale: item.upscale || false });
        if (item.attention) workflow['105:120'].inputs.attention = item.attention;
        // A unique output prefix ensures saving cannot be served from Comfy's cache.
        const save = Object.values(workflow).find(node => node.class_type === 'SaveVideo');
        save.inputs.filename_prefix = `video/benchmark/${item.name}-${Date.now()}`;
        await fs.writeFile(path.join(root, `${item.name}.json`), JSON.stringify(workflow, null, 2));
        const events = [], memory = [];
        let samplingMemory = false;
        const timer = setInterval(async () => {
            if (samplingMemory) return;
            samplingMemory = true;
            try {
                const { stdout } = await execute('nvidia-smi', ['--id=0', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], { windowsHide: true });
                memory.push(Number(stdout.trim()));
            } finally { samplingMemory = false; }
        }, 1000);
        console.log(`START ${item.name} ${shape.width}x${shape.height} ${shape.seconds.toFixed(3)}s`);
        const start = performance.now();
        let result;
        try {
            result = await comfy.runPrompt(workflow, { http, onProgress(data) {
                if (data.node && data.value === undefined) events.push({ node: data.node, at: (performance.now() - start) / 1000 });
            } });
        } finally { clearInterval(timer); }
        const wallSeconds = (performance.now() - start) / 1000;
        const stages = events.map((event, i) => ({ node: event.node, type: workflow[event.node]?.class_type,
            seconds: (events[i + 1]?.at ?? wallSeconds) - event.at }));
        const file = videoOutput(result.outputs);
        const output = path.join(root, `${item.name}.mp4`);
        await fs.writeFile(output, Buffer.from(await comfy.getImage(file.filename, file.subfolder || '', file.type || 'output')));
        const { stdout } = await execute('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { windowsHide: true });
        const probe = JSON.parse(stdout);
        const video = probe.streams.find(stream => stream.codec_type === 'video');
        const audio = probe.streams.find(stream => stream.codec_type === 'audio');
        if (!audio || video.r_frame_rate !== '24/1' || Number(video.nb_frames) !== shape.length
            || video.width !== shape.width * (item.upscale ? 2 : 1) || video.height !== shape.height * (item.upscale ? 2 : 1)
            || Math.abs(Number(video.duration) - Number(audio.duration)) > 1 / 24 + 0.01) throw new Error('Video/audio verification failed');
        report.runs.push({ name: item.name, seed: 2026101300 + index, attention: workflow['105:120'].inputs.attention, shape,
            wallSeconds, samplingSeconds: stages.filter(stage => stage.type === 'SamplerCustomAdvanced').reduce((sum, stage) => sum + stage.seconds, 0),
            peakVramMiB: Math.max(...memory), frames: Number(video.nb_frames), width: video.width, height: video.height,
            duration: Number(video.duration), audioDuration: Number(audio.duration), output, stages, promptId: result.prompt_id });
        await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
        console.log('RESULT', JSON.stringify(report.runs.at(-1)));
    }
    console.log(`REPORT ${path.join(root, 'report.json')}`);
    comfy.clients.forEach(socket => socket.close());
}
main().then(() => process.exit(0)).catch(error => { console.error(error.response?.data || error); process.exit(1); });
