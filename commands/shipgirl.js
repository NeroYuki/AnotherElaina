const { SlashCommandBuilder } = require('@discordjs/builders');
const shipgirl = require('../resources/shipgirl_quiz.json')
const { MessageEmbed } = require('discord.js');
const sharp = require('sharp');
const levenshtein = require('fast-levenshtein');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('shipgirl')
		.setDescription('Guess who is this ship girl')
		.addStringOption(option =>
			option.setName('category')
				.setDescription('Specify which series to be used for the quiz')
				.addChoices(
					{ name: 'Azur Lane', value: 'Azur Lane' },
					{ name: 'Kantai Collection', value: 'Kantai Collection' },
					{ name: 'Warship Girls R', value: 'Warship Girls R' },
					{ name: 'Akushizu Senki', value: 'Akushizu Senki' },
					{ name: 'Abyss Horizon', value: 'Abyss Horizon' },
					{ name: 'Black Surgenights', value: 'Black Surgenights' },
					{ name: 'Blue Oath', value: 'Blue Oath' },
					{ name: 'Velvet Code', value: 'Velvet Code' },
				))
		.addBooleanOption(option =>
			option.setName('hardmode')
				.setDescription('Image will be in silhouette instead, lol. Only work if a specific series is chosen')
			),

	async execute(interaction) {

		//parse option

		const category = interaction.options.getString('category')
		const isHardmode = interaction.options.getBoolean('hardmode') || false

		//make a temporary reply to not get timeout'd

		await interaction.deferReply();

		//select a question (randomly)

		let fr_name = ""
		let ship = {}

		let sum = 0
		const weight_array = shipgirl.map(x => {sum += x.count; return x.count});
		let selector = Math.floor(Math.random() * sum)

		if (!category) {
			//from random series
			let cur_entry = 0
			while (selector >= shipgirl[cur_entry].count) {
				selector -= shipgirl[cur_entry].count
				cur_entry += 1
			}
			fr_name = shipgirl[cur_entry].name
			ship = shipgirl[cur_entry].img[selector]
		}
		else {
			//from fixed series
			let fr_index = shipgirl.findIndex(val => val.name === category)
			if (fr_index !== -1) {
				fr_name = shipgirl[fr_index].name
				ship = shipgirl[fr_index].img[selector % shipgirl[fr_index].count]
			}
		}

		if (fr_name === "" || ship === {}) {
			await interaction.editReply({content: 'Sorry, i can\'t get a new quiz for you :('})
			return
		}
		
		//resize and blacken the image (if hardmode is selected)

		let img = null

		if (isHardmode && category) {
			img = await sharp(ship.filename)
				.resize({height: 512})
				.modulate({
					brightness: 0,
					saturation: 0,
				})
				.png()
				.toBuffer()
		}
		else {
			img = await sharp(ship.filename)
				.resize({height: 512})
				.png()
				.toBuffer()
		}

		if (!img) {
			await interaction.editReply({content: 'Sorry, i can\'t get a new quiz for you :('})
			return
		}

		//post the question
		
		const TIME_LIMIT = (ship.char.length > 10) ? 15 : 10

		const question_embeded = new MessageEmbed()
			.setColor('#0099ff')
			.setTitle('Question')
			.setDescription(`Who is this ship girl? You have ${TIME_LIMIT} seconds.`)
			.setImage('attachment://img.png')
			.setFooter({text: "Your last message in this channel before timeout is your final answer"});

		const result_embeded = new MessageEmbed()
			.setTitle('Result')
			.setDescription(`Answer: ${ship.char} from ${fr_name}`)

		await interaction.editReply({ embeds: [question_embeded], files: [
			{ attachment: img, name: 'img.png' } ]
		})

		//collect answerer

		let startTimestamp = new Date().valueOf()
		let answerer = new Map()

		const collector = interaction.channel.createMessageCollector({time: TIME_LIMIT * 1000 });

		collector.on('collect', m => {
			answerer.set(m.author.id, m)
		});

		collector.on('end', collected => {

			//check for right answers

			const correct_answerer = []
			const near_correct_answerer = []

			answerer.forEach(entry => {
				if (entry.content.toLowerCase() === ship.char.toLowerCase())
					correct_answerer.push(`- ${entry.author.username + entry.author.discriminator} - ${(entry.createdTimestamp - startTimestamp)/1000}s`)
				else if (levenshtein.get(entry.content.toLowerCase(), ship.char.toLowerCase()) <= Math.floor(ship.char.length * 0.2))
					near_correct_answerer.push(`- ${entry.author.username + entry.author.discriminator} - ${(entry.createdTimestamp - startTimestamp)/1000}s`)
			})
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
		});
	},
};