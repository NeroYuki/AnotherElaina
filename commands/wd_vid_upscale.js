const { SlashCommandBuilder } = require('@discordjs/builders');
const ComfyClient = require('../utils/comfy_client');
const { loadImage } = require('../utils/load_discord_img');
const { buildPostProcessWorkflow, runVideo, errorMessage } = require('../utils/comfy_media');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wd_vid_upscale')
        .setDescription('Upscale, color match, or interpolate video while preserving audio')
        .addAttachmentOption(option => option.setName('video').setDescription('Video to process').setRequired(true))
        .addStringOption(option => option.setName('color_correction').setDescription('Color matching method').addChoices(
            ...['None', 'mkl', 'hm', 'reinhard', 'mvgd', 'hm-mvgd-hm', 'hm-mkl-hm'].map(value => ({ name: value, value }))))
        .addNumberOption(option => option.setName('color_correction_strength').setDescription('Color matching strength (default 1)').setMinValue(0).setMaxValue(10))
        .addAttachmentOption(option => option.setName('ref_image').setDescription('Reference image required for color matching'))
        .addStringOption(option => option.setName('upscaler').setDescription('Upscale model').addChoices(
            { name: 'None', value: 'None' }, { name: 'AnimeSharp v3 2×', value: '2x-AnimeSharpV3.pth' },
            { name: 'AnimeSharp v4 2×', value: '2x-AnimeSharpV4_RCAN.safetensors' }, { name: 'AnimeSharp 4×', value: '4x_AnimeSharp.pth' },
            { name: 'NMKD Siax 4×', value: '4x_NMKD-Siax_200k.pth' }, { name: 'UltraSharp 4×', value: '4x_UltraSharp.pth' },
            { name: 'ESRGAN 4×', value: 'ESRGAN_4x.pth' }))
        .addStringOption(option => option.setName('frame_interpolation').setDescription('Frame interpolation model').addChoices(
            { name: 'None', value: 'None' }, { name: 'RIFE47', value: 'rife47.pth' }, { name: 'RIFE49', value: 'rife49.pth' }))
        .addIntegerOption(option => option.setName('fps_multiplier').setDescription('Whole-number FPS multiplier (default 2, 1 disables interpolation)').setMinValue(1).setMaxValue(10)),

    async execute(interaction) {
        await interaction.deferReply();
        try {
            const options = interaction.options;
            const settings = { color: options.getString('color_correction') || 'None',
                strength: options.getNumber('color_correction_strength') ?? 1,
                upscaler: options.getString('upscaler') || 'None', interpolation: options.getString('frame_interpolation') || 'None',
                multiplier: options.getInteger('fps_multiplier') ?? 2 };
            const reference = options.getAttachment('ref_image');
            buildPostProcessWorkflow({ ...settings, video: { name: 'validation.mp4' }, reference: reference && { name: 'validation.png' } });
            await interaction.editReply({ content: 'Preparing video…' });
            const source = options.getAttachment('video');
            const video = await ComfyClient.uploadImage(await loadImage(source.url || source.proxyURL, true), `${Date.now()}_${source.name}`, source.contentType || 'video/mp4');
            let uploadedReference;
            if (settings.color !== 'None') {
                uploadedReference = await ComfyClient.uploadImage(await loadImage(reference.url || reference.proxyURL, true), `${Date.now()}_${reference.name}`, reference.contentType || 'image/png');
            }
            await runVideo(interaction, buildPostProcessWorkflow({ ...settings, video, reference: uploadedReference }));
        } catch (error) { await interaction.editReply({ content: `Video failed: ${errorMessage(error)}` }); }
    },
};
