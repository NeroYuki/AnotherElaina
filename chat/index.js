'use strict'

const { loadConfig } = require('./config')
const { initializeMongo } = require('./persistence/mongo')
const { ChatRepository } = require('./persistence/repository')
const { ContinuityLeases } = require('./persistence/leases')
const { JobQueue, JobWorker } = require('./persistence/jobs')
const { LocalOpenAIProvider } = require('./providers/local_openai')
const { probeCapabilities } = require('./providers/capabilities')
const { E5Embedder } = require('./retrieval/embed_worker')
const { QdrantVectorIndex } = require('./retrieval/vector_index')
const { MongoLexicalRetriever } = require('./retrieval/lexical')
const { HybridRetriever } = require('./retrieval/retrieval')
const { LoreIngestor, Reindexer } = require('./retrieval/ingest')
const { MemoryExtractor } = require('./memory/extract')
const { ForgetService } = require('./memory/forget')
const { EpisodeSummarizer } = require('./memory/summarize')
const { MemoryProjector } = require('./memory/project')
const { createSearxngClient } = require('./web/searxng')
const { createSafeFetcher } = require('./web/safe_fetch')
const { SourceRegistry } = require('./web/source_registry')
const { createDefaultToolRegistry, ToolRunner } = require('./tools')
const { SceneControls } = require('./conversation/scene_controls')
const { ConversationService } = require('./conversation/service')
const { ChatStatus } = require('./observability/metrics')
const { COLLECTIONS } = require('./persistence/collections')
const { validateSchema } = require('./tools/schema_validator')
const { configuredOwnerIds } = require('./discord/permissions')

