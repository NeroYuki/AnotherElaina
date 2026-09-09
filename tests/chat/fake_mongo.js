'use strict'

function get(object, path) {
    return path.split('.').reduce((value, key) => value == null ? undefined : value[key], object)
}

function set(object, path, value) {
    const keys = path.split('.')
    let cursor = object
    for (const key of keys.slice(0, -1)) cursor = cursor[key] ||= {}
    cursor[keys.at(-1)] = structuredClone(value)
}

function unset(object, path) {
    const keys = path.split('.')
    let cursor = object
    for (const key of keys.slice(0, -1)) cursor = cursor?.[key]
    if (cursor) delete cursor[keys.at(-1)]
}

function equal(actual, expected) {
    if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime()
    return JSON.stringify(actual) === JSON.stringify(expected)
}

function matchValue(actual, condition) {
    if (!condition || typeof condition !== 'object' || condition instanceof Date || Array.isArray(condition)) {
        return Array.isArray(actual) ? actual.some(value => equal(value, condition)) : equal(actual, condition)
    }
    return Object.entries(condition).every(([operator, expected]) => {
        if (operator === '$exists') return (actual !== undefined) === expected
        if (operator === '$lte') return actual !== undefined && actual <= expected
        if (operator === '$lt') return actual !== undefined && actual < expected
        if (operator === '$gte') return actual !== undefined && actual >= expected
        if (operator === '$gt') return actual !== undefined && actual > expected
        if (operator === '$ne') return !matchValue(actual, expected)
        if (operator === '$in') return expected.some(value => matchValue(actual, value))
        if (operator === '$nin') return !expected.some(value => matchValue(actual, value))
        return matchValue(actual?.[operator], expected)
    })
}

function matches(document, query) {
    return Object.entries(query || {}).every(([key, condition]) => {
        if (key === '$or') return condition.some(item => matches(document, item))
        if (key === '$and') return condition.every(item => matches(document, item))
        return matchValue(get(document, key), condition)
    })
}

function applyUpdate(document, update, inserting = false) {
    if (inserting) for (const [path, value] of Object.entries(update.$setOnInsert || {})) set(document, path, value)
    for (const [path, value] of Object.entries(update.$set || {})) set(document, path, value)
    for (const [path, value] of Object.entries(update.$inc || {})) set(document, path, (get(document, path) || 0) + value)
    for (const path of Object.keys(update.$unset || {})) unset(document, path)
}

class FakeCursor {
    constructor(documents) { this.documents = documents }
    sort(spec) {
        const entries = Object.entries(spec || {})
        this.documents.sort((a, b) => {
            for (const [key, direction] of entries) {
                if (typeof direction !== 'number') continue
                const compared = get(a, key) < get(b, key) ? -1 : get(a, key) > get(b, key) ? 1 : 0
                if (compared) return compared * direction
            }
            return 0
        })
        return this
    }
    limit(value) { this.documents = this.documents.slice(0, value); return this }
    project() { return this }
    async toArray() { return structuredClone(this.documents) }
    async *[Symbol.asyncIterator]() { for (const document of this.documents) yield structuredClone(document) }
}

class FakeCollection {
    constructor() { this.documents = []; this.indexes = [] }
    async insertOne(document) {
        this.documents.push(structuredClone(document))
        return { insertedId: document._id || document.eventId || document.jobId }
    }
    find(query) { return new FakeCursor(this.documents.filter(document => matches(document, query))) }
    async findOne(query) {
        const document = this.documents.find(item => matches(item, query))
        return document ? structuredClone(document) : null
    }
    async updateOne(query, update, options = {}) {
        let document = this.documents.find(item => matches(item, query))
        let upsertedCount = 0
        if (!document && options.upsert) {
            document = {}
            for (const [key, value] of Object.entries(query)) if (!key.startsWith('$') && (typeof value !== 'object' || value instanceof Date)) set(document, key, value)
            applyUpdate(document, update, true)
            this.documents.push(document)
            upsertedCount = 1
        } else if (document) applyUpdate(document, update)
        return { matchedCount: document ? 1 : 0, modifiedCount: document ? 1 : 0, upsertedCount }
    }
    async updateMany(query, update) {
        const documents = this.documents.filter(item => matches(item, query))
        for (const document of documents) applyUpdate(document, update)
        return { matchedCount: documents.length, modifiedCount: documents.length }
    }
    async findOneAndUpdate(query, update, options = {}) {
        let candidates = this.documents.filter(item => matches(item, query))
        if (options.sort) candidates = new FakeCursor(candidates).sort(options.sort).documents
        let document = candidates[0]
        if (!document && options.upsert) {
            document = {}
            for (const [key, value] of Object.entries(query)) {
                if (!key.startsWith('$') && (typeof value !== 'object' || value instanceof Date)) set(document, key, value)
            }
            applyUpdate(document, update, true)
            this.documents.push(document)
        } else if (document) applyUpdate(document, update)
        return { value: document ? structuredClone(document) : null }
    }
    async countDocuments(query) { return this.documents.filter(item => matches(item, query)).length }
    async createIndexes(indexes) { this.indexes.push(...indexes); return indexes.map(index => index.name) }
    aggregate() { return { toArray: async () => [] } }
    async bulkWrite(operations) {
        for (const operation of operations) {
            const item = operation.updateOne
            await this.updateOne(item.filter, item.update, { upsert: item.upsert })
        }
    }
}

class FakeDb {
    constructor() { this.collections = new Map() }
    collection(name) {
        if (!this.collections.has(name)) this.collections.set(name, new FakeCollection())
        return this.collections.get(name)
    }
    async command(command) { return command.ping ? { ok: 1 } : {} }
    listCollections() { return { toArray: async () => [...this.collections.keys()].map(name => ({ name })) } }
    async createCollection(name) { this.collection(name) }
}

module.exports = { FakeCollection, FakeDb, get, matches }
