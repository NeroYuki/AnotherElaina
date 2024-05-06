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

const nearby_genre_query = (data) => [
    {
        $match: {
            $and: [
                {
                    genre: {
                        $ne: data.genre,
                    }
                },
                {
                    "color.0": {
                        $gte: data.color[0] - 30,
                        $lte: data.color[0] + 30
                    },
                    "color.1": {
                        $gte: data.color[1] - 0.08,
                        $lte: data.color[1] + 0.08,
                    },
                    "color.2": {
                        $gte: data.color[2] - 0.08,
                        $lte: data.color[2] + 0.08
                    },
                },
                {
                    organic_index: {
                        $gte: data.organic_index - 0.08,
                        $lte: data.organic_index + 0.08,
                    },
                },
                {
                    atmospheric_index: {
                        $gte: data.atmospheric_index - 0.05,
                        $lte: data.atmospheric_index + 0.05,
                    },
                },
            ]
        }
    },
    {
        $sample:
        {
            size: 1,
        },
    }
]

const down_organic_query = (data) => [
    {
        $match: {
            $and: [
                {
                    genre: {
                        $ne: data.genre,
                    }
                },
                {
                    organic_index: {
                        $gte: data.organic_index - 0.1,
                        $lte: data.organic_index,
                    },
                },
                {
                    atmospheric_index: {
                        $gte: data.atmospheric_index - 0.02,
                        $lte: data.atmospheric_index + 0.02,
                    }
                }
            ]
        }
    },
    {
        $sample:
        {
            size: 1,
        },
    }
]

const left_atmospheric_query = (data) => [
    {
        $match: {
            $and: [
                {
                    genre: {
                        $ne: data.genre,
                    }
                },
                {
                    atmospheric_index: {
                        $gte: data.atmospheric_index - 0.1,
                        $lte: data.atmospheric_index,
                    },
                },
                {
                    organic_index: {
                        $gte: data.organic_index - 0.02,
                        $lte: data.organic_index + 0.02,
                    }
                }
            ]
        }
    },
    {
        $sample:
        {
            size: 1,
        },
    }
]

const up_organic_query = (data) => [
    {
        $match: {
            $and: [
                {
                    genre: {
                        $ne: data.genre,
                    }
                },
                {
                    organic_index: {
                        $gte: data.organic_index,
                        $lte: data.organic_index + 0.1,
                    },
                },
                {
                    atmospheric_index: {
                        $gte: data.atmospheric_index - 0.02,
                        $lte: data.atmospheric_index + 0.02,
                    }
                }
            ]
        }
    },
    {
        $sample:
        {
            size: 1,
        },
    }
]

const right_atmospheric_query = (data) => [
    {
        $match: {
            $and: [
                {
                    genre: {
                        $ne: data.genre,
                    }
                },
                {
                    atmospheric_index: {
                        $gte: data.atmospheric_index,
                        $lte: data.atmospheric_index + 0.1,
                    },
                },
                {
                    organic_index: {
                        $gte: data.organic_index - 0.02,
                        $lte: data.organic_index + 0.02,
                    }
                }
            ]
        }
    },
    {
        $sample:
        {
            size: 1,
        },
    }
]


