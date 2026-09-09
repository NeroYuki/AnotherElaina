'use strict'

const { SlashCommandBuilder } = require('@discordjs/builders')
const { actorFromInteraction } = require('../../chat/discord/permissions')

let dependencies = null

const data = new SlashCommandBuilder()
    .setName('remove_channel_context')
    .setDescription('Delete stored chat context for a channel (owner only)')
    .addChannelOption(option => option.setName('channel').setDescription('Channel whose active scene should be cleared').setRequired(true))

function configure(next) {
    dependencies = next
    return module.exports
}

async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true })
    const actor = actorFromInteraction(interaction, dependencies?.ownerIds)
    if (!actor.isOwner || !dependencies?.chatService) {
        await interaction.editReply('You are not authorized to clear this channel context.')
        return
    }
    const channel = interaction.options.getChannel('channel')
    const result = await dependencies.chatService.executeControl({
        action: 'memory.clear.channel',
        actor,
        scope: { guildId: interaction.guildId, channelId: channel.id, threadId: channel.isThread?.() ? channel.id : null },
        input: {}
    })
    await interaction.editReply(result.message)
}

module.exports = { data, configure, execute }
