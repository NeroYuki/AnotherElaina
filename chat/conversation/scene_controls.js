'use strict'

const crypto = require('node:crypto')
const { COLLECTIONS } = require('../persistence/collections')
const { PERSONA_VERSION } = require('../persona/prompt_builder')
const { audienceIsCompatible } = require('../discord/permissions')

function bindingQuery(scope) {
    return { guildId: String(scope.guildId), channelId: String(scope.channelId), threadId: scope.threadId ? String(scope.threadId) : null }
}

class SceneControls {
    constructor(options) {
        this.repository = options.repository
        this.forgetService = options.forgetService
        this.loreIngestor = options.loreIngestor
        this.jobs = options.jobs
        this.clock = options.clock || (() => new Date())
        this.id = options.id || (() => crypto.randomUUID())
    }

    async binding(scope) {
        return this.repository.collection(COLLECTIONS.bindings).findOne(bindingQuery(scope))
    }

    async resolve(scope, actor, { create = false, title } = {}) {
        let binding = await this.binding(scope)
        if (!binding && create) binding = await this.newScene(scope, actor, { title })
        if (!binding) return null
        const [scene, continuity] = await Promise.all([
            this.repository.collection(COLLECTIONS.scenes).findOne({ sceneId: binding.activeSceneId }),
            this.repository.getContinuity(binding.continuityId)
        ])
        return scene && continuity && binding.enabled !== false && scene.status === 'active' && continuity.status === 'active' ? { binding, scene, continuity } : null
    }

    async newScene(scope, actor, input = {}) {
        const continuity = await this.repository.createContinuity({
            guildId: scope.guildId,
            ownerUserId: actor.userId,
            allowedAudienceUserIds: [actor.userId],
            personaVersion: PERSONA_VERSION
        })
        const participant = { userId: actor.userId, ownerUserId: actor.userId, characterId: `user:${actor.userId}`, displayName: actor.displayName || actor.username || 'Player' }
        const scene = await this.repository.createScene({ continuityId: continuity.continuityId, title: input.title || 'New scene', participants: [participant] })
        const record = {
            schemaVersion: 1,
            ...bindingQuery(scope),
            continuityId: continuity.continuityId,
            activeSceneId: scene.sceneId,
            enabled: true,
            observeParticipants: input.observeParticipants ?? true,
            followupWindowSeconds: 0,
            offline: false,
            ownerUserId: actor.userId,
            audienceUserIds: [actor.userId],
            createdAt: this.clock(),
            updatedAt: this.clock()
        }
        await this.repository.collection(COLLECTIONS.bindings).updateOne(bindingQuery(scope), { $set: record }, { upsert: true })
        return record
    }

    async joinParticipant(resolved, actor) {
        if (resolved.scene.participants?.some(item => String(item.userId) === actor.userId)) return resolved
        const participant = { userId: actor.userId, ownerUserId: actor.userId, characterId: `user:${actor.userId}`, displayName: actor.displayName || actor.username || 'Player' }
        await this.repository.collection(COLLECTIONS.scenes).updateOne({ sceneId: resolved.scene.sceneId }, { $addToSet: { participants: participant }, $set: { updatedAt: this.clock() } })
        await this.repository.collection(COLLECTIONS.continuities).updateOne({ continuityId: resolved.continuity.continuityId }, { $addToSet: { allowedAudienceUserIds: actor.userId }, $set: { updatedAt: this.clock() } })
        resolved.scene.participants = [...(resolved.scene.participants || []), participant]
        resolved.continuity.allowedAudienceUserIds = [...new Set([...(resolved.continuity.allowedAudienceUserIds || []), actor.userId])]
        return resolved
    }

