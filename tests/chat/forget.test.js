'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { FakeDb } = require('./fake_mongo')
const { COLLECTIONS } = require('../../chat/persistence/collections')
const { ChatRepository } = require('../../chat/persistence/repository')
const { ForgetService } = require('../../chat/memory/forget')

test('forget raises the epoch barrier before redacting source and derived records', async () => {
    const db = new FakeDb()
    const repository = new ChatRepository({ db, id: (() => { let id = 0; return () => `id-${++id}` })() })
    db.collection(COLLECTIONS.continuities).documents.push({ continuityId: 'c1', status: 'active', deletionEpoch: 0, revision: 2 })
    db.collection(COLLECTIONS.turns).documents.push({ continuityId: 'c1', eventId: 't1', lifecycle: 'finalized', contentParts: [{ type: 'text', text: 'private' }] })
    db.collection(COLLECTIONS.memories).documents.push({ memoryId: 'm1', scope: { continuityId: 'c1' }, status: 'active', statement: 'private', evidence: [{ turnId: 't1', quote: 'private' }] })
    db.collection(COLLECTIONS.episodes).documents.push({ episodeId: 'e1', continuityId: 'c1', lifecycle: 'active', sourceTurnIds: ['t1'], summary: 'private' })
    db.collection(COLLECTIONS.toolRuns).documents.push({ turnId: 't1', status: 'completed', result: { private: true } })
    const cancelled = []
    const enqueued = []
    const vectorDeletes = []
    const service = new ForgetService({
        repository,
        jobs: {
            cancelMatching: async filter => cancelled.push(filter),
            enqueue: async job => enqueued.push(job)
        },
        vectorIndex: {
            deleteByFilter: async filter => vectorDeletes.push(filter),
            countByFilter: async () => 0
        }
    })
    const result = await service.forget({ continuityId: 'c1' }, { reason: 'owner_clear', requestedByUserId: 'u1' })
    assert.equal(result.epoch, 1)
    assert.equal(result.verification.complete, true)
    assert.equal(result.verification.vectorVerified, true)
    assert.equal(db.collection(COLLECTIONS.turns).documents[0].contentParts.length, 0)
    assert.equal(db.collection(COLLECTIONS.memories).documents[0].status, 'deleted')
    assert.equal(db.collection(COLLECTIONS.toolRuns).documents[0].result, null)
    assert.equal(cancelled.length, 1)
    assert.deepEqual(enqueued.map(job => job.type), ['rebuild_episode'])
    assert.equal(vectorDeletes[0].deletionEpoch.$lt, 1)
})

test('personal deletion does not treat readable shared records as user-owned', async () => {
    const db = new FakeDb()
    const repository = new ChatRepository({ db, id: () => 'tombstone' })
    db.collection(COLLECTIONS.continuities).documents.push({ continuityId: 'c1', status: 'active', deletionEpoch: 0, revision: 2 })
    db.collection(COLLECTIONS.turns).documents.push(
        { continuityId: 'c1', sceneId: 's1', eventId: 't-u1', authorUserId: 'u1', lifecycle: 'finalized', content: 'mine', contentParts: [{ type: 'text', text: 'mine' }] },
        { continuityId: 'c1', sceneId: 's1', eventId: 't-u2', authorUserId: 'u2', lifecycle: 'finalized', content: 'theirs', contentParts: [{ type: 'text', text: 'theirs' }] }
    )
    db.collection(COLLECTIONS.memories).documents.push(
        { memoryId: 'm-u1', scope: { continuityId: 'c1', sceneId: 's1', audienceUserIds: ['u1', 'u2'] }, subjectCharacterId: 'user:u1', sourceTurnIds: ['t-u1'], status: 'active', statement: 'mine' },
        { memoryId: 'm-u2', scope: { continuityId: 'c1', sceneId: 's1', audienceUserIds: ['u1', 'u2'] }, subjectCharacterId: 'user:u2', sourceTurnIds: ['t-u2'], status: 'active', statement: 'theirs' }
    )
    db.collection(COLLECTIONS.relationships).documents.push({ continuityId: 'c1', sceneId: 's1', subjectCharacterId: 'user:u2', targetCharacterId: 'elaina', lifecycle: 'active', summary: 'theirs' })
    const service = new ForgetService({ repository, jobs: { cancelMatching: async () => {}, enqueue: async () => {} } })
    await service.forget({ continuityId: 'c1', sceneId: 's1', userId: 'u1' }, { reason: 'personal_clear', requestedByUserId: 'u1' })
    assert.equal(db.collection(COLLECTIONS.memories).documents.find(item => item.memoryId === 'm-u1').status, 'deleted')
    assert.equal(db.collection(COLLECTIONS.memories).documents.find(item => item.memoryId === 'm-u2').status, 'active')
    assert.equal(db.collection(COLLECTIONS.relationships).documents[0].lifecycle, 'active')
    assert.equal(db.collection(COLLECTIONS.turns).documents.find(item => item.eventId === 't-u2').content, 'theirs')
})
