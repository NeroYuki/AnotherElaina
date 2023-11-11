const http = require('http');
const { context_storage } = require('../utils/text_gen_store');
var { is_generating } = require('../utils/text_gen_store');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { default: axios } = require('axios');

async function responseToMessage(client, message, content) {
    let prompt = content
    if (is_generating) {
        return
    }

    const WORKER_ENDPOINT = 'http://192.168.196.142:5000'

    // get the context from the context storage
    let context = context_storage.get(message.author.id)
    if (context === undefined) {
        context = [prompt]
    }
    else {
        context.push(prompt)
    }

    // while the total character length of the context is greater than 2048, remove the first element
    while (context.join('').length > 8000) {
        context.shift()
    }

    // generate the context dialog
    let context_dialog = ''
    for (let i = 0; i < context.length; i++) {
        if (i % 2 === 0) {
            context_dialog += `You: ${context[i]}\n `
        } else {
            context_dialog += `Elaina: ${context[i]}\n`
        }
    }

    const full_prompt = `Elaina's Persona: Elaina is a witch with a somewhat sarcastic, greedy, pragmatic, cunning, calm, kuudere, polite characteristic. 
She is a beautiful girl at the age of 18 but has A-cup breast and being insecure about chest size. 
She has a long, ashen colored hair and azure eyes. She normally wears a black witch hat and a white sleeveless shirt and black robe. 
She has a flying broomstick which can turn into a person. She is a traveller but usually penniless her nickname is the 'Ashen Witch. 
Her mentor name is Fran and she respect her very much.
She also have a mentee name Saya who might have a crush on her (girl's love).
She will be annoyed if her intelligence is insulted
<START>
${context_dialog}Elaina: `
    console.log(full_prompt)

    const params = {
        // 'max_new_tokens': 100,
        // 'do_sample': true,
        // 'temperature': 0.7,
        // 'top_p': 0.1,
        // 'typical_p': 1,
        // 'repetition_penalty': 1.1,
        // 'encoder_repetition_penalty': 1.0,
        // 'top_k': 40,
        // 'min_length': 0,
        // 'no_repeat_ngram_size': 0,
        // 'num_beams': 1,
        // 'penalty_alpha': 0,
        // 'length_penalty': 1,
        // 'early_stopping': true,
        // 'seed': -1,
        // 'add_bos_token': true,
        // 'custom_stopping_strings': ["You:", "Elaina:"],
        // 'truncation_length': 2048,
        // 'ban_eos_token': false,

        'prompt': full_prompt,
        'max_new_tokens': 250,
        'auto_max_new_tokens': false,
        'max_tokens_second': 0,

        // # Generation params. If 'preset' is set to different than 'None', the values
        // # in presets/preset-name.yaml are used instead of the individual numbers.
        'preset': 'None',
        'do_sample': true,
        'temperature': 1.2,
        'top_p': 0.1,
        'typical_p': 1,
        'epsilon_cutoff': 0,  // # In units of 1e-4
        'eta_cutoff': 0,  // # In units of 1e-4
        'tfs': 1,
        'top_a': 0,
        'repetition_penalty': 1.18,
        'repetition_penalty_range': 0,
        'top_k': 40,
        'min_length': 0,
        'no_repeat_ngram_size': 0,
        'num_beams': 1,
        'penalty_alpha': 0,
        'length_penalty': 1,
        'early_stopping': true,
        'mirostat_mode': 0,
        'mirostat_tau': 5,
        'mirostat_eta': 0.1,
        'guidance_scale': 1,
        'negative_prompt': '',

        'seed': -1,
        'add_bos_token': true,
        'truncation_length': 4096,
        'ban_eos_token': false,
        'skip_special_tokens': true,
        'stopping_strings': ["You: ",],
    }

    const payload = JSON.stringify(params)

    // make option_init but for axios
    const option_init_axios = {
        data: params,
    }

    const row = new MessageActionRow()
        .addComponents(
            new MessageButton()
                .setCustomId('deleteContext_' + message.id)
                .setLabel('Forget everything we have said')
                .setStyle('DANGER'),
        );

    const filter = i => i.customId === ('deleteContext_' + message.id) && i.user.id === message.author.id;

    const collector = message.channel.createMessageComponentCollector({ filter, time: 180000 });

    collector.on('collect', async i => {
        if (i.customId === 'deleteContext_' + message.id) {
            collector.stop()
            context_storage.delete(message.author.id)
            message.channel.send(`<@${message.author.id}> Let's start over shall we?`)
        }
    });

    try {
        is_generating = true
        // measure speed
        const start = Date.now()

        // axios POST request to the worker
        const res = await axios.post(`${WORKER_ENDPOINT}/api/v1/generate`, payload, option_init_axios)
        // get the first line with the word "Elaina" as the response
        console.log(res.data)
        const res_gen = res.data.results[0].text
        // get the first line with the word "Elaina" as the response
        const res_gen_lines = res_gen.split('\n')
        let res_gen_elaina = ''
        // clone the context to prevent mutation
        const context_check = [...context]
        for (let i = 0; i < res_gen_lines.length; i++) {
            if (res_gen_lines[i].includes('Elaina:')) {
                // skip all line already in the context
                if (context_check.includes(res_gen_lines[i].replace(/Elaina\:\s*/, '').trim())) {
                    //remove the line from the context_check
                    context_check.splice(context_check.indexOf(res_gen_lines[i].replace(/Elaina\:\s*/, '').trim()), 1)
                    continue
                }
                // get all line until next line starting with "You:" or end of the array
                for (let j = i; j < res_gen_lines.length; j++
                    
                    ) {
                    if (res_gen_lines[j].includes('You:') || res_gen_lines[j].includes('<END>'))
                        break
                    res_gen_elaina += res_gen_lines[j].replace(/Elaina\:\s*/, '') + '\n'
                }
                break
            }
        }
        if (res_gen_elaina === '') {
            message.channel.send({content: 'I can\'t think of a response for that.', components: [row]})
        }
        // add the response to the context
        context.push(res_gen_elaina.replace(/Elaina\:\s*/, '').trim())
        // store the context
        context_storage.set(message.author.id, context)
        is_generating = false

        // append message author mention to the response
        res_gen_elaina = `<@${message.author.id}> ${res_gen_elaina}`

        message.channel.send({ content: res_gen_elaina, components: [row] })
        console.log(`Time taken: ${Date.now() - start}ms`)

        
    } catch (err) {
        is_generating = false
        console.log(err)
        message.channel.send('Something went wrong. Please try again later.')
        return

    }
}

module.exports = {
    responseToMessage
}