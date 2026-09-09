'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { E5Embedder } = require('../../chat/retrieval/embed_worker')
const { pointId, scopeFilter, QdrantVectorIndex } = require('../../chat/retrieval/vector_index')
const { normalizedTerms } = require('../../chat/retrieval/lexical')
const { reciprocalRankFusion, selectDiverse } = require('../../chat/retrieval/rank')
const { HybridRetriever } = require('../../chat/retrieval/retrieval')
const { chunkText, contentHash, validateLocalPath } = require('../../chat/retrieval/ingest')
const { LoreIngestor } = require('../../chat/retrieval/ingest')
const { ChatRepository } = require('../../chat/persistence/repository')
const { FakeDb } = require('./fake_mongo')

test('E5 adapter disables remote loading and applies query/passage prefixes', async () => {
    const seen = []
    const module = {
        env: {},
        pipeline: async (_task, _model, options) => {
            assert.equal(options.local_files_only, true)
            const extractor = async inputs => {
                seen.push(...inputs)
                return { tolist: () => inputs.map(() => Array(384).fill(1 / Math.sqrt(384))) }
            }
            extractor.tokenizer = () => {}
            return extractor
        }
    }
    const embedder = new E5Embedder({ moduleLoader: () => module, cacheDir: 'cache' })
    await embedder.embedQueries(['umbrella color'])
    await embedder.embedPassages(['The umbrella is green.'])
    assert.equal(module.env.allowRemoteModels, false)
    assert.deepEqual(seen, ['query: umbrella color', 'passage: The umbrella is green.'])
})

test('E5 adapter loads an available pinned revision directory directly', async () => {
    const fs = require('node:fs')
    const os = require('node:os')
    const path = require('node:path')
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elaina-e5-'))
    const revision = 'a'.repeat(40)
    const pinned = path.join(cacheDir, 'Xenova', 'multilingual-e5-small', revision)
    fs.mkdirSync(pinned, { recursive: true })
    fs.writeFileSync(path.join(pinned, 'config.json'), '{}')
    let source
    const extractor = Object.assign(async inputs => ({ tolist: () => inputs.map(() => Array(384).fill(0)) }), { tokenizer: () => {} })
    const embedder = new E5Embedder({
        cacheDir, revision,
        moduleLoader: () => ({ env: {}, pipeline: async (_task, modelSource) => { source = modelSource; return extractor } })
    })

    await embedder.embedQueries(['test'])

    assert.equal(source, pinned)
})

test('Qdrant IDs and scope filters are deterministic and scoped before search', async () => {
    assert.equal(pointId('memory-1'), pointId('memory-1'))
    assert.match(pointId('memory-1'), /^[0-9a-f-]{36}$/)
    const filter = scopeFilter({ guildId: 'g1', continuityId: 'c1', userId: 'u1', deletionEpoch: 3, corpora: ['memory'] })
    assert.ok(filter.must.some(item => item.key === 'deletionEpoch'))
    assert.ok(JSON.stringify(filter).includes('continuityId'))

    let requestBody
    const index = new QdrantVectorIndex({
        url: 'http://127.0.0.1:6333', model: 'model', revision: 'a'.repeat(40), dimension: 3,
        fetch: async (_url, init) => {
            requestBody = JSON.parse(init.body)
            return { ok: true, json: async () => ({ result: [{ score: 0.9, payload: { recordId: 'm1', corpusKind: 'memory' } }] }) }
        }
    })
    const result = await index.search([1, 0, 0], { guildId: 'g1', continuityId: 'c1', deletionEpoch: 3 })
    assert.equal(result[0].id, 'm1')
    assert.ok(JSON.stringify(requestBody.filter).includes('g1'))
})

test('Qdrant alias switching uses the collection alias update endpoint', async () => {
    const requests = []
    const index = new QdrantVectorIndex({
        url: 'http://127.0.0.1:6333', model: 'model', revision: 'a'.repeat(40), dimension: 3,
        fetch: async (url, init = {}) => {
            requests.push({ url, init })
            if (url.endsWith('/aliases')) return { ok: true, status: 200, json: async () => ({ result: { aliases: [] } }) }
            return { ok: true, status: 200, json: async () => ({ result: true }) }
        }
    })

    await index.switchAlias('replacement_collection')

    assert.equal(requests[1].url, 'http://127.0.0.1:6333/collections/aliases')
    assert.deepEqual(JSON.parse(requests[1].init.body), {
        actions: [{ create_alias: { collection_name: 'replacement_collection', alias_name: 'chat_active' } }]
    })
})

