'use strict'

const crypto = require('node:crypto')
const { COLLECTIONS } = require('./collections')

function duplicateKey(error) {
    return error && (error.code === 11000 || error.codeName === 'DuplicateKey')
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
}

class ChatRepository {
    constructor(options) {
        if (!options || !options.db) throw new TypeError('ChatRepository requires a Mongo Db')
        this.db = options.db
        this.clock = options.clock || (() => new Date())
        this.id = options.id || (() => crypto.randomUUID())
    }

    collection(name) {
        if (!Object.values(COLLECTIONS).includes(name)) throw new Error(`Unowned chat collection: ${name}`)
        return this.db.collection(name)
    }

    async createContinuity(input) {
        const now = this.clock()
        const record = {
            schemaVersion: 1,
            continuityId: input.continuityId || this.id(),
            guildId: String(input.guildId),
            ownerUserId: String(input.ownerUserId),
            allowedAudienceUserIds: [...new Set(input.allowedAudienceUserIds || [String(input.ownerUserId)])],
            personaVersion: input.personaVersion || 'elaina-v1',
            status: 'active',
            committedEventId: null,
            revision: 0,
            deletionEpoch: 0,
            createdAt: now,
            updatedAt: now
        }
        await this.collection(COLLECTIONS.continuities).insertOne(record)
        return clone(record)
    }

    async createScene(input) {
        const now = this.clock()
        const record = {
            schemaVersion: 1,
            sceneId: input.sceneId || this.id(),
            continuityId: input.continuityId,
            branchId: input.branchId || this.id(),
            title: input.title || 'New scene',
            status: 'active',
            participants: clone(input.participants || []),
            projectedState: clone(input.projectedState || { facts: [], openPlans: [], goals: [] }),
            snapshotWatermark: null,
            selectedHeadTurnId: null,
            projectionRevision: 0,
            deletionEpoch: input.deletionEpoch || 0,
            createdAt: now,
            updatedAt: now
        }
        await this.collection(COLLECTIONS.scenes).insertOne(record)
        return clone(record)
    }

    async insertPendingTurn(input) {
        const now = this.clock()
        const eventId = input.eventId || this.id()
        const record = {
            schemaVersion: 1,
            ...clone(input),
            eventId,
            lifecycle: 'pending',
            createdAt: now,
            updatedAt: now
        }
        try {
            await this.collection(COLLECTIONS.turns).insertOne(record)
            return { created: true, turn: clone(record) }
        } catch (error) {
            if (!duplicateKey(error)) throw error
            const query = input.requestId
                ? { continuityId: input.continuityId, requestId: input.requestId }
                : { eventId }
            return { created: false, turn: await this.collection(COLLECTIONS.turns).findOne(query) }
        }
    }

    async updateTurn(eventId, patch, expectedLifecycle) {
        const now = this.clock()
        const query = { eventId }
        if (expectedLifecycle) query.lifecycle = expectedLifecycle
        const result = await this.collection(COLLECTIONS.turns).updateOne(query, {
            $set: { ...clone(patch), updatedAt: now }
        })
        return result.modifiedCount === 1
    }

    async commitTurn(input) {
        const now = this.clock()
        const { lease } = input
        const result = await this.collection(COLLECTIONS.continuities).updateOne({
            continuityId: input.continuityId,
            committedEventId: input.parentEventId ?? null,
            revision: input.expectedRevision,
            deletionEpoch: input.expectedEpoch,
            status: 'active',
            'lease.ownerId': lease.ownerId,
            'lease.fencingToken': lease.fencingToken,
            'lease.expiresAt': { $gt: now }
        }, {
            $set: { committedEventId: input.eventId, updatedAt: now },
            $inc: { revision: 1 }
        })
        if (result.modifiedCount !== 1) return { committed: false }
        await this.collection(COLLECTIONS.turns).updateOne({
            eventId: input.eventId,
            continuityId: input.continuityId,
            deletionEpoch: input.expectedEpoch,
            lifecycle: { $nin: ['deleted', 'superseded', 'abandoned'] }
        }, { $set: { lifecycle: 'committed', committedAt: now, updatedAt: now } })
        return { committed: true, revision: input.expectedRevision + 1 }
    }

