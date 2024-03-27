const { SlashCommandBuilder } = require('@discordjs/builders');
const { upscaler_selection } = require('../../utils/ai_server_config');
const { addRecord, queryRecord, queryRecordLimit, editRecords } = require('../../database/database_interaction');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_profile_add')
		.setDescription('Add/Update an AI image creation profile')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of the profile to add or update')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt to use for the profile'))
        .addStringOption(option =>
            option.setName('prompt_pre')
                .setDescription('The beginning prompt to use for the profile'))
        .addStringOption(option =>
            option.setName('neg_prompt')
                .setDescription('The negative prompt to use for the profile'))
        .addStringOption(option =>
            option.setName('neg_prompt_pre')
                .setDescription('The beginning negative prompt to use for the profile'))
        .addIntegerOption(option => 
            option.setName('width')
                .setDescription('The width of the generated image (default is 512, recommended max is 768)'))
        .addIntegerOption(option =>
            option.setName('height')
                .setDescription('The height of the generated image (default is 512, recommended max is 768)'))
        .addStringOption(option => 
            option.setName('sampler')
                .setDescription('The sampling method for the AI to generate art from (default is "Euler a")')
                .addChoices(
					{ name: 'Euler a', value: 'Euler a' },
                    { name: 'DPM++ SDE Karras', value: 'DPM++ SDE Karras' },
                    { name: 'LMS', value: 'LMS' },
                    { name: 'DPM++ 2S a', value: 'DPM++ 2S a' },
                    { name: 'DPM2 a Karras', value: 'DPM2 a Karras' },
                    { name: 'DPM++ 2M Karras', value: 'DPM++ 2M Karras' },
                    { name: 'DPM++ 3M SDE', value: 'DPM++ 3M SDE' },
                    { name: 'LCM', value: 'LCM' },
                ))
        .addNumberOption(option => 
            option.setName('cfg_scale')
                .setDescription('Lower value = more creative freedom (default is 7, recommended max is 10)'))
        .addIntegerOption(option =>
            option.setName('sampling_step')
                .setDescription('More sampling step = longer generation (default is 20, recommended max is 40)'))
        .addStringOption(option => 
            option.setName('seed')
                .setDescription('Random seed for AI generate art from (default is "-1 - Random")'))
        .addNumberOption(option =>
            option.setName('upscale_multiplier')
                .setDescription('The rate to upscale the generated image (default is 1). EXTREMELY SLOW. Use wd_upscale instead'))
        .addStringOption(option =>
            option.setName('upscaler')
                .setDescription('Specify the upscaler to use (default is "Lanczos")')
                .addChoices(
                    { name: 'Latent - Slow', value: 'Latent' },
                    { name: 'Latent (antialiased)', value: 'Latent (antialiased)' },
                    { name: 'Latent (nearest)', value: 'Latent (nearest)' },
                    { name: 'Latent (nearest-exact)', value: 'Latent (nearest-exact)' },
                    ...upscaler_selection
                ))
        .addNumberOption(option =>
            option.setName('upscale_denoise_strength')
                .setDescription('Lower to 0 mean nothing should change, higher to 1 may output unrelated image (default is "0.7")'))
        .addIntegerOption(option =>
            option.setName('upscale_step')
                .setDescription('Number of upscaling step (default is "20")'))
        .addIntegerOption(option =>
            option.setName('clip_skip')
                .setDescription('Early stopping parameter for CLIP model (default is 1, recommend 1 and 2)'))
    ,

	async execute(interaction) {
        // parse the options
        const name = interaction.options.getString('name');
        const prompt = interaction.options.getString('prompt') || '';
        const prompt_pre = interaction.options.getString('prompt_pre') || '';
        const neg_prompt = interaction.options.getString('neg_prompt') || '';
        const neg_prompt_pre = interaction.options.getString('neg_prompt_pre') || '';
        const width = interaction.options.getInteger('width') || 512;
        const height = interaction.options.getInteger('height') || 512;
        const sampler = interaction.options.getString('sampler') || 'Euler a';
        const cfg_scale = interaction.options.getNumber('cfg_scale') || 7;
        const sampling_step = interaction.options.getInteger('sampling_step') || 20;
        const seed = interaction.options.getString('seed') || '-1';
        const upscale_multiplier = interaction.options.getNumber('upscale_multiplier') || 1;
        const upscaler = interaction.options.getString('upscaler') || 'Lanczos';
        const upscale_denoise_strength = interaction.options.getNumber('upscale_denoise_strength') || 0.7;
        const upscale_step = interaction.options.getInteger('upscale_step') || 20;
        const clip_skip = interaction.options.getInteger('clip_skip') || 1

		await interaction.deferReply();

        let isOverwrite = false;

        // check if the profile created by user already exists
        const profile = await queryRecordLimit('wd_profile', { name: name, user_id: interaction.user.id }, 1);
        if (profile.length > 0) {
            isOverwrite = true;
        }

        const query = {
            name: name,
            user_id: interaction.user.id,
        }

        // compose the data
        const action = {
            $set: {
                prompt: prompt,
                prompt_pre: prompt_pre,
                neg_prompt: neg_prompt,
                neg_prompt_pre: neg_prompt_pre,
                width: width,
                height: height,
                sampler: sampler,
                cfg_scale: cfg_scale,
                sampling_step: sampling_step,
                seed: seed,
                upscale_multiplier: upscale_multiplier,
                upscaler: upscaler,
                upscale_denoise_strength: upscale_denoise_strength,
                upscale_step: upscale_step,
                clip_skip: clip_skip,
            }
        };

        // add the profile to the database
        await editRecords('wd_profile', query, action, {upsert: true})

        // send the reply
        await interaction.editReply(`Profile ${name} ${isOverwrite ? 'updated' : 'added'}`);
	},
};