test('Qdrant startup preserves an existing rebuilt alias', async () => {
    const requests = []
    const index = new QdrantVectorIndex({
        url: 'http://127.0.0.1:6333', model: 'model', revision: 'a'.repeat(40), dimension: 3,
        fetch: async (url, init = {}) => {
            requests.push({ url, init })
            return { ok: true, status: 200, json: async () => ({ result: { aliases: [{ alias_name: 'chat_active', collection_name: 'verified_rebuild' }] } }) }
        }
    })

    const active = await index.ensureAlias()

    assert.equal(active, 'verified_rebuild')
    assert.equal(requests.length, 1)
    assert.ok(requests[0].url.endsWith('/aliases'))
})

test('hybrid retrieval drops stale semantic hits and reports semantic degradation', async () => {
    const retriever = new HybridRetriever({
        embedder: { embedQueries: async () => { throw new Error('offline') } },
        vectorIndex: { search: async () => [] },
        lexical: { search: async () => [
            { id: 'active', kind: 'memory', score: 2 },
            { id: 'deleted', kind: 'memory', score: 1 }
        ] },
        repository: { getAuthorizedSources: async () => [{ memoryId: 'active', statement: 'The umbrella is green.' }] }
    })
    const result = await retriever.search('umbrella', { guildId: 'g1', continuityId: 'c1', userId: 'u1', deletionEpoch: 0 })
    assert.equal(result.degraded, true)
    assert.deepEqual(result.results.map(item => item.id), ['active'])
})

test('reciprocal rank fusion rewards agreement and selection preserves document diversity', () => {
    const fused = reciprocalRankFusion([
        [{ id: 'a', kind: 'lore' }, { id: 'b', kind: 'lore' }],
        [{ id: 'a', kind: 'lore' }, { id: 'c', kind: 'lore' }]
    ])
    assert.equal(fused[0].id, 'a')
    const selected = selectDiverse([
        { id: '1', record: { documentId: 'd1' } },
        { id: '2', record: { documentId: 'd1' } },
        { id: '3', record: { documentId: 'd1' } },
        { id: '4', record: { documentId: 'd2' } }
    ], { limit: 3, perDocument: 2 })
    assert.deepEqual(selected.map(item => item.id), ['1', '2', '4'])
})

test('lore chunking is bounded, overlapping, and local paths reject hidden/binary extensions', () => {
    const words = Array.from({ length: 800 }, (_, index) => `word${index}`).join(' ')
    const chunks = chunkText(words)
    assert.ok(chunks.length >= 3)
    assert.ok(chunks.every(chunk => chunk.tokenCount <= 350))
    assert.ok(chunks[0].endOffset > chunks[1].startOffset)
    assert.equal(contentHash('same'), contentHash('same'))
    assert.throws(() => validateLocalPath('resources/lore/.secret.txt'))
    assert.throws(() => validateLocalPath('resources/lore/file.json'))
    assert.doesNotThrow(() => validateLocalPath('resources/lore/file.md'))
})

test('lexical terms are normalized exactly without constructing regexes', () => {
    assert.deepEqual(normalizedTerms('  ÉLAINA Elaina umbrella '), ['élaina', 'elaina', 'umbrella'])
})

test('lore ingestion is idempotent and publishes Mongo only after vector indexing', async () => {
    const db = new FakeDb()
    let sequence = 0
    const repository = new ChatRepository({ db, id: () => `id-${++sequence}` })
    const indexed = []
    const ingestor = new LoreIngestor({
        repository,
        embedder: { embedPassages: async texts => texts.map(() => Array(384).fill(0)) },
        vectorIndex: {
            upsert: async records => { indexed.push(...records); return records.length },
            deleteByFilter: async () => {}
        }
    })
    const first = await ingestor.ingestText('Elaina is the Ashen Witch.', {
        sourceKey: 'test:elaina', title: 'Elaina', corpus: 'global_lore', tags: ['Elaina']
    })
    const second = await ingestor.ingestText('Elaina is the Ashen Witch.', {
        sourceKey: 'test:elaina', title: 'Elaina', corpus: 'global_lore', tags: ['Elaina']
    })
    assert.equal(first.unchanged, false)
    assert.equal(second.unchanged, true)
    assert.equal(indexed.length, 1)
    assert.equal(db.collection('chat_chunks').documents[0].lifecycle, 'active')
    assert.equal(db.collection('chat_documents').documents[0].lifecycle, 'active')
})

test('URL lore ingestion requires an injected safe fetcher', async () => {
    const ingestor = new LoreIngestor({ repository: {}, embedder: {}, vectorIndex: {} })
    await assert.rejects(ingestor.ingestUrl('https://example.com/lore'), /safe web fetcher/)
    await assert.rejects(ingestor.ingestUrl('file:///etc/passwd'), /credential-free HTTP/)
})
