const { SlashCommandBuilder }  = require('@discordjs/builders')
const { MessageEmbed, MessageActionRow, MessageButton, MessageSelectMenu } = require('discord.js')
const { queryRecord, queryRecordLimit, aggregateRecord } = require('../../database/database_interaction')
const config = require('../../config.json')
const { buildResultEmbed, sendVoiceLines } = require('./info')

// ---------------------------------------------------------------------------
// Static franchise list (ordered by CG count, updated manually when needed)
// ---------------------------------------------------------------------------
const TOP_FRANCHISES = [
    'Azur Lane',
    'Kantai Collection',
    'Warship Girls R',
    'Black Surgenights',
    'Battleship Girl',
    'Abyss Horizon',
    'Blue Oath',
    'Axis Senki',
    'Victory Belles',
    'Velvet Code',
    'Lane Girls',
    'Shipgirls GO',
    'The Cute Warship',
    'Battleship Bishoujo Puzzle',
    'Counter Arms',
    'Artist Original Content',
    'Shipgirls Collection',
    'Guardian Project',
    'Tales of Abyss',
    'Mirage of Steelblue',
    'Goddess Fleet',
    'Arpeggio of Blue Steel',
    'Moe Moe World War II',
]

// ---------------------------------------------------------------------------
// Lazy cache — only fetches the DB last-updated date on first use
// ---------------------------------------------------------------------------
let dbLastUpdated    = null
let cacheInitialized = false
let cacheInitPromise = null

async function ensureCacheReady() {
    if (cacheInitialized) return
    if (cacheInitPromise) return cacheInitPromise
    cacheInitPromise = (async () => {
        try {
            const latest = await aggregateRecord('shipgirl', [
                { $sort:    { file_modified_date: -1 } },
                { $limit:   1 },
                { $project: { file_modified_date: 1 } },
            ], true)
            if (latest?.length) {
                dbLastUpdated = latest[0].file_modified_date
                console.log('[kansenindex] DB last updated:', dbLastUpdated)
            }
            cacheInitialized = true
        } catch (e) {
            console.error('[kansenindex] cache init error:', e)
        } finally {
            cacheInitPromise = null
        }
    })()
    return cacheInitPromise
}

// ---------------------------------------------------------------------------
// Static option data
// ---------------------------------------------------------------------------
const ALL_NATIONS = [
    'United Kingdom', 'United States', 'Japan', 'Germany', 'Soviet Union',
    'Italy', 'France', 'China', 'Netherlands', 'Russian Empire', 'Spain',
    'Australia', 'Sweden', 'Canada', 'Poland', 'Turkey', 'Thailand',
    'Mongolia', 'Chile', 'Iceland', 'Greece', 'Finland', 'Yugoslavia',
    'South Korea', 'Argentina', 'Norway', 'Fictional', 'Unknown',
]

const ALL_SHIP_TYPES = [
    'Destroyer', 'Light Cruiser', 'Heavy Cruiser', 'Battlecruiser', 'Battleship',
    'Light Carrier', 'Aircraft Carrier', 'Submarine', 'Aviation Battleship',
    'Repair Ship', 'Monitor', 'Aviation Submarine', 'Large Cruiser', 'Munition Ship',
    'Guided Missile Cruiser', 'Sailing Frigate', 'Aviation Cruiser',
    'Amphibious Assault Ship', 'Coastal Defense Ship',
]

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Shows a multi-select follow-up menu and returns the selected values array,
 * or null if the user timed out.
 */
async function handleMultiSelect(interaction, paramName, options, displayName) {
    const selectMenu = new MessageSelectMenu()
        .setCustomId(`ki_multi_${paramName}`)
        .setPlaceholder(`Select ${displayName}`)
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options.map(o => ({
            label: typeof o === 'string' ? o : o.label ?? o.name,
            value: typeof o === 'string' ? o : o.value ?? o.name,
        })))

    const row      = new MessageActionRow().addComponents(selectMenu)
    const selectMsg = await interaction.followUp({
        content: `Select ${displayName}:`,
        components: [row],
        fetchReply: true,
    })

    try {
        const sel = await selectMsg.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            componentType: 'SELECT_MENU',
            time: 60_000,
        })
        const values = sel.values
        await sel.update({
            content: `Selected ${displayName}: **${values.join(', ')}**`,
            components: [],
        })
        return values
    } catch {
        await selectMsg.edit({ content: `${displayName} selection timed out.`, components: [] }).catch(() => {})
        return null
    }
}

// ---------------------------------------------------------------------------
// MongoDB query builder (mirrors KansenIndex-web /api/shipgirl/query logic)
// ---------------------------------------------------------------------------

