'use strict';

const dns = require('node:dns');
const net = require('node:net');
const { extractDocument } = require('./extract');

class SafeFetchError extends Error {
    constructor(message, code, { retryable = false, cause = null } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = 'SafeFetchError';
        this.code = code;
        this.retryable = retryable;
    }
}

function ipv4Number(address) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inCidr4(value, base, prefix) {
    const address = ipv4Number(value);
    const network = ipv4Number(base);
    if (address === null || network === null) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (address & mask) === (network & mask);
}

const BLOCKED_V4 = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function isPublicIp(address) {
    const family = net.isIP(address);
    if (family === 4) return !BLOCKED_V4.some(([base, prefix]) => inCidr4(address, base, prefix));
    if (family !== 6) return false;
    const value = address.toLowerCase().split('%')[0];
    if (value.includes('.')) return false;
    if (value === '::' || value === '::1' || value.startsWith('::ffff:')) return false;
    if (/^f[cd]/.test(value) || /^fe[89ab]/.test(value) || /^ff/.test(value)) return false;
    if (value.startsWith('2001:db8:') || value === '2001:db8::') return false;
    if (value.startsWith('2001:2:') || value.startsWith('2001:10:') || value.startsWith('100:')) return false;
    return true;
}

function validateUrl(value) {
    let url;
    try { url = new URL(value); } catch (error) { throw new SafeFetchError('Invalid URL', 'INVALID_URL', { cause: error }); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new SafeFetchError('Only HTTP and HTTPS are allowed', 'INVALID_PROTOCOL');
    if (url.username || url.password) throw new SafeFetchError('URLs with embedded credentials are blocked', 'BLOCKED_CREDENTIALS');
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) {
        throw new SafeFetchError('Local hostnames are blocked', 'BLOCKED_HOST');
    }
    return url;
}

async function resolvePublic(url, lookup) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(hostname)) {
        if (!isPublicIp(hostname)) throw new SafeFetchError('Non-public IP address is blocked', 'BLOCKED_ADDRESS');
        return [{ address: hostname, family: net.isIP(hostname) }];
    }
    let addresses;
    try {
        addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch (error) {
        throw new SafeFetchError('DNS resolution failed', 'DNS_FAILED', { retryable: true, cause: error });
    }
    if (!addresses?.length) throw new SafeFetchError('DNS returned no addresses', 'DNS_FAILED', { retryable: true });
    if (addresses.some(item => !isPublicIp(item.address))) {
        throw new SafeFetchError('DNS returned a non-public address', 'BLOCKED_ADDRESS');
    }
    return addresses;
}

function defaultDispatcherFactory(addresses) {
    let Agent;
    try {
        ({ Agent } = require('undici'));
    } catch (error) {
        throw new SafeFetchError('DNS pinning requires undici', 'PINNING_UNAVAILABLE', { cause: error });
    }
    let cursor = 0;
    return new Agent({
        connect: {
            lookup(hostname, options, callback) {
                if (options?.all) return callback(null, addresses.map(item => ({ address: item.address, family: item.family })));
                const selected = addresses[cursor++ % addresses.length];
                return callback(null, selected.address, selected.family);
            },
        },
    });
}

async function readBounded(response, maxBytes) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new SafeFetchError('Response body is too large', 'BODY_TOO_LARGE');
    if (!response.body) return '';
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes) {
            await response.body.cancel?.().catch?.(() => {});
            throw new SafeFetchError('Response body is too large', 'BODY_TOO_LARGE');
        }
        chunks.push(bytes);
    }
    return Buffer.concat(chunks, size).toString('utf8');
}

function createSafeFetcher({ fetchImpl = globalThis.fetch, lookup = dns.promises.lookup,
    dispatcherFactory = defaultDispatcherFactory, maxRedirects = 3, maxBodyBytes = 1024 * 1024,
    maxTextChars = 12_000, timeoutMs = 10_000, userAgent = 'AnotherElaina/1.0 safe-fetch' } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('Native fetch is required');
    return async function safeFetch(input, { signal } = {}) {
        let url = validateUrl(input);
        for (let redirect = 0; redirect <= maxRedirects; redirect++) {
            const addresses = await resolvePublic(url, lookup);
            const dispatcher = dispatcherFactory(addresses, url.hostname);
            let response;
            try {
                const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
                response = await fetchImpl(url, {
                    method: 'GET', redirect: 'manual', dispatcher, signal: requestSignal,
                    headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9', 'User-Agent': userAgent },
                });
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    if (redirect === maxRedirects) throw new SafeFetchError('Too many redirects', 'TOO_MANY_REDIRECTS');
                    const location = response.headers.get('location');
                    if (!location) throw new SafeFetchError('Redirect has no location', 'INVALID_REDIRECT');
                    await response.body?.cancel?.();
                    url = validateUrl(new URL(location, url).toString());
                    continue;
                }
                if (!response.ok) throw new SafeFetchError(`Page returned HTTP ${response.status}`, 'HTTP_ERROR', { retryable: response.status >= 500 });
                const contentType = response.headers.get('content-type') || '';
                if (!/^(?:text\/html|text\/plain|application\/xhtml\+xml)\b/i.test(contentType)) {
                    throw new SafeFetchError('Unsupported page content type', 'UNSUPPORTED_CONTENT_TYPE');
                }
                const raw = await readBounded(response, maxBodyBytes);
                const extracted = extractDocument(raw, contentType, { maxChars: maxTextChars });
                return {
                    url: url.toString(), status: response.status, contentType,
                    title: extracted.title, text: extracted.text,
                    retrievedAt: new Date().toISOString(),
                };
            } catch (error) {
                if (error instanceof SafeFetchError || signal?.aborted) throw error;
                const timedOut = error?.name === 'TimeoutError';
                throw new SafeFetchError(timedOut ? 'Page fetch timed out' : 'Page fetch failed', timedOut ? 'FETCH_TIMEOUT' : 'FETCH_FAILED', {
                    retryable: true, cause: error,
                });
            } finally {
                await dispatcher?.close?.().catch?.(() => {});
            }
        }
        throw new SafeFetchError('Too many redirects', 'TOO_MANY_REDIRECTS');
    };
}

module.exports = {
    SafeFetchError, createSafeFetcher, isPublicIp, validateUrl, resolvePublic, readBounded,
};
