'use strict';

// MOSS-Image layout utilities.
//
// A "draft" layout uses top-left absolute pixel coordinates:
//   { width, height, summary: { caption, meta, canvas },
//     items: [{ label, caption, bbox: [x1,y1,x2,y2], text? }] }
//
// The model consumes the compiled form from OpenMOSS's prompt enhancer:
//   { summary, items, bbox_coord_space: "abs_centralized", bbox_format: "yxyx" }
// Coordinates are centered on the canvas and ordered [y1,x1,y2,x2].
// Forge's built-in sd_forge_json_builder uses the same conversion.

const sharp = require('sharp');
const { get_model_family } = require('./model_defaults');
const { model_selection_moss, model_selection_xl } = require('./ai_server_config');

const LABELS = ['object', 'character', 'text'];
const CANVAS_TYPES = ['single', 'multi_panel', 'collage'];
const MAX_ITEMS = 12;
const MIN_BOX_PIXELS = 16;
const MAX_CAPTION_LENGTH = 500;
const MAX_TEXT_LENGTH = 240;
const LAYOUT_TOKEN_PATTERN = /<layout:([a-zA-Z0-9_-]{1,32})>/gi;
const COUPLER_FAMILIES = new Set(['sd', 'xl']);
const PREVIEW_COLORS = ['#4f9cf9', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#22d3ee', '#fb7185', '#facc15', '#60a5fa', '#c084fc', '#2dd4bf', '#f97316'];

function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function cleanText(value, maxLength = MAX_CAPTION_LENGTH) {
    return String(value ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\|/g, '/')
        .replace(/<[^>]*>/g, '')
        .replace(/\[GLOBAL[^\]]*\]/gi, '')
        .replace(/>>+/g, '')
        .replace(/__[^_]+__/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function escapeParens(value) {
    return String(value).replace(/\\*\(/g, '\\(').replace(/\\*\)/g, '\\)');
}

function restoreJsonParens(value) {
    return String(value).replace(/(?<!\\)((?:\\\\)*)\\([()])/g, (match, runs, paren) => runs + '\\\\' + paren);
}

function plainParens(value) {
    return String(value ?? '').replace(/\\([()])/g, '$1');
}

function restoreDraftText(draft) {
    return {
        ...draft,
        summary: { ...draft.summary, caption: plainParens(draft.summary.caption) },
        items: draft.items.map(item => ({
            ...item,
            caption: plainParens(item.caption),
            ...(item.text ? { text: plainParens(item.text) } : {}),
        })),
    };
}

function normalizeBbox(bbox, width, height, location) {
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(finite)) {
        throw new Error(`${location} must be four finite numbers [x1,y1,x2,y2].`);
    }

    let [x1, y1, x2, y2] = bbox;
    // Be forgiving when a model ignores the pixel instruction and emits 0..1.
    if (bbox.every(value => value >= 0 && value <= 1) && width > 1 && height > 1) {
        x1 *= width;
        x2 *= width;
        y1 *= height;
        y2 *= height;
    }

    let left = clamp(Math.min(x1, x2), 0, width);
    let right = clamp(Math.max(x1, x2), 0, width);
    let top = clamp(Math.min(y1, y2), 0, height);
    let bottom = clamp(Math.max(y1, y2), 0, height);

    if (right - left < MIN_BOX_PIXELS || bottom - top < MIN_BOX_PIXELS) {
        throw new Error(`${location} is smaller than ${MIN_BOX_PIXELS}px after clamping to the canvas.`);
    }

    return [Math.round(left), Math.round(top), Math.round(right), Math.round(bottom)];
}

/**
 * Validate and normalize a draft layout. Coordinates remain top-left absolute.
 */
function normalizeLayoutDraft(input, { width, height } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Layout must be a JSON object.');
    }
    const canvasWidth = Number.isFinite(width) ? width : input.width;
    const canvasHeight = Number.isFinite(height) ? height : input.height;
    if (!Number.isInteger(canvasWidth) || canvasWidth <= 0 || !Number.isInteger(canvasHeight) || canvasHeight <= 0) {
        throw new Error('Layout width and height must be positive integers.');
    }
    if (canvasWidth > 4096 || canvasHeight > 4096) {
        throw new Error('Layout canvas cannot exceed 4096x4096.');
    }

    const summary = input.summary;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
        throw new Error('Layout summary must be an object.');
    }
    const caption = cleanText(summary.caption, MAX_CAPTION_LENGTH);
    if (!caption) throw new Error('Layout summary caption must be nonempty text.');

    const meta = Array.isArray(summary.meta)
        ? summary.meta.map(value => cleanText(value, 40)).filter(Boolean).slice(0, 8)
        : [];
    const canvas = CANVAS_TYPES.includes(summary.canvas) ? summary.canvas : 'single';

    if (!Array.isArray(input.items) || input.items.length === 0) {
        throw new Error('Layout items must be a nonempty array.');
    }
    if (input.items.length > MAX_ITEMS) {
        throw new Error(`Layouts are limited to ${MAX_ITEMS} items.`);
    }

    const items = input.items.map((item, index) => {
        const location = `items[${index}]`;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`${location} must be an object.`);
        }
        if (!LABELS.includes(item.label)) {
            throw new Error(`${location}.label must be object, character, or text.`);
        }
        const itemCaption = cleanText(item.caption, MAX_CAPTION_LENGTH);
        if (!itemCaption) throw new Error(`${location}.caption must be nonempty text.`);
        const bbox = normalizeBbox(item.bbox, canvasWidth, canvasHeight, `${location}.bbox`);
        const clean = { label: item.label, caption: itemCaption, bbox };

        if (item.label === 'text') {
            const text = cleanText(item.text, MAX_TEXT_LENGTH);
            if (!text) throw new Error(`${location}.text is required for text items.`);
            clean.text = text;
        }
        else if (item.text !== undefined) {
            const text = cleanText(item.text, MAX_TEXT_LENGTH);
            if (text) clean.text = text;
        }
        return clean;
    });

    return {
        width: canvasWidth,
        height: canvasHeight,
        summary: { caption, meta, canvas },
        items,
    };
}

