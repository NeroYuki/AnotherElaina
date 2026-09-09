'use strict';

const { actorFromInteraction, scopeFromInteraction } = require('../../chat/discord/permissions');

const MAX_MESSAGE = 1800;

function configureDependencies(next) {
    if (!next || !next.chatService || typeof next.chatService.executeControl !== 'function') {
        throw new TypeError('configure requires chatService.executeControl');
    }
    return Object.freeze({ chatService: next.chatService, repository: next.repository || null, ownerIds: next.ownerIds });
}

function context(interaction, dependencies) {
    return {
        actor: actorFromInteraction(interaction, dependencies?.ownerIds),
        scope: scopeFromInteraction(interaction)
    };
}

function bounded(value, fallback = 'Control completed.') {
    const text = String(value || fallback);
    return text.length <= MAX_MESSAGE ? text : `${text.slice(0, MAX_MESSAGE - 3)}...`;
}

async function ensureDeferred(interaction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });
}

async function unavailable(interaction) {
    await ensureDeferred(interaction);
    await interaction.editReply({ content: 'Chat controls are not initialized.', components: [] });
}

async function execute(interaction, dependencies, action, input) {
    if (!dependencies) return unavailable(interaction);
    await ensureDeferred(interaction);
    const requestContext = context(interaction, dependencies);
    try {
        return await dependencies.chatService.executeControl({ action, ...requestContext, input });
    } catch (_) {
        await interaction.editReply({ content: 'The chat control could not be completed. Try again later.', components: [] });
        return null;
    }
}

function textResult(result, fallback) {
    return { content: bounded(result?.message, fallback), components: result?.components || [] };
}

module.exports = {
    bounded,
    configureDependencies,
    context,
    ensureDeferred,
    execute,
    textResult,
    unavailable
};