    async execute(request) {
        const { action, scope, actor, input = {} } = request
        if (action === 'scene.new') {
            const binding = await this.newScene(scope, actor, input)
            return { ok: true, message: `Started a fresh scene (${binding.activeSceneId}). Older scenes were not deleted.` }
        }
        const resolved = await this.resolve(scope, actor)
        if (!resolved) return { ok: false, message: 'There is no active scene in this channel.' }
        const owner = actor.isOwner || actor.isModerator || resolved.continuity.ownerUserId === actor.userId
        if (action === 'scene.status') return { ok: true, message: `Scene: ${resolved.scene.title}\nID: ${resolved.scene.sceneId}\nParticipants: ${(resolved.scene.participants || []).map(item => item.displayName).join(', ') || 'none'}\nRaw retention: 90 days\nExternal search: ${resolved.binding.offline ? 'off' : 'on'}` }
        if (action === 'scene.end') {
            if (!owner) return { ok: false, message: 'Only the scene owner or a moderator can end this scene.' }
            await this.repository.collection(COLLECTIONS.scenes).updateOne({ sceneId: resolved.scene.sceneId }, { $set: { status: 'ended', endedAt: this.clock(), updatedAt: this.clock() } })
            await this.repository.collection(COLLECTIONS.bindings).updateOne(bindingQuery(scope), { $set: { enabled: false, updatedAt: this.clock() } })
            return { ok: true, message: 'The scene has ended. Its stored records were not deleted.' }
        }
        if (action === 'scene.resume') {
            const scene = await this.repository.collection(COLLECTIONS.scenes).findOne({ sceneId: input.sceneId })
            if (!scene) return { ok: false, message: 'That scene does not exist.' }
            const continuity = await this.repository.getContinuity(scene.continuityId)
            const canResumeTarget = actor.isOwner || actor.isModerator || continuity?.ownerUserId === actor.userId || continuity?.allowedAudienceUserIds?.includes(actor.userId)
            const compatible = audienceIsCompatible(
                { guildId: continuity?.guildId, allowedUserIds: continuity?.allowedAudienceUserIds || [] },
                { guildId: scope.guildId, allowedUserIds: scope.allowedUserIds || [] }
            )
            if (!continuity || continuity.guildId !== String(scope.guildId) || !canResumeTarget || !compatible) return { ok: false, message: 'That scene is not authorized for this channel audience.' }
            await this.repository.collection(COLLECTIONS.bindings).updateOne(bindingQuery(scope), { $set: { continuityId: scene.continuityId, activeSceneId: scene.sceneId, enabled: true, updatedAt: this.clock() } }, { upsert: true })
            return { ok: true, message: `Resumed ${scene.title} (${scene.sceneId}).` }
        }
        if (action === 'scene.character') {
            const characterId = `user:${actor.userId}`
            await this.repository.collection(COLLECTIONS.characters).updateOne({ continuityId: resolved.continuity.continuityId, characterId }, { $set: { schemaVersion: 1, continuityId: resolved.continuity.continuityId, characterId, ownerUserId: actor.userId, displayName: input.name, description: input.description, updatedAt: this.clock() }, $setOnInsert: { createdAt: this.clock() } }, { upsert: true })
            await this.repository.collection(COLLECTIONS.scenes).updateOne({ sceneId: resolved.scene.sceneId, 'participants.userId': actor.userId }, { $set: { 'participants.$.displayName': input.name, updatedAt: this.clock() } })
            return { ok: true, message: `Your player character is now ${input.name}.` }
        }
        if (action === 'scene.settings') {
            if (!owner) return { ok: false, message: 'Only the scene owner or a moderator can change scene settings.' }
            const patch = { updatedAt: this.clock() }
            for (const key of ['observeParticipants', 'followupWindowSeconds', 'offline']) if (input[key] !== null && input[key] !== undefined) patch[key] = input[key]
            await this.repository.collection(COLLECTIONS.bindings).updateOne(bindingQuery(scope), { $set: patch })
            return { ok: true, message: 'Scene settings updated.' }
        }
        return this._memoryOrLore(request, resolved, owner)
    }

