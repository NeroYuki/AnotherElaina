'use strict';

function normalizeText(value) {
    return String(value || '')
        .replace(/\r/g, '')
        .replace(/[\t ]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractHtml(html, { maxChars = 12_000 } = {}) {
    let cheerio;
    try {
        cheerio = require('cheerio');
    } catch (error) {
        error.message = `HTML extraction requires cheerio: ${error.message}`;
        throw error;
    }
    const $ = cheerio.load(String(html || ''));
    $('script,style,noscript,template,form,nav,header,footer,aside,iframe,svg,canvas,dialog').remove();
    $('br').replaceWith('\n');
    $('p,div,section,article,main,li,h1,h2,h3,h4,h5,h6,pre,blockquote,tr').each((index, element) => {
        $(element).prepend('\n').append('\n');
    });
    const title = normalizeText($('title').first().text() || $('h1').first().text()).slice(0, 300);
    const root = $('article').first().length ? $('article').first()
        : $('main').first().length ? $('main').first() : $('body');
    const text = normalizeText(root.text()).slice(0, maxChars);
    return { title, text };
}

function extractDocument(body, contentType, options) {
    if (/^(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)) return extractHtml(body, options);
    if (/^text\/plain\b/i.test(contentType)) return { title: '', text: normalizeText(body).slice(0, options?.maxChars || 12_000) };
    const error = new TypeError(`Unsupported content type: ${contentType || 'missing'}`);
    error.code = 'UNSUPPORTED_CONTENT_TYPE';
    throw error;
}

module.exports = { extractHtml, extractDocument, normalizeText };
