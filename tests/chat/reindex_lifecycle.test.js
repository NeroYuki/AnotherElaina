'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { FakeCollection, FakeDb } = require('./fake_mongo')
const { COLLECTIONS } = require('../../chat/persistence/collections')
const { LeaseLostError } = require('../../chat/persistence/leases')
const { ReindexLifecycleStore } = require('../../chat/persistence/reindex_lifecycle')
const { ChatRepository } = require('../../chat/persistence/repository')
const { Reindexer } = require('../../chat/retrieval/ingest')
const { QdrantVectorIndex } = require('../../chat/retrieval/vector_index')

const BASE = 'chat_model_revision_384_cosine'

function createVectorIndex(options = {}) {
    const collections = new Map()
    const aliases = new Map(options.aliases || [['chat_active', BASE]])
    for (const collection of collections.keys()) collections.set(collection, 0)
    for (const collection of aliases.values()) if (!collections.has(collection)) collections.set(collection, 0)
    const deleted = []
    const deleteFailures = new Set(options.deleteFailures || [])
    const index = {
        url: options.url || 'http://qdrant.test:6333',
        alias: options.alias || 'chat_active',
        collection: options.base || BASE,
        collections,
        aliases,
        deleted,
        failDelete(collection) { deleteFailures.add(collection) },
        allowDelete(collection) { deleteFailures.delete(collection) },
        async ensureCollection(name) {
            if (!collections.has(name)) collections.set(name, 0)
            return name
        },
        async upsert(records, upsertOptions = {}) {
            const name = upsertOptions.collection
            collections.set(name, (collections.get(name) || 0) + records.length)
            if (options.onUpsert) await options.onUpsert(name)
            return records.length
        },
        async count(name) {
            if (options.onCount) await options.onCount(name)
            return options.count ? options.count(name) : (collections.get(name) || 0)
        },
        async listAliases() {
            if (options.onListAliases) await options.onListAliases()
            return [...aliases].map(([alias, collection]) => ({ alias, collection }))
        },
        async switchAlias(name) {
            if (options.switchAlias) return options.switchAlias({ name, aliases, index })
            aliases.set(index.alias, name)
        },
        async deleteCollection(name) {
            if (deleteFailures.has(name)) {
                throw Object.assign(new Error(`delete failed: ${name}`), { code: 'CHAT_TEST_DELETE_FAILED' })
            }
            if (options.onDelete) await options.onDelete(name)
            deleted.push(name)
            collections.delete(name)
        }
    }
    return index
}

function createReindexer({ db, vectorIndex, clock, leaseMs, uniqueSuffix, repository, lifecycleStore, embedder }) {
    return new Reindexer({
        repository: repository || new ChatRepository({ db, clock }),
        embedder: embedder || { embedPassages: async texts => texts.map(() => Array(3).fill(0)) },
        vectorIndex,
        clock,
        leaseMs,
        heartbeatMs: leaseMs ? Math.max(1000, leaseMs) : undefined,
        uniqueSuffix,
        lifecycleStore
    })
}

test('sequential rebuilds retain the active build plus one previous alias target', async () => {
    const db = new FakeDb()
    const index = createVectorIndex()
    let now = new Date('2026-01-01T00:00:00Z')
    let suffix = 0
    const clock = () => now
    const run = () => createReindexer({
        db,
        vectorIndex: index,
        clock,
        leaseMs: 60000,
        uniqueSuffix: () => `unique${++suffix}`
    }).run()

    const results = []
    for (let offset = 1; offset <= 4; offset += 1) {
        now = new Date(now.getTime() + 1000)
        results.push(await run())
    }

    assert.equal(index.aliases.get('chat_active'), results[3].collection)
    assert.ok(index.collections.has(results[3].collection))
    assert.ok(index.collections.has(results[2].collection), 'one rollback build is retained')
    assert.equal(index.collections.has(results[0].collection), false, 'the oldest build is deleted')
    assert.equal(index.collections.has(results[1].collection), false, 'builds older than the rollback are deleted')
    assert.ok(index.collections.has(BASE), 'the original base collection is never deleted')
    assert.deepEqual(results[2].cleanup.deleted, [results[0].collection])
    assert.deepEqual(results[3].cleanup.deleted, [results[1].collection])
    assert.deepEqual(results[3].cleanup.pending, [])

    const state = await db.collection(COLLECTIONS.reindex).findOne({})
    assert.equal(state.build, null)
    assert.deepEqual(state.history.map(entry => entry.role), ['rollback', 'active'])
})

