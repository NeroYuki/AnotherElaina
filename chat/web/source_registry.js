'use strict';

const crypto = require('node:crypto');

function canonicalUrl(value) {
    const url = new URL(value);
    return url.toString();
}

function sourceIdForUrl(value) {
    const url = canonicalUrl(value);
    return `web-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)}`;
}

class SourceRegistry {
    constructor() {
        this.sources = new Map();
    }

    add(source) {
        const url = canonicalUrl(source.url);
        const id = source.id || sourceIdForUrl(url);
        const saved = Object.freeze({
            id, url, title: String(source.title || url).slice(0, 300),
            snippet: source.snippet ? String(source.snippet).slice(0, 2000) : '',
            retrievedAt: source.retrievedAt || new Date().toISOString(),
        });
        this.sources.set(id, saved);
        return saved;
    }

    get(id) {
        return this.sources.get(id) || null;
    }

    list(ids) {
        const selected = ids ? ids.map(id => this.get(id)).filter(Boolean) : [...this.sources.values()];
        return [...new Map(selected.map(source => [source.id, source])).values()];
    }
}

function stripUnknownCitations(text, known) {
    const byId = new Map(known.map(source => [source.id, source]));
    let output = String(text || '');
    output = output.replace(/\[\[(?:source:)?([a-z0-9_-]+)\]\]/gi, (match, id) => {
        const source = byId.get(id);
        return source ? `[${source.title}](${source.url})` : '';
    });
    output = output.replace(/【(?:source:)?([a-z0-9_-]+)】/gi, (match, id) => byId.has(id) ? `[${id}](${byId.get(id).url})` : '');

    const allowedUrls = new Set(known.map(source => canonicalUrl(source.url)));
    output = output.replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/gi, (match, label, url) => {
        try { return allowedUrls.has(canonicalUrl(url)) ? match : label; } catch { return label; }
    });
    output = output.replace(/(?<!\()https?:\/\/[^\s<>)]+/gi, match => {
        const suffix = match.match(/[.,;:!?]+$/)?.[0] || '';
        const raw = suffix ? match.slice(0, -suffix.length) : match;
        try { return allowedUrls.has(canonicalUrl(raw)) ? match : ''; } catch { return ''; }
    });
    return output.replace(/[ \t]+\n/g, '\n').trim();
}

function renderSources(text, sources, { limit = 3, label = 'Sources consulted' } = {}) {
    const known = [...new Map((sources || []).filter(source => source?.url)
        .map(source => [source.id || sourceIdForUrl(source.url), { ...source, id: source.id || sourceIdForUrl(source.url) }])).values()];
    const clean = stripUnknownCitations(text, known);
    if (known.length === 0) return clean;
    const lines = known.slice(0, limit).map(source => `- [${String(source.title || source.url).replace(/[\[\]]/g, '')}](${canonicalUrl(source.url)})`);
    return `${clean}\n\n${label}:\n${lines.join('\n')}`.trim();
}

module.exports = { SourceRegistry, sourceIdForUrl, canonicalUrl, stripUnknownCitations, renderSources };
