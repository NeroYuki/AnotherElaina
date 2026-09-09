'use strict'

const { COLLECTIONS } = require('../persistence/collections')

function scopeQuery(scope, fieldPrefix = '') {
    const prefix = fieldPrefix ? `${fieldPrefix}.` : ''
    const query = {}
    if (scope.continuityId) query[`${prefix}continuityId`] = scope.continuityId
    if (scope.sceneId) query[`${prefix}sceneId`] = scope.sceneId
    return query
}

class ForgetService {
    constructor(options) {
        this.repository = options.repository
        this.jobs = options.jobs
        this.vectorIndex = options.vectorIndex
        this.cache = options.cache || null
        this.clock = options.clock || (() => new Date())
    }

    async forget(scope, request) {
        if (!scope.continuityId) throw new TypeError('forget requires continuityId')
        const broad = !scope.userId && !scope.sceneId && !scope.sourceTurnId
        const prior = await this.repository.getContinuity(scope.continuityId)
        if (!prior) return { found: false }
        const epoch = await this.repository.bumpDeletionEpoch(scope, request)
        if (epoch === null) return { found: false }

        const now = this.clock()
        const turnQuery = { continuityId: scope.continuityId }
        if (scope.sceneId) turnQuery.sceneId = scope.sceneId
        if (scope.userId) turnQuery.authorUserId = scope.userId
        if (scope.sourceTurnId) turnQuery.eventId = scope.sourceTurnId
        const affectedTurnIds = await this._turnIds(turnQuery)
        const affectedScenes = await this.repository.collection(COLLECTIONS.turns).find(turnQuery, { projection: { sceneId: 1 } }).toArray()
        const sceneIds = [...new Set([scope.sceneId, ...affectedScenes.map(turn => turn.sceneId)].filter(Boolean))]

        const memoryQuery = scopeQuery(scope, 'scope')
        if (scope.userId) {
            memoryQuery.$or = [
                { userId: scope.userId },
                { subjectCharacterId: `user:${scope.userId}` },
                { targetCharacterId: `user:${scope.userId}` },
                { sourceTurnIds: { $in: affectedTurnIds } }
            ]
        }
        if (scope.sourceTurnId) memoryQuery.sourceTurnIds = scope.sourceTurnId

        const episodeQuery = this._episodeQuery(scope)
        const chunkQuery = this._chunkQuery(scope)
        const documentQuery = this._documentQuery(scope)
        const [affectedMemories, affectedEpisodes, affectedChunks] = await Promise.all([
            this.repository.collection(COLLECTIONS.memories).find(memoryQuery, { projection: { memoryId: 1 } }).toArray(),
            this.repository.collection(COLLECTIONS.episodes).find(episodeQuery, { projection: { episodeId: 1, sourceTurnIds: 1 } }).toArray(),
            this.repository.collection(COLLECTIONS.chunks).find(chunkQuery, { projection: { chunkId: 1 } }).toArray()
        ])

        const jobFilter = { continuityId: scope.continuityId }
        if (scope.sourceTurnId) jobFilter.sourceIds = scope.sourceTurnId
        else if (scope.userId) jobFilter.$or = [{ sourceIds: { $in: affectedTurnIds } }, { 'payload.userId': scope.userId }]
        else if (scope.sceneId) jobFilter['payload.sceneId'] = scope.sceneId
        await this.jobs?.cancelMatching(jobFilter, 'scope_deleted')

        const relationshipQuery = scopeQuery(scope)
        if (scope.userId) relationshipQuery.$or = [{ subjectCharacterId: `user:${scope.userId}` }, { targetCharacterId: `user:${scope.userId}` }]
        const [turns, memories, relationships, episodes, documents, chunks, tools] = await Promise.all([
            this._delete(COLLECTIONS.turns, turnQuery, { content: '[deleted]', rawContent: '[deleted]', contentParts: [], segments: [], reply: null, response: null, authorDisplayName: null, authorUsername: null, lifecycle: 'deleted' }, now),
            this._delete(COLLECTIONS.memories, memoryQuery, { statement: '[deleted]', evidence: [], status: 'deleted' }, now),
            this._delete(COLLECTIONS.relationships, relationshipQuery, { summary: null, events: [], openPromises: [], lifecycle: 'deleted' }, now),
            this._delete(COLLECTIONS.episodes, episodeQuery, { summary: '[deleted]', significantEvents: [], unresolvedThreads: [], relationshipChanges: [], lifecycle: 'deleted' }, now),
            this._delete(COLLECTIONS.documents, documentQuery, { title: '[deleted]', sourceUrl: null, provenanceSource: null, lifecycle: 'deleted' }, now),
            this._delete(COLLECTIONS.chunks, chunkQuery, { text: '[deleted]', lifecycle: 'deleted' }, now),
            this._delete(COLLECTIONS.toolRuns, { turnId: { $in: affectedTurnIds } }, { result: null, sources: [], status: 'deleted' }, now)
        ])
        if (sceneIds.length) {
            await this.repository.collection(COLLECTIONS.scenes).updateMany({ sceneId: { $in: sceneIds } }, { $set: { projectedState: { facts: [], openPlans: [], goals: [] }, snapshotWatermark: null, deletionEpoch: epoch, updatedAt: now }, $inc: { projectionRevision: 1 } })
        }
        if (!broad) {
            await Promise.all([
                this.repository.collection(COLLECTIONS.turns).updateMany({ continuityId: scope.continuityId, lifecycle: { $ne: 'deleted' }, deletionEpoch: prior.deletionEpoch }, { $set: { deletionEpoch: epoch, updatedAt: now } }),
                this.repository.collection(COLLECTIONS.memories).updateMany({ 'scope.continuityId': scope.continuityId, status: 'active', deletionEpoch: prior.deletionEpoch }, { $set: { deletionEpoch: epoch, updatedAt: now } }),
                this.repository.collection(COLLECTIONS.episodes).updateMany({ continuityId: scope.continuityId, lifecycle: 'active', deletionEpoch: prior.deletionEpoch }, { $set: { deletionEpoch: epoch, updatedAt: now } }),
                this.repository.collection(COLLECTIONS.relationships).updateMany({ continuityId: scope.continuityId, lifecycle: { $ne: 'deleted' } }, { $set: { deletionEpoch: epoch, updatedAt: now } }),
                this.repository.collection(COLLECTIONS.chunks).updateMany({ continuityId: scope.continuityId, lifecycle: 'active', deletionEpoch: prior.deletionEpoch }, { $set: { deletionEpoch: epoch, updatedAt: now } })
            ])
            await this.jobs?.enqueue({
                type: 'reindex_all',
                continuityId: scope.continuityId,
                expectedEpoch: epoch,
                idempotencyKey: `reindex-after-delete:${scope.continuityId}:${epoch}`,
                priority: -30,
                payload: {}
            })
        }

        for (const episode of affectedEpisodes) {
            await this.jobs?.enqueue({
                type: 'rebuild_episode',
                entityId: episode.episodeId,
                continuityId: scope.continuityId,
                expectedEpoch: epoch,
                idempotencyKey: `rebuild-episode:${episode.episodeId}:${epoch}`,
                payload: { episodeId: episode.episodeId, excludedTurnIds: affectedTurnIds }
            })
        }

        for (const sceneId of sceneIds) {
            await this.jobs?.enqueue({
                type: 'rebuild_projection',
                entityId: sceneId,
                continuityId: scope.continuityId,
                expectedEpoch: epoch,
                idempotencyKey: `rebuild-projection:${sceneId}:${epoch}`,
                payload: { sceneId, excludedTurnIds: affectedTurnIds }
            })
        }

        const recordIds = [
            ...affectedMemories.map(record => record.memoryId),
            ...affectedEpisodes.map(record => record.episodeId),
            ...affectedChunks.map(record => record.chunkId)
        ]
        const vectorScope = broad
            ? { continuityId: scope.continuityId, deletionEpoch: { $lt: epoch } }
            : { recordIds }
        if (broad || recordIds.length) await this.vectorIndex?.deleteByFilter(vectorScope)
        await this.cache?.invalidate?.(scope)
        const verification = await this.verify(scope, { turnQuery, memoryQuery, episodeQuery, documentQuery, chunkQuery, affectedTurnIds, vectorScope })
        return { found: true, epoch, deleted: { turns, memories, relationships, episodes, documents, chunks, tools }, verification }
    }

