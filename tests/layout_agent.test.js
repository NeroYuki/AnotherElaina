'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { draftImageLayout, parseLayoutResponse } = require('../utils/layout_agent');
const { prepareLayoutPrompt } = require('../utils/layout_prompt');
const { saveLayout } = require('../utils/layout_store');
const {
    model_selection_moss,
    model_selection_xl,
    model_selection_flux,
} = require('../utils/ai_server_config');

const MOSS = model_selection_moss[0].value;
const XL = model_selection_xl[0].value;
const FLUX = model_selection_flux[0].value;

function draftJson() {
    return {
        summary: { caption: 'A travel poster with a title and a mountain.', canvas: 'single' },
        items: [
            { label: 'text', caption: 'Large title at the top.', text: 'EXPLORE', bbox: [10, 10, 90, 40] },
            { label: 'object', caption: 'Blue mountain below the title.', bbox: [20, 50, 80, 90] },
        ],
    };
}

function fakeProvider(responses) {
    const requests = [];
    let index = 0;
    return {
        requests,
        async generate(request) {
            requests.push(request);
            const value = responses[Math.min(index, responses.length - 1)];
            index += 1;
            if (value instanceof Error) throw value;
            return {
                text: typeof value === 'string' ? value : JSON.stringify(value),
                finishReason: 'stop',
                providerMeta: { instanceId: 'unsloth-gpu0' },
            };
        },
    };
}

test('parses a fenced layout response with absolute boxes', () => {
    const result = parseLayoutResponse(
        '```json\n' + JSON.stringify(draftJson()) + '\n```',
        { width: 100, height: 100 },
    );
    assert.equal(result.width, 100);
    assert.deepEqual(result.items[0].bbox, [10, 10, 90, 40]);
    assert.equal(result.items[0].text, 'EXPLORE');
});

test('drafts a layout with Qwen and returns the normalized draft', async () => {
    const provider = fakeProvider([draftJson()]);
    const draft = await draftImageLayout(
        { prompt: 'a travel poster', width: 100, height: 100 },
        { provider, unload: false, retryInvalid: false },
    );
    assert.equal(draft.width, 100);
    assert.equal(draft.items.length, 2);
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0].instanceId, 'unsloth-gpu0');
    assert.match(provider.requests[0].messages[0].content, /MOSS-Image layout/);
    assert.match(provider.requests[0].messages[1].content, /a travel poster/);
});

test('retries once when the first layout response is invalid', async () => {
    const provider = fakeProvider(['not json', draftJson()]);
    const draft = await draftImageLayout(
        { prompt: 'a travel poster', width: 100, height: 100 },
        { provider, unload: false, retryInvalid: true },
    );
    assert.equal(provider.requests.length, 2);
    assert.equal(draft.items.length, 2);
    assert.match(provider.requests[1].messages.at(-1).content, /That response was invalid/);
});

test('rejects truncated layout output', async () => {
    const provider = {
        async generate() {
            return { text: JSON.stringify(draftJson()), finishReason: 'length', providerMeta: { instanceId: 'unsloth-gpu0' } };
        },
    };
    await assert.rejects(
        draftImageLayout({ prompt: 'poster', width: 100, height: 100 }, { provider, unload: false, retryInvalid: false }),
        /truncated/,
    );
});

async function tempLayoutFile() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elaina-layout-agent-'));
    return path.join(dir, 'layouts.json');
}

test('prepareLayoutPrompt expands a saved layout for MOSS with scaling', async () => {
    const layoutFile = await tempLayoutFile();
    await saveLayout({
        userId: 'user-a',
        name: 'poster',
        draft: {
            width: 100,
            height: 100,
            summary: { caption: 'Saved poster', canvas: 'single' },
            items: [{ label: 'object', caption: 'Mountain', bbox: [20, 20, 80, 80] }],
        },
        filePath: layoutFile,
    });

    const result = await prepareLayoutPrompt({
        prompt: '<layout:poster> at sunset',
        model: MOSS,
        width: 200,
        height: 200,
        userId: 'user-a',
        layoutFile,
        unload: false,
    });
    assert.equal(result.mode, 'moss');
    assert.equal(result.source, 'saved');
    assert.match(result.prompt, /"bbox_coord_space":"abs_centralized"/);
    assert.match(result.prompt, /at sunset/);
    assert.deepEqual(result.layout.items[0].bbox, [40, 40, 160, 160]);
});

test('prepareLayoutPrompt converts a saved layout to Coupler syntax for SDXL', async () => {
    const layoutFile = await tempLayoutFile();
    await saveLayout({
        userId: 'user-a',
        name: 'poster',
        draft: {
            width: 100,
            height: 100,
            summary: { caption: 'Saved poster', canvas: 'single' },
            items: [{ label: 'object', caption: 'Mountain', bbox: [20, 20, 80, 80] }],
        },
        filePath: layoutFile,
    });

    const result = await prepareLayoutPrompt({
        prompt: '<layout:poster>',
        model: XL,
        width: 100,
        height: 100,
        userId: 'user-a',
        layoutFile,
        unload: false,
    });
    assert.equal(result.mode, 'coupler');
    assert.match(result.prompt, /\|\|/);
    assert.match(result.prompt, /\|0\.2000:0\.8000,0\.2000:0\.8000,1\.00\|/);
});

test('prepareLayoutPrompt drafts a fresh layout when enabled', async () => {
    const provider = fakeProvider([draftJson()]);
    const result = await prepareLayoutPrompt({
        prompt: 'a travel poster',
        model: MOSS,
        width: 100,
        height: 100,
        setting: 'moss',
        provider,
        unload: false,
        retryInvalid: false,
    });
    assert.equal(result.mode, 'moss');
    assert.equal(result.source, 'drafted');
    assert.match(result.prompt, /"bbox_format":"yxyx"/);
    assert.match(result.prompt, /a travel poster/);
});

test('prepareLayoutPrompt leaves unsupported models and off mode alone', async () => {
    assert.equal(await prepareLayoutPrompt({
        prompt: 'a travel poster', model: FLUX, width: 100, height: 100, setting: 'auto', unload: false,
    }), null);
    assert.equal(await prepareLayoutPrompt({
        prompt: 'a travel poster', model: MOSS, width: 100, height: 100, setting: 'off', unload: false,
    }), null);
});
