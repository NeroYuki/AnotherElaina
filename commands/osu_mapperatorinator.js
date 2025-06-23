const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageActionRow, MessageSelectMenu } = require('discord.js');
const { loadImage } = require('../utils/load_discord_img');
const { uploadAudio, startInference, streamOutput, getBeatmap, uploadBeatmap } = require('../utils/mapperinator_execute');
const NodeID3 = require('node-id3')
const crypto = require('crypto');
const fs = require('fs');
const archiver = require('archiver');
const { transliterate } = require('transliteration');
const { catboxFileUpload } = require('../utils/catbox_upload');
const { MessageEmbed } = require('discord.js');
const { all } = require('axios');
const { clamp } = require('../utils/common_helper');

const server_address = 'http://192.168.196.142:7050'

const all_descriptors = {
    "General": [
        { "value": "gimmick", "title": "Focused on a single unique design or gameplay idea." },
        { "value": "2B", "title": "Includes gameplay elements with two or more objects placed simultaneously." },
        { "value": "slider only", "title": "Restricts object choice to sliders only." },
        { "value": "circle only", "title": "Restricts object choice to circles only." },
        { "value": "swing", "title": "Uses 1/3, 1/6, and 1/12 snap divisors for most/all objects." }
    ],
    "Meta Information": [
        { "value": "collab", "title": "A map with two or more associated mappers." },
        { "value": "megacollab", "title": "A map with 8 or more associated mappers." },
        { "value": "marathon", "title": "A map with a drain time of over 5 minutes." },
        { "value": "gungathon", "title": "A map with a drain time of over 10 minutes." },
        { "value": "multi-song", "title": "Contains multiple songs within the audio." },
        { "value": "variable timing", "title": "Contains multiple timing points, usually for non-metronome songs." },
        { "value": "accelerating bpm", "title": "Features progressively increasing tempo." },
        { "value": "time signatures", "title": "Many changes or uncommon time signatures." },
        { "value": "storyboard", "title": "Contains a storyboard that enhances gameplay experience." },
        { "value": "storyboard gimmick", "title": "Uses storyboard elements that change how the map is played." },
        { "value": "keysounds", "title": "Uses various pitched hitsounds to create a melody." },
        { "value": "download unavailable", "title": "Cannot be downloaded from the osu! website." },
        { "value": "custom skin", "title": "Utilizes custom skin elements and graphics." },
        { "value": "featured artist", "title": "Features song(s) from osu!'s Featured Artist listing." },
        { "value": "custom song", "title": "Maps a song made specifically for the map." }
    ],
    "Style": [
        { "value": "messy", "title": "Visually chaotic and disorganised patterns." },
        { "value": "geometric", "title": "Incorporates geometric shapes within the design." },
        { "value": "grid snap", "title": "Objects are placed along a square grid." },
        { "value": "hexgrid", "title": "Objects are placed along a hexagonal grid." },
        { "value": "freeform", "title": "A loose approach to visual structure." },
        { "value": "symmetrical", "title": "Employs symmetry within the design." },
        { "value": "old-style revival", "title": "Emulates a style from early mapping." },
        { "value": "clean", "title": "Visually uncluttered and organised patterns." },
        { "value": "slidershapes", "title": "Uses a variety of slider designs." },
        { "value": "distance snapped", "title": "Uses osu's built-in distance snap feature." },
        { "value": "iNiS-style", "title": "Originates from the original DS games." },
        { "value": "avant-garde", "title": "Experimental design philosophies." },
        { "value": "perfect stacks", "title": "Features perfectly overlapped stacked notes." },
        { "value": "ninja spinners", "title": "Features very short spinners." }
    ],
    "Song Representation": [
        { "value": "simple", "title": "Accessible and straightforward design." },
        { "value": "chaotic", "title": "Unpredictable map design." },
        { "value": "repetition", "title": "Features recognizable identical patterns." },
        { "value": "progression", "title": "Gradual advancement in difficulty." },
        { "value": "high contrast", "title": "Uses flashy ideas to follow music changes." },
        { "value": "improvisation", "title": "Uses patterns that do not directly match the music." },
        { "value": "playfield usage", "title": "Deliberate use of the playfield." },
        { "value": "playfield constraint", "title": "Restricts object placement to a part of the playfield." },
        { "value": "video gimmick", "title": "References the background video in its patterning." },
        { "value": "difficulty spike", "title": "A sudden, significant challenge increase." },
        { "value": "low sv", "title": "Prominent low slider velocity usage." },
        { "value": "high sv", "title": "Prominent high slider velocity usage." },
        { "value": "colorhax", "title": "Intentional use of combo colors for immersion." }
    ],
    "Skillsets": [
        { "value": "tech", "title": "Tests uncommon skills." },
        { "value": "slider tech", "title": "Tests skills involving complex sliders." },
        { "value": "complex sv", "title": "Large changes in slider velocity to test reading." },
        { "value": "reading", "title": "Tests a player's reading skill." },
        { "value": "visually dense", "title": "Patterns with many visible notes that make reading hard." },
        { "value": "overlap reading", "title": "Overlapped objects obscure note order." }
    ],
    "Aim": [
        { "value": "jump aim", "title": "Focuses heavily on jumps." },
        { "value": "sharp aim", "title": "Heavy use of sharp angle movement." },
        { "value": "wide aim", "title": "Uses wide angle movement patterns." },
        { "value": "linear aim", "title": "Requires continuous straight movement." },
        { "value": "aim control", "title": "Features abrupt velocity or direction changes." },
        { "value": "flow aim", "title": "Encourages fully continuous cursor movement." },
        { "value": "precision", "title": "Requires fine, precise cursor movement." }
    ],
    "Tap": [
        { "value": "finger control", "title": "Tests complex tapping ability." },
        { "value": "complex snap divisors", "title": "Uses unusual snap divisors." },
        { "value": "bursts", "title": "Continuous alternating patterns, typically 9 notes or less." },
        { "value": "streams", "title": "Continuous alternating patterns, typically more than 9 notes." },
        { "value": "spaced streams", "title": "Streams with large spacing between notes." },
        { "value": "cutstreams", "title": "Streams with very uneven spacing." },
        { "value": "stamina", "title": "Tests endurance over long periods." }
    ],
    "Scene": [
        { "value": "aspire", "title": "Uses glitches for unique effects." },
        { "value": "mapping contest", "title": "An entry for a mapping contest." },
        { "value": "tournament custom", "title": "A custom map for a tournament." },
        { "value": "tag", "title": "Designed for multiplayer tag mode." },
        { "value": "port", "title": "Originally created for other media then imported." }
    ]
}

