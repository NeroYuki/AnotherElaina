'use strict'

class ChatStatus {
    constructor(initial = {}) {
        this.services = { ...initial }
        this.updatedAt = new Date()
    }

    set(name, value) {
        this.services[name] = value
        this.updatedAt = new Date()
    }

    snapshot() {
        return { updatedAt: this.updatedAt, services: structuredClone(this.services) }
    }
}

module.exports = { ChatStatus }
