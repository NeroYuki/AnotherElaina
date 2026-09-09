'use strict';

const crypto = require('node:crypto');

const INPUT_SCHEMA = {
    type: 'object',
    properties: {
        count: { type: 'integer', minimum: 1, maximum: 10 },
        sides: { type: 'integer', minimum: 2, maximum: 100 },
        modifier: { type: 'integer', minimum: -100, maximum: 100 },
    },
    required: ['count', 'sides'], additionalProperties: false,
};
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        rolls: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'integer' } },
        modifier: { type: 'integer' }, total: { type: 'integer' }, notation: { type: 'string' },
    },
    required: ['rolls', 'modifier', 'total', 'notation'], additionalProperties: false,
};

function createRollDiceTool({ randomInt = crypto.randomInt } = {}) {
    return {
        name: 'roll_dice', version: '1', timeoutMs: 1000, maxResultBytes: 2048,
        description: 'Roll dice only when the user explicitly requests a roleplay or game roll.',
        inputSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA,
        sideEffect: 'random', cache: 'call',
        execute({ args }) {
            const modifier = args.modifier || 0;
            const rolls = Array.from({ length: args.count }, () => randomInt(1, args.sides + 1));
            return {
                rolls, modifier, total: rolls.reduce((sum, value) => sum + value, modifier),
                notation: `${args.count}d${args.sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ''}`,
            };
        },
    };
}

module.exports = { createRollDiceTool };