    async finalizeTurn(eventId) {
        return this.updateTurn(eventId, { lifecycle: 'finalized', finalizedAt: this.clock() }, 'committed')
    }

    async getContinuity(continuityId) {
        return this.collection(COLLECTIONS.continuities).findOne({ continuityId })
    }

    async getTurn(eventId) {
        return this.collection(COLLECTIONS.turns).findOne({ eventId })
    }

    async isCanonicalTurn(continuityId, eventId, options = {}) {
        const continuity = await this.getContinuity(continuityId)
        if (!continuity || continuity.status !== 'active') return false
        const assistantVariant = String(eventId).endsWith(':assistant')
        const canonicalEventId = assistantVariant ? String(eventId).slice(0, -10) : eventId
        const target = await this.collection(COLLECTIONS.turns).findOne(
            { continuityId, eventId: canonicalEventId },
            { projection: { lifecycle: 1, response: 1 } }
        )
        const eligibleTarget = target && (
            ['committed', 'finalized'].includes(target.lifecycle) ||
            (options.includeDeleted === true && target.lifecycle === 'deleted')
        ) && (!assistantVariant || Boolean(target.response?.text))
        if (!eligibleTarget) return false
        let cursor = continuity.committedEventId
        const maxDepth = options.maxDepth || 10000
        for (let depth = 0; cursor && depth < maxDepth; depth += 1) {
            if (cursor === canonicalEventId) return true
            const turn = await this.collection(COLLECTIONS.turns).findOne(
                { continuityId, eventId: cursor, lifecycle: { $in: ['committed', 'finalized', 'deleted'] } },
                { projection: { parentEventId: 1 } }
            )
            if (!turn) return false
            cursor = turn.parentEventId
        }
        return false
    }

    async upsertMemory(memory) {
        const now = this.clock()
        const record = { ...clone(memory), schemaVersion: 1, updatedAt: now }
        if (!record.memoryId) record.memoryId = this.id()
        if (!record.createdAt) record.createdAt = now
        const result = await this.collection(COLLECTIONS.memories).findOneAndUpdate(
            { derivationKey: record.derivationKey },
            { $setOnInsert: record },
            { upsert: true, returnDocument: 'after' }
        )
        return result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result
    }

    async listActiveMemories(filter, options = {}) {
        const query = { ...clone(filter), status: 'active' }
        return this.collection(COLLECTIONS.memories).find(query)
            .sort(options.sort || { salience: -1, updatedAt: -1 })
            .limit(Math.min(options.limit || 100, 500))
            .toArray()
    }

    async supersedeMemory(targetMemoryId, replacementMemoryId, correctionType = 'supersede') {
        const status = correctionType === 'retract' ? 'retracted' : 'superseded'
        const result = await this.collection(COLLECTIONS.memories).updateOne(
            { memoryId: targetMemoryId, status: { $in: ['candidate', 'active'] } },
            { $set: { status, supersededByMemoryId: replacementMemoryId, updatedAt: this.clock() } }
        )
        return result.modifiedCount === 1
    }

    async redactMemories(memoryIds) {
        if (!memoryIds.length) return 0
        const result = await this.collection(COLLECTIONS.memories).updateMany(
            { memoryId: { $in: memoryIds } },
            { $set: { status: 'deleted', statement: '[deleted]', evidence: [], deletedAt: this.clock(), updatedAt: this.clock() } }
        )
        return result.modifiedCount
    }

