const axios = require('axios');
const sharp = require('sharp');
const { serviceHeaders } = require('./proxy_config');
const { convert_upload_path_to_file_data } = require('./common_helper');
const { uploadPngBufferToGradio } = require('./load_discord_img');

const SETTING_KEYS = Object.freeze({
    qwen21: 'qwen21_do_reference', klein: 'klein_do_reference', anima: 'anima_do_reference',
    krea: 'krea2_do_reference', moss: 'moss_do_reference',
});
const EDIT_LORAS = Object.freeze({
    anima: 'AnimeEditV2', moss: 'moss_image_edit_lora_rank_64_bf16',
    krea: 'krea2_general_edit_v2', krea_identity: 'krea2_identity_edit_v2',
});
const REFERENCE_LAYOUTS = Object.freeze(['native', 'grid', 'horizontal', 'vertical']);
const basename = value => String(value || '').replaceAll('\\', '/').split('/').pop().replace(/\.safetensors$/i, '').toLowerCase();

function getReferencePolicy(model, { workflow = 'denoise', editVariant = 'general' } = {}) {
    const config = require('./ai_server_config');
    const normalized = basename(model);
    const groups = {
        qwen21: config.model_selection_qwen21,
        klein: [...config.model_selection_flux_klein_4b, ...config.model_selection_flux_klein_9b],
        anima: config.model_selection_anima, krea: config.model_selection_krea, moss: config.model_selection_moss,
        kontext: config.model_selection_kontext,
    };
    const family = Object.keys(groups).find(key => groups[key].some(entry => basename(entry.value) === normalized)) || null;
    const reference = workflow === 'reference' || workflow === 'ref2img';
    if (reference && !family) throw new Error('Reference-to-image requires Qwen 2.1, Klein, Anima, MOSS, Krea2, or Flux Kontext. Select a reference-capable checkpoint.');
    if (!['general', 'identity'].includes(editVariant)) throw new Error('Unknown reference edit variant.');
    const lora_name = reference && (family === 'krea' ? EDIT_LORAS[editVariant === 'identity' ? 'krea_identity' : 'krea'] : EDIT_LORAS[family]);
    const setting_key = family ? SETTING_KEYS[family] : null;
    return {
        family,
        setting: setting_key ? {
            key: setting_key,
            fn_index: config.server_pool[0].fn_index_reference_settings?.[family],
            value: family === 'moss' ? (reference ? 'Moss-Image-Edit' : 'Disable') : reference,
        } : null,
        lora: lora_name ? { name: lora_name, weight: 1 } : null,
    };
}

function explicitEditLoras(prompt, family) {
    const names = [...String(prompt || '').matchAll(/<lora:([^:>]+):[^>]+>/gi)].map(match => basename(match[1]));
    const candidates = family === 'krea' ? [EDIT_LORAS.krea, EDIT_LORAS.krea_identity] : [EDIT_LORAS[family]];
    return candidates.filter(Boolean).filter(name => names.includes(basename(name)));
}

// Anima's edit LoRA behaves much more reliably when it receives an explicit
// instruction sentence instead of a bare tag or terse command. The model still
// follows the requested change; the wrapper only supplies the missing context.
const ANIMA_EDIT_PREFIX = 'Edit the image: ';
const ANIMA_EDIT_SUFFIX = ' Apply only the requested changes and keep everything else unchanged.';

function prepareAnimaEditInstruction(prompt) {
    const text = String(prompt ?? '').trim();
    if (!text) return text;
    const hasPrefix = /^edit (?:the|this) image\s*:/i.test(text);
    const hasSuffix = /(?:apply only the requested changes|keep everything else unchanged)\.?$/i.test(text);
    if (hasSuffix) return `${hasPrefix ? '' : ANIMA_EDIT_PREFIX}${text}`;
    const body = text.replace(/[,;:\s]+$/g, '');
    const separator = /[.!?]$/.test(body) ? '' : '.';
    return `${hasPrefix ? '' : ANIMA_EDIT_PREFIX}${body}${separator}${ANIMA_EDIT_SUFFIX}`;
}

function appendEditLora(prepared, policy) {
    if (!policy.lora || explicitEditLoras(prepared, policy.family).length) return prepared;
    return `${prepared}${prepared && !/\s$/.test(prepared) ? ' ' : ''}<lora:${policy.lora.name}:${policy.lora.weight}>`;
}

function prepareReferencePrompt(prompt, model, options = {}) {
    const policy = getReferencePolicy(model, { ...options, workflow: 'reference' });
    let prepared = prompt;
    if (policy.family === 'anima') prepared = prepareAnimaEditInstruction(prepared);
    return appendEditLora(prepared, policy);
}

/**
 * Async production path. Anima requests go through a mandatory Qwen 27B
 * instruction pass; other families keep the deterministic prompt policy.
 */
async function prepareReferencePromptWithLLM(prompt, model, options = {}, deps = {}) {
    const policy = getReferencePolicy(model, { ...options, workflow: 'reference' });
    let prepared = prompt;
    if (policy.family === 'anima') {
        const rewrite = deps.rewriteAnimaEditPrompt
            || require('./reference_prompt').rewriteAnimaEditPrompt;
        prepared = await rewrite({
            prompt,
            images: options.images || [],
            onProgress: options.onProgress || (() => {}),
        }, deps.referencePrompt);
        prepared = String(prepared || '').trim();
        if (!prepared) throw new Error('The Anima instruction pass returned an empty instruction.');
        if (!/(?:keep .*unchanged|apply only)/i.test(prepared)) {
            prepared = `${prepared.replace(/[.!?]$/, '')}. Keep the character, pose, and background unchanged.`;
        }
    }
    else {
        prepared = prepareReferencePrompt(prompt, model, options);
    }
    return appendEditLora(prepared, policy);
}

