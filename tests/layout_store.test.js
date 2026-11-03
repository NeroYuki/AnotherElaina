'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
    saveLayout,
    getLayout,
    listLayouts,
    deleteLayout,
    validateName,
} = require('../utils/layout_store');

function draft(label = 'Draft') {
    return {
        width: 1024,
        height: 1024,
        summary: { caption: `${label} summary`, canvas: 'single' },
        items: [{ label: 'object', caption: `${label} object`, bbox: [100, 100, 400, 400] }],
    };
}

async function tempFile() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elaina-layouts-'));
    return path.join(dir, 'layouts.json');
}

test('saves, loads, lists, and deletes a layout per user', async () => {
    const filePath = await tempFile();
    const saved = await saveLayout({
        userId: 'user-a', name: 'poster', draft: draft('Poster'), sourcePrompt: 'a poster', filePath,
    });
    assert.equal(saved.name, 'poster');
    assert.equal(saved.draft.summary.caption, 'Poster summary');

    const loaded = await getLayout({ userId: 'user-a', name: 'poster', filePath });
    assert.equal(loaded.draft.items[0].caption, 'Poster object');
    assert.equal(loaded.sourcePrompt, 'a poster');

    assert.equal(await getLayout({ userId: 'user-b', name: 'poster', filePath }), null);
    await saveLayout({ userId: 'user-b', name: 'other', draft: draft('Other'), filePath });
    assert.deepEqual((await listLayouts({ userId: 'user-a', filePath })).map(item => item.name), ['poster']);
    assert.deepEqual((await listLayouts({ userId: 'user-b', filePath })).map(item => item.name), ['other']);

    assert.equal(await deleteLayout({ userId: 'user-a', name: 'poster', filePath }), true);
    assert.equal(await getLayout({ userId: 'user-a', name: 'poster', filePath }), null);
});

test('rejects unsafe names and invalid drafts', async () => {
    const filePath = await tempFile();
    assert.throws(() => validateName('../escape'), /Layout name/);
    assert.throws(() => validateName(''), /Layout name/);
    await assert.rejects(
        saveLayout({ userId: 'user-a', name: 'bad name', draft: draft(), filePath }),
        /Layout name/,
    );
    await assert.rejects(
        saveLayout({ userId: 'user-a', name: 'valid', draft: { width: 1024, height: 1024, summary: {}, items: [] }, filePath }),
        /summary caption/,
    );
});

test('updates an existing layout while preserving its creation time', async () => {
    const filePath = await tempFile();
    const first = await saveLayout({ userId: 'user-a', name: 'poster', draft: draft('First'), filePath });
    const second = await saveLayout({ userId: 'user-a', name: 'poster', draft: draft('Second'), filePath });
    assert.equal(first.createdAt, second.createdAt);
    assert.equal((await getLayout({ userId: 'user-a', name: 'poster', filePath })).draft.summary.caption, 'Second summary');
});