    async publishSceneProjection(input) {
        const now = this.clock()
        const continuity = await this.collection(COLLECTIONS.continuities).findOne({
            continuityId: input.continuityId,
            deletionEpoch: input.expectedEpoch,
            revision: input.expectedContinuityRevision,
            'lease.ownerId': input.lease.ownerId,
            'lease.fencingToken': input.lease.fencingToken,
            'lease.expiresAt': { $gt: now }
        }, { projection: { _id: 1 } })
        if (!continuity) return false
        const result = await this.collection(COLLECTIONS.scenes).updateOne({
            sceneId: input.sceneId,
            continuityId: input.continuityId,
            deletionEpoch: input.expectedEpoch,
            projectionRevision: input.expectedProjectionRevision
        }, {
            $set: {
                projectedState: clone(input.projectedState),
                snapshotWatermark: input.snapshotWatermark,
                selectedHeadTurnId: input.selectedHeadTurnId,
                updatedAt: now
            },
            $inc: { projectionRevision: 1 }
        })
        return result.modifiedCount === 1
    }

    async upsertRelationship(record) {
        const now = this.clock()
        return this.collection(COLLECTIONS.relationships).updateOne({
            continuityId: record.continuityId,
            subjectCharacterId: record.subjectCharacterId,
            targetCharacterId: record.targetCharacterId
        }, {
            $set: { ...clone(record), schemaVersion: 1, updatedAt: now },
            $setOnInsert: { createdAt: now }
        }, { upsert: true })
    }

    async upsertEpisode(episode) {
        const now = this.clock()
        const record = { ...clone(episode), schemaVersion: 1, episodeId: episode.episodeId || this.id(), updatedAt: now }
        if (!record.createdAt) record.createdAt = now
        const result = await this.collection(COLLECTIONS.episodes).findOneAndUpdate(
            { derivationKey: record.derivationKey },
            { $setOnInsert: record },
            { upsert: true, returnDocument: 'after' }
        )
        return result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result
    }

    async upsertDocument(document) {
        const now = this.clock()
        const record = { ...clone(document), schemaVersion: 1, documentId: document.documentId || this.id(), updatedAt: now }
        if (!record.createdAt) record.createdAt = now
        const result = await this.collection(COLLECTIONS.documents).findOneAndUpdate({
            sourceKey: record.sourceKey,
            contentHash: record.contentHash,
            revision: record.revision
        }, { $setOnInsert: record }, { upsert: true, returnDocument: 'after' })
        return result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result
    }

    async replaceDocumentChunks(documentId, revision, chunks) {
        const collection = this.collection(COLLECTIONS.chunks)
        if (chunks.length) {
            await collection.bulkWrite(chunks.map(chunk => ({
                updateOne: {
                    filter: { chunkId: chunk.chunkId },
                    update: { $setOnInsert: clone(chunk) },
                    upsert: true
                }
            })), { ordered: false })
        }
        await collection.updateMany(
            { documentId, revision: { $ne: revision }, lifecycle: { $ne: 'deleted' } },
            { $set: { lifecycle: 'superseded', updatedAt: this.clock() } }
        )
    }

    async setDocumentLifecycle(documentId, lifecycle, patch = {}) {
        return this.collection(COLLECTIONS.documents).updateOne(
            { documentId },
            { $set: { lifecycle, ...clone(patch), updatedAt: this.clock() } }
        )
    }