test('failed indexing and count verification remove the unaliased new build', async () => {
    const db = new FakeDb()
    db.collection(COLLECTIONS.memories).documents.push({
        memoryId: 'm1',
        statement: 'The umbrella is green.',
        status: 'active',
        deletionEpoch: 0,
        scope: { guildId: 'g1', continuityId: 'c1', audienceUserIds: [] }
    })
    const index = createVectorIndex()
    const clock = () => new Date('2026-01-01T00:00:00Z')
    const failingEmbedder = { embedPassages: async () => { throw new Error('embedding failed') } }

    await assert.rejects(createReindexer({ db, vectorIndex: index, clock, leaseMs: 60000, embedder: failingEmbedder }).run(), /embedding failed/)
    assert.deepEqual([...index.collections.keys()], [BASE], 'only the base collection remains after an indexing failure')
    let state = await db.collection(COLLECTIONS.reindex).findOne({})
    assert.equal(state.build, null)
    assert.deepEqual(state.pendingDeletions, [])

    const mismatch = createVectorIndex({ count: () => 99 })
    await assert.rejects(createReindexer({ db, vectorIndex: mismatch, clock, leaseMs: 60000 }).run(), /verification failed/)
    assert.deepEqual([...mismatch.collections.keys()], [BASE], 'count mismatch cleans the new build')
    state = await db.collection(COLLECTIONS.reindex).findOne({})
    assert.deepEqual(state.pendingDeletions, [])
})

test('a failed-build deletion is queued and retried by the next run', async () => {
    const db = new FakeDb()
    db.collection(COLLECTIONS.memories).documents.push({
        memoryId: 'm1',
        statement: 'The umbrella is green.',
        status: 'active',
        deletionEpoch: 0,
        scope: { guildId: 'g1', continuityId: 'c1', audienceUserIds: [] }
    })
    const index = createVectorIndex()
    const clock = () => new Date('2026-01-01T00:00:00Z')
    const failedCollection = `${BASE}_build_1767225600000_retry`
    index.failDelete(failedCollection)
    const failingEmbedder = { embedPassages: async () => { throw new Error('embedding failed') } }

    await assert.rejects(
        createReindexer({
            db,
            vectorIndex: index,
            clock,
            leaseMs: 60000,
            uniqueSuffix: () => 'retry',
            embedder: failingEmbedder
        }).run(),
        error => /embedding failed/.test(error.message)
            && error.cleanup.pending.some(entry => entry.collection === failedCollection)
    )
    assert.ok(index.collections.has(failedCollection))
    let state = await db.collection(COLLECTIONS.reindex).findOne({})
    assert.deepEqual(state.pendingDeletions.map(entry => entry.collection), [failedCollection])

    index.allowDelete(failedCollection)
    const next = await createReindexer({
        db,
        vectorIndex: index,
        clock,
        leaseMs: 60000,
        uniqueSuffix: () => 'next'
    }).run()
    assert.ok(next.cleanup.deleted.includes(failedCollection))
    assert.equal(index.collections.has(failedCollection), false)
    state = await db.collection(COLLECTIONS.reindex).findOne({})
    assert.deepEqual(state.pendingDeletions, [])
})