/**
 * Compile a draft into the JSON prompt understood by MOSS-Image.
 * Mirrors sd_forge_json_builder/javascript/compile.js, including the
 * floor/ceil centering and parenthesis escaping.
 */
function compileLayoutPrompt(input, { extra = '' } = {}) {
    const draft = normalizeLayoutDraft(input);
    const halfWidth = Math.floor(draft.width / 2);
    const halfHeight = Math.floor(draft.height / 2);

    const items = draft.items.map((item, index) => {
        const [x1, y1, x2, y2] = item.bbox;
        const centered = [
            Math.floor(y1) - halfHeight,
            Math.floor(x1) - halfWidth,
            Math.ceil(y2) - halfHeight,
            Math.ceil(x2) - halfWidth,
        ];
        if (centered[0] >= centered[2] || centered[1] >= centered[3]) {
            throw new Error(`items[${index}].bbox is too small at export precision.`);
        }
        const compiled = { label: item.label, caption: item.caption, bbox: centered };
        if (item.text) compiled.text = item.text;
        return compiled;
    });

    const summary = { ...draft.summary };
    if (summary.meta.length === 0) delete summary.meta;
    const result = {
        summary,
        items,
        bbox_coord_space: 'abs_centralized',
        bbox_format: 'yxyx',
    };
    const json = escapeParens(JSON.stringify(result));
    const suffix = typeof extra === 'string' ? extra.trim() : '';
    return suffix ? `${json}\n${suffix}` : json;
}

/**
 * Reconstruct an editable draft from a compiled MOSS prompt (JSON only).
 */
function decompileLayoutPrompt(input, width, height) {
    let parsed;
    try {
        parsed = typeof input === 'string' ? JSON.parse(restoreJsonParens(input)) : input;
    }
    catch {
        throw new Error('Layout prompt is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Layout prompt must be a JSON object.');
    }
    if (Number.isFinite(parsed.width) && Number.isFinite(parsed.height)) {
        return restoreDraftText(normalizeLayoutDraft(parsed, { width: parsed.width, height: parsed.height }));
    }
    if (parsed.bbox_coord_space !== 'abs_centralized' || parsed.bbox_format !== 'yxyx') {
        throw new Error('Layout prompt must use abs_centralized yxyx coordinates.');
    }
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
        throw new Error('A width and height are required to decompile a centered layout.');
    }
    const halfWidth = Math.floor(width / 2);
    const halfHeight = Math.floor(height / 2);
    if (!Array.isArray(parsed.items)) throw new Error('Layout prompt items must be an array.');
    const items = parsed.items.map((item, index) => {
        const box = item?.bbox;
        if (!Array.isArray(box) || box.length !== 4 || !box.every(finite)) {
            throw new Error(`items[${index}].bbox must be [y1,x1,y2,x2].`);
        }
        const [y1, x1, y2, x2] = box;
        return { ...item, bbox: [x1 + halfWidth, y1 + halfHeight, x2 + halfWidth, y2 + halfHeight] };
    });
    return restoreDraftText(normalizeLayoutDraft({ ...parsed, width, height, items }, { width, height }));
}

