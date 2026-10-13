// ComfyUI imports API-format JSON directly and arranges its nodes on the canvas.
// Export from the same builder used by Discord to keep both paths identical.
const fs = require('fs');
const path = require('path');
const { buildH3Workflow, videoShape } = require('../utils/comfy_media');

const directory = path.resolve(__dirname, '../resources/workflows/h3');
fs.mkdirSync(directory, { recursive: true });
const prompt = 'integrated_multimodal_description: [Shot 1] Cinematic, a small blue bird lands on a branch, folds its wings, then looks toward the camera. The camera slowly pushes in.\n\noverall_soundscape: Leaves rustle in a light breeze. The bird chirps softly.\n\nnon_diegetic_music: N/A';
const image = { name: 'opening.png' };
for (const [name, options] of [
    ['text-to-video', {}],
    ['image-to-video', { image }],
    ['reference-image-to-video', { referenceOnly: true, reference: { kind: 'image', upload: { name: 'reference.png' } } }],
    ['reference-video-to-video', { referenceOnly: true, reference: { kind: 'video', hasAudio: true, upload: { name: 'reference.mp4' } } }],
    ['reference-audio-to-video', { referenceOnly: true, reference: { kind: 'audio', upload: { name: 'reference.wav' } } }],
    ['hybrid-frames-and-reference', { image, lastImage: { name: 'ending.png' }, reference: { kind: 'image', upload: { name: 'reference.png' } } }],
]) {
    const graph = buildH3Workflow({ prompt, shape: videoShape(1024, 768), seed: 123, upscale: false, ...options });
    if (options.reference) graph['105:104'].inputs.prompt = prompt.replace('a small blue bird',
        options.reference.kind === 'image' ? 'the bird shown in <Picture 1>' : options.reference.kind === 'video'
            ? 'a small blue bird, with scene and movement inspired by <Video 1>' : 'a small blue bird, accompanied by the sound from <Audio 1>');
    const file = path.join(directory, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(graph, null, 2) + '\n');
    console.log(file);
}
