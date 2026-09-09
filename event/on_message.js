'use strict'

let service = null

function configureConversationService(next) {
    service = next
}

async function responseToMessage(client, message) {
    if (!service) throw new Error('The local chat subsystem is not initialized')
    return service.intake(client, message)
}

module.exports = { configureConversationService, responseToMessage }