function scaleLayoutDraft(input, width, height) {
    const draft = normalizeLayoutDraft(input);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        throw new Error('Target layout width and height must be positive integers.');
    }
    const sx = width / draft.width;
    const sy = height / draft.height;
    const items = draft.items.map(item => ({
        ...item,
        bbox: [item.bbox[0] * sx, item.bbox[1] * sy, item.bbox[2] * sx, item.bbox[3] * sy],
    }));
    return normalizeLayoutDraft({ ...draft, width, height, items }, { width, height });
}

function resolveModelFamily(model) {
    if (!model) return null;
    const family = get_model_family(model);
    if (family) return family;
    const target = String(model).replaceAll('\\', '/').split('/').pop().toLowerCase();
    if (model_selection_moss.some(item => String(item.value).replaceAll('\\', '/').split('/').pop().toLowerCase() === target)) {
        return 'moss';
    }
    if (model_selection_xl.some(item => String(item.value).replaceAll('\\', '/').split('/').pop().toLowerCase() === target)) {
        return 'xl';
    }
    return null;
}

/**
 * Resolve the configured layout mode for a model.
 * Moss -> JSON layout, SD/SDXL -> Forge Coupler regions, others -> off.
 */
function resolveLayoutMode(setting, model) {
    if (!['off', 'auto', 'moss', 'coupler'].includes(setting)) return 'off';
    if (setting === 'off') return 'off';
    const family = resolveModelFamily(model);
    if (setting === 'moss') return family === 'moss' ? 'moss' : 'off';
    if (setting === 'coupler') return COUPLER_FAMILIES.has(family) ? 'coupler' : 'off';
    if (family === 'moss') return 'moss';
    if (COUPLER_FAMILIES.has(family)) return 'coupler';
    return 'off';
}

function extractLayoutToken(prompt) {
    const matches = [...String(prompt || '').matchAll(LAYOUT_TOKEN_PATTERN)];
    if (matches.length === 0) return null;
    if (matches.length > 1) throw new Error('Only one <layout:name> token is supported per prompt.');
    const match = matches[0];
    return {
        name: match[1],
        prompt: String(prompt).replace(match[0], ' ').replace(/\s+/g, ' ').trim(),
    };
}

function normalizedRegion(bbox, width, height, weight) {
    const [x1, y1, x2, y2] = bbox;
    const nx1 = clamp(x1 / width, 0, 1);
    const nx2 = clamp(x2 / width, 0, 1);
    const ny1 = clamp(y1 / height, 0, 1);
    const ny2 = clamp(y2 / height, 0, 1);
    if (nx2 <= nx1 || ny2 <= ny1) {
        throw new Error('Layout contains an empty region after normalization.');
    }
    return [nx1, nx2, ny1, ny2, weight];
}

function regionToken(region) {
    const [x1, x2, y1, y2, weight] = region;
    return `|${x1.toFixed(4)}:${x2.toFixed(4)},${y1.toFixed(4)}:${y2.toFixed(4)},${weight.toFixed(2)}|`;
}

function couplerLines(input, { includeSummary = true, summaryWeight = 0.5, itemWeight = 1, extra = '' } = {}) {
    const draft = normalizeLayoutDraft(input);
    const lines = [];
    const regions = [];
    if (includeSummary) {
        const summary = cleanText(`${draft.summary.caption}${extra ? ` ${extra}` : ''}`, Math.max(1000, MAX_CAPTION_LENGTH * 4));
        if (summary) {
            regions.push([0, 1, 0, 1, clamp(summaryWeight, 0, 1)]);
            lines.push({ text: summary, region: regions[regions.length - 1] });
        }
    }
    for (const item of draft.items) {
        const region = normalizedRegion(item.bbox, draft.width, draft.height, clamp(itemWeight, 0, 1));
        const text = cleanText(item.label === 'text' && item.text
            ? `"${item.text}" ${item.caption}`
            : item.caption, MAX_CAPTION_LENGTH * 2);
        if (!text) continue;
        regions.push(region);
        lines.push({ text, region });
    }
    if (lines.length === 0) throw new Error('Layout has no renderable captions.');
    return { lines, regions, draft };
}

/**
 * Convert a layout into Forge Couple's inline Advanced prompt syntax.
 * The existing prompt_analyzer parses this back into coupler_config.
 */
function layoutToCouplerPrompt(input, options = {}) {
    const { lines } = couplerLines(input, options);
    return lines
        .map(line => `${line.text} ${regionToken(line.region)}`.trim())
        .join(' || ');
}