    async getAuthorizedSources(refs, scope) {
        if (!refs.length) return []
        const byKind = refs.reduce((map, ref) => {
            if (!map.has(ref.kind)) map.set(ref.kind, [])
            map.get(ref.kind).push(ref.id)
            return map
        }, new Map())
        const output = []
        if (byKind.has('memory')) {
            const memories = await this.collection(COLLECTIONS.memories).find({
                memoryId: { $in: byKind.get('memory') }, status: 'active', deletionEpoch: scope.deletionEpoch,
                'scope.guildId': scope.guildId, 'scope.continuityId': scope.continuityId,
                $or: [{ 'scope.audienceUserIds': { $exists: false } }, { 'scope.audienceUserIds': scope.userId }]
            }).toArray()
            for (const memory of memories) {
                const canonical = await Promise.all((memory.sourceTurnIds || []).map(turnId => this.isCanonicalTurn(scope.continuityId, turnId)))
                if (canonical.every(Boolean)) output.push(memory)
            }
        }
        if (byKind.has('episode')) {
            const episodes = await this.collection(COLLECTIONS.episodes).find({
                episodeId: { $in: byKind.get('episode') }, lifecycle: 'active', deletionEpoch: scope.deletionEpoch,
                guildId: scope.guildId, continuityId: scope.continuityId,
                $or: [{ audienceUserIds: { $exists: false } }, { audienceUserIds: scope.userId }]
            }).toArray()
            for (const episode of episodes) {
                const canonical = await Promise.all((episode.sourceTurnIds || []).map(turnId => this.isCanonicalTurn(scope.continuityId, turnId)))
                if (canonical.every(Boolean)) output.push(episode)
            }
        }
        if (byKind.has('lore')) {
            const chunks = await this.collection(COLLECTIONS.chunks).find({
                chunkId: { $in: byKind.get('lore') }, lifecycle: 'active',
                $or: [
                    { corpus: 'global_lore' },
                    { corpus: 'restricted_lore', guildId: scope.guildId, audienceUserIds: scope.userId }
                ]
            }).toArray()
            const documents = await this.collection(COLLECTIONS.documents).find({
                documentId: { $in: chunks.map(chunk => chunk.documentId) }, lifecycle: 'active'
            }, { projection: { documentId: 1, revision: 1 } }).toArray()
            const active = new Map(documents.map(document => [document.documentId, document.revision]))
            output.push(...chunks.filter(chunk => active.get(chunk.documentId) === chunk.revision))
        }
        return output
    }

    async bumpDeletionEpoch(scope, tombstone) {
        const now = this.clock()
        const result = await this.collection(COLLECTIONS.continuities).findOneAndUpdate({
            continuityId: scope.continuityId,
            status: { $ne: 'deleted' }
        }, {
            $inc: { deletionEpoch: 1 },
            $set: { updatedAt: now },
            $unset: { lease: '' }
        }, { returnDocument: 'after' })
        const continuity = result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result
        if (!continuity) return null
        await this.collection(COLLECTIONS.tombstones).insertOne({
            schemaVersion: 1,
            tombstoneId: this.id(),
            continuityId: scope.continuityId,
            userId: scope.userId || null,
            sceneId: scope.sceneId || null,
            sourceTurnId: scope.sourceTurnId || null,
            epoch: continuity.deletionEpoch,
            reason: tombstone.reason,
            requestedByUserId: tombstone.requestedByUserId,
            createdAt: now,
            updatedAt: now
        })
        return continuity.deletionEpoch
    }

    async installScopedTombstone(scope, tombstone, epoch) {
        const now = this.clock()
        await this.collection(COLLECTIONS.tombstones).insertOne({
            schemaVersion: 1,
            tombstoneId: this.id(),
            continuityId: scope.continuityId,
            userId: scope.userId || null,
            sceneId: scope.sceneId || null,
            sourceTurnId: scope.sourceTurnId || null,
            epoch,
            reason: tombstone.reason,
            requestedByUserId: tombstone.requestedByUserId,
            createdAt: now,
            updatedAt: now
        })
        return epoch
    }

    async isTombstoned(scope, epoch) {
        const clauses = []
        if (scope.userId) clauses.push({ userId: scope.userId })
        if (scope.sceneId) clauses.push({ sceneId: scope.sceneId })
        if (scope.sourceTurnId) clauses.push({ sourceTurnId: scope.sourceTurnId })
        if (!clauses.length) return false
        return Boolean(await this.collection(COLLECTIONS.tombstones).findOne({
            continuityId: scope.continuityId,
            epoch: { $gte: epoch },
            $or: clauses
        }, { projection: { _id: 1 } }))
    }
}

module.exports = { ChatRepository, duplicateKey }
