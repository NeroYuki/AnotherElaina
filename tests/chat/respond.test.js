'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DiscordResponder, splitDiscordMessage, DEFAULT_ALLOWED_MENTIONS } = require('../../chat/discord/respond');

function discordFixture({ editError } = {}) {
    const sent = [];
    const edits = [];
    const channel = {
        async send(payload) {
            sent.push(payload);
            return { id: `sent-${sent.length}`, channel, edit: async next => edits.push(next) };
        },
    };
    const message = {
        id: 'placeholder', channel,
        async edit(payload) {
            if (editError) throw editError;
            edits.push(payload);
            return this;
        },
    };
    const trigger = { channel, reply: async payload => { sent.push(payload); return message; } };
    return { trigger, message, channel, sent, edits };
}

test('Discord splitter bounds chunks and closes/reopens code fences', () => {
    const input = `Before\n\n\`\`\`js\n${'const value = 1;\n'.repeat(30)}\`\`\`\nAfter\n\nSources consulted:\n- [Docs](https://example.com)`;
    const chunks = splitDiscordMessage(input, { limit: 180 });
    assert.ok(chunks.length > 2);
    for (const chunk of chunks) {
        assert.ok(chunk.length <= 180, chunk.length);
        assert.equal((chunk.match(/```/g) || []).length % 2, 0);
    }
    assert.match(chunks.at(-1), /Sources consulted/);
});

test('responder edits one placeholder, sends bounded continuations, and suppresses mentions', async () => {
    const fixture = discordFixture();
    const responder = new DiscordResponder({ trigger: fixture.trigger, editIntervalMs: 0, limit: 100 });
    await responder.start('Thinking');
    await responder.update('partial @everyone');
    const result = await responder.finalize('x '.repeat(130));
    assert.equal(fixture.sent[0].allowedMentions.parse.length, 0);
    assert.deepEqual(fixture.edits[0].allowedMentions, DEFAULT_ALLOWED_MENTIONS);
    assert.ok(result.chunks.every(chunk => chunk.length <= 100));
    assert.equal(result.messageIds[0], 'placeholder');
    assert.equal(fixture.sent.length, result.chunks.length);
});

test('known deleted placeholder is replaced, while permission errors are surfaced', async () => {
    const deleted = discordFixture({ editError: Object.assign(new Error('Unknown Message'), { code: 10008 }) });
    const replacement = new DiscordResponder({ message: deleted.message, limit: 100 });
    const result = await replacement.finalize('Replacement');
    assert.equal(deleted.sent.length, 1);
    assert.equal(result.messageIds.at(-1), 'sent-1');

    const denied = discordFixture({ editError: Object.assign(new Error('Missing Permissions'), { code: 50013 }) });
    const failed = new DiscordResponder({ message: denied.message });
    await assert.rejects(failed.finalize('No'), { code: 'MISSING_PERMISSIONS' });
    await failed.close();
});
