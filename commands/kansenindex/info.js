/**
 * KansenIndex utility module — embed builder and voice line sender.
 * This file does NOT export `data` or `execute`; it is a helper required by search.js.
 */

const { MessageEmbed, MessageAttachment, MessageButton, MessageActionRow } = require('discord.js')
const path = require('path')
const sharp = require('sharp')

// DB paths are stored as ./data/assets/shipgirls/<franchise>/... — images live in the bot's own resources/shipgirls/
const ASSETS_ROOT = path.resolve(__dirname, '..', '..', 'resources', 'shipgirls')

function resolveAsset(relativePath) {
    // Strip ./data/assets/shipgirls/ prefix if present, then resolve under resources/shipgirls/
    const stripped = relativePath.replace(/^\.[\/\\]data[\/\\]assets[\/\\]shipgirls[\/\\]/, '')
    return path.join(ASSETS_ROOT, stripped)
}

const MAX_FILE_SIZE = 8 * 1024 * 1024  // 8 MB

const RATING_COLORS = {
    general:      0x57ab5a,
    sensitive:    0xe3b341,
    questionable: 0xe36d3a,
    explicit:     0xc93b3b,
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------


function getCGUrl(full_dir) {
    const relative = full_dir.replace(/^\.\//, '')
    return 'https://kansenindex.dev/' + relative.split('/').map(encodeURIComponent).join('/')
}

function getFormBadges(cg) {
    const b = []
    if (cg.is_base)     b.push('🔵 Base')
    if (cg.is_oath)     b.push('💍 Oath')
    if (cg.is_retrofit) b.push('🔧 Retrofit')
    if (cg.is_damage)   b.push('💥 Damage')
    if (cg.is_outfit)   b.push('👗 Outfit')
    if (cg.include_bg)  b.push('🌄 BG')
    if (cg.is_censored) b.push('⚫ Censored')
    return b.length ? b.join(' · ') : 'None'
}

function getContentBadges(cg) {
    const b = []
    if (cg.voice) b.push('🔊 Voice')
    if (cg.l2d)   b.push('🤖 Live2D')
    if (cg.chibi) b.push('🎭 Chibi')
    if (cg.spine) b.push('💀 Spine')
    if (cg.m3d)   b.push('📦 3D')
    return b.length ? b.join(' · ') : 'Image only'
}

function cleanUncertain(value) {
    if (!value) return null
    if (typeof value === 'string' && value.startsWith('? ')) {
        return `${value.slice(2)} ❓`
    }
    return String(value)
}

/** Resize a local image file to fit Discord's 8 MB limit. Returns { buffer, ext }. */
async function resizeImageForDiscord(imagePath) {
    const absPath = resolveAsset(imagePath)
    try {
        // First pass: 1500 px wide, JPEG 85 %
        let buf = await sharp(absPath)
            .resize({ width: 1500, withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer()
        if (buf.length <= MAX_FILE_SIZE) return { buffer: buf, ext: 'jpg' }

        // Second pass: 1000 px wide, JPEG 75 %
        buf = await sharp(absPath)
            .resize({ width: 1000, withoutEnlargement: true })
            .jpeg({ quality: 75 })
            .toBuffer()
        return { buffer: buf, ext: 'jpg' }
    } catch (e) {
        console.error('[kansenindex] resizeImageForDiscord error:', e)
        return null
    }
}

function getVoiceLabel(filepath) {
    // "40_atk_cn.mp3"  →  "Atk Cn"
    // "100001_main1.ogg" → "Main1"
    const base = path.basename(filepath, path.extname(filepath))
    const cleaned = base.replace(/^\d+_/, '')
    return cleaned.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// ---------------------------------------------------------------------------
// Exported: buildResultEmbed
// ---------------------------------------------------------------------------

/**
 * @param {object}  cgDoc         - MongoDB document
 * @param {number}  index         - 0-based position in result set
 * @param {number}  total         - total results in set
 * @param {boolean} isNSFW        - whether the channel is marked NSFW
 * @param {'search'|'info'} mode
 * @param {Date|null} dbLastUpdated - cached DB last-update date (used in search footer)
 * @returns {{ embed: MessageEmbed, attachment: MessageAttachment|null }}
 */
module.exports.buildResultEmbed = async function buildResultEmbed(
    cgDoc, index, total, isNSFW, mode, dbLastUpdated
) {
    const rating   = cgDoc.rating ?? 'unknown'
    const color    = RATING_COLORS[rating] ?? 0x7289da
    const isHidden = !isNSFW && (rating === 'questionable' || rating === 'explicit')

    // Modifier label + rating rolled into description
    const modLabel    = cgDoc.modifier && cgDoc.modifier !== 'base'
        ? cgDoc.modifier
        : getFormBadges(cgDoc).split(' · ')[0] || cgDoc.modifier || 'Base'
    const ratingLabel = rating.charAt(0).toUpperCase() + rating.slice(1)

    const embed = new MessageEmbed()
        .setColor(color)
        .setTitle(`[${cgDoc.folder}] ${cgDoc.char}`)
        .setDescription(`**${modLabel}** · Rating: ${ratingLabel}`)

    // Title links to the full-size CG page
    if (cgDoc.full_dir) embed.setURL(getCGUrl(cgDoc.full_dir))

    // — Nation / Ship Type (merged inline field) —
    const nation   = cleanUncertain(Array.isArray(cgDoc.nation)    ? cgDoc.nation.join(', ')    : cgDoc.nation)
    const shipType = cleanUncertain(Array.isArray(cgDoc.ship_type) ? cgDoc.ship_type.join(', ') : cgDoc.ship_type)
    if (nation || shipType) {
        embed.addField('Nation / Ship Type', `${nation ?? '—'} / ${shipType ?? '—'}`, true)
    }

    // — Illustrator / Voice Actor (merged inline field) —
    const illBase    = cgDoc.illust ? cleanUncertain(cgDoc.illust) ?? cgDoc.illust : null
    const illLabel   = illBase ? (cgDoc.danbooru_banned ? `${illBase} ⚠️` : illBase) : null
    const voiceActor = cgDoc.voice?.voice_actor || null
    if (illLabel || voiceActor) {
        const hasVA   = !!voiceActor
        const hasIll  = !!illLabel
        const name    = hasIll && hasVA ? 'Illustrator / Voice Actor'
                      : hasIll          ? 'Illustrator'
                      :                   'Voice Actor'
        const value   = hasIll && hasVA ? `${illLabel} / ${voiceActor}`
                      : hasIll          ? illLabel
                      :                   voiceActor
        embed.addField(name, value, true)
    }

    // — Birthday (field name) · Height + Displacement (field value) —
    const birthday     = cleanUncertain(cgDoc.birthday)
    const height       = cleanUncertain(cgDoc.height)
    const displacement = cleanUncertain(cgDoc.displacement)
    if (birthday || height || displacement) {
        const statParts = []
        if (height)       statParts.push(`📏 ${height}`)
        if (displacement) statParts.push(`⚓ ${displacement}`)
        embed.addField(
            birthday ? `🎂 ${birthday}` : 'Stats',
            statParts.length ? statParts.join('  ') : '—',
            true
        )
    }

    // — Form badges —
    const formBadges = getFormBadges(cgDoc)
    if (formBadges && formBadges !== 'None') embed.addField('Form', formBadges, false)

    // — NSFW warning —
    if (isHidden) {
        embed.addField('⚠️ Content Warning', `Rated **${rating}** — image spoiler-tagged in SFW channels.`, false)
    }

    // — Footer —
    const footerParts = []
    if (mode === 'search') {
        footerParts.push(`Result ${index + 1} / ${total}`)
        if (dbLastUpdated) {
            const d = new Date(dbLastUpdated)
            footerParts.push(
                `DB updated: ${d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`
            )
        }
    } else {
        footerParts.push(`Form ${index + 1} / ${total}`)
        footerParts.push(cgDoc.folder ?? '')
    }
    embed.setFooter({ text: footerParts.join(' · ') })

    if (cgDoc.file_modified_date) {
        embed.setTimestamp(new Date(cgDoc.file_modified_date))
    }

    // — Attach image —
    let attachment = null
    if (cgDoc.full_dir) {
        const result = await resizeImageForDiscord(cgDoc.full_dir)
        if (result) {
            const { buffer, ext } = result
            const safeName = `${cgDoc.char}_${modLabel}`.replace(/[^a-z0-9_\-]/gi, '_')
            const fileName = isHidden
                ? `SPOILER_${safeName}.${ext}`
                : `${safeName}.${ext}`
            attachment = new MessageAttachment(buffer, fileName)
            embed.setImage(`attachment://${fileName}`)
        }
    }

    return { embed, attachment }
}

// ---------------------------------------------------------------------------
// Exported: sendVoiceLines
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20  // 4 rows × 5 columns per page

/**
 * Shows a paged voice line listing with 4×5 numbered buttons.
 * Clicking a number sends that specific voice file as a new ephemeral reply.
 * Interaction must already be deferred (ephemeral).
 */
module.exports.sendVoiceLines = async function sendVoiceLines(interaction, voiceFiles) {
    if (!voiceFiles || voiceFiles.length === 0) {
        return interaction.editReply({ content: 'No voice lines found for this CG.' })
    }

    const totalPages = Math.ceil(voiceFiles.length / PAGE_SIZE)
    let page = 0

    function buildPage(p) {
        const start = p * PAGE_SIZE
        const slice = voiceFiles.slice(start, start + PAGE_SIZE)

        // Numbered text listing
        const lines = slice.map((f, i) => `\`${start + i + 1}.\` ${getVoiceLabel(f)}`)
        const embed = new MessageEmbed()
            .setColor(0x5865f2)
            .setTitle('🔊 Voice Lines')
            .setDescription(lines.join('\n'))
            .setFooter({ text: `Page ${p + 1}/${totalPages} · ${voiceFiles.length} voice line(s) total · Click a number to play` })

        // 4×5 numbered buttons
        const rows = []
        for (let row = 0; row < 4; row++) {
            const btns = []
            for (let col = 0; col < 5; col++) {
                const i = row * 5 + col
                if (i >= slice.length) break
                btns.push(
                    new MessageButton()
                        .setCustomId(`ki_vl_${start + i}`)
                        .setLabel(String(start + i + 1))
                        .setStyle('PRIMARY')
                )
            }
            if (btns.length > 0) rows.push(new MessageActionRow().addComponents(btns))
        }

        // Prev / Next nav row (always present as the last row)
        rows.push(
            new MessageActionRow().addComponents(
                new MessageButton()
                    .setCustomId('ki_vl_prev')
                    .setLabel('◀ Prev')
                    .setStyle('SECONDARY')
                    .setDisabled(p === 0),
                new MessageButton()
                    .setCustomId('ki_vl_next')
                    .setLabel('Next ▶')
                    .setStyle('SECONDARY')
                    .setDisabled(p >= totalPages - 1),
            )
        )

        return { embed, rows }
    }

    const { embed, rows } = buildPage(page)
    const reply = await interaction.editReply({ embeds: [embed], components: rows })

    const collector = reply.createMessageComponentCollector({ componentType: 'BUTTON', time: 120_000 })

    collector.on('collect', async btnInt => {
        if (btnInt.user.id !== interaction.user.id) {
            return btnInt.reply({ content: 'This is not your session.', ephemeral: true })
        }

        if (btnInt.customId === 'ki_vl_prev') {
            page = Math.max(0, page - 1)
            const { embed: e, rows: r } = buildPage(page)
            return btnInt.update({ embeds: [e], components: r })
        }
        if (btnInt.customId === 'ki_vl_next') {
            page = Math.min(totalPages - 1, page + 1)
            const { embed: e, rows: r } = buildPage(page)
            return btnInt.update({ embeds: [e], components: r })
        }

        // Numbered button — load and send the specific voice file
        const fileIdx = parseInt(btnInt.customId.replace('ki_vl_', ''), 10)
        const filepath = voiceFiles[fileIdx]
        if (filepath == null) return btnInt.reply({ content: 'Invalid selection.', ephemeral: true })

        const label = getVoiceLabel(filepath)
        await btnInt.deferReply({ ephemeral: true })
        try {
            const buf = require('fs').readFileSync(resolveAsset(filepath))
            if (buf.length > MAX_FILE_SIZE) {
                return btnInt.editReply({ content: `🔇 \`${label}\` is too large to send.` })
            }
            return btnInt.editReply({
                content: `🔊 **${label}**`,
                files: [new MessageAttachment(buf, `${label}${path.extname(filepath)}`)],
            })
        } catch {
            return btnInt.editReply({ content: `❌ \`${label}\` could not be loaded.` })
        }
    })

    collector.on('end', () => {
        interaction.editReply({ components: [] }).catch(() => {})
    })
}
