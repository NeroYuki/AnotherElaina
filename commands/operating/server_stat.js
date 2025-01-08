const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { packages } = require('../../package-lock.json');
const ComfyClient = require('../../utils/comfy_client');
const si = require('systeminformation');
const os = require('os');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('server_stat')
		.setDescription('View current stat of the server')
    ,

	async execute(interaction) {
        await interaction.deferReply();
		// fetch the server stat
        const server_stat = ComfyClient.comfyStat;

        const memStat = await si.mem().catch((err) => {
            console.log("Failed to retrieve memory stat", err)
            return
        })

        const osInfo = await si.osInfo().catch((err) => {
            console.log("Failed to retrieve os info", err)
            return
        })

        const cpuTemp = await si.cpuTemperature().catch((err) => {
            console.log("Failed to retrieve cpu temp", err)
            return
        })

        const ram_percent = (memStat?.used && memStat?.total) ? memStat.used / memStat.total * 100 : 0
        const ram_used = memStat?.used ? memStat.used / 1024 / 1024 / 1024 : 0
        const ram_total = memStat?.total ? memStat.total / 1024 / 1024 / 1024 : 0

        // get the main cpu usage percentage from os.cpus()
        let cpus = os.cpus();

        let cpu_main_percent = 0;
        for(let i = 0, len = cpus.length; i < len; i++) {
            var cpu = cpus[i], total = 0;

            for(var type in cpu.times) {
                total += cpu.times[type];
            }

            for(type in cpu.times) {
                cpu_main_percent = Math.round(100 * cpu.times[type] / total)
            }
        }

        console.log(cpuTemp)

        const botServerTitle = "Bot Server - " + `${osInfo.distro} ${osInfo.release} (${osInfo.arch})`
        const botServerStat = '------------------------------------------' + "\n"
            + '**CPU Usage: **' + cpu_main_percent.toFixed(2) + "%" + "\n"
            + (osInfo.distro.includes('Windows') ? '' : '**CPU Temp: **' + cpuTemp.main + "°C" + "\n")
            + '**RAM Usage: **' + `${ram_used.toFixed(2)}/${ram_total.toFixed(2)}GB (${ram_percent.toFixed(2)}%)` + "\n"

        const aiServerTitle = "AI Server -  Microsoft Windows 10 Education 10.0.19045 (x64)"
        const aiServerStat = '------------------------------------------' + "\n"
            + '**CPU Usage: **' + server_stat.cpu_usage.toFixed(2) + "%" + "\n"
            + '**RAM Usage: **' + `${server_stat.ram_used.toFixed(2)}/${server_stat.ram_total.toFixed(2)}GB (${server_stat.ram_percent.toFixed(2)}%)` + "\n"
            + '------------------------------------------' + "\n"
            + "**GPU (NVIDIA RTX 4060 Ti): **" + server_stat.gpu_usage.toFixed(2) + "%" + "\n"
            + '**VRAM Usage: **' + `${server_stat.gpu_vram_used.toFixed(2)}/${server_stat.gpu_vram_total.toFixed(2)}GB (${server_stat.gpu_memory_percent.toFixed(2)}%)` + "\n"
            + "**GPU Temp: **" + server_stat.gpu_temp.toFixed(2) + "°C"

        const versionInfoTitle = "Version Info"
        const versionInfoStat =  '------------------------------------------' + "\n"
            + '**Node Version: **' + process.versions.node + "\n"
            + '**Discord.js Version: **' + packages["node_modules/discord.js"].version + "\n"

        // reply as embeded message
        const embed = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('Server Stat')
            .setDescription('Current stat of the server')
            .addFields(
                { name: botServerTitle, value: botServerStat },
                { name: aiServerTitle, value: aiServerStat },
                { name: versionInfoTitle, value: versionInfoStat }
            )
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
	},
};
