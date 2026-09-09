#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { lmstudioWorkload, workloadHeaders } = require('../../utils/orchestrator_workload');

function privateHost(hostname, allowlisted = '') {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return true;
    const parts = host.split('.').map(Number);
    if (parts.length === 4 && parts.every(Number.isInteger)) {
        return parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
    }
    return host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host) || allowlisted.split(',').map(item => item.trim().toLowerCase()).includes(host);
}

function serviceUrl(name, raw, options = {}) {
    const url = new URL(raw);
    if (!['http:', 'https:', ...(options.mongo ? ['mongodb:', 'mongodb+srv:'] : [])].includes(url.protocol)) throw new Error(`${name} uses an unsupported protocol`);
    if (!options.mongo && (url.username || url.password)) throw new Error(`${name} URL must not contain credentials`);
    if (!privateHost(url.hostname, process.env.CHAT_ALLOWED_SERVICE_HOSTS || '')) throw new Error(`${name} must use a private/local or explicitly allowlisted host`);
    return url;
}

async function timed(name, fn) {
    const started = Date.now();
    try {
        const details = await fn();
        return { name, ok: true, durationMs: Date.now() - started, details };
    } catch (error) {
        return { name, ok: false, durationMs: Date.now() - started, error: error.message };
    }
}

async function fetchJson(url, init, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const text = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
        return text ? JSON.parse(text) : {};
    } finally {
        clearTimeout(timer);
    }
}

async function main() {
    if (String(process.env.CHAT_LOCAL_ONLY || 'true').toLowerCase() !== 'true') throw new Error('CHAT_LOCAL_ONLY=true is required');
    const strict = process.argv.includes('--strict');
    const model = process.env.CHAT_MODEL || 'unsloth/gemma-4-12B-it-qat-GGUF';
    if (/(gemini|openai|gpt-|claude|anthropic)/i.test(model)) throw new Error('Cloud inference model rejected');

    const proxy = serviceUrl('AI_PROXY_URL', process.env.AI_PROXY_URL || 'http://127.0.0.1:11230');
    const qdrant = serviceUrl('QDRANT_URL', process.env.QDRANT_URL || 'http://127.0.0.1:6333');
    const searxng = serviceUrl('SEARXNG_URL', process.env.SEARXNG_URL || 'http://127.0.0.1:8088');
    const checks = [];
    checks.push(await timed('local inference', async () => {
        const body = await fetchJson(new URL('/v1/chat/completions', proxy), {
            method: 'POST',
            headers: workloadHeaders('unsloth', lmstudioWorkload({ model, contextLength: 8192, maxTokens: 24 }), {
                'content-type': 'application/json'
            }),
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'Reply with exactly: local chat ready' }],
                max_tokens: 24,
                stream: false,
                chat_template_kwargs: { enable_thinking: false }
            })
        }, Number(process.env.CHAT_COLD_TIMEOUT_MS || 180000));
        const text = String(body.choices?.[0]?.message?.content || '').trim();
        if (!text) throw new Error('no visible completion text');
        return { model: body.model || model, visibleText: text.slice(0, 100) };
    }));
    checks.push(await timed('qdrant', async () => {
        const body = await fetchJson(new URL('/collections', qdrant));
        return { collections: body.result?.collections?.length ?? null };
    }));
    checks.push(await timed('searxng json', async () => {
        const url = new URL('/search', searxng);
        url.searchParams.set('q', 'Node.js test runner documentation');
        url.searchParams.set('format', 'json');
        const body = await fetchJson(url);
        if (!Array.isArray(body.results)) throw new Error('JSON search results are not enabled');
        return { results: body.results.length, exercised: true };
    }));

    if (process.env.MONGODB_CONNECTION_STRING) {
        checks.push(await timed('mongo', async () => {
            const mongoUrl = serviceUrl('MONGODB_CONNECTION_STRING', process.env.MONGODB_CONNECTION_STRING, { mongo: true });
            const client = new MongoClient(mongoUrl.toString(), { serverSelectionTimeoutMS: 5000 });
            try {
                const result = await client.db(process.env.CHAT_MONGODB_DATABASE || 'another_elaina').command({ ping: 1 });
                return { ping: result.ok === 1 };
            } finally {
                await client.close();
            }
        }));
    } else {
        checks.push({ name: 'mongo', ok: false, skipped: true, error: 'MONGODB_CONNECTION_STRING is not set' });
    }

    const requiredFailure = checks.find(item => item.name === 'local inference' && !item.ok);
    const anyFailure = checks.some(item => !item.ok);
    const report = { ok: !requiredFailure && !(strict && anyFailure), strict, localOnly: true, checkedAt: new Date().toISOString(), checks };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
}

main().catch(error => {
    console.error(`local chat smoke failed: ${error.message}`);
    process.exitCode = 1;
});
