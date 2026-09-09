'use strict'

const crypto = require('node:crypto')

function pointId(recordId) {
    const hex = crypto.createHash('sha256').update(String(recordId)).digest('hex').slice(0, 32)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function sanitize(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
}

function collectionName({ model, revision, dimension }) {
    return `chat_${sanitize(model)}_${revision.slice(0, 12)}_${dimension}_cosine`
}

function condition(key, value) {
    if (value && typeof value === 'object' && '$lt' in value) return { key, range: { lt: value.$lt } }
    if (Array.isArray(value)) return { key, match: { any: value } }
    return { key, match: { value } }
}

function scopeFilter(scope, options = {}) {
    const must = []
    if (!options.deleting) must.push(condition('lifecycle', 'active'))
    for (const key of ['deletionEpoch', 'sceneId', 'branchId', 'documentId', 'recordId']) {
        if (scope[key] !== undefined && scope[key] !== null) must.push(condition(key, scope[key]))
    }
    if (scope.recordIds?.length) must.push(condition('recordId', scope.recordIds))
    if (scope.corpora?.length) must.push(condition('corpus', scope.corpora))

    if (scope.guildId || scope.continuityId || scope.userId) {
        const scopedMust = []
        if (scope.guildId) scopedMust.push(condition('guildId', scope.guildId))
        if (scope.continuityId) scopedMust.push(condition('continuityId', scope.continuityId))
        if (scope.userId) scopedMust.push({
            should: [
                { is_empty: { key: 'audienceUserIds' } },
                condition('audienceUserIds', scope.userId)
            ]
        })
        const alternatives = [{ must: scopedMust }]
        if (scope.allowGlobalLore) alternatives.push({ must: [condition('corpus', 'global_lore')] })
        must.push({ should: alternatives })
    }
    return { must }
}

class QdrantVectorIndex {
    constructor(options) {
        this.url = String(options.url).replace(/\/$/, '')
        this.fetch = options.fetch || globalThis.fetch
        if (!this.fetch) throw new TypeError('QdrantVectorIndex requires fetch')
        this.apiKey = options.apiKey || null
        this.model = options.model
        this.revision = options.revision
        this.dimension = options.dimension || 384
        this.alias = options.alias || 'chat_active'
        this.collection = options.collection || collectionName(this)
    }

    async request(path, init = {}) {
        const response = await this.fetch(`${this.url}${path}`, {
            ...init,
            headers: {
                'content-type': 'application/json',
                ...(this.apiKey ? { 'api-key': this.apiKey } : {}),
                ...init.headers
            }
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) {
            const error = new Error(`Qdrant ${response.status}: ${body?.status?.error || body?.message || 'request failed'}`)
            error.code = 'CHAT_QDRANT_ERROR'
            error.status = response.status
            throw error
        }
        return body?.result
    }

    async health() {
        await this.request('/collections')
        return { reachable: true, collection: this.collection, alias: this.alias }
    }

    async ensureCollection(name = this.collection) {
        try {
            const current = await this.request(`/collections/${encodeURIComponent(name)}`)
            const size = current?.config?.params?.vectors?.size
            if (size !== this.dimension) throw new Error(`Qdrant collection ${name} has dimension ${size}, expected ${this.dimension}`)
        } catch (error) {
            if (error.status !== 404) throw error
            await this.request(`/collections/${encodeURIComponent(name)}`, {
                method: 'PUT',
                body: JSON.stringify({ vectors: { size: this.dimension, distance: 'Cosine' } })
            })
        }
        for (const [field, schema] of [
            ['recordId', 'keyword'], ['corpus', 'keyword'], ['guildId', 'keyword'],
            ['continuityId', 'keyword'], ['sceneId', 'keyword'], ['branchId', 'keyword'],
            ['audienceUserIds', 'keyword'], ['lifecycle', 'keyword'], ['sourceRevision', 'keyword'],
            ['deletionEpoch', 'integer']
        ]) {
            await this.request(`/collections/${encodeURIComponent(name)}/index`, {
                method: 'PUT', body: JSON.stringify({ field_name: field, field_schema: schema })
            }).catch(error => {
                if (error.status !== 409) throw error
            })
        }
        return name
    }

    async upsert(records, options = {}) {
        if (!records.length) return 0
        const name = options.collection || this.alias || this.collection
        await this.request(`/collections/${encodeURIComponent(name)}/points?wait=true`, {
            method: 'PUT',
            body: JSON.stringify({
                points: records.map(record => ({
                    id: pointId(record.id),
                    vector: record.vector,
                    payload: { ...record.payload, recordId: record.id, sourceRevision: record.payload.sourceRevision || this.revision }
                }))
            })
        })
        return records.length
    }

    async search(vector, scope, options = {}) {
        const name = options.collection || this.alias || this.collection
        const result = await this.request(`/collections/${encodeURIComponent(name)}/points/search`, {
            method: 'POST',
            body: JSON.stringify({
                vector,
                filter: scopeFilter(scope),
                limit: Math.min(options.limit || 20, 100),
                with_payload: true,
                with_vector: false
            }),
            signal: options.signal
        })
        return (result || []).map(item => ({
            id: item.payload.recordId,
            kind: item.payload.corpusKind || item.payload.corpus,
            score: item.score,
            payload: item.payload
        }))
    }

    async deleteByFilter(scope, options = {}) {
        const name = options.collection || this.alias || this.collection
        await this.request(`/collections/${encodeURIComponent(name)}/points/delete?wait=true`, {
            method: 'POST',
            body: JSON.stringify({ filter: scopeFilter(scope, { deleting: true }) })
        })
    }

    async count(collection = this.collection) {
        const result = await this.request(`/collections/${encodeURIComponent(collection)}/points/count`, {
            method: 'POST', body: JSON.stringify({ exact: true })
        })
        return result?.count || 0
    }

    async countByFilter(scope, options = {}) {
        const collection = options.collection || this.alias || this.collection
        const result = await this.request(`/collections/${encodeURIComponent(collection)}/points/count`, {
            method: 'POST', body: JSON.stringify({ exact: true, filter: scopeFilter(scope, { deleting: true }) })
        })
        return result?.count || 0
    }

    async switchAlias(collection = this.collection) {
        const aliases = await this.request('/aliases')
        const exists = Array.isArray(aliases?.aliases) && aliases.aliases.some(item => item.alias_name === this.alias)
        const actions = []
        if (exists) actions.push({ delete_alias: { alias_name: this.alias } })
        actions.push({ create_alias: { collection_name: collection, alias_name: this.alias } })
        await this.request('/collections/aliases', {
            method: 'POST',
            body: JSON.stringify({ actions })
        })
    }

    async ensureAlias(collection = this.collection) {
        const aliases = await this.request('/aliases')
        const existing = Array.isArray(aliases?.aliases)
            ? aliases.aliases.find(item => item.alias_name === this.alias)
            : null
        if (existing) return existing.collection_name
        await this.request('/collections/aliases', {
            method: 'POST',
            body: JSON.stringify({
                actions: [{ create_alias: { collection_name: collection, alias_name: this.alias } }]
            })
        })
        return collection
    }
}

module.exports = { QdrantVectorIndex, collectionName, pointId, scopeFilter }
