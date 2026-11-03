'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const tick = () => new Promise(resolve => setImmediate(resolve));

function draft(label, offset = 0) {
    return {
        width: 512,
        height: 512,
        summary: { caption: `${label} summary`, canvas: 'single' },
        items: [{ label: 'object', caption: `${label} object`, bbox: [20 + offset, 20, 200 + offset, 300] }],
    };
}

function makeHarness(answers, { awaitMessages } = {}) {
    const edits = [];
    const sends = [];
    const followUps = [];
    const messageEdits = [];
    const collectorHandlers = {};
    const collector = {
        on(event, handler) { collectorHandlers[event] = handler; },
        stop() { if (collectorHandlers.end) collectorHandlers.end(); },
    };
    const channel = {
        id: 'channel-test',
        createMessageComponentCollector() { return collector; },
        async send(payload) { sends.push(payload); return payload; },
        async awaitMessages() {
            if (awaitMessages) return awaitMessages();
            const value = answers.shift() || '';
            return { first: () => ({ content: value }) };
        },
    };
    const interaction = {
        id: '123456789012345678',
        user: { id: 'user-a', bot: false },
        channel,
        options: {
            getString: name => (name === 'prompt' ? 'a travel poster' : null),
            getInteger: () => null,
        },
        async deferReply() {},
        async editReply(payload) { edits.push(payload); return payload; },
    };
    return { interaction, collector, collectorHandlers, edits, sends, followUps, messageEdits };
}

function component(harness, action) {
    return {
        user: { id: 'user-a' },
        customId: `layout_${harness.interaction.id}:${action}`,
        async deferUpdate() {},
        async followUp(payload) { harness.followUps.push(payload); return payload; },
        channel: harness.interaction.channel,
        message: { async edit(payload) { harness.messageEdits.push(payload); } },
    };
}

async function loadCommand(stubs) {
    const originalLoad = Module._load;
    const commandPath = path.join(__dirname, '..', 'commands', 'wd_layout_draft');
    Module._load = function (request, parent, isMain) {
        if (request === '../utils/layout_agent') return stubs.layoutAgent;
        if (request === '../utils/layout_store') return stubs.layoutStore;
        if (request === '../utils/moss_layout') return stubs.mossLayout;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[require.resolve(commandPath)];
        return require(commandPath);
    }
    finally {
        Module._load = originalLoad;
    }
}

test('layout command previews, adjusts, and saves a named layout', async () => {
    const realMoss = require('../utils/moss_layout');
    const draftCalls = [];
    const saved = [];
    let unloads = 0;
    const drafts = [draft('first'), draft('second', 40)];
    const stubs = {
        layoutAgent: {
            unloadLayoutModel: async () => { unloads += 1; },
            draftImageLayout: async (args) => {
                draftCalls.push(args);
                return drafts[draftCalls.length - 1];
            },
        },
        layoutStore: {
            validateName: name => {
                if (!/^[a-zA-Z0-9_-]{1,32}$/.test(String(name || '').trim())) throw new Error('Layout name must be valid.');
                return String(name).trim();
            },
            saveLayout: async payload => { saved.push(payload); return payload; },
        },
        mossLayout: {
            ...realMoss,
            renderLayoutPreview: async () => Buffer.from('png-bytes'),
        },
    };
    const command = await loadCommand(stubs);
    const harness = makeHarness(['move the title down', 'my_layout']);
    const execution = command.execute(harness.interaction);

    while (!harness.collectorHandlers.collect) await tick();
    assert.equal(harness.edits[0].content, 'Drafting layout with Qwen 27B…');
    assert.equal(harness.edits[1].files[0].name, 'layout.png');
    assert.match(harness.edits[1].embeds[0].title, /Layout draft/);

    // The first component is captured by the collector registered in execute().
    await harness.collectorHandlers.collect(component(harness, 'adjust'));
    assert.equal(draftCalls.length, 2);
    assert.equal(draftCalls[1].feedback, 'move the title down');
    assert.equal(draftCalls[1].previousDraft.summary.caption, 'first summary');
    assert.equal(harness.messageEdits.length, 1);
    assert.equal(harness.messageEdits[0].files[0].name, 'layout.png');

    await harness.collectorHandlers.collect(component(harness, 'save'));
    await execution;

    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'my_layout');
    assert.equal(saved[0].draft.summary.caption, 'second summary');
    const savedFollowUp = harness.followUps.find(payload => Array.isArray(payload.files));
    assert.ok(savedFollowUp);
    assert.equal(savedFollowUp.files[0].name, 'layout-my_layout.json');
    assert.equal(harness.edits.at(-1).content.includes('Layout saved as **my_layout**'), true);
    assert.equal(unloads, 1);
});

test('layout command can return a Coupler prompt without closing the session', async () => {
    const realMoss = require('../utils/moss_layout');
    let unloads = 0;
    const stubs = {
        layoutAgent: {
            unloadLayoutModel: async () => { unloads += 1; },
            draftImageLayout: async () => draft('poster'),
        },
        layoutStore: {
            validateName: name => String(name).trim(),
            saveLayout: async () => ({}),
        },
        mossLayout: {
            ...realMoss,
            renderLayoutPreview: async () => Buffer.from('png-bytes'),
        },
    };
    const command = await loadCommand(stubs);
    const harness = makeHarness([]);
    const execution = command.execute(harness.interaction);
    while (!harness.collectorHandlers.collect) await tick();

    await harness.collectorHandlers.collect(component(harness, 'coupler'));
    const couplerFollowUp = harness.followUps.find(payload => /Forge Coupler/.test(payload.content || ''));
    assert.ok(couplerFollowUp);
    assert.ok(couplerFollowUp.files.some(file => file.name === 'coupler-config.json'));

    await harness.collectorHandlers.collect(component(harness, 'cancel'));
    await execution;
    assert.equal(unloads, 1);
});

