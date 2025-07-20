const { SlashCommandBuilder } = require('@discordjs/builders');
const { getOperatingModeStatus, getTimeUntilNextOnlineRequest } = require('../../utils/operating_mode_selector');
const { rateLimiter } = require('../../utils/rate_limiter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ratestatus')
        .setDescription('Check the current rate limit status for online modes'),
    
    async execute(interaction) {
        try {
            const status = getOperatingModeStatus();
            const timeUntilNext = getTimeUntilNextOnlineRequest();
            const detailedStats = rateLimiter.getDetailedStats();
            
            // Format time remaining
            const formatTime = (ms) => {
                if (ms <= 0) return 'Now';
                const seconds = Math.ceil(ms / 1000);
                if (seconds < 60) return `${seconds}s`;
                const minutes = Math.floor(seconds / 60);
                const remainingSeconds = seconds % 60;
                return `${minutes}m ${remainingSeconds}s`;
            };
            
            let statusMessage = '**🌐 Online Mode Rate Limit Status**\n';
            statusMessage += '*Rate limits persist across bot restarts*\n\n';
            
            // Online Lite status
            const onlineLite = detailedStats.online_lite;
            statusMessage += `**Online Lite** ${onlineLite.available ? '✅' : '❌'}\n`;
            statusMessage += `• Usage: ${onlineLite.usage.last_minute}/${onlineLite.limits.per_minute} per minute, ${onlineLite.usage.last_day}/${onlineLite.limits.per_day} per day\n`;
            statusMessage += `• Remaining: ${onlineLite.remaining.per_minute}/min, ${onlineLite.remaining.per_day}/day\n`;
            if (!onlineLite.available) {
                statusMessage += `• Next available: ${formatTime(onlineLite.next_available)}\n`;
            }
            statusMessage += '\n';
            
            // Online status
            const online = detailedStats.online;
            statusMessage += `**Online** ${online.available ? '✅' : '❌'}\n`;
            statusMessage += `• Usage: ${online.usage.last_minute}/${online.limits.per_minute} per minute, ${online.usage.last_day}/${online.limits.per_day} per day\n`;
            statusMessage += `• Remaining: ${online.remaining.per_minute}/min, ${online.remaining.per_day}/day\n`;
            if (!online.available) {
                statusMessage += `• Next available: ${formatTime(online.next_available)}\n`;
            }
            statusMessage += '\n';
            
            // Local GPU status
            statusMessage += `**Local GPU** ${status.local_gpu.available ? '✅' : '❌'}\n`;
            statusMessage += `• VRAM usage: ${status.local_gpu.vram_used.toFixed(1)} GB\n`;
            statusMessage += `• LLM timer active: ${status.local_gpu.llm_timer_active ? 'Yes' : 'No'}\n\n`;
            
            // Current recommended mode
            const { getBestOperatingMode } = require('../../utils/operating_mode_selector');
            const recommendedMode = getBestOperatingMode(false);
            const recommendedModeWithImages = getBestOperatingMode(true);
            const recommendedModeLocal = getBestOperatingMode(false, true);
            const recommendedModeLocalWithImages = getBestOperatingMode(true, true);
            
            statusMessage += `**Recommended Modes**\n`;
            statusMessage += `• Text only (auto): **${recommendedMode}**, with images: **${recommendedModeWithImages}**\n`;
            statusMessage += `• Text only (auto_local): **${recommendedModeLocal}**, with images: **${recommendedModeLocalWithImages}**\n\n`;
            
            // Show current global mode
            statusMessage += `**Current Global Mode**: \`${globalThis.operating_mode || 'unknown'}\`\n\n`;
            
            statusMessage += `*Use \`/resetratelimits\` to reset rate limits if needed*`;
            
            await interaction.reply({
                content: statusMessage,
                ephemeral: true
            });
            
        } catch (error) {
            console.error('Error in ratestatus command:', error);
            await interaction.reply({
                content: 'An error occurred while checking rate limit status.',
                ephemeral: true
            });
        }
    },
};
