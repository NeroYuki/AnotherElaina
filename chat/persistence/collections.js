'use strict'

const COLLECTIONS = Object.freeze({
    continuities: 'chat_continuities',
    scenes: 'chat_scenes',
    bindings: 'chat_bindings',
    characters: 'chat_characters',
    turns: 'chat_turns',
    memories: 'chat_memories',
    relationships: 'chat_relationships',
    episodes: 'chat_episodes',
    documents: 'chat_documents',
    chunks: 'chat_chunks',
    jobs: 'chat_jobs',
    toolRuns: 'chat_tool_runs',
    tombstones: 'chat_tombstones',
    migrations: 'chat_migrations'
})

const INDEXES = Object.freeze({
    [COLLECTIONS.continuities]: [
        { key: { continuityId: 1 }, unique: true, name: 'continuity_id_unique' },
        { key: { guildId: 1, ownerUserId: 1, status: 1 }, name: 'continuity_guild_owner' },
        { key: { 'lease.expiresAt': 1 }, name: 'continuity_lease_expiry' }
    ],
    [COLLECTIONS.scenes]: [
        { key: { sceneId: 1 }, unique: true, name: 'scene_id_unique' },
        { key: { continuityId: 1, status: 1, updatedAt: -1 }, name: 'scene_continuity_status' }
    ],
    [COLLECTIONS.bindings]: [
        { key: { guildId: 1, channelId: 1, threadId: 1 }, unique: true, name: 'binding_scope_unique' },
        { key: { activeSceneId: 1, enabled: 1 }, name: 'binding_scene' }
    ],
    [COLLECTIONS.characters]: [
        { key: { continuityId: 1, characterId: 1 }, unique: true, name: 'character_scope_unique' },
        { key: { continuityId: 1, ownerUserId: 1 }, name: 'character_owner' }
    ],
    [COLLECTIONS.turns]: [
        { key: { eventId: 1 }, unique: true, name: 'turn_event_unique' },
        { key: { continuityId: 1, requestId: 1 }, unique: true, sparse: true, name: 'turn_request_unique' },
        { key: { guildId: 1, sourceDiscordMessageId: 1 }, unique: true, sparse: true, name: 'turn_discord_source_unique' },
        { key: { sceneId: 1, branchId: 1, ordinal: 1 }, name: 'turn_scene_branch_order' },
        { key: { continuityId: 1, parentEventId: 1 }, name: 'turn_parent_event' },
        { key: { lifecycle: 1, updatedAt: 1 }, name: 'turn_lifecycle_reconcile' }
    ],
    [COLLECTIONS.memories]: [
        { key: { memoryId: 1 }, unique: true, name: 'memory_id_unique' },
        { key: { derivationKey: 1 }, unique: true, name: 'memory_derivation_unique' },
        { key: { 'scope.guildId': 1, 'scope.continuityId': 1, kind: 1, status: 1, deletionEpoch: 1 }, name: 'memory_scope_kind_status' },
        { key: { sourceTurnIds: 1 }, name: 'memory_sources' },
        { key: { subjectCharacterId: 1, targetCharacterId: 1, status: 1 }, name: 'memory_direction' },
        { key: { statement: 'text', relationType: 'text' }, name: 'memory_lexical', default_language: 'none', weights: { statement: 10, relationType: 4 } }
    ],
    [COLLECTIONS.relationships]: [
        { key: { continuityId: 1, subjectCharacterId: 1, targetCharacterId: 1 }, unique: true, name: 'relationship_direction_unique' }
    ],
    [COLLECTIONS.episodes]: [
        { key: { episodeId: 1 }, unique: true, name: 'episode_id_unique' },
        { key: { continuityId: 1, sceneId: 1, branchId: 1, endedAt: -1, deletionEpoch: 1 }, name: 'episode_scope_time' },
        { key: { derivationKey: 1 }, unique: true, name: 'episode_derivation_unique' },
        { key: { sourceTurnIds: 1 }, name: 'episode_sources' },
        { key: { summary: 'text', topicTags: 'text' }, name: 'episode_lexical', default_language: 'none', weights: { summary: 10, topicTags: 5 } }
    ],
    [COLLECTIONS.documents]: [
        { key: { documentId: 1 }, unique: true, name: 'document_id_unique' },
        { key: { sourceKey: 1, contentHash: 1, revision: 1 }, unique: true, name: 'document_source_revision_unique' },
        { key: { lifecycle: 1, corpus: 1, updatedAt: -1 }, name: 'document_lifecycle' },
        { key: { continuityId: 1, ownerUserId: 1, sourceTurnId: 1 }, name: 'document_owner_source' }
    ],
    [COLLECTIONS.chunks]: [
        { key: { chunkId: 1 }, unique: true, name: 'chunk_id_unique' },
        { key: { documentId: 1, revision: 1, chunkIndex: 1 }, unique: true, name: 'chunk_document_unique' },
        { key: { corpus: 1, lifecycle: 1, deletionEpoch: 1 }, name: 'chunk_scope_status' },
        { key: { continuityId: 1, ownerUserId: 1, sourceTurnId: 1 }, name: 'chunk_owner_source' },
        { key: { text: 'text', tags: 'text', normalizedTerms: 'text' }, name: 'chunk_lexical', default_language: 'none', weights: { text: 10, tags: 6, normalizedTerms: 4 } }
    ],
    [COLLECTIONS.jobs]: [
        { key: { idempotencyKey: 1 }, unique: true, name: 'job_idempotency_unique' },
        { key: { state: 1, nextRunAt: 1, priority: -1, createdAt: 1 }, name: 'job_claim' },
        { key: { 'lease.expiresAt': 1 }, name: 'job_lease_expiry' },
        { key: { continuityId: 1, expectedEpoch: 1, state: 1 }, name: 'job_scope_epoch' }
    ],
    [COLLECTIONS.toolRuns]: [
        { key: { turnId: 1, callId: 1 }, unique: true, name: 'tool_call_unique' },
        { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'tool_cache_ttl' }
    ],
    [COLLECTIONS.tombstones]: [
        { key: { tombstoneId: 1 }, unique: true, name: 'tombstone_id_unique' },
        { key: { continuityId: 1, userId: 1, sceneId: 1, sourceTurnId: 1, epoch: -1 }, name: 'tombstone_scope' }
    ],
    [COLLECTIONS.migrations]: [
        { key: { migrationId: 1 }, unique: true, name: 'migration_id_unique' }
    ]
})

async function ensureCollectionsAndIndexes(db, options = {}) {
    if (!db || typeof db.collection !== 'function') throw new TypeError('A connected Mongo Db is required')
    const existing = typeof db.listCollections === 'function'
        ? new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name))
        : new Set()
    const results = []
    for (const name of Object.values(COLLECTIONS)) {
        if (!existing.has(name) && typeof db.createCollection === 'function' && !options.verifyOnly) {
            try {
                await db.createCollection(name)
            } catch (error) {
                if (error.codeName !== 'NamespaceExists' && error.code !== 48) throw error
            }
        }
        const collection = db.collection(name)
        if (INDEXES[name] && !options.verifyOnly) {
            const names = await collection.createIndexes(INDEXES[name])
            results.push({ collection: name, indexes: names })
        } else {
            results.push({ collection: name, indexes: [] })
        }
    }
    return results
}

module.exports = { COLLECTIONS, INDEXES, ensureCollectionsAndIndexes }
