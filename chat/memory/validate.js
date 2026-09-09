'use strict'

const ALLOWED_KEYS = new Set([
    'kind', 'statement', 'factType', 'subjectCharacterId', 'targetCharacterId', 'userId',
    'action', 'due', 'promiseStatus', 'planStatus', 'acceptedByCharacterIds', 'relationType',
    'targetMemoryId', 'correctionType', 'confidence', 'sourceTurnIds', 'evidence', 'salience'
])
const KINDS = new Set(['scene_fact', 'object_state', 'character_fact', 'relationship_event', 'promise', 'plan', 'user_preference', 'correction', 'conflict'])
const CONFIDENCE = new Set(['explicit', 'inferred', 'uncertain'])
const AGENCY_FACTS = new Set(['action', 'decision', 'feeling'])

function turnText(turn) {
    if (typeof turn.content === 'string') return turn.content
    if (Array.isArray(turn.segments)) return turn.segments.map(segment => segment.text || '').join('\n')
    if (Array.isArray(turn.contentParts)) {
        return turn.contentParts.filter(part => part.type === 'text' || part.type === 'reply_quote').map(part => part.text || '').join('\n')
    }
    return ''
}

function hasOocAssertion(turn, quote) {
    if (!Array.isArray(turn.segments)) return false
    return turn.segments.some(segment => segment.mode === 'ooc' && segment.text.includes(quote))
}