async function compileResponse(data, message, user) {
    const row = new MessageActionRow()
    .addComponents(
        new MessageButton()
            .setCustomId('randomSong_' + message.id)
            .setLabel('🎲 Select a random song of the same genre')
            .setStyle('PRIMARY'),
    )
    .addComponents(
        new MessageButton()
            .setCustomId('nearbyGenre_' + message.id)
            .setLabel('🔍 Find nearby genres')
            .setStyle('SECONDARY'),
    )
    
    const row2 = new MessageActionRow()
        .addComponents(
            new MessageButton()
                .setCustomId('downOrganic_' + message.id)
                .setLabel('🔽 +organic')
                .setStyle('SECONDARY'),
        )
        .addComponents(
            new MessageButton()
                .setCustomId('leftAtmospheric_' + message.id)
                .setLabel('⬅️ +atmospheric')
                .setStyle('SECONDARY'),
        )
        .addComponents(
            new MessageButton()
                .setCustomId('upOrganic_' + message.id)
                .setLabel('🔼 +electric')
                .setStyle('SECONDARY'),
        )
        .addComponents(
            new MessageButton()
                .setCustomId('rightAtmospheric_' + message.id)
                .setLabel('➡️ +bounce')
                .setStyle('SECONDARY'),
        )

    const filter = i => i.user.id === user.id;

    const collector = message.channel.createMessageComponentCollector({ filter, time: 800000 });

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
            { name: 'Sample Track', value: data.sample_song || '-'},
            { name: 'Playlist', value: `[the sound of ${data.genre}](${data.spotify_playlist})`},
            { name: 'Related Genres', value: data.related_genres.map(x => x.genre).join(', ')},
        )

    // attach a sample mp3 by url
    const reply_content = {
        embeds: [embed],
        files: [],
        components: [row, row2]
    }

    reply_content.files = [{attachment: data.preview_url + ".mp3", name: data.genre + ".mp3"}]
    
    await message.edit(reply_content);

    collector.on('collect', async i => {
        if (i.customId === 'randomSong_' + message.id) {
            i.deferUpdate();
            const genre_song = await queryRecordLimit('spotify_genres_song', {genre: data.genre}, 1);
            if (genre_song.length == 0 || genre_song[0].artists.length == 0) {
                await message.channel.send(`No songs found for genre ${data.genre}`);
                return;
            }
            const genre_song_data = genre_song[0];
            // get a random entry from genre_song_data.artists
            const random_artist = genre_song_data.artists[Math.floor(Math.random() * genre_song_data.artists.length)];
            reply_content.embeds[0].fields.find(x => x.name == 'Sample Track').value = random_artist.sample_song;
            reply_content.files = [{attachment: random_artist.preview_url + ".mp3", name: random_artist.artist + ".mp3"}]

            await message.edit(reply_content);
        }
        else if (i.customId === 'nearbyGenre_' + message.id) {
            i.deferUpdate();
            const msgRef = await message.channel.send('🔍 Finding nearby genres...');
            // find genre with similar color + organic_index + atmospheric_index
            const nearby_genres = await aggregateRecord('spotify_genres', nearby_genre_query(data))

            if (nearby_genres.length == 0) {
                await msgRef.edit(`No nearby genres found for ${data.genre}`);
                return;
            }

            const nearby_genre = nearby_genres[0];
            compileResponse(nearby_genre, msgRef, user);
        }
        else if (i.customId === 'downOrganic_' + message.id) {
            i.deferUpdate();
            const msgRef = await message.channel.send('🔍 Finding genres with lower organic index...');
            // find genre with similar color + organic_index + atmospheric_index
            const nearby_genres = await aggregateRecord('spotify_genres', down_organic_query(data))

            if (nearby_genres.length == 0) {
                await msgRef.edit(`No genres found with lower organic index for ${data.genre}`);
                return;
            }

            const nearby_genre = nearby_genres[0];
            compileResponse(nearby_genre, msgRef, user);
        }
        else if (i.customId === 'leftAtmospheric_' + message.id) {
            i.deferUpdate();
            const msgRef = await message.channel.send('🔍 Finding genres with lower atmospheric index...');
            // find genre with similar color + organic_index + atmospheric_index
            const nearby_genres = await aggregateRecord('spotify_genres', left_atmospheric_query(data))

            if (nearby_genres.length == 0) {
                await msgRef.edit(`No genres found with lower atmospheric index for ${data.genre}`);
                return;
            }

            const nearby_genre = nearby_genres[0];
            compileResponse(nearby_genre, msgRef, user);
        }
        else if (i.customId === 'upOrganic_' + message.id) {
            i.deferUpdate();
            const msgRef = await message.channel.send('🔍 Finding genres with higher organic index...');
            // find genre with similar color + organic_index + atmospheric_index
            const nearby_genres = await aggregateRecord('spotify_genres', up_organic_query(data))

            if (nearby_genres.length == 0) {
                await msgRef.edit(`No genres found with higher organic index for ${data.genre}`);
                return;
            }

            const nearby_genre = nearby_genres[0];
            compileResponse(nearby_genre, msgRef, user);
        }
        else if (i.customId === 'rightAtmospheric_' + message.id) {
            i.deferUpdate();
            const msgRef = await message.channel.send('🔍 Finding genres with higher atmospheric index...');
            // find genre with similar color + organic_index + atmospheric_index
            const nearby_genres = await aggregateRecord('spotify_genres', right_atmospheric_query(data))

            if (nearby_genres.length == 0) {
                await msgRef.edit(`No genres found with higher atmospheric index for ${data.genre}`);
                return;
            }

            const nearby_genre = nearby_genres[0];
            compileResponse(nearby_genre, msgRef, user);
        }
    });

}


