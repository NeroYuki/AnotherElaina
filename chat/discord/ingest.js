'use strict';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

function valuesOf(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (typeof collection.values === 'function') return [...collection.values()];
    return Object.values(collection);
}

function snowflake(value) {
    return value == null ? null : String(value);
}

function isoTimestamp(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function hasBotMention(message, botUserId) {
    if (!message || !botUserId) return false;
    if (message.mentions?.users?.has?.(botUserId)) return true;
    if (message.mentions?.has) {
        try {
            if (message.mentions.has(botUserId)) return true;
        } catch (_) {}
    }
    return new RegExp(`<@!?${String(botUserId).replace(/\D/g, '')}>`).test(message.content || '');
}

function removeBotMention(content, botUserId) {
    if (!botUserId) return String(content || '');
    const escaped = String(botUserId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(content || '').replace(new RegExp(`<@!?${escaped}>`, 'g'), '').trim();
}

function imageAttachment(attachment) {
    const name = String(attachment.name || attachment.filename || '');
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const contentType = String(attachment.contentType || '').toLowerCase();
    return contentType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension);
}

function normalizeAttachments(attachments) {
    return valuesOf(attachments).map((attachment, index) => Object.freeze({
        id: snowflake(attachment.id) || `position-${index}`,
        order: index,
        name: attachment.name || attachment.filename || null,
        contentType: attachment.contentType || null,
        size: Number.isFinite(attachment.size) ? attachment.size : null,
        width: Number.isFinite(attachment.width) ? attachment.width : null,
        height: Number.isFinite(attachment.height) ? attachment.height : null,
        url: attachment.url || null,
        proxyUrl: attachment.proxyURL || attachment.proxyUrl || null,
        ephemeral: Boolean(attachment.ephemeral),
        isImage: imageAttachment(attachment)
    }));
}

function pushSegment(segments, mode, raw, text, start, end, textStart, textEnd) {
    if (!raw) return;
    segments.push(Object.freeze({ mode, raw, text, start, end, textStart, textEnd }));
}

function segmentContent(content) {
    const input = String(content || '');
    const tokens = [];
    const labelPattern = /^[ \t]*(OOC|IC):[ \t]*/gim;
    const parentheticalPattern = /\(\(([\s\S]*?)\)\)/g;
    let match;
    while ((match = labelPattern.exec(input))) {
        tokens.push({ type: 'label', mode: match[1].toLowerCase(), start: match.index, end: labelPattern.lastIndex });
    }
    while ((match = parentheticalPattern.exec(input))) {
        tokens.push({
            type: 'parenthetical', mode: 'ooc', start: match.index, end: parentheticalPattern.lastIndex,
            textStart: match.index + 2, textEnd: parentheticalPattern.lastIndex - 2
        });
    }
    tokens.sort((a, b) => a.start - b.start || (a.type === 'parenthetical' ? -1 : 1));

    const segments = [];
    let mode = 'unmarked';
    let rawStart = 0;
    let textStart = 0;
    for (const token of tokens) {
        if (token.start < rawStart) continue;
        pushSegment(segments, mode, input.slice(rawStart, token.start), input.slice(textStart, token.start), rawStart, token.start, textStart, token.start);
        if (token.type === 'label') {
            mode = token.mode;
            rawStart = token.start;
            textStart = token.end;
        } else {
            pushSegment(segments, 'ooc', input.slice(token.start, token.end), input.slice(token.textStart, token.textEnd), token.start, token.end, token.textStart, token.textEnd);
            rawStart = token.end;
            textStart = token.end;
        }
    }
    pushSegment(segments, mode, input.slice(rawStart), input.slice(textStart), rawStart, input.length, textStart, input.length);
    return segments.length ? segments : [Object.freeze({ mode: 'unmarked', raw: '', text: '', start: 0, end: 0, textStart: 0, textEnd: 0 })];
}

function withDeadline(promise, timeoutMs) {
    let timer;
    return Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error('Reply fetch timed out'), { code: 'REPLY_TIMEOUT' })), timeoutMs);
            timer.unref?.();
        })
    ]).finally(() => clearTimeout(timer));
}

async function resolveReply(message, fetchReply, timeoutMs) {
    const reference = message.reference;
    if (!reference?.messageId) return { reference: null, target: null, error: null };
    const minimal = {
        messageId: snowflake(reference.messageId),
        channelId: snowflake(reference.channelId || message.channelId || message.channel?.id),
        guildId: snowflake(reference.guildId || message.guildId || message.guild?.id)
    };
    const currentChannelId = snowflake(message.channelId || message.channel?.id);
    if (minimal.channelId !== currentChannelId) {
        return { reference: minimal, target: null, error: 'inaccessible_channel' };
    }
    try {
        let target;
        if (message.referencedMessage) target = message.referencedMessage;
        else if (fetchReply) target = await withDeadline(fetchReply(message, minimal), timeoutMs);
        else if (typeof message.fetchReference === 'function') target = await withDeadline(message.fetchReference(), timeoutMs);
        else if (message.channel?.messages?.fetch) target = await withDeadline(message.channel.messages.fetch(minimal.messageId), timeoutMs);
        return { reference: minimal, target: target || null, error: target ? null : 'not_found' };
    } catch (error) {
        return { reference: minimal, target: null, error: error.code === 'REPLY_TIMEOUT' ? 'timeout' : 'not_found' };
    }
}