test('aliased collections, explicit collections, and successful noSwitch builds are preserved', async () => {
    const db = new FakeDb()
    const index = createVectorIndex()
    let now = new Date('2026-01-01T00:00:00Z')
    let suffix = 0
    const clock = () => now
    const run = options => createReindexer({
        db,
        vectorIndex: index,
        clock,
        leaseMs: 60000,
        uniqueSuffix: () => `keep${++suffix}`
    }).run(options)

    const first = await run()
    const second = await run()
    assert.ok(index.collections.has(first.collection))

    index.aliases.set('chat_shadow', first.collection)
    now = new Date(now.getTime() + 1000)
    const third = await run()
    assert.ok(index.collections.has(first.collection), 'a collection protected by another alias is not deleted')
    assert.equal(third.cleanup.pending.find(entry => entry.collection === first.collection)?.reason, 'aliased')

    index.aliases.delete('chat_shadow')
    now = new Date(now.getTime() + 1000)
    const fourth = await run()
    assert.equal(index.collections.has(first.collection), false, 'the deferred deletion is retried later')
    assert.equal(index.collections.has(second.collection), false)
    assert.ok(index.collections.has(third.collection))

    const custom = await run({ collection: 'custom_explicit_build' })
    assert.equal(custom.collection, 'custom_explicit_build')
    assert.equal(custom.aliasSwitched, true)
    assert.ok(index.collections.has(fourth.collection), 'the previous owned alias target remains as rollback')

    const manual = await run({ noSwitch: true })
    assert.equal(manual.aliasSwitched, false)
    assert.ok(index.collections.has(manual.collection))

    now = new Date(now.getTime() + 1000)
    await run()
    now = new Date(now.getTime() + 1000)
    await run()
    assert.ok(index.collections.has('custom_explicit_build'), 'explicit collections are never auto-deleted')
    assert.ok(index.collections.has(manual.collection), 'noSwitch builds are not swept by later rebuilds')
})

test('reindex refuses a busy lease and never deletes after lease loss', async () => {
    const db = new FakeDb()
    const index = createVectorIndex()
    let now = new Date('2026-01-01T00:00:00Z')
    const clock = () => now
    const store = new ReindexLifecycleStore({ db, url: index.url, alias: index.alias, clock, durationMs: 60000 })
    const held = await store.acquire()
    assert.ok(held)

    await assert.rejects(
        createReindexer({ db, vectorIndex: index, clock, leaseMs: 60000 }).run(),
        error => error.code === 'CHAT_LEASE_LOST' && /already running/.test(error.message)
    )
    assert.deepEqual([...index.collections.keys()], [BASE])
    await store.release(held)

    const lossDb = new FakeDb()
    const lossIndex = createVectorIndex({
        onCount: async () => { now = new Date(now.getTime() + 5000) }
    })
    await assert.rejects(
        createReindexer({ db: lossDb, vectorIndex: lossIndex, clock, leaseMs: 1000 }).run(),
        error => error.code === 'CHAT_LEASE_LOST'
    )
    assert.equal(lossIndex.aliases.get('chat_active'), BASE, 'the alias is not published after lease loss')
    assert.deepEqual(lossIndex.deleted, [], 'nothing is deleted after lease loss')
    assert.equal([...lossIndex.collections.keys()].filter(name => name !== BASE).length, 1)
})

test('cleanup failures after a successful publish are reported and retried', async () => {
    const db = new FakeDb()
    const index = createVectorIndex()
    let now = new Date('2026-01-01T00:00:00Z')
    let suffix = 0
    const clock = () => now
    const run = () => createReindexer({
        db,
        vectorIndex: index,
        clock,
        leaseMs: 60000,
        uniqueSuffix: () => `cleanup${++suffix}`
    }).run()

    const first = await run()
    const second = await run()
    index.failDelete(first.collection)
    now = new Date(now.getTime() + 1000)
    const third = await run()

    assert.equal(third.aliasSwitched, true)
    assert.ok(index.collections.has(first.collection), 'the failed deletion keeps the collection')
    assert.ok(third.cleanup.warnings.some(warning => warning.code === 'CLEANUP_DELETE_FAILED' && warning.collection === first.collection))
    assert.deepEqual(third.cleanup.pending.map(entry => entry.collection), [first.collection])
    let state = await db.collection(COLLECTIONS.reindex).findOne({})
    assert.deepEqual(state.pendingDeletions.map(entry => entry.collection), [first.collection])

    index.allowDelete(first.collection)
    now = new Date(now.getTime() + 1000)
    const fourth = await run()
    assert.equal(fourth.aliasSwitched, true)
    assert.equal(index.collections.has(first.collection), false, 'pending cleanup is retried')
    assert.equal(index.collections.has(second.collection), false)
    assert.deepEqual(fourth.cleanup.pending, [])
    state = await db.collection(COLLECTIONS.reindex).findOne({})
    assert.deepEqual(state.pendingDeletions, [])
})

