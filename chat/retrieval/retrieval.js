'use strict'

const { reciprocalRankFusion, selectDiverse } = require('./rank')

function referenceKind(kind) {
    if (kind === 'memory') return 'memory'
    if (kind === 'episode') return 'episode'
    return 'lore'
}

class HybridRetriever {
    constructor(options) {
        this.embedder = options.embedder
        this.vectorIndex = options.vectorIndex
        this.lexical = options.lexical
        this.repository = options.repository
    }

    async search(query, scope, options = {}) {
        const lexicalPromise = this.lexical.search(query, scope, { ...options, limit: 20 })
        let semantic = []
        let semanticError = null
        try {
            const [vector] = await this.embedder.embedQueries([query])
            const kinds = options.kinds || ['memory', 'episode', 'lore']
            const searches = []
            const localKinds = kinds.filter(kind => kind !== 'lore')
            if (localKinds.length) searches.push(this.vectorIndex.search(vector, { ...scope, corpora: localKinds }, { limit: 20, signal: options.signal }))
            if (kinds.includes('lore')) searches.push(this.vectorIndex.search(vector, { guildId: scope.guildId, userId: scope.userId, corpora: ['global_lore', 'restricted_lore'], allowGlobalLore: true }, { limit: 20, signal: options.signal }))
            semantic = (await Promise.all(searches)).flat().sort((a, b) => b.score - a.score).slice(0, 20)
        } catch (error) {
            semanticError = error
        }
        const lexical = await lexicalPromise
        const fused = reciprocalRankFusion([semantic, lexical], options.rank)
        const candidates = selectDiverse(fused, { limit: Math.min(options.candidateLimit || 20, 20) })
        const refs = candidates.map(item => ({ id: item.id, kind: referenceKind(item.kind) }))
        const authorized = await this.repository.getAuthorizedSources(refs, scope)
        const authorizedIds = new Set(authorized.map(record => record.memoryId || record.episodeId || record.chunkId))
        const byId = new Map(authorized.map(record => [record.memoryId || record.episodeId || record.chunkId, record]))
        const results = selectDiverse(candidates.filter(item => authorizedIds.has(item.id)).map(item => ({
            ...item,
            record: byId.get(item.id),
            text: byId.get(item.id).statement || byId.get(item.id).summary || byId.get(item.id).text
        })), { limit: options.limit || 6 })
        return { results, degraded: Boolean(semanticError), semanticError }
    }
}

module.exports = { HybridRetriever }
