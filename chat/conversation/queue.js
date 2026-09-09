'use strict'

class KeyedQueue {
    constructor() {
        this.tails = new Map()
    }

    run(key, operation) {
        const previous = this.tails.get(key) || Promise.resolve()
        const current = previous.catch(() => {}).then(operation)
        this.tails.set(key, current)
        return current.finally(() => {
            if (this.tails.get(key) === current) this.tails.delete(key)
        })
    }

    async drain() {
        await Promise.allSettled([...this.tails.values()])
    }
}

class Semaphore {
    constructor(limit = 1) {
        this.limit = limit
        this.active = 0
        this.waiters = []
    }

    async run(operation, signal) {
        await this.acquire(signal)
        try {
            return await operation()
        } finally {
            this.release()
        }
    }

    acquire(signal) {
        if (signal?.aborted) return Promise.reject(signal.reason)
        if (this.active < this.limit) {
            this.active += 1
            return Promise.resolve()
        }
        return new Promise((resolve, reject) => {
            const waiter = { resolve, reject, signal, onAbort: null }
            waiter.onAbort = () => {
                this.waiters = this.waiters.filter(item => item !== waiter)
                reject(signal.reason || new DOMException('Aborted', 'AbortError'))
            }
            signal?.addEventListener('abort', waiter.onAbort, { once: true })
            this.waiters.push(waiter)
        })
    }

    release() {
        const waiter = this.waiters.shift()
        if (!waiter) {
            this.active -= 1
            return
        }
        waiter.signal?.removeEventListener('abort', waiter.onAbort)
        waiter.resolve()
    }
}

module.exports = { KeyedQueue, Semaphore }
