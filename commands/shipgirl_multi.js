const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');
const sharp = require('sharp');
const levenshtein = require('fast-levenshtein');
const { aggregateRecord } = require('../database/database_interaction');

function clamp(num, min, max) {
	return num <= min ? min : num >= max ? max : num;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('shipgirl_multi')
		.setDescription('Guess who is this shipgirl (multi-round mode)')
		.addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('Stop the current quiz'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('pause')
				.setDescription('Pause the current quiz'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('resume')
				.setDescription('Resume the current quiz'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('start')
				.setDescription('Start a new quiz')
				.addNumberOption(option =>
					option.setName('round')
						.setDescription('Number of rounds for the quiz (default to 10)')
						.setRequired(false))
				.addStringOption(option =>
					option.setName('scoring_mode')
						.setDescription('Specify the scoring mode for the quiz')
						.addChoices(
							{ name: 'Classic', value: 'Classic' },
							{ name: 'Speed', value: 'Speed' },
						))
				.addStringOption(option =>
					option.setName('category')
						.setDescription('Specify which series to be used for the quiz')
						.addChoices(
							{ name: 'Azur Lane', value: 'Azur Lane' },
							{ name: 'Kantai Collection', value: 'Kantai Collection' },
							{ name: 'Warship Girls R', value: 'Warship Girls R' },
							{ name: 'Axis Senki', value: 'Axis Senki' },
							{ name: 'Abyss Horizon', value: 'Abyss Horizon' },
							{ name: 'Black Surgenights', value: 'Black Surgenights' },
							{ name: 'Blue Oath', value: 'Blue Oath' },
							{ name: 'Velvet Code', value: 'Velvet Code' },
							{ name: 'Victory Belles', value: 'Victory Belles' },
							{ name: "Battleship Girl", value: "Battleship Girl" },
							{ name: "Battleship Bishoujo Puzzle", value: "Battleship Bishoujo Puzzle" },
						))
				.addBooleanOption(option =>
					option.setName('hardmode')
						.setDescription('Image will be in silhouette instead, lol. Only work if a specific series is chosen')
					)
				.addBooleanOption(option =>
					option.setName('base_only')
						.setDescription('No alernative outfits / forms will be included')
					)
				.addStringOption(option =>
					option.setName('nation')
						.setDescription('Specify which nation to be used for the quiz, might be incorrect')
						.addChoices(
							{ name: 'United Kingdom', value: 'United Kingdom' },
							{ name: 'United States', value: 'United States' },
							{ name: 'Japan', value: 'Japan' },
							{ name: 'Germany', value: 'Germany' },
							{ name: 'Soviet Union', value: 'Soviet Union' },
							{ name: 'Italy', value: 'Italy' },
							{ name: 'France', value: 'France' },
							{ name: 'Minor Power', value: 'Minor Power' },
							{ name: 'Fictional', value: 'Fictional' },
						)
					)
				.addStringOption(option =>
					option.setName('hull_type')
						.setDescription('Specify which hull type to be used for the quiz, might be incorrect')
						.addChoices(
							{ name: 'Destroyer', value: 'Destroyer' },
							{ name: 'Light Cruiser', value: 'Light Cruiser' },
							{ name: 'Heavy Cruiser', value: 'Heavy Cruiser' },
							{ name: 'Battlecruiser', value: 'Battlecruiser' },
							{ name: 'Battleship', value: 'Battleship' },
							{ name: 'Light Carrier', value: 'Light Carrier' },
							{ name: 'Aircraft Carrier', value: 'Aircraft Carrier' },
							{ name: 'Submarine', value: 'Submarine' },
							{ name: 'Aviation Battleship', value: 'Aviation Battleship' },
							{ name: 'Repair Ship', value: 'Repair Ship' },
							{ name: 'Monitor', value: 'Monitor' },
							{ name: 'Aviation Submarine', value: 'Aviation Submarine' },
							{ name: 'Large Cruiser', value: 'Large Cruiser' },
							{ name: 'Munition Ship', value: 'Munition Ship' },
							{ name: 'Guided Missile Cruiser', value: 'Guided Missile Cruiser' },
							{ name: 'Sailing Frigate', value: 'Sailing Frigate' },
							{ name: 'Aviation Cruiser', value: 'Aviation Cruiser' },
							{ name: 'Amphibious Assault Ship', value: 'Amphibious Assault Ship' },
							{ name: 'Coastal Defense Ship', value: 'Coastal Defense Ship' },
						)
					)
			)
	,

	async init() {},

	async execute(interaction, client) {

		let shipgirl_config = {}
		try {
			shipgirl_config = JSON.parse(client.shipgirl_quiz_config.get(interaction.user.id))
		}
		catch (e) {
			shipgirl_config = {}
		}

		/* multi-round quiz data format 
		key: user_id
		{
			round: number,
			current_round: number,
			category: string,
			hardmode: boolean,
			base_only: boolean,
			nation: string,
			hull_type: string,
			quiz: [
				{
					ship: string,
					fr_name: string,
					alias: string[]
				}
			],  // this will be fetched from the database at once
			scores: Map<user_id, number>
		}
		*/

		if (interaction.options.getSubcommand() === 'stop') {
			interaction.reply('Quiz will be stopped after this round')

			// resolve the quiz binded to the user
			client.shipgirl_quiz_multi.delete(interaction.user.id)
			return
		}
		if (interaction.options.getSubcommand() === 'pause') {
			const quiz_data = client.shipgirl_quiz_multi.get(interaction.user.id)
			if (quiz_data) {
				client.shipgirl_quiz_multi.set(interaction.user.id, {
					...quiz_data,
					is_paused: true
				})
				interaction.reply('Quiz will be paused after this round')
			}
			else {
				interaction.reply('There is no quiz to pause')
			}
			return
		}

		//parse option
		let quiz_data = null

		if (interaction.options.getSubcommand() === 'start') {
			let round = clamp(interaction.options.getNumber('round') || 10, 1, 100)
			const category = interaction.options.getString('category') || (shipgirl_config.category ? shipgirl_config.category : null)
			const isHardmode = interaction.options.getBoolean('hardmode') || (shipgirl_config.hardmode ? shipgirl_config.hardmode : false)
			const requireBase = interaction.options.getBoolean('base_only') || (shipgirl_config.base_only ? shipgirl_config.base_only : false)
			const nation = interaction.options.getString('nation') || (shipgirl_config.nation ? shipgirl_config.nation : null)
			const hull_type = interaction.options.getString('hull_type') || (shipgirl_config.hull_type ? shipgirl_config.hull_type : null)
			const scoring_mode = interaction.options.getString('scoring_mode') || 'Classic'

			//make a temporary reply to not get timeout'd

			await interaction.deferReply();

			//select a question (randomly)

			//let { fr_name, ship } = get_random_selection(category, requireBase)

			let db_query = {
				$and: []
			}

			const hardmode_allow_list = ['Azur Lane', 'Kantai Collection', 'Akushizu Senki', 'Abyss Horizon', 'Black Surgenights', 'Blue Oath', 'Velvet Code', 'Battleship Bishoujo Puzzle'] 

			const non_minor_power_nation = ['United Kingdom', 'United States', 'Japan', 'Germany', 'Soviet Union', 'Italy', 'France', 'Fictional']
		
			if (isHardmode) {
				// match folder against hardmode allow list
				db_query.folder = {$in: hardmode_allow_list}
			}
			if (category) {
				db_query.folder = category
			}
			if (nation) {
				if (nation === 'Minor Power') {
					db_query.$and.push({
						$or: non_minor_power_nation.map(val => {
							return {
								$not: {
									$or: [
										{nation: val},
										{nation: "? " + val}
									]
								}
							}
						}).concat([
							{nation: {$exists: false}}
						])
					})
				}
				else {
					db_query.$and.push({
						$or: [
							// any element in nation field is query.nation or query.nation with question mark
							{nation: nation},
							{nation: "? " + nation}
						]
					})
				}
			}
			if (hull_type) {
				db_query.$and.push({
					$or: [
						{ship_type: hull_type},
						{ship_type: "? " + hull_type}
					]
				})
			}
			if (requireBase) {
				db_query.is_base = true
			}
		
			// if db_query.$and is empty, remove it
			if (!db_query.$and.length) {
				delete db_query.$and
			}
		
			// console.dir(db_query, {depth: null})

			// make aggregate pipeline to get the random ship with the query
			const db_agg = [
				{$match: db_query},
				{$sample: {size: round}}
			]
		
			let query_res = await aggregateRecord('shipgirl', db_agg, /*use_ext*/ true)
				.catch(e => {
					console.log(e)
				})

			if (!query_res || query_res.length === 0) {
				await interaction.editReply({content: 'Sorry, i can\'t get a new quiz for you :('})
				return
			}

			if (query_res.length < round) {
				interaction.channel.send(`Only ${query_res.length} questions available, truncating the round to ${query_res.length}`)
				round = query_res.length
			}
			

			// let ship = {
			// 	char: query_res[0].char,
			// 	filename: './resources/shipgirls/' + query_res[0].folder + '/' + query_res[0].filename,
			// 	is_base: query_res[0].is_base
			// }
			// let fr_name = query_res[0].folder
			// let alias = query_res[0].alias || []
			// let alias_lowercase = alias.map(val => val.toLowerCase())

			// create the quiz multi object
			let quiz_data = {
				round: round,
				current_round: 0,
				category: category,
				hardmode: isHardmode,
				base_only: requireBase,
				nation: nation,
				hull_type: hull_type,
				scoring_mode: scoring_mode,
				quiz: query_res.map(val => {
					return {
						ship: {
							char: val.char,
							filename: './resources/shipgirls/' + val.folder + '/' + val.filename,
							is_base: val.is_base
						},
						fr_name: val.folder,
						alias: val.alias || [],
						alias_lowercase: (val.alias || []).map(val => val.toLowerCase())
					}
				}),
				scores: new Map(),
				is_paused: false
			}

			client.shipgirl_quiz_multi.set(interaction.user.id, quiz_data)
			interaction.editReply('Quiz starting now')
		}
		else if (interaction.options.getSubcommand() === 'resume') {
			const quiz_data = client.shipgirl_quiz_multi.get(interaction.user.id)
			if (quiz_data) {
				client.shipgirl_quiz_multi.set(interaction.user.id, {
					...quiz_data,
					is_paused: false
				})
				interaction.reply('Quiz resuming now')
			}
			else {
				interaction.reply('There is no quiz to resume')
			}
		}

		if (!quiz_data) {
			await interaction.channel.send('How does this happened?')
			return
		}

		for (let i = quiz_data.current_round; i < round; i++) {
			// check if the quiz is still active
			if (!client.shipgirl_quiz_multi.has(interaction.user.id)) {
				await interaction.channel.send('Quiz has been stopped')
				break;
			}
			if (client.shipgirl_quiz_multi.get(interaction.user.id).is_paused) {
				await interaction.channel.send('Quiz has been paused')
				break;
			}

			interaction.channel.send(`Next question (${i + 1}/${round})`)

			let { ship, fr_name, alias, alias_lowercase } = quiz_data.quiz[i]
			let img = null
			let img_base = null
			const cur_scores = quiz_data.scores

			//resize and blacken the image (if hardmode is selected)
			if (isHardmode) {
				img = await sharp(ship.filename)
					.resize({height: 512})
					
				img_base = await img.png()
					.toBuffer()

				img = await img.modulate({
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
				await interaction.channel.send('Error in processing image, skipping this question')
				continue
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
				.setDescription(`Answer: ${ship.char} from ${fr_name}
*Accepted answers:* ${[ship.char].concat(alias).join(', ')}`)

			let msgRef = await interaction.channel.send({ embeds: [question_embeded], files: [
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
				const correct_answerer_display = []
				const near_correct_answerer_display = []

				answerer.forEach(entry => {
					if (entry.content.toLowerCase() === ship.char.toLowerCase() || alias_lowercase.includes(entry.content.toLowerCase())) {
						correct_answerer.push([entry.author.username , (entry.createdTimestamp - startTimestamp)/1000])
						correct_answerer_display.push(`- ${entry.author.username} - ${(entry.createdTimestamp - startTimestamp)/1000}s`)
					}
					else if (levenshtein.get(entry.content.toLowerCase(), ship.char.toLowerCase()) <= Math.floor(ship.char.length * 0.2) 
						|| alias_lowercase.some(val => levenshtein.get(entry.content.toLowerCase(), val) <= Math.floor(val.length * 0.2))) {
						near_correct_answerer.push([entry.author.username , (entry.createdTimestamp - startTimestamp)/1000])
						near_correct_answerer_display.push(`- ${entry.author.username} - ${(entry.createdTimestamp - startTimestamp)/1000}s`)
					}
				})
				let answerer_list = ""
				if (correct_answerer_display.length === 0) answerer_list = "None"			
				else answerer_list = correct_answerer_display.join('\n')
				let near_answerer_list = ""
				if (near_correct_answerer_display.length === 0) near_answerer_list = "None"			
				else near_answerer_list = near_correct_answerer_display.join('\n')

				result_embeded.addField('People who answered correctly:', answerer_list)
				result_embeded.addField('People whose answers are nearly correct (~80% match):', near_answerer_list)

				if (isHardmode) {
					const new_question_embeded = question_embeded.setImage('attachment://img_base.png')
					msgRef.edit({ embeds: [new_question_embeded], files: [
						{ attachment: img_base, name: 'img_base.png' } ]
					})
				}

				//console.log(`Collected ${collected.size} items`);
				interaction.channel.send({ embeds: [result_embeded] })

				// add score
				// if scoring mode is classic, add 1 point for correct answer, 0.5 for near correct answer
				// if scoring mode is speed, add (TIME_LIMIT - time) * 2 / TIME_LIMIT point for correct answer, mulyiply by 0.5 for near correct answer
				const scores = quiz_data.scores

				correct_answerer.forEach(val => {
					const score_add = quiz_data.scoring_mode === 'Speed' ? (TIME_LIMIT - val[1]) * 2 / TIME_LIMIT : 1
					scores.set(val[0], (scores.get(val[0]) || 0) + score_add)
				})
				near_correct_answerer.forEach(val => {
					const score_add = quiz_data.scoring_mode === 'Speed' ? (TIME_LIMIT - val[1]) / TIME_LIMIT : 0.5
					scores.set(val[0], (scores.get(val[0]) || 0) + score_add)
				})
				answerer.forEach(val => {
					if (!correct_answerer.map(val => val[0]).includes(val.author.username) && !near_correct_answerer.map(val => val[0]).includes(val.author.username)) {
						scores.set(val.author.username, (scores.get(val.author.username) || 0) + 0)
					}
				})
			});

			// await until the collector ends
			await new Promise(resolve => {
				collector.on('end', resolve)
			})

			// post current score
			quiz_data.scores = cur_scores
			quiz_data.current_round = i + 1
			if (client.shipgirl_quiz_multi.has(interaction.user.id)) {
				const is_paused = quiz_data.is_paused
				client.shipgirl_quiz_multi.set(interaction.user.id, {
					...quiz_data,
					is_paused: is_paused
				})
			}

			let score_list = ""
			console.dir(cur_scores, {depth: null})
			if (cur_scores.size === 0) score_list = "None"
			else score_list = [...cur_scores].sort((a, b) => b[1] - a[1]).map((val, idx) => (idx === 0 ? '**' : '') + `${val[0]}: ${val[1].toFixed(2)}` + (idx === 0 ? '**' : '')).join('\n')
			const score_embeded = new MessageEmbed()
				.setTitle('Current Score')
				.setDescription(score_list)
				.setColor('#0099ff')

			await interaction.channel.send({ embeds: [score_embeded] })
			await new Promise(resolve => setTimeout(resolve, 1000))
		}

		// post final score
		let score_list = ""
		if (quiz_data.scores.size === 0) score_list = "None"
		else score_list = [...quiz_data.scores].sort((a, b) => b[1] - a[1]).map((val, idx) => (idx === 0 ? '**' : '') + `${val[0]}: ${val[1].toFixed(2)}` + (idx === 0 ? '**' : '')).join('\n')
		const score_embeded = new MessageEmbed()
			.setTitle('Final Score')
			.setDescription(score_list)
			.setColor('#55ff55')

		await interaction.channel.send({ embeds: [score_embeded] })
	},
};