const { SlashCommandBuilder } = require('@discordjs/builders');
const {
    model_selection_curated,
    generation_upscaler_selection,
} = require('../utils/ai_server_config.js');
const { execute_forge_image_command } = require('../utils/forge_image_command');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wd_img2img')
        .setDescription('Request my Diffusion instance to generate art from an image')
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('The image to be regenerate')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt for the AI to generate art from'))
        .addStringOption(option =>
            option.setName('neg_prompt')
                .setDescription('The negative prompt for the AI to avoid generate art from'))
        .addNumberOption(option =>
            option.setName('denoising_strength')
                .setDescription('How much the image is noised before regen, closer to 0 = closer to original (0 - 1, default 0.7)'))
        .addIntegerOption(option =>
            option.setName('width')
                .setDescription('The width of the generated image (default is image upload size, recommended is 1024)'))
        .addIntegerOption(option =>
            option.setName('height')
                .setDescription('The height of the generated image (default is image upload size, recommended is 1024)'))
        .addStringOption(option =>
            option.setName('seed')
                .setDescription('Random seed for AI generate art from (default is "-1 - Random")'))
        .addStringOption(option =>
            option.setName('default_neg_prompt')
                .setDescription('Define the default negative prompt for the user (default is "Quality - No NSFW")')
                .addChoices(
                    { name: 'Quality - SFW', value: 'q_sfw' },
                    { name: 'Quality - NSFW', value: 'q_nsfw' },
                    { name: 'None - SFW', value: 'n_sfw' },
                    { name: 'No Default', value: 'n_nsfw' },
                ))
        .addStringOption(option =>
            option.setName('checkpoint')
                .setDescription('Force a cached checkpoint to be used (not all option is cached)')
                .addChoices(...(model_selection_curated || [])))
        .addStringOption(option =>
            option.setName('upscaler')
                .setDescription('The upscaler to use (default is "None")')
                .addChoices(...(generation_upscaler_selection || [])))
        .addStringOption(option =>
            option.setName('profile')
                .setDescription('Specify the profile to use (default is No Profile)'))
        .addStringOption(option =>
            option.setName('extra_script')
                .setDescription('Specify an extra script to be used during the process')
                .addChoices(
                    { name: 'None', value: 'None' },
                    { name: 'Tiled Latent Upscale', value: 'Tiled Latent Upscale' },
                    { name: 'Native Outpaint', value: 'Native Outpaint' },
                    { name: 'Flux Outpaint', value: 'Flux Outpaint' },
                    { name: 'Flux Kontext', value: 'Flux Kontext' },
                )),

    async execute(interaction, client, deps) {
        return execute_forge_image_command(interaction, client, {
            advanced: false,
            workflow: 'img2img',
            allowControlNet: false,
            allowAdetailer: false,
            allowExtraScript: true,
        }, deps);
    },
};
