'use strict'

function serializeToolResult(result) {
    return JSON.stringify(result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error })
}

async function collectGeneration(provider, request, callbacks = {}) {
    let text = ''
    let finished = null
    let announcedTool = false
    for await (const event of provider.stream(request)) {
        if (event.type === 'textDelta') {
            text += event.text
            await callbacks.onDelta?.(text)
        }
        else if (event.type === 'toolCallDelta' && !announcedTool) {
            announcedTool = true
            await callbacks.onToolStart?.()
        }
        else if (event.type === 'finished') finished = event
    }
    return {
        text,
        toolCalls: finished?.toolCalls || [],
        finishReason: finished?.finishReason || null,
        usage: finished?.usage || null,
        model: finished?.model || null
    }
}

async function runToolLoop(options) {
    const messages = [...options.messages]
    const sources = []
    let calls = 0
    let webQueries = 0
    let pageFetches = 0
    let invalidCalls = 0
    const seen = new Set()
    let result

    for (let round = 0; round <= options.maxRounds; round += 1) {
        result = await collectGeneration(options.provider, {
            messages,
            tools: options.tools,
            maxOutputTokens: options.maxOutputTokens,
            thinking: options.thinking,
            signal: options.signal,
            jobId: options.turnId,
            vision: options.vision,
            toolChoice: round === 0 && options.requiredTool ? {
                type: 'function', function: { name: options.requiredTool.name }
            } : undefined
        }, {
            onDelta: round === 0 && options.requiredTool ? undefined : options.onDelta,
            onToolStart: options.onToolStart
        })
        if (!result.toolCalls.length && round === 0 && options.requiredTool) {
            result = {
                ...result,
                text: '',
                toolCalls: [{
                    id: `${options.turnId || 'turn'}-required-web`,
                    type: 'function',
                    function: {
                        name: options.requiredTool.name,
                        arguments: JSON.stringify(options.requiredTool.arguments)
                    }
                }]
            }
            await options.onToolStart?.()
        }
        if (!result.toolCalls.length) return { ...result, messages, sources, toolCallCount: calls }
        if (round === options.maxRounds) break
        messages.push({ role: 'assistant', content: result.text || null, tool_calls: result.toolCalls })
        for (const call of result.toolCalls) {
            const name = call.function?.name
            const signature = `${name}:${call.function?.arguments || ''}`
            if (seen.has(signature) || calls >= options.maxCalls || (name === 'web_search' && webQueries >= 2) || (name === 'web_fetch' && pageFetches >= 2)) {
                messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: { code: 'TOOL_BUDGET_EXCEEDED' } }) })
                continue
            }
            seen.add(signature)
            calls += 1
            if (name === 'web_search') webQueries += 1
            if (name === 'web_fetch') pageFetches += 1
            const toolResult = await options.toolRunner.run({ call, trustedContext: options.trustedContext, signal: options.signal })
            if (!toolResult.ok && ['INVALID_ARGUMENTS', 'UNKNOWN_TOOL'].includes(toolResult.error?.code)) invalidCalls += 1
            sources.push(...(toolResult.sources || []))
            messages.push({ role: 'tool', tool_call_id: call.id, content: serializeToolResult(toolResult) })
            if (invalidCalls >= 2) break
        }
        if (invalidCalls >= 2) break
    }

    messages.push({ role: 'user', content: 'Tool use has ended. Give a concise answer using successful evidence, and honestly state any limitation.' })
    const final = await collectGeneration(options.provider, {
        messages,
        tools: [],
        maxOutputTokens: options.maxOutputTokens,
        thinking: false,
        signal: options.signal,
        jobId: options.turnId
    }, { onDelta: options.onDelta })
    return { ...final, messages, sources, toolCallCount: calls }
}

module.exports = { collectGeneration, runToolLoop, serializeToolResult }
