const { SlashCommandBuilder } = require('@discordjs/builders');
const sharp = require('sharp');
const ComfyClient = require('../utils/comfy_client');
const { loadImage } = require('../utils/load_discord_img');
const { buildH3Workflow, imageVideoShape, runVideo, errorMessage } = require('../utils/comfy_media');
const { addPromptQualityOption, enrichVideoPrompt } = require('../utils/video_prompt');

module.exports = {
    data: addPromptQualityOption(new SlashCommandBuilder()
        .setName('wd_img2vid')
        .setDescription('Animate an image with audio using MiniMax H3')
        .addAttachmentOption(option => option.setName('image').setDescription('Opening frame').setRequired(true))
        .addStringOption(option => option.setName('prompt').setDescription('Describe the motion, dialogue, and sound').setRequired(true))
        .addAttachmentOption(option => option.setName('last_image').setDescription('Optional final frame'))
        .addStringOption(option => option.setName('preset').setDescription('Resolution, preserving image aspect ratio (default Standard)').addChoices(
            { name: 'Fast — 0.4 megapixels', value: 'fast' }, { name: 'Standard — 0.8 megapixels', value: 'std' },
            { name: 'High — 1.0 megapixels', value: 'high' }))
        .addIntegerOption(option => option.setName('length').setDescription('Duration in seconds (default 5, snapped to H3 frame grid)').setMinValue(1).setMaxValue(15))
        .addNumberOption(option => option.setName('seed').setDescription('Generation seed (omit for random; 0 is a valid seed)').setMinValue(0).setMaxValue(Number.MAX_SAFE_INTEGER))
        .addIntegerOption(option => option.setName('steps').setDescription('Sampling steps (default 20)').setMinValue(1).setMaxValue(50))
        .addBooleanOption(option => option.setName('do_upscale').setDescription('Use RTX video super resolution at 2× (default true)'))
        .addBooleanOption(option => option.setName('no_optimize').setDescription('Disable EasyCache optimization'))),

    async execute(interaction) {
        await interaction.deferReply();
        try {
            const options = interaction.options;
            const source = options.getAttachment('image');
            await interaction.editReply({ content: 'Preparing image for MiniMax H3…' });
            const buffer = await loadImage(source.url || source.proxyURL, true);
            const png = await sharp(buffer).rotate().png().toBuffer();
            const metadata = await sharp(png).metadata();
            const megapixels = { fast: 0.4, std: 0.8, high: 1.0 }[options.getString('preset') || 'std'];
            const seconds = options.getInteger('length') ?? 5;
            const shape = imageVideoShape(metadata.width, metadata.height, megapixels, seconds);
            const quality = options.getString('prompt_quality') || 'standard';
            const images = [];
            const visionImage = buffer => sharp(buffer).resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
            if (quality !== 'off') images.push(await visionImage(png));
            const image = await ComfyClient.uploadImage(png, `${Date.now()}_first.png`, 'image/png');
            let lastImage;
            const last = options.getAttachment('last_image');
            if (last) {
                const lastBuffer = await loadImage(last.url || last.proxyURL, true);
                const lastPng = await sharp(lastBuffer).rotate().png().toBuffer();
                lastImage = await ComfyClient.uploadImage(lastPng, `${Date.now()}_last.png`, 'image/png');
                if (quality !== 'off') images.push(await visionImage(lastPng));
            }
            const prompt = await enrichVideoPrompt({ prompt: options.getString('prompt'), shape, requestedSeconds: seconds, quality, images,
                onProgress: content => interaction.editReply({ content }).catch(() => {}) });
            const workflow = buildH3Workflow({ prompt, shape, image, lastImage,
                seed: options.getNumber('seed') ?? undefined, steps: options.getInteger('steps') ?? 20,
                upscale: options.getBoolean('do_upscale') ?? true, optimize: !options.getBoolean('no_optimize') });
            await runVideo(interaction, workflow, shape);
        } catch (error) { await interaction.editReply({ content: `Video failed: ${errorMessage(error)}` }); }
    },
};
