'use strict';

const { assertSchema } = require('./schema_validator');

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

class ToolRegistry {
    constructor(tools = []) {
        this.tools = new Map();
        for (const tool of tools) this.register(tool);
    }

    register(tool) {
        if (!tool || !NAME_PATTERN.test(tool.name || '')) throw new TypeError('Tool has an invalid name');
        if (this.tools.has(tool.name)) throw new TypeError(`Tool already registered: ${tool.name}`);
        if (typeof tool.execute !== 'function') throw new TypeError(`Tool ${tool.name} has no execute function`);
        if (!tool.inputSchema || !tool.outputSchema) throw new TypeError(`Tool ${tool.name} requires input and output schemas`);
        if (tool.inputSchema.type === 'object' && tool.inputSchema.additionalProperties !== false) {
            throw new TypeError(`Tool ${tool.name} input schema must reject unknown properties`);
        }
        const normalized = Object.freeze({
            version: '1',
            description: '',
            timeoutMs: 3000,
            maxResultBytes: 64 * 1024,
            authorization: () => true,
            cache: 'turn',
            sideEffect: 'none',
            ...tool,
        });
        this.tools.set(normalized.name, normalized);
        return this;
    }

    get(name) {
        return this.tools.get(name) || null;
    }

    list({ trustedContext } = {}) {
        return [...this.tools.values()].filter(tool => tool.authorization(trustedContext) !== false);
    }

    openAITools(options) {
        return this.list(options).map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
            },
        }));
    }

    validateInput(tool, input) {
        return assertSchema(tool.inputSchema, input, `${tool.name} arguments`);
    }

    validateOutput(tool, output) {
        return assertSchema(tool.outputSchema, output, `${tool.name} result`);
    }
}

module.exports = { ToolRegistry };