    async _turnIds(query) {
        const turns = await this.repository.collection(COLLECTIONS.turns).find(query, { projection: { eventId: 1 } }).toArray()
        return turns.map(turn => turn.eventId)
    }

    _episodeQuery(scope) {
        const query = scopeQuery(scope)
        if (scope.userId) query.participantUserIds = scope.userId
        if (scope.sourceTurnId) query.sourceTurnIds = scope.sourceTurnId
        return query
    }

    _chunkQuery(scope) {
        const query = {}
        if (scope.continuityId) query.continuityId = scope.continuityId
        if (scope.sceneId) query.sceneId = scope.sceneId
        if (scope.userId) query.ownerUserId = scope.userId
        if (scope.sourceTurnId) query.sourceTurnId = scope.sourceTurnId
        return query
    }

    _documentQuery(scope) {
        const query = {}
        if (scope.continuityId) query.continuityId = scope.continuityId
        if (scope.sceneId) query.sceneId = scope.sceneId
        if (scope.userId) query.ownerUserId = scope.userId
        if (scope.sourceTurnId) query.sourceTurnId = scope.sourceTurnId
        return query
    }

    async _delete(collectionName, query, redaction, now) {
        const result = await this.repository.collection(collectionName).updateMany(
            { ...query, lifecycle: { $ne: 'deleted' }, status: { $ne: 'deleted' } },
            { $set: { ...redaction, deletedAt: now, updatedAt: now } }
        )
        return result.modifiedCount
    }