function layoutToCouplerConfig(input, options = {}) {
    const { regions } = couplerLines(input, options);
    return {
        mode: 'Advanced',
        direction: 'Vertical',
        global: 'None',
        global_weight: 0.5,
        adv_regions: regions,
    };
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Render a human-readable PNG preview of the layout.
 */
async function renderLayoutPreview(input, { maxSide = 1024 } = {}) {
    const draft = normalizeLayoutDraft(input);
    const margin = 32;
    const header = 52;
    const sidebar = 0;
    const scale = Math.min(1, (maxSide - margin * 2) / Math.max(draft.width, draft.height));
    const canvasWidth = Math.max(64, Math.round(draft.width * scale));
    const canvasHeight = Math.max(64, Math.round(draft.height * scale));
    const outputWidth = canvasWidth + margin * 2 + sidebar;
    const outputHeight = canvasHeight + margin * 2 + header;
    const offsetX = margin;
    const offsetY = margin + header;
    const sx = canvasWidth / draft.width;
    const sy = canvasHeight / draft.height;
    const fontSize = clamp(Math.round(Math.min(canvasWidth, canvasHeight) / 34), 11, 22);
    const smallFont = Math.max(9, Math.round(fontSize * 0.72));

    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${outputWidth} ${outputHeight}">`);
    parts.push(`<rect width="100%" height="100%" fill="#0f1216"/>`);
    parts.push(`<text x="${margin}" y="${margin + 18}" fill="#f8fafc" font-family="sans-serif" font-size="20" font-weight="700">Layout draft</text>`);
    parts.push(`<text x="${margin}" y="${margin + 38}" fill="#94a3b8" font-family="sans-serif" font-size="12">${draft.width} x ${draft.height} px · ${draft.items.length} item${draft.items.length === 1 ? '' : 's'}</text>`);
    parts.push(`<rect x="${offsetX}" y="${offsetY}" width="${canvasWidth}" height="${canvasHeight}" fill="#f8fafc" stroke="#334155" stroke-width="2"/>`);

    // A light grid helps judge placement without competing with the boxes.
    const gridStep = Math.max(32, Math.round(Math.min(canvasWidth, canvasHeight) / 8));
    for (let x = gridStep; x < canvasWidth; x += gridStep) {
        parts.push(`<line x1="${offsetX + x}" y1="${offsetY}" x2="${offsetX + x}" y2="${offsetY + canvasHeight}" stroke="#e2e8f0" stroke-width="1"/>`);
    }
    for (let y = gridStep; y < canvasHeight; y += gridStep) {
        parts.push(`<line x1="${offsetX}" y1="${offsetY + y}" x2="${offsetX + canvasWidth}" y2="${offsetY + y}" stroke="#e2e8f0" stroke-width="1"/>`);
    }

    draft.items.forEach((item, index) => {
        const color = PREVIEW_COLORS[index % PREVIEW_COLORS.length];
        const x = offsetX + item.bbox[0] * sx;
        const y = offsetY + item.bbox[1] * sy;
        const width = Math.max(2, (item.bbox[2] - item.bbox[0]) * sx);
        const height = Math.max(2, (item.bbox[3] - item.bbox[1]) * sy);
        parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="3"/>`);
        const label = `${index + 1} ${item.label}`;
        parts.push(`<rect x="${x + 2}" y="${y + 2}" width="${Math.min(width - 4, Math.max(46, label.length * smallFont * 0.62 + 10))}" height="${smallFont + 8}" fill="${color}" fill-opacity="0.9"/>`);
        parts.push(`<text x="${x + 7}" y="${y + smallFont + 5}" fill="#0f1216" font-family="sans-serif" font-size="${smallFont}" font-weight="700">${escapeXml(label)}</text>`);
        const caption = item.label === 'text' && item.text ? `“${item.text}”` : item.caption;
        const maxChars = Math.max(8, Math.floor((width - 12) / (smallFont * 0.52)));
        const truncated = caption.length > maxChars ? `${caption.slice(0, Math.max(1, maxChars - 1))}…` : caption;
        if (height > smallFont * 3) {
            parts.push(`<text x="${x + 6}" y="${y + smallFont * 2 + 8}" fill="#0f172a" font-family="sans-serif" font-size="${smallFont}">${escapeXml(truncated)}</text>`);
        }
    });

    parts.push(`<text x="${margin}" y="${outputHeight - 12}" fill="#64748b" font-family="sans-serif" font-size="11">${escapeXml(draft.summary.canvas)} · ${escapeXml(draft.summary.caption.slice(0, 120))}</text>`);
    parts.push('</svg>');
    return sharp(Buffer.from(parts.join(''))).png().toBuffer();
}

module.exports = {
    LABELS,
    CANVAS_TYPES,
    MAX_ITEMS,
    MIN_BOX_PIXELS,
    MAX_CAPTION_LENGTH,
    MAX_TEXT_LENGTH,
    cleanText,
    normalizeLayoutDraft,
    compileLayoutPrompt,
    decompileLayoutPrompt,
    scaleLayoutDraft,
    resolveModelFamily,
    resolveLayoutMode,
    extractLayoutToken,
    layoutToCouplerPrompt,
    layoutToCouplerConfig,
    renderLayoutPreview,
};
