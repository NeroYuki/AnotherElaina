'use strict';

const INPUT_SCHEMA = {
    type: 'object',
    properties: {
        query: { type: 'string', minLength: 1, maxLength: 500 },
        kind: { type: 'string', enum: ['claim', 'event', 'promise', 'preference', 'episode'] },
    },
    required: ['query'],
    additionalProperties: false,
};

const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        matches: {
            type: 'array', maxItems: 10,
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' }, text: { type: 'string' }, kind: { type: 'string' },
                    sourceIds: { type: 'array', items: { type: 'string' } },
                },
                required: ['id', 'text'], additionalProperties: false,
            },
        },
        degraded: { type: 'boolean' },
    },
    required: ['matches', 'degraded'], additionalProperties: false,
};

function createMemorySearchTool({ search }) {
    if (typeof search !== 'function') throw new TypeError('memory_search requires an injected search function');
    return {
        name: 'memory_search', version: '1', timeoutMs: 3000, maxResultBytes: 48 * 1024,
        description: 'Search eligible memories from the current continuity. Scope is supplied by the application.',
        inputSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA,
        async execute({ args, trustedContext, signal }) {
            const result = await search({ query: args.query, kind: args.kind, trustedContext, signal, limit: 10 });
            const matches = (result.matches || result || []).slice(0, 10).map(item => ({
                id: String(item.id), text: String(item.text),
                ...(item.kind ? { kind: String(item.kind) } : {}),
                ...(item.sourceIds ? { sourceIds: item.sourceIds.map(String) } : {}),
            }));
            return { matches, degraded: Boolean(result.degraded) };
        },
    };
}

module.exports = { createMemorySearchTool, INPUT_SCHEMA, OUTPUT_SCHEMA };
