#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { buildPersonaMessage } = require('../../chat/persona/prompt_builder');
const { runReplay, validateFixture } = require('../../tests/chat/replay/runner');
const { lmstudioWorkload, workloadHeaders } = require('../../utils/orchestrator_workload');

const root = path.resolve(__dirname, '../..');
const defaultFixture = path.join(root, 'tests/chat/replay/fixtures/scenarios.json');

function args(argv) {
    const result = { run: false, fixture: defaultFixture, ids: [], output: null, criticalRuns: 3 };
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (item === '--run') result.run = true;
        else if (item === '--fixture') result.fixture = path.resolve(argv[++index]);
        else if (item === '--scenario') result.ids.push(argv[++index]);
        else if (item === '--output') result.output = path.resolve(argv[++index]);
        else if (item === '--critical-runs') result.criticalRuns = Math.max(1, Math.min(Number(argv[++index]), 10));
        else if (item === '--help') result.help = true;
        else throw new Error(`Unknown argument: ${item}`);
    }
    return result;
}

function privateHost(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return true;
    const parts = host.split('.').map(Number);
    if (parts.length === 4 && parts.every(Number.isInteger)) {
        return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
    }
    return host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host) ||
        String(process.env.CHAT_ALLOWED_INFERENCE_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).includes(host);
}

function localEndpoint(rawUrl) {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !privateHost(url.hostname)) {
        throw new Error('Evaluation inference URL must be an allowlisted private/local HTTP(S) endpoint without credentials');
    }
    return url;
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function createLocalAdapter() {
    if (String(process.env.CHAT_LOCAL_ONLY || 'true').toLowerCase() !== 'true') throw new Error('CHAT_LOCAL_ONLY=true is required');
    const model = process.env.CHAT_MODEL || 'unsloth/gemma-4-12B-it-qat-GGUF';
    if (/(gemini|openai|gpt-|claude|anthropic)/i.test(model)) throw new Error('Cloud inference models are forbidden for replay evaluation');
    const base = localEndpoint(process.env.AI_PROXY_URL || 'http://127.0.0.1:11230');
    const endpoint = new URL('/v1/chat/completions', base);
    const timeoutMs = Math.max(1000, Math.min(Number(process.env.CHAT_COLD_TIMEOUT_MS || 180000), 180000));

    return {
        mode: 'local-provider-dialogue',
        localOnly: true,
        model,
        endpoint: `${endpoint.protocol}//${endpoint.host}`,
        async runScenario(scenario) {
            const messages = [buildPersonaMessage({ maxExamples: 3 })];
            const replies = [];
            const latencies = [];
            for (const turn of scenario.turns) {
                if (!turn.content) continue;
                if (turn.actorId === 'elaina') {
                    messages.push({ role: 'assistant', content: turn.content });
                    continue;
                }
                messages.push({ role: 'user', content: `[Discord user id: ${turn.actorId}]\n${turn.content}` });
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                const started = Date.now();
                try {
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        signal: controller.signal,
                        headers: workloadHeaders('unsloth', lmstudioWorkload({
                            model,
                            contextLength: Number(process.env.CHAT_CONTEXT_TOKENS || 8192),
                            maxTokens: Number(process.env.CHAT_MAX_OUTPUT_TOKENS || 512)
                        }), { 'content-type': 'application/json' }),
                        body: JSON.stringify({
                            model,
                            messages,
                            max_tokens: Number(process.env.CHAT_MAX_OUTPUT_TOKENS || 512),
                            stream: false,
                            chat_template_kwargs: { enable_thinking: false }
                        })
                    });
                    if (!response.ok) throw new Error(`local provider returned HTTP ${response.status}`);
                    const body = await response.json();
                    const text = String(body.choices?.[0]?.message?.content || '').trim();
                    if (!text) throw new Error('local provider returned no visible text');
                    latencies.push(Date.now() - started);
                    replies.push(text);
                    messages.push({ role: 'assistant', content: text });
                } finally {
                    clearTimeout(timer);
                }
            }
            return { ok: replies.length > 0, replies, latencies, expectations: scenario.expect, requiresHumanReview: true };
        }
    };
}

function loadAdapter() {
    if (!process.env.CHAT_EVAL_ADAPTER) return createLocalAdapter();
    const location = path.resolve(root, process.env.CHAT_EVAL_ADAPTER);
    const loaded = require(location);
    const adapter = typeof loaded.createAdapter === 'function' ? loaded.createAdapter({ root }) : loaded;
    if (!adapter || typeof adapter.runScenario !== 'function') throw new Error('CHAT_EVAL_ADAPTER must export runScenario or createAdapter');
    if (adapter.localOnly !== true) throw new Error('CHAT_EVAL_ADAPTER must explicitly declare localOnly: true');
    return adapter;
}

async function main() {
    const options = args(process.argv.slice(2));
    if (options.help) {
        console.log('Usage: node scripts/chat/evaluate.cjs [--run] [--scenario ID] [--critical-runs 3] [--output FILE]');
        return;
    }
    const fixture = JSON.parse(fs.readFileSync(options.fixture, 'utf8'));
    const validation = validateFixture(fixture);
    if (!validation.ok) throw new Error(validation.errors.join('\n'));
    if (!options.run) {
        console.log(JSON.stringify({ ok: true, mode: 'validate-only', scenarios: fixture.scenarios.length, counts: validation.counts }, null, 2));
        return;
    }

    const adapter = loadAdapter();
    const selected = options.ids.length ? options.ids : fixture.scenarios.map(item => item.id);
    const expanded = [];
    for (const id of selected) {
        expanded.push(id);
        const scenario = fixture.scenarios.find(item => item.id === id);
        if (scenario?.category === 'corrections_deletion') {
            for (let iteration = 1; iteration < options.criticalRuns; iteration += 1) expanded.push(id);
        }
    }
    const reports = [];
    for (const id of expanded) reports.push(await runReplay(fixture, adapter, { ids: [id], failFast: true }));
    const results = reports.flatMap(report => report.results);
    const latencies = results.flatMap(result => result.details?.latencies || []);
    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        mode: adapter.mode || 'injected',
        model: adapter.model || process.env.CHAT_MODEL || null,
        endpoint: adapter.endpoint || null,
        localOnly: true,
        scenarioRuns: results.length,
        passedTransport: results.filter(result => result.ok).length,
        failed: results.filter(result => !result.ok).map(result => ({ id: result.id, error: result.error })),
        latencyMs: { median: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), samples: latencies.length },
        note: 'Direct-provider mode validates transport and captures outputs; fixture expectations require human review or an injected integrated adapter. No paid/cloud judge is used.',
        results
    };
    if (options.output) fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (report.failed.length) process.exitCode = 1;
}

main().catch(error => {
    console.error(`chat evaluation failed: ${error.message}`);
    process.exitCode = 1;
});
