const { SlashCommandBuilder } = require('@discordjs/builders');
const { upscaler_selection, model_selection, model_selection_xl, model_selection_flux, model_selection_legacy, sampler_selection, scheduler_selection } = require('../../utils/ai_server_config');
const { addRecord, queryRecord, queryRecordLimit, editRecords } = require('../../database/database_interaction');
const { clamp } = require('../../utils/common_helper');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_profile_add')
		.setDescription('Add/Update an AI image creation profile')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of the profile to add or update, only contain alphanumeric, slash and underscore')
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
                .setDescription('The width of the generated image (recommended max is 768, 1024 for XL and flux)'))
        .addIntegerOption(option =>
            option.setName('height')
                .setDescription('The height of the generated image (recommended max is 768, 1024 for XL and flux)'))
        .addStringOption(option => 
            option.setName('sampler')
                .setDescription('The sampling method for the AI to generate art from (default is "Euler")')
                .addChoices(...sampler_selection))
        .addStringOption(option => 
            option.setName('scheduler')
                .setDescription('The scheduling method for the AI to generate art from (default is "Automatic")')
                .addChoices(...scheduler_selection))
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
        .addStringOption(option =>
            option.setName('checkpoint')
                .setDescription('The checkpoint to use for the profile')
                .addChoices(
                    ...(model_selection.concat(model_selection_xl).concat(model_selection_flux).filter(x => !model_selection_legacy.map(y => y.value).includes(x.value)))
                ))
        .addStringOption(option =>
            option.setName('adetailer_config')
                .setDescription('Config string for the adetailer (use wd_adetailer to generate)'))
        .addStringOption(option =>
            option.setName('controlnet_config')
                .setDescription('Config string for the controlnet (use wd_controlnet to generate)'))
        .addStringOption(option =>
            option.setName('colorbalance_config')
                .setDescription('Config string for the controlnet (use wd_colorbalance to generate)'))
        .addStringOption(option =>
            option.setName('boorugen_config')
                .setDescription('Config string for the booru prompt enhancement (use wd_boorugen to generate)'))
        .addStringOption(option =>
            option.setName('script_outpaint_config')
                .setDescription('Config string for the outpaint script (use wd_script_outpaint to generate)'))
        .addStringOption(option =>
            option.setName('script_upscale_config')
                .setDescription('Config string for the upscale script (use wd_script_upscale to generate)'))
        .addStringOption(option =>
            option.setName('latentmod_config')
                .setDescription('Config string for the latentmod script (use wd_latentmod to generate)'))
    ,

	async execute(interaction) {
        // parse the options
        const name = interaction.options.getString('name');
        const prompt = interaction.options.getString('prompt') || '';
        const prompt_pre = interaction.options.getString('prompt_pre') || '';
        const neg_prompt = interaction.options.getString('neg_prompt') || '';
        const neg_prompt_pre = interaction.options.getString('neg_prompt_pre') || '';
        const width = interaction.options.getInteger('width') || null;
        const height = interaction.options.getInteger('height') || null;
        const sampler = interaction.options.getString('sampler') || 'Euler';
        const scheduler = interaction.options.getString('scheduler') || 'Automatic';
        const cfg_scale = clamp(interaction.options.getNumber('cfg_scale') || 7, 0, 30);
        const sampling_step = interaction.options.getInteger('sampling_step') || 20;
        const seed = interaction.options.getString('seed') || '-1';
        const upscale_multiplier = clamp(interaction.options.getNumber('upscale_multiplier') || 1, 1, 4);
        const upscaler = interaction.options.getString('upscaler') || 'Lanczos';
        const upscale_denoise_strength = clamp(interaction.options.getNumber('upscale_denoise_strength') || 0.7, 0, 1);
        const upscale_step = interaction.options.getInteger('upscale_step') || 20;
        const clip_skip = clamp(interaction.options.getInteger('clip_skip') || 1, 1, 2);
        const checkpoint = interaction.options.getString('checkpoint') || null
        const adetailer_config = interaction.options.getString('adetailer_config') || null
        const controlnet_config = interaction.options.getString('controlnet_config') || null
        const colorbalance_config = interaction.options.getString('colorbalance_config') || null
        const boorugen_config = interaction.options.getString('boorugen_config') || null
        const script_outpaint_config = interaction.options.getString('script_outpaint_config') || null
        const script_upscale_config = interaction.options.getString('script_upscale_config') || null
        const latentmod_config = interaction.options.getString('latentmod_config') || null

		await interaction.deferReply();

        // check if name is valid /([a-zA-Z0-9_\/]+)/
        if (!/^[a-zA-Z0-9_\/]+$/.test(name)) {
            await interaction.editReply("Invalid profile name, it must not include whitespace or special characters other than underscore and slash");
            return;
        }

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
                scheduler: scheduler,
                cfg_scale: cfg_scale,
                sampling_step: sampling_step,
                seed: seed,
                upscale_multiplier: upscale_multiplier,
                upscaler: upscaler,
                upscale_denoise_strength: upscale_denoise_strength,
                upscale_step: upscale_step,
                clip_skip: clip_skip,
                checkpoint: checkpoint,
                adetailer_config: adetailer_config,
                controlnet_config: controlnet_config,
                colorbalance_config: colorbalance_config,
                boorugen_config: boorugen_config,
                script_outpaint_config: script_outpaint_config,
                script_upscale_config: script_upscale_config,
                latentmod_config: latentmod_config,
            }
        };

        // add the profile to the database
        await editRecords('wd_profile', query, action, {upsert: true})

        // send the reply
        await interaction.editReply(`Profile ${name} ${isOverwrite ? 'updated' : 'added'}`);
	},
};