    async _memoryOrLore(request, resolved, owner) {
        const { action, actor, input = {} } = request
        const continuityId = resolved.continuity.continuityId
        if (action === 'memory.clear.channel') {
            if (!actor.isOwner) return { ok: false, message: 'Only the bot owner can clear a channel scene.' }
            const result = await this.forgetService.forget({ continuityId, sceneId: resolved.scene.sceneId }, { reason: 'owner_channel_clear', requestedByUserId: actor.userId })
            return { ok: result.found && result.verification?.complete !== false, message: result.verification?.complete === false ? 'Deletion ran, but verification is incomplete.' : 'The active channel scene and its derived memory were deleted.' }
        }
        if (action === 'memory.show') {
            const filter = { 'scope.continuityId': continuityId, status: 'active', $or: [{ userId: actor.userId }, { 'scope.audienceUserIds': actor.userId }] }
            if (input.kind !== 'all') filter.kind = input.kind
            const records = await this.repository.listActiveMemories(filter, { limit: input.limit || 10 })
            return { ok: true, message: records.length ? records.map(item => `${item.memoryId}: ${item.statement}\nEvidence: ${(item.sourceTurnIds || []).join(', ')}`).join('\n\n') : 'No eligible memories found.' }
        }
        if (action === 'memory.forget') {
            const memory = await this.repository.collection(COLLECTIONS.memories).findOne({ memoryId: input.memoryId, 'scope.continuityId': continuityId, status: 'active' })
            if (!memory || (!owner && memory.userId !== actor.userId && memory.subjectCharacterId !== `user:${actor.userId}`)) return { ok: false, message: 'That memory is unavailable or not yours to remove.' }
            const result = await this.forgetService.forget({ continuityId, sourceTurnId: memory.sourceTurnIds?.[0] }, { reason: 'memory_forget', requestedByUserId: actor.userId })
            return { ok: result.found, message: result.found ? 'The memory and its eligible derivatives were removed.' : 'Memory not found.' }
        }
        if (action === 'memory.clear.prepare') {
            if (input.scope === 'shared_scene' && !owner) return { ok: false, message: 'Only the scene owner or a moderator can clear a shared scene.' }
            const id = this.id()
            const record = { schemaVersion: 1, jobId: id, type: 'control_confirmation', entityId: id, continuityId, expectedEpoch: resolved.continuity.deletionEpoch, expectedRevision: resolved.continuity.revision, idempotencyKey: `confirmation:${id}`, payload: { action: 'memory_clear', requestedByUserId: actor.userId, scope: input.scope, sceneId: resolved.scene.sceneId }, state: 'waiting_confirmation', attempts: 0, nextRunAt: new Date(Date.now() + 10 * 60_000), expiresAt: new Date(Date.now() + 10 * 60_000), createdAt: this.clock(), updatedAt: this.clock() }
            await this.repository.collection(COLLECTIONS.jobs).insertOne(record)
            return { ok: true, message: 'Confirm deletion of stored bot memory. Existing Discord messages are not deleted.', confirmation: { id, revision: resolved.continuity.revision } }
        }
        if (action === 'memory.export') {
            const turns = await this.repository.collection(COLLECTIONS.turns).find({ continuityId, ...(input.scope === 'my_data' ? { authorUserId: actor.userId } : { sceneId: resolved.scene.sceneId }), lifecycle: { $in: ['committed', 'finalized'] } }).limit(500).toArray()
            const memories = await this.repository.listActiveMemories({ 'scope.continuityId': continuityId, ...(input.scope === 'my_data' ? { userId: actor.userId } : { 'scope.sceneId': resolved.scene.sceneId }) }, { limit: 500 })
            return { ok: true, message: 'Authorized chat-memory export.', export: { schemaVersion: 1, exportedAt: this.clock(), scene: resolved.scene, turns, memories } }
        }
        if (action === 'memory.optout') {
            await this.repository.collection(COLLECTIONS.characters).updateOne({ continuityId, characterId: `user:${actor.userId}` }, { $set: { memoryOptOut: Boolean(input.enabled), updatedAt: this.clock() }, $setOnInsert: { schemaVersion: 1, continuityId, characterId: `user:${actor.userId}`, ownerUserId: actor.userId, createdAt: this.clock() } }, { upsert: true })
            return { ok: true, message: input.enabled ? 'Durable personal memory extraction is disabled.' : 'Durable personal memory extraction is enabled.' }
        }
        if (action.startsWith('lore.') && !(actor.isOwner || actor.isModerator)) return { ok: false, message: 'Only the bot owner or a server moderator can manage lore.' }
        if (action === 'lore.add') {
            const job = await this.jobs.enqueue({ type: 'ingest_lore', continuityId, expectedEpoch: resolved.continuity.deletionEpoch, idempotencyKey: `lore:${this.id()}`, payload: { source: input.source, label: input.label, ownerUserId: actor.userId, guildId: resolved.continuity.guildId } })
            return { ok: true, message: `Lore ingestion queued (${job.jobId}).` }
        }
        if (action === 'lore.remove') {
            const source = await this.repository.collection(COLLECTIONS.documents).findOne({ sourceKey: input.sourceId, lifecycle: { $ne: 'deleted' } })
            if (!source || (source.corpus === 'global_lore' ? !actor.isOwner : (!actor.isOwner && source.guildId !== resolved.continuity.guildId))) return { ok: false, message: 'That lore source is unavailable or outside your authority.' }
            const removed = await this.loreIngestor.remove(input.sourceId, { documentId: source.documentId, guildId: source.guildId, corpus: source.corpus })
            return { ok: removed > 0, message: removed ? 'Lore source removed and blocked from retrieval.' : 'Lore source not found.' }
        }
        if (action === 'lore.status') {
            const docs = await this.repository.collection(COLLECTIONS.documents).find(actor.isOwner ? {} : { guildId: resolved.continuity.guildId, corpus: 'restricted_lore' }).sort({ updatedAt: -1 }).limit(input.limit || 10).toArray()
            return { ok: true, message: docs.length ? docs.map(item => `${item.sourceKey}: ${item.lifecycle}`).join('\n') : 'No lore sources found.' }
        }
        if (action === 'lore.reindex') {
            const job = await this.jobs.enqueue({ type: 'reindex_all', continuityId, expectedEpoch: resolved.continuity.deletionEpoch, idempotencyKey: `reindex:${input.sourceId || 'all'}:${Date.now()}`, payload: { sourceId: input.sourceId } })
            return { ok: true, message: `Reindex queued (${job.jobId}).` }
        }
        return { ok: false, message: 'Unsupported chat control.' }
    }