test('ambiguous publication re-reads aliases before deciding whether to delete', async () => {
    const publishedDb = new FakeDb()
    const publishedIndex = createVectorIndex({
        switchAlias: async ({ name, aliases, index }) => {
            aliases.set(index.alias, name)
            throw Object.assign(new Error('connection reset after alias update'), { code: 'CHAT_QDRANT_ERROR' })
        }
    })
    const clock = () => new Date('2026-01-01T00:00:00Z')
    const published = await createReindexer({ db: publishedDb, vectorIndex: publishedIndex, clock, leaseMs: 60000 }).run()
    assert.ok(publishedIndex.collections.has(published.collection))
    assert.equal(publishedIndex.aliases.get('chat_active'), published.collection)
    assert.ok(published.cleanup.warnings.some(warning => warning.code === 'ALIAS_PUBLISH_AMBIGUOUS'))
    assert.deepEqual(published.cleanup.deleted, [])

    const failedDb = new FakeDb()
    const failedIndex = createVectorIndex({
        switchAlias: async () => { throw Object.assign(new Error('alias update rejected'), { code: 'CHAT_QDRANT_ERROR' }) }
    })
    await assert.rejects(
        createReindexer({ db: failedDb, vectorIndex: failedIndex, clock, leaseMs: 60000 }).run(),
        /alias update rejected/
    )
    assert.equal(failedIndex.aliases.get('chat_active'), BASE)
    assert.deepEqual([...failedIndex.collections.keys()], [BASE], 'an unpublished build is cleaned up')

    const unverifiableDb = new FakeDb()
    let listCalls = 0
    const unverifiableIndex = createVectorIndex({
        onListAliases: async () => {
            listCalls += 1
            if (listCalls > 1) throw Object.assign(new Error('aliases unavailable'), { code: 'CHAT_QDRANT_ERROR' })
        },
        switchAlias: async () => { throw Object.assign(new Error('alias update ambiguous'), { code: 'CHAT_QDRANT_ERROR' }) }
    })
    await assert.rejects(
        createReindexer({ db: unverifiableDb, vectorIndex: unverifiableIndex, clock, leaseMs: 60000 }).run(),
        /alias update ambiguous/
    )
    assert.equal([...unverifiableIndex.collections.keys()].filter(name => name !== BASE).length, 1)
    const state = await unverifiableDb.collection(COLLECTIONS.reindex).findOne({})
    assert.equal(state.pendingDeletions.length, 1)
    assert.equal(state.pendingDeletions[0].reason, 'ambiguous_publish')
})

test('generated collection names stay unique within the same millisecond', async () => {
    const db = new FakeDb()
    const index = createVectorIndex()
    const clock = () => new Date('2026-01-01T00:00:00Z')
    const make = suffix => createReindexer({
        db,
        vectorIndex: index,
        clock,
        leaseMs: 60000,
        uniqueSuffix: () => suffix
    }).run({ noSwitch: true })

    const first = await make('alpha')
    const second = await make('beta')
    assert.notEqual(first.collection, second.collection)
    assert.match(first.collection, /_build_1767225600000_alpha$/)
    assert.match(second.collection, /_build_1767225600000_beta$/)
    assert.ok(index.collections.has(first.collection))
    assert.ok(index.collections.has(second.collection))
})

