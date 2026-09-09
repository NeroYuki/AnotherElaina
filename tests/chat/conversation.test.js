'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { KeyedQueue, Semaphore } = require('../../chat/conversation/queue')
const { buildContext } = require('../../chat/conversation/context_builder')
const { runToolLoop } = require('../../chat/conversation/turn_state')
const { ConversationService, needsFreshWebSearch, stripRoleplayControlLabels, visibleStreamingText } = require('../../chat/conversation/service')

test('continuity queue serializes one scope while independent scopes proceed', async () => {
    const queue = new KeyedQueue()
    const order = []
    let release
    const gate = new Promise(resolve => { release = resolve })
    const first = queue.run('same', async () => { order.push('first-start'); await gate; order.push('first-end') })
    const second = queue.run('same', async () => { order.push('second') })
    const independent = queue.run('other', async () => { order.push('other') })
    await independent
    assert.deepEqual(order, ['first-start', 'other'])
    release()
    await Promise.all([first, second])
    assert.deepEqual(order, ['first-start', 'other', 'first-end', 'second'])
})

test('inference semaphore observes cancellation while queued', async () => {
    const semaphore = new Semaphore(1)
    let release
    const gate = new Promise(resolve => { release = resolve })
    const running = semaphore.run(() => gate)
    const controller = new AbortController()
    const queued = semaphore.run(async () => 'unexpected', controller.signal)
    controller.abort(new Error('cancelled'))
    await assert.rejects(queued, /cancelled/)
    release()
    await running
})

test('context keeps stable speaker IDs and excludes rejected assistant variants', () => {
    const messages = buildContext({
        event: { author: { id: 'u2', displayName: 'Ren' }, content: 'Do you remember?', segments: [], attachments: [] },
        scene: { sceneId: 's1', title: 'Inn', participants: [], projectedState: {} },
        relationships: [], retrieval: [], images: [],
        turns: [
            { authorUserId: 'u1', authorDisplayName: 'Same Name', content: 'hello', response: { text: 'old answer' }, responseRejected: true },
            { authorUserId: 'u2', authorDisplayName: 'Same Name', content: 'different person', response: { text: 'accepted answer' } }
        ]
    })
    const transcript = JSON.stringify(messages)
    assert.match(transcript, /Same Name \[user:u1\]/)
    assert.match(transcript, /Same Name \[user:u2\]/)
    assert.doesNotMatch(transcript, /old answer/)
    assert.match(transcript, /accepted answer/)
})

test('streamed tool loop buffers dialogue, executes complete calls, and retains sources', async () => {
    let generation = 0
    const streamed = []
    let toolStarted = 0
    const provider = {
        async *stream() {
            generation += 1
            if (generation === 1) {
                yield { type: 'toolCallDelta', index: 0, id: 'c1', name: 'web_search', arguments: '{"query":"Node' }
                yield { type: 'toolCallDelta', index: 0, id: null, name: '', arguments: '.js"}' }
                yield { type: 'finished', finishReason: 'tool_calls', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"Node.js"}' } }] }
            } else {
                yield { type: 'textDelta', text: 'Node.js has a built-in test runner.' }
                yield { type: 'finished', finishReason: 'stop', toolCalls: [], model: 'local' }
            }
        }
    }
    const source = { id: 'web-1', title: 'Node.js', url: 'https://nodejs.org/' }
    const result = await runToolLoop({
        provider,
        messages: [{ role: 'user', content: 'look it up' }],
        tools: [],
        toolRunner: { run: async () => ({ ok: true, data: { results: [] }, sources: [source], error: null }) },
        trustedContext: { turnId: 't1' },
        maxRounds: 3,
        maxCalls: 5,
        maxOutputTokens: 128,
        thinking: false,
        onDelta: text => streamed.push(text),
        onToolStart: () => { toolStarted += 1 }
    })
    assert.equal(result.text, 'Node.js has a built-in test runner.')
    assert.deepEqual(result.sources, [source])
    assert.equal(result.toolCallCount, 1)
    assert.deepEqual(streamed, ['Node.js has a built-in test runner.'])
    assert.equal(toolStarted, 1)
})

test('OOC retcons cannot rewrite another participant character', () => {
    const service = Object.create(ConversationService.prototype)
    const event = { content: 'OOC: Actually, Mira now loves the tower.', segments: [{ mode: 'ooc' }] }
    const scene = { participants: [{ userId: 'mira-user', displayName: 'Mira' }, { userId: 'sora-user', displayName: 'Sora' }] }
    assert.match(service._unauthorizedRetcon(event, scene, { userId: 'sora-user', isOwner: false, isModerator: false }), /can't change Mira/)
    assert.equal(service._unauthorizedRetcon(event, scene, { userId: 'sora-user', isOwner: false, isModerator: true }), null)
})

test('time-sensitive questions deterministically require web search', () => {
    assert.equal(needsFreshWebSearch('how much is a dollar in Japanese yen?'), true)
    assert.equal(needsFreshWebSearch('what is the weather in Bangkok?'), true)
    assert.equal(needsFreshWebSearch('what is the latest Node.js release?'), true)
    assert.equal(needsFreshWebSearch('who is the president of France?'), true)
    assert.equal(needsFreshWebSearch('when is the next Formula 1 race?'), true)
    assert.equal(needsFreshWebSearch('do you remember our dollar-shaped charm?'), false)
})

test('roleplay control labels never reach normal Discord output', () => {
    assert.equal(stripRoleplayControlLabels('OOC: Direct answer.\n\nIC: A brief aside.'), 'Direct answer.\n\nA brief aside.')
    assert.equal(visibleStreamingText('O'), '')
    assert.equal(visibleStreamingText('OOC:'), '')
    assert.equal(visibleStreamingText('OOC: Direct'), 'Direct')
    assert.equal(visibleStreamingText('One dollar'), 'One dollar')
})

test('required current-data tool is executed even if the model initially refuses it', async () => {
    let generation = 0
    let toolCalls = 0
    const provider = {
        async *stream(request) {
            generation += 1
            if (generation === 1) {
                assert.deepEqual(request.toolChoice, { type: 'function', function: { name: 'web_search' } })
                yield { type: 'textDelta', text: 'I cannot browse.' }
                yield { type: 'finished', finishReason: 'stop', toolCalls: [], model: 'local' }
            } else {
                yield { type: 'textDelta', text: 'One dollar is about 154 yen.' }
                yield { type: 'finished', finishReason: 'stop', toolCalls: [], model: 'local' }
            }
        }
    }
    const result = await runToolLoop({
        provider,
        messages: [{ role: 'user', content: 'How much is a dollar in yen?' }],
        tools: [],
        toolRunner: { async run({ call }) {
            toolCalls += 1
            assert.equal(call.function.name, 'web_search')
            return { ok: true, data: { results: [{ snippet: '1 USD = 154 JPY' }] }, sources: [], error: null }
        } },
        trustedContext: { turnId: 't-required' },
        requiredTool: { name: 'web_search', arguments: { query: 'USD JPY exchange rate' } },
        maxRounds: 2,
        maxCalls: 2,
        maxOutputTokens: 128,
        thinking: false,
        turnId: 't-required'
    })
    assert.equal(toolCalls, 1)
    assert.equal(result.text, 'One dollar is about 154 yen.')
})
