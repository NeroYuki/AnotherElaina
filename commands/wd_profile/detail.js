const { SlashCommandBuilder } = require('@discordjs/builders');
const { queryRecordLimit } = require('../../database/database_interaction');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_profile_detail')
		.setDescription('Return the detail of a specified AI image creation profile')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of the profile to return')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to return the profile of (Default to yourself)'))
    ,

	async execute(interaction) {
		// parse the option
        const name = interaction.options.getString('name');
        const user = interaction.options.getUser('user') || interaction.user;

        await interaction.deferReply();

        // query the database
        const result = await queryRecordLimit('wd_profile', { name: name, user_id: user.id }, 1);

        // check if the profile exists
        if (result.length == 0) {
            await interaction.editReply(`Profile with name ${name} does not exist`);
            return;
        }

        // compose the reply (only display non-default values)
        const data = result[0];
        
        let reply = `Profile ${name}:\n`;

        if (data.prompt != '') {
            reply += `Prompt: ${data.prompt}\n`;
        }
        if (data.neg_prompt != '') {
            reply += `Negative Prompt: ${data.neg_prompt}\n`;
        }
        if (data.seed != '') {
            reply += `Seed: ${data.seed}\n`;
        }
        if (data.width != 512) {
            reply += `Width: ${data.width}\n`;
        }
        if (data.height != 512) {
            reply += `Height: ${data.height}\n`;
        }
        if (data.sampler != 'Euler a') {
            reply += `Sampler: ${data.sampler}\n`;
        }
        if (data.cfg_scale != 7) {
            reply += `CFG Scale: ${data.cfg_scale}\n`;
        }
        if (data.sampling_step != 20) {
            reply += `Sampling Step: ${data.sampling_step}\n`;
        }
        if (data.upscale_multiplier != 1) {
            reply += `Upscale Multiplier: ${data.upscale_multiplier}\n`;
        }
        if (data.upscaler != 'Lanczos') {
            reply += `Upscaler: ${data.upscaler}\n`;
        }
        if (data.upscale_denoise_strength != 0.7) {
            reply += `Upscale Denoise Strength: ${data.upscale_denoise_strength}\n`;
        }
        if (data.upscale_step != 20) {
            reply += `Upscale Step: ${data.upscale_step}\n`;
        }

        // send the reply
        await interaction.editReply(reply);
	},
};