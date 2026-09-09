'use strict'

require('dotenv').config()

const test = require('node:test')
const assert = require('node:assert/strict')
const { openMongo } = require('../../../chat/persistence/mongo')
const { loadConfig } = require('../../../chat/config')
const { QdrantVectorIndex } = require('../../../chat/retrieval/vector_index')
const { createSearxngClient } = require('../../../chat/web/searxng')
const { E5Embedder } = require('../../../chat/retrieval/embed_worker')
const { ChatRepository } = require('../../../chat/persistence/repository')
const { LoreIngestor } = require('../../../chat/retrieval/ingest')
const { createChatSubsystem } = require('../../../chat')
const { COLLECTIONS } = require('../../../chat/persistence/collections')

const enabled = process.env.CHAT_INTEGRATION === 'true'

test('configured local chat services are reachable', { skip: !enabled }, async () => {
    const config = loadConfig()
    const mongo = await openMongo({ dbName: process.env.CHAT_MONGODB_DATABASE || 'another_elaina' })
    try {
        assert.equal((await mongo.db.command({ ping: 1 })).ok, 1)
        const vector = new QdrantVectorIndex({ url: config.qdrantUrl, apiKey: config.qdrantApiKey, ...config.embedding })
        await vector.ensureCollection()
        await vector.ensureAlias()
        const search = createSearxngClient({ endpoint: config.searxngUrl })
        const result = await search.search({ query: 'Node.js documentation', limit: 1 })
        assert.ok(result.results.length > 0)
        assert.match(result.results[0].url, /^https?:\/\//)
    } finally {
        await mongo.close()
    }
})

test('pinned local embeddings round-trip through the live Qdrant alias', { skip: !enabled }, async () => {
    const config = loadConfig()
    const mongo = await openMongo({ dbName: process.env.CHAT_MONGODB_DATABASE || 'another_elaina' })
    const sourceKey = `integration:${Date.now()}`
    const guildId = 'integration-guild'
    const userId = 'integration-user'
    const repository = new ChatRepository({ db: mongo.db })
    const embedder = new E5Embedder(config.embedding)
    const vector = new QdrantVectorIndex({ url: config.qdrantUrl, apiKey: config.qdrantApiKey, ...config.embedding })
    const ingestor = new LoreIngestor({ repository, embedder, vectorIndex: vector })
    try {
        await vector.ensureCollection()
        await vector.ensureAlias()
        const ingested = await ingestor.ingestText('The silver compass opens beneath moonlit water.', {
            sourceKey, title: 'Integration compass', corpus: 'restricted_lore',
            guildId, audienceUserIds: [userId], ownerUserId: userId
        })
        const [query] = await embedder.embedQueries(['What object opens underwater in moonlight?'])
        const hits = await vector.search(query, {
            guildId, userId, corpora: ['restricted_lore']
        }, { limit: 5 })
        assert.ok(hits.some(hit => hit.id === ingested.chunks[0].chunkId))
        assert.equal((await repository.getAuthorizedSources([
            { id: ingested.chunks[0].chunkId, kind: 'lore' }
        ], { guildId, userId }))[0].text, 'The silver compass opens beneath moonlit water.')
    } finally {
        await ingestor.remove(sourceKey, { guildId, corpus: 'restricted_lore' }).catch(() => {})
        await mongo.close()
    }
})

test('a live addressed Discord turn is generated, delivered, and committed', { skip: !enabled, timeout: 180000 }, async () => {
    const databaseName = `another_elaina_chat_smoke_${process.pid}_${Date.now()}`
    const mongo = await openMongo({ dbName: databaseName })
    let subsystem
    const priorMode = globalThis.operating_mode
    const deliveries = []
    let responseSequence = 0

    function responseMessage(payload, channel) {
        const response = {
            id: `response-${++responseSequence}`,
            channel,
            payload,
            async edit(next) {
                this.payload = next
                deliveries.push({ operation: 'edit', messageId: this.id, payload: next })
                return this
            }
        }
        deliveries.push({ operation: 'send', messageId: response.id, payload })
        return response
    }

    const channel = {
        id: '200000000000000001',
        isThread: () => false,
        async send(payload) { return responseMessage(payload, channel) }
    }
    const botUserId = '900000000000000001'
    const userId = '100000000000000001'
    const message = {
        id: '300000000000000001',
        guildId: '400000000000000001',
        channelId: channel.id,
        guild: { id: '400000000000000001' },
        channel,
        author: { id: userId, username: 'IntegrationPlayer', globalName: 'Integration Player', bot: false },
        member: { displayName: 'Integration Player', permissions: { has: () => false } },
        content: `<@${botUserId}> IC: We meet beneath the old observatory. Greet me briefly and stay in character.`,
        createdAt: new Date(),
        mentions: { users: new Map([[botUserId, { id: botUserId }]]), roles: new Map(), channels: new Map() },
        attachments: new Map(),
        async reply(payload) { return responseMessage(payload, channel) }
    }

    try {
        globalThis.operating_mode = 'auto_local'
        subsystem = await createChatSubsystem({ db: mongo.db, ownerIds: ['integration-owner'] })
        const result = await subsystem.service.intake({ user: { id: botUserId } }, message)

        assert.ok(result.turnId)
        assert.ok(result.text.length > 0)
        assert.ok(deliveries.some(item => item.operation === 'send' && item.payload.content === 'Thinking...'))
        assert.ok(deliveries.some(item => item.operation === 'edit' && item.payload.content === result.text))

        const turn = await subsystem.repository.getTurn(result.turnId)
        assert.equal(turn.lifecycle, 'finalized')
        assert.equal(turn.requestId, `discord:${message.guildId}:${message.channelId}:${message.id}`)
        assert.equal(turn.delivery.status, 'delivered')
        assert.equal(turn.response.model, subsystem.service.provider.model)

        const binding = await mongo.db.collection(COLLECTIONS.bindings).findOne({ guildId: message.guildId, channelId: message.channelId, threadId: null })
        const continuity = await subsystem.repository.getContinuity(binding.continuityId)
        const scene = await mongo.db.collection(COLLECTIONS.scenes).findOne({ sceneId: binding.activeSceneId })
        assert.equal(continuity.committedEventId, result.turnId)
        assert.equal(continuity.revision, 1)
        assert.equal(scene.selectedHeadTurnId, result.turnId)
        assert.ok(scene.participants.some(participant => participant.userId === userId))
        assert.ok(await mongo.db.collection(COLLECTIONS.jobs).findOne({ type: 'extract_memory', entityId: result.turnId }))
    } finally {
        await subsystem?.stop()
        await mongo.db.dropDatabase().catch(() => {})
        await mongo.close()
        globalThis.operating_mode = priorMode
    }
})