function buildSearchQuery({ keyword, keyword_mode, strict, franchises, nations, ship_types, outfit_type, rating, has_voice, illustrator }) {
    const q = { $and: [] }

    if (keyword) {
        const esc    = escapeRegExp(keyword)
        const prefix = strict ? '^' : ''
        const suffix = strict ? '$' : ''
        const rx     = { $regex: prefix + esc + suffix, $options: 'i' }

        if (!keyword_mode || keyword_mode === 'all') {
            q.$and.push({ $or: [{ char: rx }, { alias: rx }, { filename: rx }] })
        } else if (keyword_mode === 'char_name') {
            q.$and.push({ $or: [{ char: rx }, { alias: rx }] })
        } else if (keyword_mode === 'modifier') {
            q.$and.push({ filename: { $regex: '_.*' + esc, $options: 'i' } })
        } else if (keyword_mode === 'description') {
            q.$and.push({ description: { $elemMatch: rx } })
        }
    }

    if (illustrator) {
        const esc    = escapeRegExp(illustrator)
        const prefix = strict ? '^' : ''
        const suffix = strict ? '$' : ''
        q.$and.push({ $or: [
            { illust: { $regex: prefix + esc + suffix,          $options: 'i' } },
            { illust: { $regex: prefix + '\\? ' + esc + suffix, $options: 'i' } },
        ]})
    }

    if (franchises && franchises.length > 0) {
        const hasOthers    = franchises.includes('OTHERS')
        const realFranchises = franchises.filter(f => f !== 'OTHERS')
        const top23Names   = TOP_FRANCHISES

        if (hasOthers && realFranchises.length > 0) {
            q.$and.push({ $or: [
                { folder: { $in: realFranchises } },
                { folder: { $nin: top23Names } },
            ]})
        } else if (hasOthers) {
            q.$and.push({ folder: { $nin: top23Names } })
        } else {
            q.$and.push({ folder: { $in: realFranchises } })
        }
    }

    if (nations && nations.length > 0) {
        const hasUnknown  = nations.includes('Unknown')
        const knownNations = nations.filter(n => n !== 'Unknown')
        const or = []
        if (hasUnknown) or.push({ nation: null })
        knownNations.forEach(n => { or.push({ nation: n }); or.push({ nation: '? ' + n }) })
        q.$and.push({ $or: or })
    }

    if (ship_types && ship_types.length > 0) {
        const hasUnknown = ship_types.includes('Unknown')
        const knownTypes = ship_types.filter(t => t !== 'Unknown')
        const or = []
        if (hasUnknown) or.push({ ship_type: null })
        knownTypes.forEach(t => { or.push({ ship_type: t }); or.push({ ship_type: '? ' + t }) })
        q.$and.push({ $or: or })
    }

    if (outfit_type) {
        if (outfit_type === 'base')     q.is_base     = true
        else if (outfit_type === 'oath')     q.is_oath     = true
        else if (outfit_type === 'retrofit') q.is_retrofit = true
        else if (outfit_type === 'damage')   q.is_damage   = true
        else if (outfit_type === 'outfit')   q.is_outfit   = true
        else if (outfit_type === 'alt_only') q.is_base     = false
        else if (outfit_type === 'censored') q.is_censored = true
    }

    if (rating)    q.rating = rating
    if (has_voice) q.voice  = { $ne: null }

    if (!q.$and.length) delete q.$and
    return q
}

function buildSortOptions(sort_by) {
    const map = {
        date_new:    { file_modified_date: -1 },
        date_old:    { file_modified_date:  1 },
        char_asc:    { char:  1 },
        char_desc:   { char: -1 },
        size_large:  { file_size: -1 },
        size_small:  { file_size:  1 },
    }
    return map[sort_by] ?? {}
}

async function fetchResults(db_query, sort_by, limit = 50) {
    if (sort_by === 'random') {
        return aggregateRecord('shipgirl', [{ $match: db_query }, { $sample: { size: limit } }], true)
    }
    return queryRecordLimit('shipgirl', db_query, limit, {}, buildSortOptions(sort_by), 0, true)
}

// ---------------------------------------------------------------------------
// Button row builders
// ---------------------------------------------------------------------------

