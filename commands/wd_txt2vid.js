const { SlashCommandBuilder } = require('@discordjs/builders');
const { buildH3Workflow, videoShape, runVideo, errorMessage } = require('../utils/comfy_media');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wd_txt2vid')
        .setDescription('Generate a video with audio using MiniMax H3')
        .addStringOption(option => option.setName('prompt').setDescription('Describe the scene, motion, dialogue, and sound').setRequired(true))
        .addStringOption(option => option.setName('preset').setDescription('Video size and duration (default Standard)').addChoices(
            { name: 'Fast — 768×448, 5 seconds', value: 'fast' },
            { name: 'Standard — 1024×768, 5 seconds', value: 'sd' },
            { name: 'Long — 1024×768, 10 seconds', value: 'long' },
            { name: 'Custom', value: 'custom' }))
        .addIntegerOption(option => option.setName('custom_width').setDescription('Custom width, rounded to 32 pixels (default 1024)').setMinValue(32).setMaxValue(1344))
        .addIntegerOption(option => option.setName('custom_height').setDescription('Custom height, rounded to 32 pixels (default 768)').setMinValue(32).setMaxValue(1344))
        .addIntegerOption(option => option.setName('custom_length').setDescription('Custom duration in seconds (default 5, snapped to H3 frame grid)').setMinValue(1).setMaxValue(15))
        .addBooleanOption(option => option.setName('portrait').setDescription('Swap width and height'))
        .addNumberOption(option => option.setName('seed').setDescription('Generation seed (omit for random; 0 is a valid seed)').setMinValue(0).setMaxValue(Number.MAX_SAFE_INTEGER))
        .addIntegerOption(option => option.setName('steps').setDescription('Sampling steps (default 20)').setMinValue(1).setMaxValue(50))
        .addBooleanOption(option => option.setName('do_upscale').setDescription('Use RTX video super resolution at 2× (default true)'))
        .addBooleanOption(option => option.setName('no_optimize').setDescription('Disable EasyCache optimization')),

    async execute(interaction) {
        await interaction.deferReply();
        try {
            const options = interaction.options;
            const preset = options.getString('preset') || 'sd';
            let [width, height, seconds] = preset === 'fast' ? [768, 448, 5] : [1024, 768, preset === 'long' ? 10 : 5];
            if (preset === 'custom') {
                width = options.getInteger('custom_width') ?? width;
                height = options.getInteger('custom_height') ?? height;
                seconds = options.getInteger('custom_length') ?? seconds;
            }
            if (options.getBoolean('portrait')) [width, height] = [height, width];
            const shape = videoShape(width, height, seconds);
            const workflow = buildH3Workflow({ prompt: options.getString('prompt'), shape,
                seed: options.getNumber('seed') ?? undefined, steps: options.getInteger('steps') ?? 20,
                upscale: options.getBoolean('do_upscale') ?? true, optimize: !options.getBoolean('no_optimize') });
            await runVideo(interaction, workflow, shape);
        } catch (error) { await interaction.editReply({ content: `Video failed: ${errorMessage(error)}` }); }
    },
};
