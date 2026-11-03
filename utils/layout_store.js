'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeLayoutDraft } = require('./moss_layout');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'moss_layouts.json');
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;

function validateName(name) {
    const value = String(name || '').trim();
    if (!NAME_PATTERN.test(value)) {
        throw new Error('Layout name must be 1-32 characters using letters, numbers, hyphens, or underscores.');
    }
    return value;
}

async function readStore(filePath) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: 1, users: {} };
        if (!parsed.users || typeof parsed.users !== 'object' || Array.isArray(parsed.users)) {
            parsed.users = {};
        }
        return parsed;
    }
    catch (error) {
        if (error?.code === 'ENOENT') return { version: 1, users: {} };
        if (error instanceof SyntaxError) return { version: 1, users: {} };
        throw error;
    }
}

let writeChain = Promise.resolve();

async function writeStore(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temp, filePath);
}

function serialize(operation) {
    const job = writeChain.then(operation, operation);
    writeChain = job.catch(() => {});
    return job;
}

/**
 * Save a named layout for one Discord user. The draft is stored, not the
 * compiled prompt, so it can be recompiled at any target resolution.
 */
async function saveLayout({ userId, name, draft, sourcePrompt = '', filePath = DEFAULT_FILE } = {}) {
    if (!userId) throw new Error('A user id is required to save a layout.');
    const safeName = validateName(name);
    const normalized = normalizeLayoutDraft(draft);
    return serialize(async () => {
        const store = await readStore(filePath);
        const user = store.users[userId] || {};
        const now = new Date().toISOString();
        const existing = user[safeName];
        user[safeName] = {
            name: safeName,
            width: normalized.width,
            height: normalized.height,
            draft: normalized,
            sourcePrompt: String(sourcePrompt || '').slice(0, 2000),
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };
        store.users[userId] = user;
        await writeStore(filePath, store);
        return user[safeName];
    });
}

async function getLayout({ userId, name, filePath = DEFAULT_FILE } = {}) {
    if (!userId) throw new Error('A user id is required to load a layout.');
    const safeName = validateName(name);
    const store = await readStore(filePath);
    const record = store.users?.[userId]?.[safeName];
    if (!record) return null;
    return {
        ...record,
        draft: normalizeLayoutDraft(record.draft),
    };
}

async function listLayouts({ userId, filePath = DEFAULT_FILE } = {}) {
    if (!userId) throw new Error('A user id is required to list layouts.');
    const store = await readStore(filePath);
    const user = store.users?.[userId] || {};
    return Object.values(user)
        .map(entry => ({ name: entry.name, width: entry.width, height: entry.height, updatedAt: entry.updatedAt }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function deleteLayout({ userId, name, filePath = DEFAULT_FILE } = {}) {
    if (!userId) throw new Error('A user id is required to delete a layout.');
    const safeName = validateName(name);
    return serialize(async () => {
        const store = await readStore(filePath);
        const user = store.users?.[userId];
        if (!user || !user[safeName]) return false;
        delete user[safeName];
        if (Object.keys(user).length === 0) delete store.users[userId];
        await writeStore(filePath, store);
        return true;
    });
}

module.exports = {
    DEFAULT_FILE,
    NAME_PATTERN,
    validateName,
    saveLayout,
    getLayout,
    listLayouts,
    deleteLayout,
};
