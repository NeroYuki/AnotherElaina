'use strict';

const config = require('../../config.json');

function normalizeIds(value) {
    if (value == null) return [];
    const values = Array.isArray(value) ? value : String(value).split(',');
    return [...new Set(values.map(item => String(item).trim()).filter(Boolean))];
}

function configuredOwnerIds(extra) {
    return normalizeIds(extra == null ? config.byPassUser : extra);
}

function isOwner(userId, ownerIds) {
    return configuredOwnerIds(ownerIds).includes(String(userId));
}

function hasPermission(member, permission) {
    if (!member || !member.permissions || typeof member.permissions.has !== 'function') return false;
    try {
        return member.permissions.has(permission);
    } catch (_) {
        return false;
    }
}

function isModerator(member) {
    return hasPermission(member, 'ADMINISTRATOR') ||
        hasPermission(member, 'MANAGE_GUILD') ||
        hasPermission(member, 'MANAGE_MESSAGES');
}

function actorFromInteraction(interaction, ownerIds) {
    if (!interaction || !interaction.user || !interaction.user.id) {
        throw new TypeError('Interaction user is required');
    }
    const userId = String(interaction.user.id);
    return Object.freeze({
        userId,
        username: interaction.user.username || null,
        isOwner: isOwner(userId, ownerIds),
        isModerator: isModerator(interaction.member)
    });
}

function scopeFromInteraction(interaction) {
    const visibleUsers = interaction.channel?.members?.values
        ? [...interaction.channel.members.values()].map(member => String(member.user?.id || member.id)).filter(Boolean)
        : []
    return Object.freeze({
        guildId: interaction.guildId || interaction.guild?.id || null,
        channelId: interaction.channelId || interaction.channel?.id || null,
        threadId: interaction.channel?.isThread?.() ? interaction.channel.id : null,
        allowedUserIds: [...new Set(visibleUsers)]
    });
}

function canManageScene(actor, scene) {
    if (!actor || !scene) return false;
    return actor.isOwner || actor.isModerator || String(scene.ownerUserId) === actor.userId;
}

function canReadMemory(actor, memory) {
    if (!actor || !memory) return false;
    if (actor.isOwner || actor.isModerator) return true;
    const audience = normalizeIds(memory.audienceUserIds);
    return String(memory.ownerUserId || '') === actor.userId || audience.includes(actor.userId);
}

function audienceIsCompatible(source, destination) {
    const sourceUsers = normalizeIds(source?.allowedUserIds);
    const destinationUsers = normalizeIds(destination?.allowedUserIds);
    const sourceRoles = normalizeIds(source?.allowedRoleIds);
    const destinationRoles = normalizeIds(destination?.allowedRoleIds);
    if (source?.guildId && destination?.guildId && String(source.guildId) !== String(destination.guildId)) return false;
    const subset = (allowed, audience) => allowed.length === 0 || (audience.length > 0 && audience.every(id => allowed.includes(id)));
    return subset(sourceUsers, destinationUsers) && subset(sourceRoles, destinationRoles);
}

function authorizeComponent(actor, context, now = Date.now()) {
    if (!actor || !context) return { ok: false, code: 'missing_context' };
    if (context.expiresAt && Date.parse(context.expiresAt) <= now) {
        return { ok: false, code: 'expired' };
    }
    if (context.allowedUserId && String(context.allowedUserId) !== actor.userId && !actor.isOwner) {
        return { ok: false, code: 'wrong_user' };
    }
    if (Array.isArray(context.allowedUserIds) && !context.allowedUserIds.map(String).includes(actor.userId) && !actor.isOwner) {
        return { ok: false, code: 'not_in_audience' };
    }
    if (context.ownerOnly && !actor.isOwner) return { ok: false, code: 'owner_only' };
    if (context.moderatorOnly && !(actor.isModerator || actor.isOwner)) return { ok: false, code: 'moderator_only' };
    return { ok: true, code: 'authorized' };
}

module.exports = {
    actorFromInteraction,
    audienceIsCompatible,
    authorizeComponent,
    canManageScene,
    canReadMemory,
    configuredOwnerIds,
    isModerator,
    isOwner,
    normalizeIds,
    scopeFromInteraction
};