test('reindex lifecycle leases are fenced, renewable, and released', async () => {
    const db = new FakeDb()
    let now = new Date('2026-01-01T00:00:00Z')
    const clock = () => now
    const first = new ReindexLifecycleStore({ db, url: 'http://qdrant.test:6333/', alias: 'chat_active', clock, ownerId: 'a', durationMs: 1000 })
    const second = new ReindexLifecycleStore({ db, url: 'http://QDRANT.test:6333', alias: 'chat_active', clock, ownerId: 'b', durationMs: 1000 })

    const lease = await first.acquire()
    assert.equal(lease.fencingToken, 1)
    assert.equal(await second.acquire(), null, 'a busy lease fails closed')
    now = new Date(now.getTime() + 400)
    await first.renew(lease)
    assert.ok(await first.assertValid(lease))

    now = new Date(now.getTime() + 1001)
    await assert.rejects(first.renew(lease), LeaseLostError)
    await assert.rejects(first.assertValid(lease), LeaseLostError)
    const replacement = await second.acquire()
    assert.equal(replacement.fencingToken, 2)
    assert.equal(await first.release(lease), false)
    assert.equal(await second.release(replacement), true)
    const state = await first.get()
    assert.equal(state.lease, undefined)
    assert.equal(state._id, first.key)
})

test('a build published by a crashed run is retained as the rollback', async () => {
    const db = new FakeDb()
    const index = createVectorIndex()
    const crashed = `${BASE}_build_1700000000000_crashed`
    index.collections.set(crashed, 0)
    index.aliases.set('chat_active', crashed)
    let now = new Date('2026-01-01T00:00:00Z')
    let suffix = 0
    const clock = () => now
    const seed = new ReindexLifecycleStore({ db, url: index.url, alias: index.alias, clock, ownerId: 'crashed-run', durationMs: 60000 })
    db.collection(COLLECTIONS.reindex).documents.push({
        _id: seed.key,
        schemaVersion: 1,
        qdrantUrl: seed.url,
        alias: seed.alias,
        build: { collection: crashed, ownerId: 'dead-owner', fencingToken: 1, startedAt: new Date('2026-01-01T00:00:00Z') },
        history: [],
        pendingDeletions: [],
        createdAt: new Date('2026-01-01T00:00:00Z')
    })
    const run = () => createReindexer({
        db,
        vectorIndex: index,
        clock,
        leaseMs: 60000,
        uniqueSuffix: () => `recovered${++suffix}`
    }).run()

    const first = await run()
    assert.ok(index.collections.has(crashed), 'the previously published build remains as rollback')
    assert.equal(first.cleanup.deleted.length, 0)
    let state = await db.collection(COLLECTIONS.reindex).findOne({})
    assert.deepEqual(state.history.map(entry => entry.role), ['rollback', 'active'])
    assert.deepEqual(state.pendingDeletions, [])

    now = new Date(now.getTime() + 1000)
    await run()
    assert.equal(index.collections.has(crashed), false, 'the crashed build is deleted once it is older than the rollback')
})

test('lease acquisition survives a duplicate-key race on the conditional upsert', async () => {
    class RacingCollection extends FakeCollection {
        constructor() {
            super()
            this.firstFind = true
            this.duplicate = true
        }
        async findOne(query, options) {
            if (this.firstFind) {
                this.firstFind = false
                return null
            }
            return super.findOne(query, options)
        }
        async findOneAndUpdate(query, update, options = {}) {
            if (options.upsert && this.duplicate) {
                this.duplicate = false
                this.documents.push({
                    _id: query._id,
                    qdrantUrl: 'http://qdrant.test:6333',
                    alias: 'chat_active',
                    fencingToken: 1,
                    lease: { ownerId: 'other', expiresAt: new Date(0) },
                    history: [],
                    pendingDeletions: [],
                    build: null
                })
                throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
            }
            return super.findOneAndUpdate(query, update, options)
        }
    }
    const db = new FakeDb()
    const collection = new RacingCollection()
    db.collections.set(COLLECTIONS.reindex, collection)
    const store = new ReindexLifecycleStore({
        db,
        url: 'http://qdrant.test:6333',
        alias: 'chat_active',
        clock: () => new Date('2026-01-01T00:00:00Z'),
        ownerId: 'racer',
        durationMs: 1000
    })
    const lease = await store.acquire()
    assert.ok(lease)
    assert.equal(lease.fencingToken, 2)
    assert.equal(collection.documents.length, 1)
})

