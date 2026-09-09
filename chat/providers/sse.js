'use strict';

const { ProviderStreamError } = require('./errors');

async function* parseSSE(body, { signal } = {}) {
    if (!body || typeof body[Symbol.asyncIterator] !== 'function') {
        throw new ProviderStreamError('Response does not contain a readable SSE body', {
            code: 'INVALID_STREAM',
        });
    }

    const decoder = new TextDecoder('utf-8', { fatal: false });
    let buffer = '';
    let eventName = 'message';
    let dataLines = [];
    let lastEventId = null;

    function emitEvent() {
        if (dataLines.length === 0) return null;
        const event = { event: eventName, data: dataLines.join('\n'), id: lastEventId };
        eventName = 'message';
        dataLines = [];
        return event;
    }

    function consumeLine(rawLine) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line === '') return emitEvent();
        if (line.startsWith(':')) return null;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') dataLines.push(value);
        else if (field === 'event') eventName = value || 'message';
        else if (field === 'id' && !value.includes('\0')) lastEventId = value;
        return null;
    }

    try {
        for await (const chunk of body) {
            if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
            buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
            let newline;
            while ((newline = buffer.indexOf('\n')) !== -1) {
                const event = consumeLine(buffer.slice(0, newline));
                buffer = buffer.slice(newline + 1);
                if (event) yield event;
            }
        }
        buffer += decoder.decode();
        if (buffer) {
            const event = consumeLine(buffer);
            if (event) yield event;
        }
        const finalEvent = emitEvent();
        if (finalEvent) yield finalEvent;
    } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        if (error instanceof ProviderStreamError) throw error;
        throw new ProviderStreamError('SSE stream failed', {
            code: 'STREAM_READ_FAILED', retryable: false, cause: error,
        });
    }
}

module.exports = { parseSSE };