const descriptor_select = [
    all_descriptors["General"][0],
    all_descriptors["General"][2],
    all_descriptors["General"][3],
    all_descriptors["Style"][0],
    all_descriptors["Style"][1],
    all_descriptors["Style"][11],
    all_descriptors["Skillsets"][0],
    all_descriptors["Skillsets"][1],
    all_descriptors["Skillsets"][2],
    all_descriptors["Skillsets"][3],
    all_descriptors["Skillsets"][4],
    all_descriptors["Skillsets"][5],
    all_descriptors["Aim"][0],
    all_descriptors["Aim"][1],
    all_descriptors["Aim"][2],
    all_descriptors["Aim"][3],
    all_descriptors["Aim"][4],
    all_descriptors["Aim"][5],
    all_descriptors["Tap"][0],
    all_descriptors["Tap"][1],
    all_descriptors["Tap"][2],
    all_descriptors["Tap"][3],
    all_descriptors["Tap"][4],
    all_descriptors["Tap"][5],
]

const descriptor_options = descriptor_select.map(descriptor => {
    return {
        label: descriptor.value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()), // Capitalize the first letter of each word
        value: descriptor.value,
        description: descriptor.title
    };
}).concat(
    [{label: 'Custom', value: 'custom', description: 'Custom descriptor to be filled in after this'}]
)

const flatMap = (obj) => {
    return Object.keys(obj).reduce((acc, key) => {
        if (Array.isArray(obj[key])) {
            return acc.concat(obj[key].map(item => ({ ...item, category: key })));
        } else if (typeof obj[key] === 'object') {
            return acc.concat(flatMap(obj[key]).map(item => ({ ...item, category: key })));
        } else {
            return acc.concat({ value: key, title: obj[key], category: 'Other' });
        }
    }, []);
}

const valid_descriptor_values = flatMap(all_descriptors).map(item => item.value);

