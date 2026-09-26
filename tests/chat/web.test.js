'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSafeFetcher, isPublicIp, SafeFetchError } = require('../../chat/web/safe_fetch');
const { extractHtml } = require('../../chat/web/extract');
const { SourceRegistry, renderSources } = require('../../chat/web/source_registry');
const { createSearxngClient } = require('../../chat/web/searxng');

const dispatcherFactory = addresses => ({ addresses, close: async () => {} });

test('public IP validation blocks private, mapped, documentation, multicast, and loopback ranges', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '169.254.1.2', '192.168.1.2', '224.0.0.1', '::1', '::ffff:8.8.8.8', 'fc00::1', 'fe80::1', '2001:db8::1']) {
        assert.equal(isPublicIp(address), false, address);
    }
    assert.equal(isPublicIp('8.8.8.8'), true);
    assert.equal(isPublicIp('2606:4700:4700::1111'), true);
});

test('safe fetch classifies bracketed IPv6 literals before any network request', async () => {
    let fetched = false;
    const safeFetch = createSafeFetcher({ fetchImpl: async () => { fetched = true; }, dispatcherFactory });
    await assert.rejects(safeFetch('http://[::1]/admin'), { code: 'BLOCKED_ADDRESS' });
    await assert.rejects(safeFetch('http://[::ffff:127.0.0.1]/admin'), { code: 'BLOCKED_ADDRESS' });
    assert.equal(fetched, false);
});

test('safe fetch rejects credentials, pins approved DNS, and extracts bounded HTML', async () => {
    let requested;
    const safeFetch = createSafeFetcher({
        lookup: async () => [{ address: '93.184.216.34', family: 4 }], dispatcherFactory,
        fetchImpl: async (url, options) => {
            requested = { url: url.toString(), options };
            return new Response('<html><head><title>Page</title><script>steal()</script></head><body><main><h1>Hello</h1><p>Useful text</p></main></body></html>', {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        },
    });
    await assert.rejects(safeFetch('https://user:pass@example.com/article'), { code: 'BLOCKED_CREDENTIALS' });
    const page = await safeFetch('https://example.com/article');
    assert.equal(requested.url, 'https://example.com/article');
    assert.equal(requested.options.redirect, 'manual');
    assert.deepEqual(requested.options.dispatcher.addresses, [{ address: '93.184.216.34', family: 4 }]);
    assert.match(page.text, /Useful text/);
    assert.doesNotMatch(page.text, /steal/);
});

test('safe fetch revalidates redirects and blocks DNS rebinding before second request', async () => {
    let lookups = 0;
    let fetches = 0;
    const safeFetch = createSafeFetcher({
        lookup: async () => ++lookups === 1
            ? [{ address: '93.184.216.34', family: 4 }]
            : [{ address: '127.0.0.1', family: 4 }],
        dispatcherFactory,
        fetchImpl: async () => {
            fetches++;
            return new Response('', { status: 302, headers: { Location: 'https://second.example/private' } });
        },
    });
    await assert.rejects(safeFetch('https://first.example'), error => error instanceof SafeFetchError && error.code === 'BLOCKED_ADDRESS');
    assert.equal(fetches, 1);
});

test('safe fetch rejects oversized decompressed bodies and unsupported content', async () => {
    const common = { lookup: async () => [{ address: '93.184.216.34', family: 4 }], dispatcherFactory, maxBodyBytes: 10 };
    const large = createSafeFetcher({ ...common, fetchImpl: async () => new Response('12345678901', { headers: { 'Content-Type': 'text/plain' } }) });
    await assert.rejects(large('https://example.com'), { code: 'BODY_TOO_LARGE' });
    const binary = createSafeFetcher({ ...common, fetchImpl: async () => new Response('abc', { headers: { 'Content-Type': 'application/octet-stream' } }) });
    await assert.rejects(binary('https://example.com'), { code: 'UNSUPPORTED_CONTENT_TYPE' });
});

test('HTML extraction removes navigation, forms, and executable content', () => {
    const result = extractHtml('<title>T</title><nav>Menu</nav><article><h1>Heading</h1><form>Secret</form><p>Answer</p><style>.x{}</style></article>');
    assert.equal(result.title, 'T');
    assert.match(result.text, /Heading/);
    assert.match(result.text, /Answer/);
    assert.doesNotMatch(result.text, /Menu|Secret|\.x/);
});

test('SearXNG adapter returns stable registered public sources', async () => {
    const registry = new SourceRegistry();
    let requested;
    const client = createSearxngClient({
        endpoint: 'http://127.0.0.1:8088', sourceRegistry: registry,
        fetchImpl: async url => {
            requested = url;
            return Response.json({ results: [
                { title: 'Node docs', url: 'https://nodejs.org/api/globals.html#fetch', content: 'fetch is global' },
                { title: 'bad', url: 'file:///etc/passwd', content: 'bad' },
            ] });
        },
    });
    const first = await client.search({ query: 'Node global fetch' });
    const second = await client.search({ query: 'Node global fetch' });
    assert.equal(requested.searchParams.get('format'), 'json');
    assert.equal(first.results.length, 1);
    assert.equal(first.results[0].id, second.results[0].id);
    assert.equal(registry.get(first.results[0].id).url, 'https://nodejs.org/api/globals.html#fetch');
});

test('source renderer resolves known markers, removes invented URLs, and appends consulted links', () => {
    const sources = [{ id: 'web-real', title: 'Real source', url: 'https://example.com/fact' }];
    const output = renderSources('Fact [[source:web-real]]. Fake [claim](https://evil.example/x) https://invented.example', sources);
    assert.match(output, /https:\/\/example\.com\/fact/);
    assert.match(output, /<https:\/\/example\.com\/fact>/);
    assert.doesNotMatch(output, /\]\(https?:\/\//);
    assert.doesNotMatch(output, /(?<!<)https?:\/\//);
    assert.doesNotMatch(output, /evil\.example|invented\.example/);
    assert.match(output, /Sources consulted:/);
});
