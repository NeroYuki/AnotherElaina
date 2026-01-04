const { SlashCommandBuilder } = require('@discordjs/builders');
const { loadImage } = require('../utils/load_discord_img');
const { catboxFileUpload } = require('../utils/catbox_upload');
const crypto = require('crypto');
const fs = require('fs');
const { promisify } = require('util');
const { exec } = require('child_process');
const execPromise = promisify(exec);
const path = require('path');

// Example commands:
// Speed up 2x: -i {input} -filter:v "setpts=0.5*PTS" -filter:a "atempo=2.0" {output}
// Reverse: -i {input} -vf reverse -af areverse {output}
// Extract audio: -i {input} -vn -acodec copy {output}
// Scale to 720p: -i {input} -vf scale=-1:720 {output}
// Add text overlay: -i {input} -vf "drawtext=text='Hello':fontsize=24:x=10:y=10" {output}
// Convert to GIF: -i {input} -vf "fps=10,scale=320:-1:flags=lanczos" {output}
// Rotate 90° CW: -i {input} -vf "transpose=1" {output}
// Crop center: -i {input} -vf "crop=iw/2:ih/2" {output}

const VALID_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v', '.gif'];
const VALID_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/x-flv', 'video/x-ms-wmv', 'image/gif'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB max download
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB for direct discord upload

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ffmpeg')
        .setDescription('Run arbitrary ffmpeg command on a video file')
        .addStringOption(option =>
            option.setName('command')
                .setDescription('FFmpeg args (use {input} and {output}). Ex: -i {input} -vf "scale=640:-1" {output}')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('video')
                .setDescription('The video file to process (max 100MB)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('url')
                .setDescription('URL of the video to process (alternative to attachment)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('output_format')
                .setDescription('Output file format (default: mp4)')
                .addChoices(
                    { name: 'MP4', value: 'mp4' },
                    { name: 'WebM', value: 'webm' },
                    { name: 'MOV', value: 'mov' },
                    { name: 'GIF', value: 'gif' },
                    { name: 'AVI', value: 'avi' },
                    { name: 'MKV', value: 'mkv' }
                )
                .setRequired(false)),

    async execute(interaction, client) {
        await interaction.deferReply();

        const ffmpegCommand = interaction.options.getString('command');
        const videoAttachment = interaction.options.getAttachment('video');
        const videoUrl = interaction.options.getString('url');
        const outputFormat = interaction.options.getString('output_format') || 'mp4';

        // Validate input
        if (!videoAttachment && !videoUrl) {
            await interaction.editReply({ content: 'Please provide either a video attachment or a URL.' });
            return;
        }

        if (videoAttachment && videoUrl) {
            await interaction.editReply({ content: 'Please provide either a video attachment OR a URL, not both.' });
            return;
        }

        // Validate command contains placeholders
        if (!ffmpegCommand.includes('{input}') || !ffmpegCommand.includes('{output}')) {
            await interaction.editReply({ content: 'Command must contain {input} and {output} placeholders.' });
            return;
        }

        // Check for dangerous commands
        const dangerousPatterns = [';', '&&', '||', '|', '>', '<', '`', '$', '\\n', 'rm ', 'del ', 'format'];
        if (dangerousPatterns.some(pattern => ffmpegCommand.toLowerCase().includes(pattern))) {
            await interaction.editReply({ content: 'Command contains potentially dangerous characters or operations.' });
            return;
        }

        const randomId = crypto.randomBytes(16).toString('hex');
        let inputPath = null;
        let outputPath = null;

        try {
            // Download video
            const videoSource = videoAttachment ? videoAttachment.proxyURL : videoUrl;
            const fileName = videoAttachment ? videoAttachment.name : 'video_from_url';
            
            // Validate file extension
            const ext = path.extname(fileName).toLowerCase();
            if (videoAttachment && !VALID_VIDEO_EXTENSIONS.includes(ext)) {
                await interaction.editReply({ content: `Invalid video file format. Supported formats: ${VALID_VIDEO_EXTENSIONS.join(', ')}` });
                return;
            }

            // Validate MIME type if available
            if (videoAttachment && videoAttachment.contentType && !VALID_MIME_TYPES.includes(videoAttachment.contentType)) {
                await interaction.editReply({ content: 'Invalid video MIME type.' });
                return;
            }

            // Check file size
            if (videoAttachment && videoAttachment.size > MAX_FILE_SIZE) {
                await interaction.editReply({ content: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` });
                return;
            }

            await interaction.editReply({ content: 'Downloading video...' });

            const videoBuffer = await loadImage(videoSource, true, false, false).catch((err) => {
                console.log(err);
                throw new Error('Failed to download video');
            });

            inputPath = `./temp/input_${randomId}${ext || '.mp4'}`;
            outputPath = `./temp/output_${randomId}.${outputFormat}`;

            // Write input file
            fs.writeFileSync(inputPath, videoBuffer);

            // Verify it's actually a video file using ffprobe
            await interaction.editReply({ content: 'Validating video file...' });
            try {
                await execPromise(`ffprobe -v error -show_format -show_streams "${inputPath}"`);
            } catch (err) {
                throw new Error('Invalid video file or format not supported');
            }

            // Replace placeholders in command
            let processedCommand = ffmpegCommand
                .replace(/\{input\}/g, `"${inputPath}"`)
                .replace(/\{output\}/g, `"${outputPath}"`);
            
            const actualCommand = `ffmpeg ${processedCommand}`;
            
            // Safety check: ensure the command still only references our files
            if (!actualCommand.includes(inputPath) || !actualCommand.includes(outputPath)) {
                throw new Error('Command validation failed');
            }

            await interaction.editReply({ content: 'Processing video with ffmpeg...' });

            // Execute ffmpeg command with timeout
            try {
                const { stdout, stderr } = await execPromise(actualCommand, { timeout: 300000 }); // 5 min timeout
                console.log('FFmpeg output:', stderr); // ffmpeg outputs to stderr
            } catch (err) {
                console.error('FFmpeg error:', err);
                throw new Error(`FFmpeg processing failed: ${err.message}`);
            }

            // Check if output file exists
            if (!fs.existsSync(outputPath)) {
                throw new Error('FFmpeg command did not produce an output file');
            }

            // Check output file size
            const stats = fs.statSync(outputPath);
            const fileSizeInBytes = stats.size;

            if (fileSizeInBytes === 0) {
                throw new Error('Output file is empty');
            }

            // Upload to catbox or send directly
            if (fileSizeInBytes > MAX_OUTPUT_SIZE) {
                await interaction.editReply({ content: 'Output file exceeds 10MB, uploading to catbox...' });
                
                const catboxUrl = await catboxFileUpload(outputPath).catch((err) => {
                    console.log(err);
                    throw new Error('Failed to upload to catbox');
                });

                await interaction.editReply({ 
                    content: `✅ Processing complete! File size: ${(fileSizeInBytes / 1024 / 1024).toFixed(2)}MB\nDownload: ${catboxUrl}` 
                });
            } else {
                await interaction.editReply({ content: 'Uploading result...' });
                await interaction.channel.send({
                    content: `<@${interaction.user.id}> ✅ Processing complete! File size: ${(fileSizeInBytes / 1024 / 1024).toFixed(2)}MB`,
                    files: [outputPath]
                });
            }

        } catch (err) {
            console.error('Error:', err);
            await interaction.editReply({ content: `❌ Error: ${err.message}` });
        } finally {
            // Cleanup
            if (inputPath && fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }
            if (outputPath && fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
        }
    }
};
