'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { ChatConfigError, DEFAULT_EMBEDDING_REVISION, isPrivateHost, loadConfig } = require('../../chat/config')

test('chat config is local-only with a pinned embedding revision', () => {
    const config = loadConfig({}, { rootDir: process.cwd() })
    assert.equal(config.localOnly, true)
    assert.equal(config.model, 'unsloth/gemma-4-12B-it-qat-GGUF')
    assert.equal(config.modelQuantization, 'UD-Q4_K_XL')
    assert.equal(config.embedding.revision, DEFAULT_EMBEDDING_REVISION)
    assert.equal(config.thinkingDefault, false)
    assert.equal(config.responseStyle, 'compact')
    assert.equal(config.compactMaxOutputTokens, 192)
    assert.equal(config.compactMaxWords, 90)
})

test('chat config supports the explicit Qwen profiles and gates the extreme model', () => {
    const qwen = loadConfig({ CHAT_MODEL: 'unsloth/Qwen3.8-27B-GGUF' }, { rootDir: process.cwd() })
    assert.equal(qwen.modelAlias, 'qwen_27b')
    assert.equal(qwen.modelQuantization, 'UD-Q4_K_M')
    assert.throws(() => loadConfig({ CHAT_MODEL: 'unsloth/Qwen3.8-Flash-Next-GGUF' }), /CHAT_ALLOW_EXTREME_MODEL/)
    const flash = loadConfig({ CHAT_MODEL: 'unsloth/Qwen3.8-Flash-Next-GGUF', CHAT_ALLOW_EXTREME_MODEL: 'true' })
    assert.equal(flash.modelQuantization, 'UD-IQ3_XXS')
    assert.throws(() => loadConfig({ CHAT_MODEL: 'unsloth/Qwen3.8-27B-GGUF', CHAT_MODEL_QUANTIZATION: 'UD-IQ3_XXS' }), /UD-Q4_K_M/)
})

test('chat config rejects cloud inference and non-local models', () => {
    assert.throws(() => loadConfig({ AI_PROXY_URL: 'https://api.example.com', CHAT_LOCAL_ONLY: 'true' }), ChatConfigError)
    assert.throws(() => loadConfig({ CHAT_MODEL: 'gemini-2.5-flash' }), ChatConfigError)
    assert.throws(() => loadConfig({ CHAT_LOCAL_ONLY: 'false' }), ChatConfigError)
    assert.throws(() => loadConfig({ CHAT_RESPONSE_STYLE: 'novel' }), ChatConfigError)
})

test('private host classification covers local IPv4 and IPv6', () => {
    assert.equal(isPrivateHost('192.168.1.3'), true)
    assert.equal(isPrivateHost('127.0.0.1'), true)
    assert.equal(isPrivateHost('::1'), true)
    assert.equal(isPrivateHost('8.8.8.8'), false)
})
