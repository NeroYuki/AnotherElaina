'use strict'

require('dotenv').config()
const { initializeMongo, openMongo } = require('../../chat/persistence/mongo')
const { COLLECTIONS } = require('../../chat/persistence/collections')

async function main() {
    const connection = await openMongo()
    try {
        const { db, indexes } = await initializeMongo({ db: connection.db })
        const now = new Date()
        await db.collection(COLLECTIONS.migrations).updateOne(
            { migrationId: 'chat-schema-v1' },
            { $setOnInsert: { migrationId: 'chat-schema-v1', schemaVersion: 1, appliedAt: now, createdAt: now, updatedAt: now } },
            { upsert: true }
        )
        for (const result of indexes) console.log(`${result.collection}: ${result.indexes.length} indexes ensured`)
        console.log('Chat schema migration v1 applied')
    } finally {
        await connection.close()
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