test('Qdrant adapter lists aliases and treats a missing collection delete as success', async () => {
    const requests = []
    const index = new QdrantVectorIndex({
        url: 'http://qdrant.test:6333',
        model: 'model',
        revision: 'r'.repeat(40),
        dimension: 3,
        fetch: async (url, init = {}) => {
            requests.push({ url, init })
            if (url.endsWith('/aliases')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ result: { aliases: [{ alias_name: 'chat_active', collection_name: 'active_build' }] } })
                }
            }
            return { ok: false, status: 404, json: async () => ({ status: { error: 'Not found' } }) }
        }
    })

    assert.deepEqual(await index.listAliases(), [{ alias: 'chat_active', collection: 'active_build' }])
    assert.equal(await index.deleteCollection('already_gone'), true)
    assert.equal(requests[1].init.method, 'DELETE')
    assert.ok(requests[1].url.endsWith('/collections/already_gone'))
})

test('Qdrant requests are bounded and preserve caller aborts', async () => {
    const never = async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
    const timeoutIndex = new QdrantVectorIndex({
        url: 'http://qdrant.test:6333', model: 'model', revision: 'r'.repeat(40), dimension: 3, fetch: never, timeoutMs: 20
    })
    await assert.rejects(timeoutIndex.health(), error => error.code === 'CHAT_QDRANT_TIMEOUT')

    const controller = new AbortController()
    const external = new QdrantVectorIndex({
        url: 'http://qdrant.test:6333', model: 'model', revision: 'r'.repeat(40), dimension: 3, fetch: never, timeoutMs: 5000
    })
    setTimeout(() => controller.abort(), 5)
    await assert.rejects(external.request('/collections', { signal: controller.signal }), /aborted/)
})

test('invalid alias responses fail closed before cleanup', async () => {
    for (const result of [null, {}, { aliases: null }, { aliases: [null] }, { aliases: [{}] }]) {
        const index = new QdrantVectorIndex({
            url: 'http://qdrant.test:6333', model: 'm', revision: 'r',
            fetch: async () => ({ ok: true, json: async () => ({ result }) })
        })
        await assert.rejects(index.listAliases(), { code: 'CHAT_QDRANT_INVALID_RESPONSE' })
    }
    const invalidJson = new QdrantVectorIndex({
        url: 'http://qdrant.test:6333', model: 'm', revision: 'r',
        fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('truncated JSON') } })
    })
    await assert.rejects(invalidJson.listAliases(), { code: 'CHAT_QDRANT_INVALID_RESPONSE' })
})

test('released reindex leases preserve a monotonically increasing fence', async () => {
    const db = new FakeDb()
    const store = new ReindexLifecycleStore({ db, url: 'http://qdrant.test:6333', alias: 'chat_active' })
    const first = await store.acquire()
    await store.release(first)
    const second = await store.acquire()
    assert.equal(second.fencingToken, first.fencingToken + 1)
    await assert.rejects(store.renew(first), { code: 'CHAT_LEASE_LOST' })
    assert.equal(await store.release(first), false)
    await store.assertValid(second)
    await store.release(second)
})

test('explicit reuse permanently protects a previously owned build', async () => {
    const db = new FakeDb()
    const index = createVectorIndex()
    let suffix = 0
    const run = options => createReindexer({ db, vectorIndex: index, uniqueSuffix: () => `explicit${++suffix}` }).run(options)
    const first = await run()
    await run({ collection: first.collection, noSwitch: true })
    await run()
    await run()
    await run()
    assert.ok(index.collections.has(first.collection))
    assert.ok(!index.deleted.includes(first.collection))
    const state = await db.collection(COLLECTIONS.reindex).findOne({})
    const explicit = state.history.find(entry => entry.collection === first.collection)
    assert.equal(explicit.role, 'manual')
    assert.equal(explicit.owned, false)
})

