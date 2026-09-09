'use strict'

require('dotenv').config()
const fs = require('node:fs/promises')
const path = require('node:path')
const { loadConfig } = require('../../chat/config')
const { initializeMongo, openMongo } = require('../../chat/persistence/mongo')
const { ChatRepository } = require('../../chat/persistence/repository')
const { E5Embedder } = require('../../chat/retrieval/embed_worker')
const { QdrantVectorIndex } = require('../../chat/retrieval/vector_index')
const { LoreIngestor } = require('../../chat/retrieval/ingest')

async function main() {
    const config = loadConfig()
    const loreRoot = path.resolve(__dirname, '../../resources/lore')
    const manifest = JSON.parse(await fs.readFile(path.join(loreRoot, 'manifest.json'), 'utf8'))
    const selectedId = process.argv.find(argument => argument.startsWith('--id='))?.slice(5)
    const entries = manifest.entries.filter(entry => entry.approved && (!selectedId || entry.id === selectedId))
    if (!entries.length) throw new Error('No approved manifest entries selected')

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
        await vectorIndex.ensureCollection()
        await vectorIndex.ensureAlias()
        const ingestor = new LoreIngestor({ repository, embedder, vectorIndex })
        for (const entry of entries) {
            const result = await ingestor.ingestFile(path.join(loreRoot, entry.path), {
                sourceKey: `bundled:${entry.id}:v${entry.version}`,
                title: entry.id,
                source: entry.source,
                sourceVersion: entry.version,
                corpus: entry.corpus,
                tags: entry.tags
            })
            console.log(`${entry.id}: ${result.unchanged ? 'unchanged' : `${result.chunks.length} chunks indexed`}`)
        }
    } finally {
        await connection.close()
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
