const { SlashCommandBuilder } = require('@discordjs/builders');
const { rateLimiter } = require('../../utils/rate_limiter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetratelimits')
        .setDescription('Reset rate limits for online modes (admin only)')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Which mode to reset')
                .setRequired(false)
                .addChoices(
                    { name: 'All modes', value: 'all' },
                    { name: 'Online', value: 'online' },
                    { name: 'Online Lite', value: 'online_lite' }
                )),
    
    async execute(interaction) {
        try {
            // Check if user has admin permissions (you might want to adjust this)
            if (!interaction.member.permissions.has('ADMINISTRATOR')) {
                await interaction.reply({
                    content: '❌ You need administrator permissions to reset rate limits.',
                    ephemeral: true
                });
                return;
            }
            
            const mode = interaction.options.getString('mode') || 'all';
            
            const success = rateLimiter.resetRateLimit(mode);
            
            if (success) {
                let message = '✅ Rate limits reset successfully!\n\n';
                
                // Get updated stats
                const stats = rateLimiter.getDetailedStats();
                
                if (mode === 'all') {
                    message += '**All rate limits have been cleared:**\n';
                    Object.keys(stats).forEach(modeName => {
                        message += `• **${modeName}**: ${stats[modeName].limits.per_minute}/min, ${stats[modeName].limits.per_day}/day available\n`;
                    });
                } else {
                    message += `**${mode} rate limits have been cleared:**\n`;
                    message += `• ${stats[mode].limits.per_minute}/min, ${stats[mode].limits.per_day}/day available\n`;
                }
                
                await interaction.reply({
                    content: message,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: '❌ Failed to reset rate limits. Invalid mode specified.',
                    ephemeral: true
                });
            }
            
        } catch (error) {
            console.error('Error in resetratelimits command:', error);
            await interaction.reply({
                content: '❌ An error occurred while resetting rate limits.',
                ephemeral: true
            });
        }
    },
};