    async getControlContext(request) {
        if (request.action === 'memory_clear') {
            const confirmation = await this.repository.collection(COLLECTIONS.jobs).findOne({ jobId: request.entityId, type: 'control_confirmation', state: 'waiting_confirmation' })
            if (!confirmation) return null
            return { revision: confirmation.expectedRevision, allowedUserId: confirmation.payload.requestedByUserId, expiresAt: confirmation.expiresAt }
        }
        const turn = await this.repository.getTurn(request.entityId)
        if (!turn) return null
        return { revision: turn.committedRevision, allowedUserId: turn.authorUserId }
    }

    async executeComponent(request) {
        if (request.action === 'memory_clear') {
            const confirmation = await this.repository.collection(COLLECTIONS.jobs).findOneAndUpdate({ jobId: request.input.entityId, type: 'control_confirmation', state: 'waiting_confirmation', expiresAt: { $gt: this.clock() } }, { $set: { state: 'confirmed', updatedAt: this.clock() } }, { returnDocument: 'after' })
            const record = confirmation?.value || confirmation
            if (!record) return { ok: false, message: 'This confirmation is stale.' }
            const scope = record.payload.scope === 'shared_scene' ? { continuityId: record.continuityId, sceneId: record.payload.sceneId } : { continuityId: record.continuityId, ...(record.payload.scope === 'my_scene' ? { sceneId: record.payload.sceneId } : {}), userId: request.actor.userId }
            const result = await this.forgetService.forget(scope, { reason: 'confirmed_clear', requestedByUserId: request.actor.userId })
            return { ok: result.verification?.complete !== false, message: result.verification?.complete === false ? 'Deletion ran but verification is incomplete. Check service status.' : 'Stored content in the selected scope was deleted and verified.' }
        }
        return null
    }
}

module.exports = { SceneControls, bindingQuery }
