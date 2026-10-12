const axios = require('axios');
const crypto = require('crypto');
const { setTimeout: sleep } = require('timers/promises');

const RECIPES = ['trellis_1024_cascade', 'trellis_512', 'pixal_single_1024', 'pixal_single_1536'];

function selectMesh(run) {
    const meshes = (run.artifacts || []).filter(item => item.kind === 'mesh' && /\.glb$/i.test(item.path));
    const selection = run.selection || {};
    const artifact = meshes.find(item => item.id === selection.preferred_appearance)
        || meshes.find(item => item.id === selection.preferred_mesh)
        || meshes.find(item => /^mesh\/candidate-[^/]+\.glb$/i.test(item.path));
    if (!artifact) throw new Error('CelForge completed without an exported GLB.');
    return artifact;
}

function createClient({ baseURL = process.env.CELFORGE_URL || 'http://127.0.0.1:8333', http, pollMs = 2500, timeoutMs = 60 * 60 * 1000 } = {}) {
    http ||= axios.create({ baseURL: baseURL.replace(/\/$/, ''), timeout: 30_000 });
    return {
        async generate(buffer, { filename = 'source.png', mimetype = 'image/png', recipe = RECIPES[0], seed = crypto.randomInt(0, 2 ** 32), onProgress = () => {} } = {}) {
            if (!RECIPES.includes(recipe)) throw new Error('Unsupported CelForge recipe.');
            if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) throw new Error('CelForge seed must be between 0 and 4294967295.');
            if (!buffer?.length || buffer.length > 20 * 1024 * 1024) throw new Error('CelForge requires an image of at most 20 MiB.');
            const form = new FormData();
            form.append('source', new Blob([buffer], { type: mimetype }), filename);
            const { data: source } = await http.post('/api/cases', form);
            const { data: submitted } = await http.post('/api/runs', { case_id: source.id, recipe, seed });
            const runPath = `/api/runs/${encodeURIComponent(submitted.id)}`;
            const deadline = Date.now() + timeoutMs;
            let run = submitted;
            while (true) {
                if (run.status === 'succeeded') {
                    const artifact = selectMesh(run);
                    const { data } = await http.get(`${runPath}/artifacts/${encodeURIComponent(artifact.id)}`, { responseType: 'arraybuffer' });
                    return { buffer: Buffer.from(data), filename: artifact.path.split('/').pop(), runId: run.id, seed, recipe };
                }
                if (['failed', 'cancelled'].includes(run.status)) throw new Error(`CelForge run ${run.id}: ${run.error || run.status}`);
                const active = Object.entries(run.stages || {}).find(([, stage]) => stage.status === 'running');
                onProgress(`CelForge: ${active?.[0] || run.status} (run ${run.id})`);
                if (Date.now() >= deadline) throw new Error(`CelForge run ${run.id} timed out; its retained output remains available in CelForge.`);
                await sleep(pollMs);
                ({ data: run } = await http.get(runPath));
            }
        },
    };
}

module.exports = { RECIPES, selectMesh, createClient };
