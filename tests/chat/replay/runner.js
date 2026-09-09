'use strict';

const REQUIRED_COUNTS = Object.freeze({
    scene_relationship_continuity: 10,
    corrections_deletion: 5,
    lore_memory_retrieval: 5,
    tool_factual_tasks: 5,
    style_ooc_multilingual: 5
});

function validateFixture(fixture) {
    const errors = [];
    if (fixture?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
    if (!Array.isArray(fixture?.scenarios)) return { ok: false, errors: [...errors, 'scenarios must be an array'], counts: {} };
    const ids = new Set();
    const counts = {};
    for (const scenario of fixture.scenarios) {
        if (!scenario.id || ids.has(scenario.id)) errors.push(`scenario id is missing or duplicated: ${scenario.id || '<missing>'}`);
        ids.add(scenario.id);
        counts[scenario.category] = (counts[scenario.category] || 0) + 1;
        if (!scenario.title || !Array.isArray(scenario.turns) || scenario.turns.length < 3) errors.push(`${scenario.id}: must have a title and at least three turns/operations`);
        if (!scenario.turns?.some(turn => turn.actorId && typeof turn.content === 'string')) errors.push(`${scenario.id}: needs at least one dialogue turn`);
        if (!scenario.expect || !Object.keys(scenario.expect).length) errors.push(`${scenario.id}: meaningful expectations are required`);
    }
    for (const [category, minimum] of Object.entries(REQUIRED_COUNTS)) {
        if ((counts[category] || 0) < minimum) errors.push(`${category}: requires at least ${minimum}, found ${counts[category] || 0}`);
    }
    return { ok: errors.length === 0, errors, counts };
}

async function runReplay(fixture, adapter, options = {}) {
    const validation = validateFixture(fixture);
    if (!validation.ok) throw new Error(`Invalid replay fixture:\n${validation.errors.join('\n')}`);
    if (!adapter || typeof adapter.runScenario !== 'function') throw new TypeError('Replay adapter must expose runScenario(scenario, options)');
    const selected = options.ids?.length ? fixture.scenarios.filter(item => options.ids.includes(item.id)) : fixture.scenarios;
    const results = [];
    for (const scenario of selected) {
        const startedAt = Date.now();
        try {
            const result = await adapter.runScenario(scenario, options);
            results.push({ id: scenario.id, category: scenario.category, ok: result?.ok !== false, durationMs: Date.now() - startedAt, details: result || {} });
        } catch (error) {
            results.push({ id: scenario.id, category: scenario.category, ok: false, durationMs: Date.now() - startedAt, error: error.message });
            if (options.failFast) break;
        }
    }
    return { ok: results.every(item => item.ok), validation, results };
}

module.exports = { REQUIRED_COUNTS, runReplay, validateFixture };
