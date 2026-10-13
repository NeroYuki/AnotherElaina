'use strict'

require('dotenv').config()
const { openMongo } = require('../../chat/persistence/mongo')
const { ChatRepository } = require('../../chat/persistence/repository')
const { JobQueue } = require('../../chat/persistence/jobs')
const { COLLECTIONS } = require('../../chat/persistence/collections')
const { INFERENCE_JOB_TYPES, reconcileTurns } = require('../../chat/persistence/reconcile')

function parseArgs(args) {
    const command = args[0] || 'status'
    if (!['status', 'backfill', 'retry'].includes(command)) throw new Error('Usage: npm run chat:jobs -- status | backfill --limit 25 | retry --type extract_memory --limit 10')
    const options = { command, limit: 25, type: 'extract_memory' }
    for (let i = 1; i < args.length; i += 2) {
        const flag = args[i]
        const value = args[i + 1]
        if (flag === '--limit' && value !== undefined) options.limit = Number(value)
        else if (flag === '--type' && value !== undefined) options.type = value
        else throw new Error(`Unknown or incomplete argument: ${flag}`)
    }
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 10000) throw new Error('--limit must be an integer from 1 to 10000')
    if (!INFERENCE_JOB_TYPES.includes(options.type)) throw new Error('--type must be extract_memory, summarize_episode, or rebuild_episode')
    return options
}

async function run({ db, command, limit, type }) {
    const jobs = new JobQueue({ db })
    if (command === 'backfill') {
        // Enqueue only. The bot's paced worker performs inference afterwards.
        return reconcileTurns({ repository: new ChatRepository({ db }), jobs, backfillLimit: limit })
    }
    const collection = db.collection(COLLECTIONS.jobs)
    if (command === 'retry') {
        const records = await collection.find({ type, state: 'dead' }).sort({ updatedAt: 1 }).limit(limit).toArray()
        let retried = 0
        for (const job of records) {
            const result = await collection.updateOne({ jobId: job.jobId, state: 'dead' }, {
                $set: { state: 'retry', attempts: 0, nextRunAt: new Date(), updatedAt: new Date() },
                $unset: { lease: '' }
            })
            retried += result.modifiedCount
        }
        return { type, retried }
    }
    const counts = await collection.aggregate([
        { $group: { _id: { type: '$type', state: '$state' }, count: { $sum: 1 }, oldestCreatedAt: { $min: '$createdAt' }, newestCreatedAt: { $max: '$createdAt' } } },
        { $sort: { '_id.type': 1, '_id.state': 1 } }
    ]).toArray()
    const pending = await collection.find({ type: { $in: INFERENCE_JOB_TYPES }, state: { $in: ['queued', 'retry', 'running', 'dead'] } })
        .sort({ updatedAt: -1 }).limit(limit).toArray()
    return {
        counts,
        recent: pending.map(job => ({
            jobId: job.jobId, type: job.type, entityId: job.entityId, idempotencyKey: job.idempotencyKey,
            state: job.state, attempts: job.attempts, createdAt: job.createdAt, updatedAt: job.updatedAt,
            nextRunAt: job.nextRunAt, leaseExpiresAt: job.lease?.expiresAt,
            lastErrorCode: job.lastError?.code
        }))
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2))
    const connection = await openMongo({ dbName: 'another_elaina' })
    try { console.log(JSON.stringify(await run({ db: connection.db, ...options }), null, 2)) }
    finally { await connection.close() }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { parseArgs, run }
