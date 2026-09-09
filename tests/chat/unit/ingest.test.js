'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDiscordMessage, segmentContent } = require('../../../chat/discord/ingest');

const BOT_ID = '999999999999999999';

function message(overrides = {}) {
    const content = overrides.content ?? `<@${BOT_ID}> hello <@111111111111111111>`;
    const mentioned = content.includes(BOT_ID);
    return {
        id: '333333333333333333',
        guildId: '444444444444444444',
        channelId: '555555555555555555',
        guild: { id: '444444444444444444' },
        channel: { id: '555555555555555555', isThread: () => false },
        author: { id: '222222222222222222', username: 'ren', bot: false },
        member: { displayName: 'Ren' },
        content,
        createdTimestamp: 1700000000000,
        mentions: {
            users: new Map(mentioned ? [[BOT_ID, { id: BOT_ID }], ['111111111111111111', { id: '111111111111111111' }]] : []),
            roles: new Map(),
            channels: new Map()
        },
        attachments: new Map(),
        ...overrides
    };
}

test('mention normalization removes only the bot mention and keeps stable identity', async () => {
    const result = await normalizeDiscordMessage({ message: message(), botUserId: BOT_ID });
    assert.equal(result.kind, 'addressed');
    assert.equal(result.event.content, 'hello <@111111111111111111>');
    assert.equal(result.event.eventId, 'discord:444444444444444444:555555555555555555:333333333333333333');
    assert.equal(result.event.author.id, '222222222222222222');
    assert.deepEqual(result.event.mentions.users, [BOT_ID, '111111111111111111']);
});

test('reply to this bot is addressed and carries bounded provenance', async () => {
    const result = await normalizeDiscordMessage({
        message: message({
            content: 'Replying without a mention',
            mentions: { users: new Map(), roles: new Map(), channels: new Map() },
            reference: { messageId: '123', channelId: '555555555555555555', guildId: '444444444444444444' }
        }),
        botUserId: BOT_ID,
        maxReplyQuoteLength: 5,
        fetchReply: async () => ({
            id: '123', channelId: '555555555555555555', author: { id: BOT_ID, bot: true },
            content: 'Earlier bot answer', createdTimestamp: 1699999999000, attachments: new Map()
        })
    });
    assert.equal(result.kind, 'addressed');
    assert.equal(result.reason, 'reply_to_bot');
    assert.equal(result.event.reply.target.content, 'Earli');
    assert.equal(result.event.reply.target.authorId, BOT_ID);
});

test('a mention still activates when its reply target cannot be fetched', async () => {
    const result = await normalizeDiscordMessage({
        message: message({ reference: { messageId: 'missing' } }),
        botUserId: BOT_ID,
        fetchReply: async () => { throw new Error('deleted'); }
    });
    assert.equal(result.kind, 'addressed');
    assert.equal(result.event.reply.resolved, false);
    assert.equal(result.event.reply.error, 'not_found');
});

test('an unresolved reply without a mention is ignored', async () => {
    const result = await normalizeDiscordMessage({
        message: message({ content: 'hello', mentions: { users: new Map(), roles: new Map(), channels: new Map() }, reference: { messageId: 'missing' } }),
        botUserId: BOT_ID,
        fetchReply: async () => null
    });
    assert.deepEqual(result, { kind: 'ignored', reason: 'missing_reply_target', replyError: 'not_found' });
});

test('reply normalization never fetches a target from another channel', async () => {
    let fetched = false;
    const result = await normalizeDiscordMessage({
        message: message({
            content: 'cross-channel reply',
            mentions: { users: new Map(), roles: new Map(), channels: new Map() },
            reference: { messageId: '123', channelId: 'another-channel' }
        }),
        botUserId: BOT_ID,
        fetchReply: async () => { fetched = true; return null; }
    });
    assert.equal(fetched, false);
    assert.equal(result.reason, 'missing_reply_target');
    assert.equal(result.replyError, 'inaccessible_channel');
});

test('attachment-only addressed image preserves stable metadata', async () => {
    const attachment = {
        id: '777777777777777777', name: 'map.webp', contentType: 'image/webp', size: 1234,
        width: 640, height: 480, url: 'https://cdn.discordapp.com/map.webp', proxyURL: 'https://media.discordapp.net/map.webp'
    };
    const result = await normalizeDiscordMessage({
        message: message({ content: `<@!${BOT_ID}>`, attachments: new Map([[attachment.id, attachment]]) }),
        botUserId: BOT_ID
    });
    assert.equal(result.kind, 'addressed');
    assert.equal(result.event.activation.attachmentOnly, true);
    assert.deepEqual(result.event.attachments[0], {
        id: attachment.id, order: 0, name: 'map.webp', contentType: 'image/webp', size: 1234,
        width: 640, height: 480, url: attachment.url, proxyUrl: attachment.proxyURL, ephemeral: false, isImage: true
    });
});

test('bots, webhooks, disabled mode, and opted-out observations are ignored', async () => {
    const otherBot = await normalizeDiscordMessage({ message: message({ author: { id: '888', bot: true } }), botUserId: BOT_ID });
    const webhook = await normalizeDiscordMessage({ message: message({ webhookId: 'hook' }), botUserId: BOT_ID });
    const disabled = await normalizeDiscordMessage({ message: message(), botUserId: BOT_ID, enabled: false });
    const optedOut = await normalizeDiscordMessage({
        message: message({ content: 'passive text', mentions: { users: new Map(), roles: new Map(), channels: new Map() } }),
        botUserId: BOT_ID, observationEnabled: true, isParticipant: true, isOptedOut: true
    });
    assert.equal(otherBot.reason, 'other_bot');
    assert.equal(webhook.reason, 'webhook');
    assert.equal(disabled.reason, 'disabled');
    assert.equal(optedOut.reason, 'opted_out');
});

test('participant observation excludes unrelated attachment metadata', async () => {
    const result = await normalizeDiscordMessage({
        message: message({
            content: 'I walk toward the gate.',
            mentions: { users: new Map(), roles: new Map(), channels: new Map() },
            attachments: new Map([['1', { id: '1', name: 'unrelated.png', contentType: 'image/png' }]])
        }),
        botUserId: BOT_ID, observationEnabled: true, isParticipant: true
    });
    assert.equal(result.kind, 'observation');
    assert.deepEqual(result.event.attachments, []);
});

test('IC, OOC, and parenthetical segments preserve raw ranges', () => {
    const input = 'IC: I open the door.\nOOC: Keep this brief.\nIC: ((No romance)) I step back.';
    const segments = segmentContent(input);
    assert.deepEqual(segments.map(item => item.mode), ['ic', 'ooc', 'ic', 'ooc', 'ic']);
    assert.equal(segments.map(item => item.raw).join(''), input);
    assert.equal(segments.find(item => item.raw === '((No romance))').text, 'No romance');
    for (const segment of segments) assert.equal(input.slice(segment.start, segment.end), segment.raw);
});
