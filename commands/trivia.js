const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs')
const { MessageEmbed } = require('discord.js');
const levenshtein = require('fast-levenshtein');

const weight = new Map()
let trivia_sum = 0

let category2FullnameMap = {
    'animal.txt': 'Animals',
    'animemanga.txt': 'Entertainment: Japanese Anime & Manga',
    'artnliterature.txt': 'Art and Literature',
    'boardgame.txt': 'Entertainment: Board Games',
    'cartoon.txt': 'Entertainment: Cartoon & Animations',
    'celeb.txt': 'Celebrities',
    'comic.txt': 'Entertainment: Comics',
    'dota2.txt': 'Video Game: DotA 2',
    'ff.txt': 'Video Game: Final Fantasy',
    'computer.txt': 'Science: Computers',
    'film.txt': 'Entertainment: Film',
    'gadget.txt': 'Science: Gadgets',
    'general.txt': 'General Knowledge',
    'geography.txt': 'Geography',
    'history.txt': 'History',
    'leagueoflegends.txt': 'Video Game: League of Legends',
    'math.txt': 'Science: Mathematics',
    'music.txt': 'Entertainment: Music',
    'myth.txt': 'Mythology',
    'pokemon.txt': 'Video Game: Pokemon',
    'science.txt': 'Science & Nature',
    'slogan.txt': 'Company Slogans',
    'sport.txt': 'Sports',
    'starwars.txt': 'Film: Star Wars',
    'television.txt': 'Entertainment: Television',
    'test.txt': 'Non-categorized',
    'theater.txt': 'Entertainment: Musicals & Theatres',
    'vehicle.txt': 'Vehicles',
    'videogame.txt': 'Entertainment: Video Games',
    'english.txt': 'The English Language',
    'logic.txt': 'Logical Reasoning',
}

function shuffle(input) {
    let temp; let rpick;
    for (let i = 0; i < input.length * 2; i++) {
        rpick = parseInt(Math.floor(Math.random() * input.length))
        temp = input[rpick];
        input[rpick] = input[i % input.length];
        input[i % input.length] = temp;
    }
}

function get_random_selection(fixed_cat = "") {
    //TODO: add fixed_question_type here and remove the clusterfuck below
    let res = null
    if (fixed_cat === "") {
        let selector = Math.floor(Math.random() * trivia_sum)
        weight.forEach((val, key) => {
            if (res) return
            if (selector >= val) {
                selector -= val
                return
            }
            res = {
                filename: key + '.txt',
                index: selector
            }
        })
    }
    else {
        //i did an oopsie
        fixed_cat = fixed_cat.replace('.txt', '')
        let selector = Math.floor(Math.random() * weight.get(fixed_cat))
        res = {
            filename: fixed_cat + '.txt',
            index: selector
        }
    }
    return res
}

