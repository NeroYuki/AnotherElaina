'use strict'

const { ensureCollectionsAndIndexes } = require('./collections')

function getLegacyDb(databaseConnection) {
    const connection = databaseConnection || require('../../database/database_connection')
    const db = connection.getConnection()
    if (!db || typeof db.collection !== 'function') {
        const error = new Error('MongoDB is not connected; await database_connection.initConnection before chat initialization')
        error.code = 'CHAT_MONGO_NOT_READY'
        throw error
    }
    return db
}

async function assertMongoReady(db) {
    if (!db || typeof db.collection !== 'function') throw new TypeError('A connected Mongo Db is required')
    if (typeof db.command === 'function') await db.command({ ping: 1 })
    return db
}

async function initializeMongo(options = {}) {
    const db = options.db || getLegacyDb(options.databaseConnection)
    await assertMongoReady(db)
    const indexes = await ensureCollectionsAndIndexes(db, { verifyOnly: options.verifyOnly === true })
    return { db, indexes }
}

async function openMongo(options = {}) {
    let mongodb
    try {
        mongodb = options.mongodb || require('mongodb')
    } catch (cause) {
        throw Object.assign(new Error('mongodb is required for chat persistence'), { code: 'CHAT_DEPENDENCY_MISSING', cause })
    }
    const uri = options.uri || process.env.MONGODB_CONNECTION_STRING
    if (!uri) throw new Error('MONGODB_CONNECTION_STRING is required')
    const client = new mongodb.MongoClient(uri, {
        connectTimeoutMS: options.connectTimeoutMS || 30000,
        socketTimeoutMS: options.socketTimeoutMS || 30000
    })
    await client.connect()
    return {
        client,
        db: client.db(options.dbName || 'another_elaina'),
        close: () => client.close()
    }
}

module.exports = { assertMongoReady, getLegacyDb, initializeMongo, openMongo }
