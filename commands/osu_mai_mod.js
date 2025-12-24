const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { startInferenceMaiMod, streamOutput, uploadBeatmap, uploadAudio, getServerHealth, uploadBeatmapSet } = require('../utils/mapperinator_execute');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const comfyClient = require('../utils/comfy_client');
const mapsetVerifierClient = require('../utils/mapset_verifier_client');
const { parseMapsetVerifierHTML } = require('../utils/mapset_verifier_parser');
const fs = require('fs');

const server_address = process.env.BOT_ENV === 'lan' ? 'http://192.168.1.2:7051' : 'http://192.168.196.142:7051'

module.exports = {
    data: new SlashCommandBuilder()
        .setName('osu_mai_mod')
        .setDescription('Auto analyze beatmaps for osu! using MaiMod')
        .addAttachmentOption(option =>
            option.setName('beatmap_file')
                .setDescription('The .osu/.osz beatmap file to analyze')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('audio_file')
                .setDescription('The audio file used by the beatmap (REQUIRED if use .osu fule')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('show_raw_value')
                .setDescription('Show the numeric value beside the icon (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('ignore_suggestion')
                .setDescription('Omit suggestions (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('ignore_issue')
                .setDescription('Omit suggestions and issues, only show major issues (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('only_maimod')
                .setDescription('Only run MaiMod analysis, skip MapsetVerifier (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('only_mv')
                .setDescription('Only run MapsetVerifier, skip MaiMod (default: false)')
                .setRequired(false)),

    async init() {
        // setup heartbeat routine to check which server is alive
        mapsetVerifierClient.init();
    },

    getDifficultySelection(interaction, diffNames) {
        return new Promise(async (resolve, reject) => {
            const { MessageSelectMenu } = require('discord.js');
            
            const options = [
                {
                    label: 'General',
                    value: 'General',
                },
                ...diffNames.map(diff => ({
                    label: diff.name,
                    value: diff.name,
                }))
            ];

            const row = new MessageActionRow()
                .addComponents(
                    new MessageSelectMenu()
                        .setCustomId('difficulty_select_' + interaction.id)
                        .setPlaceholder('Select difficulties to analyze')
                        .setMinValues(1)
                        .addOptions(options)
                );

            const message = await interaction.channel.send({
                content: 'Please select which difficulties to analyze:',
                components: [row]
            });

            const filter = i => i.customId === 'difficulty_select_' + interaction.id && i.user.id === interaction.user.id;

            const collector = message.createMessageComponentCollector({ filter, time: 60000 });

            collector.on('collect', async i => {
                await i.deferUpdate();
                const selected = i.values;
                collector.stop();
                resolve(selected);
            });

            collector.on('end', collected => {
                if (collected.size === 0) {
                    reject(new Error('No difficulty selected (timed out)'));
                }
            });
        });
    },

    async execute_inference(interaction, params, client, msgRef = null) {
        console.log("Starting MaiMod task, Current queue length: " + client.mai_mod_queue.length);

        const { beatmap_path, show_raw_value, ignore_suggestion, ignore_issue, user_id, request_server_address } = params;

        // Check server health before starting
        const health = await getServerHealth(request_server_address).catch((err) => {
            console.log(err);
            return null;
        });

        const is_using_gpu = ['http://192.168.1.2:7051', 'http://192.168.196.142:7051'].includes(request_server_address);
        const is_gpu_having_enough_vram = comfyClient.comfyStat.gpu_vram_used < 8;

        if (!health || (health && is_using_gpu && !is_gpu_having_enough_vram)) {
            const row = new MessageActionRow()
                .addComponents(new MessageButton()
                    .setCustomId('cancelmaimod_' + interaction.id)
                    .setEmoji("<:nuke:338322910018142208>")
                    .setLabel('Cancel')
                    .setStyle('DANGER')
                );

            const filter = i => {
                return i.customId === 'cancelmaimod_' + interaction.id && i.user.id === user_id;
            };

            const message_content = { 
                content: `<@${user_id}> The server is currently under heavy load, analysis will be retried after 5 minutes`, 
                components: [row]
            };

            if (msgRef) {
                await msgRef.edit(message_content);
            } else {
                msgRef = await interaction.editReply(message_content);
            }

            msgRef.channel.awaitMessageComponent({ filter, time: 300000 })
                .then(async i => {
                    await i.update({ content: `<@${user_id}> Analysis cancelled.`, components: [] });
                    
                    // Remove from queue
                    const queueIndex = client.mai_mod_queue.findIndex(task => task.interaction.id === interaction.id);
                    if (queueIndex !== -1) {
                        client.mai_mod_queue.splice(queueIndex, 1);
                    }
                    
                    console.log("Task cancelled, Current queue length: " + client.mai_mod_queue.length);
                    
                    // Process next task
                    if (client.mai_mod_queue.length > 0) {
                        const nextTask = client.mai_mod_queue[0];
                        await this.execute_inference(nextTask.interaction, nextTask.params, client, msgRef);
                    }
                })
                .catch(err => {
                    console.log("Retrying MaiMod analysis after timeout...");
                    this.execute_inference(interaction, params, client, msgRef);
                });
            
            return;
        }

        try {
            console.log(`Beatmap uploaded to: ${beatmap_path.path}`);

            // Start inference
            await interaction.editReply({ content: 'Starting MaiMod inference...' });
            const inference_result = await startInferenceMaiMod(request_server_address, {
                beatmap_path: beatmap_path ? './temp/' + beatmap_path.path.replace(/\\/g, '/').split('/').slice(-2).join('/') : ''
            });

            if (inference_result.status !== 'success') {
                await interaction.editReply({ content: 'Failed to start inference: ' + (inference_result.message || 'Unknown error') });
                return;
            }

            console.log('Inference started successfully');
            await interaction.editReply({ content: 'MaiMod is processing your beatmap. This may take a while...' });

            // Stream output
            let full_output = '';

            await streamOutput(request_server_address, async (data) => {
                // Parse SSE format
                const lines = data.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const message = line.substring(6);
                        full_output += message + '\n';
                    } else if (line.startsWith('event: end')) {
                        console.log('Inference completed');
                        break;
                    } else if (line.startsWith('event: error_log')) {
                        const log_path = line.substring(18).trim();
                        console.log('Error log saved to:', log_path);
                        full_output += `\n[ERROR LOG SAVED: ${log_path}]\n`;
                    }
                }
            });

            // Trim output to start from "The first value between parentheses"
            const trim_marker = 'The first value between parentheses';
            const trim_index = full_output.indexOf(trim_marker);
            if (trim_index !== -1) {
                full_output = full_output.substring(trim_index);
            }

            // Parse BBCode output and convert to Discord embeds
            const parseBBCodeToDiscord = (text) => {
                // Replace [bold...](number)[/bold...] with emoji circles based on value
                text = text.replace(/\[bold[^\]]*\]\((\d+)\)\[\/bold[^\]]*\]/g, (match, number) => {
                    const num = parseInt(number);
                    let icon = '';
                    if (num > 100) {
                        icon = '🔴';
                    } else if (num > 10) {
                        icon = '🟡';
                    } else {
                        icon = '🔵';
                    }
                    
                    if (show_raw_value) {
                        return `${icon} - ${num}`;
                    }
                    return icon;
                });

                // Convert [link=osu://edit/...]text[/link] to markdown links with axer-url
                text = text.replace(/\[link=osu:\/\/edit\/([^\]]+)\]\[green\]([^\[]+)\[\/green\]\[\/link\]/g, (match, timestamp, displayText) => {
                    return `[${displayText}](https://axer-url.vercel.app/api/edit?time=${encodeURIComponent(timestamp)})`;
                });
                text = text.replace(/\[link=osu:\/\/edit\/([^\]]+)\]([^\[]+)\[\/link\]/g, (match, timestamp, displayText) => {
                    return `[${displayText}](https://axer-url.vercel.app/api/edit?time=${encodeURIComponent(timestamp)})`;
                });

                // Remove remaining BBCode tags
                text = text.replace(/\[green\]/g, '');
                text = text.replace(/\[\/green\]/g, '');
                text = text.replace(/\[bold[^\]]*\]/g, '');
                text = text.replace(/\[\/bold[^\]]*\]/g, '');

                return text;
            };

            // Split output into sections
            const sections = [];
            const lines = full_output.split('\n');
            let currentSection = null;
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                
                // Check if this is a section header (ends with :)
                if (trimmedLine && trimmedLine.endsWith(':') && !trimmedLine.startsWith(' ') && !trimmedLine.startsWith('[')) {
                    if (currentSection) {
                        sections.push(currentSection);
                    }
                    currentSection = {
                        name: trimmedLine.slice(0, -1), // Remove the trailing :
                        content: ''
                    };
                } else if (currentSection && trimmedLine) {
                    currentSection.content += trimmedLine + '\n';
                }
            }
            
            if (currentSection) {
                sections.push(currentSection);
            }

            // Convert sections to embed fields
            const embeds = [];
            let currentEmbed = new MessageEmbed()
                .setColor('#00ff00')
                .setTitle(params.diff_name + ' - MaiMod Analysis Results')
                .setDescription('Beatmap modification suggestions');
            
            let fieldCount = 0;
            let currentEmbedLength = (currentEmbed.title?.length || 0) + (currentEmbed.description?.length || 0);

            for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
                const section = sections[sectionIndex];
                
                // For the first section, use hardcoded legend
                if (sectionIndex === 0) {
                    let legendValue = '';
                    if (show_raw_value) {
                        legendValue = '🔴 (>100) is a major issue, 🟡 (>10) is likely an issue, and 🔵 is likely a subjective suggestion';
                        if (ignore_issue) {
                            legendValue = '🔴 (>100) is a major issue (suggestions and issues hidden)';
                        } else if (ignore_suggestion) {
                            legendValue = '🔴 (>100) is a major issue, 🟡 (>10) is likely an issue (suggestions hidden)';
                        }
                    } else {
                        legendValue = '🔴 is a major issue, 🟡 is likely an issue, and 🔵 is likely a subjective suggestion';
                        if (ignore_issue) {
                            legendValue = '🔴 is a major issue (suggestions and issues hidden)';
                        } else if (ignore_suggestion) {
                            legendValue = '🔴 is a major issue, 🟡 is likely an issue (suggestions hidden)';
                        }
                    }
                    
                    const fieldName = section.name;
                    const fieldValue = legendValue;
                    const fieldLength = fieldName.length + fieldValue.length;
                    
                    currentEmbed.addFields({ 
                        name: fieldName, 
                        value: fieldValue, 
                        inline: false 
                    });
                    fieldCount++;
                    currentEmbedLength += fieldLength;
                    continue;
                }
                
                let parsedContent = parseBBCodeToDiscord(section.content);
                
                // Filter content based on ignore options
                if (ignore_issue || ignore_suggestion) {
                    const contentLines = parsedContent.split('\n');
                    const filteredLines = contentLines.filter(line => {
                        if (ignore_issue) {
                            // Only keep red circle lines
                            return line.includes('🔴');
                        } else if (ignore_suggestion) {
                            // Keep red and yellow, exclude blue
                            return line.includes('🔴') || line.includes('🟡');
                        }
                        return true;
                    });
                    parsedContent = filteredLines.join('\n');
                }
                
                // Skip empty sections after filtering
                if (!parsedContent.trim()) {
                    continue;
                }
                
                const maxFieldLength = 1024;
                
                // Split content if it exceeds field limit
                if (parsedContent.length <= maxFieldLength) {
                    const fieldName = section.name;
                    const fieldValue = parsedContent || 'No issues found';
                    const fieldLength = fieldName.length + fieldValue.length;

                    if (fieldCount >= 25 || currentEmbedLength + fieldLength > 5800) {
                        embeds.push(currentEmbed);
                        currentEmbed = new MessageEmbed()
                            .setColor('#00ff00');
                        fieldCount = 0;
                        currentEmbedLength = 0;
                    }
                    
                    currentEmbed.addFields({ name: fieldName, value: fieldValue, inline: false });
                    fieldCount++;
                    currentEmbedLength += fieldLength;
                } else {
                    // Split into multiple fields
                    const chunks = [];
                    let currentChunk = '';
                    const contentLines = parsedContent.split('\n');
                    
                    for (const line of contentLines) {
                        if (currentChunk.length + line.length + 1 > maxFieldLength) {
                            chunks.push(currentChunk);
                            currentChunk = line + '\n';
                        } else {
                            currentChunk += line + '\n';
                        }
                    }
                    if (currentChunk) chunks.push(currentChunk);
                    
                    for (let i = 0; i < chunks.length; i++) {
                        const fieldName = i === 0 ? section.name : `${section.name} (cont.)`;
                        const fieldValue = chunks[i];
                        const fieldLength = fieldName.length + fieldValue.length;

                        if (fieldCount >= 25 || currentEmbedLength + fieldLength > 5800) {
                            embeds.push(currentEmbed);
                            currentEmbed = new MessageEmbed()
                                .setColor('#00ff00');
                            fieldCount = 0;
                            currentEmbedLength = 0;
                        }
                        
                        currentEmbed.addFields({ name: fieldName, value: fieldValue, inline: false });
                        fieldCount++;
                        currentEmbedLength += fieldLength;
                    }
                }
            }
            
            if (fieldCount > 0) {
                embeds.push(currentEmbed);
            }

            // Send embeds to Discord channel
            if (embeds.length === 0) {
                await interaction.channel.send({ 
                    content: `<@${user_id}> MaiMod processing completed but no issues were found!` 
                });
            } else if (embeds.length === 1) {
                await interaction.channel.send({ 
                    content: `<@${user_id}> MaiMod analysis completed!`,
                    embeds: [embeds[0]]
                });
            } else {
                // Discord supports up to 10 embeds per message
                await interaction.channel.send({ 
                    content: `<@${user_id}> MaiMod analysis completed!`,
                    embeds: embeds.slice(0, 10)
                });
                
                // If we have more than 10 embeds, send the rest in follow-up messages
                for (let i = 10; i < embeds.length; i += 10) {
                    await interaction.channel.send({ embeds: embeds.slice(i, i + 10) });
                }
            }

        } catch (error) {
            console.error('Error during MaiMod execution:', error);
            await interaction.editReply({ 
                content: 'An error occurred during MaiMod execution: ' + error.message 
            }).catch(err => console.log('Failed to send error message:', err));
        } finally {
            // Dequeue the current task
            client.mai_mod_queue.shift();
            
            console.log("Finished MaiMod task, Current queue length: " + client.mai_mod_queue.length);
            
            // Check if there is another task in the queue
            if (client.mai_mod_queue.length > 0) {
                const nextTask = client.mai_mod_queue[0];
                await this.execute_inference(nextTask.interaction, nextTask.params, client);
            }
        }
    },

    async execute_mapset_verifier(interaction, params, client) {
        console.log("Starting MapsetVerifier task");

        const { beatmapset_path, user_id, ignore_suggestion, ignore_issue, request_server_address, selected_difficulties } = params;

        try {
            // Check if mapsetVerifierClient is connected
            if (!mapsetVerifierClient.isConnected) {
                await interaction.editReply({ content: 'MapsetVerifier is not connected. Please try again later.' });
                return;
            }

            await interaction.editReply({ content: 'Starting MapsetVerifier analysis...' });

            // Create a promise to wait for the response
            const checkResult = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('MapsetVerifier request timed out'));
                }, 60000); // 60 second timeout

                // Store original handleMessage
                const originalHandleMessage = mapsetVerifierClient.handleMessage.bind(mapsetVerifierClient);

                // Override handleMessage to capture the response
                mapsetVerifierClient.handleMessage = function(data) {
                    const text = data.toString();
                    const RECORD_SEPARATOR = String.fromCharCode(0x1E);
                    const messages = text.split(RECORD_SEPARATOR);

                    for (const message of messages) {
                        if (!message.trim()) continue;

                        try {
                            const parsed = JSON.parse(message);

                            // Handle handshake response
                            if (Object.keys(parsed).length === 0) {
                                console.log('MapsetVerifier Handshake successful');
                                mapsetVerifierClient.isConnected = true;
                                continue;
                            }

                            // Check for UpdateChecks message
                            if (parsed.type === 1 && parsed.target === 'ServerMessage' && parsed?.arguments[0] === 'UpdateChecks') {
                                clearTimeout(timeout);
                                mapsetVerifierClient.handleMessage = originalHandleMessage;
                                resolve(parsed.arguments[1]);
                                return;
                            }
                        } catch (e) {
                            console.log('Failed to parse MapsetVerifier message:', message);
                        }
                    }
                };

                // Send the request
                mapsetVerifierClient.requestBeatmapset(beatmapset_path);
            });

            // Parse the HTML result
            const parsedResult = parseMapsetVerifierHTML(checkResult);
            // console.dir(parsedResult, { depth: null });

            // Convert to Discord embeds
            const mapsetEmbeds = [];
            let currentEmbed = null;
            let currentEmbedLength = 0;
            let totalMessageLength = 0; // Track total length across all embeds in current message batch
            let fieldCount = 0;
            
            for (const diffEntry of parsedResult.difficulties) {
                // Filter difficulties based on selection
                const shouldIncludeDiff = selected_difficulties.includes(diffEntry.difficulty)

                if (!shouldIncludeDiff) {
                    continue;
                }
                
                for (const category of diffEntry.categories) {
                    // Skip categories with no issues (all checks pass)
                    const hasIssues = category.checks.some(check => 
                        check.severity !== 'pass' || check.instances.some(inst => inst.severity !== 'pass')
                    );
                    
                    if (!hasIssues) continue;
                    
                    // Initialize new embed for this category
                    currentEmbed = new MessageEmbed()
                        .setColor(category.severity === 'major' ? '#ff0000' : category.severity === 'issue' ? '#ffaa00' : '#0099ff')
                        .setTitle(`${diffEntry.difficulty} - ${category.category}`)
                        .setDescription(`Overall: ${category.severity === 'major' ? '🔴 Major Issues' : category.severity === 'issue' ? '🟡 Issues' : '🔵 Minor/Suggestions'}`);
                    
                    currentEmbedLength = (currentEmbed.title?.length || 0) + (currentEmbed.description?.length || 0);
                    fieldCount = 0;
                    
                    for (const check of category.checks) {
                        // Skip checks with no issues
                        if (check.severity === 'pass' && check.instances.length === 0) continue;
                        if (check.severity === 'pass' && check.instances.every(inst => inst.severity === 'pass')) continue;
                        // ignore "Issues with updating or downloading." issue as the filename has been modified by the bot
                        if (check.name === 'Issues with updating or downloading.') continue;
                        
                        // Apply ignore filters
                        let shouldIncludeCheck = true;
                        if (ignore_issue) {
                            // Only include major issues
                            shouldIncludeCheck = check.severity === 'major' || check.instances.some(inst => inst.severity === 'major');
                        } else if (ignore_suggestion) {
                            // Include major and issue, exclude minor
                            shouldIncludeCheck = check.severity !== 'minor' && check.severity !== 'pass';
                            if (check.instances.length > 0) {
                                shouldIncludeCheck = shouldIncludeCheck || check.instances.some(inst => inst.severity === 'major' || inst.severity === 'issue');
                            }
                        }
                        
                        if (!shouldIncludeCheck) continue;
                        
                        // Determine emoji based on severity
                        let emoji = '';
                        if (check.severity === 'major' || check.instances.some(inst => inst.severity === 'major')) {
                            emoji = '🔴';
                        } else if (check.severity === 'issue' || check.instances.some(inst => inst.severity === 'issue')) {
                            emoji = '🟡';
                        } else {
                            emoji = '🔵';
                        }
                        
                        let fieldValue = ``;
                        
                        // Add instances if any
                        if (check.instances.length > 0) {
                            // Filter instances based on ignore options
                            let filteredInstances = check.instances;
                            if (ignore_issue) {
                                filteredInstances = check.instances.filter(inst => inst.severity === 'major');
                            } else if (ignore_suggestion) {
                                filteredInstances = check.instances.filter(inst => inst.severity === 'major' || inst.severity === 'issue');
                            }
                            
                            const visibleInstances = filteredInstances.slice(0, 5); // Limit to 5 instances
                            for (const instance of visibleInstances) {
                                let instEmoji = '';
                                if (instance.severity === 'major') {
                                    instEmoji = '🔴';
                                } else if (instance.severity === 'issue') {
                                    instEmoji = '🟡';
                                } else if (instance.severity === 'minor') {
                                    instEmoji = '🔵';
                                }
                                fieldValue += `${instEmoji} ${instance.text}\n`;
                            }
                            
                            if (filteredInstances.length > 5) {
                                fieldValue += `... and ${filteredInstances.length - 5} more\n`;
                            }
                        }
                        
                        // Discord field value limit is 1024 characters
                        if (fieldValue.length > 1024) {
                            fieldValue = fieldValue.substring(0, 1020) + '...';
                        }
                        
                        const fieldName = check.name || 'Check';
                        const fieldLength = fieldName.length + fieldValue.length;
                        
                        // Check if adding this field would exceed individual embed limit (5800 chars) or 25 fields per embed
                        if (currentEmbedLength + fieldLength > 5800 || fieldCount >= 25) {
                            // Save current embed and create new one
                            if (fieldCount > 0) {
                                mapsetEmbeds.push(currentEmbed);
                                totalMessageLength += currentEmbedLength;
                            }
                            
                            currentEmbed = new MessageEmbed()
                                .setColor(category.severity === 'major' ? '#ff0000' : category.severity === 'issue' ? '#ffaa00' : '#0099ff')
                                .setTitle(`MapsetVerifier: ${diffEntry.difficulty} - ${category.category} (continued)`)
                                .setDescription(`Overall: ${category.severity === 'major' ? '🔴 Major Issues' : category.severity === 'issue' ? '🟡 Issues' : '🔵 Minor/Suggestions'}`);
                            
                            currentEmbedLength = (currentEmbed.title?.length || 0) + (currentEmbed.description?.length || 0);
                            fieldCount = 0;
                        }
                        
                        currentEmbed.addFields({ 
                            name: fieldName, 
                            value: fieldValue, 
                            inline: false 
                        });
                        
                        currentEmbedLength += fieldLength;
                        fieldCount++;
                    }
                    
                    if (fieldCount > 0) {
                        mapsetEmbeds.push(currentEmbed);
                        totalMessageLength += currentEmbedLength;
                        currentEmbedLength = 0;
                        fieldCount = 0;
                    }
                }
            }

            // Send MapsetVerifier results to channel
            if (mapsetEmbeds.length === 0) {
                await interaction.channel.send({ 
                    content: `<@${user_id}> MapsetVerifier analysis completed! No issues found.` 
                });
            } else {
                // Split embeds into batches that don't exceed 6000 characters total per message
                const messageBatches = [];
                let currentBatch = [];
                let currentBatchLength = 0;
                
                for (const embed of mapsetEmbeds) {
                    // Calculate embed length (title + description + all fields)
                    let embedLength = (embed.title?.length || 0) + (embed.description?.length || 0);
                    for (const field of embed.fields || []) {
                        embedLength += (field.name?.length || 0) + (field.value?.length || 0);
                    }
                    
                    // Check if adding this embed would exceed 6000 chars or 10 embeds per message
                    if (currentBatch.length > 0 && (currentBatchLength + embedLength > 5800 || currentBatch.length >= 10)) {
                        messageBatches.push(currentBatch);
                        currentBatch = [];
                        currentBatchLength = 0;
                    }
                    
                    currentBatch.push(embed);
                    currentBatchLength += embedLength;
                }
                
                if (currentBatch.length > 0) {
                    messageBatches.push(currentBatch);
                }
                
                // Send the first batch with mention
                await interaction.channel.send({ 
                    content: `<@${user_id}> MapsetVerifier analysis completed!`,
                    embeds: messageBatches[0]
                });
                
                // Send remaining batches without mention
                for (let i = 1; i < messageBatches.length; i++) {
                    await interaction.channel.send({ 
                        embeds: messageBatches[i]
                    });
                }
            }

        } catch (error) {
            console.error('Error during MapsetVerifier execution:', error);
            await interaction.editReply({ 
                content: 'An error occurred during MapsetVerifier execution: ' + error.message 
            }).catch(err => console.log('Failed to send error message:', err));
        }
    },

    async execute(interaction, client) {
        await interaction.deferReply();

        // Get the beatmap file attachment
        const beatmap_file_attachment = interaction.options.getAttachment('beatmap_file');
        const audio_file_attachment = interaction.options.getAttachment('audio_file') || null;
        const show_raw_value = interaction.options.getBoolean('show_raw_value') || false;
        const ignore_suggestion = interaction.options.getBoolean('ignore_suggestion') || false;
        const ignore_issue = interaction.options.getBoolean('ignore_issue') || false;
        const only_maimod = interaction.options.getBoolean('only_maimod') || false;
        const only_mv = interaction.options.getBoolean('only_mv') || false;
        let beatmap_file = null;
        let audio_file = null;

        if (!beatmap_file_attachment) {
            await interaction.editReply({ content: 'Please provide a beatmap(set) file.' });
            return;
        }
        
        // Validate and fetch beatmap file
        if (!beatmap_file_attachment.name.endsWith('.osu') && !beatmap_file_attachment.name.endsWith('.osz')) {
            await interaction.editReply({ content: 'Please provide a valid .osz beatmap file.' });
            return;
        }

        if (!audio_file_attachment && !beatmap_file_attachment.name.endsWith('.osz')) {
            await interaction.editReply({ content: 'Please provide an audio file to accompany the .osu file.' });
            return;
        }
        
        try {
            const response = await (await fetch)(beatmap_file_attachment.url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            beatmap_file = Buffer.from(await response.arrayBuffer());
        } catch (err) {
            console.log(err);
            await interaction.editReply({ content: "Failed to retrieve beatmap file: " + err.message });
            return;
        }
        
        // Fetch audio file
        if (audio_file_attachment) {
            try {
                const response = await (await fetch)(audio_file_attachment.url);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                audio_file = Buffer.from(await response.arrayBuffer());
            } catch (err) {
                console.log(err);
                await interaction.editReply({ content: "Failed to retrieve audio file: " + err.message });
                return;
            }
        }

        const randomId = crypto.randomBytes(16).toString('hex');
        const audio_extension = audio_file_attachment?.name.split('.').pop() ?? 'mp3';
        const audio_filename = audio_file_attachment ? `audio_${randomId}.${audio_extension}` : 'audio.mp3';
        const beatmap_filename = `beatmap_${randomId}.osu`;

        // Check server health
        try {
            await getServerHealth(server_address);
        } catch (error) {
            await interaction.editReply({ content: 'MaiMod server is not available. Please make sure the server is running at ' + server_address });
            return;
        }

        // placeholder for uploaded beatmap path, beatmapset path and audio path
        let beatmap_path = null;
        let beatmapset_path = null;
        let audio_upload_result = null;
        const diff_names = [];

        if (beatmap_file_attachment.name.endsWith('.osz')) {
            // osz file handling
            await interaction.editReply({ content: 'Uploading beatmapset file...' });
            const beatmapset_filename = beatmap_file_attachment.name.substring(0, beatmap_file_attachment.name.lastIndexOf('.')) + `_${Date.now()}.osz`;
            beatmapset_path = await uploadBeatmapSet(server_address, beatmap_file, beatmapset_filename).catch((err) => {
                console.log(err);
                interaction.editReply({ content: "Failed to upload beatmapset file to AI server: " + err.message });
                return null;
            });

            if (!beatmapset_path) {
                await interaction.editReply({ content: 'Failed to upload beatmapset file to MaiMod server.' });
                return;
            }
            console.log(`Beatmapset uploaded: ${beatmapset_path.path}`);
        }
        else {
            // Upload audio file first
            await interaction.editReply({ content: 'Uploading audio file...' });
            audio_upload_result = await uploadAudio(server_address, audio_file, audio_filename, randomId).catch((err) => {
                console.log(err);
                interaction.editReply({ content: "Failed to upload audio file to AI server: " + err.message });
                return null;
            });
            
            if (!audio_upload_result) {
                await interaction.editReply({ content: 'Failed to upload audio file to MaiMod server.' });
                return;
            }
            
            console.log(`Audio uploaded: ${audio_upload_result.path}`);
            // Modify the beatmap file to use the uploaded audio filename
            let beatmap_content = beatmap_file.toString('utf-8');
            const audioFilenameRegex = /^AudioFilename:\s*.+$/m;
            
            if (audioFilenameRegex.test(beatmap_content)) {
                beatmap_content = beatmap_content.replace(audioFilenameRegex, `AudioFilename:${audio_filename}`);
                console.log(`Updated AudioFilename in .osu file to: ${audio_filename}`);
            } else {
                console.log('Warning: AudioFilename line not found in .osu file');
                await interaction.editReply({ content: 'Warning: Could not find AudioFilename in the .osu file. The beatmap may not work correctly.' });
            }
            
            beatmap_file = Buffer.from(beatmap_content, 'utf-8');
            
            // Upload modified beatmap file
            await interaction.editReply({ content: 'Uploading beatmap file...' });
            beatmap_path = await uploadBeatmap(server_address, beatmap_file, beatmap_filename, randomId).catch((err) => {
                console.log(err);
                interaction.editReply({ content: "Failed to upload beatmap file to AI server: " + err.message });
                return null;
            });

            if (!beatmap_path) {
                await interaction.editReply({ content: 'Failed to upload beatmap file to MaiMod server.' });
                return;
            }
        }

        if (!beatmap_path && !beatmapset_path) {
            await interaction.editReply({ content: 'No valid beatmap or beatmapset path available for processing.' });
            return;
        }

        // Read difficulty name from beatmap file
        // read the subfolder directory for .osu file
        const beatmap_subfolder = beatmapset_path?.path ? 
                                beatmapset_path.path.replace(/\\/g, '/') :
                                beatmap_path.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');

        const beatmaps_list = fs.readdirSync(beatmap_subfolder).filter(file => file.endsWith('.osu'));

        for (const file of beatmaps_list) {
            let diff_name = 'Unknown';
            let fetchAudioFilename = `${beatmap_subfolder}/audio.mp3`;

            // read each .osu file to get the Version field
            const file_path = `${beatmap_subfolder}/${file}`;
            const file_content = fs.readFileSync(file_path, 'utf-8');
            const versionMatch = file_content.match(/^Version:\s*(.+)$/m);
            const audioFilenameMatch = file_content.match(/^AudioFilename:\s*(.+)$/m);

            if (versionMatch) {
                diff_name = versionMatch[1].trim();
            }

            if (audioFilenameMatch) {
                fetchAudioFilename = `${beatmap_subfolder}/${audioFilenameMatch[1].trim()}`;
            }   

            diff_names.push({ name: diff_name, file: file_path, audio: fetchAudioFilename });
        }

        //console.log('Available difficulties:', diff_names);    
            
        // Get difficulty selection from user (unless only_maimod is true)
        let selected_difficulties = [diff_names[0].name]; // Default to just the difficulty for MaiMod
        if (beatmap_path) {
            await interaction.channel.send({ content: `.osu file is uploaded, skipping difficulty selection.` });
        }
        else {
            try {
                selected_difficulties = await this.getDifficultySelection(interaction, diff_names);
                console.log('Selected difficulties:', selected_difficulties);
            } catch (err) {
                console.log(err);
                await interaction.editReply({ content: 'Difficulty selection timed out or failed: ' + err.message });
                return;
            }
        }
        
        // Run MapsetVerifier
        if (!only_maimod) {
            const beatmapset_path_full = beatmap_subfolder
            const mapset_params = {
                beatmapset_path: beatmapset_path_full,
                user_id: interaction.user.id,
                ignore_suggestion: ignore_suggestion,
                ignore_issue: ignore_issue,
                request_server_address: server_address,
                selected_difficulties: selected_difficulties,
            };
            
            await this.execute_mapset_verifier(interaction, mapset_params, client);
        }

        // Run MaiMod if there is at least one difficulty selected that's not General (and only_mv is not enabled)
        const maimod_difficulties = selected_difficulties.filter(x => x !== 'General');
        
        if (!only_mv && maimod_difficulties.length > 0) {
            // Queue all selected difficulties for MaiMod processing
            const isQueueEmpty = client.mai_mod_queue.length === 0;
            
            for (const diff_name of maimod_difficulties) {
                // Find the corresponding beatmap path from diff_names
                const diff_info = diff_names.find(d => d.name === diff_name);
                
                if (!diff_info) {
                    console.log(`Warning: Could not find beatmap path for difficulty: ${diff_name}`);
                    continue;
                }
                
                // Use the already uploaded file path directly
                const params = {
                    beatmap_path: { path: diff_info.file },
                    show_raw_value: show_raw_value,
                    ignore_suggestion: ignore_suggestion,
                    ignore_issue: ignore_issue,
                    user_id: interaction.user.id,
                    request_server_address: server_address,
                    diff_name: diff_name,
                };
                
                client.mai_mod_queue.push({ interaction, params });
            }
            
            // If queue was empty, start processing immediately
            if (isQueueEmpty && client.mai_mod_queue.length > 0) {
                const firstTask = client.mai_mod_queue[0];
                await this.execute_inference(firstTask.interaction, firstTask.params, client);
            } else if (client.mai_mod_queue.length > 0) {
                await interaction.editReply({ 
                    content: `<@${interaction.user.id}> Your ${maimod_difficulties.length} difficulty(ies) have been queued for MaiMod. Current position: ${client.mai_mod_queue.length - maimod_difficulties.length + 1}` 
                });
            }
        } else {
            // If only General was selected, we're done
            await interaction.editReply({ content: 'Analysis complete!' });
        }
    },
};
