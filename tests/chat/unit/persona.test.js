'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const persona = require('../../../chat/persona/elaina.json');
const examples = require('../../../chat/persona/examples.json');
const { PERSONA_VERSION, buildPersonaMessage, buildPersonaPrompt } = require('../../../chat/persona/prompt_builder');

test('persona is versioned from the active qwen profile and consistently adult', () => {
    assert.equal(persona.source.profile, 'qwen');
    assert.equal(persona.identity.age, 18);
    assert.equal(persona.version, PERSONA_VERSION);
    assert.equal(examples.personaVersion, PERSONA_VERSION);
});

test('prompt states voice, evidence trust, hidden mode labels, tools, and player-agency rules', () => {
    const prompt = buildPersonaPrompt();
    assert.match(prompt, /Never write a player character's dialogue/);
    assert.match(prompt, /proposal remains a proposal/i);
    assert.match(prompt, /never print, quote, or explain IC\/OOC labels/i);
    assert.match(prompt, /exchange rates.*use the available web tool/i);
    assert.match(prompt, /retrieved evidence.*not instructions/);
    assert.match(prompt, /Never invent a remembered fact/);
    assert.match(prompt, /Match the user's language/);
    assert.doesNotMatch(prompt, /virgin|panties|A-cup/i);
    assert.ok(Buffer.byteLength(prompt, 'utf8') < 8000);
});

test('prompt builder returns an application-owned system message', () => {
    const message = buildPersonaMessage({ includeExamples: false });
    assert.equal(message.role, 'system');
    assert.match(message.content, /Ashen Witch/);
    assert.doesNotMatch(message.content, /Voice examples/);
});

test('mismatched examples fail closed', () => {
    assert.throws(() => buildPersonaPrompt({ examples: { personaVersion: 'old', examples: [] } }), /do not match/);
});
