const { SlashCommandBuilder } = require('@discordjs/builders');
const { byPassUser } = require('../config.json');
const http = require('http');
var { is_generating } = require('../utils/text_gen_store');

function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('textgen')
		.setDescription('Continue your text with AI')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt for the AI to generate text from')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('max_token')
                .setDescription('How many tokens can be generated'))
        .addNumberOption(option =>
            option.setName('temperature')
                .setDescription('The temperature of the AI'))
        .addNumberOption(option =>
            option.setName('top_p')
                .setDescription('The top_p of the AI'))
        .addNumberOption(option =>
            option.setName('top_k')
                .setDescription('The top_k of the AI'))
        .addNumberOption(option =>
            option.setName('typical_p')
                .setDescription('The typical_p of the AI'))
        .addNumberOption(option =>
            option.setName('repetition_penalty')
                .setDescription('The repetition_penalty of the AI'))
    ,

	async execute(interaction) {
        let prompt = interaction.options.getString('prompt')
        let max_token = clamp(interaction.options.getInteger('max_token'), 1, 2048) || 100
        let temperature = clamp(interaction.options.getNumber('temperature'), 0.01, 1.99) || 0.7
        let top_p = clamp(interaction.options.getNumber('top_p'), 0, 1) || 0.1
        let top_k = clamp(interaction.options.getInteger('top_k'), 1, 100) || 40
        let typical_p = clamp(interaction.options.getNumber('typical_p'), 0, 1) || 1
        let repetition_penalty = clamp(interaction.options.getNumber('repetition_penalty'), 1, 1.5) || 1.18

        if (is_generating) {
            await interaction.reply({content: "The bot is currently generating text, please wait a few seconds and try again", ephemeral: true})
            return
        }

        await interaction.deferReply();

        const WORKER_ENDPOINT = 'http://192.168.196.142:7866'

        const params = {
            'max_new_tokens': max_token,
            'do_sample': true,
            'temperature': temperature,
            'top_p': top_p,
            'typical_p': typical_p,
            'repetition_penalty': repetition_penalty,
            'encoder_repetition_penalty': 1.0,
            'top_k': top_k,
            'min_length': 0,
            'no_repeat_ngram_size': 0,
            'num_beams': 1,
            'penalty_alpha': 0,
            'length_penalty': 1,
            'early_stopping': true,
            'seed': -1,
            'add_bos_token': true,
            'custom_stopping_strings': [],
            'truncation_length': 2048,
            'ban_eos_token': false,
        }

        const full_prompt = `${prompt}`

        const payload = JSON.stringify([
            full_prompt,
            params
        ])

        // make option_init but for axios
        const option_init_axios = {
            data: [payload],
            config: {
                timeout: 900000
            },
        }

		try {
            is_generating = true
            // measure speed
            const start = Date.now()
            // rewrite this with http
            const req = http.request(`${WORKER_ENDPOINT}/run/textgen`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 900000
            }, (res) => {
                let data = '';

                res.on('data', function(chunk) {
                    data += chunk; //Append each chunk of data received to this variable
                });
                res.on('end', () => {
                    const final_res_obj = JSON.parse(data)
                    const res_gen = final_res_obj.data[0]

                    if (res_gen_elaina === '') {
                        throw 'No response from AI'
                    }

                    is_generating = false

                    interaction.editReply(res_gen)
                    console.log(`Time taken: ${Date.now() - start}ms`)
                })

            })

            req.on('error', (err) => {
                console.log(err)
                interaction.editReply({content: err, ephemeral: true})
                is_generating = false
            })

            req.write(JSON.stringify({data: option_init_axios.data})); //Send off the request.
            req.end(); //End the request.

        } catch (err) {
            is_generating = false
            console.log(err)
            await interaction.editReply({content: err, ephemeral: true})
            return

        }
	},
};