test('expiry during Adjust feedback cancels the wait without starting another draft', async () => {
    const realMoss = require('../utils/moss_layout');
    const draftCalls = [];
    let unloads = 0;
    let feedbackRequested = false;
    let resolveFeedback;
    const feedback = new Promise(resolve => { resolveFeedback = resolve; });
    const stubs = {
        layoutAgent: {
            unloadLayoutModel: async () => { unloads += 1; },
            draftImageLayout: async (args) => {
                draftCalls.push(args);
                return draft('first');
            },
        },
        layoutStore: {
            validateName: name => String(name).trim(),
            saveLayout: async () => ({}),
        },
        mossLayout: {
            ...realMoss,
            renderLayoutPreview: async () => Buffer.from('png-bytes'),
        },
    };
    const command = await loadCommand(stubs);
    const harness = makeHarness([], {
        awaitMessages: () => {
            feedbackRequested = true;
            return feedback;
        },
    });
    const execution = command.execute(harness.interaction);
    while (!harness.collectorHandlers.collect) await tick();

    const adjust = harness.collectorHandlers.collect(component(harness, 'adjust'));
    while (!feedbackRequested) await tick();
    harness.collectorHandlers.end();
    await execution;

    assert.equal(draftCalls.length, 1);
    assert.equal(harness.messageEdits.length, 0);
    assert.equal(harness.edits.at(-1).content, 'Layout draft expired without a save.');
    assert.equal(harness.edits.at(-1).components.length, 0);
    assert.equal(unloads, 1);

    // A late channel answer must not revive the closed session.
    resolveFeedback({ first: () => ({ content: 'move the title down' }) });
    await adjust;
    await tick();
    assert.equal(draftCalls.length, 1);
    assert.equal(harness.messageEdits.length, 0);
    assert.equal(unloads, 1);
});

test('expiry during an Adjust LLM call drains the draft before final unload and never mutates the UI', async () => {
    const realMoss = require('../utils/moss_layout');
    const draftCalls = [];
    let unloads = 0;
    let draftResolved = false;
    let unloadedBeforeDraftResolved = false;
    let resolveDraft;
    const pendingDraft = new Promise(resolve => { resolveDraft = resolve; });
    const stubs = {
        layoutAgent: {
            unloadLayoutModel: async () => {
                unloads += 1;
                if (!draftResolved) unloadedBeforeDraftResolved = true;
            },
            draftImageLayout: async (args) => {
                draftCalls.push(args);
                if (draftCalls.length === 1) return draft('first');
                return pendingDraft;
            },
        },
        layoutStore: {
            validateName: name => String(name).trim(),
            saveLayout: async () => ({}),
        },
        mossLayout: {
            ...realMoss,
            renderLayoutPreview: async () => Buffer.from('png-bytes'),
        },
    };
    const command = await loadCommand(stubs);
    const harness = makeHarness(['move the title down']);
    const execution = command.execute(harness.interaction);
    while (!harness.collectorHandlers.collect) await tick();

    const adjust = harness.collectorHandlers.collect(component(harness, 'adjust'));
    while (draftCalls.length < 2) await tick();
    harness.collectorHandlers.end();
    await tick();

    let finished = false;
    execution.then(() => { finished = true; });
    await tick();
    assert.equal(finished, false, 'execute must wait for in-flight layout work');
    assert.equal(unloads, 0);

    draftResolved = true;
    resolveDraft(draft('second', 40));
    await execution;
    await adjust;

    assert.equal(finished, true);
    assert.equal(unloads, 1);
    assert.equal(unloadedBeforeDraftResolved, false);
    assert.equal(harness.messageEdits.length, 0);
    assert.equal(harness.edits.at(-1).content, 'Layout draft expired without a save.');
    assert.equal(harness.edits.at(-1).components.length, 0);
});

test('a layout failure after expiry is not reported and still cleans up once', async () => {
    const realMoss = require('../utils/moss_layout');
    const draftCalls = [];
    let unloads = 0;
    let rejectDraft;
    const pendingDraft = new Promise((_, reject) => { rejectDraft = reject; });
    const stubs = {
        layoutAgent: {
            unloadLayoutModel: async () => { unloads += 1; },
            draftImageLayout: async (args) => {
                draftCalls.push(args);
                if (draftCalls.length === 1) return draft('first');
                return pendingDraft;
            },
        },
        layoutStore: {
            validateName: name => String(name).trim(),
            saveLayout: async () => ({}),
        },
        mossLayout: {
            ...realMoss,
            renderLayoutPreview: async () => Buffer.from('png-bytes'),
        },
    };
    const command = await loadCommand(stubs);
    const harness = makeHarness(['move the title down']);
    const execution = command.execute(harness.interaction);
    while (!harness.collectorHandlers.collect) await tick();

    const adjust = harness.collectorHandlers.collect(component(harness, 'adjust'));
    while (draftCalls.length < 2) await tick();
    harness.collectorHandlers.end();
    rejectDraft(new Error('layout backend failed'));

    await execution;
    await adjust;
    assert.equal(unloads, 1);
    assert.equal(harness.messageEdits.length, 0);
    assert.equal(harness.followUps.length, 0);
    assert.equal(harness.edits.at(-1).content, 'Layout draft expired without a save.');
});