test('cleanup refreshes every alias before each candidate deletion', async () => {
    const db = new FakeDb()
    const first = `${BASE}_build_1_first`
    const second = `${BASE}_build_2_second`
    let index
    index = createVectorIndex({ onDelete: async name => {
        if (name === first) index.aliases.set('new_external_alias', second)
    } })
    index.collections.set(first, 0)
    index.collections.set(second, 0)
    const lifecycle = new ReindexLifecycleStore({ db, url: index.url, alias: index.alias })
    db.collection(COLLECTIONS.reindex).documents.push({
        _id: lifecycle.key, qdrantUrl: lifecycle.url, alias: lifecycle.alias,
        history: [], build: null,
        pendingDeletions: [{ collection: first }, { collection: second }]
    })
    const result = await createReindexer({ db, vectorIndex: index }).run()
    assert.ok(result.cleanup.deleted.includes(first))
    assert.ok(index.collections.has(second))
    assert.ok(!index.deleted.includes(second))
    assert.ok(result.cleanup.pending.some(entry => entry.collection === second))
})

test('a transient previous-alias read failure still tracks the published build', async () => {
    const db = new FakeDb()
    let reads = 0
    let suffix = 0
    const index = createVectorIndex({ onListAliases: async () => {
        if (++reads === 1) throw new Error('temporary alias read failure')
    } })
    const run = () => createReindexer({ db, vectorIndex: index, uniqueSuffix: () => `read${++suffix}` }).run()
    const first = await run()
    let state = await db.collection(COLLECTIONS.reindex).findOne({})
    assert.ok(state.history.some(entry => entry.collection === first.collection && entry.owned))
    await run()
    await run()
    assert.ok(index.deleted.includes(first.collection))
})

test('a metadata failure after publish reports cleanup trouble without retrying the publish', async () => {
    const db = new FakeDb()
    const index = createVectorIndex()
    const store = new ReindexLifecycleStore({ db, url: index.url, alias: index.alias })
    const update = store.update.bind(store)
    let failed = false
    store.update = async (lease, patch) => {
        if (!failed && patch.$set.build === null && index.aliases.get(index.alias) !== BASE) {
            failed = true
            throw new Error('temporary metadata write failure')
        }
        return update(lease, patch)
    }
    const result = await createReindexer({ db, vectorIndex: index, lifecycleStore: store }).run()
    assert.equal(result.aliasSwitched, true)
    assert.equal(index.aliases.get(index.alias), result.collection)
    assert.ok(index.collections.has(result.collection))
    assert.ok(result.cleanup.warnings.some(warning => warning.code === 'POST_PUBLISH_CLEANUP_FAILED'))
    const next = await createReindexer({ db, vectorIndex: index }).run()
    assert.equal(next.aliasSwitched, true)
    assert.ok(index.collections.has(result.collection), 'the published build is recovered as the rollback')
})


test('unreadable previous alias defers pending cleanup for that publish', async () => {
    const db = new FakeDb()
    let reads = 0
    const index = createVectorIndex({ onListAliases: async () => {
        if (++reads <= 2) throw new Error('previous alias unavailable')
    } })
    const candidate = `${BASE}_build_1_pending`
    index.collections.set(candidate, 0)
    const store = new ReindexLifecycleStore({ db, url: index.url, alias: index.alias })
    db.collection(COLLECTIONS.reindex).documents.push({
        _id: store.key, qdrantUrl: store.url, alias: store.alias,
        history: [], build: null, pendingDeletions: [{ collection: candidate }]
    })
    const result = await createReindexer({ db, vectorIndex: index }).run()
    assert.equal(result.aliasSwitched, true)
    assert.ok(index.collections.has(candidate))
    assert.ok(result.cleanup.pending.some(entry => entry.collection === candidate))
    assert.ok(result.cleanup.warnings.some(entry => entry.code === 'ALIAS_READ_FAILED'))
})
