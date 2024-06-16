const fs = require('fs');
const path = require('path');
const { Client, Collection, Intents } = require('discord.js');
const { byPassUser} = require('./config.json');
const { responseToMessage } = require('./event/on_message');
const databaseConnection = require('./database/database_connection');
const { listAllFiles } = require('./utils/common_helper');

require('dotenv').config()

const token = process.env.DISCORD_BOT_TOKEN
globalThis.operating_mode = "6bit" // disabled, 4bit, vision, uncensored or 6bit
globalThis.sd_available = true

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

client.commands = new Collection();
// recursively filter all js files in the commands folder (including file in subfolders)
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = listAllFiles(commandsPath).filter(file => file.endsWith('.js'));

console.log(commandFiles)
client.cooldowns = new Collection();
client.controlnet_config = new Map();
client.adetailer_config = new Map();
client.boorugen_config = new Map();
client.COOLDOWN_SECONDS = 30; // replace with desired cooldown time in seconds

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);

	console.log('loaded ' + file)
	// Set a new item in the Collection
	// With the key as the command name and the value as the exported module
	client.commands.set(command.data.name, command);

	if (command.init) {
		try {
			console.log('+ additional initialization for ' + file)
			command.init()
		}
		catch (error) {
			console.log("error when initiate ", + file)
		}
	}
}

client.once('ready', () => {
	console.log('I\'m here');
	setInterval(() => {
		client.user.setPresence({
			activities: [{
				name: `Drawing: ${sd_available ? '✔' : '✖'} | Chatting: ${operating_mode === '6bit' ? '✔' : operating_mode !== 'disabled' ? '✖' : '△'}`,
				type: 'PLAYING'
			}],
		});
	}, 1000 * 60 * 5)

});

client.on('messageCreate', async message => {
	// if message doesnt mention the bot, return
	if (!message.mentions.has(client.user)) return;

	// ignore if it is in direct message
	if (!message.guild) return;

	// ignore if that mention is from a reply
	if (message.reference) return;

	// if message is from a bot, return
	if (message.author.bot) return;

	// remove the mention to the bot
	let content = message.content.replace(/<@!?\d+>/, '').trim();

	// if message is empty, return
	if (content.trim().length === 0) return;

	responseToMessage(client, message, content)

});


client.on('interactionCreate', async interaction => {
	if (!(interaction.isCommand() || interaction.isMessageContextMenu())) return;

	const command = client.commands.get(interaction.commandName);

	if (!command) return;

	// if (interaction.user.id !== byPassUser) {
	// 	await interaction.reply({ content: 'Bot is in maintainance mode right now', ephemeral: true });
	// 	return;
	// }

	try {
		if (['wd_create', 'wd_img2img', 'wd_inpaint', 'wd_interrogate', 'wd_upscale', 'wd_controlnet', 'wd_adetailer', 'wd_create_adv', 'wd_img2img_adv', 'wd_boorugen'].includes(interaction.commandName)) {
			await command.execute(interaction, client)
		}
		else {
			await command.execute(interaction);
		}
	} catch (error) {
		console.error(error);
		try {
			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
		}
		catch (error) {}
	}
});

client.login(token);

databaseConnection.initConnection(() => {
	console.log('database connection established');
})