'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { FakeDb } = require('./fake_mongo')
const { COLLECTIONS } = require('../../chat/persistence/collections')
const { ChatRepository } = require('../../chat/persistence/repository')
const { JobQueue, JobWorker } = require('../../chat/persistence/jobs')
const { INFERENCE_JOB_TYPES, extractionJob, reconcileTurns } = require('../../chat/persistence/reconcile')
const { parseArgs, run } = require('../../scripts/chat/jobs.cjs')

function fixture() {
    const db = new FakeDb()
    let nextId = 0
    const jobs = new JobQueue({ db, id: () => `j${++nextId}` })
    const repository = new ChatRepository({ db })
    repository.isCanonicalTurn = async (_continuity, eventId) => eventId !== 'displaced'
    const turns = db.collection(COLLECTIONS.turns).documents
    return { db, jobs, repository, turns }
}

function turn(eventId, extra = {}) {
    return { eventId, continuityId: 'c1', sceneId: 's1', branchId: 'b1', lifecycle: 'finalized', updatedAt: new Date(0), deletionEpoch: 0, ...extra }
}

test('restart reconciliation does not backfill hundreds of finalized historical turns', async () => {
    const setup = fixture()
    setup.turns.push(...Array.from({ length: 500 }, (_, index) => turn(`t${index}`)))
    for (let restart = 0; restart < 3; restart++) {
        const result = await reconcileTurns(setup)
        assert.equal(result.scanned, 0)
        assert.equal(result.inserted, 0)
    }
    assert.equal(await setup.db.collection(COLLECTIONS.jobs).countDocuments({}), 0)
})

test('recovery queues once before finalizing interrupted commits; later restarts stay quiet', async () => {
    const setup = fixture()
    setup.turns.push(turn('interrupted', { lifecycle: 'committed', recoveryRequired: true }))
    const first = await reconcileTurns(setup)
    assert.equal(first.recovered, 1)
    assert.equal(first.inserted, 1)
    const job = await setup.jobs.claim(['extract_memory'])
    await setup.jobs.complete(job, { memories: [] })
    const next = await reconcileTurns(setup)
    assert.equal(next.inserted, 0)
    assert.equal(await setup.db.collection(COLLECTIONS.jobs).countDocuments({}), 1)
    const backfill = await reconcileTurns({ ...setup, backfillLimit: 25 })
    assert.equal(backfill.existing, 1)
    assert.equal(backfill.inserted, 0)
    assert.equal((await setup.db.collection(COLLECTIONS.jobs).findOne({ jobId: job.jobId })).state, 'completed')
})

test('explicit backfill is bounded and skips expired, displaced, and rejected sources', async () => {
    const setup = fixture()
    setup.turns.push(turn('expired', { retainedRaw: false }), turn('rejected', { responseRejected: true }),
        turn('displaced', { updatedAt: new Date(10) }), turn('eligible', { updatedAt: new Date(9) }),
        turn('older', { updatedAt: new Date(8) }))
    const result = await reconcileTurns({ ...setup, backfillLimit: 2 })
    assert.equal(result.scanned, 2)
    assert.equal(result.skipped, 1)
    assert.equal(result.inserted, 1)
    assert.equal((await setup.db.collection(COLLECTIONS.jobs).findOne({})).entityId, 'eligible')
})

test('dead and cancelled extraction jobs are never revived by a historical scan', async () => {
    const setup = fixture()
    setup.turns.push(turn('dead'), turn('cancelled'))
    for (const record of setup.turns) {
        await setup.jobs.enqueue(extractionJob(record))
        await setup.db.collection(COLLECTIONS.jobs).updateOne({ entityId: record.eventId }, { $set: { state: record.eventId } })
    }
    const result = await reconcileTurns({ ...setup, backfillLimit: 25 })
    assert.equal(result.inserted, 0)
    assert.equal(result.existing, 2)
    assert.equal(await setup.db.collection(COLLECTIONS.jobs).countDocuments({ state: 'queued' }), 0)
})

function workerFixture({ inferenceEnabled = true, canRunInference = () => true } = {}) {
    let now = 1000
    const pending = []
    const completed = []
    const failed = []
    const queue = {
        leaseMs: 60000,
        async claim(types) {
            const index = pending.findIndex(job => types.includes(job.type))
            return index < 0 ? null : pending.splice(index, 1)[0]
        },
        renew: async () => {},
        complete: async job => { completed.push(job); return true },
        fail: async job => { failed.push(job) }
    }
    const worker = new JobWorker({ queue, handlers: { extract_memory: async () => ({}), index_memory: async () => ({}) },
        inferenceTypes: INFERENCE_JOB_TYPES, inferenceEnabled, canRunInference, clock: () => now,
        inferenceStartupDelayMs: 60000, inferenceIntervalMs: 30000, inferenceErrorCooldownMs: 60000 })
    worker._schedule = () => {}
    worker.start()
    return { worker, pending, completed, failed, advance: ms => { now += ms } }
}

