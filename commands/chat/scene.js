'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const shared = require('./_shared.cjs');

let dependencies = null;

const data = new SlashCommandBuilder()
    .setName('scene')
    .setDescription('Manage the persistent roleplay scene in this channel')
    .addSubcommand(command => command.setName('new').setDescription('Start a fresh scene without deleting older scenes')
        .addStringOption(option => option.setName('title').setDescription('Scene title (maximum 100 characters)'))
        .addBooleanOption(option => option.setName('observe').setDescription('Store participant observations in this scene')))
    .addSubcommand(command => command.setName('status').setDescription('Show the active scene and retention status'))
    .addSubcommand(command => command.setName('resume').setDescription('Resume an authorized scene in this channel')
        .addStringOption(option => option.setName('scene_id').setDescription('Opaque scene ID').setRequired(true)))
    .addSubcommand(command => command.setName('end').setDescription('End the active scene without deleting its records'))
    .addSubcommand(command => command.setName('character').setDescription('Set your player character for this continuity')
        .addStringOption(option => option.setName('name').setDescription('Character display name (maximum 80 characters)').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('Explicit character description (maximum 1000 characters)')))
    .addSubcommand(command => command.setName('settings').setDescription('Update bounded settings for the active scene')
        .addBooleanOption(option => option.setName('observe').setDescription('Store participant observations'))
        .addIntegerOption(option => option.setName('followup_seconds').setDescription('Addressed follow-up window; 0 disables').setMinValue(0).setMaxValue(90))
        .addBooleanOption(option => option.setName('offline').setDescription('Disable external web search for this scene')));

function configure(next) {
    dependencies = shared.configureDependencies(next);
    return module.exports;
}

function init(next) {
    return next ? configure(next) : module.exports;
}

async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const action = `scene.${subcommand}`;
    const input = {};
    if (subcommand === 'new') {
        input.title = interaction.options.getString('title') || null;
        if (input.title?.length > 100) return rejectInput(interaction, 'Scene titles are limited to 100 characters.');
        input.observeParticipants = interaction.options.getBoolean('observe');
    } else if (subcommand === 'resume') {
        input.sceneId = interaction.options.getString('scene_id');
        if (!input.sceneId || input.sceneId.length > 64) return rejectInput(interaction, 'Scene IDs must be between 1 and 64 characters.');
    } else if (subcommand === 'character') {
        input.name = interaction.options.getString('name');
        input.description = interaction.options.getString('description') || null;
        if (!input.name || input.name.length > 80 || input.description?.length > 1000) return rejectInput(interaction, 'Character names are limited to 80 characters and descriptions to 1000.');
    } else if (subcommand === 'settings') {
        input.observeParticipants = interaction.options.getBoolean('observe');
        input.followupWindowSeconds = interaction.options.getInteger('followup_seconds');
        input.offline = interaction.options.getBoolean('offline');
    }
    const result = await shared.execute(interaction, dependencies, action, input);
    if (result) await interaction.editReply(shared.textResult(result, 'Scene control completed.'));
}

async function rejectInput(interaction, content) {
    await shared.ensureDeferred(interaction);
    await interaction.editReply({ content, components: [] });
}

module.exports = { data, configure, init, execute };
