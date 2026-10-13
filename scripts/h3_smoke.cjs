// Real local ComfyUI checks; never sends Discord messages or hosts output.
const fs = require('fs/promises');
const axios = require('axios');
const sharp = require('sharp');
const { execFileSync } = require('child_process');
const comfy = require('../utils/comfy_client');
const { buildH3Workflow, videoShape, videoOutput } = require('../utils/comfy_media');
const { prepareVideoReference } = require('../utils/video_reference');
const { enrichVideoPrompt } = require('../utils/video_prompt');
const { PROXY_URL } = require('../utils/proxy_config');
const { comfyWorkload, workloadHeaders } = require('../utils/orchestrator_workload');

async function main() {
    await fs.mkdir('temp', { recursive: true });
    const mode = process.argv[2] || 'validate';
    let enrichedPrompt;
    const upscale = mode === 'text768';
    const shape = upscale ? videoShape(1024, 768, 5) : videoShape(768, 448, 5);
    const png = await sharp({ create: { width: 768, height: 448, channels: 3, background: '#577589' } })
        .composite([{ input: Buffer.from('<svg width="768" height="448"><circle cx="384" cy="240" r="90" fill="#e28743"/><rect x="0" y="350" width="768" height="98" fill="#354f3e"/></svg>') }]).png().toBuffer();
    const image = await comfy.uploadImage(png, 'elaina-h3-reference.png', 'image/png');
    await fs.writeFile('temp/h3-reference.png', png);
    const fixtures = { image: png };
    if (mode === 'validate' || ['video', 'audio', 'enrich'].includes(mode)) {
        for (const kind of ['video', 'audio']) {
            const file = `temp/h3-reference.${kind === 'video' ? 'mp4' : 'wav'}`;
            const args = ['-hide_banner', '-loglevel', 'error', '-y'];
            if (kind === 'video') args.push('-f', 'lavfi', '-i', 'testsrc2=size=192x128:rate=24:duration=2');
            args.push('-f', 'lavfi', '-i', 'sine=frequency=330:duration=2');
            if (kind === 'video') args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac');
            args.push(file);
            execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', args, { windowsHide: true });
            fixtures[kind] = await fs.readFile(file);
        }
    }
    const references = {};
    for (const kind of mode === 'validate' ? ['image', 'video', 'audio'] : mode === 'enrich' ? ['video'] : ['ref', 'hybrid', 'video', 'audio'].includes(mode) ? [mode === 'ref' || mode === 'hybrid' ? 'image' : mode] : []) {
        references[kind] = await prepareVideoReference({ name: `reference.${{ image: 'png', video: 'mp4', audio: 'wav' }[kind]}` }, shape,
            { buffer: fixtures[kind], vision: mode === 'enrich' });
    }
    if (mode === 'enrich') {
        const quality = process.argv[3] || 'standard';
        const preview = await sharp(png).jpeg().toBuffer();
        enrichedPrompt = await enrichVideoPrompt({ prompt: 'Animate the orange sphere between the supplied opening and ending frames. Use the reference video for its movement and rhythm. No dialogue or music.',
            shape, requestedSeconds: 5, quality, images: [preview, preview], reference: references.video, onProgress: console.log });
        await fs.writeFile(`temp/h3-enriched-${quality}.txt`, enrichedPrompt);
        console.log(`${quality}: five-image reference enrichment passed and LLM unload verified`);
        if (!process.argv.includes('--generate')) {
            comfy.clients?.forEach(socket => socket.close());
            return;
        }
    }
    const cases = mode === 'validate' ? ['text', 'image', 'last', 'base', 'ref', 'hybrid', 'video', 'audio'] : mode === 'enrich' ? ['hybrid-enriched'] : [mode];
    for (const name of cases) {
        const workflow = buildH3Workflow({ prompt: enrichedPrompt || 'integrated_multimodal_description: [Shot 1] A stylized orange sphere rolls slowly across a dark green tabletop. The camera stays still.\n\noverall_soundscape: A quiet rolling sound.\n\nnon_diegetic_music: N/A',
            shape, seed: 123, upscale, optimize: name !== 'base', image: ['image', 'last', 'hybrid', 'hybrid-enriched'].includes(name) ? image : undefined,
            lastImage: ['last', 'hybrid', 'hybrid-enriched'].includes(name) ? image : undefined,
            referenceOnly: name === 'ref',
            reference: references[{ ref: 'image', hybrid: 'image', video: 'video', audio: 'audio', 'hybrid-enriched': 'video' }[name]] });
        await fs.writeFile(`temp/h3-${name}-api.json`, JSON.stringify(workflow, null, 2));
        if (mode === 'validate') {
            workflow['105:15'].inputs.noise_seed = 'VALIDATION_ONLY';
            const response = await axios.post(`${PROXY_URL}/prompt`, { prompt: workflow, client_id: 'h3-validation' }, {
                headers: workloadHeaders('comfyui', comfyWorkload(workflow)), timeout: 120_000, validateStatus: () => true });
            const errors = response.data.node_errors || {};
            if (response.status !== 400 || !errors['105:15'] || Object.keys(errors).some(id => id !== '105:15')) {
                throw new Error(`${name} schema validation failed: ${JSON.stringify(response.data)}`);
            }
            console.log(`${name}: schema validated`);
        } else {
            const start = Date.now();
            const result = await comfy.runPrompt(workflow, { timeoutMs: 3_600_000,
                onProgress: data => { if (data.node) console.log(data.node, data.value, data.max); } });
            const file = videoOutput(result.outputs);
            const output = `temp/h3-${name}-output.mp4`;
            await fs.writeFile(output, Buffer.from(await comfy.getImage(file.filename, file.subfolder || '', file.type || 'output')));
            const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8', windowsHide: true }));
            const video = probe.streams.find(stream => stream.codec_type === 'video');
            const audio = probe.streams.find(stream => stream.codec_type === 'audio');
            if (video?.width !== shape.width * (upscale ? 2 : 1) || video?.height !== shape.height * (upscale ? 2 : 1) || Number(video.nb_frames) !== shape.length
                || video.r_frame_rate !== '24/1' || !audio || Math.abs(Number(audio.duration) - Number(video.duration)) > 1 / 24) {
                throw new Error(`Output validation failed: ${JSON.stringify(probe)}`);
            }
            console.log(`${name}: ${shape.length} frames with audio, ${(Date.now() - start) / 1000}s, ${output}`);
        }
    }
    comfy.clients?.forEach(socket => socket.close());
}
main().then(() => process.exit(0)).catch(error => { console.error(error.response?.data || error); process.exit(1); });
