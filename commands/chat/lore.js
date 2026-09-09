'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const shared = require('./_shared.cjs');

let dependencies = null;
const ALLOWED_EXTENSIONS = new Set(['md', 'txt']);
const MAX_FILE_BYTES = 1024 * 1024;

const data = new SlashCommandBuilder()
    .setName('lore')
    .setDescription('Manage curated lore sources (owner or moderator)')
    .addSubcommand(command => command.setName('add').setDescription('Add one approved text attachment or public HTML URL')
        .addAttachmentOption(option => option.setName('file').setDescription('A .md or .txt file up to 1 MiB'))
        .addStringOption(option => option.setName('url').setDescription('Explicit public HTTP(S) URL (maximum 1000 characters)'))
        .addStringOption(option => option.setName('label').setDescription('Corpus label (maximum 64 characters)')))
    .addSubcommand(command => command.setName('remove').setDescription('Remove an authorized lore source')
        .addStringOption(option => option.setName('source_id').setDescription('Opaque source ID').setRequired(true)))
    .addSubcommand(command => command.setName('status').setDescription('Show bounded lore ingestion/index status')
        .addIntegerOption(option => option.setName('limit').setDescription('Maximum jobs/sources').setMinValue(1).setMaxValue(25)))
    .addSubcommand(command => command.setName('reindex').setDescription('Reindex sources without changing access')
        .addStringOption(option => option.setName('source_id').setDescription('Optional source ID')));

function configure(next) {
    dependencies = shared.configureDependencies(next);
    return module.exports;
}

function init(next) {
    return next ? configure(next) : module.exports;
}

function validateSource(file, url) {
    if (Boolean(file) === Boolean(url)) return 'Provide exactly one file or URL.';
    if (file) {
        const extension = String(file.name || '').split('.').pop().toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(extension)) return 'Lore files must use the .md or .txt extension.';
        if (!Number.isFinite(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) return 'Lore files must be between 1 byte and 1 MiB.';
    }
    if (url) {
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('unsafe URL');
        } catch (_) {
            return 'Lore URL must be an HTTP(S) URL without embedded credentials.';
        }
    }
    return null;
}

async function execute(interaction) {
    if (!dependencies) return shared.unavailable(interaction);
    const subcommand = interaction.options.getSubcommand();
    const requestContext = shared.context(interaction, dependencies);
    if (!(requestContext.actor.isOwner || requestContext.actor.isModerator)) {
        await shared.ensureDeferred(interaction);
        await interaction.editReply({ content: 'Only the bot owner or a server moderator can manage lore.', components: [] });
        return;
    }

    const input = {};
    if (subcommand === 'add') {
        const file = interaction.options.getAttachment('file');
        const url = interaction.options.getString('url');
        const error = validateSource(file, url);
        if (error) {
            await shared.ensureDeferred(interaction);
            await interaction.editReply({ content: error, components: [] });
            return;
        }
        input.label = interaction.options.getString('label') || null;
        if (input.label?.length > 64 || url?.length > 1000) {
            await shared.ensureDeferred(interaction);
            await interaction.editReply({ content: 'Lore labels are limited to 64 characters and URLs to 1000.', components: [] });
            return;
        }
        input.source = file ? {
            type: 'discord_attachment', id: String(file.id), name: file.name, size: file.size,
            contentType: file.contentType || null, url: file.url
        } : { type: 'url', url };
    } else if (subcommand === 'remove') {
        input.sourceId = interaction.options.getString('source_id');
        if (!input.sourceId || input.sourceId.length > 64) {
            await shared.ensureDeferred(interaction);
            await interaction.editReply({ content: 'Lore source IDs must be between 1 and 64 characters.', components: [] });
            return;
        }
    }
    else if (subcommand === 'status') input.limit = interaction.options.getInteger('limit') || 10;
    else if (subcommand === 'reindex') {
        input.sourceId = interaction.options.getString('source_id') || null;
        if (input.sourceId?.length > 64) {
            await shared.ensureDeferred(interaction);
            await interaction.editReply({ content: 'Lore source IDs are limited to 64 characters.', components: [] });
            return;
        }
    }

    const result = await shared.execute(interaction, dependencies, `lore.${subcommand}`, input);
    if (result) await interaction.editReply(shared.textResult(result, 'Lore control completed.'));
}

module.exports = { ALLOWED_EXTENSIONS, MAX_FILE_BYTES, data, configure, init, execute, validateSource };
