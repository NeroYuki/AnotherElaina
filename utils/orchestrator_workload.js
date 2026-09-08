// Privacy-safe workload contract for the GPU orchestrator (Phase 4.1).
// Deliberately never serialises prompts, seeds, URLs, filenames, or user IDs.
const crypto = require('crypto');
const { serviceHeaders } = require('./proxy_config');

const SCHEMA_VERSION = 1;
const MAX_DIMENSION = 16384;

function integer(value, fallback = 1, maximum = MAX_DIMENSION) {
    return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

function modelFamily(name) {
    const value = String(name || '').toLowerCase();
    if (value.includes('seedvr') || value.includes('upscale')) return 'upscale';
    if (value.includes('qwen') || value.includes('llama') || value.includes('gemma')) return 'llm';
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
    let checkpointPriority = -1;
    const nodeTypes = [];
    const modelKeys = ['ckpt_name', 'unet_name', 'diffusion_model', 'model_name', 'model_path'];
    const modelPriority = { ckpt_name: 3, unet_name: 2, diffusion_model: 2, model_name: 1, model_path: 1 };
    const modelIds = [];
    for (const node of nodes) {
        const inputs = node?.inputs || {};
        if (Number.isInteger(inputs.width)) width = integer(inputs.width, width);
        if (Number.isInteger(inputs.height)) height = integer(inputs.height, height);
        for (const key of modelKeys) {
            if (typeof inputs[key] === 'string' && inputs[key]) {
                const modelId = inputs[key].slice(0, 160);
                modelIds.push(modelId);
                if (modelPriority[key] > checkpointPriority) {
                    checkpoint = modelId;
                    checkpointPriority = modelPriority[key];
                }
            }
        }
        nodeTypes.push(String(node?.class_type || '').slice(0, 120));
    }
    const supportModels = [...new Set(modelIds)].filter(id => id !== checkpoint).slice(0, 40);
    return {
        schema_version: SCHEMA_VERSION,
        task_kind: 'comfy_workflow',
        model: { family: modelFamily(checkpoint), checkpoint },
        shape: { width, height, batch_size: 1, batch_count: 1 },
        stages: [{ kind: 'graph', node_count: nodes.length, template_hash: stableGraphHash(workflow), support_models: supportModels }],
        features: { node_types: [...new Set(nodeTypes)].sort().slice(0, 80) },
    };
}

function forgeWorkload({ taskKind, checkpoint, width, height, batchSize = 1, batchCount = 1,
    baseSteps = 1, upscaleMultiplier = 1, hiresSteps = 1, hiresCheckpoint,
    hiresSupportModels = [], seedvr2Model, seedvr2Resolution = 1600,
    useAdetailer = false, tiledVae = false, features = {} }) {
    const safeCheckpoint = String(checkpoint || 'unknown').slice(0, 160);
    const resolvedHires = !hiresCheckpoint || hiresCheckpoint === 'Use same checkpoint'
        ? safeCheckpoint : String(hiresCheckpoint).slice(0, 160);
    const stages = [{
        kind: 'base',
        steps: integer(baseSteps, 1),
        model: { family: modelFamily(safeCheckpoint), checkpoint: safeCheckpoint },
    }];
    if (upscaleMultiplier > 1) {
        stages.push({
            kind: 'hires',
            scale: Math.min(Number(upscaleMultiplier) || 1, 8),
            steps: integer(hiresSteps, 1),
            model: { family: modelFamily(resolvedHires), checkpoint: resolvedHires },
            support_models: [...new Set(hiresSupportModels.map(String))].filter(x => x && x !== 'Use same choices').slice(0, 12),
        });
    }
    if (seedvr2Model) {
        const model = String(seedvr2Model).slice(0, 160);
        stages.push({
            kind: 'seedvr2',
            model: { family: 'upscale', checkpoint: model },
            target_shortest_side: integer(seedvr2Resolution, 1600),
        });
    }
    return {
        schema_version: SCHEMA_VERSION,
        task_kind: taskKind,
        model: { family: modelFamily(safeCheckpoint), checkpoint: safeCheckpoint },
        shape: { width: integer(width, 1024), height: integer(height, 1024), batch_size: integer(batchSize), batch_count: integer(batchCount) },
        stages,
        features: { adetailer: Boolean(useAdetailer), tiled_vae: Boolean(tiledVae), seedvr2: Boolean(seedvr2Model), ...features },
    };
}

function mapperatorinatorWorkload(params = {}) {
    const checkpoint = String(params.model || 'v30').slice(0, 160);
    const stages = [{ kind: 'inference', model: { family: 'mapper', checkpoint } }];
    if (params.lora_path) {
        const lora = String(params.lora_path).replace(/\\/g, '/').split('/').pop().slice(0, 160);
        stages.push({ kind: 'lora', model: { family: 'lora', checkpoint: lora } });
    }
    return {
        schema_version: SCHEMA_VERSION,
        task_kind: 'beatmap_generation',
        model: { family: 'mapper', checkpoint },
        shape: { width: 1, height: 1, batch_size: integer(Number(params.max_batch_size), 1), batch_count: 1 },
        stages,
        features: {
            bf16: Boolean(params.enable_bf16), flash_attention: Boolean(params.enable_flash_attn),
            compile: Boolean(params.enable_compile), parallel: Boolean(params.enable_parallel),
            gamemode: Number.isInteger(params.gamemode) ? params.gamemode : 0,
        },
    };
}

function lmstudioWorkload({ model, contextLength, maxTokens, vision = false, stream = false }) {
    const checkpoint = String(model || 'unknown').slice(0, 160);
    return {
        schema_version: SCHEMA_VERSION,
        task_kind: vision ? 'vision_completion' : 'text_completion',
        model: { family: 'llm', checkpoint },
        shape: { width: 1, height: 1, batch_size: 1, batch_count: 1 },
        stages: [{ kind: 'inference', model: { family: 'llm', checkpoint } }],
        features: {
            context_length: integer(Number(contextLength), 8192, 2_000_000),
            max_output_tokens: integer(Number(maxTokens), 400),
            vision: Boolean(vision), stream: Boolean(stream), context_source: 'consumer',
        },
    };
}

function workloadHeaders(service, workload, extra = {}) {
    return serviceHeaders(service, {
        ...extra,
        'X-AI-Job-ID': crypto.randomUUID(),
        'X-AI-Workload': Buffer.from(JSON.stringify(workload)).toString('base64url'),
    });
}

module.exports = { SCHEMA_VERSION, comfyWorkload, forgeWorkload, mapperatorinatorWorkload, lmstudioWorkload, workloadHeaders };
