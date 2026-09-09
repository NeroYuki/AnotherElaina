'use strict';

const { canonicalUrl } = require('../web/source_registry');

const INPUT_SCHEMA = {
    type: 'object',
    properties: {
        sourceId: { type: 'string', minLength: 1, maxLength: 100 },
        url: { type: 'string', minLength: 1, maxLength: 2048 },
    },
    additionalProperties: false,
    oneOf: [{ required: ['sourceId'] }, { required: ['url'] }],
};
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        sourceId: { type: 'string' }, url: { type: 'string' }, title: { type: 'string' },
        text: { type: 'string', maxLength: 12000 }, retrievedAt: { type: 'string' },
    },
    required: ['sourceId', 'url', 'title', 'text', 'retrievedAt'], additionalProperties: false,
};

function createWebFetchTool({ safeFetch, sourceRegistry }) {
    if (typeof safeFetch !== 'function' || !sourceRegistry) throw new TypeError('web_fetch requires safeFetch and sourceRegistry');
    return {
        name: 'web_fetch', version: '1', timeoutMs: 10_000, maxResultBytes: 64 * 1024,
        description: 'Read one bounded public HTML/text source returned by search or explicitly supplied by the user.',
        inputSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA,
        authorization: context => context?.externalSearchEnabled !== false,
        async execute({ args, trustedContext, signal }) {
            let source = args.sourceId ? sourceRegistry.get(args.sourceId) : null;
            if (args.sourceId && !source) {
                const error = new Error('Unknown source ID'); error.code = 'UNKNOWN_SOURCE'; throw error;
            }
            if (args.url) {
                let requested;
                try { requested = canonicalUrl(args.url); } catch { const error = new Error('Invalid URL'); error.code = 'INVALID_URL'; throw error; }
                const approved = (trustedContext.userProvidedUrls || []).some(url => {
                    try { return canonicalUrl(url) === requested; } catch { return false; }
                });
                if (!approved) {
                    const error = new Error('URL was not explicitly supplied by the user'); error.code = 'UNAPPROVED_URL'; throw error;
                }
                source = sourceRegistry.add({ url: requested, title: requested });
            }
            const page = await safeFetch(source.url, { signal });
            const updated = sourceRegistry.add({ ...source, url: page.url, title: page.title || source.title, retrievedAt: page.retrievedAt });
            const data = { sourceId: updated.id, url: updated.url, title: updated.title, text: page.text, retrievedAt: page.retrievedAt };
            return { data, sources: [updated] };
        },
    };
}

module.exports = { createWebFetchTool };
