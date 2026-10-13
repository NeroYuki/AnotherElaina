const { SlashCommandBuilder } = require('@discordjs/builders');
const { buildH3Workflow, videoShape, runVideo, errorMessage } = require('../utils/comfy_media');
const { addPromptQualityOption, enrichVideoPrompt } = require('../utils/video_prompt');
const { prepareVideoReference } = require('../utils/video_reference');

module.exports = {
    data: addPromptQualityOption(new SlashCommandBuilder()
        .setName('wd_ref2vid')
        .setDescription('Generate a video with an image, video, or audio reference using H3 Ref2VA')
        .addAttachmentOption(option => option.setName('ref').setDescription('Image, video, or audio reference').setRequired(true))
        .addStringOption(option => option.setName('prompt').setDescription('Describe the scene and how to use the reference').setRequired(true))
        .addStringOption(option => option.setName('preset').setDescription('Video resolution (default Standard)').addChoices(
            { name: 'Fast — 768×448', value: 'fast' }, { name: 'Standard — 1024×768', value: 'sd' },
            { name: 'Wide — 1344×768', value: 'wide' }))
        .addIntegerOption(option => option.setName('length').setDescription('Duration in seconds (default 5, snapped to H3 frame grid)').setMinValue(1).setMaxValue(15))
        .addBooleanOption(option => option.setName('portrait').setDescription('Swap width and height'))
        .addNumberOption(option => option.setName('seed').setDescription('Generation seed (omit for random)').setMinValue(0).setMaxValue(Number.MAX_SAFE_INTEGER))
        .addIntegerOption(option => option.setName('steps').setDescription('Sampling steps (default 20)').setMinValue(1).setMaxValue(50))
        .addBooleanOption(option => option.setName('do_upscale').setDescription('Use RTX video super resolution at 2× (default true)'))),

    async execute(interaction) {
        await interaction.deferReply();
        try {
            const options = interaction.options;
            let [width, height] = { fast: [768, 448], sd: [1024, 768], wide: [1344, 768] }[options.getString('preset') || 'sd'];
            if (options.getBoolean('portrait')) [width, height] = [height, width];
            const seconds = options.getInteger('length') ?? 5;
            const shape = videoShape(width, height, seconds);
            const quality = options.getString('prompt_quality') || 'standard';
            await interaction.editReply({ content: 'Preparing MiniMax H3 reference…' });
            const reference = await prepareVideoReference(options.getAttachment('ref'), shape, { vision: quality !== 'off' });
            if (!reference) throw new Error('A reference attachment is required.');
            const prompt = await enrichVideoPrompt({ prompt: options.getString('prompt'), shape, requestedSeconds: seconds, quality, reference,
                onProgress: content => interaction.editReply({ content }).catch(() => {}) });
            await runVideo(interaction, buildH3Workflow({ prompt, shape, reference, referenceOnly: true, seed: options.getNumber('seed') ?? undefined,
                steps: options.getInteger('steps') ?? undefined, upscale: options.getBoolean('do_upscale') ?? true }), shape);
        } catch (error) { await interaction.editReply({ content: `Video failed: ${errorMessage(error)}` }); }
    },
};