test('startup grace and pacing apply to pre-existing inference jobs while indexing keeps moving', async () => {
    const setup = workerFixture()
    setup.pending.push({ type: 'extract_memory' }, { type: 'extract_memory' }, { type: 'index_memory' })
    await setup.worker._tick()
    assert.equal(setup.completed[0].type, 'index_memory')
    setup.advance(59999)
    await setup.worker._tick()
    assert.equal(setup.completed.length, 1)
    setup.advance(1)
    await setup.worker._tick()
    assert.equal(setup.completed.length, 2)
    await setup.worker._tick()
    assert.equal(setup.completed.length, 2)
    setup.advance(30000)
    await setup.worker._tick()
    assert.equal(setup.completed.length, 3)
    await setup.worker.stop()
})

test('pausing inference retains backlog and an empty allowlist cannot claim arbitrary work', async () => {
    const setup = workerFixture({ inferenceEnabled: false })
    setup.pending.push({ type: 'extract_memory' }, { type: 'index_memory' })
    setup.advance(120000)
    await setup.worker._tick()
    assert.equal(setup.completed[0].type, 'index_memory')
    delete setup.worker.handlers.index_memory
    setup.worker.queue.claim = async () => { throw new Error('must not claim with empty allowlist') }
    await setup.worker._tick()
    assert.equal(setup.pending.length, 1)
    await setup.worker.stop()
})

test('foreground activity defers background inference without discarding jobs', async () => {
    let busy = true
    const setup = workerFixture({ canRunInference: () => !busy })
    setup.advance(60000)
    setup.pending.push({ type: 'extract_memory' })
    await setup.worker._tick()
    assert.equal(setup.completed.length, 0)
    busy = false
    await setup.worker._tick()
    assert.equal(setup.completed.length, 1)
    await setup.worker.stop()
})

test('one upstream failure cools down the entire inference backlog', async () => {
    const setup = workerFixture()
    setup.worker.handlers.extract_memory = async () => { throw new Error('upstream 500') }
    setup.advance(60000)
    setup.pending.push({ type: 'extract_memory' }, { type: 'extract_memory' }, { type: 'index_memory' })
    await setup.worker._tick()
    await setup.worker._tick()
    assert.equal(setup.failed.length, 1)
    assert.equal(setup.completed[0].type, 'index_memory')
    setup.advance(59999)
    await setup.worker._tick()
    assert.equal(setup.failed.length, 1)
    setup.advance(1)
    await setup.worker._tick()
    assert.equal(setup.failed.length, 2)
    await setup.worker.stop()
})

test('graceful stop waits for durable completion rather than just model output', async () => {
    const setup = workerFixture()
    let releaseCompletion
    let completionStarted
    const started = new Promise(resolve => { completionStarted = resolve })
    const barrier = new Promise(resolve => { releaseCompletion = resolve })
    setup.worker.queue.complete = async () => { completionStarted(); await barrier; return true }
    setup.pending.push({ type: 'index_memory' })
    const tick = setup.worker._tick()
    await started
    let stopped = false
    const stop = setup.worker.stop().then(() => { stopped = true })
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(stopped, false)
    releaseCompletion()
    await Promise.all([tick, stop])
    assert.equal(stopped, true)
})

test('failed jobs back off across restarts and completed markers survive another enqueue', async () => {
    const db = new FakeDb()
    let now = new Date(0)
    const queue = new JobQueue({ db, clock: () => now })
    const input = { type: 'extract_memory', idempotencyKey: 'extract:t1:v1' }
    assert.equal(await queue.enqueueMissing(input), true)
    const job = await queue.claim(['extract_memory'])
    await queue.fail(job, Object.assign(new Error('unavailable'), { retryAfterMs: 120000 }))
    now = new Date(30000)
    assert.equal(await new JobQueue({ db, clock: () => now }).claim(['extract_memory']), null)
    now = new Date(120000)
    const retry = await queue.claim(['extract_memory'])
    await queue.complete(retry, { memories: [] })
    assert.equal(await queue.enqueueMissing(input), false)
    assert.equal(await queue.claim(['extract_memory']), null)
})

test('queue CLI retries a bounded selection of dead jobs only', async () => {
    const setup = fixture()
    for (const [index, state] of ['dead', 'dead', 'running', 'completed', 'cancelled'].entries()) {
        await setup.jobs.enqueue({ type: 'extract_memory', idempotencyKey: `key${index}` })
        await setup.db.collection(COLLECTIONS.jobs).updateOne({ idempotencyKey: `key${index}` }, { $set: { state, attempts: 3 } })
    }
    const result = await run({ db: setup.db, command: 'retry', type: 'extract_memory', limit: 1 })
    assert.equal(result.retried, 1)
    assert.equal(await setup.db.collection(COLLECTIONS.jobs).countDocuments({ state: 'dead' }), 1)
    assert.equal(await setup.db.collection(COLLECTIONS.jobs).countDocuments({ state: 'completed' }), 1)
    assert.equal(await setup.db.collection(COLLECTIONS.jobs).countDocuments({ state: 'cancelled' }), 1)
    assert.equal(await setup.db.collection(COLLECTIONS.jobs).countDocuments({ state: 'running' }), 1)
    assert.throws(() => parseArgs(['backfill', '--limit', '0']), /--limit/)
    assert.throws(() => parseArgs(['retry', '--type', 'anything']), /--type/)
})