module.exports = {
	data: new SlashCommandBuilder()
		.setName('osu_mapperinator')
		.setDescription('Auto generate beatmaps for osu! using the osu!Mapperatorinator')
        .addAttachmentOption(option =>
            option.setName('audio_file')
                .setDescription('The audio file to use for the beatmap (discord limit is applied)')
                .setRequired(true))    
        .addStringOption(option =>
            option.setName('model')
                .setDescription('The model to use for the beatmap generation, default is v30')
                .addChoices(
                    { name: 'Mapperatorinator v30', value: 'v30' },
                    { name: 'Mapperatorinator v31', value: 'v31' },
                ))
        .addNumberOption(option =>
            option.setName('difficulty')
                .setDescription('The target (PC) star rating for the beatmap, value from 0-30, default is 5'))
        .addNumberOption(option =>
            option.setName('sv')
                .setDescription('The slider multiplier for the beatmap, value from 0.1-10, default is 1.4'))
        .addNumberOption(option =>
            option.setName('tick_rate')
                .setDescription('The slider tick rate for the beatmap, value from 0.5-8, default is 1'))
        .addNumberOption(option =>
            option.setName('cs')
                .setDescription('The circle size/key count for the beatmap, value from -10 to 13, default is 4'))
        .addNumberOption(option =>
            option.setName('od')
                .setDescription('The overall difficulty for the beatmap, value from 0-13, default is 8'))
        .addNumberOption(option =>
            option.setName('ar')
                .setDescription('The approach rate for the beatmap, value from -10 to 13, default is 9'))
        .addNumberOption(option =>
            option.setName('hp')
                .setDescription('The health drain for the beatmap, value from 0-10, default is 5'))
        .addStringOption(option =>
            option.setName('seed')
                .setDescription('The seed for the beatmap generation, default is None'))
        .addStringOption(option =>
            option.setName('mapper_id')
                .setDescription('The mapper id for the beatmap, default is None'))
        .addIntegerOption(option =>
            option.setName('year')
                .setDescription('Override the year style for the beatmap, default is None, only works for v31 model'))
        .addStringOption(option =>
            option.setName('gamemode')
                .setDescription('Override the gamemode for the beatmap, default is standard, only works for v31 model')
                .addChoices(
                    { name: 'Standard', value: '0' },
                    { name: 'Taiko', value: '1' },
                    { name: 'Catch the Beat', value: '2' },
                    { name: 'Mania', value: '3' },
                ))
        .addStringOption(option =>
            option.setName('artist')
                .setDescription('Override the artist for the beatmap, default is detected from the audio'))
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Override the title for the beatmap, default is detected from the audio'))
        .addAttachmentOption(option =>
            option.setName('background')
                .setDescription('The image file to use for the beatmap background (discord limit is applied)'))
        .addNumberOption(option =>
            option.setName('cfg_scale')
                .setDescription('[ADVANCE] The CFG scale for the beatmap, value from 0-20, default is 7.0'))
        .addNumberOption(option =>
            option.setName('temperature')
                .setDescription('[ADVANCE] The temperature for the beatmap, value from 0-5, default is 1.0'))
        .addNumberOption(option =>
            option.setName('top_p')
                .setDescription('[ADVANCE] The top_p for the beatmap, value from 0-1, default is 0.95'))
        .addBooleanOption(option =>
            option.setName('super_timing')
                .setDescription('[ADVANCE] Use super timing for the beatmap, default is false')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('add_hitsounds')
                .setDescription('Add hitsound into the map, default is true')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('descriptor_mode')
                .setDescription('Use descriptors for the beatmap, default is No Descriptor, only works for v31 model')
                .addChoices(
                    { name: 'No Descriptor', value: '0_0' },
                    { name: 'Only Descriptor', value: '1_0' },
                    { name: 'Only Negative Descriptor', value: '0_1' },
                    { name: 'Descriptor and Negative Descriptor', value: '1_1' },
                )
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('beatmap_file')
                .setDescription('Attach a beatmap to use v31\'s in-context mode, default is empty')
                .setRequired(false))
        .addNumberOption(option =>
            option.setName('hold_note_ratio')
                .setDescription('The rate of hold note in a mania beatmap, value from 0-1, default is 0.3 - 30%'))
        .addNumberOption(option =>
            option.setName('scroll_speed_ratio')
                .setDescription('The scroll speed ratio for catch and mania beatmap, value from 0-1, default is 0'))

    ,

    sendFinishBeatmap(msgRef, audio_file, audio_filename, beatmap_path, beatmap_info, user_id, image_file = null, image_filename = null) {
        // get the beatmap file name from the beatmap_path
        return new Promise(async (resolve, reject) => {
            const resultMsgRef = await msgRef.channel.send({ content: `<@${user_id}> Beatmap generation finished, finalizing beatmap...` });

            const beatmap_file = await getBeatmap(server_address, beatmap_path).catch((err) => {
                console.log(err)
                resultMsgRef.edit({ content: "Failed to retrieve beatmap file", ephemeral: true });
                return
            })

            if (!beatmap_file) {
                reject("Failed to retrieve beatmap file")
            }

            // check if artist and title have non-latin characters
            const artist_regex = /[^\x00-\x7F]/;
            const title_regex = /[^\x00-\x7F]/;

            if (artist_regex.test(beatmap_info.artist)) {
                beatmap_info.artist = transliterate(beatmap_info.artist);
            }
            if (title_regex.test(beatmap_info.title)) {
                beatmap_info.title = transliterate(beatmap_info.title);
            }

            // manually edit the beatmap content
            let beatmap_content = beatmap_file
            beatmap_content = beatmap_content.replace(/^Title:.*$/m, `Title:${beatmap_info.title}`);
            beatmap_content = beatmap_content.replace(/^TitleUnicode:.*$/m, `TitleUnicode:${beatmap_info.title}`);
            beatmap_content = beatmap_content.replace(/^Artist:.*$/m, `Artist:${beatmap_info.artist}`);
            beatmap_content = beatmap_content.replace(/^ArtistUnicode:.*$/m, `ArtistUnicode:${beatmap_info.artist}`);
            beatmap_content = beatmap_content.replace(/^Mode: None$/m, `Mode: 0`);
            beatmap_content = beatmap_content.replace(/^OverallDifficulty:.*$/m, `OverallDifficulty:${beatmap_info.od}`);
            beatmap_content = beatmap_content.replace(/^ApproachRate:.*$/m, `ApproachRate:${beatmap_info.ar}`);
            beatmap_content = beatmap_content.replace(/^HPDrainRate:.*$/m, `HPDrainRate:${beatmap_info.hp}`);
            if (image_file) {
                beatmap_content = beatmap_content.replace(/^\/\/Background and Video events.*$/m, `//Background and Video events
    0,0,"${image_filename}",0,0`);
            }
            // search for line starting with "Tags:" and append the following lines
            // BeatmapID:0
            // BeatmapSetID:-1
            // to the line below it
            beatmap_content = beatmap_content.replace(/^(Tags:.*)$/m, `$1
BeatmapID:0
BeatmapSetID:-1`);

            //console.log(beatmap_content)

            // create a zip file containing the beatmap and the audio file
            const zip = archiver('zip', {
                zlib: { level: 9 } // Sets the compression level.
            });

            // only filter out invalid characters for the filename
            const beatmap_filename = beatmap_info.artist.replace(/[\\/\\\:\*\?\"\<\>\|]/g, '') + ' - ' + beatmap_info.title.replace(/[\//\\\:\*\?\"\<\>\|]/g, '') + '_' + Date.now() + '.osu';
            const zip_filename = beatmap_info.artist.replace(/[\\/\\\:\*\?\"\<\>\|]/g, '') + ' - ' + beatmap_info.title.replace(/[\//\\\:\*\?\"\<\>\|]/g, '') + '_' + Date.now() + '.osz';

            // create a write stream into a buffer to be attached to the message
            const output = fs.createWriteStream(`./temp/${zip_filename}`);

            zip.pipe(output);
            zip.on('error', (err) => {
                console.log(err);
                resultMsgRef.edit({ content: "Failed to create zip file", ephemeral: true });
                reject(err);
                return
            });

            // append the beatmap file to the zip
            zip.append(Buffer.from(beatmap_content), { name: beatmap_filename });
            // append the audio file to the zip
            zip.append(audio_file, { name: audio_filename });
            // append the image file to the zip if it exists
            if (image_file) {
                zip.append(image_file, { name: image_filename });
            }
            // finalize the zip file
            zip.finalize().then(async () => {
                console.log('Zip file created');
                // check the size of the zip file
                const stats = fs.statSync(`./temp/${zip_filename}`);
                const fileSizeInBytes = stats.size;

                // if the zip file is larger than 9.9MB, upload it to catbox
                if (fileSizeInBytes > 9.9 * 1024 * 1024) {
                    let catbox_url = null

                    catbox_url = await catboxFileUpload(`./temp/${zip_filename}`).catch((err) => {
                        console.log(err);
                        resultMsgRef.edit({ content: "Failed to upload zip file to catbox", ephemeral: true });
                        return
                    })

                    if (!catbox_url) return

                    const embeded = new MessageEmbed()
                        .setColor('#00ff00')
                        .setTitle('Beatmap link')
                        .setDescription(`Here is your beatmap link: [${zip_filename}](${catbox_url})`)
                        .setFooter({ text: `Beatmap generated by Mapperatorinator` });

                    await resultMsgRef.edit({ content: `<@${user_id}> Beatmap finalization finished, beatmap size exceed 10MB, sending beatmap link...`, embeds: [embeded] });
                }
                else {
                    // send the zip file to the channel
                    await resultMsgRef.edit({ content: `<@${user_id}> Beatmap finalization finished, sending beatmap...`, files: [`./temp/${zip_filename}`] });
                }

                // delete the zip file after sending
                fs.unlink(`./temp/${zip_filename}`, (err) => {
                    if (err) {
                        console.log(err);
                    }
                    console.log('Zip file deleted');
                });

                resolve();
            }).catch((err) => {
                console.log(err);
                resultMsgRef.edit({ content: "Failed to create zip file", ephemeral: true });
                reject(err);
                return
            });
        })
    },

    async execute_inference(interaction, params, client) {
        console.log("Starting task, Current queue length: " + client.mapperatorinator_queue.length)
        const request_res = await startInference(server_address, {
            audio_path: './temp/' + params.audio_path_res.path.split('\\').pop(),
            beatmap_path: params.beatmap_path ? './temp/' + params.beatmap_path_res.path.split('\\').pop() : '',
            output_path: './output',
            model: params.model,
            difficulty: params.difficulty,
            slider_multiplier: params.sv,
            slider_tick_rate: params.tick_rate,
            circle_size: params.cs,
            hp_drain_rate: params.hp,
            approach_rate: params.ar,
            overall_difficulty: params.od,
            keycount: params.keycount,
            hold_note_ratio: params.hold_note_ratio,
            scroll_speed_ratio: params.scroll_speed_ratio,
            seed: params.seed,
            gamemode: params.gamemode,
            year: params.year,
            mapper_id: params.mapper_id,
            cfg_scale: params.cfg_scale,
            temperature: params.temperature,
            top_p: params.top_p,
            super_timing: params.super_timing,
            hitsounded: params.add_hitsounds,
            descriptors: params.descriptors || [],
            negative_descriptors: params.negative_descriptors || [],
            in_context_options: params.in_context_options || [],
        }).catch((err) => {
            console.log(err)
            if (err.response && err.response.status === 409) {
                interaction.channel.send({ content: "A beatmap generation is already in progress, please wait..." });
            }
            else {
                interaction.channel.send({ content: `<@${params.user_id}> Failed to start inference: ` + err.message});
            }
            return
        })

        if (!request_res) {
            return
        }

        const process_msg = await interaction.channel.send({ content: "Beatmap generation started, please wait..." });

        streamOutput(server_address, async (data) => {
            //console.log(data)
            process_msg.edit({ content: data ? `\`\`\`${data}\`\`\`` : "Beatmap is in progress, please wait..." });

            if (data.includes("Generated beatmap saved")) {
                const beatmap_path = data.split("Generated beatmap saved to ").pop().split("\n")[0].trim();
                await this.sendFinishBeatmap(process_msg, params.audio_file, params.audio_filename, beatmap_path, {
                    artist: params.artist || params.tags['artist'] || 'Unknown Artist ' + Math.floor(Math.random() * 1000000),
                    title: params.title || params.tags['title'] || 'Unknown Title ' + Math.floor(Math.random() * 1000000),
                    od: params.od,
                    ar: params.ar,
                    hp: params.hp,
                }, params.user_id, params.image_file, params.image_filename).catch((err) => {
                    console.log(err)
                    return
                }).finally(() => {
                    // dequeue the current task
                    client.mapperatorinator_queue.shift();
                    // check if there is another task in the queue
                    console.log("Finished task, Current queue length: " + client.mapperatorinator_queue.length)
                    if (client.mapperatorinator_queue.length > 0) {
                        this.execute_inference(client.mapperatorinator_queue[0].interaction, client.mapperatorinator_queue[0].params, client);
                    }
                })
            }
        }).catch((err) => {
            console.log(err)
            process_msg.edit({ content: `<@${params.user_id}> Connection to server dropped, terminating generation, please try again: ` + err.message });
            // dequeue the current task
            client.mapperatorinator_queue.shift();
            // check if there is another task in the queue
            console.log("Finished task, Current queue length: " + client.mapperatorinator_queue.length)
            if (client.mapperatorinator_queue.length > 0) {
                this.execute_inference(client.mapperatorinator_queue[0].interaction, client.mapperatorinator_queue[0].params, client);
            }
        });
    },

    getDescriptor(interaction) {
        return new Promise(async (resolve, reject) => {
            const select = new MessageSelectMenu()
                .setCustomId('mapperatorinator_descriptor_select')
                .setPlaceholder('Select descriptors')
                .setMinValues(1)
                .addOptions(descriptor_options);

            const row = new MessageActionRow()
                .addComponents(select);

            await interaction.editReply({ 
                content: "Please select the descriptors you want to use for the beatmap generation. You can also select 'Custom' to input your own descriptors.", 
                components: [row] 
            });

            const filter = i => {
                i.deferUpdate();
                return i.user.id === interaction.user.id;
            };

            interaction.channel.awaitMessageComponent({ filter, time: 180000 })
                .then(async i => {
                    if (i.values.includes('custom')) {
                        let current_descriptor = i.values.filter(v => v !== 'custom');
                        await i.channel.send({ content: "Please input your custom descriptors in the format of '<descriptor1>, <descriptor2>, ...' (for example: symmetrical, clean, tech)"});
                        const customFilter = m => m.author.id === interaction.user.id;
                        interaction.channel.awaitMessages({ filter: customFilter, max: 1, time: 300000, errors: ['time'] })
                            .then(async collected => {
                                const customDescriptors = collected.first().content.split(',').map(d => d.trim());
                                i.editReply({ content: "Custom descriptors received", components: [] });
                                resolve([...current_descriptor, ...customDescriptors]);
                            })
                            .catch(() => {
                                i.editReply({ content: "No custom descriptors received, using selected descriptors", components: [] });
                                resolve(i.values.filter(v => v !== 'custom'));
                            });
                    } else {
                        i.channel.send({ content: "Descriptors selected", components: [] });
                        resolve(i.values);
                    }
                })
                .catch((err) => {
                    console.log(err)
                    interaction.editReply({ content: "No descriptors selected, using default descriptors", components: [] });
                    resolve([]);
                });
        })
    },

    getNegativeDescriptor(interaction) {
        return new Promise(async (resolve, reject) => {
            const select = new MessageSelectMenu()
                .setCustomId('mapperatorinator_neg_descriptor_select')
                .setPlaceholder('Select negative descriptors')
                .setMinValues(1)
                .addOptions(descriptor_options);

            const row = new MessageActionRow()
                .addComponents(select);

            await interaction.editReply({ 
                content: "Please select the negative descriptors you want to use for the beatmap generation. You can also select 'Custom' to input your own negative descriptors.", 
                components: [row] 
            });

            const filter = i => {
                i.deferUpdate();
                return i.user.id === interaction.user.id;
            };

            interaction.channel.awaitMessageComponent({ filter, time: 180000 })
                .then(async i => {
                    if (i.values.includes('custom')) {
                        let current_descriptor = i.values.filter(v => v !== 'custom');
                        await i.channel.send({ content: "Please input your custom negative descriptors in the format of '<descriptor1>, <descriptor2>, ...' (for example: chaotic, messy, aspire)"});
                        const customFilter = m => m.author.id === interaction.user.id;
                        interaction.channel.awaitMessages({ filter: customFilter, time: 300000, errors: ['time'] })
                            .then(async collected => {
                                const customDescriptors = collected.first().content.split(',').map(d => d.trim());
                                // check if the custom descriptors are valid
                                for (const descriptor of customDescriptors) {
                                    if (!valid_descriptor_values.includes(descriptor)) {
                                        i.editReply({ content: `Invalid descriptor: ${descriptor}. Please use valid descriptors.`, components: [] });
                                        return resolve([]);
                                    }
                                }
                                // if all descriptors are valid, stop the collector and resolve the promise
                                i.editReply({ content: "Custom negative descriptors received", components: [] });
                                resolve([...current_descriptor, ...customDescriptors]);
                            })
                            .catch(() => {
                                i.editReply({ content: "No custom negative descriptors received, using selected descriptors", components: [] });
                                resolve(i.values.filter(v => v !== 'custom'));
                            });
                    } else {
                        i.channel.send({ content: "Negative descriptors selected", components: [] });
                        resolve(i.values);
                    }
                })
                .catch((err) => {
                    console.log(err)
                    interaction.editReply({ content: "No negative descriptors selected, using no descriptors", components: [] });
                    resolve([]);
                });
        })
    },

    getIncontextOption(interaction, is_v31 = true) {
        return new Promise(async (resolve, reject) => {
            const select = new MessageSelectMenu()
                .setCustomId('mapperatorinator_incontext_select')
                .setPlaceholder('Select in-context option')
                .addOptions([
                    {
                        label: 'Add Timing',
                        value: 'TIMING'
                    },
                ]);

            if (is_v31) {
                select.addOptions([
                    {
                        label: 'Add Kiai',
                        value: 'KIAI'
                    },
                    {
                        label: 'Make guest difficulty',
                        value: 'GD'
                    },
                    {
                        label: 'No Hitsound',
                        value: 'NO_HS'
                    },
                ]);
            }

            const row = new MessageActionRow()
                .addComponents(select);

            await interaction.editReply({ 
                content: "Please select the in-context option you want to use for the beatmap generation.", 
                components: [row] 
            });

            const filter = i => {
                i.deferUpdate();
                return i.user.id === interaction.user.id;
            };

            interaction.channel.awaitMessageComponent({ filter, time: 90000, errors: ['time'] })
                .then(i => {
                    resolve(i.values[0]);
                    i.editReply({ content: "In-context option selected", components: [] });
                })
                .catch((err) => {
                    console.log(err)
                    interaction.editReply({ content: "No in-context option selected, using default", components: [] });
                    resolve(null);
                });
        })
    },

	async execute(interaction, client) {
        //make a temporary reply to not get timeout'd
        await interaction.deferReply();

        let audio_file_attachment = interaction.options.getAttachment('audio_file')
        let image_file_attachment = interaction.options.getAttachment('background') || null
        let beatmap_file_attachment = interaction.options.getAttachment('beatmap_file') || null;
        let user_id = interaction.user.id
        let image_file = null
        let beatmap_file = null

        //download the image from attachment.proxyURL
        let audio_file = await loadImage(audio_file_attachment.proxyURL,
            /*getBuffer:*/ true, /*noDataURIHeader*/ false, /*safeMode*/ false).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to retrieve audio", ephemeral: true });
            return
        })

        if (image_file_attachment) {
            image_file = await loadImage(image_file_attachment.proxyURL,
                /*getBuffer:*/ true, /*noDataURIHeader*/ false, /*safeMode*/ false).catch((err) => {
                console.log(err)
                interaction.editReply({ content: "Failed to retrieve image", ephemeral: true });
                return
            })
        }

        if (beatmap_file_attachment) {
            beatmap_file = await loadImage(beatmap_file_attachment.proxyURL,
                /*getBuffer:*/ true, /*noDataURIHeader*/ false, /*safeMode*/ false).catch((err) => {
                console.log(err)
                interaction.editReply({ content: "Failed to retrieve beatmap file", ephemeral: true });
                return
            })
            // TODO: check if the beatmap file is valid osu! file
        }

        const options = {
            include: ['TIT2', 'TPE1'],    // only read the specified tags (default: all)
        }
        const tags = NodeID3.read(audio_file, options)

        const model = interaction.options.getString('model') || 'v30';
        const difficulty = clamp(interaction.options.getNumber('difficulty') || 5, 0, 30);
        const sv = clamp(interaction.options.getNumber('sv') || 1.4, 0.1, 10);
        const tick_rate = clamp(interaction.options.getNumber('tick_rate') || 1, 0.5, 8);
        const cs = clamp(interaction.options.getNumber('cs') || 4, -10, 13)
        const od = clamp(interaction.options.getNumber('od') || 8, 0, 13);
        const ar = clamp(interaction.options.getNumber('ar') || 9, -10, 13);
        const hp = clamp(interaction.options.getNumber('hp') || 5, 0, 10);
        const seed = interaction.options.getString('seed') || '';
        const mapper_id = interaction.options.getString('mapper_id') || '';
        const gamemode = interaction.options.getString('gamemode') || '0'; // default to Standard
        const year = interaction.options.getInteger('year') || null;
        let cfg_scale = interaction.options.getNumber('cfg_scale') || null;
        const temperature = clamp(interaction.options.getNumber('temperature') || 1.0, 0, 5);
        const top_p = clamp(interaction.options.getNumber('top_p') || 0.95, 0, 1);
        const super_timing = interaction.options.getBoolean('super_timing') !== null ? interaction.options.getBoolean('super_timing') : false;
        const artist = interaction.options.getString('artist') || null;
        const title = interaction.options.getString('title') || null;
        const add_hitsounds = interaction.options.getBoolean('add_hitsounds') !== null ? interaction.options.getBoolean('add_hitsounds') : true;
        const descriptor_mode = interaction.options.getString('descriptor_mode') || '0_0'; // default to 'No Descriptor'
        const hold_note_ratio = clamp(interaction.options.getNumber('hold_note_ratio') || 0.3, 0, 1); // only works for mania
        const scroll_speed_ratio = clamp(interaction.options.getNumber('scroll_speed_ratio') || 0, 0, 1); // only works for mania
        const use_descriptors = descriptor_mode.startsWith('1_') ? true : false; // if the first part is '1', use descriptors
        const use_negative_descriptors = descriptor_mode.endsWith('_1') ? true : false; // if the second part is '1', use negative descriptors
        const keycount = gamemode === '3' ? clamp(cs, 0, 10) : 1
        let descriptor = []
        let negative_descriptor = []
        let in_context_option = []

        console.log(super_timing, add_hitsounds)

        const randomId = crypto.randomBytes(16).toString('hex');
        const audio_filename = `audio_${randomId}.${audio_file_attachment.name.split('.').pop()}`;
        const beatmap_filename = beatmap_file_attachment ? `beatmap_${randomId}.${beatmap_file_attachment.name.split('.').pop()}` : null;
        const image_filename = image_file_attachment ? `image_${randomId}.${image_file_attachment.name.split('.').pop()}` : null;
        //console.log("Audio filename: " + audio_filename)

        if (model === 'v31') {
            if (use_descriptors) {
                descriptor = await this.getDescriptor(interaction).catch((err) => {
                    console.log(err)
                    interaction.editReply({ content: "Failed to get descriptors", ephemeral: true });
                    return
                });
            }
            if (use_negative_descriptors) {
                negative_descriptor = await this.getNegativeDescriptor(interaction).catch((err) => {
                    console.log(err)
                    interaction.editReply({ content: "Failed to get negative descriptors", ephemeral: true });
                    return
                });
            }
        }

        if (beatmap_file) {
            // if the beatmap file is provided, use it for in-context mode
            in_context_option = await this.getIncontextOption(interaction, model === 'v31').catch((err) => {
                console.log(err)
                interaction.editReply({ content: "Failed to get in-context option", ephemeral: true });
                return
            });
            if (in_context_option === null) {
                interaction.editReply({ content: "No in-context option selected, using default", ephemeral: true });
                in_context_option = [];
            }
        }

        console.log(descriptor, negative_descriptor)

        if (cfg_scale === null) {
            if (mapper_id || year || descriptor.length > 0 || negative_descriptor.length > 0) {
                // if mapper_id or year or descriptor is set, set cfg_scale to 2.0
                cfg_scale = 2.0;
                interaction.channel.send({ content: "mapper_id or year or descriptor token found, setting CFG scale to 2.0 for better results" });
            }
            else {
                // if cfg_scale is not set, set it to 1.0
                cfg_scale = 1.0;
            }
        }
        cfg_scale = clamp(cfg_scale, 0, 20);
        
        const audio_path_res = await uploadAudio(server_address, audio_file, audio_filename).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to upload audio to AI server", ephemeral: true });
            return
        })

        if (!audio_path_res) {
            return
        }

        console.log("Audio uploaded: " + audio_path_res.path)
        //console.log(tags)
        //interaction.editReply({ content: "Audio uploaded: " + audio_path_res.path });

        const beatmap_path_res = beatmap_file ? await uploadBeatmap(server_address, beatmap_file, beatmap_filename).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to upload beatmap file to AI server", ephemeral: true });
            return
        }) : null

        const params = {
            audio_file: audio_file,
            audio_filename: audio_filename,
            audio_path_res: audio_path_res,
            model: model,
            difficulty: difficulty,
            sv: sv,
            tick_rate: tick_rate,
            cs: cs,
            keycount: keycount,
            od: od,
            ar: ar,
            hp: hp,
            hold_note_ratio: hold_note_ratio,
            scroll_speed_ratio: scroll_speed_ratio,
            seed: seed,
            gamemode: gamemode,
            year: year,
            mapper_id: mapper_id,
            cfg_scale: cfg_scale,
            temperature: temperature,
            top_p: top_p,
            super_timing: super_timing,
            add_hitsounds: add_hitsounds,
            descriptors: descriptor,
            negative_descriptors: negative_descriptor,
            in_context_options: in_context_option,
            artist: artist,
            title: title,
            tags: tags,
            image_file: image_file,
            image_filename: image_filename,
            user_id: user_id,
            beatmap_file: beatmap_file,
            beatmap_filename: beatmap_filename,
            beatmap_path_res: beatmap_path_res,
        }

        if (client.mapperatorinator_queue.length == 0) {
            // if the queue is empty, add to queue and immediately start the inference
            interaction.editReply({ content: "Beatmap generation request success. Beatmap will start generate immediately" });

            client.mapperatorinator_queue.push({
                interaction: interaction,
                params: params,
            })
            this.execute_inference(interaction, params, client)
        }
        else {
            // if the queue is not empty, check if interaction author user_id exists in the queue before add to queue and wait for the next turn
            for (let i = 0; i < client.mapperatorinator_queue.length; i++) {
                if (client.mapperatorinator_queue[i].params.user_id == user_id) {
                    interaction.editReply({ content: "You already have a beatmap generation in progress, please wait..." });
                    return
                }
            }
            interaction.editReply({ content: "Beatmap generation request success. You are in queue position: " + (client.mapperatorinator_queue.length + 1) });

            client.mapperatorinator_queue.push({
                interaction: interaction,
                params: params,
            })
        }
	},
};