function normalizeReplyTarget(target, maxQuoteLength) {
    if (!target) return null;
    return Object.freeze({
        messageId: snowflake(target.id),
        channelId: snowflake(target.channelId || target.channel?.id),
        authorId: snowflake(target.author?.id),
        authorIsBot: Boolean(target.author?.bot),
        createdAt: isoTimestamp(target.createdTimestamp || target.createdAt),
        content: String(target.content || '').slice(0, maxQuoteLength),
        attachments: normalizeAttachments(target.attachments).slice(0, 4)
    });
}

function mentionIds(message, key) {
    return valuesOf(message.mentions?.[key]).map(item => snowflake(item.id)).filter(Boolean);
}

function ignored(reason, details = {}) {
    return Object.freeze({ kind: 'ignored', reason, ...details });
}

async function normalizeDiscordMessage(options) {
    const message = options?.message;
    const botUserId = snowflake(options?.botUserId);
    if (!message || !message.id || !message.author?.id || !botUserId) throw new TypeError('message, message.id, message.author.id, and botUserId are required');
    if (!message.guildId && !message.guild?.id) return ignored('direct_message');
    if (message.webhookId) return ignored('webhook');
    if (message.author.bot) return ignored(String(message.author.id) === botUserId ? 'self_message' : 'other_bot');
    if (options.enabled === false) return ignored('disabled');

    const mentioned = hasBotMention(message, botUserId);
    const reply = await resolveReply(message, options.fetchReply, Math.max(50, Math.min(options.replyTimeoutMs || 1500, 5000)));
    const repliesToBot = snowflake(reply.target?.author?.id) === botUserId;
    const addressed = mentioned || repliesToBot || options.followupAddressed === true;
    const attachments = normalizeAttachments(message.attachments).slice(0, 10);
    const content = removeBotMention(message.content, botUserId);
    const hasSupportedImage = attachments.some(item => item.isImage);

    if (!addressed) {
        if (reply.reference && !reply.target) return ignored('missing_reply_target', { replyError: reply.error });
        if (!options.observationEnabled) return ignored('not_addressed');
        if (!options.isParticipant) return ignored('not_participant');
        if (options.isOptedOut) return ignored('opted_out');
        if (!content) return ignored('empty_observation');
        if (String(content).trim().startsWith('/')) return ignored('command_output');
    }
    if (addressed && !content && !hasSupportedImage) return ignored('empty_addressed_input');

    const guildId = snowflake(message.guildId || message.guild?.id);
    const channelId = snowflake(message.channelId || message.channel?.id);
    const messageId = snowflake(message.id);
    const event = Object.freeze({
        schemaVersion: 1,
        eventId: `discord:${guildId}:${channelId}:${messageId}`,
        source: 'discord',
        sourceMessageId: messageId,
        guildId,
        channelId,
        threadId: message.channel?.isThread?.() ? channelId : null,
        author: Object.freeze({
            id: snowflake(message.author.id),
            username: message.author.username || null,
            displayName: message.member?.displayName || message.author.globalName || message.author.username || null
        }),
        createdAt: isoTimestamp(message.createdTimestamp || message.createdAt),
        rawContent: String(message.content || ''),
        content,
        segments: Object.freeze(segmentContent(content)),
        mentions: Object.freeze({
            users: Object.freeze(mentionIds(message, 'users')),
            roles: Object.freeze(mentionIds(message, 'roles')),
            channels: Object.freeze(mentionIds(message, 'channels'))
        }),
        attachments: Object.freeze(addressed ? attachments : []),
        reply: reply.reference ? Object.freeze({ ...reply.reference, resolved: Boolean(reply.target), error: reply.error, target: normalizeReplyTarget(reply.target, options.maxReplyQuoteLength || 2000) }) : null,
        activation: Object.freeze({ mentioned, repliedToBot: Boolean(repliesToBot), followup: options.followupAddressed === true, attachmentOnly: !content && hasSupportedImage })
    });
    return Object.freeze({ kind: addressed ? 'addressed' : 'observation', reason: addressed ? (mentioned ? 'mention' : repliesToBot ? 'reply_to_bot' : 'followup') : 'participant_observation', event });
}

module.exports = {
    IMAGE_EXTENSIONS,
    hasBotMention,
    imageAttachment,
    normalizeAttachments,
    normalizeDiscordMessage,
    removeBotMention,
    segmentContent
};
