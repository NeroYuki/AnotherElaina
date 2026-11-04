'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const command_path = path.join(__dirname, '..', 'commands', 'wd_inpaint');

function load_command({ segment = {}, load_discord_img = {} } = {}) {
    const original_load = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === '../config.json' || request === '../../config.json') {
            return { byPassUser: [], censorGuildIds: [], optOutGuildIds: [] };
        }
        if (String(request).includes('database_interaction')) return { queryRecordLimit() {} };
        if (request === '../utils/segment_execute.js') {
            return {
                groundingDino_execute: async () => { throw new Error('not configured') },
                segmentAnything_execute: async () => { throw new Error('not configured') },
                expandMask: async () => { throw new Error('not configured') },
                unloadAllModel: async () => {},
                ...segment,
            };
        }
        if (request === '../utils/load_discord_img') {
            return {
                loadImage: async () => 'data:image/png;base64,AAAA',
                uploadDiscordImageToGradio: async () => 'http://worker.test/file=uploaded.png',
                uploadPngBufferToGradio: async () => 'http://worker.test/file=mask.png',
                ...load_discord_img,
            };
        }
        if (request === '../utils/model_change') {
            return {
                cached_model: ['model.safetensors'],
                model_change: async () => true,
                sync_active_model: async () => 'model.safetensors',
            };
        }
        return original_load.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[require.resolve(command_path)];
        return require(command_path);
    }
    finally {
        Module._load = original_load;
    }
}

function make_context() {
    const edits = [];
    const attachment = {
        proxyURL: 'https://example.test/source.png',
        width: 8,
        height: 8,
        name: 'source.png',
        contentType: 'image/png',
    };
    const values = {
        prompt: 'test prompt',
        segment_anything_prompt: 'lantern',
    };
    const client = {
        cooldowns: new Map(),
        COOLDOWN_SECONDS: 0,
        controlnet_config: new Map(),
        boorugen_config: new Map(),
        latentmod_config: new Map(),
        colorbalance_config: new Map(),
        usersetting_config: new Map(),
    };
    const interaction = {
        id: 'auto-mask-test',
        user: { id: 'owner' },
        guildId: null,
        options: {
            getString: name => values[name] ?? null,
            getInteger: () => null,
            getNumber: () => null,
            getBoolean: () => null,
            getAttachment: name => name === 'image' ? attachment : null,
        },
        async deferReply() {},
        async reply() {},
        async editReply(message) { edits.push(message); },
        channel: {
            nsfw: true,
            async send() {},
            createMessageComponentCollector() { return { on() {}, stop() {} }; },
        },
    };
    return { client, interaction, edits, attachment };
}

test('automatic mask stops cleanly when GroundingDINO rejects', async () => {
    const calls = { dino: 0 };
    const command = load_command({
        segment: {
            groundingDino_execute: async () => {
                calls.dino++;
                const error = new Error('socket hang up');
                error.code = 'ECONNRESET';
                throw error;
            },
        },
    });
    const { client, interaction, edits } = make_context();

    await assert.doesNotReject(command.execute(interaction, client));
    assert.equal(calls.dino, 1);
    assert.ok(edits.some(edit => /Failed to get bounding box/.test(edit.content || '')));
});

test('automatic mask stops cleanly when GroundingDINO returns no usable boxes', async () => {
    const command = load_command({
        segment: {
            groundingDino_execute: async () => ({ bb: { path: 'preview.png' }, bb_num: 0 }),
        },
    });
    const { client, interaction, edits } = make_context();

    await assert.doesNotReject(command.execute(interaction, client));
    assert.ok(edits.some(edit => /No bounding box found/.test(edit.content || '')));
});

test('automatic mask stops cleanly when GroundingDINO returns a malformed result', async () => {
    const command = load_command({
        segment: {
            groundingDino_execute: async () => null,
        },
    });
    const { client, interaction, edits } = make_context();

    await assert.doesNotReject(command.execute(interaction, client));
    assert.ok(edits.some(edit => /No bounding box found/.test(edit.content || '')));
});

test('automatic mask stops before detection when the source upload fails', async () => {
    const calls = { dino: 0 };
    const command = load_command({
        load_discord_img: {
            uploadDiscordImageToGradio: async () => { throw new Error('upload failed') },
        },
        segment: {
            groundingDino_execute: async () => {
                calls.dino++;
                return { bb: { path: 'preview.png' }, bb_num: 1 };
            },
        },
    });
    const { client, interaction, edits } = make_context();

    await assert.doesNotReject(command.execute(interaction, client));
    assert.equal(calls.dino, 0);
    assert.ok(edits.some(edit => /Failed to upload image to server/.test(edit.content || '')));
});

test('GroundingDINO retries one connection reset on a fresh connection', async () => {
    const { groundingDino_execute } = require('../utils/segment_execute');
    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        requests.push({ url, options });
        if (requests.length === 1) {
            const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
            throw new TypeError('fetch failed', { cause });
        }
        return {
            status: 200,
            json: async () => ({ data: [{ path: 'boxes.png' }, { value: ['0'] }] }),
        };
    };
    try {
        const result = await groundingDino_execute('lantern', 'source.png', 'session', true, 0.25);
        assert.equal(result.bb_num, 1);
        assert.equal(requests.length, 2);
        assert.equal(requests[1].url, requests[0].url);
        assert.equal(requests[1].options.body, requests[0].options.body);
        assert.equal(requests[1].options.headers.Connection, 'close');
        assert.equal(requests[1].options.headers['X-AI-Instance'], 'forge-gpu0');
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
