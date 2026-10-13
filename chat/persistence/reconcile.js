'use strict'

const { COLLECTIONS } = require('./collections')

const INFERENCE_JOB_TYPES = Object.freeze(['extract_memory', 'summarize_episode', 'rebuild_episode'])

function extractionJob(turn) {
    return {
        type: 'extract_memory', entityId: turn.eventId, sourceIds: [turn.eventId],
        continuityId: turn.continuityId, expectedEpoch: turn.deletionEpoch,
        expectedRevision: turn.committedRevision, priority: -10,
        idempotencyKey: `extract:${turn.eventId}:v1`,
        payload: { sceneId: turn.sceneId, branchId: turn.branchId }
    }
}

// Recovery concerns unfinished commits. Finalized history is an explicit,
// bounded backfill; completed/dead/cancelled jobs are never reset by a scan.
async function reconcileTurns({ repository, jobs, backfillLimit = 0, recoveryLimit = 100, clock = () => new Date() }) {
    const turns = repository.collection(COLLECTIONS.turns)
    const eligible = { lifecycle: { $in: ['committed', 'finalized'] }, responseRejected: { $ne: true }, retainedRaw: { $ne: false } }
    const recovery = await turns.find({ ...eligible, $or: [{ lifecycle: 'committed' }, { recoveryRequired: true }] })
        .sort({ updatedAt: 1 }).limit(recoveryLimit).toArray()
    const result = { recovered: 0, scanned: 0, inserted: 0, existing: 0, skipped: 0 }
    const seen = new Set()
    for (const turn of recovery) {
        seen.add(turn.eventId)
        result.scanned += 1
        if (!await repository.isCanonicalTurn(turn.continuityId, turn.eventId)) { result.skipped += 1; continue }
        // Queue before clearing recoveryRequired: a crash between these writes
        // must leave recovery discoverable on the next startup.
        if (await jobs.enqueueMissing(extractionJob(turn))) result.inserted += 1
        else result.existing += 1
        const now = clock()
        await repository.updateTurn(turn.eventId, {
            lifecycle: 'finalized', finalizedAt: turn.finalizedAt || now,
            recoveryRequired: false, reconciledAt: now
        })
        await repository.collection(COLLECTIONS.scenes).updateOne({
            sceneId: turn.sceneId,
            $or: [{ selectedHeadTurnId: turn.parentTurnId }, { selectedHeadTurnId: null }, { selectedHeadTurnId: { $exists: false } }]
        }, { $set: { selectedHeadTurnId: turn.eventId, updatedAt: now } })
        result.recovered += 1
    }
    if (backfillLimit > 0) {
        const history = await turns.find({ ...eligible, lifecycle: 'finalized', recoveryRequired: { $ne: true } })
            .sort({ updatedAt: -1 }).limit(backfillLimit).toArray()
        for (const turn of history) {
            if (seen.has(turn.eventId)) continue
            result.scanned += 1
            if (!await repository.isCanonicalTurn(turn.continuityId, turn.eventId)) { result.skipped += 1; continue }
            if (await jobs.enqueueMissing(extractionJob(turn))) result.inserted += 1
            else result.existing += 1
        }
    }
    return result
}

module.exports = { INFERENCE_JOB_TYPES, extractionJob, reconcileTurns }