// The caller holds withForgeSession across this callback and all model/CN
// setup. Restore the user's UI mode even when generation or validation fails.
async function withForgeImageMode({ model, workflow, session_hash, endpoint, headers, prompt = '', editVariant = 'general' }, callback, deps = {}) {
    const policy = getReferencePolicy(model, { workflow, editVariant });
    if (!policy.setting) return callback(policy);
    const http = deps.http || axios;
    const routed = serviceHeaders('sdwebui', headers || {});
    const options = (await http.get(`${endpoint}/sdapi/v1/options`, { headers: routed, timeout: 15000 })).data;
    const { key, fn_index, value } = policy.setting;
    const original = options[key];
    if (original === undefined || !Number.isInteger(fn_index)) throw new Error(`Forge reference control ${key} is unavailable; refresh the Forge schema.`);
    if (policy.lora) {
        const catalog = (await http.get(`${endpoint}/sdapi/v1/loras`, { headers: routed, timeout: 30000 })).data;
        const required = explicitEditLoras(prompt, policy.family);
        if (!required.length) required.push(policy.lora.name);
        const available = new Set((Array.isArray(catalog) ? catalog : []).flatMap(item => [item.name, item.alias, item.path].filter(Boolean).map(basename)));
        for (const name of required) if (!available.has(basename(name))) throw new Error(`Required edit LoRA ${name} is not visible to Forge. Check its shared LoRA directory and refresh/restart Forge.`);
    }
    const set = async next => {
        const response = await http.post(`${endpoint}/run/predict/`, { fn_index, session_hash, data: [next] }, { headers: routed, timeout: 30000 });
        if (!response.data || response.data.error) throw new Error(`Failed to change Forge reference mode: ${response.data?.error || key}`);
    };
    const changed = original !== value;
    try {
        if (changed) await set(value);
        return await callback(policy);
    }
    finally {
        if (changed) await set(original);
    }
}

async function pngReference(input, maxSide) {
    if (typeof input === 'string') {
        const match = input.match(/^data:image\/[^;,]+;base64,(.+)$/s);
        if (!match) throw new Error('A reference image could not be decoded.');
        input = Buffer.from(match[1], 'base64');
    }
    if (!Buffer.isBuffer(input) || !input.length) throw new Error('A reference image is missing.');
    const image = await sharp(input).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).png().toBuffer();
    const meta = await sharp(image).metadata();
    const right = Math.max(64, Math.ceil(meta.width / 64) * 64) - meta.width;
    const bottom = Math.max(64, Math.ceil(meta.height / 64) * 64) - meta.height;
    return sharp(image).extend({ top: 0, left: 0, right, bottom, background: '#ffffff' }).png().toBuffer();
}

async function prepareReferenceInputs({ images, layout = 'native', session_hash, endpoint, direct_url, width, height, max_side = 1024 }, deps = {}) {
    if (!Array.isArray(images) || !images.length || images.length > 4) throw new Error('Supply between one and four reference images.');
    if (layout === 'auto') layout = 'native';
    if (!REFERENCE_LAYOUTS.includes(layout)) throw new Error('Unknown reference layout.');
    if (!Number.isInteger(max_side) || max_side < 64 || max_side > 2048) throw new Error('Reference maximum side must be between 64 and 2048 pixels.');
    const buffers = [];
    for (const image of images) buffers.push(await pngReference(image, max_side));
    let primary = buffers[0];
    const references = [];
    if (layout === 'native') {
        const upload = deps.upload || uploadPngBufferToGradio;
        for (let index = 1; index < buffers.length; index++) {
            const path = await upload(buffers[index], session_hash, endpoint);
            references.push({ image: { ...convert_upload_path_to_file_data(path, direct_url || endpoint), mime_type: 'image/png', meta: { _type: 'gradio.FileData' } }, caption: null });
        }
    }
    else if (buffers.length > 1) {
        const columns = layout === 'vertical' ? 1 : layout === 'horizontal' ? buffers.length : Math.ceil(Math.sqrt(buffers.length));
        const rows = Math.ceil(buffers.length / columns);
        const cell = Math.floor(Math.min(1024, 2048 / Math.max(columns, rows)) / 64) * 64;
        const tiles = [];
        for (let index = 0; index < buffers.length; index++) tiles.push({
            input: await sharp(buffers[index]).resize(cell, cell, { fit: 'contain', background: '#ffffff' }).png().toBuffer(),
            left: (index % columns) * cell, top: Math.floor(index / columns) * cell,
        });
        primary = await sharp({ create: { width: columns * cell, height: rows * cell, channels: 3, background: '#ffffff' } }).composite(tiles).png().toBuffer();
    }
    if (width !== undefined || height !== undefined) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 2048 || height > 2048) throw new Error('Reference output dimensions must be 64–2048 pixels.');
        primary = await sharp(primary).resize(width, height, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
    }
    return { attachment: `data:image/png;base64,${primary.toString('base64')}`, references, imageCount: buffers.length, layout };
}

module.exports = {
    SETTING_KEYS,
    EDIT_LORAS,
    REFERENCE_LAYOUTS,
    getReferencePolicy,
    prepareAnimaEditInstruction,
    prepareReferencePrompt,
    prepareReferencePromptWithLLM,
    withForgeImageMode,
    prepareReferenceInputs,
};
