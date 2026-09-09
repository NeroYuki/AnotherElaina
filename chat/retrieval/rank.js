'use strict'

function reciprocalRankFusion(lists, options = {}) {
    const k = options.k || 60
    const now = options.now || Date.now()
    const map = new Map()
    for (const list of lists) {
        list.forEach((item, index) => {
            const key = `${item.kind}:${item.id}`
            if (!map.has(key)) map.set(key, { ...item, fusionScore: 0, ranks: [] })
            const fused = map.get(key)
            fused.fusionScore += 1 / (k + index + 1)
            fused.ranks.push(index + 1)
            if (!fused.record && item.record) fused.record = item.record
        })
    }
    for (const item of map.values()) {
        const source = item.record || item.payload || {}
        const timestamp = new Date(source.endedAt || source.updatedAt || source.createdAt || 0).getTime()
        if (Number.isFinite(timestamp) && timestamp > 0) {
            const days = Math.max(0, (now - timestamp) / 86400000)
            item.fusionScore += 0.01 / (1 + days / 30)
        }
        item.fusionScore += Math.min(5, Math.max(0, source.salience || 0)) * 0.001
    }
    return [...map.values()].sort((a, b) => b.fusionScore - a.fusionScore)
}

function selectDiverse(results, options = {}) {
    const limit = options.limit || 6
    const perDocument = options.perDocument || 2
    const seen = new Map()
    const selected = []
    for (const result of results) {
        const group = result.record?.documentId || result.payload?.documentId || result.id
        const count = seen.get(group) || 0
        if (count >= perDocument) continue
        selected.push(result)
        seen.set(group, count + 1)
        if (selected.length >= limit) break
    }
    return selected
}

module.exports = { reciprocalRankFusion, selectDiverse }
