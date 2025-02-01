const fs = require('fs');
const path = require('path');
const { Client, Collection, Intents } = require('discord.js');
const { byPassUser} = require('./config.json');
const { responseToMessage } = require('./event/on_message');
const databaseConnection = require('./database/database_connection');
const { listAllFiles } = require('./utils/common_helper');
const ComfyClient = require('./utils/comfy_client');

require('dotenv').config()

const token = process.env.DISCORD_BOT_TOKEN
globalThis.operating_mode = "6bit" // disabled, 4bit, vision, uncensored or 6bit
globalThis.sd_available = true
globalThis.can_change_model = true

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

client.commands = new Collection();
// recursively filter all js files in the commands folder (including file in subfolders)
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = listAllFiles(commandsPath).filter(file => file.endsWith('.js'));

console.log(commandFiles)
client.cooldowns = new Collection();
client.controlnet_config = new Map();
client.adetailer_config = new Map();
client.colorbalance_config = new Map();
client.boorugen_config = new Map();
client.usersetting_config = new Map();
client.img2img_upscale_config = new Map();
client.img2img_outpaint_config = new Map();
client.latentmod_config = new Map();
client.shipgirl_quiz_config = new Map();	
client.shipgirl_quiz_multi = new Map();
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
	if (!(interaction.isCommand() || interaction.isMessageContextMenu() || interaction.isSelectMenu())) return;

	if (interaction.isSelectMenu() && interaction.customId === 'legacy_model_picker') {
		await client.commands.get("wd_modelchange").selectModel(interaction, interaction.values[0], false)
		return;
	}

	const command = client.commands.get(interaction.commandName);

	if (!command) return;

	// if (interaction.user.id !== byPassUser) {
	// 	await interaction.reply({ content: 'Bot is in maintainance mode right now', ephemeral: true });
	// 	return;
	// }

	const forge_backend_require = [
		'wd_create', 
		'wd_img2img', 
		'wd_inpaint', 
		'wd_interrogate', 
		'wd_create_adv', 
		'wd_img2img_adv', 
		'wd_upscale', 
		'wd_rembg',
	]

	const comfy_backend_require = [
		'wd_img2model',
		'wd_txt2vid',
	]

	const no_backend_require = [
		'wd_controlnet', 
		'wd_adetailer', 
		'wd_boorugen',
		'wd_colorbalance',
		'wd_setting',
		'shipgirl',
		'shipgirl_config',
		'shipgirl_multi',
		'wd_script_outpaint',
		'wd_script_upscale',
		'wd_latentmod',
	]

	try {
		if ([
			...forge_backend_require,
			...comfy_backend_require,
			...no_backend_require
		].includes(interaction.commandName)) {

			const isEstimatedNotEnoughResource = (forge_backend_require.includes(interaction.commandName) && ComfyClient.promptListener.length > 0) ||
				(interaction.commandName === "wd_txt2vid" && ComfyClient.promptListener.length == 0 && ComfyClient.comfyStat.gpu_vram_used > 3.5) ||
				(interaction.commandName === "wd_img2model" && ComfyClient.promptListener.length == 0 && ComfyClient.comfyStat.gpu_vram_used > 6)

			if (isEstimatedNotEnoughResource) {
				await interaction.reply({ content: 'Not enough resource can be allocated to finish this command, please try again later', ephemeral: true });
				return;
			} 

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