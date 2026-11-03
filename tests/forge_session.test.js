const test = require('node:test')
const assert = require('node:assert/strict')
const { setTimeout: sleep } = require('node:timers/promises')

const { withForgeSession } = require('../utils/forge_session')

test('Forge sessions serialize setup and inference through a single lease', async () => {
    let active = 0
    let maxActive = 0
    const order = []
    const run = (name, delay) => withForgeSession(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        order.push(`start:${name}`)
        await sleep(delay)
        order.push(`end:${name}`)
        active--
        return name
    })

    const results = await Promise.all([run('a', 20), run('b', 5), run('c', 1)])
    assert.deepEqual(results, ['a', 'b', 'c'])
    assert.equal(maxActive, 1)
    assert.deepEqual(order, [
        'start:a', 'end:a',
        'start:b', 'end:b',
        'start:c', 'end:c',
    ])
})

test('a failed job releases the lease and a later job still runs', async () => {
    await assert.rejects(withForgeSession(async () => {
        await sleep(5)
        throw new Error('boom')
    }), /boom/)

    const value = await withForgeSession(async () => 'after')
    assert.equal(value, 'after')
})

test('different Forge instance keys do not block each other', async () => {
    const order = []
    await Promise.all([
        withForgeSession(async () => {
            order.push('gpu0:start')
            await sleep(20)
            order.push('gpu0:end')
        }, { key: 'forge-gpu0' }),
        withForgeSession(async () => {
            order.push('gpu1:start')
            await sleep(1)
            order.push('gpu1:end')
        }, { key: 'forge-gpu1' }),
    ])
    assert.deepEqual(order, ['gpu0:start', 'gpu1:start', 'gpu1:end', 'gpu0:end'])
})

test('the default key matches forge-gpu0', async () => {
    let released
    const first = withForgeSession(async () => {
        await new Promise(resolve => { released = resolve })
    })
    let secondRan = false
    const second = withForgeSession(async () => { secondRan = true })
    await sleep(5)
    assert.equal(secondRan, false)
    released()
    await Promise.all([first, second])
    assert.equal(secondRan, true)
})
