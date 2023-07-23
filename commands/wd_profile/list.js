const { SlashCommandBuilder } = require('@discordjs/builders');
const { queryRecord, queryRecordLimit } = require('../../database/database_interaction');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_profile_list')
		.setDescription('List all of an user\'s AI image creation profile')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to list the profile of (Default to yourself)'))
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('The page of the result to return (Default to 1)'))
    ,

	async execute(interaction) {
		// parse the option
        const user = interaction.options.getUser('user') || interaction.user;
        const page = Math.max(interaction.options.getInteger('page') || 1, 1);

        await interaction.deferReply();

        // query the database
        const result = await queryRecordLimit('wd_profile', { user_id: user.id }, 20, {}, {}, (page - 1) * 20);

        // check if the user has any profile
        if (result.length == 0) {
            await interaction.editReply(`User ${user} has no profile`);
            return;
        }

        // compose the reply
        let reply = `Profile of ${user}:\n`;

        for (let i = 0; i < result.length; i++) {
            reply += `${i + 1}. ${result[i].name}\n`;
        }

        await interaction.editReply(reply);
	},
};