#!/usr/bin/env node
'use strict'

require('dotenv').config()
const { openMongo } = require('../../chat/persistence/mongo')
const { createChatSubsystem } = require('../../chat')

async function main() {
    const connection = await openMongo({ dbName: process.env.CHAT_MONGODB_DATABASE || 'another_elaina' })
    let subsystem
    try {
        subsystem = await createChatSubsystem({ db: connection.db })
        const status = subsystem.status.snapshot()
        console.log(JSON.stringify({ ok: true, localOnly: subsystem.config.localOnly, model: subsystem.config.model, status }, null, 2))
        if (process.argv.includes('--strict') && Object.values(status.services).some(service => service.enabled && service.reachable === false)) process.exitCode = 1
    } finally {
        await subsystem?.stop()
        await connection.close()
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