async function createChatSubsystem(options = {}) {
    const config = options.config || loadConfig()
    const { db } = await initializeMongo({ db: options.db })
    const repository = new ChatRepository({ db })
    const leases = new ContinuityLeases({ db, durationMs: Math.min(config.turnTimeoutMs + 30000, 210000) })
    const jobs = new JobQueue({ db })
    const provider = options.provider || new LocalOpenAIProvider({ endpoint: config.inferenceUrl, model: config.model, contextTokens: config.contextTokens })
    const embedder = options.embedder || new E5Embedder(config.embedding)
    const vectorIndex = options.vectorIndex || new QdrantVectorIndex({ url: config.qdrantUrl, ...config.embedding })
    const lexical = new MongoLexicalRetriever({ db })
    const retriever = new HybridRetriever({ embedder, vectorIndex, lexical, repository })
    const sourceRegistry = new SourceRegistry()
    const searxng = createSearxngClient({ endpoint: config.searxngUrl, sourceRegistry })
    const safeFetch = createSafeFetcher()
    const loreIngestor = new LoreIngestor({ repository, embedder, vectorIndex, urlFetcher: safeFetch })
    const reindexer = new Reindexer({ repository, embedder, vectorIndex })
    const forgetService = new ForgetService({ repository, jobs, vectorIndex })
    const memoryExtractor = new MemoryExtractor({ provider, repository, jobs, model: config.model })
    const episodeSummarizer = new EpisodeSummarizer({ provider, repository, schemaValidator: (schema, value) => { const errors = validateSchema(schema, value); return { valid: errors.length === 0, errors } } })
    const memoryProjector = new MemoryProjector({ repository })
    const memorySearch = async ({ query, kind, trustedContext, signal, limit }) => {
        const result = await retriever.search(query, trustedContext, { kinds: kind === 'episode' ? ['episode'] : ['memory', 'episode'], memoryKind: kind, signal, limit })
        return { matches: result.results.map(item => ({ id: item.id, text: item.text, kind: item.kind, sourceIds: item.record?.sourceTurnIds || [] })), degraded: result.degraded }
    }
    const knowledgeSearch = async ({ query, trustedContext, signal, limit }) => {
        const result = await retriever.search(query, trustedContext, { kinds: ['lore'], signal, limit })
        return { passages: result.results.map(item => ({ id: item.id, text: item.text, title: item.record?.sourceKey, sourceId: item.record?.documentId })), degraded: result.degraded }
    }
    const toolRegistry = createDefaultToolRegistry({ memorySearch, knowledgeSearch, searxng, safeFetch, sourceRegistry })
    const toolCache = {
        async get(key) {
            const separator = key.lastIndexOf(':')
            if (separator < 1) return null
            const record = await repository.collection(COLLECTIONS.toolRuns).findOne({ turnId: key.slice(0, separator), callId: key.slice(separator + 1), status: { $in: ['completed', 'failed'] } })
            return record?.result || null
        },
        async set() {}
    }
    const toolRunner = new ToolRunner({
        registry: toolRegistry,
        cache: toolCache,
        persistResult: record => repository.collection(COLLECTIONS.toolRuns).updateOne({ turnId: record.turnId, callId: record.callId }, { $set: { ...record, schemaVersion: 1, status: record.result.ok ? 'completed' : 'failed', expiresAt: new Date(Date.now() + 15 * 60_000) } }, { upsert: true })
    })
    const sceneControls = new SceneControls({ repository, forgetService, loreIngestor, jobs })
    const ownerIds = configuredOwnerIds(options.ownerIds)
    const service = new ConversationService({ config, repository, leases, provider, retriever, toolRegistry, toolRunner, sceneControls, jobs, ownerIds, imageLoader: options.imageLoader })
    const status = new ChatStatus({ mongo: { enabled: true, reachable: true, exercised: true }, embeddings: { enabled: true }, qdrant: { enabled: true }, searxng: { enabled: true }, provider: { enabled: true, model: config.model } })

    const persistedConfig = await repository.collection(COLLECTIONS.migrations).findOne({ migrationId: 'chat-runtime-config' })
    if (persistedConfig) {
        globalThis.operating_mode = persistedConfig.mode === 'disabled' ? 'disabled' : 'auto_local'
        if (persistedConfig.model) provider.model = persistedConfig.model
        service.streamEnabled = persistedConfig.stream !== false
    }

    const handlers = {
        extract_memory: async job => {
            const turn = await repository.getTurn(job.entityId)
            if (!turn || !['committed', 'finalized'].includes(turn.lifecycle)) return { stale: true }
            const scene = await repository.collection(COLLECTIONS.scenes).findOne({ sceneId: turn.sceneId })
            const virtualAssistant = { eventId: `${turn.eventId}:assistant`, sourceEventId: turn.eventId, authorUserId: 'elaina', authorCharacterId: 'elaina', content: turn.response?.text || '' }
            const extractionTurns = turn.memoryOptOut ? [virtualAssistant] : [turn, virtualAssistant]
            const participants = [{ characterId: 'elaina', ownerUserId: 'elaina', displayName: 'Elaina' }, ...(scene?.participants || []).map(item => ({ ...item, characterId: item.characterId || `user:${item.userId}` }))]
            const existingMemories = await repository.listActiveMemories({ 'scope.continuityId': turn.continuityId }, { limit: 50 })
            const byMemoryId = new Map(existingMemories.map(memory => [memory.memoryId, memory]))
            const findContradiction = candidate => {
                if (!['scene_fact', 'object_state', 'character_fact'].includes(candidate.kind) || !candidate.factType || !candidate.subjectCharacterId) return null
                return existingMemories.find(memory => memory.kind === candidate.kind && memory.factType === candidate.factType && memory.subjectCharacterId === candidate.subjectCharacterId && memory.targetCharacterId === candidate.targetCharacterId && memory.statement !== candidate.statement)?.memoryId || null
            }
            const result = await memoryExtractor.runJob({ continuityId: turn.continuityId, expectedEpoch: turn.deletionEpoch, turns: extractionTurns, participants, allowedUserIds: turn.memoryOptOut ? [] : (scene?.participants?.map(item => item.userId) || []), optedOutCharacterIds: turn.memoryOptOut ? [turn.authorCharacterId] : [], existingMemories, scope: { guildId: turn.guildId, continuityId: turn.continuityId, sceneId: turn.sceneId, branchId: turn.branchId, audienceUserIds: scene?.participants?.map(item => item.userId) || [] }, canCorrect: candidate => { const target = byMemoryId.get(candidate.targetMemoryId); return Boolean(turn.authorIsOwner || turn.authorIsModerator || target?.userId === turn.authorUserId || target?.subjectCharacterId === turn.authorCharacterId) }, findContradiction, jobId: job.jobId })
            if (!result.stale && result.memories.length) {
                await jobs.enqueue({ type: 'rebuild_projection', entityId: turn.sceneId, continuityId: turn.continuityId, expectedEpoch: turn.deletionEpoch, idempotencyKey: `projection:${turn.sceneId}:${job.expectedRevision}`, payload: { sceneId: turn.sceneId } })
            }
            return result
        },
        ingest_lore: async job => {
            const metadata = { sourceKey: job.payload.source.type === 'url' ? job.payload.source.url : job.payload.source.id, title: job.payload.source.name || job.payload.label, ownerUserId: job.payload.ownerUserId, guildId: job.payload.guildId, corpus: 'restricted_lore', audienceUserIds: [job.payload.ownerUserId] }
            return loreIngestor.ingestUrl(job.payload.source.url, metadata)
        },
        reindex_all: job => reindexer.run({ sourceId: job.payload.sourceId }),
        index_memory: async job => {
            const memory = await repository.collection(COLLECTIONS.memories).findOne({ memoryId: job.payload.memoryId, status: 'active' })
            if (!memory) return { stale: true }
            const [vector] = await embedder.embedPassages([memory.statement])
            await vectorIndex.upsert([{ id: memory.memoryId, vector, payload: { corpus: 'memory', corpusKind: 'memory', guildId: memory.scope.guildId, continuityId: memory.scope.continuityId, sceneId: memory.scope.sceneId, branchId: memory.scope.branchId, audienceUserIds: memory.scope.audienceUserIds || [], sourceRevision: memory.derivationVersion, deletionEpoch: memory.deletionEpoch, lifecycle: 'active', salience: memory.salience || 0 } }])
            return { indexed: true }
        },
        summarize_episode: async job => {
            const scene = await repository.collection(COLLECTIONS.scenes).findOne({ sceneId: job.payload.sceneId })
            const continuity = await repository.getContinuity(job.continuityId)
            if (!scene || !continuity || continuity.deletionEpoch !== job.expectedEpoch) return { stale: true }
            const turns = await repository.collection(COLLECTIONS.turns).find({ sceneId: scene.sceneId, branchId: job.payload.branchId, lifecycle: { $in: ['committed', 'finalized'] } }).sort({ ordinal: -1 }).limit(config.episodeTurnThreshold).toArray()
            turns.reverse()
            const result = await episodeSummarizer.runJob({ continuityId: continuity.continuityId, expectedEpoch: continuity.deletionEpoch, expectedRevision: continuity.revision, guildId: continuity.guildId, sceneId: scene.sceneId, branchId: scene.branchId, participants: scene.participants || [], audienceUserIds: continuity.allowedAudienceUserIds || [], turns, jobId: job.jobId })
            if (!result.stale) await jobs.enqueue({ type: 'index_episode', entityId: result.episode.episodeId, continuityId: continuity.continuityId, expectedEpoch: continuity.deletionEpoch, idempotencyKey: `index-episode:${result.episode.episodeId}:${result.episode.derivationVersion}`, payload: { episodeId: result.episode.episodeId } })
            return result
        },
        rebuild_episode: async job => {
            const episode = await repository.collection(COLLECTIONS.episodes).findOne({ episodeId: job.entityId })
            if (!episode) return { stale: true }
            const turns = await repository.collection(COLLECTIONS.turns).find({ eventId: { $in: episode.sourceTurnIds }, lifecycle: { $in: ['committed', 'finalized'] } }).sort({ ordinal: 1 }).toArray()
            if (!turns.length) return { stale: true }
            return episodeSummarizer.runJob({ ...episode, turns, expectedEpoch: job.expectedEpoch, expectedRevision: episode.projectionRevision, jobId: job.jobId })
        },
        index_episode: async job => {
            const episode = await repository.collection(COLLECTIONS.episodes).findOne({ episodeId: job.payload.episodeId, lifecycle: 'active' })
            if (!episode) return { stale: true }
            const [vector] = await embedder.embedPassages([episode.summary])
            await vectorIndex.upsert([{ id: episode.episodeId, vector, payload: { corpus: 'episode', corpusKind: 'episode', guildId: episode.guildId, continuityId: episode.continuityId, sceneId: episode.sceneId, branchId: episode.branchId, audienceUserIds: episode.audienceUserIds || [], sourceRevision: episode.derivationVersion, deletionEpoch: episode.deletionEpoch, lifecycle: 'active' } }])
            return { indexed: true }
        },
        rebuild_projection: async job => {
            const continuity = await repository.getContinuity(job.continuityId)
            const scene = await repository.collection(COLLECTIONS.scenes).findOne({ sceneId: job.payload.sceneId || job.entityId })
            if (!continuity || !scene || continuity.deletionEpoch !== job.expectedEpoch) return { stale: true }
            return leases.withLease(continuity.continuityId, lease => memoryProjector.rebuild({ continuityId: continuity.continuityId, sceneId: scene.sceneId, expectedEpoch: continuity.deletionEpoch, expectedContinuityRevision: continuity.revision, expectedProjectionRevision: scene.projectionRevision, currentState: scene.projectedState, snapshotWatermark: continuity.committedEventId, selectedHeadTurnId: scene.selectedHeadTurnId, lease }))
        },
        retention_cleanup: async () => {
            const cutoff = new Date(Date.now() - config.rawRetentionDays * 86400000)
            const result = await repository.collection(COLLECTIONS.turns).updateMany({ createdAt: { $lt: cutoff }, lifecycle: 'finalized', retainedRaw: { $ne: false } }, { $set: { content: '[expired]', contentParts: [], segments: [], reply: null, response: null, retainedRaw: false, rawExpiredAt: new Date(), updatedAt: new Date() } })
            return { redactedTurns: result.modifiedCount }
        },
        reconcile_turns: async () => {
            const turns = await repository.collection(COLLECTIONS.turns).find({ lifecycle: { $in: ['committed', 'finalized'] }, responseRejected: { $ne: true } }).sort({ updatedAt: -1 }).limit(500).toArray()
            let enqueued = 0
            for (const turn of turns) {
                if (turn.lifecycle === 'committed' || turn.recoveryRequired) {
                    if (!await repository.isCanonicalTurn(turn.continuityId, turn.eventId)) continue
                    await repository.updateTurn(turn.eventId, { lifecycle: 'finalized', finalizedAt: turn.finalizedAt || new Date(), recoveryRequired: false, reconciledAt: new Date() })
                    await repository.collection(COLLECTIONS.scenes).updateOne({ sceneId: turn.sceneId, $or: [{ selectedHeadTurnId: turn.parentTurnId }, { selectedHeadTurnId: null }, { selectedHeadTurnId: { $exists: false } }] }, { $set: { selectedHeadTurnId: turn.eventId, updatedAt: new Date() } })
                }
                await jobs.enqueue({ type: 'extract_memory', entityId: turn.eventId, sourceIds: [turn.eventId], continuityId: turn.continuityId, expectedEpoch: turn.deletionEpoch, expectedRevision: turn.committedRevision, priority: -10, idempotencyKey: `extract:${turn.eventId}:v1`, payload: { sceneId: turn.sceneId, branchId: turn.branchId } })
                enqueued += 1
            }
            return { scanned: turns.length, enqueued }
        }
    }
    const worker = new JobWorker({ queue: jobs, handlers, onError: error => console.error('[chat worker]', error) })

    await Promise.allSettled([
        embedder.init().then(() => status.set('embeddings', { enabled: true, reachable: true, exercised: true })).catch(error => status.set('embeddings', { enabled: true, reachable: false, degraded: true, error: error.code || error.message })),
        vectorIndex.ensureCollection().then(() => vectorIndex.ensureAlias()).then(activeCollection => status.set('qdrant', { enabled: true, reachable: true, exercised: true, activeCollection })).catch(error => status.set('qdrant', { enabled: true, reachable: false, degraded: true, error: error.code || error.message })),
        searxng.search({ query: 'Node.js documentation', limit: 1 }).then(result => status.set('searxng', { enabled: true, reachable: true, exercised: true, resultCount: result.results.length })).catch(error => status.set('searxng', { enabled: true, reachable: false, degraded: true, error: error.code || error.message })),
        probeCapabilities({ endpoint: config.inferenceUrl, model: provider.model }).then(capabilities => { service.nativeTools = capabilities.nativeTools; status.set('provider', { enabled: true, ...capabilities, exercised: true }) }).catch(error => status.set('provider', { enabled: true, reachable: false, degraded: true, model: provider.model, error: error.code || error.message }))
    ])
    const day = new Date().toISOString().slice(0, 10)
    await jobs.enqueue({ type: 'retention_cleanup', idempotencyKey: `retention:${day}`, priority: -100, payload: {} })
    await jobs.enqueue({ type: 'reconcile_turns', idempotencyKey: `reconcile:${day}`, priority: -90, payload: {} })
    worker.start()
    return {
        config, service, repository, jobs, status,
        async stop() {
            await service.stop()
            await worker.stop()
        }
    }
}

module.exports = { createChatSubsystem }
