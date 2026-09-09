#!/usr/bin/env node
'use strict'

require('dotenv').config()
const path = require('node:path')

async function main() {
    const model = process.env.CHAT_EMBEDDING_MODEL || 'Xenova/multilingual-e5-small'
    const revision = process.env.CHAT_EMBEDDING_REVISION || '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
    const cacheDir = path.resolve(process.env.CHAT_EMBEDDING_CACHE || 'data/chat-models')
    if (model !== 'Xenova/multilingual-e5-small' || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Embedding model and full pinned revision are required')
    const transformers = require('@huggingface/transformers')
    transformers.env.allowRemoteModels = true
    transformers.env.allowLocalModels = true
    transformers.env.cacheDir = cacheDir
    const extractor = await transformers.pipeline('feature-extraction', model, { revision, device: process.env.CHAT_EMBEDDING_DEVICE || 'cpu' })
    const output = await extractor('query: local setup verification', { pooling: 'mean', normalize: true, truncation: true, max_length: 512 })
    const vector = output.tolist()[0]
    if (!Array.isArray(vector) || vector.length !== 384) throw new Error(`Expected 384 embedding dimensions, received ${vector?.length}`)
    console.log(`Cached and verified ${model}@${revision} (${vector.length} dimensions) in ${cacheDir}`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
