'use strict'

const crypto = require('node:crypto')
const { COLLECTIONS } = require('./collections')
const { valueOf } = require('./leases')

class JobQueue {
    constructor(options) {
        if (!options || !options.db) throw new TypeError('JobQueue requires a Mongo Db')
        this.collection = options.db.collection(COLLECTIONS.jobs)
        this.clock = options.clock || (() => new Date())
        this.id = options.id || (() => crypto.randomUUID())
        this.workerId = options.workerId || crypto.randomUUID()
        this.leaseMs = options.leaseMs || 60000
        this.maxAttempts = options.maxAttempts || 3
    }

    async enqueue(input) {
        const now = this.clock()
        const record = {
            schemaVersion: 1,
            jobId: input.jobId || this.id(),
            type: input.type,
            entityId: input.entityId || null,
            sourceIds: input.sourceIds || [],
            continuityId: input.continuityId || null,
            expectedEpoch: input.expectedEpoch,
            expectedRevision: input.expectedRevision,
            idempotencyKey: input.idempotencyKey,
            payload: input.payload || {},
            state: 'queued',
            priority: input.priority || 0,
            attempts: 0,
            nextRunAt: input.nextRunAt || now,
            createdAt: now,
            updatedAt: now
        }
        const result = await this.collection.findOneAndUpdate(
            { idempotencyKey: input.idempotencyKey },
            { $setOnInsert: record },
            { upsert: true, returnDocument: 'after' }
        )
        return valueOf(result)
    }

    async claim(types) {
        const now = this.clock()
        const expiresAt = new Date(now.getTime() + this.leaseMs)
        const query = {
            nextRunAt: { $lte: now },
            ...(types && types.length ? { type: { $in: types } } : {}),
            $or: [
                { state: { $in: ['queued', 'retry'] } },
                { state: 'running', 'lease.expiresAt': { $lte: now } }
            ]
        }
        const result = await this.collection.findOneAndUpdate(query, {
            $set: {
                state: 'running',
                'lease.workerId': this.workerId,
                'lease.acquiredAt': now,
                'lease.expiresAt': expiresAt,
                updatedAt: now
            },
            $inc: { attempts: 1, 'lease.fencingToken': 1 }
        }, { sort: { priority: -1, nextRunAt: 1, createdAt: 1 }, returnDocument: 'after' })
        return valueOf(result)
    }

    async renew(job) {
        const now = this.clock()
        const expiresAt = new Date(now.getTime() + this.leaseMs)
        const result = await this.collection.updateOne({
            jobId: job.jobId,
            state: 'running',
            'lease.workerId': this.workerId,
            'lease.fencingToken': job.lease.fencingToken,
            'lease.expiresAt': { $gt: now }
        }, { $set: { 'lease.expiresAt': expiresAt, updatedAt: now } })
        if (result.modifiedCount !== 1) {
            const error = new Error('Job lease was lost')
            error.code = 'CHAT_JOB_LEASE_LOST'
            throw error
        }
        job.lease.expiresAt = expiresAt
        return job
    }

    async complete(job, resultData = null) {
        const now = this.clock()
        const result = await this.collection.updateOne({
            jobId: job.jobId,
            state: 'running',
            'lease.workerId': this.workerId,
            'lease.fencingToken': job.lease.fencingToken,
            'lease.expiresAt': { $gt: now }
        }, {
            $set: { state: 'completed', result: resultData, completedAt: now, updatedAt: now },
            $unset: { lease: '' }
        })
        return result.modifiedCount === 1
    }

    async fail(job, error, options = {}) {
        const now = this.clock()
        const dead = options.dead === true || job.attempts >= (options.maxAttempts || this.maxAttempts)
        const delayMs = options.delayMs ?? Math.min(300000, 1000 * (2 ** Math.max(0, job.attempts - 1)))
        const result = await this.collection.updateOne({
            jobId: job.jobId,
            state: 'running',
            'lease.workerId': this.workerId,
            'lease.fencingToken': job.lease.fencingToken
        }, {
            $set: {
                state: dead ? 'dead' : 'retry',
                nextRunAt: dead ? now : new Date(now.getTime() + delayMs),
                lastError: {
                    code: error.code || 'CHAT_JOB_FAILED',
                    message: String(error.message || error).slice(0, 1000),
                    retryable: !dead,
                    at: now
                },
                updatedAt: now
            },
            $unset: { lease: '' }
        })
        return result.modifiedCount === 1
    }

    async cancelMatching(filter, reason = 'scope_deleted') {
        const now = this.clock()
        const result = await this.collection.updateMany({
            ...filter,
            state: { $in: ['queued', 'retry', 'running'] }
        }, {
            $set: { state: 'cancelled', cancelReason: reason, cancelledAt: now, updatedAt: now },
            $unset: { lease: '' }
        })
        return result.modifiedCount
    }

    async backlog() {
        return this.collection.aggregate([
            { $match: { state: { $in: ['queued', 'retry', 'running', 'dead'] } } },
            { $group: { _id: { type: '$type', state: '$state' }, count: { $sum: 1 }, oldest: { $min: '$createdAt' } } }
        ]).toArray()
    }
}

class JobWorker {
    constructor(options) {
        this.queue = options.queue
        this.handlers = options.handlers
        this.pollMs = options.pollMs || 1000
        this.onError = options.onError || (() => {})
        this.heartbeatMs = options.heartbeatMs || Math.max(1000, Math.floor(this.queue.leaseMs / 3))
        this.running = false
        this.timer = null
        this.inFlight = null
    }

    start() {
        if (this.running) return
        this.running = true
        this._schedule(0)
    }

    _schedule(delay) {
        this.timer = setTimeout(() => this._tick(), delay)
        this.timer.unref?.()
    }

    async _tick() {
        if (!this.running) return
        let job = null
        let heartbeat = null
        try {
            job = await this.queue.claim(Object.keys(this.handlers))
            if (job) {
                const handler = this.handlers[job.type]
                heartbeat = setInterval(() => this.queue.renew(job).catch(error => this.onError(error)), this.heartbeatMs)
                heartbeat.unref?.()
                this.inFlight = Promise.resolve(handler(job))
                const result = await this.inFlight
                if (!await this.queue.complete(job, result)) {
                    throw Object.assign(new Error('Job completed after its lease was lost'), { code: 'CHAT_JOB_LEASE_LOST' })
                }
            }
        } catch (error) {
            if (job) await this.queue.fail(job, error).catch(failure => this.onError(failure))
            this.onError(error)
        } finally {
            clearInterval(heartbeat)
            this.inFlight = null
            if (this.running) this._schedule(this.pollMs)
        }
    }

    async stop() {
        this.running = false
        clearTimeout(this.timer)
        if (this.inFlight) await this.inFlight.catch(() => {})
    }
}

module.exports = { JobQueue, JobWorker }
