'use strict';

const INPUT_SCHEMA = {
    type: 'object',
    properties: {
        query: { type: 'string', minLength: 1, maxLength: 300 },
        language: { type: 'string', pattern: '^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?$', maxLength: 10 },
        timeRange: { type: 'string', enum: ['day', 'month', 'year'] },
    },
    required: ['query'], additionalProperties: false,
};
const SOURCE_SCHEMA = {
    type: 'object',
    properties: {
        id: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' },
        snippet: { type: 'string' }, retrievedAt: { type: 'string' },
    },
    required: ['id', 'title', 'url', 'snippet', 'retrievedAt'], additionalProperties: false,
};
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        query: { type: 'string' }, results: { type: 'array', maxItems: 5, items: SOURCE_SCHEMA },
        retrievedAt: { type: 'string' },
    },
    required: ['query', 'results', 'retrievedAt'], additionalProperties: false,
};

function createWebSearchTool({ client }) {
    if (!client?.search) throw new TypeError('web_search requires a SearXNG client');
    return {
        name: 'web_search', version: '1', timeoutMs: 12_000, maxResultBytes: 48 * 1024,
        description: 'Search the public web for current or uncertain real-world information.',
        inputSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA,
        authorization: context => context?.externalSearchEnabled !== false,
        async execute({ args, signal }) {
            const data = await client.search({ query: args.query, language: args.language, timeRange: args.timeRange, signal, limit: 5 });
            return { data, sources: data.results };
        },
    };
}

module.exports = { createWebSearchTool };
