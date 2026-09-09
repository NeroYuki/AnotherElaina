'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageAttachment } = require('discord.js');
const { buildConfirmationComponents } = require('../../chat/discord/components');
const shared = require('./_shared.cjs');

let dependencies = null;

const data = new SlashCommandBuilder()
    .setName('memory')
    .setDescription('Inspect or remove chat memory you are authorized to access')
    .addSubcommand(command => command.setName('show').setDescription('Show bounded memory records and provenance')
        .addStringOption(option => option.setName('kind').setDescription('Memory kind').addChoices(
            { name: 'All', value: 'all' }, { name: 'Facts', value: 'scene_fact' }, { name: 'Events', value: 'relationship_event' }, { name: 'Promises', value: 'promise' }
        ))
        .addIntegerOption(option => option.setName('limit').setDescription('Maximum records').setMinValue(1).setMaxValue(25)))
    .addSubcommand(command => command.setName('forget').setDescription('Forget one authorized memory record')
        .addStringOption(option => option.setName('memory_id').setDescription('Opaque memory ID').setRequired(true)))
    .addSubcommand(command => command.setName('clear').setDescription('Prepare a confirmed deletion of stored chat content')
        .addStringOption(option => option.setName('scope').setDescription('Deletion scope').setRequired(true).addChoices(
            { name: 'My data in this scene', value: 'my_scene' },
            { name: 'My data in this continuity', value: 'my_continuity' },
            { name: 'Entire shared scene (moderator/owner)', value: 'shared_scene' }
        )))
    .addSubcommand(command => command.setName('export').setDescription('Export currently authorized stored chat data')
        .addStringOption(option => option.setName('scope').setDescription('Export scope').addChoices(
            { name: 'Current scene', value: 'scene' }, { name: 'My data', value: 'my_data' }
        )))
    .addSubcommand(command => command.setName('optout').setDescription('Enable or disable durable personal memory extraction')
        .addBooleanOption(option => option.setName('enabled').setDescription('True opts out of durable personal memory').setRequired(true)));

function configure(next) {
    dependencies = shared.configureDependencies(next);
    return module.exports;
}

function init(next) {
    return next ? configure(next) : module.exports;
}

async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const input = {};
    if (subcommand === 'show') {
        input.kind = interaction.options.getString('kind') || 'all';
        input.limit = interaction.options.getInteger('limit') || 10;
    } else if (subcommand === 'forget') {
        input.memoryId = interaction.options.getString('memory_id');
        if (!input.memoryId || input.memoryId.length > 64) {
            await shared.ensureDeferred(interaction);
            await interaction.editReply({ content: 'Memory IDs must be between 1 and 64 characters.', components: [] });
            return;
        }
    }
    else if (subcommand === 'clear') input.scope = interaction.options.getString('scope');
    else if (subcommand === 'export') input.scope = interaction.options.getString('scope') || 'scene';
    else if (subcommand === 'optout') input.enabled = interaction.options.getBoolean('enabled');

    const result = await shared.execute(interaction, dependencies, `memory.${subcommand}${subcommand === 'clear' ? '.prepare' : ''}`, input);
    if (!result) return;
    if (subcommand === 'clear' && result.confirmation) {
        const components = buildConfirmationComponents({
            action: 'memory_clear',
            confirmationId: result.confirmation.id,
            revision: result.confirmation.revision
        });
        await interaction.editReply({ content: shared.bounded(result.message, 'Confirm deletion of stored bot memory. Existing Discord messages are not deleted.'), components });
        return;
    }
    if (subcommand === 'export' && result.export) {
        const json = Buffer.from(JSON.stringify(result.export, null, 2), 'utf8');
        if (json.length > 8 * 1024 * 1024) {
            await interaction.editReply({ content: 'The authorized export exceeds Discord upload limits. Narrow the scope.', components: [] });
            return;
        }
        await interaction.editReply({ content: shared.bounded(result.message, 'Authorized chat-memory export.'), files: [new MessageAttachment(json, 'chat-memory-export.json')], components: [] });
        return;
    }
    await interaction.editReply(shared.textResult(result, 'Memory control completed.'));
}

module.exports = { data, configure, init, execute };
