'use strict';

const { ToolRegistry } = require('./registry');
const { createMemorySearchTool } = require('./memory_search');
const { createKnowledgeSearchTool } = require('./knowledge_search');
const { createWebSearchTool } = require('./web_search');
const { createWebFetchTool } = require('./web_fetch');
const { createCurrentTimeTool } = require('./current_time');
const { createRollDiceTool } = require('./roll_dice');

function createDefaultToolRegistry({ memorySearch, knowledgeSearch, searxng, safeFetch,
    sourceRegistry = searxng?.sourceRegistry, clock, randomInt } = {}) {
    const tools = [createCurrentTimeTool({ clock }), createRollDiceTool({ randomInt })];
    if (memorySearch) tools.push(createMemorySearchTool({ search: memorySearch }));
    if (knowledgeSearch) tools.push(createKnowledgeSearchTool({ search: knowledgeSearch }));
    if (searxng) tools.push(createWebSearchTool({ client: searxng }));
    if (safeFetch && sourceRegistry) tools.push(createWebFetchTool({ safeFetch, sourceRegistry }));
    return new ToolRegistry(tools);
}

module.exports = {
    ToolRegistry,
    ...require('./runner'),
    ...require('./schema_validator'),
    ...require('./controller'),
    createDefaultToolRegistry,
    createMemorySearchTool,
    createKnowledgeSearchTool,
    createWebSearchTool,
    createWebFetchTool,
    createCurrentTimeTool,
    createRollDiceTool,
};
