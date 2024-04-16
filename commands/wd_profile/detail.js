const { SlashCommandBuilder } = require('@discordjs/builders');
const { queryRecordLimit } = require('../../database/database_interaction');
const { MessageEmbed } = require('discord.js');

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

        // send the reply
        embeded = new MessageEmbed()
            .setColor('#8888ff')
            .setTitle('Profile Info')
            .setFooter({text: "Profile Owner: " + user.username, iconURL: user.avatarURL({dynamic: true}) || "https://cdn.discordapp.com/embed/avatars/0.png"});

        if (data.prompt != '' || data.prompt_pre != '') {
            embeded.setDescription(`**Prompt:** ${data.prompt_pre || ''} ... ${data.prompt || ''}\n`);
        }
        if (data.neg_prompt != '' || data.neg_prompt_pre != '') {
            embeded.addFields({ name: 'Negative Prompt', value: `${data.neg_prompt_pre || ''} ... ${data.neg_prompt || ''}` })
        }
        if (data.seed && data.seed != '-1') {
            embeded.addFields({ name: 'Seed', value: data.seed });
        }
        if (data.width && data.width != 512) {
            embeded.addFields({ name: 'Width', value: data.width.toString() });
        }
        if (data.heigh && data.height != 512) {
            embeded.addFields({ name: 'Height', value: data.height.toString() });
        }
        if (data.sampler && data.sampler != 'Euler a') {
            embeded.addFields({ name: 'Sampler', value: data.sampler });
        }
        if (data.cfg_scale && data.cfg_scale != 7) {
            embeded.addFields({ name: 'CFG Scale', value: data.cfg_scale.toString() });
        }
        if (data.sampling_step && data.sampling_step != 20) {
            embeded.addFields({ name: 'Sampling Step', value: data.sampling_step.toString() });
        }
        if (data.upscale_multiplier && data.upscale_multiplier != 1) {
            embeded.addFields({ name: 'Upscale Multiplier', value: data.upscale_multiplier.toString() });
        }
        if (data.upscaler && data.upscaler != 'Lanczos') {
            embeded.addFields({ name: 'Upscaler', value: data.upscaler });
        }
        if (data.upscale_denoise_strength && data.upscale_denoise_strength != 0.7) {
            embeded.addFields({ name: 'Upscale Denoise Strength', value: data.upscale_denoise_strength.toString() });
        }
        if (data.upscale_step && data.upscale_step != 20) {
            embeded.addFields({ name: 'Upscale Step', value: data.upscale_step.toString() });
        }
        if (data.clip_skip && data.clip_skip != 1) {
            embeded.addFields({ name: 'CLIP skip', value: data.clip_skip.toString() });
        }
        if (data.checkpoint) {
            embeded.addFields({ name: 'Checkpoint', value: data.checkpoint });
        }

        await interaction.editReply({ embeds: [embeded] });
	},
};