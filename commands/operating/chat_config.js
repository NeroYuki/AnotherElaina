'use strict'

const { SlashCommandBuilder } = require('@discordjs/builders')
const { COLLECTIONS } = require('../../chat/persistence/collections')
const { isOwner } = require('../../chat/discord/permissions')
const { normalizeResponseStyle } = require('../../chat/conversation/response_style')

let dependencies = null

const data = new SlashCommandBuilder()
    .setName('chat_config')
    .setDescription('Configure the local-only chatbot')
    .addStringOption(option => option.setName('mode').setDescription('Local chat mode').setRequired(true).addChoices(
        { name: 'Disabled', value: 'disabled' },
        { name: 'Status', value: 'status' },
        { name: 'Auto Local', value: 'auto_local' },
        { name: 'Gemma (local)', value: 'gemma' },
        { name: 'Qwen (configured local)', value: 'qwen' }
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
        await interaction.editReply(`Mode: ${globalThis.operating_mode}\nModel: ${dependencies.chatService.provider.model}\nStyle: ${dependencies.chatService.responseStyle}\nStreaming: ${dependencies.chatService.streamEnabled ? 'on' : 'off'}\n${services}`)
        return
    }
    let model = dependencies.chatService.provider.model
    if (mode === 'gemma') model = 'unsloth/gemma-4-12B-it-qat-GGUF'
    if (mode === 'qwen') {
        if (!process.env.CHAT_QWEN_MODEL || !/^qwen[-_/.:a-z0-9]+$/i.test(process.env.CHAT_QWEN_MODEL)) {
            await interaction.editReply('CHAT_QWEN_MODEL is not configured with a verified local identifier.')
            return
        }
        model = process.env.CHAT_QWEN_MODEL
    }
    globalThis.operating_mode = mode === 'disabled' ? 'disabled' : 'auto_local'
    dependencies.chatService.provider.model = model
    const stream = interaction.options.getBoolean('stream') ?? dependencies.chatService.streamEnabled
    const styleOption = interaction.options.getString('style')
    const responseStyle = normalizeResponseStyle(styleOption || dependencies.chatService.responseStyle)
    dependencies.chatService.streamEnabled = stream
    dependencies.chatService.responseStyle = responseStyle
    await dependencies.repository.collection(COLLECTIONS.migrations).updateOne(
        { migrationId: 'chat-runtime-config' },
        { $set: { schemaVersion: 1, migrationId: 'chat-runtime-config', mode: globalThis.operating_mode, model, stream, responseStyle, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
    )
    await interaction.editReply(`Chat is ${globalThis.operating_mode}; model is ${model}; response style is ${responseStyle}. Cloud inference remains disabled.`)
}

module.exports = { data, configure, execute }
