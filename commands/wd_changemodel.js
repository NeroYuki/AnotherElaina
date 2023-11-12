const { SlashCommandBuilder } = require('@discordjs/builders');
const { model_change, cached_model } = require('../utils/model_change');
const { check_model_filename, model_selection, model_selection_xl } = require('../utils/ai_server_config');


// ["362dae27f8", "RefSlave v2"],
// ["bd518b9aee", "CetusMix v3 (Coda)"],
// ["fbcf965a62", "Anything v4.5"],
// ["a074b8864e", "Counterfeint v2.5"],
// ["e03274b1e7", "MeinaMix v7"],
// ["d01a68ae76", "PastelMix v2.1"],
// ["4b118b2d1b", "Yozora v1"],

let isReady = true

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_modelchange')
		.setDescription('Change current model the AI is using to generate image')
        .addStringOption(option => 
            option.setName('checkpoint')
                .setDescription('The checkpoint to be used')
                .addChoices(...model_selection, ...model_selection_xl)
                .setRequired(true))
    ,

	async execute(interaction) {

        const checkpoint = interaction.options.getString('checkpoint')

        if(!isReady) {
            await interaction.reply('There is a request not long ago, please let people use it first lol')
            return
        }

        //make a temporary reply to not get timeout'd
        await interaction.deferReply();

        await interaction.editReply(`Force changing model to **${check_model_filename(checkpoint)}**... , please wait`)

        const change_result = await model_change(checkpoint, true).catch(err => {
            interaction.editReply('Changing model failed, ' + err)
            return
        })

        if (!change_result) {
            await interaction.editReply("Uh, this is not supposed to happen, please contact the developer")
        }
        else {
            await interaction.editReply(`Active model force changed to **${check_model_filename(checkpoint)}**
currently cached models: ${cached_model.map(x => check_model_filename(x)).join(', ')}`)

            // set isReady to true after 60 minutes
            setTimeout(() => {
                isReady = true
            }, 3600000)
        }
	},
};
