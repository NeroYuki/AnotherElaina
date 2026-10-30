'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { COLLECTIONS } = require('../persistence/collections')
const { LeaseLostError } = require('../persistence/leases')
const { ReindexLifecycleStore } = require('../persistence/reindex_lifecycle')
const { normalizedTerms } = require('./lexical')
const { pointId } = require('./vector_index')

const MAX_FILE_BYTES = 1024 * 1024

function cleanupWarning(code, collection, error, at) {
    return {
        code,
        collection: collection || null,
        message: String(error?.message || error).slice(0, 1000),
        at
    }
}

function queuePending(pending, entry) {
    if (pending.some(item => item?.collection === entry.collection)) return pending
    return [...pending, entry]
}

function queuePendingAll(pending, collections, reason, at) {
    let output = pending
    for (const collection of collections) output = queuePending(output, { collection, reason, queuedAt: at })
    return output
}

function dedupePending(pending) {
    const seen = new Set()
    return pending.filter(entry => {
        if (!entry?.collection || seen.has(entry.collection)) return false
        seen.add(entry.collection)
        return true
    })
}

function contentHash(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function deterministicId(value) {
    const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 32)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function tokenizeWithOffsets(text) {
    const tokens = []
    const expression = /\S+/gu
    let match
    while ((match = expression.exec(text))) tokens.push({ start: match.index, end: match.index + match[0].length })
    return tokens
}

function chunkText(text, options = {}) {
    const target = options.targetTokens || 300
    const overlap = options.overlapTokens || 40
    const min = options.minTokens || 250
    const max = options.maxTokens || 350
    if (target < min || target > max || overlap >= min) throw new TypeError('Invalid chunking limits')
    const sections = []
    const sectionExpression = /(?:^|\n)(?:#{1,6}\s+[^\n]+|[^\n]+)(?:\n(?!\n)[\s\S]*?)?(?=\n\s*\n|$)/g
    let sectionMatch
    while ((sectionMatch = sectionExpression.exec(text))) {
        const value = sectionMatch[0].replace(/^\n/, '')
        const start = sectionMatch.index + (sectionMatch[0].startsWith('\n') ? 1 : 0)
        if (value.trim()) sections.push({ text: value, start })
    }
    if (!sections.length && text.trim()) sections.push({ text, start: 0 })

    const chunks = []
    for (const section of sections) {
        const tokens = tokenizeWithOffsets(section.text)
        if (!tokens.length) continue
        if (tokens.length <= max) {
            chunks.push({ text: section.text.trim(), startOffset: section.start, endOffset: section.start + section.text.length, tokenCount: tokens.length })
            continue
        }
        let startToken = 0
        while (startToken < tokens.length) {
            let endToken = Math.min(tokens.length, startToken + target)
            if (tokens.length - endToken < min / 2) endToken = tokens.length
            const startOffset = section.start + tokens[startToken].start
            const endOffset = section.start + tokens[endToken - 1].end
            chunks.push({ text: text.slice(startOffset, endOffset), startOffset, endOffset, tokenCount: endToken - startToken })
            if (endToken === tokens.length) break
            startToken = Math.max(startToken + 1, endToken - overlap)
        }
    }
    return chunks
}

function validateLocalPath(filePath) {
    const extension = path.extname(filePath).toLowerCase()
    if (!['.md', '.txt'].includes(extension)) throw new Error('Lore files must be .md or .txt')
    if (path.normalize(filePath).split(path.sep).some(part => part.startsWith('.'))) throw new Error('Hidden paths cannot be ingested')
}

class LoreIngestor {
    constructor(options) {
        this.repository = options.repository
        this.embedder = options.embedder
        this.vectorIndex = options.vectorIndex
        this.maxFileBytes = options.maxFileBytes || MAX_FILE_BYTES
        this.clock = options.clock || (() => new Date())
        this.urlFetcher = options.urlFetcher || null
    }

    async ingestFile(filePath, metadata = {}) {
        validateLocalPath(filePath)
        const stat = await fs.stat(filePath)
        if (!stat.isFile() || stat.size > this.maxFileBytes) throw new Error(`Lore file must be at most ${this.maxFileBytes} bytes`)
        const buffer = await fs.readFile(filePath)
        if (buffer.includes(0)) throw new Error('Binary lore files are not supported')
        return this.ingestText(buffer.toString('utf8'), {
            ...metadata,
            sourceKey: metadata.sourceKey || `file:${path.resolve(filePath)}`,
            title: metadata.title || path.basename(filePath),
            sourceType: 'file'
        })
    }

    async ingestUrl(rawUrl, metadata = {}) {
        let url
        try { url = new URL(rawUrl) } catch { throw new Error('Lore URL is invalid') }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Lore URL must be credential-free HTTP(S)')
        if (!this.urlFetcher) throw new Error('URL ingestion requires the injected safe web fetcher')
        const fetched = await this.urlFetcher(url.toString(), { maxBytes: this.maxFileBytes })
        if (!fetched || typeof fetched.text !== 'string') throw new Error('Safe web fetcher returned no plain text')
        return this.ingestText(fetched.text, {
            ...metadata,
            sourceKey: metadata.sourceKey || `url:${fetched.url || fetched.finalUrl || url.toString()}`,
            sourceUrl: fetched.url || fetched.finalUrl || url.toString(),
            title: metadata.title || fetched.title || url.hostname,
            sourceType: 'url'
        })
    }

    async ingestText(text, metadata) {
        if (typeof text !== 'string' || !text.trim()) throw new Error('Lore text cannot be empty')
        if (Buffer.byteLength(text) > this.maxFileBytes) throw new Error(`Lore text must be at most ${this.maxFileBytes} bytes`)
        if (!metadata.sourceKey) throw new Error('Lore sourceKey is required')
        const hash = contentHash(text)
        const documents = this.repository.collection(COLLECTIONS.documents)
        const prior = await documents.findOne({ sourceKey: metadata.sourceKey, corpus: metadata.corpus || 'global_lore', guildId: metadata.guildId || null, continuityId: metadata.continuityId || null }, { sort: { revision: -1 } })
        if (prior?.contentHash === hash && prior.lifecycle === 'active') return { document: prior, unchanged: true, chunks: [] }
        const revision = (prior?.revision || 0) + 1
        const now = this.clock()
        const documentId = deterministicId(`${metadata.sourceKey}\0${hash}\0${revision}`)
        const document = await this.repository.upsertDocument({
            documentId,
            sourceKey: metadata.sourceKey,
            sourceType: metadata.sourceType || 'text',
            sourceUrl: metadata.sourceUrl || null,
            provenanceSource: metadata.source || null,
            sourceVersion: metadata.sourceVersion || null,
            title: metadata.title || metadata.sourceKey,
            contentHash: hash,
            revision,
            corpus: metadata.corpus || 'global_lore',
            guildId: metadata.guildId || null,
            continuityId: metadata.continuityId || null,
            sceneId: metadata.sceneId || null,
            audienceUserIds: metadata.audienceUserIds || [],
            ownerUserId: metadata.ownerUserId || null,
            sourceTurnId: metadata.sourceTurnId || null,
            tags: normalizedTerms((metadata.tags || []).join(' ')),
            lifecycle: 'indexing',
            deletionEpoch: metadata.deletionEpoch || 0,
            createdAt: now
        })
        const rawChunks = chunkText(text)
        const chunks = rawChunks.map((chunk, index) => ({
            schemaVersion: 1,
            chunkId: deterministicId(`${documentId}\0${index}\0${hash}`),
            documentId,
            sourceKey: metadata.sourceKey,
            revision,
            chunkIndex: index,
            text: chunk.text,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            tokenCount: chunk.tokenCount,
            contentHash: contentHash(chunk.text),
            corpus: document.corpus,
            guildId: document.guildId,
            continuityId: document.continuityId,
            sceneId: document.sceneId,
            audienceUserIds: document.audienceUserIds,
            ownerUserId: document.ownerUserId,
            sourceTurnId: document.sourceTurnId,
            tags: document.tags,
            normalizedTerms: normalizedTerms(`${document.title} ${document.tags.join(' ')}`),
            lifecycle: 'indexing',
            deletionEpoch: document.deletionEpoch,
            createdAt: now,
            updatedAt: now
        }))
        await this.repository.replaceDocumentChunks(documentId, revision, chunks)
        const vectors = await this.embedder.embedPassages(chunks.map(chunk => chunk.text))
        await this.vectorIndex.upsert(chunks.map((chunk, index) => ({
            id: chunk.chunkId,
            vector: vectors[index],
            payload: {
                corpus: chunk.corpus,
                corpusKind: 'lore',
                guildId: chunk.guildId,
                continuityId: chunk.continuityId,
                sceneId: chunk.sceneId,
                audienceUserIds: chunk.audienceUserIds,
                documentId,
                sourceRevision: `${revision}:${hash}`,
                deletionEpoch: chunk.deletionEpoch,
                lifecycle: 'active'
            }
        })))
        await this.repository.collection(COLLECTIONS.chunks).updateMany({ documentId }, { $set: { lifecycle: 'active', updatedAt: this.clock() } })
        await this.repository.setDocumentLifecycle(documentId, 'active', { indexedAt: this.clock(), chunkCount: chunks.length })
        if (prior) {
            await documents.updateMany({ sourceKey: metadata.sourceKey, documentId: { $ne: documentId } }, { $set: { lifecycle: 'superseded', updatedAt: this.clock() } })
            await this.repository.collection(COLLECTIONS.chunks).updateMany({ sourceKey: metadata.sourceKey, documentId: { $ne: documentId } }, { $set: { lifecycle: 'superseded', updatedAt: this.clock() } })
            await this.vectorIndex.deleteByFilter({ documentId: prior.documentId })
        }
        return { document: { ...document, lifecycle: 'active' }, unchanged: false, chunks }
    }

    async remove(sourceKey, scope = {}) {
        const now = this.clock()
        const filter = { sourceKey, lifecycle: { $ne: 'deleted' }, ...(scope.documentId ? { documentId: scope.documentId } : {}), ...(scope.guildId !== undefined ? { guildId: scope.guildId } : {}), ...(scope.corpus ? { corpus: scope.corpus } : {}) }
        const documents = await this.repository.collection(COLLECTIONS.documents).find(filter).toArray()
        const ids = documents.map(document => document.documentId)
        if (!ids.length) return 0
        await this.repository.collection(COLLECTIONS.documents).updateMany({ documentId: { $in: ids } }, { $set: { lifecycle: 'deleted', updatedAt: now } })
        await this.repository.collection(COLLECTIONS.chunks).updateMany({ documentId: { $in: ids } }, { $set: { lifecycle: 'deleted', text: '[deleted]', updatedAt: now } })
        for (const document of documents) await this.vectorIndex.deleteByFilter({ documentId: document.documentId })
        return documents.length
    }
}

class Reindexer {
    constructor(options) {
        this.repository = options.repository
        this.embedder = options.embedder
        this.vectorIndex = options.vectorIndex
        this.batchSize = options.batchSize || 32
        this.clock = options.clock || (() => new Date())
        this.leaseMs = options.leaseMs || 120000
        this.heartbeatMs = options.heartbeatMs || Math.max(1000, Math.floor(this.leaseMs / 3))
        this.uniqueSuffix = options.uniqueSuffix || (() => crypto.randomUUID().replace(/-/g, '').slice(0, 10))
        this.lifecycle = options.lifecycleStore || new ReindexLifecycleStore({
            db: options.repository?.db,
            url: options.qdrantUrl || this.vectorIndex?.url,
            alias: options.alias || this.vectorIndex?.alias,
            clock: this.clock,
            ownerId: options.ownerId,
            durationMs: this.leaseMs
        })
    }

    async run(options = {}) {
        const lease = await this.lifecycle.acquire()
        if (!lease) throw new LeaseLostError('Another reindex is already running for this Qdrant alias')

        const cleanup = { deleted: [], pending: [], warnings: [] }
        let heartbeatError = null
        let heartbeat = null
        const assertLease = async () => {
            if (heartbeatError) throw heartbeatError
            await this.lifecycle.assertValid(lease)
        }

        try {
            heartbeat = setInterval(() => {
                this.lifecycle.renew(lease).catch(error => { heartbeatError = error })
            }, this.heartbeatMs)
            heartbeat.unref?.()

            const initial = await this.lifecycle.get()
            let history = Array.isArray(initial?.history) ? [...initial.history] : []
            let pending = Array.isArray(initial?.pendingDeletions) ? [...initial.pendingDeletions] : []
            if (initial?.build?.collection && initial.build.ownerId !== lease.ownerId) {
                const staleBuild = initial.build.collection
                try {
                    if (await this._aliasTarget() === staleBuild) {
                        if (!history.some(entry => entry?.collection === staleBuild)) {
                            history.push({ collection: staleBuild, role: 'active', owned: true, recovered: true, createdAt: this.clock() })
                        }
                    } else {
                        pending = queuePending(pending, {
                            collection: staleBuild,
                            reason: 'stale_build',
                            queuedAt: this.clock()
                        })
                    }
                } catch {
                    pending = queuePending(pending, {
                        collection: staleBuild,
                        reason: 'stale_build',
                        queuedAt: this.clock()
                    })
                }
            }
            if (pending.length) {
                try {
                    const active = await this._aliasTarget()
                    if (active && pending.some(entry => entry?.collection === active)) {
                        pending = pending.filter(entry => entry?.collection !== active)
                        if (!history.some(entry => entry?.collection === active)) {
                            history.push({ collection: active, role: 'active', owned: true, recovered: true, createdAt: this.clock() })
                        }
                    }
                } catch {
                    // Cleanup will fail safe later rather than delete an unverified alias target.
                }
            }

            const customCollection = Boolean(options.collection)
            const collection = options.collection || this._buildCollectionName()
            const owned = !customCollection
            if (customCollection) {
                history = this._recordNoSwitchBuild(history, collection, false)
                pending = pending.filter(entry => entry?.collection !== collection)
            }
            await this._persist(lease, owned ? {
                build: {
                    collection,
                    startedAt: this.clock(),
                    ownerId: lease.ownerId,
                    fencingToken: lease.fencingToken
                },
                history,
                pendingDeletions: pending
            } : { build: null, history, pendingDeletions: pending })

            let indexed = 0
            let published = false
            try {
                await assertLease()
                await this.vectorIndex.ensureCollection(collection)
                for (const source of this._sources()) {
                    let batch = []
                    for await (const record of source.cursor) {
                        batch.push(source.map(record))
                        if (batch.length >= this.batchSize) {
                            indexed += await this._indexBatch(batch, collection)
                            batch = []
                            await assertLease()
                        }
                    }
                    if (batch.length) {
                        indexed += await this._indexBatch(batch, collection)
                        await assertLease()
                    }
                }
                await assertLease()
                const verified = await this.vectorIndex.count(collection)
                if (verified !== indexed) {
                    throw Object.assign(new Error(`Qdrant rebuild verification failed: indexed ${indexed}, collection contains ${verified}`), {
                        code: 'CHAT_REINDEX_VERIFY_FAILED'
                    })
                }
                await assertLease()

                let previous = null
                let skipPrune = false
                if (!options.noSwitch) {
                    try {
                        previous = await this._aliasTarget()
                    } catch (error) {
                        skipPrune = true
                        cleanup.warnings.push(cleanupWarning('ALIAS_READ_FAILED', null, error, this.clock()))
                    }
                    if (!previous && !skipPrune) {
                        previous = history.find(entry => entry?.collection && entry.role === 'active' && entry.owned)?.collection || null
                    }
                    try {
                        await assertLease()
                        await this.vectorIndex.switchAlias(collection)
                    } catch (error) {
                        if (error.code === 'CHAT_LEASE_LOST') throw error
                        await assertLease()
                        let aliases
                        try {
                            aliases = await this._listAliases()
                        } catch (readError) {
                            pending = queuePending(pending, { collection, reason: 'ambiguous_publish', queuedAt: this.clock() })
                            await this._persist(lease, { build: null, history, pendingDeletions: pending })
                            cleanup.pending = pending
                            cleanup.warnings.push(cleanupWarning('AMBIGUOUS_PUBLISH_UNVERIFIABLE', collection, readError, this.clock()))
                            error.chatCleanupHandled = true
                            throw error
                        }
                        const active = aliases.find(item => item.alias === this._aliasName())?.collection
                        if (active !== collection) {
                            error.reindexReason = 'ambiguous_publish'
                            throw error
                        }
                        cleanup.warnings.push(cleanupWarning('ALIAS_PUBLISH_AMBIGUOUS', collection, error, this.clock()))
                    }
                }
                published = !options.noSwitch
                await assertLease()

                if (!options.noSwitch) {
                    const retirement = this._retireHistory(history, { collection, owned, previous, skipPrune })
                    history = owned ? retirement.history : this._recordNoSwitchBuild(retirement.history, collection, false)
                    pending = queuePendingAll(pending, retirement.candidates, 'superseded_build', this.clock())
                    await this._persist(lease, { build: null, history, pendingDeletions: pending })
                    const result = skipPrune
                        ? { deleted: [], pending, warnings: [] }
                        : await this._runCleanup(lease, pending, assertLease, [collection, ...history.map(entry => entry.collection)])
                    cleanup.deleted.push(...result.deleted)
                    cleanup.pending = result.pending
                    cleanup.warnings.push(...result.warnings)
                    await this._persist(lease, { pendingDeletions: result.pending })
                } else {
                    if (owned) history = this._recordNoSwitchBuild(history, collection)
                    await this._persist(lease, { build: null, history, pendingDeletions: pending })
                    const result = await this._runCleanup(lease, pending, assertLease, [collection, ...history.map(entry => entry.collection)])
                    cleanup.deleted.push(...result.deleted)
                    cleanup.pending = result.pending
                    cleanup.warnings.push(...result.warnings)
                    await this._persist(lease, { pendingDeletions: result.pending })
                }

                return { collection, indexed, aliasSwitched: !options.noSwitch, cleanup }
            } catch (error) {
                if (error.code === 'CHAT_LEASE_LOST' || error.chatCleanupHandled) throw error
                if (published) {
                    cleanup.pending = pending
                    cleanup.warnings.push(cleanupWarning('POST_PUBLISH_CLEANUP_FAILED', collection, error, this.clock()))
                    return { collection, indexed, aliasSwitched: true, cleanup }
                }
                if (owned) {
                    const outcome = await this._cleanupFailedBuild(
                        lease,
                        collection,
                        error.reindexReason || 'failed_build',
                        pending,
                        assertLease
                    )
                    pending = outcome.pending
                    cleanup.deleted.push(...outcome.deleted)
                    cleanup.pending = pending
                    cleanup.warnings.push(...outcome.warnings)
                    await this._persist(lease, { build: null, history, pendingDeletions: pending })
                }
                error.cleanup = cleanup
                throw error
            }
        } finally {
            clearInterval(heartbeat)
            await this.lifecycle.release(lease).catch(() => false)
        }
    }

    _buildCollectionName() {
        const timestamp = new Date(this.clock()).getTime()
        const suffix = String(this.uniqueSuffix() || '').replace(/[^a-zA-Z0-9]+/g, '').slice(0, 12)
            || crypto.randomUUID().replace(/-/g, '').slice(0, 10)
        return `${this.vectorIndex.collection}_build_${timestamp}_${suffix}`
    }

    _aliasName() {
        return this.lifecycle.alias || this.vectorIndex.alias || 'chat_active'
    }

    async _listAliases() {
        if (typeof this.vectorIndex.listAliases !== 'function') {
            throw Object.assign(new Error('Qdrant adapter does not support listing aliases'), {
                code: 'CHAT_QDRANT_ALIAS_LIST_UNSUPPORTED'
            })
        }
        const aliases = await this.vectorIndex.listAliases()
        if (!Array.isArray(aliases)) {
            throw Object.assign(new Error('Qdrant returned an invalid alias list'), { code: 'CHAT_QDRANT_INVALID_RESPONSE' })
        }
        const normalized = aliases.map(item => ({ alias: item?.alias ?? item?.alias_name, collection: item?.collection ?? item?.collection_name }))
        if (normalized.some(item => typeof item.alias !== 'string' || !item.alias
            || typeof item.collection !== 'string' || !item.collection)) {
            throw Object.assign(new Error('Qdrant returned an invalid alias list'), { code: 'CHAT_QDRANT_INVALID_RESPONSE' })
        }
        return normalized
    }

    async _aliasTarget() {
        const target = (await this._listAliases()).find(item => item.alias === this._aliasName())
        return target?.collection || null
    }

    async _persist(lease, patch) {
        await this.lifecycle.update(lease, { $set: { ...patch, updatedAt: this.clock() } })
    }

    _retireHistory(history, { collection, owned, previous, skipPrune }) {
        if (skipPrune) {
            const tracked = history.filter(entry => entry?.collection !== collection)
            if (owned) tracked.push({ collection, role: 'active', owned: true, createdAt: this.clock(), activatedAt: this.clock() })
            return { history: tracked, candidates: [] }
        }
        const retained = []
        const candidates = []
        const previousEntry = history.find(entry => entry?.collection === previous && entry.owned)
        const rollback = previousEntry && previous !== collection ? previous : null
        for (const entry of history) {
            if (!entry || !entry.collection || entry.collection === collection) continue
            if (entry.role === 'manual' || entry.noSwitch) {
                retained.push(entry)
                continue
            }
            if (!entry.owned) continue
            if (entry.collection === rollback) {
                retained.push({ ...entry, role: 'rollback' })
                continue
            }
            candidates.push(entry.collection)
        }
        if (rollback && !retained.some(entry => entry.collection === rollback)) {
            retained.push({ ...previousEntry, role: 'rollback' })
        }
        if (owned) {
            retained.push({ collection, role: 'active', owned: true, createdAt: this.clock(), activatedAt: this.clock() })
        }
        return { history: retained, candidates: [...new Set(candidates)].filter(name => name !== collection) }
    }

    _recordNoSwitchBuild(history, collection, owned = true) {
        const retained = history.filter(entry => entry?.collection !== collection)
        retained.push({
            collection,
            role: 'manual',
            noSwitch: owned,
            owned,
            createdAt: this.clock()
        })
        return retained
    }

    async _cleanupFailedBuild(lease, collection, reason, pending, assertLease) {
        const outcome = { deleted: [], pending: [...pending], warnings: [] }
        let aliases
        try {
            await assertLease()
            aliases = await this._listAliases()
        } catch (error) {
            if (error.code === 'CHAT_LEASE_LOST') throw error
            outcome.pending = queuePending(outcome.pending, { collection, reason, queuedAt: this.clock() })
            outcome.warnings.push(cleanupWarning('FAILED_BUILD_ALIAS_CHECK_FAILED', collection, error, this.clock()))
            return outcome
        }
        if (aliases.some(item => item.collection === collection)) {
            outcome.pending = queuePending(outcome.pending, { collection, reason: 'aliased_failed_build', queuedAt: this.clock() })
            outcome.warnings.push(cleanupWarning('FAILED_BUILD_STILL_ALIASED', collection, new Error('The failed build is still referenced by an alias'), this.clock()))
            return outcome
        }
        try {
            await assertLease()
            await this.vectorIndex.deleteCollection(collection)
            outcome.deleted.push(collection)
        } catch (error) {
            if (error.code === 'CHAT_LEASE_LOST') throw error
            outcome.pending = queuePending(outcome.pending, { collection, reason, queuedAt: this.clock() })
            outcome.warnings.push(cleanupWarning('FAILED_BUILD_DELETE_FAILED', collection, error, this.clock()))
        }
        return outcome
    }

    async _runCleanup(lease, pending, assertLease, retained = []) {
        const outcome = { deleted: [], pending: [...pending], warnings: [] }
        if (!pending.length) return outcome
        const protectedNames = new Set([this.vectorIndex.collection, ...retained])
        const survivors = []
        for (const entry of pending) {
            if (!entry?.collection) continue
            if (protectedNames.has(entry.collection)) {
                survivors.push({ ...entry, reason: 'retained' })
                continue
            }
            await assertLease()
            let aliases
            try {
                aliases = await this._listAliases()
            } catch (error) {
                survivors.push(entry)
                outcome.warnings.push(cleanupWarning('CLEANUP_ALIAS_CHECK_FAILED', entry.collection, error, this.clock()))
                continue
            }
            if (aliases.some(item => item.collection === entry.collection)) {
                survivors.push({ ...entry, reason: 'aliased' })
                continue
            }
            await assertLease()
            try {
                await this.vectorIndex.deleteCollection(entry.collection)
                outcome.deleted.push(entry.collection)
            } catch (error) {
                if (error.code === 'CHAT_LEASE_LOST') throw error
                survivors.push(entry)
                outcome.warnings.push(cleanupWarning('CLEANUP_DELETE_FAILED', entry.collection, error, this.clock()))
            }
        }
        outcome.pending = dedupePending(survivors)
        return outcome
    }

    *_sources() {
        yield {
            cursor: this.repository.collection(COLLECTIONS.memories).find({ status: 'active' }),
            map: record => ({ id: record.memoryId, text: record.statement, payload: { corpus: 'memory', corpusKind: 'memory', guildId: record.scope.guildId, continuityId: record.scope.continuityId, sceneId: record.scope.sceneId, branchId: record.scope.branchId, audienceUserIds: record.scope.audienceUserIds || [], sourceRevision: record.derivationVersion, deletionEpoch: record.deletionEpoch, lifecycle: 'active', salience: record.salience || 0 } })
        }
        yield {
            cursor: this.repository.collection(COLLECTIONS.episodes).find({ lifecycle: 'active' }),
            map: record => ({ id: record.episodeId, text: record.summary, payload: { corpus: 'episode', corpusKind: 'episode', guildId: record.guildId, continuityId: record.continuityId, sceneId: record.sceneId, branchId: record.branchId, audienceUserIds: record.audienceUserIds || [], sourceRevision: record.derivationVersion, deletionEpoch: record.deletionEpoch, lifecycle: 'active' } })
        }
        yield {
            cursor: this.repository.collection(COLLECTIONS.chunks).find({ lifecycle: 'active' }),
            map: record => ({ id: record.chunkId, text: record.text, payload: { corpus: record.corpus, corpusKind: 'lore', guildId: record.guildId, continuityId: record.continuityId, sceneId: record.sceneId, audienceUserIds: record.audienceUserIds || [], documentId: record.documentId, sourceRevision: `${record.revision}:${record.contentHash}`, deletionEpoch: record.deletionEpoch, lifecycle: 'active' } })
        }
    }

    async _indexBatch(batch, collection) {
        const vectors = await this.embedder.embedPassages(batch.map(record => record.text))
        return this.vectorIndex.upsert(batch.map((record, index) => ({ ...record, vector: vectors[index] })), { collection })
    }
}

module.exports = { LoreIngestor, MAX_FILE_BYTES, Reindexer, chunkText, contentHash, deterministicId, pointId, validateLocalPath }
