const fs = require('fs');
const path = require('path');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { clientId, guildIds } = require('./config.json');

require('dotenv').config()

let args = process.argv.slice(2)
let isGlobal = false
let doClear = false

if (args[0] === "--global") isGlobal = true
if (args[0] === "--clean") doClear = true

const token = process.env.DISCORD_BOT_TOKEN
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

if (!doClear) {
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if (!isGlobal) command.data.description += " (Debug)"
		commands.push(command.data.toJSON());
	}
}

// console.log(commands)

const rest = new REST({ version: '9' }).setToken(token);

if (isGlobal) {
	console.log('deploying commands to global...')
	rest.put(Routes.applicationCommands(clientId), { body: commands })
		.then(() => console.log('Successfully registered application commands.'))
		.catch(console.error);
}
else {
	console.log('deploying commands to test servers...')
	guildIds.forEach(guildId => {
		rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
			.then(() => console.log('Successfully registered application commands.'))
			.catch(console.error);
	})
}
