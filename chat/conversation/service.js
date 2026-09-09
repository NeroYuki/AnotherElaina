'use strict'

const crypto = require('node:crypto')
const { normalizeDiscordMessage } = require('../discord/ingest')
const { DiscordResponder } = require('../discord/respond')
const { buildTurnComponents } = require('../discord/components')
const { renderSources } = require('../web/source_registry')
const { COLLECTIONS } = require('../persistence/collections')
const { buildContext } = require('./context_builder')
const { runToolLoop } = require('./turn_state')
const { runFallbackToolLoop } = require('../tools/controller')
const { KeyedQueue, Semaphore } = require('./queue')
const { isModerator } = require('../discord/permissions')

function actorFromEvent(event) {
    return {
        userId: event.author.id,
        username: event.author.username,
        displayName: event.author.displayName,
        isOwner: false,
        isModerator: false
    }
}

function composeDeadline(signal, timeoutMs) {
    const timeout = AbortSignal.timeout(timeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
}

class ConversationService {
    constructor(options) {
        this.config = options.config
        this.repository = options.repository
        this.leases = options.leases
        this.provider = options.provider
        this.retriever = options.retriever
        this.toolRegistry = options.toolRegistry
        this.toolRunner = options.toolRunner
        this.sceneControls = options.sceneControls
        this.jobs = options.jobs
        this.ownerIds = new Set((options.ownerIds || []).map(String))
        this.streamEnabled = options.streamEnabled !== false
        this.imageLoader = options.imageLoader || null
        this.queue = options.queue || new KeyedQueue()
        this.inference = options.inference || new Semaphore(this.config.inferenceConcurrency)
        this.accepting = true
    }

    async intake(client, message, signal) {
        if (!this.accepting) return
        const scope = {
            guildId: String(message.guildId || message.guild?.id || ''),
            channelId: String(message.channelId || message.channel?.id || ''),
            threadId: message.channel?.isThread?.() ? String(message.channel.id) : null
        }
        const existing = await this.sceneControls.resolve(scope, { userId: String(message.author.id) })
        const participant = existing?.scene?.participants?.some(item => String(item.userId) === String(message.author.id))
        const optedOut = existing ? Boolean(await this.repository.collection(COLLECTIONS.characters).findOne({ continuityId: existing.continuity.continuityId, ownerUserId: String(message.author.id), memoryOptOut: true })) : false
        const followupAddressed = Boolean(existing?.binding?.followupWindowSeconds > 0 && existing.binding.followupUserId === String(message.author.id) && Number(existing.binding.followupCount || 0) < 3 && new Date(existing.binding.followupExpiresAt).getTime() > Date.now())
        const normalized = await normalizeDiscordMessage({
            message,
            botUserId: client.user.id,
            enabled: globalThis.operating_mode !== 'disabled',
            observationEnabled: Boolean(existing?.binding?.observeParticipants ?? this.config.observeParticipants),
            isParticipant: participant,
            isOptedOut: optedOut,
            followupAddressed
        })
        if (normalized.kind === 'ignored') return normalized
        return this.handle({ normalized, message, signal, memoryOptOut: optedOut })
    }

    async handle({ normalized, message, signal, memoryOptOut = false }) {
        const event = normalized.event
        const initialKey = `${event.guildId}:${event.threadId || event.channelId}`
        return this.queue.run(initialKey, async () => {
            const actor = actorFromEvent(event)
            actor.isOwner = this.ownerIds.has(actor.userId)
            actor.isModerator = isModerator(message?.member)
            const scope = { guildId: event.guildId, channelId: event.channelId, threadId: event.threadId }
            let resolved = await this.sceneControls.resolve(scope, actor, { create: normalized.kind === 'addressed' })
            if (!resolved) return { ignored: true, reason: 'no_active_scene' }
            if (normalized.kind === 'addressed') resolved = await this.sceneControls.joinParticipant(resolved, actor)
            return this.queue.run(`continuity:${resolved.continuity.continuityId}`, () =>
                this.leases.withLease(resolved.continuity.continuityId, lease => this._commitEvent({ normalized, event, message, resolved, lease, signal, actor, memoryOptOut })))
        })
    }

    async _commitEvent({ normalized, event, message, resolved, lease, signal, actor, memoryOptOut }) {
        const continuity = await this.repository.getContinuity(resolved.continuity.continuityId)
        const eventId = crypto.randomUUID()
        const ordinal = continuity.revision + 1
        const input = {
            eventId,
            requestId: event.eventId,
            sourceDiscordMessageId: event.sourceMessageId,
            parentEventId: continuity.committedEventId,
            parentTurnId: resolved.scene.selectedHeadTurnId,
            continuityId: continuity.continuityId,
            sceneId: resolved.scene.sceneId,
            branchId: resolved.scene.branchId,
            guildId: event.guildId,
            channelId: event.channelId,
            ordinal,
            eventType: normalized.kind === 'observation' ? 'observation' : 'dialogue',
            role: 'user',
            authorUserId: event.author.id,
            authorCharacterId: `user:${event.author.id}`,
            authorDisplayName: event.author.displayName,
            authorIsOwner: actor.isOwner,
            authorIsModerator: actor.isModerator,
            memoryOptOut: Boolean(memoryOptOut),
            content: event.content,
            segments: event.segments,
            contentParts: [{ type: 'text', text: event.content }, ...event.attachments.map(item => ({ type: 'image', ...item }))],
            reply: event.reply,
            deletionEpoch: continuity.deletionEpoch,
            contextRevision: continuity.revision
        }
        const pending = await this.repository.insertPendingTurn(input)
        if (!pending.created) {
            if (['committed', 'finalized'].includes(pending.turn?.lifecycle)) return { duplicate: true, turn: pending.turn }
            if (pending.turn?.lifecycle === 'pending' && !pending.turn?.delivery?.messageIds?.length) await this.repository.updateTurn(pending.turn.eventId, { lifecycle: 'abandoned', abandonedReason: 'duplicate_after_interruption' }, 'pending')
            return { duplicate: true, uncertainDelivery: Boolean(pending.turn?.delivery?.messageIds?.length), turn: pending.turn }
        }
        const activeEventId = eventId
        if (normalized.kind === 'observation') {
            const committed = await this.repository.commitTurn({ continuityId: continuity.continuityId, eventId: activeEventId, parentEventId: continuity.committedEventId, expectedRevision: continuity.revision, expectedEpoch: continuity.deletionEpoch, lease })
            if (!committed.committed) throw Object.assign(new Error('Observation commit lost its continuity revision'), { code: 'CHAT_COMMIT_CONFLICT' })
            await this.repository.finalizeTurn(activeEventId)
            return { observation: true }
        }

        const responder = new DiscordResponder({ trigger: message, placeholder: 'Thinking...' })
        let delivered = false
        let canonicalCommitted = false
        let responseText = null
        const turnSignal = composeDeadline(signal, this.config.turnTimeoutMs)
        try {
            const placeholder = await responder.start()
            await this.repository.updateTurn(activeEventId, { delivery: { status: 'placeholder', messageIds: placeholder?.id ? [placeholder.id] : [] } }, 'pending')
            const result = await this.inference.run(() => this._generate({
                event, resolved, continuity, eventId: activeEventId, signal: turnSignal, actor,
                onDelta: this.streamEnabled ? text => responder.update(text) : null,
                onToolStart: this.streamEnabled ? () => responder.update('Looking that up...') : null
            }), turnSignal)
            const text = renderSources(result.text, result.sources)
            responseText = text
            if (!text) throw Object.assign(new Error('Elaina produced an empty response'), { code: 'CHAT_EMPTY_RESPONSE' })
            await this.repository.updateTurn(activeEventId, {
                response: { text, finishReason: result.finishReason, usage: result.usage, model: result.model, toolCallCount: result.toolCallCount },
                delivery: { status: 'draft', messageIds: responder.messageIds },
                generationCompletedAt: new Date()
            }, 'pending')
            const components = buildTurnComponents({ turnId: activeEventId, revision: continuity.revision + 1, includeDebug: this.ownerIds.has(event.author.id) })
            await this._assertNotForgotten(continuity, resolved.scene, event, activeEventId)
            const delivery = await responder.finalize(text, { components })
            delivered = true
            await this._assertNotForgotten(continuity, resolved.scene, event, activeEventId)
            await this.repository.updateTurn(activeEventId, { delivery: { status: 'delivered', messageIds: delivery.messageIds } }, 'pending')
            const committed = await this.repository.commitTurn({ continuityId: continuity.continuityId, eventId: activeEventId, parentEventId: continuity.committedEventId, expectedRevision: continuity.revision, expectedEpoch: continuity.deletionEpoch, lease })
            if (!committed.committed) throw Object.assign(new Error('Response was delivered but lost the continuity commit race'), { code: 'CHAT_COMMIT_CONFLICT' })
            canonicalCommitted = true
            await this.repository.finalizeTurn(activeEventId)
            await this.repository.updateTurn(activeEventId, { committedRevision: committed.revision })
            await this.repository.collection(COLLECTIONS.scenes).updateOne({ sceneId: resolved.scene.sceneId }, { $set: { selectedHeadTurnId: activeEventId, updatedAt: new Date() } })
            if (resolved.binding.followupWindowSeconds > 0) {
                const continuation = event.activation.followup
                await this.repository.collection(COLLECTIONS.bindings).updateOne({ guildId: event.guildId, channelId: event.channelId, threadId: event.threadId }, { $set: { followupUserId: event.author.id, followupCount: continuation ? Number(resolved.binding.followupCount || 0) + 1 : 0, followupExpiresAt: new Date(Date.now() + resolved.binding.followupWindowSeconds * 1000), updatedAt: new Date() } })
            }
            await this._enqueueDerivation({ eventId: activeEventId, event, text, resolved, continuity, revision: committed.revision })
            return { turnId: activeEventId, text, delivery }
        } catch (error) {
            if (canonicalCommitted) {
                await this.repository.updateTurn(activeEventId, { recoveryRequired: true, postCommitError: { code: error.code || 'CHAT_POST_COMMIT_FAILED', message: String(error.message).slice(0, 500) } })
                return { turnId: activeEventId, text: responseText, recoveryRequired: true }
            }
            await this.repository.updateTurn(activeEventId, { lifecycle: delivered ? 'uncertain_delivery' : 'failed', error: { code: error.code || 'CHAT_TURN_FAILED', message: String(error.message).slice(0, 500) } })
            if (!delivered) {
                const explanation = error.name === 'AbortError' || error.name === 'TimeoutError'
                    ? 'This turn timed out before I could finish. Please try again.'
                    : 'I could not complete that turn without risking the scene state. Please try again shortly.'
                await responder.finalize(explanation).catch(() => responder.close())
            }
            throw error
        } finally {
            await responder.close().catch(() => {})
        }
    }

    async _assertNotForgotten(continuity, scene, event, eventId) {
        const current = await this.repository.getContinuity(continuity.continuityId)
        if (!current || current.deletionEpoch !== continuity.deletionEpoch || await this.repository.isTombstoned({ continuityId: continuity.continuityId, sceneId: scene.sceneId, userId: event.author.id, sourceTurnId: eventId }, continuity.deletionEpoch)) {
            throw Object.assign(new Error('This turn was cancelled by a concurrent deletion'), { code: 'CHAT_SCOPE_DELETED' })
        }
    }

    async _generate({ event, resolved, continuity, eventId, signal, actor, onDelta, onToolStart }) {
        const unauthorized = this._unauthorizedRetcon(event, resolved.scene, actor)
        if (unauthorized) return { text: unauthorized, sources: [], finishReason: 'application_control', usage: null, model: 'deterministic-control', toolCallCount: 0 }
        const scope = {
            guildId: event.guildId,
            continuityId: continuity.continuityId,
            sceneId: resolved.scene.sceneId,
            branchId: resolved.scene.branchId,
            userId: event.author.id,
            deletionEpoch: continuity.deletionEpoch
        }
        const [turns, relationships, retrieval] = await Promise.all([
            this.repository.collection(COLLECTIONS.turns).find({ sceneId: resolved.scene.sceneId, branchId: resolved.scene.branchId, lifecycle: { $in: ['committed', 'finalized'] } }).sort({ ordinal: -1 }).limit(30).toArray().then(items => items.reverse()),
            this.repository.collection(COLLECTIONS.relationships).find({ continuityId: continuity.continuityId, lifecycle: { $ne: 'deleted' } }).limit(20).toArray(),
            this.retriever.search(`${event.content} ${(event.reply?.target?.content || '').slice(0, 500)}`, scope, { limit: 6, signal }).catch(error => ({ results: [], degraded: true, semanticError: error }))
        ])
        const images = await this._images(event.attachments, signal)
        const messages = buildContext({ event, scene: resolved.scene, relationships, retrieval: retrieval.results, turns, images })
        const trustedContext = {
            ...scope,
            turnId: eventId,
            externalSearchEnabled: !resolved.binding.offline,
            userProvidedUrls: (event.content.match(/https?:\/\/[^\s<>]+/gi) || []).slice(0, 3)
        }
        const loopOptions = {
            provider: this.provider,
            messages,
            tools: this.toolRegistry.openAITools({ trustedContext }),
            toolRunner: this.toolRunner,
            trustedContext,
            maxRounds: this.config.toolMaxRounds,
            maxCalls: this.config.toolMaxCalls,
            maxOutputTokens: event.content.includes('<think>') ? Math.min(1024, this.config.maxOutputTokens * 2) : this.config.maxOutputTokens,
            thinking: event.content.includes('<think>'),
            vision: images.length > 0,
            signal,
            turnId: eventId,
            onDelta,
            onToolStart
        }
        if (this.nativeTools === false) {
            const result = await runFallbackToolLoop({
                provider: this.provider,
                runner: this.toolRunner,
                registry: this.toolRegistry,
                messages,
                trustedContext,
                signal,
                maxRounds: this.config.toolMaxRounds,
                maxCalls: this.config.toolMaxCalls,
                generation: { maxOutputTokens: loopOptions.maxOutputTokens, thinking: false, jobId: eventId }
            })
            return { ...result, toolCallCount: 0 }
        }
        return runToolLoop(loopOptions)
    }

    _unauthorizedRetcon(event, scene, actor) {
        if (actor.isOwner || actor.isModerator || !event.segments?.some(segment => segment.mode === 'ooc')) return null
        if (!/\b(?:actually|correction|correct|retcon|instead|now)\b/i.test(event.content)) return null
        const other = (scene.participants || []).find(participant => String(participant.userId) !== actor.userId && participant.displayName && new RegExp(`\\b${String(participant.displayName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(event.content))
        return other ? `OOC: I can't change ${other.displayName}'s character facts on someone else's instruction. That player or a scene moderator must make the correction.` : null
    }

    async _images(attachments, signal) {
        if (!this.imageLoader) return []
        const output = []
        for (const attachment of attachments.filter(item => item.isImage).slice(0, 2)) {
            const encoded = await this.imageLoader(attachment.proxyUrl || attachment.url, signal)
            if (encoded) output.push(encoded.startsWith('data:') ? encoded : `data:${attachment.contentType || 'image/jpeg'};base64,${encoded}`)
        }
        return output
    }

    async _enqueueDerivation({ eventId, event, text, resolved, continuity, revision }) {
        await this.jobs.enqueue({
            type: 'extract_memory',
            entityId: eventId,
            sourceIds: [eventId],
            continuityId: continuity.continuityId,
            expectedEpoch: continuity.deletionEpoch,
            expectedRevision: revision,
            priority: -10,
            idempotencyKey: `extract:${eventId}:v1`,
            payload: { sceneId: resolved.scene.sceneId, branchId: resolved.scene.branchId }
        })
        if (revision % this.config.episodeTurnThreshold === 0) {
            await this.jobs.enqueue({
                type: 'summarize_episode',
                entityId: eventId,
                sourceIds: [eventId],
                continuityId: continuity.continuityId,
                expectedEpoch: continuity.deletionEpoch,
                expectedRevision: revision,
                priority: -20,
                idempotencyKey: `episode:${resolved.scene.sceneId}:${resolved.scene.branchId}:${revision}`,
                payload: { sceneId: resolved.scene.sceneId, branchId: resolved.scene.branchId }
            })
        }
    }

    async executeControl(request) {
        const component = await this.sceneControls.executeComponent(request)
        if (component) return component
        if (['continue', 'regenerate', 'debug', 'scene_status'].includes(request.action)) {
            const turn = await this.repository.getTurn(request.input.entityId)
            if (!turn) return { ok: false, message: 'That turn no longer exists.' }
            if (request.action === 'debug') return { ok: true, message: `Turn ${turn.eventId}\nModel: ${turn.response?.model || 'unknown'}\nRevision: ${turn.committedRevision || turn.contextRevision + 1}\nTools: ${turn.response?.toolCallCount || 0}\nLifecycle: ${turn.lifecycle}` }
            if (request.action === 'scene_status') return this.sceneControls.execute({ action: 'scene.status', actor: request.actor, scope: request.scope, input: {} })
            if (!request.deliveryInteraction) return { ok: false, message: 'This response control has no Discord delivery target.' }
            const scene = await this.repository.collection(COLLECTIONS.scenes).findOne({ sceneId: turn.sceneId })
            if (!scene || scene.selectedHeadTurnId !== turn.eventId) return { ok: false, message: 'Only the current scene head can be continued or regenerated.' }
            if (request.action === 'regenerate') {
                const replacement = await this._controlContinuation(request, turn)
                if (!replacement.ok) return replacement
                await this.repository.updateTurn(turn.eventId, { responseRejected: true, rejectedAt: new Date(), replacedByTurnId: replacement.turnId })
                await this.repository.collection(COLLECTIONS.memories).updateMany({ sourceTurnIds: { $in: [turn.eventId, `${turn.eventId}:assistant`] }, status: 'active' }, { $set: { status: 'retracted', retractedAt: new Date(), updatedAt: new Date() } })
                return replacement
            }
            return this._controlContinuation(request, turn)
        }
        return this.sceneControls.execute(request)
    }

    getControlContext(request) {
        return this.sceneControls.getControlContext(request)
    }

    async _controlContinuation(request, turn) {
        const interaction = request.deliveryInteraction
        const sourceMessageId = String(interaction.id || crypto.randomUUID())
        const instruction = request.action === 'regenerate'
            ? 'OOC: Regenerate your previous response from the same established scene evidence. Do not mention regeneration.'
            : 'OOC: Continue your previous response seamlessly without repeating it.'
        const event = {
            schemaVersion: 1,
            eventId: `discord-control:${sourceMessageId}`,
            source: 'discord_component',
            sourceMessageId,
            guildId: request.scope.guildId,
            channelId: request.scope.channelId,
            threadId: request.scope.threadId,
            author: { id: request.actor.userId, username: request.actor.username, displayName: request.actor.username || 'Player' },
            createdAt: new Date().toISOString(),
            rawContent: instruction,
            content: instruction,
            segments: [{ mode: 'ooc', raw: instruction, text: instruction.slice(5), start: 0, end: instruction.length, textStart: 5, textEnd: instruction.length }],
            mentions: { users: [], roles: [], channels: [] },
            attachments: [],
            reply: { target: { messageId: turn.delivery?.messageIds?.[0], authorId: 'elaina', content: turn.response?.text || '' } },
            activation: { mentioned: false, repliedToBot: true, attachmentOnly: false }
        }
        const trigger = interaction.message || interaction.channel
        const result = await this.handle({ normalized: { kind: 'addressed', reason: request.action, event }, message: trigger })
        return { ok: true, turnId: result.turnId, message: `${request.action === 'regenerate' ? 'Regenerated' : 'Continued'} as turn ${result.turnId}.` }
    }

    async stop() {
        this.accepting = false
        await this.queue.drain()
    }

    async invalidateDiscordMessage(message, reason = 'discord_message_changed') {
        const guildId = String(message.guildId || message.guild?.id || '')
        const sourceDiscordMessageId = String(message.id || '')
        if (!guildId || !sourceDiscordMessageId) return { invalidated: 0 }
        const turns = await this.repository.collection(COLLECTIONS.turns).find({ guildId, sourceDiscordMessageId, lifecycle: { $nin: ['deleted', 'superseded'] } }).toArray()
        for (const turn of turns) {
            await this.sceneControls.forgetService.forget({ continuityId: turn.continuityId, sourceTurnId: turn.eventId }, { reason, requestedByUserId: String(message.author?.id || 'discord') })
        }
        return { invalidated: turns.length }
    }
}

module.exports = { ConversationService, actorFromEvent, composeDeadline }
