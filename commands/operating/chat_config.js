'use strict'

const { SlashCommandBuilder } = require('@discordjs/builders')
const { COLLECTIONS } = require('../../chat/persistence/collections')
const { isOwner } = require('../../chat/discord/permissions')
const { normalizeResponseStyle } = require('../../chat/conversation/response_style')
const { profileForAlias } = require('../../chat/model_profiles')

let dependencies = null

const data = new SlashCommandBuilder()
    .setName('chat_config')
    .setDescription('Configure the local-only chatbot')
    .addStringOption(option => option.setName('mode').setDescription('Local chat mode').setRequired(true).addChoices(
        { name: 'Disabled', value: 'disabled' },
        { name: 'Status', value: 'status' },
        { name: 'Auto Local', value: 'auto_local' },
        { name: 'Gemma (local)', value: 'gemma' },
        { name: 'Qwen 3.8 27B (local)', value: 'qwen_27b' },
        { name: 'Qwen 3.8 Flash-Next (high resource)', value: 'qwen_flash_next' }
    ))
    .addBooleanOption(option => option.setName('stream').setDescription('Enable streamed local generation'))
    .addStringOption(option => option.setName('style').setDescription('Response style for real-time chat').addChoices(
        { name: 'Compact', value: 'compact' },
        { name: 'Emoji actions', value: 'emoji' },
        { name: 'Expressive roleplay', value: 'expressive' }
    ))

function configure(next) {
    dependencies = next
    return module.exports
}

async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true })
    if (!isOwner(interaction.user.id, dependencies?.ownerIds)) {
        await interaction.editReply('You are not authorized to use this command.')
        return
    }
    if (!dependencies?.chatService) {
        await interaction.editReply('The local chat subsystem is not initialized.')
        return
    }
    const mode = interaction.options.getString('mode')
    if (mode === 'status') {
        const snapshot = dependencies.status?.snapshot?.()
        const services = snapshot ? Object.entries(snapshot.services).map(([name, value]) => `${name}: ${value.reachable === false ? 'degraded' : value.exercised ? 'exercised' : value.enabled ? 'enabled' : 'disabled'}`).join('\n') : 'Health details unavailable.'
        await interaction.editReply(`Mode: ${globalThis.operating_mode}\nModel: ${dependencies.chatService.provider.model}\nQuantization: ${dependencies.chatService.provider.quantization || 'default'}\nContext: ${dependencies.chatService.provider.contextTokens}\nStyle: ${dependencies.chatService.responseStyle}\nStreaming: ${dependencies.chatService.streamEnabled ? 'on' : 'off'}\n${services}`)
        return
    }
    let model = dependencies.chatService.provider.model
    let quantization = dependencies.chatService.provider.quantization
    const selected = profileForAlias(mode)
    if (selected) {
        if (selected.resourceTier === 'extreme' && !dependencies.chatService.config.allowExtremeModel) {
            await interaction.editReply('Set CHAT_ALLOW_EXTREME_MODEL=true and restart before selecting Qwen Flash-Next.')
            return
        }
        model = selected.model
        quantization = selected.quantization
    }
    globalThis.operating_mode = mode === 'disabled' ? 'disabled' : 'auto_local'
    dependencies.chatService.provider.model = model
    dependencies.chatService.provider.quantization = quantization
    const stream = interaction.options.getBoolean('stream') ?? dependencies.chatService.streamEnabled
    const styleOption = interaction.options.getString('style')
    const responseStyle = normalizeResponseStyle(styleOption || dependencies.chatService.responseStyle)
    dependencies.chatService.streamEnabled = stream
    dependencies.chatService.responseStyle = responseStyle
    await dependencies.repository.collection(COLLECTIONS.migrations).updateOne(
        { migrationId: 'chat-runtime-config' },
        { $set: { schemaVersion: 1, migrationId: 'chat-runtime-config', mode: globalThis.operating_mode, model, quantization, stream, responseStyle, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
    )
    await interaction.editReply(`Chat is ${globalThis.operating_mode}; model is ${model} (${quantization}); response style is ${responseStyle}. Cloud inference remains disabled.`)
}

module.exports = { data, configure, execute }
