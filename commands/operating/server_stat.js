const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { packages } = require('../../package-lock.json');
const ComfyClient = require('../../utils/comfy_client');
const si = require('systeminformation');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('server_stat')
		.setDescription('View current stat of the server')
    ,

	async execute(interaction) {
		// fetch the server stat
        const server_stat = ComfyClient.comfyStat;

        const cpuStat = await si.cpu().catch((err) => {
            console.log("Failed to retrieve cpu stat", err)
            return
        })

        const memStat = await si.mem().catch((err) => {
            console.log("Failed to retrieve memory stat", err)
            return
        })

        const ram_percent = (memStat?.used && memStat?.total) ? memStat.used / memStat.total * 100 : 0

        const botServerTitle = "Bot Server (Ubuntu 20.04.6 LTS)"
        const botServerStat = 'CPU Usage: ' + cpuStat?.currentload?.toFixed(2) + "%" + "\n"
            + 'RAM Usage: ' + `${memStat?.used?.toFixed(2)}/${memStat?.total?.toFixed(2)}GB (${ram_percent}%)` + "\n"

        const aiServerTitle = "AI Server (Windows 10 Education 22H2)"
        const aiServerStat = 'CPU Usage: ' + server_stat.cpu_usage.toFixed(2) + "%" + "\n"
            + 'RAM Usage: ' + `${server_stat.ram_used.toFixed(2)}/${server_stat.ram_total.toFixed(2)}GB (${server_stat.ram_percent.toFixed(2)}%)` + "\n"
            + "GPU (NVIDIA RTX 4060 Ti): " + server_stat.gpu_usage.toFixed(2) + "%" + "\n"
            + 'VRAM Usage: ' + `${server_stat.gpu_vram_used.toFixed(2)}/${server_stat.gpu_vram_total.toFixed(2)}GB (${server_stat.gpu_memory_percent.toFixed(2)}%)` + "\n"
            + "GPU Temp: " + server_stat.gpu_temp.toFixed(2) + "°C"

        const versionInfoTitle = "Version Info"
        const versionInfoStat = 'Node Version: ' + process.versions.node + "\n"
            + 'Discord.js Version: ' + packages["discord.js"].version + "\n"

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
        
        await interaction.reply({ embeds: [embed] });
	},
};
