const { SlashCommandBuilder } = require('@discordjs/builders');

let isDone = true
let isReady = true

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_modelchange')
		.setDescription('Change current model the AI is using to generate image')
        .addStringOption(option => 
            option.setName('checkpoint')
                .setDescription('The checkpoint to be used')
                .addChoices(
					{ name: 'Anything v4.5', value: 'anything.ckpt [fbcf965a62]' },
                    { name: 'Pastel Mix v1', value: 'pastelmix.safetensors [d01a68ae76]' },
                    { name: 'Counterfeit v2.5', value: 'counterfeit.safetensors [a074b8864e]' },
                    { name: 'NovelAI June 2022 leak', value: 'novelai.ckpt' },
                    { name: 'Waifu Diffusion 1.4', value: 'model.ckpt' },
				)
                .setRequired(true))
    ,

	async execute(interaction) {
        const checkpoint = interaction.options.getString('checkpoint')
        if (!isDone) {
            await interaction.reply('Please wait for the previous request to finish')
            return
        }

        if(!isReady) {
            await interaction.reply('There is a request not long ago, please let people use it first lol')
            return
        }

        //make a temporary reply to not get timeout'd
		await interaction.deferReply();

        const session_hash = crypt.randomBytes(16).toString('base64');
        isDone = false

        const option = {
            method: 'POST',
            body: JSON.stringify({
                fn_index: 336,
                session_hash: session_hash,
                data: [
                    checkpoint
                ]

            }),
            headers: { 'Content-Type': 'application/json' }
        }

        fetch('http://127.0.0.1:7860/run/predict/', option).then(
            res => res.json()
        ).then(
            async (json) => {
                if (json.status === 'ok') {
                    isDone = true

                    setTimeout(() => {
                        isReady = true
                    }, 600000)

                    await interaction.editReply('Model checkpoint has been changed successfully')
                }
            }
        ).catch(
            err => {
                console.log(err)
            }
        )
	},
};