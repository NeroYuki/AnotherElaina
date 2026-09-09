'use strict';

const INPUT_SCHEMA = {
    type: 'object',
    properties: {
        query: { type: 'string', minLength: 1, maxLength: 500 },
        corpus: { type: 'string', minLength: 1, maxLength: 80 },
    },
    required: ['query'], additionalProperties: false,
};
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        passages: {
            type: 'array', maxItems: 10,
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' }, text: { type: 'string' }, title: { type: 'string' },
                    sourceId: { type: 'string' },
                },
                required: ['id', 'text'], additionalProperties: false,
            },
        },
        degraded: { type: 'boolean' },
    },
    required: ['passages', 'degraded'], additionalProperties: false,
};

function createKnowledgeSearchTool({ search }) {
    if (typeof search !== 'function') throw new TypeError('knowledge_search requires an injected search function');
    return {
        name: 'knowledge_search', version: '1', timeoutMs: 3000, maxResultBytes: 64 * 1024,
        description: 'Search application-approved lore and reference passages.',
        inputSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA,
        async execute({ args, trustedContext, signal }) {
            const result = await search({ query: args.query, corpus: args.corpus, trustedContext, signal, limit: 10 });
            const passages = (result.passages || result || []).slice(0, 10).map(item => ({
                id: String(item.id), text: String(item.text),
                ...(item.title ? { title: String(item.title) } : {}),
                ...(item.sourceId ? { sourceId: String(item.sourceId) } : {}),
            }));
            return { passages, degraded: Boolean(result.degraded) };
        },
    };
}

module.exports = { createKnowledgeSearchTool, INPUT_SCHEMA, OUTPUT_SCHEMA };
