const fs = require('fs');
const path = require('path');
const { Client, Collection, Intents } = require('discord.js');

require('dotenv').config()

const token = process.env.DISCORD_BOT_TOKEN

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

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
});

client.on('interactionCreate', async interaction => {
	if (!interaction.isCommand()) return;

	const command = client.commands.get(interaction.commandName);

	if (!command) return;

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
	}
});

client.login(token);