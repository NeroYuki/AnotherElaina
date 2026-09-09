'use strict'

function activeWithLineage(memories) {
    const invalid = new Set()
    for (const memory of memories) {
        if ((memory.kind === 'correction' || memory.kind === 'conflict') && memory.correctionType !== 'conflict' && memory.targetMemoryId) {
            invalid.add(memory.targetMemoryId)
        }
        if (memory.status === 'superseded' || memory.status === 'retracted' || memory.status === 'deleted') invalid.add(memory.memoryId)
    }
    return memories.filter(memory => memory.status === 'active' && !invalid.has(memory.memoryId))
}

function projectScene(memories, options = {}) {
    const active = activeWithLineage(memories)
    const facts = active
        .filter(memory => ['scene_fact', 'object_state', 'character_fact', 'correction'].includes(memory.kind))
        .sort((a, b) => (b.salience || 0) - (a.salience || 0) || new Date(a.createdAt) - new Date(b.createdAt))
        .slice(0, options.maxFacts || 200)
        .map(memory => ({ memoryId: memory.memoryId, kind: memory.kind, statement: memory.statement, sourceTurnIds: memory.sourceTurnIds }))
    const openPlans = active
        .filter(memory => memory.kind === 'plan' && ['proposed', 'accepted'].includes(memory.planStatus))
        .slice(0, options.maxPlans || 50)
        .map(memory => ({ memoryId: memory.memoryId, statement: memory.statement, status: memory.planStatus }))
    return { facts, openPlans }
}

function projectRelationships(memories) {
    const groups = new Map()
    for (const memory of activeWithLineage(memories)) {
        if (!['relationship_event', 'promise'].includes(memory.kind)) continue
        if (!memory.subjectCharacterId || !memory.targetCharacterId) continue
        const key = `${memory.subjectCharacterId}\0${memory.targetCharacterId}`
        if (!groups.has(key)) {
            groups.set(key, {
                subjectCharacterId: memory.subjectCharacterId,
                targetCharacterId: memory.targetCharacterId,
                events: [],
                openPromises: []
            })
        }
        const group = groups.get(key)
        if (memory.kind === 'promise' && memory.promiseStatus === 'open') {
            group.openPromises.push({
                memoryId: memory.memoryId,
                action: memory.action,
                due: memory.due,
                sourceTurnIds: memory.sourceTurnIds
            })
        } else {
            group.events.push({ memoryId: memory.memoryId, relationType: memory.relationType, statement: memory.statement })
        }
    }
    return [...groups.values()]
}

class MemoryProjector {
    constructor(options) {
        this.repository = options.repository
    }

    async rebuild(input) {
        const memories = await this.repository.listActiveMemories({
            'scope.continuityId': input.continuityId,
            'scope.sceneId': input.sceneId,
            deletionEpoch: input.expectedEpoch
        }, { limit: 500 })
        const projectedState = { ...input.currentState, ...projectScene(memories) }
        const published = await this.repository.publishSceneProjection({ ...input, projectedState })
        if (!published) return { published: false, projectedState, relationships: [] }
        const relationships = projectRelationships(memories)
        for (const relationship of relationships) {
            await this.repository.upsertRelationship({
                ...relationship,
                continuityId: input.continuityId,
                sceneId: input.sceneId,
                deletionEpoch: input.expectedEpoch,
                watermark: input.snapshotWatermark,
                projectionRevision: input.expectedProjectionRevision + 1
            })
        }
        return { published: true, projectedState, relationships }
    }
}

module.exports = { MemoryProjector, activeWithLineage, projectRelationships, projectScene }
