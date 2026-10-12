const { SlashCommandBuilder } = require('@discordjs/builders');
const sharp = require('sharp');
const { loadImage } = require('../utils/load_discord_img');
const { createClient } = require('../utils/celforge_client');
const { renderOrbit } = require('../utils/model_orbit');
const { mediaReply, deliverFile, errorMessage } = require('../utils/comfy_media');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wd_img2model')
        .setDescription('Create a 3D model with CelForge and return an orbit video')
        .addAttachmentOption(option => option.setName('image').setDescription('PNG, JPEG, or WebP character image').setRequired(true))
        .addStringOption(option => option.setName('recipe').setDescription('CelForge model recipe (default TRELLIS 1024)').addChoices(
            { name: 'TRELLIS 1024 cascade', value: 'trellis_1024_cascade' }, { name: 'TRELLIS 512 — fast', value: 'trellis_512' },
            { name: 'Pixal single 1024', value: 'pixal_single_1024' }, { name: 'Pixal single 1536', value: 'pixal_single_1536' }))
        .addIntegerOption(option => option.setName('seed').setDescription('Generation seed (omit for random)').setMinValue(0).setMaxValue(4294967295))
        .addBooleanOption(option => option.setName('download_glb').setDescription('Also include the exported GLB download (default false)')),

    async execute(interaction) {
        await interaction.deferReply();
        const reply = mediaReply(interaction);
        try {
            const source = interaction.options.getAttachment('image');
            reply.progress('Preparing image for CelForge…');
            const buffer = await loadImage(source.url || source.proxyURL, true);
            // CelForge owns foreground preprocessing. Normalize orientation and
            // preserve alpha here, without claiming an unsupported API toggle.
            const image = await sharp(buffer).rotate().png().toBuffer();
            const result = await createClient().generate(image, { filename: 'source.png', mimetype: 'image/png',
                recipe: interaction.options.getString('recipe') || undefined,
                seed: interaction.options.getInteger('seed') ?? undefined, onProgress: reply.progress });
            const orbit = await renderOrbit(result.buffer, { onProgress: reply.progress });
            await deliverFile(reply, interaction, orbit, 'model-orbit.mp4', `Model ready (${result.recipe}, seed ${result.seed}).`);
            if (interaction.options.getBoolean('download_glb')) {
                // A follow-up keeps the orbit video as the primary reply.
                const downloadReply = { finish: payload => interaction.followUp(payload).catch(error => {
                    if ([10015, 10062, 50027].includes(error.code) && interaction.channel) return interaction.channel.send(payload);
                    throw error;
                }) };
                try { await deliverFile(downloadReply, interaction, result.buffer, result.filename, 'Optional GLB download:'); }
                catch (error) { await downloadReply.finish({ content: `The orbit video is ready, but the GLB download failed: ${errorMessage(error)}` }); }
            }
        } catch (error) { await reply.finish({ content: `Model conversion failed: ${errorMessage(error)}` }); }
    },
};
