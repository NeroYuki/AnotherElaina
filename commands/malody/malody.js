const { SlashCommandBuilder } = require('@discordjs/builders');
const { clamp, truncate, try_parse_json_and_return_formated_string } = require('../../utils/common_helper');
const malodyapi = require('../../integration/malodyapi');
const { MessageEmbed } = require('discord.js');

const malody_mode_emote = ["mode0", "mode1", "mode2", "mode3", "mode4", "mode5", "mode6", "mode7"]

function modeEmote(input) {
    return malody_mode_emote[parseInt(input)]
}

function status2color(input) {
    const available_status = {
        Stable: "#00dd22",
        Beta: "#dddd00",
        Alpha: "dd2200"
    }
    return available_status[input]
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('malody')
        .setDescription('Commands related to Malody')
        .addSubcommand(subcommand =>
            subcommand
                .setName('profile')
                .setDescription('Check a Malody profile')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('The username of the profile to check')
                        .setRequired(true))
            )
        .addSubcommand(subcommand =>
            subcommand
                .setName('chart')
                .setDescription('Check a Malody chart')
                .addStringOption(option =>
                    option.setName('chart_link')
                        .setDescription('The link of the chart to check')
                        .setRequired(true))
            )  
        .addSubcommand(subcommand =>
            subcommand
                .setName('recent')
                .setDescription('Check recent plays of a Malody profile')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('The username of the profile to check')
                        .setRequired(true))
            )
    ,

	async execute(interaction) {
        if (interaction.options.getSubcommand() === 'profile') {
            // const username = interaction.options.getString('username');

            // await interaction.deferReply();

            // let res = await malodyapi.getUserInfo({username: username}).catch(() => {
            //     interaction.editReply("Can't find said user");
            //     return;
            // })

            // const embed = new MessageEmbed()
            //     .setColor("#00dd22")
            //     .setDescription("**Username: **" + res.username + "  /  **Gold**: " + res.gold + " / " + res.user_info.location)
            //     .setAuthor({text: "Malody user profile (click here to view profile)", iconURL: "", url: "https://m.mugzone.net/accounts/user/" + res.uid})
            //     .setFooter({text: "Account created on " + res.time.registration_date.toUTCString()})
            //     .setThumbnail(res.avatar_link)
            
            // res.mode_info.forEach((mode) => {
            //     let mode_emote = client.emojis.cache.find(emote => emote.name === modeEmote(mode.mode_id));
            //     embed.addFields({ 
            //         name: `${mode_emote}  ${mode.mode_name} / # ${mode.rank}`, 
            //         value: mode.exp + "exp / " + mode.play_count + " plays / " + mode.max_combo + "x / " + mode.avg_accuracy + "%"
            //     })
            // })

            // await interaction.editReply({embeds: [embed]});

            interaction.editReply("This command is disabled due to the web scraper being broken");
        }
        else if (interaction.options.getSubcommand() === 'chart') {
            // const chart_link = interaction.options.getString('chart_link');
            // let comp = chart_link.split("/");
            // cid = comp[comp.length-1]
            // let res = await malodyapi.getChartInfo({chartid: cid}).catch(() => {
            //     interaction.editReply("Can't find said chart"); 
            //     return;
            // })
        
            // const mode_emote = client.emojis.cache.find(emote => emote.name === modeEmote(res.mode_id))
            // const footer_text = "Last update on " + res.last_update.toUTCString() + ((res.stabled_by.username === undefined)? "" : " - Stabled by " + res.stabled_by.username)
        
            // const embed = new MessageEmbed()
            //     .setColor(status2color(res.status))
            //     .setDescription(`**${res.artist} - ${res.track_name}**\n${mode_emote}  ${res.chart_name} (${res.creator.username})`)
            //     .setAuthor({text: "Malody chart info (click here to view page)", iconURL: "", url: res.ref_link})
            //     .setFooter({text: `${footer_text}`})
            //     .setThumbnail(res.cover_link)
            //     .addFields({
            //         name: `Length: ${res.length} - BPM: ${res.bpm}`,
            //         value: `:arrow_forward: ${res.play_data.play_count}    :+1: ${res.play_data.like}    :-1: ${res.play_data.dislike}`
            //     })
        
            // await interaction.editReply({embeds: [embed]});
            interaction.editReply("This command is disabled due to the web scraper being broken");
        }
        else if (interaction.options.getSubcommand() === 'recent') {
            // const username = interaction.options.getString('username');

            // await interaction.deferReply();

            // let res = await malodyapi.getUserInfo({username: username}).catch(() => {
            //     interaction.editReply("Can't find said user");
            //     return;
            // })

            // const embeded = new MessageEmbed()
            //     .setColor(status2color(res.user_info.status))
            //     .setTitle(res.username + " / " + res.user_info.location)
            //     .setURL("https://m.mugzone.net/accounts/user/" + res.uid)
            //     .setThumbnail(res.avatar_link)
            //     .setFooter({
            //         text: "Last login on " + res.time.last_login.toUTCString()
            //     })

            // for (let i = 0; i < res.recent_play.length; i++) {
            //     //cap at 5 to not get too spammy
            //     if (i >= 5) break;
            //     let mode_emote = client.emojis.cache.find(emote => emote.name === modeEmote(res.recent_play[i].mode_id));
            //     embeded.addFields({
            //         name:`${mode_emote}  ${res.recent_play[i].chart_string})`,
            //         value: `${res.recent_play[i].judge} - ${res.recent_play[i].score} / ${res.recent_play[i].max_combo}x / ${res.recent_play[i].accuracy}% ` + ((res.recent_play[i].game_mod.length > 0)? " + " + res.recent_play[i].game_mod.join(", ") : "") + "\n" +
            //             `Played ${res.recent_play[i].time} [(Chart)](${res.recent_play[i].chart_link})`
            //     })
            // }

            // await interaction.editReply({embeds: [embeded]});
            interaction.editReply("This command is disabled due to the web scraper being broken");
        }
	},
};