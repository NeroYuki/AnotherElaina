const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { byPassUser } = require('../config.json');
const crypt = require('crypto');
const { default: axios } = require('axios');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('textgen')
		.setDescription('Continue your text with AI')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt for the AI to generate text from')
                .setRequired(true))

    ,

	async execute(interaction) {
        let prompt = interaction.options.getString('prompt')

        await interaction.deferReply();

        const WORKER_ENDPOINT = 'http://192.168.196.142:7866'

        const params = {
            'max_new_tokens': 100,
            'do_sample': true,
            'temperature': 1.2,
            'top_p': 0.9,
            'typical_p': 1,
            'repetition_penalty': 1.1,
            'top_k': 0,
            'min_length': 1,
            'no_repeat_ngram_size': 0,
            'num_beams': 1,
            'penalty_alpha': 0,
            'length_penalty': 1,
            'early_stopping': true,
        }

        const full_prompt = `
Elaina's Persona: Elaina is a helpful and kind assistant
<START>
You: ${prompt}
Elaina: `

        // make option_init but for axios
        const option_init_axios = {
            data: {
                data: [
                    full_prompt,
                    params['max_new_tokens'],
                    params['do_sample'],
                    params['temperature'],
                    params['top_p'],
                    params['typical_p'],
                    params['repetition_penalty'],
                    params['top_k'],
                    params['min_length'],
                    params['no_repeat_ngram_size'],
                    params['num_beams'],
                    params['penalty_alpha'],
                    params['length_penalty'],
                    params['early_stopping'],
                ]
            },
            config: {
                timeout: 900000
            }
        }

		try {

            await axios.post(`${WORKER_ENDPOINT}/run/textgen`, option_init_axios.data, option_init_axios.config )
                .then((res) => {
                    if (res.status !== 200) {
                        throw 'Server can be reached but returned non-200 status'
                    }
                    return res.data
                }) // fuck node fetch, all my homies use axios
                .then(async (final_res_obj) => {
                    const res_gen = final_res_obj.data[0]
                    // get the first line with the word "Elaina" as the response
                    const res_gen_lines = res_gen.split('\n')
                    console.log(res_gen_lines)
                    let res_gen_elaina = ''
                    for (let i = 0; i < res_gen_lines.length; i++) {
                        if (res_gen_lines[i].includes('Elaina:')) {
                            res_gen_elaina = res_gen_lines[i]
                            break
                        }
                    }
                    if (res_gen_elaina === '') {
                        throw 'No response from AI'
                    }

                    await interaction.editReply(res_gen_elaina)
                })
                .catch((err) => {
                    console.log(err)
                    throw 'Unknown server error'
                })
        } catch (err) {

            console.log(err)
            await interaction.editReply(err)
            return

        }
	},
};