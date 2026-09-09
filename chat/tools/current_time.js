'use strict';

const INPUT_SCHEMA = {
    type: 'object', properties: { timezone: { type: 'string', minLength: 1, maxLength: 100 } },
    additionalProperties: false,
};
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        utc: { type: 'string' }, timezone: { type: 'string' }, local: { type: 'string' },
    },
    required: ['utc', 'timezone', 'local'], additionalProperties: false,
};

function validTimezone(timezone) {
    try {
        Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
        return true;
    } catch {
        return false;
    }
}

function createCurrentTimeTool({ clock = () => new Date() } = {}) {
    return {
        name: 'current_time', version: '1', timeoutMs: 1000, maxResultBytes: 2048,
        description: 'Get deterministic real-world time. This never changes fictional scene time.',
        inputSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA, cache: 'call',
        execute({ args, trustedContext }) {
            const timezone = args.timezone || trustedContext.timezone || 'UTC';
            if (!validTimezone(timezone)) {
                const error = new TypeError('Invalid IANA timezone');
                error.code = 'INVALID_TIMEZONE';
                throw error;
            }
            const now = new Date(clock());
            return {
                utc: now.toISOString(), timezone,
                local: new Intl.DateTimeFormat('en-CA', {
                    timeZone: timezone, dateStyle: 'full', timeStyle: 'long', hour12: false,
                }).format(now),
            };
        },
    };
}

module.exports = { createCurrentTimeTool, validTimezone };
