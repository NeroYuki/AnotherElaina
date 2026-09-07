// Privacy-safe workload contract for the GPU orchestrator (Phase 4.1).
// Deliberately never serialises prompts, seeds, URLs, filenames, or user IDs.
const crypto = require('crypto');
const { serviceHeaders } = require('./proxy_config');

const SCHEMA_VERSION = 1;
const MAX_DIMENSION = 16384;

function integer(value, fallback = 1) {
    return Number.isInteger(value) && value > 0 && value <= MAX_DIMENSION ? value : fallback;
}

function modelFamily(name) {
    const value = String(name || '').toLowerCase();
    if (value.includes('flux')) return 'flux';
    if (value.includes('sdxl') || value.includes('xl')) return 'sdxl';
    if (value.includes('wan') || value.includes('hunyuan') || value.includes('video')) return 'video';
    if (value.includes('sd') || value.includes('anime')) return 'sd15';
    return 'unknown';
}

function stableGraphHash(workflow) {
    const topology = Object.entries(workflow || {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, node]) => ({
        id,
        class_type: String(node?.class_type || '').slice(0, 120),
        input_keys: Object.keys(node?.inputs || {}).sort(),
    }));
    return crypto.createHash('sha256').update(JSON.stringify(topology)).digest('hex').slice(0, 24);
}

function comfyWorkload(workflow) {
    const nodes = Object.values(workflow || {});
    let width = 1024, height = 1024, checkpoint = 'unknown';
    const nodeTypes = [];
    for (const node of nodes) {
        const inputs = node?.inputs || {};
        if (Number.isInteger(inputs.width)) width = integer(inputs.width, width);
        if (Number.isInteger(inputs.height)) height = integer(inputs.height, height);
        if (typeof inputs.ckpt_name === 'string') checkpoint = inputs.ckpt_name.slice(0, 160);
        nodeTypes.push(String(node?.class_type || '').slice(0, 120));
    }
    return {
        schema_version: SCHEMA_VERSION,
        task_kind: 'comfy_workflow',
        model: { family: modelFamily(checkpoint), checkpoint },
        shape: { width, height, batch_size: 1, batch_count: 1 },
        stages: [{ kind: 'graph', node_count: nodes.length, template_hash: stableGraphHash(workflow) }],
        features: { node_types: [...new Set(nodeTypes)].sort().slice(0, 80) },
    };
}

function forgeWorkload({ taskKind, checkpoint, width, height, batchSize = 1, batchCount = 1,
    upscaleMultiplier = 1, upscaleSteps = 0, useAdetailer = false, tiledVae = false, features = {} }) {
    const safeCheckpoint = String(checkpoint || 'unknown').slice(0, 160);
    return {
        schema_version: SCHEMA_VERSION,
        task_kind: taskKind,
        model: { family: modelFamily(safeCheckpoint), checkpoint: safeCheckpoint },
        shape: { width: integer(width, 1024), height: integer(height, 1024), batch_size: integer(batchSize), batch_count: integer(batchCount) },
        stages: [{ kind: 'base', steps: integer(upscaleSteps, 1) }].concat(upscaleMultiplier > 1 ? [{ kind: 'hires', scale: Math.min(Number(upscaleMultiplier) || 1, 8) }] : []),
        features: { adetailer: Boolean(useAdetailer), tiled_vae: Boolean(tiledVae), ...features },
    };
}

function workloadHeaders(service, workload, extra = {}) {
    return serviceHeaders(service, {
        ...extra,
        'X-AI-Job-ID': crypto.randomUUID(),
        'X-AI-Workload': Buffer.from(JSON.stringify(workload)).toString('base64url'),
    });
}

module.exports = { SCHEMA_VERSION, comfyWorkload, forgeWorkload, workloadHeaders };
