'use strict';

const DEFAULT_ALLOWED_MENTIONS = Object.freeze({ parse: [], repliedUser: false });

class DiscordDeliveryError extends Error {
    constructor(message, { code = 'DISCORD_DELIVERY_FAILED', cause = null, messageIds = [] } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = 'DiscordDeliveryError';
        this.code = code;
        this.messageIds = messageIds;
    }
}

function fenceTransitions(text, current) {
    let open = current;
    const matches = text.matchAll(/```([^\s`]*)/g);
    for (const match of matches) open = open ? null : (match[1] || '');
    return open;
}

function splitDiscordMessage(content, { limit = 1900 } = {}) {
    if (!Number.isInteger(limit) || limit < 50 || limit > 2000) throw new RangeError('Discord chunk limit must be between 50 and 2000');
    const text = String(content || '').replace(/\r\n/g, '\n');
    if (!text) return [''];
    const chunks = [];
    let chunk = '';
    let openFence = null;

    function flush() {
        if (!chunk) return;
        const suffix = openFence !== null ? `${chunk.endsWith('\n') ? '' : '\n'}\`\`\`` : '';
        chunks.push(`${chunk}${suffix}`.trimEnd());
        chunk = openFence !== null ? `\`\`\`${openFence}\n` : '';
    }

    for (const part of text.split(/(?<=\n)/)) {
        let remaining = part;
        while (remaining) {
            const reserve = 4;
            const available = limit - chunk.length - reserve;
            if (remaining.length <= available) {
                chunk += remaining;
                openFence = fenceTransitions(remaining, openFence);
                remaining = '';
                continue;
            }
            if (available <= 0) {
                flush();
                continue;
            }
            let splitAt = Math.max(1, available);
            const candidate = remaining.slice(0, splitAt);
            const boundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
            if (boundary > Math.floor(available * 0.5)) splitAt = boundary + 1;
            const segment = remaining.slice(0, splitAt);
            chunk += segment;
            openFence = fenceTransitions(segment, openFence);
            remaining = remaining.slice(splitAt);
            flush();
        }
    }
    flush();
    return chunks.length ? chunks : [''];
}

function unknownMessage(error) {
    return error?.code === 10008 || error?.rawError?.code === 10008;
}

class DiscordResponder {
    constructor({ trigger = null, message = null, editIntervalMs = 1750, limit = 1900,
        allowedMentions = DEFAULT_ALLOWED_MENTIONS, placeholder = 'Thinking...', now = Date.now,
        setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        if (!trigger && !message) throw new TypeError('DiscordResponder requires a trigger or existing message');
        this.trigger = trigger;
        this.message = message;
        this.editIntervalMs = editIntervalMs;
        this.limit = limit;
        this.allowedMentions = { ...allowedMentions, parse: [...(allowedMentions.parse || [])] };
        this.placeholder = placeholder;
        this.now = now;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.lastEditAt = 0;
        this.pending = null;
        this.timer = null;
        this.inFlight = Promise.resolve();
        this.closed = false;
        this.messageIds = message?.id ? [message.id] : [];
        this.updateError = null;
    }

    _payload(content, extra = {}) {
        return { content, allowedMentions: this.allowedMentions, ...extra };
    }

    async start(content = this.placeholder) {
        if (this.message) return this.message;
        this.message = await this.trigger.reply(this._payload(content));
        if (this.message?.id) this.messageIds.push(this.message.id);
        return this.message;
    }

    _enqueueEdit(content) {
        const first = splitDiscordMessage(content, { limit: this.limit })[0] || '...';
        this.inFlight = this.inFlight.then(async () => {
            if (this.closed || !this.message) return;
            await this.message.edit(this._payload(first));
            this.lastEditAt = this.now();
        }).catch(error => {
            this.updateError = error;
        });
        return this.inFlight;
    }

    update(content) {
        if (this.closed) return Promise.reject(new DiscordDeliveryError('Responder is closed'));
        this.pending = String(content || '');
        if (!this.message) return Promise.reject(new DiscordDeliveryError('Responder has not started'));
        if (this.timer) return this.inFlight;
        const delay = Math.max(0, this.editIntervalMs - (this.now() - this.lastEditAt));
        if (delay === 0) {
            const value = this.pending;
            this.pending = null;
            return this._enqueueEdit(value);
        }
        this.timer = this.setTimer(() => {
            this.timer = null;
            const value = this.pending;
            this.pending = null;
            if (value !== null) this._enqueueEdit(value);
        }, delay);
        this.timer.unref?.();
        return this.inFlight;
    }

    async finalize(content, { components } = {}) {
        if (this.closed) throw new DiscordDeliveryError('Responder is closed');
        if (!this.message) await this.start();
        if (this.timer) {
            this.clearTimer(this.timer);
            this.timer = null;
        }
        this.pending = null;
        await this.inFlight;

        const chunks = splitDiscordMessage(content || 'I could not produce a response.', { limit: this.limit });
        const firstPayload = this._payload(chunks[0], components && chunks.length === 1 ? { components } : {});
        try {
            await this.message.edit(firstPayload);
        } catch (error) {
            if (!unknownMessage(error)) {
                throw new DiscordDeliveryError('Failed to edit the Discord response', {
                    code: error?.code === 50013 ? 'MISSING_PERMISSIONS' : 'EDIT_FAILED',
                    cause: error, messageIds: [...this.messageIds],
                });
            }
            const channel = this.message?.channel || this.trigger?.channel;
            if (!channel?.send) throw new DiscordDeliveryError('Response placeholder was deleted', { code: 'MESSAGE_DELETED', cause: error });
            this.message = await channel.send(firstPayload);
            if (this.message?.id) this.messageIds.push(this.message.id);
        }

        const channel = this.message?.channel || this.trigger?.channel;
        for (let index = 1; index < chunks.length; index++) {
            try {
                const sent = await channel.send(this._payload(chunks[index], index === chunks.length - 1 && components ? { components } : {}));
                if (sent?.id) this.messageIds.push(sent.id);
            } catch (error) {
                throw new DiscordDeliveryError('Failed to send a Discord continuation', {
                    code: error?.code === 50013 ? 'MISSING_PERMISSIONS' : 'CONTINUATION_FAILED',
                    cause: error, messageIds: [...this.messageIds],
                });
            }
        }
        this.closed = true;
        return { message: this.message, messageIds: [...this.messageIds], chunks };
    }

    async close() {
        this.closed = true;
        if (this.timer) this.clearTimer(this.timer);
        this.timer = null;
        this.pending = null;
        await this.inFlight;
    }
}

async function deliverDiscordResponse(options) {
    const responder = new DiscordResponder(options);
    await responder.start(options.placeholder);
    return responder.finalize(options.content, { components: options.components });
}

module.exports = {
    DEFAULT_ALLOWED_MENTIONS,
    DiscordDeliveryError,
    DiscordResponder,
    splitDiscordMessage,
    deliverDiscordResponse,
};
