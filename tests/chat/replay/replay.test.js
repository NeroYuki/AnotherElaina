'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/scenarios.json');
const { REQUIRED_COUNTS, runReplay, validateFixture } = require('./runner');

test('replay fixture has all required meaningful categories', () => {
    const result = validateFixture(fixture);
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(fixture.scenarios.length, 30);
    assert.deepEqual(result.counts, REQUIRED_COUNTS);
});

test('replay runner accepts an injected deterministic adapter', async () => {
    const selected = fixture.scenarios.slice(0, 2).map(item => item.id);
    const calls = [];
    const report = await runReplay(fixture, {
        async runScenario(scenario) {
            calls.push(scenario.id);
            return { ok: true, checked: Object.keys(scenario.expect) };
        }
    }, { ids: selected });
    assert.equal(report.ok, true);
    assert.deepEqual(calls, selected);
    assert.equal(report.results.length, 2);
});
