'use strict'

const path = require('node:path')
const net = require('node:net')

const DEFAULT_EMBEDDING_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'

class ChatConfigError extends Error {
    constructor(message) {
        super(message)
        this.name = 'ChatConfigError'
        this.code = 'CHAT_CONFIG_INVALID'
    }
}

function integer(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const raw = env[name]
    const value = raw === undefined || raw === '' ? fallback : Number(raw)
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new ChatConfigError(`${name} must be an integer from ${min} to ${max}`)
    }
    return value
}

function boolean(env, name, fallback) {
    const raw = env[name]
    if (raw === undefined || raw === '') return fallback
    if (raw === true || raw === 'true' || raw === '1') return true
    if (raw === false || raw === 'false' || raw === '0') return false
    throw new ChatConfigError(`${name} must be true or false`)
}

function responseStyle(env) {
    const style = String(env.CHAT_RESPONSE_STYLE || 'compact').trim().toLowerCase()
    if (!['compact', 'emoji', 'expressive'].includes(style)) {
        throw new ChatConfigError('CHAT_RESPONSE_STYLE must be compact, emoji, or expressive')
    }
    return style
}

function isPrivateHost(hostname) {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (host === 'localhost' || host.endsWith('.localhost')) return true
    const family = net.isIP(host)
    if (family === 4) {
        const [a, b] = host.split('.').map(Number)
        return a === 10 || a === 127 || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    }
    if (family === 6) {
        return host === '::1' || host.startsWith('fc') || host.startsWith('fd') ||
            /^fe[89ab]/.test(host)
    }
    return false
}

function privateServiceUrl(raw, name, allowedHosts = []) {
    let url
    try {
        url = new URL(raw)
    } catch {
        throw new ChatConfigError(`${name} must be a valid URL`)
    }
    const allowed = allowedHosts.map(host => host.trim().toLowerCase()).filter(Boolean)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (!isPrivateHost(url.hostname) && !allowed.includes(url.hostname.toLowerCase()))) {
        throw new ChatConfigError(`${name} must be an HTTP(S) URL on a loopback or private IP address`)
    }
    return url.toString().replace(/\/$/, '')
}

function validateLocalModel(model) {
    const gemma = model === 'unsloth/gemma-4-12B-it-qat-GGUF'
    const qwen = /^qwen[-_/.:a-z0-9]+$/i.test(model)
    if (!gemma && !qwen) {
        throw new ChatConfigError('CHAT_MODEL must be the tested local Gemma identifier or an explicit local Qwen identifier')
    }
    return model
}

