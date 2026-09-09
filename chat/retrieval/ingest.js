'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { COLLECTIONS } = require('../persistence/collections')
const { normalizedTerms } = require('./lexical')
const { pointId } = require('./vector_index')

const MAX_FILE_BYTES = 1024 * 1024

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
    }

    async run(options = {}) {
        const collection = options.collection || `${this.vectorIndex.collection}_build_${Date.now()}`
        await this.vectorIndex.ensureCollection(collection)
        let indexed = 0
        for (const source of this._sources()) {
            let batch = []
            for await (const record of source.cursor) {
                batch.push(source.map(record))
                if (batch.length >= this.batchSize) {
                    indexed += await this._indexBatch(batch, collection)
                    batch = []
                }
            }
            if (batch.length) indexed += await this._indexBatch(batch, collection)
        }
        const verified = await this.vectorIndex.count(collection)
        if (verified !== indexed) throw new Error(`Qdrant rebuild verification failed: indexed ${indexed}, collection contains ${verified}`)
        if (!options.noSwitch) await this.vectorIndex.switchAlias(collection)
        return { collection, indexed, aliasSwitched: !options.noSwitch }
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
