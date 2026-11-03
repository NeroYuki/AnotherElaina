const { SlashCommandBuilder } = require('@discordjs/builders');
const {
    generation_upscaler_selection,
} = require('../utils/ai_server_config.js');
const {
    REFERENCE_CHECKPOINT_SELECTION,
    REFERENCE_LAYOUTS,
    REFERENCE_EDIT_VARIANTS,
    execute_forge_image_command,
} = require('../utils/forge_image_command');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wd_ref2img')
        .setDescription('Create an edited image from one or more reference images')
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('The primary reference / edit target image')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt describing the desired edit'))
        .addStringOption(option =>
            option.setName('neg_prompt')
                .setDescription('The negative prompt for the AI to avoid'))
        .addNumberOption(option =>
            option.setName('denoising_strength')
                .setDescription('Edit strength, closer to 0 = closer to the reference (0 - 1, default 1)'))
        .addIntegerOption(option =>
            option.setName('width')
                .setDescription('The width of the generated image (default is reference upload size, recommended is 1024)'))
        .addIntegerOption(option =>
            option.setName('height')
                .setDescription('The height of the generated image (default is reference upload size, recommended is 1024)'))
        .addStringOption(option =>
            option.setName('seed')
                .setDescription('Random seed (default is "-1 - Random")'))
        .addStringOption(option =>
            option.setName('default_neg_prompt')
                .setDescription('Define the default negative prompt (default is "None - No NSFW")')
                .addChoices(
                    { name: 'Quality - SFW', value: 'q_sfw' },
                    { name: 'Quality - NSFW', value: 'q_nsfw' },
                    { name: 'None - SFW', value: 'n_sfw' },
                    { name: 'No Default', value: 'n_nsfw' },
                ))
        .addAttachmentOption(option =>
            option.setName('reference_2')
                .setDescription('Additional reference image 2'))
        .addAttachmentOption(option =>
            option.setName('reference_3')
                .setDescription('Additional reference image 3'))
        .addAttachmentOption(option =>
            option.setName('reference_4')
                .setDescription('Additional reference image 4'))
        .addStringOption(option =>
            option.setName('reference_layout')
                .setDescription('How multiple references are combined (default is "Native")')
                .addChoices(...REFERENCE_LAYOUTS))
        .addStringOption(option =>
            option.setName('edit_variant')
                .setDescription('Reference edit style (default is "General")')
                .addChoices(...REFERENCE_EDIT_VARIANTS))
        .addStringOption(option =>
            option.setName('checkpoint')
                .setDescription('Force a cached reference-capable checkpoint')
                .addChoices(...REFERENCE_CHECKPOINT_SELECTION))
        .addStringOption(option =>
            option.setName('upscaler')
                .setDescription('The upscaler to use (default is "None")')
                .addChoices(...(generation_upscaler_selection || [])))
        .addStringOption(option =>
            option.setName('profile')
                .setDescription('Specify the profile to use (default is No Profile)')),

    async execute(interaction, client, deps) {
        return execute_forge_image_command(interaction, client, {
            advanced: false,
            workflow: 'reference',
            allowControlNet: false,
            allowAdetailer: false,
            allowExtraScript: false,
        }, deps);
    },
};
