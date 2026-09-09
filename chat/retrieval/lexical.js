'use strict'

const { COLLECTIONS } = require('../persistence/collections')

function normalizedTerms(query) {
    return [...new Set(String(query).normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}_'-]+/gu) || [])].slice(0, 20)
}

function acl(scope, prefix = '') {
    const p = key => prefix ? `${prefix}.${key}` : key
    return {
        [p('guildId')]: scope.guildId,
        [p('continuityId')]: scope.continuityId,
        $or: [{ [p('audienceUserIds')]: { $exists: false } }, { [p('audienceUserIds')]: scope.userId }]
    }
}

class MongoLexicalRetriever {
    constructor(options) {
        this.db = options.db
        this.limit = Math.min(options.limit || 20, 100)
    }

    async search(query, scope, options = {}) {
        const limit = Math.min(options.limit || this.limit, 20)
        const terms = normalizedTerms(query)
        if (!terms.length) return []
        const searches = []
        const kinds = new Set(options.kinds || ['memory', 'episode', 'lore'])
        if (kinds.has('memory')) searches.push(this._text(COLLECTIONS.memories, {
            ...acl(scope, 'scope'), status: 'active', deletionEpoch: scope.deletionEpoch,
            ...(options.memoryKind ? { kind: options.memoryKind } : {})
        }, query, limit, record => ({ id: record.memoryId, kind: 'memory', text: record.statement, record })))
        if (kinds.has('episode')) searches.push(this._text(COLLECTIONS.episodes, {
            ...acl(scope), lifecycle: 'active', deletionEpoch: scope.deletionEpoch,
            ...(scope.sceneId ? { sceneId: scope.sceneId } : {})
        }, query, limit, record => ({ id: record.episodeId, kind: 'episode', text: record.summary, record })))
        if (kinds.has('lore')) searches.push(this._lore(query, terms, scope, limit))
        const results = (await Promise.all(searches)).flat()
        const unique = new Map()
        for (const result of results.sort((a, b) => b.score - a.score)) {
            if (!unique.has(`${result.kind}:${result.id}`)) unique.set(`${result.kind}:${result.id}`, result)
        }
        return [...unique.values()].slice(0, limit)
    }

    async _text(collectionName, base, query, limit, map) {
        const collection = this.db.collection(collectionName)
        const records = await collection.find(
            { ...base, $text: { $search: query, $caseSensitive: false, $diacriticSensitive: false } },
            { projection: { score: { $meta: 'textScore' } } }
        ).sort({ score: { $meta: 'textScore' } }).limit(limit).toArray()
        return records.map((record, rank) => ({ ...map(record), score: record.score || 1 / (rank + 1), lexicalRank: rank + 1 }))
    }

    async _lore(query, terms, scope, limit) {
        const authorization = {
            lifecycle: 'active',
            $or: [
                { corpus: 'global_lore' },
                { corpus: 'restricted_lore', guildId: scope.guildId, audienceUserIds: scope.userId }
            ]
        }
        const collection = this.db.collection(COLLECTIONS.chunks)
        const text = await this._text(COLLECTIONS.chunks, authorization, query, limit, record => ({
            id: record.chunkId, kind: 'lore', text: record.text, record
        }))
        const exact = await collection.find({
            $and: [
                authorization,
                { $or: [{ normalizedTerms: { $in: terms } }, { tags: { $in: terms } }] }
            ]
        }).sort({ updatedAt: -1 }).limit(limit).toArray()
        return [...text, ...exact.map((record, rank) => ({
            id: record.chunkId,
            kind: 'lore',
            text: record.text,
            record,
            score: 1 + (1 / (rank + 1)),
            lexicalRank: rank + 1
        }))]
    }
}

module.exports = { MongoLexicalRetriever, acl, normalizedTerms }
