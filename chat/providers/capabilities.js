'use strict';

async function probeCapabilities({ endpoint, model, expectedContextTokens, fetchImpl = globalThis.fetch, signal, headers = {} }) {
    const url = new URL('/api/inference/status', endpoint);
    const response = await fetchImpl(url, { headers: { 'X-AI-Service': 'unsloth', ...headers }, signal });
    if (!response.ok) throw new Error(`Capability probe failed with HTTP ${response.status}`);
    const status = await response.json();
    const active = status.models?.find?.(item => item.id === model || item.model === model) || status;
    const contextTokens = Number(active.context_length ?? active.contextLength) || null;
    return {
        model,
        activeModel: active.active_model ?? active.id ?? active.model ?? null,
        reachable: true,
        nativeTools: Boolean(active.supports_tools ?? active.tools ?? active.tool_support ?? active.capabilities?.tools),
        vision: Boolean(active.is_vision ?? active.vision ?? active.vision_support ?? active.capabilities?.vision),
        thinking: Boolean(active.supports_reasoning ?? active.reasoning ?? active.thinking ?? active.capabilities?.reasoning),
        contextTokens,
        requestedContextTokens: Number(active.requested_context_length ?? active.requestedContextLength) || null,
        quantization: active.gguf_variant ?? active.quantization ?? null,
        contextSufficient: expectedContextTokens ? contextTokens === null || contextTokens >= expectedContextTokens : null,
        degraded: Boolean(expectedContextTokens && contextTokens !== null && contextTokens < expectedContextTokens),
        rawVersion: status.version || null,
    };
}

module.exports = { probeCapabilities };
