'use strict'

const crypto = require('node:crypto')
const { COLLECTIONS } = require('./collections')
const { LeaseLostError, valueOf } = require('./leases')

function duplicateKey(error) {
    return error && (error.code === 11000 || error.codeName === 'DuplicateKey')
}

function normalizeQdrantUrl(value) {
    const raw = String(value == null ? '' : value).trim()
    try {
        const url = new URL(raw)
        url.hash = ''
        url.search = ''
        return url.toString().replace(/\/+$/, '')
    } catch {
        return raw.replace(/\/+$/, '')
    }
}

function reindexLifecycleId(url, alias) {
    return crypto.createHash('sha256')
        .update(`${normalizeQdrantUrl(url)}\n${String(alias || 'chat_active')}`)
        .digest('hex')
}

function leaseFromDocument(document) {
    return {
        key: document._id,
        ownerId: document.lease.ownerId,
        fencingToken: document.fencingToken,
        expiresAt: document.lease.expiresAt
    }
}

class ReindexLifecycleStore {
    constructor(options) {
        if (!options || !options.db) throw new TypeError('ReindexLifecycleStore requires a Mongo Db')
        this.collection = options.db.collection(COLLECTIONS.reindex)
        this.url = normalizeQdrantUrl(options.url)
        this.alias = String(options.alias || 'chat_active')
        this.key = reindexLifecycleId(this.url, this.alias)
        this.clock = options.clock || (() => new Date())
        this.ownerId = options.ownerId || crypto.randomUUID()
        this.durationMs = options.durationMs || 120000
        this.heartbeatMs = options.heartbeatMs || Math.max(1000, Math.floor(this.durationMs / 3))
    }

    async acquire(options = {}) {
        const now = this.clock()
        const durationMs = options.durationMs || this.durationMs
        const expiresAt = new Date(now.getTime() + durationMs)
        const ownerId = options.ownerId || `${this.ownerId}:${crypto.randomUUID()}`
        const leaseSet = {
            'lease.ownerId': ownerId,
            'lease.acquiredAt': now,
            'lease.expiresAt': expiresAt,
            updatedAt: now
        }
        const freeLease = [
            { lease: { $exists: false } },
            { 'lease.expiresAt': { $lte: now } }
        ]

        const existing = await this.collection.findOne({ _id: this.key }, { projection: { _id: 1 } })
        if (!existing) {
            try {
                const created = valueOf(await this.collection.findOneAndUpdate({
                    _id: this.key,
                    $or: freeLease
                }, {
                    $setOnInsert: {
                        schemaVersion: 1,
                        qdrantUrl: this.url,
                        alias: this.alias,
                        build: null,
                        history: [],
                        pendingDeletions: [],
                        createdAt: now
                    },
                    $set: leaseSet,
                    $inc: { fencingToken: 1 }
                }, { upsert: true, returnDocument: 'after' }))
                if (created?.lease?.ownerId === ownerId) return leaseFromDocument(created)
                return null
            } catch (error) {
                if (!duplicateKey(error)) throw error
            }
        }

        const acquired = valueOf(await this.collection.findOneAndUpdate({
            _id: this.key,
            $or: freeLease
        }, {
            $set: leaseSet,
            $inc: { fencingToken: 1 }
        }, { returnDocument: 'after' }))
        return acquired ? leaseFromDocument(acquired) : null
    }

    async renew(lease, options = {}) {
        const now = this.clock()
        const expiresAt = new Date(now.getTime() + (options.durationMs || this.durationMs))
        const renewed = valueOf(await this.collection.findOneAndUpdate({
            _id: this.key,
            'lease.ownerId': lease.ownerId,
            fencingToken: lease.fencingToken,
            'lease.expiresAt': { $gt: now }
        }, {
            $set: { 'lease.expiresAt': expiresAt, updatedAt: now }
        }, { returnDocument: 'after' }))
        if (!renewed) throw new LeaseLostError('The reindex lease was lost or expired')
        lease.expiresAt = renewed.lease.expiresAt
        return lease
    }

    async assertValid(lease) {
        const now = this.clock()
        const current = await this.collection.findOne({
            _id: this.key,
            'lease.ownerId': lease.ownerId,
            fencingToken: lease.fencingToken,
            'lease.expiresAt': { $gt: now }
        }, { projection: { _id: 1, build: 1, history: 1, pendingDeletions: 1 } })
        if (!current) throw new LeaseLostError('The reindex lease was lost or expired')
        return current
    }

    async release(lease) {
        const result = await this.collection.updateOne({
            _id: this.key,
            'lease.ownerId': lease.ownerId,
            fencingToken: lease.fencingToken
        }, {
            $unset: { lease: '' },
            $set: { updatedAt: this.clock() }
        })
        return result.modifiedCount === 1
    }

    async get() {
        return this.collection.findOne({ _id: this.key })
    }

    async update(lease, update) {
        const now = this.clock()
        const result = await this.collection.updateOne({
            _id: this.key,
            'lease.ownerId': lease.ownerId,
            fencingToken: lease.fencingToken,
            'lease.expiresAt': { $gt: now }
        }, update)
        if (result.matchedCount !== 1) throw new LeaseLostError('The reindex lease was lost or expired')
        return this.get()
    }
}

module.exports = { ReindexLifecycleStore, normalizeQdrantUrl, reindexLifecycleId }
