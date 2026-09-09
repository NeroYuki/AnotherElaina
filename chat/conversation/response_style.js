'use strict'

const RESPONSE_STYLES = Object.freeze(['compact', 'emoji', 'expressive'])

function normalizeResponseStyle(value, fallback = 'compact') {
    const style = String(value || fallback).trim().toLowerCase()
    if (!RESPONSE_STYLES.includes(style)) throw new TypeError(`Unsupported response style: ${style}`)
    return style
}

function responseStyleInstruction(style, maxWords = 90) {
    if (style === 'expressive') {
        return 'Response style: expressive. Richer roleplay prose is allowed, but avoid repetition and do not restate the user message.'
    }
    if (style === 'emoji') {
        return `Response style: real-time chat. Answer directly in one to three short sentences and at most ${maxWords} words. Do not narrate facial expressions, posture, pacing, or other bodily actions. Use at most one fitting emoji to convey a reaction. Do not restate the user message or turn the answer into a monologue.`
    }
    return `Response style: compact real-time chat. Answer directly in one to three short sentences and at most ${maxWords} words. Use at most one brief action beat only when it adds meaning. Do not restate the user message or turn the answer into a monologue.`
}

function emojiForAction(value) {
    const text = value.toLowerCase()
    if (/\b(?:smile|grin)\b/.test(text)) return '🙂'
    if (/\b(?:laugh|chuckle)\b/.test(text)) return '😄'
    if (/\b(?:nod|agree)\b/.test(text)) return '👍'
    if (/\bshrug\b/.test(text)) return '🤷'
    if (/\b(?:ponder|consider|think)\b/.test(text)) return '🤔'
    if (/\b(?:sigh|exhale)\b/.test(text)) return '😮‍💨'
    if (/\bwave\b/.test(text)) return '👋'
    if (/\b(?:surpris|blink)\b/.test(text)) return '😮'
    if (/\b(?:arch|brow|glance|look|gaze|eyes?)\b/.test(text)) return '🤨'
    return '✨'
}

function isActionProse(value) {
    const text = String(value || '').trim().replace(/^\*|\*$/g, '').trim()
    return /^I\s+(?:arch|raise|lower|turn|glance|look|gaze|fold|cross|clasp|pace|stand|sit|lean|tilt|nod|shake|smile|grin|sigh|exhale|laugh|chuckle|blink|step|walk|brush|adjust|tap|rest|place|lift)\b/i.test(text)
}

function replaceActionProse(value) {
    const paragraphs = String(value || '').split(/\n{2,}/)
    const output = []
    let usedEmoji = false
    for (const paragraph of paragraphs) {
        const trimmed = paragraph.trim()
        if (!trimmed) continue
        const leadingAction = /^\*([^*]+)\*\s*([\s\S]*)$/.exec(trimmed)
        if (leadingAction && isActionProse(leadingAction[1])) {
            if (!usedEmoji) output.push(emojiForAction(leadingAction[1]))
            usedEmoji = true
            if (leadingAction[2].trim()) output.push(leadingAction[2].trim())
            continue
        }
        if (isActionProse(trimmed)) {
            if (!usedEmoji) output.push(emojiForAction(trimmed))
            usedEmoji = true
            continue
        }
        output.push(trimmed)
    }
    return output.join('\n\n')
}

function truncateWords(value, maxWords) {
    const text = String(value || '').trim()
    const words = text.match(/\S+/g) || []
    if (words.length <= maxWords) return text
    const clipped = words.slice(0, maxWords).join(' ')
    const boundaries = [...clipped.matchAll(/[.!?](?=\s|$)/g)]
    const last = boundaries.at(-1)?.index
    if (last !== undefined && last >= clipped.length * 0.6) return clipped.slice(0, last + 1)
    return `${clipped.replace(/[,:;\-–—]+$/, '')}…`
}

function formatResponseForChat(value, { style = 'compact', maxWords = 90 } = {}) {
    const normalizedStyle = normalizeResponseStyle(style)
    const text = String(value || '').trim()
    if (normalizedStyle === 'expressive' || !text) return text
    const sourceMarker = '\n\nSources consulted:'
    const markerIndex = text.indexOf(sourceMarker)
    const sources = markerIndex >= 0 ? text.slice(markerIndex) : ''
    let body = markerIndex >= 0 ? text.slice(0, markerIndex) : text
    if (normalizedStyle === 'emoji') body = replaceActionProse(body)
    body = truncateWords(body.replace(/\n{3,}/g, '\n\n'), maxWords)
    return `${body}${sources}`.trim()
}

module.exports = {
    RESPONSE_STYLES,
    emojiForAction,
    formatResponseForChat,
    isActionProse,
    normalizeResponseStyle,
    replaceActionProse,
    responseStyleInstruction,
    truncateWords
}
