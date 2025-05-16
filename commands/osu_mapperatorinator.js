const { SlashCommandBuilder } = require('@discordjs/builders');
const { loadImage } = require('../utils/load_discord_img');
const { uploadAudio, startInference, streamOutput, getBeatmap } = require('../utils/mapperinator_execute');
const NodeID3 = require('node-id3')
const crypto = require('crypto');
const fs = require('fs');
const archiver = require('archiver');
const { transliterate } = require('transliteration');

const server_address = 'http://192.168.196.142:7050'

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
                ))
        .addNumberOption(option =>
            option.setName('difficulty')
                .setDescription('The target (PC) star rating for the beatmap, default is 5'))
        .addNumberOption(option =>
            option.setName('sv')
                .setDescription('The slider multiplier for the beatmap, default is 1.4'))
        .addNumberOption(option =>
            option.setName('cs')
                .setDescription('The circle size for the beatmap, default is 4'))
        .addNumberOption(option =>
            option.setName('od')
                .setDescription('The overall difficulty for the beatmap, default is 8'))
        .addNumberOption(option =>
            option.setName('ar')
                .setDescription('The approach rate for the beatmap, default is 9'))
        .addNumberOption(option =>
            option.setName('hp')
                .setDescription('The health drain for the beatmap, default is 5'))
        .addStringOption(option =>
            option.setName('seed')
                .setDescription('The seed for the beatmap generation, default is None'))
        .addStringOption(option =>
            option.setName('mapper_id')
                .setDescription('The mapper id for the beatmap, default is None'))
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
                .setDescription('[ADVANCE] The CFG scale for the beatmap, default is 1.0'))
        .addNumberOption(option =>
            option.setName('temperature')
                .setDescription('[ADVANCE] The temperature for the beatmap, default is 1.0'))
        .addNumberOption(option =>
            option.setName('top_p')
                .setDescription('[ADVANCE] The top_p for the beatmap, default is 0.95'))
        .addBooleanOption(option =>
            option.setName('super_timing')
                .setDescription('[ADVANCE] Use super timing for the beatmap, default is true')
                .setRequired(false))


    ,

    async sendFinishBeatmap(msgRef, audio_file, audio_filename, beatmap_path, beatmap_info, user_id, image_file = null, image_filename = null) {
        // get the beatmap file name from the beatmap_path
        const resultMsgRef = await msgRef.channel.send({ content: `<@${user_id}> Beatmap generation finished, finalizing beatmap...` });

        const beatmap_file = await getBeatmap(server_address, beatmap_path).catch((err) => {
            console.log(err)
            resultMsgRef.edit({ content: "Failed to retrieve beatmap file", ephemeral: true });
            return
        })

        if (!beatmap_file) {
            return
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

        //console.log(beatmap_content)

        // create a zip file containing the beatmap and the audio file
        const zip = archiver('zip', {
            zlib: { level: 9 } // Sets the compression level.
        });

        const beatmap_filename = 'diff1.osu';
        const zip_filename = beatmap_info.artist.replace(/[^a-zA-Z0-9]/g, '_') + ' - ' + beatmap_info.title.replace(/[^a-zA-Z0-9]/g, '_') + '.osz';

        // create a write stream into a buffer to be attached to the message
        const output = fs.createWriteStream(`./temp/${zip_filename}`);

        zip.pipe(output);
        zip.on('error', (err) => {
            console.log(err);
            resultMsgRef.edit({ content: "Failed to create zip file", ephemeral: true });
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
            // send the zip file to the channel
            await resultMsgRef.edit({ content: `<@${user_id}> Beatmap finalizing finished, sending beatmap...`, files: [`./temp/${zip_filename}`] });
            // delete the zip file after sending
            fs.unlink(`./temp/${zip_filename}`, (err) => {
                if (err) {
                    console.log(err);
                }
                console.log('Zip file deleted');
            });
        }).catch((err) => {
            console.log(err);
            resultMsgRef.edit({ content: "Failed to create zip file", ephemeral: true });
            return
        });

    },

	async execute(interaction) {
        //make a temporary reply to not get timeout'd
        await interaction.deferReply();

        let audio_file_attachment = interaction.options.getAttachment('audio_file')
        let image_file_attachment = interaction.options.getAttachment('background') || null
        let user_id = interaction.user.id
        let image_file = null

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

        const options = {
            include: ['TIT2', 'TPE1'],    // only read the specified tags (default: all)
        }
        const tags = NodeID3.read(audio_file, options)

        const model = interaction.options.getString('model') || 'v30';
        const difficulty = interaction.options.getNumber('difficulty') || 5;
        const sv = interaction.options.getNumber('sv') || 1.4;
        const cs = interaction.options.getNumber('cs') || 4;
        const od = interaction.options.getNumber('od') || 8;
        const ar = interaction.options.getNumber('ar') || 9;
        const hp = interaction.options.getNumber('hp') || 5;
        const seed = interaction.options.getString('seed') || '';
        const mapper_id = interaction.options.getString('mapper_id') || '';
        const cfg_scale = interaction.options.getNumber('cfg_scale') || 1.0;
        const temperature = interaction.options.getNumber('temperature') || 1.0;
        const top_p = interaction.options.getNumber('top_p') || 0.95;
        const super_timing = interaction.options.getBoolean('super_timing') !== undefined ? interaction.options.getBoolean('super_timing') : true;

        const randomId = crypto.randomBytes(16).toString('hex');
        const audio_filename = `audio_${randomId}.${audio_file_attachment.name.split('.').pop()}`;
        const image_filename = image_file_attachment ? `image_${randomId}.${image_file_attachment.name.split('.').pop()}` : null;
        console.log("Audio filename: " + audio_filename)
        
        const audio_path_res = await uploadAudio(server_address, audio_file, audio_filename).catch((err) => {
            console.log(err)
            interaction.editReply({ content: "Failed to upload audio to AI server", ephemeral: true });
            return
        })

        if (!audio_path_res) {
            return
        }

        console.log("Audio uploaded: " + audio_path_res.path)
        console.log(tags)
        interaction.editReply({ content: "Audio uploaded: " + audio_path_res.path });

        const request_res = await startInference(server_address, {
            audio_path: './temp/' + audio_path_res.path.split('\\').pop(),
            output_path: './output',
            model: model,
            difficulty: difficulty,
            slider_multiplier: sv,
            circle_size: cs,
            seed: seed,
            mapper_id: mapper_id,
            cfg_scale: cfg_scale,
            temperature: temperature,
            top_p: top_p,
            super_timing: super_timing,
        }).catch((err) => {
            console.log(err)
            if (err.response && err.response.status === 409) {
                interaction.editReply({ content: "A beatmap generation is already in progress, please wait..." });
            }
            else {
                interaction.editReply({ content: "Failed to start inference: " + err.message});
            }
            return
        })

        if (!request_res) {
            return
        }
        interaction.editReply({ content: "Beatmap generation request success." });

        const process_msg = await interaction.channel.send({ content: "Beatmap generation started, please wait..." });

        streamOutput(server_address, (data) => {
            //console.log(data)
            process_msg.edit({ content: data ? `\`\`\`${data}\`\`\`` : "Beatmap is in progress, please wait..." });

            if (data.includes("Generated beatmap saved")) {
                const beatmap_path = data.split("Generated beatmap saved to ").pop().split("\n")[0].trim();
                this.sendFinishBeatmap(process_msg, audio_file, audio_filename, beatmap_path, {
                    artist: interaction.options.getString('artist') || tags['artist'] || 'Unknown Artist ' + Math.floor(Math.random() * 1000000),
                    title: interaction.options.getString('title') || tags['title'] || 'Unknown Title ' + Math.floor(Math.random() * 1000000),
                    od: od,
                    ar: ar,
                    hp: hp,
                }, user_id, image_file, image_filename).catch((err) => {
                    console.log(err)
                    return
                });
            }
        })
	},
};