require('dotenv').config()

const fs = require('fs');
const path = require('path');
const { Client, Collection, Intents } = require('discord.js');
const { configuredOwnerIds } = require('./chat/discord/permissions');
const { configureConversationService } = require('./event/on_message');
const databaseConnection = require('./database/database_connection');
const { listAllFiles } = require('./utils/common_helper');
const ComfyClient = require('./utils/comfy_client');
const { rateLimiter } = require('./utils/rate_limiter');
const { getForgeMemory, getForgeProgress, unloadForgeCheckpoint } = require('./utils/forge_api_execute');
const { createChatSubsystem } = require('./chat');
const chatComponents = require('./chat/discord/components');
const { loadImage } = require('./utils/load_discord_img');

const token = process.env.DISCORD_BOT_TOKEN
globalThis.operating_mode = "auto_local"
globalThis.llm_load_timer = null
globalThis.sd_available = true
globalThis.can_change_model = true

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.MESSAGE_CONTENT].filter(Boolean) });
let chatSubsystem = null;
let presenceTimer = null;
let shuttingDown = false;

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
client.kansenindex_sessions = new Map();
client.mapperatorinator_queue = []
client.mai_mod_queue = []
client.COOLDOWN_SECONDS = 30; // replace with desired cooldown time in seconds

console.log('current env', process.env.BOT_ENV)

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if (!command || !command.data || !command.execute) {
        console.log('skipped ' + file + ' (no data/execute export)')
        continue
    }
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
    presenceTimer = setInterval(() => {
        client.user.setPresence({
            activities: [{
                name: `Drawing: ${sd_available ? '✔' : '✖'} | Chatting: ${operating_mode !== 'disabled' ? '✔' : '✖'}`,
                type: 'PLAYING'
            }],
        });
    }, 1000 * 60 * 5)

});

client.on('messageCreate', async message => {
    if (!chatSubsystem || !message.guild) return;
    await chatSubsystem.service.intake(client, message).catch(error => {
        console.error('[Chat] Message handling failed:', error);
    });
});

client.on('messageDelete', message => {
    chatSubsystem?.service.invalidateDiscordMessage(message, 'discord_message_deleted').catch(error => console.error('[Chat] Message deletion invalidation failed:', error));
});

client.on('messageUpdate', (oldMessage, newMessage) => {
    chatSubsystem?.service.invalidateDiscordMessage(oldMessage.id ? oldMessage : newMessage, 'discord_message_edited').catch(error => console.error('[Chat] Message edit invalidation failed:', error));
});


client.on('interactionCreate', async interaction => {
    if ((interaction.isButton?.() || interaction.isSelectMenu?.()) && await chatComponents.handle(interaction)) return;
    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (command && command.autocomplete) {
            try { await command.autocomplete(interaction); } catch (e) { console.error(e); }
        }
        return;
    }

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
        'wd_img2vid',
    ]

    const mapperatorinator_backend_require = [
        'osu_mapperinator',
        'osu_mai_mod',
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
        'kansenindex',
        'wd_script_outpaint',
        'wd_script_upscale',
        'wd_latentmod',
    ]

    try {
        if ([
            ...comfy_backend_require,
            ...mapperatorinator_backend_require
        ].includes(interaction.commandName)) {
            const forgeMemory = await getForgeMemory();
            
            if (forgeMemory && forgeMemory.cuda && forgeMemory.cuda.system) {
                const freeCudaMemory = forgeMemory.cuda.system.free;
                const allocatedCudaMemory = forgeMemory.cuda.allocated.current;
                const GB = 1024 * 1024 * 1024;
                
                // Different VRAM requirements: Comfy needs 12GB, Mapperatorinator needs 6GB
                const requiredFreeVram = mapperatorinator_backend_require.includes(interaction.commandName) ? 6 * GB : 12 * GB;
                
                // If free CUDA memory < required and allocated > 2GB, attempt to unload
                if (freeCudaMemory < requiredFreeVram && allocatedCudaMemory > 2 * GB) {
                    const forgeProgress = await getForgeProgress();
                    
                    // Check if there's an active job
                    if (forgeProgress && forgeProgress.state && forgeProgress.state.job_count > 0) {
                        await interaction.channel.send({ 
                            content: 'Active forge backend job is running, cannot unload model to free up VRAM, please try again later'
                        });
                        return;
                    }
                    
                    // Attempt to unload checkpoint
                    console.log('[Bot] Attempting to unload Forge checkpoint to free VRAM...');
                    const unloadResult = await unloadForgeCheckpoint();
                    if (unloadResult !== null) {
                        console.log('[Bot] Forge checkpoint unloaded successfully');
                        // Wait a bit for VRAM to be freed
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }
        }
        
        if ([
            ...forge_backend_require,
            ...comfy_backend_require,
            ...no_backend_require,
            ...mapperatorinator_backend_require,
        ].includes(interaction.commandName)) {
            // Forge, ComfyUI, LM Studio, and Mapperatorinator submit through
            // the orchestrator proxy. Its admission decision is atomic at
            // dispatch time; consumer-side VRAM/busy checks are stale races.
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

async function start() {
    if (!token) throw new Error('DISCORD_BOT_TOKEN is required');
    const ownerIds = configuredOwnerIds();
    const db = await databaseConnection.initConnection();
    chatSubsystem = await createChatSubsystem({
        db,
        ownerIds,
        imageLoader: url => loadImage(url, false, true)
    });
    configureConversationService(chatSubsystem.service);
    chatComponents.configure({ chatService: chatSubsystem.service, repository: chatSubsystem.repository, ownerIds });
    for (const name of ['scene', 'memory', 'lore', 'chat_config', 'remove_channel_context']) {
        client.commands.get(name)?.configure?.({ chatService: chatSubsystem.service, repository: chatSubsystem.repository, ownerIds, status: chatSubsystem.status });
    }
    await client.login(token);
    databaseConnection.initElainaDB().catch(err => console.error('Failed to connect to Elaina DB:', err));
}

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Bot] Received ${signal}, shutting down gracefully...`);
    clearInterval(presenceTimer);
    await chatSubsystem?.stop().catch(error => console.error('[Chat] Shutdown failed:', error));
    rateLimiter.destroy();
    client.destroy();
    await databaseConnection.close();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => shutdown(signal).finally(() => process.exit(0)));
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Save rate limit data before potentially crashing
    rateLimiter.saveData();
});

console.log('[Bot] Rate limiting system initialized with persistent storage');
start().catch(error => {
    console.error('[Bot] Startup failed:', error);
    shutdown('startup failure').finally(() => process.exit(1));
});
