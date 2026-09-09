'use strict'

const crypto = require('node:crypto')
const { COLLECTIONS } = require('./collections')

function valueOf(result) {
    return result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result
}

class LeaseLostError extends Error {
    constructor(message = 'The continuity lease was lost or expired') {
        super(message)
        this.name = 'LeaseLostError'
        this.code = 'CHAT_LEASE_LOST'
    }
}

class ContinuityLeases {
    constructor(options) {
        if (!options || !options.db) throw new TypeError('ContinuityLeases requires a Mongo Db')
        this.collection = options.db.collection(COLLECTIONS.continuities)
        this.clock = options.clock || (() => new Date())
        this.ownerId = options.ownerId || crypto.randomUUID()
        this.durationMs = options.durationMs || 30000
        this.heartbeatMs = options.heartbeatMs || Math.max(1000, Math.floor(this.durationMs / 3))
    }

    async acquire(continuityId, options = {}) {
        const now = this.clock()
        const durationMs = options.durationMs || this.durationMs
        const expiresAt = new Date(now.getTime() + durationMs)
        const ownerId = options.ownerId || `${this.ownerId}:${crypto.randomUUID()}`
        const result = await this.collection.findOneAndUpdate({
            continuityId,
            status: { $ne: 'deleted' },
            $or: [
                { lease: { $exists: false } },
                { 'lease.expiresAt': { $lte: now } }
            ]
        }, {
            $set: {
                'lease.ownerId': ownerId,
                'lease.acquiredAt': now,
                'lease.expiresAt': expiresAt,
                updatedAt: now
            },
            $inc: { 'lease.fencingToken': 1 }
        }, { returnDocument: 'after' })
        const continuity = valueOf(result)
        if (!continuity) return null
        return {
            continuityId,
            ownerId,
            fencingToken: continuity.lease.fencingToken,
            expiresAt: continuity.lease.expiresAt
        }
    }

    async renew(lease, options = {}) {
        const now = this.clock()
        const expiresAt = new Date(now.getTime() + (options.durationMs || this.durationMs))
        const result = await this.collection.findOneAndUpdate({
            continuityId: lease.continuityId,
            'lease.ownerId': lease.ownerId,
            'lease.fencingToken': lease.fencingToken,
            'lease.expiresAt': { $gt: now },
            status: { $ne: 'deleted' }
        }, { $set: { 'lease.expiresAt': expiresAt, updatedAt: now } }, { returnDocument: 'after' })
        const continuity = valueOf(result)
        if (!continuity) throw new LeaseLostError()
        lease.expiresAt = continuity.lease.expiresAt
        return lease
    }

    async assertValid(lease) {
        const now = this.clock()
        const continuity = await this.collection.findOne({
            continuityId: lease.continuityId,
            'lease.ownerId': lease.ownerId,
            'lease.fencingToken': lease.fencingToken,
            'lease.expiresAt': { $gt: now },
            status: { $ne: 'deleted' }
        }, { projection: { _id: 1, deletionEpoch: 1, revision: 1 } })
        if (!continuity) throw new LeaseLostError()
        return continuity
    }

    async release(lease) {
        const now = this.clock()
        const result = await this.collection.updateOne({
            continuityId: lease.continuityId,
            'lease.ownerId': lease.ownerId,
            'lease.fencingToken': lease.fencingToken
        }, { $unset: { lease: '' }, $set: { updatedAt: now } })
        return result.modifiedCount === 1
    }

    async withLease(continuityId, fn, options = {}) {
        const lease = await this.acquire(continuityId, options)
        if (!lease) throw new LeaseLostError('Continuity is currently leased by another worker')
        let heartbeatError = null
        const timer = setInterval(() => {
            this.renew(lease, options).catch(error => { heartbeatError = error })
        }, options.heartbeatMs || this.heartbeatMs)
        timer.unref?.()
        try {
            const result = await fn(lease, () => {
                if (heartbeatError) throw heartbeatError
            })
            if (heartbeatError) throw heartbeatError
            await this.assertValid(lease)
            return result
        } finally {
            clearInterval(timer)
            await this.release(lease).catch(() => false)
        }
    }
}

module.exports = { ContinuityLeases, LeaseLostError, valueOf }
