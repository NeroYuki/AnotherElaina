'use strict';

const { MessageActionRow, MessageButton } = require('discord.js');
const { actorFromInteraction, authorizeComponent, scopeFromInteraction } = require('./permissions');

const PREFIX = 'chat:v1';
const ACTION_CODES = Object.freeze({
    continue: 'c',
    regenerate: 'r',
    debug: 'd',
    scene_status: 'ss',
    memory_clear: 'mc',
    scene_end: 'se'
});
const CODE_ACTIONS = Object.freeze(Object.fromEntries(Object.entries(ACTION_CODES).map(([name, code]) => [code, name])));
let dependencies = null;

function configure(next) {
    if (!next || !next.chatService || typeof next.chatService.executeControl !== 'function') {
        throw new TypeError('components.configure requires chatService.executeControl');
    }
    if (typeof next.chatService.getControlContext !== 'function') {
        throw new TypeError('components.configure requires chatService.getControlContext');
    }
    dependencies = Object.freeze({ chatService: next.chatService, repository: next.repository || null, ownerIds: next.ownerIds, clock: next.clock || null });
    return module.exports;
}

function init(next) {
    return next ? configure(next) : module.exports;
}

function createCustomId(action, entityId, revision = 0) {
    const code = ACTION_CODES[action];
    const id = String(entityId || '');
    if (!code) throw new TypeError(`Unsupported component action: ${action}`);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new TypeError('Component entityId must be an opaque 1-64 character identifier');
    if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('Component revision must be a non-negative integer');
    const customId = `${PREFIX}:${code}:${id}:${revision.toString(36)}`;
    if (customId.length > 100) throw new RangeError('Discord custom ID exceeds 100 characters');
    return customId;
}

function parseCustomId(customId) {
    const match = /^chat:v1:([a-z]+):([A-Za-z0-9_-]{1,64}):([0-9a-z]+)$/.exec(String(customId || ''));
    if (!match || !CODE_ACTIONS[match[1]]) return null;
    const revision = Number.parseInt(match[3], 36);
    if (!Number.isSafeInteger(revision)) return null;
    return Object.freeze({ action: CODE_ACTIONS[match[1]], entityId: match[2], revision });
}

function button(action, entityId, revision, label, style) {
    return new MessageButton()
        .setCustomId(createCustomId(action, entityId, revision))
        .setLabel(label)
        .setStyle(style);
}

function buildTurnComponents({ turnId, revision, includeDebug = false }) {
    const row = new MessageActionRow().addComponents(
        button('continue', turnId, revision, 'Continue', 'SECONDARY'),
        button('regenerate', turnId, revision, 'Regenerate', 'SECONDARY'),
        button('scene_status', turnId, revision, 'Scene Status', 'SECONDARY')
    );
    if (includeDebug) row.addComponents(button('debug', turnId, revision, 'Debug', 'SECONDARY'));
    return [row];
}

function buildConfirmationComponents({ action, confirmationId, revision }) {
    if (!['memory_clear', 'scene_end'].includes(action)) throw new TypeError('Unsupported confirmation action');
    return [new MessageActionRow().addComponents(
        button(action, confirmationId, revision, 'Confirm', 'DANGER')
    )];
}

function boundedMessage(value, fallback) {
    const text = String(value || fallback || 'Control completed.');
    return text.length <= 1800 ? text : `${text.slice(0, 1797)}...`;
}

async function respond(interaction, payload) {
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
    return interaction.reply({ ...payload, ephemeral: true });
}

async function handle(interaction) {
    const parsed = parseCustomId(interaction?.customId);
    if (!parsed) return false;
    if (!dependencies) {
        await respond(interaction, { content: 'Chat controls are not initialized.', ephemeral: true });
        return true;
    }

    const actor = actorFromInteraction(interaction, dependencies.ownerIds);
    const scope = scopeFromInteraction(interaction);
    let context;
    try {
        context = await dependencies.chatService.getControlContext({ ...parsed, actor, scope });
    } catch (_) {
        await respond(interaction, { content: 'This control is unavailable or stale.', ephemeral: true });
        return true;
    }
    if (!context || Number(context.revision) !== parsed.revision) {
        await respond(interaction, { content: 'This control is stale. Use the latest message or run the command again.', ephemeral: true });
        return true;
    }
    const authorization = authorizeComponent(actor, context, dependencies.clock?.now?.() ?? Date.now());
    if (!authorization.ok) {
        await respond(interaction, { content: 'You are not authorized to use this control.', ephemeral: true });
        return true;
    }

    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });
    try {
        const result = await dependencies.chatService.executeControl({ action: parsed.action, actor, scope, input: { entityId: parsed.entityId, revision: parsed.revision }, deliveryInteraction: interaction });
        await interaction.editReply({ content: boundedMessage(result?.message, result?.ok === false ? 'The control could not be completed.' : 'Control completed.'), components: [] });
    } catch (_) {
        await interaction.editReply({ content: 'The control could not be completed. Try again or inspect scene status.', components: [] });
    }
    return true;
}

module.exports = {
    ACTION_CODES,
    PREFIX,
    buildConfirmationComponents,
    buildTurnComponents,
    configure,
    createCustomId,
    handle,
    init,
    parseCustomId,
    route: handle
};
