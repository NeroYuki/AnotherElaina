const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageActionRow, MessageSelectMenu } = require('discord.js');
const { model_change, cached_model } = require('../utils/model_change');
const { byPassUser } = require('../config.json');
const { check_model_filename, model_selection, model_selection_xl, model_selection_inpaint, model_selection_flux, model_selection_legacy} = require('../utils/ai_server_config');


// ["362dae27f8", "RefSlave v2"],
// ["bd518b9aee", "CetusMix v3 (Coda)"],
// ["fbcf965a62", "Anything v4.5"],
// ["a074b8864e", "Counterfeint v2.5"],
// ["e03274b1e7", "MeinaMix v7"],
// ["d01a68ae76", "PastelMix v2.1"],
// ["4b118b2d1b", "Yozora v1"],


module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_modelchange')
		.setDescription('Change current model the AI is using to generate image')
        .addStringOption(option => 
            option.setName('checkpoint')
                .setDescription('The checkpoint to be used')
                // this list is combining model_selection, model_selection_xl ,model_selection_flux but exclusding all model_selection_legacy
                .addChoices(
                    ...(model_selection.concat(model_selection_xl).concat(model_selection_flux).filter(x => !model_selection_legacy.map(y => y.value).includes(x.value))),
                    { name: 'LEGACY MODELS', value: 'legacy' }
                )
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('inpaint')
                .setDescription('Use inpaint model instead of the main model')
                .setRequired(false))

    ,

    async selectModel(interaction, checkpoint, inpaint) {
        //make a temporary reply to not get timeout'd
        await interaction.deferReply();

        //console.log(globalThis.can_change_model, interaction.user.id, byPassUser)
        if(!globalThis.can_change_model && !(interaction.user.id == byPassUser)) {
            await interaction.editReply('There is a request not long ago, please let people use it first lol')
            return
        }

        if (inpaint) {
            const inpaint_model = model_selection_inpaint.find(x => x.value === checkpoint)
            if (!inpaint_model) {
                await interaction.channel.send('Inpaint model not found, fallback to normal model')
            }
            else {
                await interaction.channel.send(`Found inpaint model: **${check_model_filename(inpaint_model.inpaint)}**`)
                checkpoint = inpaint_model.inpaint
            }
        }

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

            globalThis.can_change_model = false

            setTimeout(() => {
                globalThis.can_change_model = true
            }, 1_800_000)
        }
    },

	async execute(interaction) {

        let checkpoint = interaction.options.getString('checkpoint')
        const inpaint = interaction.options.getBoolean('inpaint') || false

        if (checkpoint == 'legacy') {
            // make a dropdown for legacy models
            const row = new MessageActionRow()
                .addComponents(
                    new MessageSelectMenu()
                        .setCustomId('legacy_model_picker')
                        .setPlaceholder('Nothing has been selected')
                        .addOptions(model_selection_legacy.map(x => {
                            return {
                                label: x.name,
                                value: x.value
                            }
                        }))
                );

            await interaction.reply({ content: 'Select a model from the following list (:warning: There aren\'t many reasons to use these models, make sure you know what your are selecting)', components: [row] });
        }   
        else {
            await this.selectModel(interaction, checkpoint, inpaint)
        }
	},
};
