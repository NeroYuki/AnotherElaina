'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { validateCandidate, validateExtraction } = require('../../chat/memory/validate')
const { MemoryExtractor } = require('../../chat/memory/extract')
const { activeWithLineage, projectRelationships, projectScene } = require('../../chat/memory/project')

const turns = [
    { eventId: 't1', authorCharacterId: 'ren', authorUserId: 'u1', segments: [{ mode: 'ic', text: 'I lend you my green umbrella.' }] },
    { eventId: 't2', authorCharacterId: 'elaina', authorUserId: 'bot', segments: [{ mode: 'ic', text: 'Ren, I will buy you a cinnamon bun tomorrow to repay you.' }] },
    { eventId: 't3', authorCharacterId: 'ren', authorUserId: 'u1', segments: [{ mode: 'ooc', text: 'I prefer concise OOC answers.' }] }
]
const participants = [
    { characterId: 'ren', ownerUserId: 'u1' },
    { characterId: 'elaina', ownerUserId: 'bot' }
]

function promise() {
    return {
        kind: 'promise', statement: 'Elaina promised Ren a cinnamon bun tomorrow.',
        subjectCharacterId: 'elaina', targetCharacterId: 'ren', action: 'buy Ren a cinnamon bun',
        due: { clock: 'fictional', relativeToTurnId: 't2', value: 'tomorrow' }, promiseStatus: 'open',
        confidence: 'explicit', sourceTurnIds: ['t2'],
        evidence: [{ turnId: 't2', quote: 'I will buy you a cinnamon bun tomorrow to repay you.' }], salience: 4
    }
}

test('typed promise validation preserves direction, deadline, and exact evidence', () => {
    assert.deepEqual(validateCandidate(promise(), { turns, participants, allowedUserIds: ['u1'], existingMemoryIds: [] }), [])
    const wrong = promise()
    wrong.subjectCharacterId = 'ren'
    assert.ok(validateCandidate(wrong, { turns, participants }).some(error => error.includes('promisor')))
    const inventedQuote = promise()
    inventedQuote.evidence[0].quote = 'I promise a pastry.'
    assert.ok(validateCandidate(inventedQuote, { turns, participants }).some(error => error.includes('exact substring')))
})

test('real-user preferences require the user own an explicit OOC quote', () => {
    const preference = {
        kind: 'user_preference', statement: 'The user prefers concise OOC answers.', userId: 'u1',
        confidence: 'explicit', sourceTurnIds: ['t3'], evidence: [{ turnId: 't3', quote: 'I prefer concise OOC answers.' }]
    }
    assert.deepEqual(validateCandidate(preference, { turns, participants, allowedUserIds: ['u1'] }), [])
    preference.confidence = 'inferred'
    assert.ok(validateCandidate(preference, { turns, participants, allowedUserIds: ['u1'] }).length >= 1)
})

test('an unaccepted proposal cannot become a completed plan', () => {
    const plan = {
        kind: 'plan', statement: 'Ren and Elaina left for the capital.', subjectCharacterId: 'ren', targetCharacterId: 'elaina',
        planStatus: 'completed', acceptedByCharacterIds: ['elaina'], confidence: 'explicit', sourceTurnIds: ['t1'],
        evidence: [{ turnId: 't1', quote: 'I lend you my green umbrella.' }]
    }
    assert.ok(validateCandidate(plan, { turns, participants }).some(error => error.includes('acceptance')))
})

test('extractor repairs once and application supplies trusted scope', async () => {
    const calls = []
    const provider = {
        async generate(request) {
            calls.push(request)
            return calls.length === 1 ? { text: '{bad json' } : { text: JSON.stringify({ memories: [promise()] }) }
        }
    }
    const extractor = new MemoryExtractor({
        provider,
        id: () => 'm1',
        schemaValidator: { validate: (_name, output) => ({ valid: Array.isArray(output.memories), errors: [] }) }
    })
    const result = await extractor.extract({
        turns, participants, allowedUserIds: ['u1'], existingMemories: [],
        scope: { guildId: 'g1', continuityId: 'c1', sceneId: 's1', corpus: 'memory' }, expectedEpoch: 2
    })
    assert.equal(calls.length, 2)
    assert.equal(calls.every(call => call.thinking === false), true)
    assert.equal(result[0].scope.continuityId, 'c1')
    assert.equal(result[0].deletionEpoch, 2)
    assert.equal(result[0].memoryId, 'm1')
})

test('correction lineage removes displaced facts and relationships remain directional', () => {
    const old = { memoryId: 'old', kind: 'scene_fact', statement: 'The umbrella is blue.', status: 'active', salience: 2, sourceTurnIds: ['t1'], createdAt: new Date(0) }
    const correction = { memoryId: 'new', kind: 'correction', statement: 'The umbrella is green.', targetMemoryId: 'old', correctionType: 'supersede', status: 'active', salience: 3, sourceTurnIds: ['t3'], createdAt: new Date(1) }
    const promised = { memoryId: 'p1', ...promise(), status: 'active' }
    assert.deepEqual(activeWithLineage([old, correction]).map(item => item.memoryId), ['new'])
    assert.deepEqual(projectScene([old, correction]).facts.map(item => item.memoryId), ['new'])
    const relationships = projectRelationships([promised])
    assert.equal(relationships[0].subjectCharacterId, 'elaina')
    assert.equal(relationships[0].targetCharacterId, 'ren')
})

test('extraction rejects unknown model-written authority fields', () => {
    const candidate = { ...promise(), scope: { guildId: 'attacker' } }
    const result = validateExtraction({ memories: [candidate] }, { turns, participants })
    assert.equal(result.valid, false)
    assert.ok(result.rejected[0].errors.includes('unknown property scope'))
})

test('extraction redacts a derived write if deletion wins the commit race', async () => {
    let continuityRead = 0
    const saved = []
    const redacted = []
    const extractor = new MemoryExtractor({
        provider: { generate: async () => ({ text: JSON.stringify({ memories: [promise()] }) }) },
        schemaValidator: { validate: () => ({ valid: true, errors: [] }) },
        repository: {
            getContinuity: async () => ({ deletionEpoch: continuityRead++ === 0 ? 0 : 1 }),
            isCanonicalTurn: async () => true,
            upsertMemory: async memory => { saved.push(memory); return memory },
            redactMemories: async ids => redacted.push(...ids)
        },
        id: () => 'race-memory'
    })
    const result = await extractor.runJob({
        continuityId: 'c1', expectedEpoch: 0, turns, participants, allowedUserIds: ['u1'], existingMemories: [],
        scope: { guildId: 'g1', continuityId: 'c1', sceneId: 's1', corpus: 'memory' }
    })
    assert.equal(result.stale, true)
    assert.equal(saved.length, 1)
    assert.deepEqual(redacted, ['race-memory'])
})