function validateCandidate(candidate, context) {
    const errors = []
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return ['candidate must be an object']
    for (const key of Object.keys(candidate)) {
        if (!ALLOWED_KEYS.has(key)) errors.push(`unknown property ${key}`)
    }
    if (!KINDS.has(candidate.kind)) errors.push('kind is invalid')
    if (typeof candidate.statement !== 'string' || !candidate.statement.trim()) errors.push('statement is required')
    if (!CONFIDENCE.has(candidate.confidence)) errors.push('confidence must be explicit, inferred, or uncertain')
    if (!Array.isArray(candidate.sourceTurnIds) || candidate.sourceTurnIds.length === 0) errors.push('sourceTurnIds must not be empty')
    if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) errors.push('evidence must not be empty')

    const turns = context.turns instanceof Map ? context.turns : new Map((context.turns || []).map(turn => [turn.eventId || turn.turnId, turn]))
    const participants = context.participants instanceof Map
        ? context.participants
        : new Map((context.participants || []).map(item => [item.characterId, item]))
    const sourceIds = new Set(candidate.sourceTurnIds || [])
    for (const sourceId of sourceIds) {
        if (!turns.has(sourceId)) errors.push(`source turn ${sourceId} is not canonical input`)
        if (!(candidate.evidence || []).some(item => item.turnId === sourceId)) errors.push(`source turn ${sourceId} has no exact evidence item`)
    }
    for (const evidence of candidate.evidence || []) {
        if (!evidence || typeof evidence.turnId !== 'string' || typeof evidence.quote !== 'string' || !evidence.quote) {
            errors.push('each evidence item requires turnId and a non-empty quote')
            continue
        }
        const turn = turns.get(evidence.turnId)
        if (!sourceIds.has(evidence.turnId)) errors.push(`evidence turn ${evidence.turnId} is missing from sourceTurnIds`)
        if (!turn) continue
        if (!turnText(turn).includes(evidence.quote)) errors.push(`evidence quote is not an exact substring of ${evidence.turnId}`)
    }

    for (const field of ['subjectCharacterId', 'targetCharacterId']) {
        if (candidate[field] && !participants.has(candidate[field])) errors.push(`${field} is not an authorized participant`)
    }

    if (candidate.kind === 'promise') {
        if (!candidate.subjectCharacterId || !candidate.targetCharacterId) errors.push('promise requires subjectCharacterId and targetCharacterId')
        if (candidate.subjectCharacterId === candidate.targetCharacterId) errors.push('promise subject and target must differ')
        if (!candidate.action || !candidate.due || !['fictional', 'real'].includes(candidate.due.clock) || !candidate.due.value) {
            errors.push('promise requires action and a typed due clock/value')
        }
        if (candidate.due?.relativeToTurnId && !sourceIds.has(candidate.due.relativeToTurnId)) {
            errors.push('promise due.relativeToTurnId must be a source turn')
        }
        if (!['open', 'fulfilled', 'broken', 'cancelled'].includes(candidate.promiseStatus)) errors.push('promiseStatus is invalid')
        if (!isSelfAuthored(candidate.subjectCharacterId, candidate.evidence, turns, participants)) {
            errors.push('a promise must be evidenced by its promisor')
        }
        if (candidate.confidence !== 'explicit') errors.push('promises must be explicit')
    }

    if (candidate.kind === 'character_fact' && AGENCY_FACTS.has(candidate.factType)) {
        if (candidate.confidence !== 'explicit') errors.push(`player ${candidate.factType} facts must be explicit`)
        if (!isSelfAuthored(candidate.subjectCharacterId, candidate.evidence, turns, participants)) {
            errors.push(`player ${candidate.factType} must be evidenced by that character's owner`)
        }
    }

    if (candidate.kind === 'user_preference') {
        if (!candidate.userId || !context.allowedUserIds?.includes(candidate.userId)) errors.push('user preference has an unauthorized userId')
        if (candidate.confidence !== 'explicit') errors.push('real-user preferences must be explicit')
        const authoredOoc = (candidate.evidence || []).some(evidence => {
            const turn = turns.get(evidence.turnId)
            return turn && turn.authorUserId === candidate.userId && hasOocAssertion(turn, evidence.quote)
        })
        if (!authoredOoc) errors.push('real-user preferences require an explicit OOC assertion by that user')
    }

    if (candidate.kind === 'plan') {
        if (!['proposed', 'accepted', 'completed', 'cancelled'].includes(candidate.planStatus)) errors.push('planStatus is invalid')
        if (candidate.planStatus !== 'proposed') {
            const accepted = new Set(candidate.acceptedByCharacterIds || [])
            if (!candidate.targetCharacterId || !accepted.has(candidate.targetCharacterId)) {
                errors.push('an accepted/completed plan requires explicit target acceptance')
            }
            if (!isSelfAuthored(candidate.targetCharacterId, candidate.evidence, turns, participants)) {
                errors.push('plan acceptance must be evidenced by the accepting character')
            }
        }
    }

    if (candidate.kind === 'correction' || candidate.kind === 'conflict') {
        if (!candidate.targetMemoryId || !context.existingMemoryIds?.includes(candidate.targetMemoryId)) {
            errors.push('correction/conflict must target an eligible existing memory')
        }
        if (!['supersede', 'retract', 'conflict'].includes(candidate.correctionType)) errors.push('correctionType is invalid')
        if (candidate.confidence !== 'explicit') errors.push('corrections must be explicit')
        if (typeof context.canCorrect !== 'function' || !context.canCorrect(candidate)) errors.push('correction is not authorized')
    } else if (typeof context.findContradiction === 'function') {
        const conflictId = context.findContradiction(candidate)
        if (conflictId) errors.push(`candidate contradicts ${conflictId} without a correction/conflict record`)
    }

    return errors
}

function isSelfAuthored(characterId, evidence, turns, participants) {
    if (!characterId) return false
    const participant = participants.get(characterId)
    return (evidence || []).some(item => {
        const turn = turns.get(item.turnId)
        if (!turn) return false
        if (turn.authorCharacterId === characterId) return true
        return participant && participant.ownerUserId && turn.authorUserId === participant.ownerUserId
    })
}

function validateExtraction(output, context) {
    if (!output || typeof output !== 'object' || Array.isArray(output) || !Array.isArray(output.memories)) {
        return { valid: false, accepted: [], rejected: [{ index: null, errors: ['output must contain a memories array'] }] }
    }
    const accepted = []
    const rejected = []
    output.memories.forEach((candidate, index) => {
        const errors = validateCandidate(candidate, context)
        if (errors.length) rejected.push({ index, candidate, errors })
        else accepted.push({ index, candidate })
    })
    return { valid: rejected.length === 0, accepted, rejected }
}

module.exports = { turnText, validateCandidate, validateExtraction }
