'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const components = require('../../../chat/discord/components');
const permissions = require('../../../chat/discord/permissions');
const sceneCommand = require('../../../commands/chat/scene');
const loreCommand = require('../../../commands/chat/lore');
const chatConfigCommand = require('../../../commands/operating/chat_config');

function interaction(overrides = {}) {
    const replies = [];
    return {
        user: { id: 'user-1', username: 'Ren' },
        member: { permissions: { has: () => false } },
        guildId: 'guild-1',
        channelId: 'channel-1',
        channel: { id: 'channel-1', isThread: () => false },
        deferred: false,
        replied: false,
        replies,
        async deferReply(payload) { this.deferred = true; replies.push(['defer', payload]); },
        async editReply(payload) { replies.push(['edit', payload]); },
        async reply(payload) { this.replied = true; replies.push(['reply', payload]); },
        ...overrides
    };
}

test('owner normalization handles the legacy scalar and arrays consistently', () => {
    assert.equal(permissions.isOwner('2', '1,2'), true);
    assert.equal(permissions.isOwner('2', ['2', '3']), true);
    assert.deepEqual(permissions.normalizeIds(['2', '2', ' 3 ']), ['2', '3']);
});

test('/chat_config accepts an owner from the normalized configured owner list', async () => {
    chatConfigCommand.configure({
        ownerIds: ['owner-a', 'owner-b'],
        chatService: { provider: { model: 'local-model' } },
        repository: { collection: () => ({ updateOne: async () => {} }) }
    });
    const current = interaction({
        user: { id: 'owner-b', username: 'Owner' },
        options: {
            getString: () => 'status',
            getBoolean: () => null
        }
    });
    await chatConfigCommand.execute(current);
    assert.match(current.replies.at(-1)[1], /Mode:/);
});

test('/chat_config applies the persisted stream preference to the running service', async () => {
    let persisted
    const chatService = { provider: { model: 'local-model' }, streamEnabled: true };
    chatConfigCommand.configure({
        ownerIds: ['owner'],
        chatService,
        repository: { collection: () => ({ updateOne: async (...args) => { persisted = args } }) }
    });
    const current = interaction({
        user: { id: 'owner', username: 'Owner' },
        options: {
            getString: () => 'auto_local',
            getBoolean: () => false
        }
    });
    await chatConfigCommand.execute(current);
    assert.equal(chatService.streamEnabled, false);
    assert.equal(persisted[1].$set.stream, false);
});

test('audience compatibility never broadens source users or crosses guilds', () => {
    assert.equal(permissions.audienceIsCompatible(
        { guildId: 'g', allowedUserIds: ['1', '2'], allowedRoleIds: ['r', 'x'] },
        { guildId: 'g', allowedUserIds: ['1'], allowedRoleIds: ['r'] }
    ), true);
    assert.equal(permissions.audienceIsCompatible(
        { guildId: 'g', allowedUserIds: ['1'], allowedRoleIds: ['r'] },
        { guildId: 'g', allowedUserIds: ['1', '2'], allowedRoleIds: ['r'] }
    ), false);
    assert.equal(permissions.audienceIsCompatible(
        { guildId: 'g', allowedUserIds: ['1'] },
        { guildId: 'other', allowedUserIds: ['1'] }
    ), false);
});

test('persistent custom IDs round-trip and remain bounded', () => {
    const id = components.createCustomId('regenerate', 'turn_abc-123', 1295);
    assert.ok(id.length <= 100);
    assert.deepEqual(components.parseCustomId(id), { action: 'regenerate', entityId: 'turn_abc-123', revision: 1295 });
    assert.equal(components.parseCustomId('legacy-memory-clear'), null);
    assert.throws(() => components.createCustomId('memory_clear', 'contains:scope', 1), /opaque/);
});

test('component handler rejects stale revisions before mutation', async () => {
    let executed = false;
    components.configure({
        ownerIds: ['owner'],
        chatService: {
            async getControlContext() { return { revision: 8, allowedUserId: 'user-1' }; },
            async executeControl() { executed = true; return { ok: true }; }
        }
    });
    const current = interaction({ customId: components.createCustomId('memory_clear', 'confirm_1', 7) });
    assert.equal(await components.handle(current), true);
    assert.equal(executed, false);
    assert.match(current.replies.at(-1)[1].content, /stale/i);
});

test('component handler authorizes actor and sends the injected control contract', async () => {
    let request;
    components.configure({
        chatService: {
            async getControlContext() { return { revision: 4, allowedUserId: 'user-1' }; },
            async executeControl(value) { request = value; return { ok: true, message: 'Regeneration queued.' }; }
        }
    });
    const current = interaction({ customId: components.createCustomId('regenerate', 'turn_1', 4) });
    await components.handle(current);
    assert.equal(request.action, 'regenerate');
    assert.equal(request.actor.userId, 'user-1');
    assert.deepEqual(request.scope, { guildId: 'guild-1', channelId: 'channel-1', threadId: null, allowedUserIds: [] });
    assert.deepEqual(request.input, { entityId: 'turn_1', revision: 4 });
    assert.match(current.replies.at(-1)[1].content, /queued/);
});

test('/scene exposes configure/init and delegates a bounded control request ephemerally', async () => {
    let request;
    const service = { async executeControl(value) { request = value; return { ok: true, message: 'Scene ready.' }; } };
    assert.equal(sceneCommand.init(), sceneCommand);
    sceneCommand.configure({ chatService: service });
    const current = interaction({
        options: {
            getSubcommand: () => 'new',
            getString: name => name === 'title' ? 'Rainy Inn' : null,
            getBoolean: name => name === 'observe' ? true : null,
            getInteger: () => null
        }
    });
    await sceneCommand.execute(current);
    assert.equal(request.action, 'scene.new');
    assert.deepEqual(request.input, { title: 'Rainy Inn', observeParticipants: true });
    assert.deepEqual(current.replies[0], ['defer', { ephemeral: true }]);
});

test('lore source validation is bounded and rejects credentials', () => {
    assert.equal(loreCommand.validateSource(null, null), 'Provide exactly one file or URL.');
    assert.match(loreCommand.validateSource({ name: 'lore.pdf', size: 10 }, null), /\.md or \.txt/);
    assert.match(loreCommand.validateSource({ name: 'lore.md', size: 1024 * 1024 + 1 }, null), /1 MiB/);
    assert.match(loreCommand.validateSource(null, 'https://user:pass@example.com/lore'), /without embedded credentials/);
    assert.equal(loreCommand.validateSource({ name: 'lore.txt', size: 20 }, null), null);
});