function loadConfig(env = process.env, options = {}) {
    const root = options.rootDir || path.resolve(__dirname, '..')
    const localOnly = boolean(env, 'CHAT_LOCAL_ONLY', true)
    if (!localOnly) throw new ChatConfigError('CHAT_LOCAL_ONLY=false is forbidden')

    const embeddingModel = env.CHAT_EMBEDDING_MODEL || 'Xenova/multilingual-e5-small'
    if (embeddingModel !== 'Xenova/multilingual-e5-small') {
        throw new ChatConfigError('CHAT_EMBEDDING_MODEL must use the pinned local multilingual E5 artifact')
    }
    const embeddingRevision = env.CHAT_EMBEDDING_REVISION || DEFAULT_EMBEDDING_REVISION
    if (!/^[a-f0-9]{40}$/.test(embeddingRevision)) {
        throw new ChatConfigError('CHAT_EMBEDDING_REVISION must be a full 40-character commit SHA')
    }

    const inferenceHosts = String(env.CHAT_ALLOWED_INFERENCE_HOSTS || '').split(',')
    const serviceHosts = String(env.CHAT_ALLOWED_SERVICE_HOSTS || '').split(',')
    const config = {
        engine: env.CHAT_ENGINE || 'overhaul',
        localOnly,
        model: validateLocalModel(env.CHAT_MODEL || 'unsloth/gemma-4-12B-it-qat-GGUF'),
        inferenceUrl: privateServiceUrl(env.AI_PROXY_URL || 'http://192.168.1.2:11230', 'AI_PROXY_URL', inferenceHosts),
        contextTokens: integer(env, 'CHAT_CONTEXT_TOKENS', 8192, { min: 4096, max: 262144 }),
        maxOutputTokens: integer(env, 'CHAT_MAX_OUTPUT_TOKENS', 512, { min: 64, max: 1024 }),
        responseStyle: responseStyle(env),
        compactMaxOutputTokens: integer(env, 'CHAT_COMPACT_MAX_OUTPUT_TOKENS', 192, { min: 64, max: 512 }),
        compactMaxWords: integer(env, 'CHAT_COMPACT_MAX_WORDS', 90, { min: 30, max: 250 }),
        thinkingDefault: boolean(env, 'CHAT_THINKING_DEFAULT', false),
        inferenceConcurrency: integer(env, 'CHAT_INFERENCE_CONCURRENCY', 1, { min: 1, max: 8 }),
        turnTimeoutMs: integer(env, 'CHAT_TURN_TIMEOUT_MS', 90000, { min: 1000, max: 180000 }),
        coldTimeoutMs: integer(env, 'CHAT_COLD_TIMEOUT_MS', 180000, { min: 1000, max: 300000 }),
        toolMaxRounds: integer(env, 'CHAT_TOOL_MAX_ROUNDS', 3, { min: 0, max: 5 }),
        toolMaxCalls: integer(env, 'CHAT_TOOL_MAX_CALLS', 5, { min: 0, max: 10 }),
        rawRetentionDays: integer(env, 'CHAT_RAW_RETENTION_DAYS', 90, { min: 1, max: 3650 }),
        backgroundConcurrency: integer(env, 'CHAT_BACKGROUND_CONCURRENCY', 1, { min: 1, max: 8 }),
        observeParticipants: boolean(env, 'CHAT_OBSERVE_PARTICIPANTS', true),
        followupWindowSeconds: integer(env, 'CHAT_FOLLOWUP_WINDOW_SECONDS', 0, { min: 0, max: 90 }),
        qdrantUrl: privateServiceUrl(env.QDRANT_URL || 'http://127.0.0.1:6333', 'QDRANT_URL', serviceHosts),
        qdrantApiKey: env.QDRANT_API_KEY || null,
        searxngUrl: privateServiceUrl(env.SEARXNG_URL || 'http://127.0.0.1:8088', 'SEARXNG_URL', serviceHosts),
        embedding: {
            model: embeddingModel,
            revision: embeddingRevision,
            device: env.CHAT_EMBEDDING_DEVICE || 'cpu',
            cacheDir: path.resolve(root, env.CHAT_EMBEDDING_CACHE || 'data/chat-models'),
            dimension: 384,
            maxTokens: 512
        },
        episodeTurnThreshold: integer(env, 'CHAT_EPISODE_TURN_THRESHOLD', 12, { min: 2, max: 100 }),
        episodeTokenThreshold: integer(env, 'CHAT_EPISODE_TOKEN_THRESHOLD', 2000, { min: 256, max: 16000 })
    }

    if (config.engine !== 'overhaul') throw new ChatConfigError('CHAT_ENGINE must be overhaul')
    if (config.thinkingDefault) throw new ChatConfigError('CHAT_THINKING_DEFAULT must remain false; thinking is per-request only')
    if (config.coldTimeoutMs < config.turnTimeoutMs) {
        throw new ChatConfigError('CHAT_COLD_TIMEOUT_MS cannot be shorter than CHAT_TURN_TIMEOUT_MS')
    }
    return Object.freeze(config)
}

module.exports = {
    ChatConfigError,
    DEFAULT_EMBEDDING_REVISION,
    isPrivateHost,
    loadConfig
}