function check_answer(answerer, correct_answers, startTimestamp) {
    const correct_answerer = []
    const near_correct_answerer = []

    answerer.forEach(entry => {
        for (const c_answer of correct_answers) {
            if (entry.content.toLowerCase() === c_answer.toLowerCase())
                correct_answerer.push(`- ${entry.author.username + "#" + entry.author.discriminator} - ${(entry.createdTimestamp - startTimestamp) / 1000}s`)
            else if (levenshtein.get(entry.content.toLowerCase(), c_answer.toLowerCase()) <= Math.floor(c_answer.length * 0.2))
                near_correct_answerer.push(`- ${entry.author.username + "#" + entry.author.discriminator} - ${(entry.createdTimestamp - startTimestamp) / 1000}s`)
        }
    })

    return {
        correct_answerer: correct_answerer,
        near_correct_answerer: near_correct_answerer
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trivia')
        .setDescription('Trivia for various subjects')
        .addIntegerOption(option =>
            option.setName('type')
                .setDescription('Specify the type of question used in the quiz')
                .addChoices(
                    { name: 'Multiple Choices', value: 1 },
                    { name: 'Short Answer', value: 2 },
                ))
        .addIntegerOption(option =>
            option.setName('category')
                .setDescription('Specify the category of question used in the quiz'))
    ,

    async init() {
        const files = fs.readdirSync('./resources/trivia_question')
        files.forEach(file => {
            let content = fs.readFileSync('./resources/trivia_question/' + file, { encoding: 'utf-8' })
            let question_count = content.split('\n').length
            weight.set(file.replace('.txt', ''), question_count)
            trivia_sum += question_count
        })
    }
    ,
    async execute(interaction) {

        const forced_type = interaction.options.getInteger('type')
        const cat = interaction.options.getInteger('category')

        await interaction.deferReply()

        let select_result = null

        if (cat) {
            select_result = get_random_selection(Object.keys(category2FullnameMap)[cat] || "")
        }
        else {
            select_result = get_random_selection()
        }

        //console.log(select_result)

        if (!select_result) {
            await interaction.editReply({ content: "I'm sorry I cannot find any question right now :(" })
            return
        }

        let data = fs.readFileSync('./resources/trivia_question/' + select_result.filename, { encoding: 'utf-8' })

        var all_question = data.split('\n');
        var avail_question = []

        let pick = null

        // console.log(all_question)

        if (forced_type) {
            //if force type we need to get all message within the specific type
            for (i in all_question) if (all_question[i].split(" | ")[1] == forced_type) avail_question.push(all_question[i])
            if (!avail_question[0]) {
                await interaction.editReply({ content: "No question of that type in this category, guess i need more question" });
                return;
            }
            else pick = avail_question[parseInt(Math.floor(Math.random() * avail_question.length))];
        }
        else {
            pick = all_question[select_result.index];
        }

        if (!pick) {
            await interaction.editReply({ content: "I'm sorry I cannot find any question right now :(" })
            return
        }

        let component = pick.split(" | ");

        let difficulty = parseInt(component[0]);
        let type = parseInt(component[1]);
        let img_link = component[2];
        let question = component[3];
        let common_correct_answer = []

        if (type === 1 || type === 3) {
            let correct_answer = component[4];
            let correct_index = null
            let answer = [];
            if (type == 1) {
                for (let i = 4; i < component.length; i++) answer.push(component[i]);
                shuffle(answer);
            }
            if (type == 3) {
                for (let i = 5; i < component.length; i++) answer.push(component[i]);
            }
            for (let i = 0; i < answer.length; i++) if (answer[i] == correct_answer) { correct_index = i; break; }
            var answer_string = ""
            for (let i = 0; i < answer.length; i++) answer_string += String.fromCharCode(65 + i) + ". " + answer[i] + "\n";

            const question_embeded = new MessageEmbed()
                .setDescription(difficulty + "★ - " + (category2FullnameMap[select_result.filename] || "Unknown") + " Question\n" + question)
                .setColor("#7BA137")
                .setAuthor({ name: "Trivia Question" })
                .addField("Answers", answer_string)
                .setFooter({text: "Your last message in this channel before timeout is your final answer"})

            if (img_link && img_link != "-") question_embeded.setImage(img_link)

            await interaction.editReply({ embeds: [question_embeded] })

            common_correct_answer.push(String.fromCharCode(65 + correct_index));
        }
        else if (type === 2) {
            for (let i = 4; i < component.length; i++) common_correct_answer.push(component[i]);

            const question_embeded = new MessageEmbed()
                .setDescription(difficulty + "★ - " + (category2FullnameMap[select_result.filename] || "Unknown") + " Question")
                .setColor("#7BA137")
                .setAuthor({ name: "Trivia Question" })
                .addField(question, "Please type out your answer (case insensitive)")
                .setFooter({text: "Your last message in this channel before timeout is your final answer"})

            if (img_link && img_link != "-") question_embeded.setImage(img_link)

            await interaction.editReply({ embeds: [question_embeded] })
        }

        const TIME_LIMIT = (type === 2) ? 7000 + (difficulty * 3000) : 5000 + (difficulty * 2000)

        let startTimestamp = new Date().valueOf()
        let answerer = new Map()

        const collector = interaction.channel.createMessageCollector({ time: TIME_LIMIT });

        collector.on('collect', m => {
            answerer.set(m.author.id, m)
        });

        collector.on('end', () => {
            const { correct_answerer, near_correct_answerer } = check_answer(answerer, common_correct_answer, startTimestamp)

            const result_embeded = new MessageEmbed()
                .setTitle('Result')
                .setDescription(`Answer: ${common_correct_answer[0]}` + ((common_correct_answer.length > 1) ? '\n' + `*Accepted answers are: ${common_correct_answer.join(', ')}*` : ''))

            let answerer_list = ""
            if (correct_answerer.length === 0) answerer_list = "None"
            else answerer_list = correct_answerer.join('\n')
            let near_answerer_list = ""
            if (near_correct_answerer.length === 0) near_answerer_list = "None"
            else near_answerer_list = near_correct_answerer.join('\n')

            result_embeded.addField('People who answered correctly:', answerer_list)
            result_embeded.addField('People whose answers are nearly correct (~80% match):', near_answerer_list)
            //console.log(`Collected ${collected.size} items`);
            interaction.followUp({ embeds: [result_embeded] })
        })
    }

}