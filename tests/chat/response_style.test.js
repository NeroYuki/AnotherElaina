'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
    formatResponseForChat,
    normalizeResponseStyle,
    responseStyleInstruction
} = require('../../chat/conversation/response_style')

test('compact is the default and gives the model a real-time chat contract', () => {
    assert.equal(normalizeResponseStyle(), 'compact')
    assert.match(responseStyleInstruction('compact', 80), /one to three short sentences/i)
    assert.match(responseStyleInstruction('compact', 80), /80 words/i)
    assert.throws(() => normalizeResponseStyle('novel'), /Unsupported/)
})

test('compact output is deterministically word-bounded while sources remain intact', () => {
    const prose = Array.from({ length: 120 }, (_, index) => `word${index}`).join(' ')
    const output = formatResponseForChat(`${prose}\n\nSources consulted:\n- [Source](https://example.com)`, {
        style: 'compact', maxWords: 40
    })
    const body = output.split('\n\nSources consulted:')[0]
    assert.ok((body.match(/\S+/g) || []).length <= 40)
    assert.match(output, /Sources consulted:\n- \[Source\]/)
})

test('emoji style removes standalone action prose and keeps the actual reply', () => {
    const output = formatResponseForChat([
        'I arch a brow, my expression becoming more serious.',
        'That makes it far more capable against targets at night.',
        'I turn back to you, my blue eyes sharp.',
        'Thermal tracking also removes much of the advantage of darkness.'
    ].join('\n\n'), { style: 'emoji', maxWords: 80 })
    assert.match(output, /^🤨/)
    assert.doesNotMatch(output, /arch a brow|turn back to you/i)
    assert.match(output, /Thermal tracking/)
    assert.equal((output.match(/[🤨✨]/gu) || []).length, 1)
})

test('expressive style preserves intentionally long roleplay prose', () => {
    const input = 'I turn toward the window.\n\nA longer response remains intact.'
    assert.equal(formatResponseForChat(input, { style: 'expressive', maxWords: 3 }), input)
})
