'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { DEFAULT_EMBEDDING_REVISION } = require('../config')

class E5Embedder {
    constructor(options = {}) {
        this.model = options.model || 'Xenova/multilingual-e5-small'
        this.revision = options.revision || DEFAULT_EMBEDDING_REVISION
        this.cacheDir = path.resolve(options.cacheDir || path.join(process.cwd(), 'data/chat-models'))
        this.device = options.device || 'cpu'
        this.dimension = options.dimension || 384
        this.maxTokens = options.maxTokens || 512
        this.moduleLoader = options.moduleLoader || (() => require('@huggingface/transformers'))
        this.pipelineFactory = options.pipelineFactory || null
        this.extractor = options.extractor || null
        this.loading = null
    }

    async init() {
        if (this.extractor) return this
        if (this.loading) return this.loading
        this.loading = Promise.resolve().then(async () => {
            let transformers
            try {
                transformers = this.moduleLoader()
            } catch (cause) {
                const error = new Error('@huggingface/transformers is required for local E5 embeddings')
                error.code = 'CHAT_DEPENDENCY_MISSING'
                error.cause = cause
                throw error
            }
            transformers = transformers.default || transformers
            if (transformers.env) {
                transformers.env.allowRemoteModels = false
                transformers.env.allowLocalModels = true
                transformers.env.cacheDir = this.cacheDir
            }
            const factory = this.pipelineFactory || transformers.pipeline
            if (typeof factory !== 'function') throw new Error('Transformers pipeline export is unavailable')
            const pinnedLocalModel = path.join(this.cacheDir, ...this.model.split('/'), this.revision)
            const modelSource = fs.existsSync(path.join(pinnedLocalModel, 'config.json'))
                ? pinnedLocalModel
                : this.model
            this.extractor = await factory('feature-extraction', modelSource, {
                revision: this.revision,
                device: this.device,
                local_files_only: true,
                cache_dir: this.cacheDir
            })
            if (typeof this.extractor !== 'function' || typeof this.extractor.tokenizer !== 'function') {
                const error = new Error(`Pinned embedding tokenizer is unavailable in ${pinnedLocalModel}; run npm run chat:setup:embedding`)
                error.code = 'CHAT_EMBEDDING_INCOMPLETE'
                throw error
            }
            return this
        })
        try {
            return await this.loading
        } finally {
            this.loading = null
        }
    }

    async embedQueries(texts) {
        return this._embed(texts, 'query: ')
    }

    async embedPassages(texts) {
        return this._embed(texts, 'passage: ')
    }

    async _embed(texts, prefix) {
        if (!Array.isArray(texts) || texts.length === 0) return []
        await this.init()
        const prepared = texts.map(text => `${prefix}${String(text).trim()}`)
        const output = await this.extractor(prepared, {
            pooling: 'mean',
            normalize: true,
            truncation: true,
            max_length: this.maxTokens
        })
        let vectors = typeof output.tolist === 'function' ? output.tolist() : output
        if (!Array.isArray(vectors[0])) vectors = [vectors]
        for (const vector of vectors) {
            if (!Array.isArray(vector) || vector.length !== this.dimension || vector.some(value => !Number.isFinite(value))) {
                throw Object.assign(new Error(`Embedding output must contain ${this.dimension} finite values`), { code: 'CHAT_EMBEDDING_DIMENSION' })
            }
        }
        return vectors
    }
}

module.exports = { E5Embedder }
