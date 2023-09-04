const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { queryRecordLimit, aggregateRecord } = require('../database/database_interaction');

// convert hsv(360, 1, 1) to rgb hex string
function hsvToRgb(h, s, v) {
    let r, g, b, i, f, p, q, t;
    h /= 360;
    s /= 1;
    v /= 1;
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);

    switch(i % 6){
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }

    // convert to hex string
    r = Math.round(r * 255).toString(16);
    g = Math.round(g * 255).toString(16);
    b = Math.round(b * 255).toString(16);

    // pad with 0
    if (r.length == 1) {
        r = '0' + r;
    }
    if (g.length == 1) {
        g = '0' + g;
    }
    if (b.length == 1) {
        b = '0' + b;
    }

    return '#' + r + g + b;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

module.exports = {
	data: new SlashCommandBuilder()
        .setName('spotify_genre')
        .setDescription('Get a random genre from Spotify, or a specific genre')
        .addStringOption(option =>
            option.setName('genre')
                .setDescription('The genre to get')
                .setRequired(false)),
    
    async execute(interaction) {
        // make a temporary reply to not get timeout'd
        await interaction.deferReply();

        const genre = interaction.options.getString('genre')

        // query the database
        const result = await aggregateRecord('spotify_genres', [
            {
              $match:
                /**
                 * query: The query in MQL.
                 */
                {
                  genre: {
                    $regex: escapeRegExp(genre || ""),
                    $options: "i",
                  },
                },
            },
            {
              $sample:
                /**
                 * size: The number of documents to sample.
                 */
                {
                  size: 1,
                },
            },
        ])

        // check if the genre exists
        if (result.length == 0) {
            await interaction.editReply(`Genre ${genre} does not exist`);
            return;
        }

        // compose the reply
        const data = result[0];

        const embed = new MessageEmbed()
            .setColor(hsvToRgb(...data.color))
            .setTitle(data.genre)
            .setDescription(data.desc)
            // add fields for organic_index, atmospheric_index, popularity
            .addFields(
                { name: 'Organic Index', value: data.organic_index.toFixed(3), inline: true },
                { name: 'Atmospheric Index', value: data.atmospheric_index.toFixed(3), inline: true },
                { name: 'Popularity', value: data.popularity.toString(), inline: true },
            )
            // add fields for embeded playlists, related genres
            .addFields(
                { name: 'Sample Track', value: data.sample_song},
                { name: 'Playlist', value: `[the sound of ${data.genre}](${data.spotify_playlist})`},
                { name: 'Related Genres', value: data.related_genres.map(x => x.genre).join(', ')},
            )
        
        // attach a sample mp3 by url
        const reply_content = {
            embeds: [embed],
            files: []
        }

        reply_content.files = [{attachment: data.preview_url + ".mp3", name: data.genre + ".mp3"}]

        await interaction.editReply(reply_content);
    }
}