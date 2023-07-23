const { SlashCommandBuilder } = require('@discordjs/builders');
const { queryRecordLimit, removeRecords } = require('../../database/database_interaction');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_profile_remove')
		.setDescription('Remove the your AI image creation profile')
        .addStringOption(option => 
            option.setName('name')
                .setDescription('The name of the profile to remove')
                .setRequired(true))
    ,

	async execute(interaction) {
		//parse the option
        const name = interaction.options.getString('name');

        await interaction.deferReply();

        //query the database
        const result = await queryRecordLimit('wd_profile', { name: name, user_id: interaction.user.id }, 1);

        //check if the profile exists
        if (result.length == 0) {
            await interaction.editReply(`Profile with name ${name} does not exist`);
            return;
        }

        //remove the profile
        await removeRecords('wd_profile', { name: name, user_id: interaction.user.id });

        await interaction.editReply(`Profile ${name} removed`);
	},
};