module.exports = {
	data: new SlashCommandBuilder()
        .setName('spotify_genre')
        .setDescription('Get a random genre from Spotify, or a specific genre')
        .addStringOption(option =>
            option.setName('genre')
                .setDescription('The genre to get')
                .setRequired(false)),
    
    async execute(interaction, genre_input = null) {
        // make a temporary reply to not get timeout'd
        await interaction.deferReply();

        const genre = genre_input || interaction.options.getString('genre')

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

        const row = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId('randomSong_' + interaction.id)
                    .setLabel('🎲 Select a random song of the same genre')
                    .setStyle('PRIMARY'),
            )
            .addComponents(
                new MessageButton()
                    .setCustomId('nearbyGenre_' + interaction.id)
                    .setLabel('🔍 Find nearby genres')
                    .setStyle('SECONDARY'),
            )
        
        const row2 = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId('downOrganic_' + interaction.id)
                    .setLabel('🔽 +organic')
                    .setStyle('SECONDARY'),
            )
            .addComponents(
                new MessageButton()
                    .setCustomId('leftAtmospheric_' + interaction.id)
                    .setLabel('⬅️ +atmospheric')
                    .setStyle('SECONDARY'),
            )
            .addComponents(
                new MessageButton()
                    .setCustomId('upOrganic_' + interaction.id)
                    .setLabel('🔼 +electric')
                    .setStyle('SECONDARY'),
            )
            .addComponents(
                new MessageButton()
                    .setCustomId('rightAtmospheric_' + interaction.id)
                    .setLabel('➡️ +bounce')
                    .setStyle('SECONDARY'),
            )

        const filter = i => i.user.id === interaction.user.id;

        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 800000 });

        console.log(data)

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
                { name: 'Sample Track', value: data.sample_song || '-'},
                { name: 'Playlist', value: `[the sound of ${data.genre}](${data.spotify_playlist})`},
                { name: 'Related Genres', value: data.related_genres.map(x => x.genre).join(', ')},
            )
        
        // attach a sample mp3 by url
        const reply_content = {
            embeds: [embed],
            files: [],
            components: [row, row2]
        }

        reply_content.files = [{attachment: data.preview_url + ".mp3", name: data.genre + ".mp3"}]

        await interaction.editReply(reply_content);

        collector.on('collect', async i => {
            if (i.customId === 'randomSong_' + interaction.id) {
                i.deferUpdate();
                const genre_song = await queryRecordLimit('spotify_genres_song', {genre: data.genre}, 1);
                if (genre_song.length == 0 || genre_song[0].artists.length == 0) {
                    await interaction.channel.send(`No songs found for genre ${data.genre}`);
                    return;
                }
                const genre_song_data = genre_song[0];
                // get a random entry from genre_song_data.artists
                const random_artist = genre_song_data.artists[Math.floor(Math.random() * genre_song_data.artists.length)];
                reply_content.embeds[0].fields.find(x => x.name == 'Sample Track').value = random_artist.sample_song;
                reply_content.files = [{attachment: random_artist.preview_url + ".mp3", name: random_artist.artist + ".mp3"}]

                await interaction.editReply(reply_content);
            }
            else if (i.customId === 'nearbyGenre_' + interaction.id) {
                i.deferUpdate();
                const msgRef = await interaction.channel.send('🔍 Finding nearby genres...');
                msgRef.user = interaction.user;
                // find genre with similar color + organic_index + atmospheric_index
                const nearby_genres = await aggregateRecord('spotify_genres', nearby_genre_query(data))

                if (nearby_genres.length == 0) {
                    await msgRef.edit(`No nearby genres found for ${data.genre}`);
                    return;
                }

                const nearby_genre = nearby_genres[0];
                compileResponse(nearby_genre, msgRef, interaction.user);
            }
            else if (i.customId === 'downOrganic_' + interaction.id) {
                i.deferUpdate();
                const msgRef = await interaction.channel.send('🔍 Finding genres with lower organic index...');
                msgRef.user = interaction.user;
                // find genre with similar color + organic_index + atmospheric_index
                const nearby_genres = await aggregateRecord('spotify_genres', down_organic_query(data))

                if (nearby_genres.length == 0) {
                    await msgRef.edit(`No genres found with lower organic index for ${data.genre}`);
                    return;
                }

                const nearby_genre = nearby_genres[0];
                compileResponse(nearby_genre, msgRef, interaction.user);
            }
            else if (i.customId === 'leftAtmospheric_' + interaction.id) {
                i.deferUpdate();
                const msgRef = await interaction.channel.send('🔍 Finding genres with lower atmospheric index...');
                // find genre with similar color + organic_index + atmospheric_index
                const nearby_genres = await aggregateRecord('spotify_genres', left_atmospheric_query(data))

                if (nearby_genres.length == 0) {
                    await msgRef.edit(`No genres found with lower atmospheric index for ${data.genre}`);
                    return;
                }

                const nearby_genre = nearby_genres[0];
                compileResponse(nearby_genre, msgRef, interaction.user);
            }
            else if (i.customId === 'upOrganic_' + interaction.id) {
                i.deferUpdate();
                const msgRef = await interaction.channel.send('🔍 Finding genres with higher organic index...');
                // find genre with similar color + organic_index + atmospheric_index
                const nearby_genres = await aggregateRecord('spotify_genres', up_organic_query(data))

                if (nearby_genres.length == 0) {
                    await msgRef.edit(`No genres found with higher organic index for ${data.genre}`);
                    return;
                }

                const nearby_genre = nearby_genres[0];
                compileResponse(nearby_genre, msgRef, interaction.user);
            }
            else if (i.customId === 'rightAtmospheric_' + interaction.id) {
                i.deferUpdate();
                const msgRef = await interaction.channel.send('🔍 Finding genres with higher atmospheric index...');
                // find genre with similar color + organic_index + atmospheric_index
                const nearby_genres = await aggregateRecord('spotify_genres', right_atmospheric_query(data))

                if (nearby_genres.length == 0) {
                    await msgRef.edit(`No genres found with higher atmospheric index for ${data.genre}`);
                    return;
                }

                const nearby_genre = nearby_genres[0];
                compileResponse(nearby_genre, msgRef, interaction.user);
            }
        });
    }
}