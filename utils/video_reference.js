const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const run = promisify(execFile);
const MAX_BYTES = 200 * 1024 * 1024;
const processOptions = { windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 };

function mediaKind(attachment) {
    const mime = attachment.contentType || '';
    const name = attachment.name || '';
    if (mime.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif)$/i.test(name)) return 'image';
    if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/i.test(name)) return 'video';
    if (mime.startsWith('audio/') || /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i.test(name)) return 'audio';
    throw new Error('The ref attachment must be an image, video, or audio file.');
}

async function preview(buffer) {
    return sharp(buffer).rotate().resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer();
}

// Normalize on the CPU before upload. This bounds decoded frames/reference
// tokens, preserves a video's soundtrack, and gives the rewriter real previews.
async function prepareVideoReference(attachment, shape, { vision = true, buffer, upload, execute = run } = {}) {
    if (!attachment) return undefined;
    const kind = mediaKind(attachment);
    if (attachment.size > MAX_BYTES) throw new Error('Reference attachments must be at most 200 MiB.');
    if (!buffer) {
        const response = await axios.get(attachment.url || attachment.proxyURL, { responseType: 'arraybuffer',
            timeout: 120_000, maxContentLength: MAX_BYTES });
        buffer = Buffer.from(response.data);
    }
    if (buffer.length > MAX_BYTES) throw new Error('Reference attachments must be at most 200 MiB.');
    upload ||= require('./comfy_client').uploadImage.bind(require('./comfy_client'));
    const id = `h3_ref_${crypto.randomUUID()}`;
    if (kind === 'image') {
        const png = await sharp(buffer).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
            .png().toBuffer();
        return { kind, upload: await upload(png, `${id}.png`, 'image/png'), previews: vision ? [await preview(png)] : [],
            promptContext: 'Reference <Picture 1> supplies appearance/style/identity as requested. It is not an opening or ending frame.' };
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elaina-h3-ref-'));
    try {
        // Neutral filenames and execFile arguments keep attachment names out of
        // shell commands; ffprobe verifies streams rather than trusting MIME.
        const source = path.join(dir, 'source');
        await fs.writeFile(source, buffer);
        const probe = JSON.parse((await execute(process.env.FFPROBE_PATH || 'ffprobe',
            ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source], processOptions)).stdout);
        const video = probe.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
        const audio = probe.streams?.find(stream => stream.codec_type === 'audio');
        if (kind === 'video' ? !video : !audio) throw new Error(`Reference contains no decodable ${kind} stream.`);
        const streamDuration = Number((kind === 'video' ? video : audio).duration);
        const sourceDuration = Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : Number(probe.format?.duration);
        const duration = Math.min(kind === 'audio' && shape.segments ? shape.seconds : 15, shape.seconds, sourceDuration);
        if (!Number.isFinite(duration) || duration < (kind === 'video' ? 5 / 24 : 0.1)) {
            throw new Error('Reference is too short or its duration could not be read. Video needs at least five frames.');
        }
        const output = path.join(dir, kind === 'video' ? 'reference.mp4' : 'reference.wav');
        const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-t', String(duration)];
        if (kind === 'video') {
            args.push('-map', '0:v:0', '-vf', `fps=24,scale=${shape.width}:${shape.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${shape.width}:${shape.height}:(ow-iw)/2:(oh-ih)/2`,
                '-frames:v', String(Math.min(360, shape.length)), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p');
            if (audio) args.push('-map', '0:a:0', '-c:a', 'aac', '-ar', '32000', '-ac', '2');
            else args.push('-an');
        } else args.push('-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-ar', '32000', '-ac', '2');
        args.push(output);
        await execute(process.env.FFMPEG_PATH || 'ffmpeg', args, processOptions);
        const previews = [];
        if (vision && kind === 'video') {
            for (const [index, time] of [0, duration / 2, Math.max(0, duration - 0.1)].entries()) {
                const imagePath = path.join(dir, `${index}.jpg`);
                await execute(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(time),
                    '-i', output, '-frames:v', '1', imagePath], processOptions);
                previews.push(await preview(await fs.readFile(imagePath)));
            }
        }
        return { kind, duration, sourceDuration, hasAudio: kind === 'video' && !!audio, previews,
            upload: await upload(await fs.readFile(output), `${id}.${kind === 'video' ? 'mp4' : 'wav'}`, kind === 'video' ? 'video/mp4' : 'audio/wav'),
            promptContext: kind === 'video'
                ? `Reference <Video 1> (${duration.toFixed(2)} seconds) supplies the requested motion/scene/style. Previews are chronological samples, not frame anchors.${audio ? ' Its soundtrack is reference <Audio 1>.' : ' It has no soundtrack.'} Audio itself is unavailable to this rewriter; do not invent its words or sound characteristics.`
                : `Reference <Audio 1> (${duration.toFixed(2)} seconds) supplies the requested sound/voice/music. The audio is passed to H3, but this rewriter cannot hear it. Preserve the user's description; do not invent lyrics, dialogue, or voice characteristics.` };
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

module.exports = { prepareVideoReference, mediaKind };
