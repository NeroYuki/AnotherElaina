'use strict'

require('dotenv').config()
const { loadConfig } = require('../../chat/config')
const { initializeMongo, openMongo } = require('../../chat/persistence/mongo')
const { ChatRepository } = require('../../chat/persistence/repository')
const { E5Embedder } = require('../../chat/retrieval/embed_worker')
const { QdrantVectorIndex } = require('../../chat/retrieval/vector_index')
const { Reindexer } = require('../../chat/retrieval/ingest')

async function main() {
    const config = loadConfig()
    const connection = await openMongo()
    try {
        const { db } = await initializeMongo({ db: connection.db })
        const repository = new ChatRepository({ db })
        const embedder = new E5Embedder(config.embedding)
        const vectorIndex = new QdrantVectorIndex({
            url: config.qdrantUrl,
            model: config.embedding.model,
            revision: config.embedding.revision,
            dimension: config.embedding.dimension,
            apiKey: process.env.QDRANT_API_KEY
        })
        await embedder.init()
        const result = await new Reindexer({ repository, embedder, vectorIndex }).run({
            noSwitch: process.argv.includes('--no-switch')
        })
        console.log(JSON.stringify(result, null, 2))
    } finally {
        await connection.close()
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