function buildSearchNavRow(index, total, hasVoice, disabled = false) {
    const btns = [
        new MessageButton()
            .setCustomId('ki_s_prev')
            .setLabel('◀ Prev')
            .setStyle('SECONDARY')
            .setDisabled(disabled || index === 0),
        new MessageButton()
            .setCustomId('ki_s_next')
            .setLabel('Next ▶')
            .setStyle('SECONDARY')
            .setDisabled(disabled || index >= total - 1),
    ]
    if (hasVoice) {
        btns.push(
            new MessageButton()
                .setCustomId('ki_s_voice')
                .setLabel('🔊 Voice Lines')
                .setStyle('SUCCESS')
                .setDisabled(disabled),
        )
    }
    return new MessageActionRow().addComponents(btns)
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// /kansenindex search
// ---------------------------------------------------------------------------

async function executeSearch(interaction, client) {
    await ensureCacheReady()
    const opts = interaction.options

    const keyword     = opts.getString('keyword')
    const keyword_mode = opts.getString('keyword_mode') ?? 'all'
    const strict      = opts.getBoolean('strict') ?? false
    const rawFranchise = opts.getString('franchise')
    const rawNation   = opts.getString('nation')
    const rawShipType = opts.getString('ship_type')
    const outfit_type = opts.getString('outfit_type')
    const rating      = opts.getString('rating')
    const has_voice   = opts.getBoolean('has_voice') ?? false
    const illustrator = opts.getString('illustrator')
    const sort_by     = opts.getString('sort_by') ?? 'date_new'

    await interaction.deferReply()
    const isNSFW = interaction.channel?.nsfw ?? false

    // --- Handle MULTIPLE franchise ---
    let franchises = null
    if (rawFranchise === 'MULTIPLE') {
        const franchiseOptions = [
            ...TOP_FRANCHISES.map(f => ({ label: f, value: f })),
            { label: 'Others', value: 'OTHERS' },
        ]
        franchises = await handleMultiSelect(interaction, 'franchise', franchiseOptions, 'franchises')
        if (!franchises) return  // timed out
    } else if (rawFranchise === 'OTHERS') {
        franchises = ['OTHERS']
    } else if (rawFranchise) {
        franchises = [rawFranchise]
    }

    // --- Handle MULTIPLE nation ---
    let nations = null
    if (rawNation === 'MULTIPLE') {
        nations = await handleMultiSelect(interaction, 'nation', ALL_NATIONS, 'nations')
        if (!nations) return
    } else if (rawNation) {
        nations = [rawNation]
    }

    // --- Handle MULTIPLE ship_type ---
    let ship_types = null
    if (rawShipType === 'MULTIPLE') {
        ship_types = await handleMultiSelect(interaction, 'ship_type', ALL_SHIP_TYPES, 'ship types')
        if (!ship_types) return
    } else if (rawShipType) {
        ship_types = [rawShipType]
    }

    // --- Query ---
    const db_query = buildSearchQuery({
        keyword, keyword_mode, strict, franchises, nations, ship_types,
        outfit_type: outfit_type ?? null,
        rating: rating ?? null,
        has_voice,
        illustrator,
    })

    let results
    try {
        results = await fetchResults(db_query, sort_by, 50)
    } catch (e) {
        console.error('[kansenindex] search query error:', e)
        return interaction.editReply('Database error while searching. Please try again later.')
    }

    if (!results || results.length === 0) {
        return interaction.editReply('No CGs found matching those filters.')
    }

    // --- Session ---
    const sessionKey = `ki_s_${interaction.user.id}_${interaction.channelId}`
    client.kansenindex_sessions.set(sessionKey, { results, currentIndex: 0 })

    // --- First result ---
    const { embed, attachment } = await buildResultEmbed(
        results[0], 0, results.length, isNSFW, 'search', dbLastUpdated
    )
    const row = buildSearchNavRow(0, results.length, results[0]?.voice != null)

    const reply = await interaction.editReply({
        embeds: [embed],
        files:  attachment ? [attachment] : [],
        components: [row],
    })

    // --- Collector ---
    const collector = reply.createMessageComponentCollector({ time: 300_000 })

    collector.on('collect', async btnInt => {
        if (btnInt.user.id !== interaction.user.id) {
            return btnInt.reply({ content: 'This is not your search session.', ephemeral: true })
        }
        const session = client.kansenindex_sessions.get(sessionKey)
        if (!session) {
            return btnInt.reply({ content: 'Session expired.', ephemeral: true })
        }

        if (btnInt.customId === 'ki_s_voice') {
            await btnInt.deferReply({ ephemeral: true })
            const cg = session.results[session.currentIndex]
            return sendVoiceLines(btnInt, cg.voice?.files ?? [])
        }

        if (btnInt.customId === 'ki_s_prev') {
            session.currentIndex = Math.max(0, session.currentIndex - 1)
        } else if (btnInt.customId === 'ki_s_next') {
            session.currentIndex = Math.min(session.results.length - 1, session.currentIndex + 1)
        }

        const { embed: newEmbed, attachment: newAtt } = await buildResultEmbed(
            session.results[session.currentIndex],
            session.currentIndex,
            session.results.length,
            isNSFW, 'search', dbLastUpdated
        )
        const newRow = buildSearchNavRow(session.currentIndex, session.results.length, session.results[session.currentIndex]?.voice != null)

        await btnInt.update({
            embeds: [newEmbed],
            files:  newAtt ? [newAtt] : [],
            attachments: [],
            components: [newRow],
        })
    })

    collector.on('end', () => {
        client.kansenindex_sessions.delete(sessionKey)
        reply.edit({ components: [buildSearchNavRow(0, 1, false, true)] }).catch(() => {})
    })
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kansenindex')
        .setDescription('Browse the KansenIndex shipgirl CG database')

        // ── /kansenindex search ───────────────────────────────────────────
        .addSubcommand(sub => sub
            .setName('search')
            .setDescription('Search and filter CGs from the KansenIndex database')
            .addStringOption(opt => opt
                .setName('keyword')
                .setDescription('Search by character name or filename')
                .setRequired(false))
            .addStringOption(opt => opt
                .setName('keyword_mode')
                .setDescription('What to match the keyword against (default: All Fields)')
                .setRequired(false)
                .addChoices(
                    { name: 'All Fields',            value: 'all' },
                    { name: 'Character Name',        value: 'char_name' },
                    { name: 'Modifier / Outfit Name', value: 'modifier' },
                    { name: 'Description Tags',      value: 'description' },
                ))
            .addStringOption(opt => opt
                .setName('franchise')
                .setDescription('Filter by game franchise')
                .setRequired(false)
                .addChoices(
                    { name: 'Multiple Types...',          value: 'MULTIPLE' },
                    { name: 'Azur Lane',                  value: 'Azur Lane' },
                    { name: 'Kantai Collection',          value: 'Kantai Collection' },
                    { name: 'Warship Girls R',            value: 'Warship Girls R' },
                    { name: 'Black Surgenights',          value: 'Black Surgenights' },
                    { name: 'Battleship Girl',            value: 'Battleship Girl' },
                    { name: 'Abyss Horizon',              value: 'Abyss Horizon' },
                    { name: 'Blue Oath',                  value: 'Blue Oath' },
                    { name: 'Axis Senki',                 value: 'Axis Senki' },
                    { name: 'Victory Belles',             value: 'Victory Belles' },
                    { name: 'Velvet Code',                value: 'Velvet Code' },
                    { name: 'Lane Girls',                 value: 'Lane Girls' },
                    { name: 'Shipgirls GO',               value: 'Shipgirls GO' },
                    { name: 'The Cute Warship',           value: 'The Cute Warship' },
                    { name: 'Battleship Bishoujo Puzzle', value: 'Battleship Bishoujo Puzzle' },
                    { name: 'Counter Arms',               value: 'Counter Arms' },
                    { name: 'Artist Original Content',    value: 'Artist Original Content' },
                    { name: 'Shipgirls Collection',       value: 'Shipgirls Collection' },
                    { name: 'Guardian Project',           value: 'Guardian Project' },
                    { name: 'Tales of Abyss',             value: 'Tales of Abyss' },
                    { name: 'Mirage of Steelblue',        value: 'Mirage of Steelblue' },
                    { name: 'Goddess Fleet',              value: 'Goddess Fleet' },
                    { name: 'Arpeggio of Blue Steel',     value: 'Arpeggio of Blue Steel' },
                    { name: 'Moe Moe World War II',       value: 'Moe Moe World War II' },
                    { name: 'Others',                     value: 'OTHERS' },
                ))
            .addStringOption(opt => opt
                .setName('nation')
                .setDescription('Filter by ship\'s nation')
                .setRequired(false)
                .addChoices(
                    { name: 'Multiple Types...', value: 'MULTIPLE' },
                    { name: 'United Kingdom',   value: 'United Kingdom' },
                    { name: 'United States',    value: 'United States' },
                    { name: 'Japan',            value: 'Japan' },
                    { name: 'Germany',          value: 'Germany' },
                    { name: 'Soviet Union',     value: 'Soviet Union' },
                    { name: 'Italy',            value: 'Italy' },
                    { name: 'France',           value: 'France' },
                    { name: 'China',            value: 'China' },
                    { name: 'Netherlands',      value: 'Netherlands' },
                    { name: 'Russian Empire',   value: 'Russian Empire' },
                    { name: 'Spain',            value: 'Spain' },
                    { name: 'Australia',        value: 'Australia' },
                    { name: 'Sweden',           value: 'Sweden' },
                    { name: 'Canada',           value: 'Canada' },
                    { name: 'Poland',           value: 'Poland' },
                    { name: 'Turkey',           value: 'Turkey' },
                    { name: 'Thailand',         value: 'Thailand' },
                    { name: 'Mongolia',         value: 'Mongolia' },
                    { name: 'Chile',            value: 'Chile' },
                    { name: 'Greece',           value: 'Greece' },
                    { name: 'Fictional',        value: 'Fictional' },
                    { name: 'Unknown',          value: 'Unknown' },
                ))
            .addStringOption(opt => opt
                .setName('ship_type')
                .setDescription('Filter by hull classification')
                .setRequired(false)
                .addChoices(
                    { name: 'Multiple Types...',        value: 'MULTIPLE' },
                    { name: 'Destroyer',                value: 'Destroyer' },
                    { name: 'Light Cruiser',            value: 'Light Cruiser' },
                    { name: 'Heavy Cruiser',            value: 'Heavy Cruiser' },
                    { name: 'Battlecruiser',            value: 'Battlecruiser' },
                    { name: 'Battleship',               value: 'Battleship' },
                    { name: 'Light Carrier',            value: 'Light Carrier' },
                    { name: 'Aircraft Carrier',         value: 'Aircraft Carrier' },
                    { name: 'Submarine',                value: 'Submarine' },
                    { name: 'Aviation Battleship',      value: 'Aviation Battleship' },
                    { name: 'Repair Ship',              value: 'Repair Ship' },
                    { name: 'Monitor',                  value: 'Monitor' },
                    { name: 'Aviation Submarine',       value: 'Aviation Submarine' },
                    { name: 'Large Cruiser',            value: 'Large Cruiser' },
                    { name: 'Munition Ship',            value: 'Munition Ship' },
                    { name: 'Guided Missile Cruiser',   value: 'Guided Missile Cruiser' },
                    { name: 'Sailing Frigate',          value: 'Sailing Frigate' },
                    { name: 'Aviation Cruiser',         value: 'Aviation Cruiser' },
                    { name: 'Amphibious Assault Ship',  value: 'Amphibious Assault Ship' },
                    { name: 'Coastal Defense Ship',     value: 'Coastal Defense Ship' },
                ))
            .addStringOption(opt => opt
                .setName('outfit_type')
                .setDescription('Filter by outfit/form type')
                .setRequired(false)
                .addChoices(
                    { name: 'Base Form Only',         value: 'base' },
                    { name: 'Oath / Wedding',         value: 'oath' },
                    { name: 'Retrofit',               value: 'retrofit' },
                    { name: 'Damage',                 value: 'damage' },
                    { name: 'Outfit / Skin',          value: 'outfit' },
                    { name: 'Alt Form Only (no base)', value: 'alt_only' },
                    { name: 'Censored',               value: 'censored' },
                ))
            .addStringOption(opt => opt
                .setName('rating')
                .setDescription('Filter by content rating')
                .setRequired(false)
                .addChoices(
                    { name: 'General',      value: 'general' },
                    { name: 'Sensitive',    value: 'sensitive' },
                    { name: 'Questionable', value: 'questionable' },
                    { name: 'Explicit',     value: 'explicit' },
                ))
            .addBooleanOption(opt => opt
                .setName('has_voice')
                .setDescription('Only include CGs that have voice lines')
                .setRequired(false))
            .addStringOption(opt => opt
                .setName('illustrator')
                .setDescription('Filter by illustrator / artist name')
                .setRequired(false))
            .addBooleanOption(opt => opt
                .setName('strict')
                .setDescription('Use exact match for keyword and illustrator')
                .setRequired(false))
            .addStringOption(opt => opt
                .setName('sort_by')
                .setDescription('Sort order of results (default: Newest First)')
                .setRequired(false)
                .addChoices(
                    { name: 'Newest First',     value: 'date_new' },
                    { name: 'Oldest First',     value: 'date_old' },
                    { name: 'Character (A→Z)',  value: 'char_asc' },
                    { name: 'Character (Z→A)',  value: 'char_desc' },
                    { name: 'Largest File',     value: 'size_large' },
                    { name: 'Smallest File',    value: 'size_small' },
                    { name: 'Random',           value: 'random' },
                ))
        ),


    // init() intentionally empty — DB is not yet connected at load time.
    // Cache is populated lazily on first command use via ensureCacheReady().
    init() {},

    // ── execute ───────────────────────────────────────────────────────────
    async execute(interaction, client) {
        return executeSearch(interaction, client)
    },
}
