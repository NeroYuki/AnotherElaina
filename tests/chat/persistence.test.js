'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { FakeDb } = require('./fake_mongo')
const { COLLECTIONS, INDEXES, ensureCollectionsAndIndexes } = require('../../chat/persistence/collections')
const { ContinuityLeases, LeaseLostError } = require('../../chat/persistence/leases')
const { ChatRepository } = require('../../chat/persistence/repository')
const { JobQueue } = require('../../chat/persistence/jobs')

test('all chat collections get additive named indexes', async () => {
    const db = new FakeDb()
    const result = await ensureCollectionsAndIndexes(db)
    assert.equal(result.length, Object.keys(COLLECTIONS).length)
    assert.ok(INDEXES.chat_memories.some(index => index.name === 'memory_lexical' && index.default_language === 'none'))
    assert.ok(INDEXES.chat_jobs.some(index => index.unique && index.name === 'job_idempotency_unique'))
})

test('continuity leases fence expired workers', async () => {
    const db = new FakeDb()
    let now = new Date('2026-01-01T00:00:00Z')
    db.collection(COLLECTIONS.continuities).documents.push({ continuityId: 'c1', status: 'active', revision: 0, deletionEpoch: 0 })
    const first = new ContinuityLeases({ db, ownerId: 'worker-a', durationMs: 1000, clock: () => now })
    const second = new ContinuityLeases({ db, ownerId: 'worker-b', durationMs: 1000, clock: () => now })
    const leaseA = await first.acquire('c1')
    assert.equal(leaseA.fencingToken, 1)
    assert.equal(await second.acquire('c1'), null)
    now = new Date(now.getTime() + 1001)
    const leaseB = await second.acquire('c1')
    assert.equal(leaseB.fencingToken, 2)
    await assert.rejects(first.renew(leaseA), LeaseLostError)
    assert.equal(await first.release(leaseA), false)
})

test('canonical pointer commit is a fenced compare-and-swap', async () => {
    const db = new FakeDb()
    let now = new Date('2026-01-01T00:00:00Z')
    const repository = new ChatRepository({ db, clock: () => now, id: () => 'generated' })
    await repository.createContinuity({ continuityId: 'c1', guildId: 'g1', ownerUserId: 'u1' })
    const leases = new ContinuityLeases({ db, ownerId: 'worker', durationMs: 5000, clock: () => now })
    const lease = await leases.acquire('c1')
    await repository.insertPendingTurn({
        eventId: 't1', continuityId: 'c1', sceneId: 's1', branchId: 'b1', ordinal: 1,
        parentEventId: null, eventType: 'dialogue', role: 'user', contentParts: [{ type: 'text', text: 'hello' }], deletionEpoch: 0
    })
    const committed = await repository.commitTurn({ continuityId: 'c1', eventId: 't1', parentEventId: null, expectedRevision: 0, expectedEpoch: 0, lease })
    assert.deepEqual(committed, { committed: true, revision: 1 })
    const duplicate = await repository.commitTurn({ continuityId: 'c1', eventId: 't1', parentEventId: null, expectedRevision: 0, expectedEpoch: 0, lease })
    assert.equal(duplicate.committed, false)
    assert.equal(await repository.isCanonicalTurn('c1', 't1'), true)
})

test('redacted event markers preserve ancestry but are not eligible memory sources', async () => {
    const db = new FakeDb()
    const repository = new ChatRepository({ db })
    db.collection(COLLECTIONS.continuities).documents.push({ continuityId: 'c1', status: 'active', committedEventId: 't3' })
    db.collection(COLLECTIONS.turns).documents.push(
        { continuityId: 'c1', eventId: 't1', parentEventId: null, lifecycle: 'finalized' },
        { continuityId: 'c1', eventId: 't2', parentEventId: 't1', lifecycle: 'deleted' },
        { continuityId: 'c1', eventId: 't3', parentEventId: 't2', lifecycle: 'finalized' }
    )
    assert.equal(await repository.isCanonicalTurn('c1', 't1'), true)
    assert.equal(await repository.isCanonicalTurn('c1', 't2'), false)
    assert.equal(await repository.isCanonicalTurn('c1', 't2', { includeDeleted: true }), true)
})

test('jobs are idempotent and completion requires the claim fencing token', async () => {
    const db = new FakeDb()
    const now = new Date('2026-01-01T00:00:00Z')
    const queue = new JobQueue({ db, workerId: 'worker', clock: () => now, id: () => 'job-1' })
    const first = await queue.enqueue({ type: 'extract', idempotencyKey: 'extract:t1:0', expectedEpoch: 0 })
    const second = await queue.enqueue({ type: 'extract', idempotencyKey: 'extract:t1:0', expectedEpoch: 0 })
    assert.equal(first.jobId, second.jobId)
    const claimed = await queue.claim(['extract'])
    assert.equal(claimed.state, 'running')
    assert.equal(claimed.attempts, 1)
    assert.equal(await queue.complete(claimed, { count: 1 }), true)
    assert.equal(await queue.complete(claimed, { count: 2 }), false)
})
