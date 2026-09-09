'use strict'

const MODEL_PROFILES = Object.freeze({
    gemma: Object.freeze({ alias: 'gemma', model: 'unsloth/gemma-4-12B-it-qat-GGUF', quantization: 'UD-Q4_K_XL', resourceTier: 'standard' }),
    qwen_27b: Object.freeze({ alias: 'qwen_27b', model: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M', quantization: 'UD-Q4_K_M', resourceTier: 'high' }),
    qwen_flash_next: Object.freeze({ alias: 'qwen_flash_next', model: 'unsloth/Qwen3.8-Flash-Next-GGUF:UD-IQ3_XXS', quantization: 'UD-IQ3_XXS', resourceTier: 'extreme' })
})

function profileForModel(model) {
    return Object.values(MODEL_PROFILES).find(profile => profile.model === model) || null
}

function profileForAlias(alias) {
    const normalized = String(alias || '').toLowerCase()
    return MODEL_PROFILES[normalized === 'qwen' ? 'qwen_27b' : normalized] || null
}

module.exports = { MODEL_PROFILES, profileForModel, profileForAlias }
