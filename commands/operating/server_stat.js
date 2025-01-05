const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const ComfyClient = require('../../utils/comfy_client');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('server_stat')
		.setDescription('View current stat of the server')
    ,

	async execute(interaction) {
		// fetch the server stat
        const server_stat = ComfyClient.comfyStat;

        // reply as embeded message
        const embed = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('Server Stat')
            .setDescription('Current stat of the server')
            .addFields(
                { name: 'CPU Usage', value: server_stat.cpu_usage.toFixed(2) + "%", inline: true },
                { name: 'RAM Usage', value: `${server_stat.ram_used.toFixed(2)}/${server_stat.ram_total.toFixed(2)}GB (${server_stat.ram_percent.toFixed(2)}%)`, inline: true },
                { name: 'Current GPU', value: "NVIDIA RTX 4060 Ti" },
                { name: 'GPU Usage', value: server_stat.gpu_usage.toFixed(2) + "%", inline: true },
                { name: 'VRAM Usage', value: `${server_stat.gpu_vram_used.toFixed(2)}/${server_stat.gpu_vram_total.toFixed(2)}GB (${server_stat.gpu_memory_percent.toFixed(2)}%)`, inline: true },
                { name: 'GPU Temp', value: server_stat.gpu_temp.toFixed(2) + "°C", inline: true },
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
	},
};
