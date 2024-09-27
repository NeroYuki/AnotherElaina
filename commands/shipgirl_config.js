const { SlashCommandBuilder } = require('@discordjs/builders');
const shipgirl = require('../resources/shipgirl_quiz.json')
const { MessageEmbed } = require('discord.js');
const sharp = require('sharp');
const levenshtein = require('fast-levenshtein');
const { aggregateRecord } = require('../database/database_interaction');
const base_shipgirl = []

const all_sum = shipgirl.reduce((pv, cv) => pv + cv.count, 0)
let base_sum = 0

function get_random_selection(category = null, require_base = false) {
	let fr_name = ""
	let ship = null

	let selector = 0
	if (!category) {
		//from random series
		let cur_entry = 0
		if (!require_base) {
			selector = Math.floor(Math.random() * all_sum)
			while (selector >= shipgirl[cur_entry].count) {
				selector -= shipgirl[cur_entry].count
				cur_entry += 1
			}
			fr_name = shipgirl[cur_entry].name
			ship = shipgirl[cur_entry].img[selector]
		}
		else {
			selector = Math.floor(Math.random() * base_sum)
			while (selector >= base_shipgirl[cur_entry].count) {
				selector -= base_shipgirl[cur_entry].count
				cur_entry += 1
			}
			fr_name = base_shipgirl[cur_entry].name
			ship = base_shipgirl[cur_entry].img[selector]
		}

	}
	else {
		//from fixed series
		let fr_index = shipgirl.findIndex(val => val.name === category)
		if (fr_index !== -1) {
			fr_name = shipgirl[fr_index].name
			if (!require_base) {
				selector = Math.floor(Math.random() * shipgirl[fr_index].count)
				ship = shipgirl[fr_index].img[selector]
			}
			else {
				selector = Math.floor(Math.random() * base_shipgirl[fr_index].count)
				ship = base_shipgirl[fr_index].img[selector]
			}
		}
	}

	return {
		ship: ship,
		fr_name: fr_name
	}
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('shipgirl_config')
		.setDescription('Configure the shipgirl quiz you want to play')
		.addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the shipgirl quiz config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the current shipgirl quiz config'))
        .addSubcommand(subcommand =>
			subcommand
				.setName('set')
				.setDescription('Setup the shipgirl quiz config')
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
							{ name: 'China', value: 'China' },
							{ name: 'Netherlands', value: 'Netherlands' },
							{ name: 'Russian Empire', value: 'Russian Empire' },
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

	async execute(interaction, client) {

		//parse option

		if (interaction.options.getSubcommand() === 'reset') {
            client.shipgirl_quiz_config.delete(interaction.user.id)
            await interaction.reply('shipgirl quiz config has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.shipgirl_quiz_config.get(interaction.user.id)
            if (config_string) {
				try {
					let config = JSON.parse(config_string)
                	await interaction.reply(`Current shipgirl quiz config:
Category: ${config.category || "Any"}
Hardmode: ${config.hardmode || false}
Base Only: ${config.base_only || false}
Nation: ${config.nation || "Any"}
Hull Type: ${config.hull_type || "Any"}`);
					}
				catch (error) {
					await interaction.reply('Current shipgirl quiz config is invalid');
				}
            }
            else {
                await interaction.reply('shipgirl quiz config has not been set');
            }
            return
        }

		const category = interaction.options.getString('category') || null
		const hardmode = interaction.options.getBoolean('hardmode') || false
		const base_only = interaction.options.getBoolean('base_only') || false
		const nation = interaction.options.getString('nation') || null
		const hull_type = interaction.options.getString('hull_type') || null

		const config = {
			category: category,
			hardmode: hardmode,
			base_only: base_only,
			nation: nation,
			hull_type: hull_type
		}

		const config_string = JSON.stringify(config)

		await interaction.reply("Shipgirl quiz config has been set");

		client.shipgirl_quiz_config.set(interaction.user.id, config_string);
	},
};