    async verify(scope, queries = {}) {
        const counts = {
            turns: await this.repository.collection(COLLECTIONS.turns).countDocuments({ ...queries.turnQuery, lifecycle: { $ne: 'deleted' } }),
            memories: await this.repository.collection(COLLECTIONS.memories).countDocuments({ ...queries.memoryQuery, status: 'active' }),
            relationships: await this.repository.collection(COLLECTIONS.relationships).countDocuments({ ...scopeQuery(scope), lifecycle: { $ne: 'deleted' } }),
            episodes: await this.repository.collection(COLLECTIONS.episodes).countDocuments({ ...queries.episodeQuery, lifecycle: 'active' }),
            documents: await this.repository.collection(COLLECTIONS.documents).countDocuments({ ...queries.documentQuery, lifecycle: 'active' }),
            chunks: await this.repository.collection(COLLECTIONS.chunks).countDocuments({ ...queries.chunkQuery, lifecycle: 'active' }),
            toolRuns: await this.repository.collection(COLLECTIONS.toolRuns).countDocuments({ turnId: { $in: queries.affectedTurnIds || [] }, status: { $ne: 'deleted' } })
        }
        const leakedTurns = await this.repository.collection(COLLECTIONS.turns).countDocuments({ ...queries.turnQuery, lifecycle: 'deleted', $or: [{ 'response.text': { $exists: true } }, { 'contentParts.0': { $exists: true } }] })
        let vectorPoints = null
        if (this.vectorIndex?.countByFilter && (queries.vectorScope.recordIds?.length || queries.vectorScope.continuityId)) {
            vectorPoints = await this.vectorIndex.countByFilter(queries.vectorScope)
        }
        return {
            complete: Object.values(counts).every(count => count === 0) && leakedTurns === 0 && (vectorPoints === null || vectorPoints === 0),
            counts: { ...counts, leakedTurns },
            vectorPoints,
            vectorVerified: vectorPoints !== null
        }
    }
}

module.exports = { ForgetService, scopeQuery }
