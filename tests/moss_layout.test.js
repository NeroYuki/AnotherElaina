'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { get_coupler_config_from_prompt } = require('../utils/prompt_analyzer');
const {
    compileLayoutPrompt,
    decompileLayoutPrompt,
    extractLayoutToken,
    layoutToCouplerConfig,
    layoutToCouplerPrompt,
    normalizeLayoutDraft,
    renderLayoutPreview,
    resolveLayoutMode,
    scaleLayoutDraft,
} = require('../utils/moss_layout');
const {
    model_selection_moss,
    model_selection_xl,
    model_selection_flux,
} = require('../utils/ai_server_config');

function sampleDraft(overrides = {}) {
    return {
        width: 1024,
        height: 1024,
        summary: {
            caption: 'A minimalist travel poster with a cream background.',
            meta: ['poster'],
            canvas: 'single',
        },
        items: [
            { label: 'text', caption: 'Large dark-blue uppercase title at the top.', text: 'EXPLORE', bbox: [200, 300, 824, 420] },
            { label: 'object', caption: 'A flat blue mountain illustration in the lower center.', bbox: [250, 500, 750, 800] },
        ],
        ...overrides,
    };
}

test('compiles the MOSS centered yxyx prompt and round-trips back to a draft', () => {
    const draft = sampleDraft();
    const compiled = compileLayoutPrompt(draft, { extra: 'warm paper texture' });
    const [json, extra] = compiled.split('\n');
    const parsed = JSON.parse(json.replace(/\\\(/g, '(').replace(/\\\)/g, ')'));
    assert.equal(parsed.bbox_coord_space, 'abs_centralized');
    assert.equal(parsed.bbox_format, 'yxyx');
    assert.deepEqual(parsed.items[0].bbox, [-212, -312, -92, 312]);
    assert.equal(parsed.items[0].text, 'EXPLORE');
    assert.equal(extra, 'warm paper texture');

    const roundTrip = decompileLayoutPrompt(json.replace(/\\\(/g, '(').replace(/\\\)/g, ')'), 1024, 1024);
    assert.deepEqual(roundTrip.items.map(item => item.bbox), draft.items.map(item => item.bbox));
    assert.equal(roundTrip.summary.caption, draft.summary.caption);
});

test('parentheses in captions are escaped for MOSS and restored on decompile', () => {
    const draft = sampleDraft({
        summary: { caption: 'Title (left aligned), cream background.', canvas: 'single' },
    });
    const compiled = compileLayoutPrompt(draft);
    assert.match(compiled, /Title \\\(left aligned\\\)/);
    const restored = decompileLayoutPrompt(compiled, 1024, 1024);
    assert.equal(restored.summary.caption, 'Title (left aligned), cream background.');
});

test('normalizes 0..1 boxes, clamps to the canvas, and rejects tiny boxes', () => {
    const normalized = normalizeLayoutDraft(sampleDraft({
        items: [{ label: 'object', caption: 'box', bbox: [0.1, 0.2, 0.9, 0.8] }],
    }));
    assert.deepEqual(normalized.items[0].bbox, [102, 205, 922, 819]);

    assert.throws(
        () => normalizeLayoutDraft(sampleDraft({ items: [{ label: 'object', caption: 'tiny', bbox: [10, 10, 12, 12] }] })),
        /smaller than 16px/,
    );
    assert.throws(
        () => normalizeLayoutDraft({ width: 1024, height: 1024, summary: {}, items: [] }),
        /summary caption/,
    );
});

test('converts a layout into Forge Coupler Advanced prompt and mapping', () => {
    const draft = sampleDraft();
    const prompt = layoutToCouplerPrompt(draft, { extra: 'warm cream background' });
    const config = layoutToCouplerConfig(draft);
    assert.match(prompt, /\|\|/);
    assert.match(prompt, /\|0\.0000:1\.0000,0\.0000:1\.0000,0\.50\|/);
    assert.equal(config.mode, 'Advanced');
    assert.equal(config.adv_regions.length, 3);

    const parsed = get_coupler_config_from_prompt(prompt);
    assert.equal(parsed.coupler_config.mode, 'Advanced');
    assert.equal(parsed.coupler_config.adv_regions.length, 3);
    assert.deepEqual(parsed.coupler_config.adv_regions[0], [0, 1, 0, 1, 0.5]);
    assert.deepEqual(parsed.coupler_config.adv_regions[1], [0.1953, 0.8047, 0.293, 0.4102, 1]);
});

test('renders a PNG preview with the canvas proportions', async () => {
    const wide = {
        width: 1024,
        height: 512,
        summary: { caption: 'A wide banner', canvas: 'single' },
        items: [
            { label: 'text', caption: 'Title', text: 'WIDE', bbox: [80, 80, 500, 200] },
            { label: 'object', caption: 'Shape', bbox: [120, 240, 900, 460] },
        ],
    };
    const buffer = await renderLayoutPreview(wide);
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.format, 'png');
    assert.ok(metadata.width > 512);
    assert.ok(metadata.height > 256);
});

test('scales saved layout boxes to a different target resolution', () => {
    const scaled = scaleLayoutDraft(sampleDraft(), 512, 512);
    assert.deepEqual(scaled.items[0].bbox, [100, 150, 412, 210]);
    assert.deepEqual(scaled.items[1].bbox, [125, 250, 375, 400]);
});

test('extracts exactly one layout token and resolves model-specific modes', () => {
    assert.deepEqual(extractLayoutToken('a <layout:poster> sunset'), { name: 'poster', prompt: 'a sunset' });
    assert.equal(extractLayoutToken('no token'), null);
    assert.throws(() => extractLayoutToken('<layout:a> and <layout:b>'), /Only one/);

    const moss = model_selection_moss[0].value;
    const xl = model_selection_xl[0].value;
    const flux = model_selection_flux[0].value;
    assert.equal(resolveLayoutMode('auto', moss), 'moss');
    assert.equal(resolveLayoutMode('auto', xl), 'coupler');
    assert.equal(resolveLayoutMode('auto', flux), 'off');
    assert.equal(resolveLayoutMode('moss', xl), 'off');
    assert.equal(resolveLayoutMode('coupler', moss), 'off');
});
