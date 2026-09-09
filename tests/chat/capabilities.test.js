'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { probeCapabilities } = require('../../chat/providers/capabilities')

test('capability probe understands the live orchestrator status field names', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
        supports_tools: true,
        is_vision: true,
        supports_reasoning: true,
        context_length: 8192
    }), { headers: { 'content-type': 'application/json' } })
    const result = await probeCapabilities({ endpoint: 'http://127.0.0.1:11230', model: 'unsloth/gemma-4-12B-it-qat-GGUF', fetchImpl })
    assert.equal(result.nativeTools, true)
    assert.equal(result.vision, true)
    assert.equal(result.thinking, true)
    assert.equal(result.contextTokens, 8192)
})
