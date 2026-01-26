const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageSelectMenu } = require('discord.js');
const sharp = require('sharp');
const levenshtein = require('fast-levenshtein');
const { aggregateRecord } = require('../database/database_interaction');

function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shipgirl_multi')
        .setDescription('Guess who is this shipgirl (multi-round mode)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('Stop the current quiz'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('pause')
                .setDescription('Pause the current quiz'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('resume')
                .setDescription('Resume the current quiz'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start a new quiz')
                .addNumberOption(option =>
                    option.setName('round')
                        .setDescription('Number of rounds (default 10) or lives in Survival mode (default 3)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('scoring_mode')
                        .setDescription('Specify the scoring mode for the quiz')
                        .addChoices(
                            { name: 'Classic', value: 'Classic' },
                            { name: 'Speed', value: 'Speed' },
                            { name: 'Survival', value: 'Survival' },
                        ))
                .addStringOption(option =>
                    option.setName('max_rating')
                        .setDescription('Maximum risque rating of shipgirls to be used (default: explicit)')
                        .addChoices(
                            { name: 'General', value: 'general' },
                            { name: 'Sensitive', value: 'sensitive' },
                            { name: 'Questionable', value: 'questionable' },
                            { name: 'Explicit', value: 'explicit' },
                        ))
                .addNumberOption(option =>
                    option.setName('time_multiplier')
                        .setDescription('Time limit multiplier (default: 1.0, e.g., 0.7 for faster, 1.5 for slower)')
                        .setMinValue(0.1)
                        .setMaxValue(5.0)
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('category')
                        .setDescription('Specify which series to be used for the quiz')
                        .addChoices(
                            { name: 'Multiple Types...', value: 'MULTIPLE' },
                            { name: 'Azur Lane', value: 'Azur Lane' },
                            { name: 'Kantai Collection', value: 'Kantai Collection' },
                            { name: 'Warship Girls R', value: 'Warship Girls R' },
                            { name: 'Axis Senki', value: 'Axis Senki' },
                            { name: 'Abyss Horizon', value: 'Abyss Horizon' },
                            { name: 'Black Surgenights', value: 'Black Surgenights' },
                            { name: 'Blue Oath', value: 'Blue Oath' },
                            { name: 'Velvet Code', value: 'Velvet Code' },
                            { name: 'Victory Belles', value: 'Victory Belles' },
                            { name: "Battleship Girl", value: "Battleship Girl" },
                            { name: "Battleship Bishoujo Puzzle", value: "Battleship Bishoujo Puzzle" },
                        ))
                .addBooleanOption(option =>
                    option.setName('hardmode')
                        .setDescription('Enables image processing modes (you will select after starting). Only works for specific series')
                )
                .addBooleanOption(option =>
                    option.setName('easymode')
                        .setDescription('Enables hint modes to make the quiz easier (you will select after starting)')
                )
                .addBooleanOption(option =>
                    option.setName('ranked_score')
                        .setDescription('Enable ranked scoring with multipliers based on difficulty settings')
                )
                .addStringOption(option =>
                    option.setName('nation')
                        .setDescription('Specify which nation to be used for the quiz, might be incorrect')
                        .addChoices(
                            { name: 'Multiple Types...', value: 'MULTIPLE' },
                            { name: 'United Kingdom', value: 'United Kingdom' },
                            { name: 'United States', value: 'United States' },
                            { name: 'Japan', value: 'Japan' },
                            { name: 'Germany', value: 'Germany' },
                            { name: 'Soviet Union', value: 'Soviet Union' },
                            { name: 'Italy', value: 'Italy' },
                            { name: 'France', value: 'France' },
                            { name: 'Minor Power', value: 'Minor Power' },
                            { name: 'Fictional', value: 'Fictional' },
                        )
                )
                .addStringOption(option =>
                    option.setName('hull_type')
                        .setDescription('Specify which hull type to be used for the quiz, might be incorrect')
                        .addChoices(
                            { name: 'Multiple Types...', value: 'MULTIPLE' },
                            { name: 'Destroyer', value: 'Destroyer' },
                            { name: 'Light Cruiser', value: 'Light Cruiser' },
                            { name: 'Heavy Cruiser', value: 'Heavy Cruiser' },
                            { name: 'Battlecruiser', value: 'Battlecruiser' },
                            { name: 'Battleship', value: 'Battleship' },
                            { name: 'Light Carrier', value: 'Light Carrier' },
                            { name: 'Aircraft Carrier', value: 'Aircraft Carrier' },
                            { name: 'Submarine', value: 'Submarine' },
                            { name: 'Aviation Battleship', value: 'Aviation Battleship' },
                            { name: 'Repair Ship', value: 'Repair Ship' },
                            { name: 'Monitor', value: 'Monitor' },
                            { name: 'Aviation Submarine', value: 'Aviation Submarine' },
                            { name: 'Large Cruiser', value: 'Large Cruiser' },
                            { name: 'Munition Ship', value: 'Munition Ship' },
                            { name: 'Guided Missile Cruiser', value: 'Guided Missile Cruiser' },
                            { name: 'Sailing Frigate', value: 'Sailing Frigate' },
                            { name: 'Aviation Cruiser', value: 'Aviation Cruiser' },
                            { name: 'Amphibious Assault Ship', value: 'Amphibious Assault Ship' },
                            { name: 'Coastal Defense Ship', value: 'Coastal Defense Ship' },
                        )
                )
        )
    ,

    async init() { },

    async execute(interaction, client) {

        let shipgirl_config = {}
        try {
            shipgirl_config = JSON.parse(client.shipgirl_quiz_config.get(interaction.user.id))
        }
        catch (e) {
            shipgirl_config = {}
        }

        /* multi-round quiz data format 
        key: user_id
        {
            round: number,
            current_round: number,
            category: string,
            hardmode: boolean,
            hardmode_options: string[],
            easymode: boolean,
            easymode_options: string[],
            base_only: boolean,
            nation: string,
            hull_type: string,
            max_rating: string,
            scoring_mode: string,
            time_multiplier: number,  // custom multiplier for time limit (0.1 to 5.0)
            ranked_score: boolean,  // enable score multipliers based on difficulty
            score_multiplier: number,  // calculated multiplier for ranked mode
            question_multipliers: number[],  // per-question multipliers for fallback adjustments
            quiz: [
                {
                    ship: string,
                    fr_name: string,
                    alias: string[]
                }
            ],  // this will be fetched from the database at once
            scores: Map<user_id, number>,
            lives: Map<user_id, number>,  // for survival mode
            participants: Set<user_id>,  // for survival mode, locked after first question
            is_survival: boolean
        }
        */
        if (interaction.options.getSubcommand() === 'stop') {
            interaction.reply('Quiz will be stopped after this round')

            // resolve the quiz binded to the user
            client.shipgirl_quiz_multi.delete(interaction.user.id)
            return
        }
        if (interaction.options.getSubcommand() === 'pause') {
            const quiz_data = client.shipgirl_quiz_multi.get(interaction.user.id)
            if (quiz_data) {
                client.shipgirl_quiz_multi.set(interaction.user.id, {
                    ...quiz_data,
                    is_paused: true
                })
                interaction.reply('Quiz will be paused after this round')
            }
            else {
                interaction.reply('There is no quiz to pause')
            }
            return
        }

        //parse option
        let quiz_data = null

        if (interaction.options.getSubcommand() === 'start') {
            let round = clamp(interaction.options.getNumber('round') || 10, 1, 100)
            
            // Load config values with priority: command options > config
            let category = interaction.options.getString('category') || (shipgirl_config.category ? shipgirl_config.category : null)
            const isHardmode = interaction.options.getBoolean('hardmode') || (shipgirl_config.hardmode ? shipgirl_config.hardmode : false)
            const isEasymode = interaction.options.getBoolean('easymode') || (shipgirl_config.easymode ? shipgirl_config.easymode : false)
            let nation = interaction.options.getString('nation') || (shipgirl_config.nation ? shipgirl_config.nation : null)
            let hull_type = interaction.options.getString('hull_type') || (shipgirl_config.hull_type ? shipgirl_config.hull_type : null)
            const scoring_mode = interaction.options.getString('scoring_mode') || 'Classic'
            const max_rating = interaction.options.getString('max_rating') || (shipgirl_config.max_rating ? shipgirl_config.max_rating : 'explicit')
            const is_survival = scoring_mode === 'Survival'
            const time_multiplier = interaction.options.getNumber('time_multiplier') || 1.0
            const ranked_score = interaction.options.getBoolean('ranked_score') || false
            
            // Check if config has pre-configured options
            const hasConfigHardmode = !interaction.options.getBoolean('hardmode') && shipgirl_config.hardmode && shipgirl_config.hardmode_options && shipgirl_config.hardmode_options.length > 0
            const hasConfigEasymode = !interaction.options.getBoolean('easymode') && shipgirl_config.easymode && shipgirl_config.easymode_options && shipgirl_config.easymode_options.length > 0
            const hasConfigCategory = !interaction.options.getString('category') && Array.isArray(shipgirl_config.category) && shipgirl_config.category.length > 0
            const hasConfigNation = !interaction.options.getString('nation') && Array.isArray(shipgirl_config.nation) && shipgirl_config.nation.length > 0
            const hasConfigHullType = !interaction.options.getString('hull_type') && Array.isArray(shipgirl_config.hull_type) && shipgirl_config.hull_type.length > 0

            // In survival mode, round parameter becomes number of lives
            let numLives = 3 // Default lives
            if (is_survival) {
                const inputLives = interaction.options.getNumber('round')
                numLives = inputLives ? clamp(inputLives, 1, 10) : 3 // Use round parameter as lives (1-10), default 3
                round = 999 // Set to a high number, will be unlimited in practice
            }

            //make a temporary reply to not get timeout'd

            await interaction.deferReply();

            // Helper function to handle multi-select for filter options
            const handleMultiSelect = async (paramName, currentValue, options, displayName) => {
                if (currentValue !== 'MULTIPLE') return currentValue

                const selectMenu = new MessageSelectMenu()
                    .setCustomId(`${paramName}_select`)
                    .setPlaceholder(`Select ${displayName}`)
                    .setMinValues(1)
                    .setMaxValues(Math.min(options.length, 25))
                    .addOptions(options.map(opt => ({
                        label: opt.name || opt,
                        value: opt.value || opt,
                    })))

                const row = new MessageActionRow().addComponents(selectMenu)

                const selectMessage = await interaction.followUp({
                    content: `Select one or more ${displayName}:`,
                    components: [row],
                    fetchReply: true,
                })

                try {
                    const selectInteraction = await selectMessage.awaitMessageComponent({
                        componentType: 'SELECT_MENU',
                        time: 60000,
                    })

                    const selectedValues = selectInteraction.values
                    await selectInteraction.update({
                        content: `Selected ${displayName}: ${selectedValues.join(', ')}`,
                        components: [],
                    })

                    return selectedValues
                } catch (error) {
                    await interaction.editReply(`${displayName} selection timed out, no filter will be applied`)
                    return null
                }
            }

            // Handle multiple category selection (skip if config has it)
            if (category === 'MULTIPLE' && !hasConfigCategory) {
                const categoryOptions = [
                    { name: 'Azur Lane', value: 'Azur Lane' },
                    { name: 'Kantai Collection', value: 'Kantai Collection' },
                    { name: 'Warship Girls R', value: 'Warship Girls R' },
                    { name: 'Axis Senki', value: 'Axis Senki' },
                    { name: 'Abyss Horizon', value: 'Abyss Horizon' },
                    { name: 'Black Surgenights', value: 'Black Surgenights' },
                    { name: 'Blue Oath', value: 'Blue Oath' },
                    { name: 'Velvet Code', value: 'Velvet Code' },
                    { name: 'Victory Belles', value: 'Victory Belles' },
                    { name: 'Battleship Girl', value: 'Battleship Girl' },
                    { name: 'Battleship Bishoujo Puzzle', value: 'Battleship Bishoujo Puzzle' },
                ]
                category = await handleMultiSelect('category', 'MULTIPLE', categoryOptions, 'categories')
            } else if (hasConfigCategory) {
                await interaction.followUp(`Using configured categories: ${shipgirl_config.category.join(', ')}`)
            }

            // Handle multiple nation selection (skip if config has it)
            if (nation === 'MULTIPLE' && !hasConfigNation) {
                const nationOptions = [
                    { name: 'United Kingdom', value: 'United Kingdom' },
                    { name: 'United States', value: 'United States' },
                    { name: 'Japan', value: 'Japan' },
                    { name: 'Germany', value: 'Germany' },
                    { name: 'Soviet Union', value: 'Soviet Union' },
                    { name: 'Italy', value: 'Italy' },
                    { name: 'France', value: 'France' },
                    { name: 'Minor Power', value: 'Minor Power' },
                    { name: 'Fictional', value: 'Fictional' },
                ]
                nation = await handleMultiSelect('nation', 'MULTIPLE', nationOptions, 'nations')
            } else if (hasConfigNation) {
                await interaction.followUp(`Using configured nations: ${shipgirl_config.nation.join(', ')}`)
            }

            // Handle multiple hull_type selection (skip if config has it)
            if (hull_type === 'MULTIPLE' && !hasConfigHullType) {
                const hullTypeOptions = [
                    { name: 'Destroyer', value: 'Destroyer' },
                    { name: 'Light Cruiser', value: 'Light Cruiser' },
                    { name: 'Heavy Cruiser', value: 'Heavy Cruiser' },
                    { name: 'Battlecruiser', value: 'Battlecruiser' },
                    { name: 'Battleship', value: 'Battleship' },
                    { name: 'Light Carrier', value: 'Light Carrier' },
                    { name: 'Aircraft Carrier', value: 'Aircraft Carrier' },
                    { name: 'Submarine', value: 'Submarine' },
                    { name: 'Aviation Battleship', value: 'Aviation Battleship' },
                    { name: 'Repair Ship', value: 'Repair Ship' },
                    { name: 'Monitor', value: 'Monitor' },
                    { name: 'Aviation Submarine', value: 'Aviation Submarine' },
                    { name: 'Large Cruiser', value: 'Large Cruiser' },
                    { name: 'Munition Ship', value: 'Munition Ship' },
                    { name: 'Guided Missile Cruiser', value: 'Guided Missile Cruiser' },
                    { name: 'Sailing Frigate', value: 'Sailing Frigate' },
                    { name: 'Aviation Cruiser', value: 'Aviation Cruiser' },
                    { name: 'Amphibious Assault Ship', value: 'Amphibious Assault Ship' },
                    { name: 'Coastal Defense Ship', value: 'Coastal Defense Ship' },
                ]
                hull_type = await handleMultiSelect('hull_type', 'MULTIPLE', hullTypeOptions, 'hull types')
            } else if (hasConfigHullType) {
                await interaction.followUp(`Using configured hull types: ${shipgirl_config.hull_type.join(', ')}`)
            }

            // If hardmode is enabled, prompt user to select processing modes (skip if config has it)
            let hardmode_options = []
            if (isHardmode && !hasConfigHardmode) {
                const selectMenu = new MessageSelectMenu()
                    .setCustomId('hardmode_select')
                    .setPlaceholder('Select image processing modes')
                    .setMinValues(1)
                    .setMaxValues(9)
                    .addOptions([
                        {
                            label: 'Silhouette',
                            description: 'Convert image to black silhouette',
                            value: 'silhouette',
                        },
                        {
                            label: 'Crop Center',
                            description: 'Show only center 1/9 of the image',
                            value: 'crop_center',
                        },
                        {
                            label: 'Crop Random',
                            description: 'Show random 1/9 section of the image',
                            value: 'crop_random',
                        },
                        {
                            label: 'Crop Center Extreme',
                            description: 'Show only center 1/25 of the image',
                            value: 'crop_center_extreme',
                        },
                        {
                            label: 'Crop Random Extreme',
                            description: 'Show random 1/25 section of the image',
                            value: 'crop_random_extreme',
                        },
                        {
                            label: 'Crop Head',
                            description: 'Show head + hair area (1.02x, fallback: random)',
                            value: 'crop_head',
                        },
                        {
                            label: 'Crop Face',
                            description: 'Show face area (1.08x, fallback: random)',
                            value: 'crop_face',
                        },
                        {
                            label: 'Crop Breast',
                            description: 'Show breast area (1.17x, fallback: random extreme)',
                            value: 'crop_breast',
                        },
                        {
                            label: 'Crop Eyes',
                            description: 'Show eyes area (1.15x, fallback: random extreme)',
                            value: 'crop_eyes',
                        },
                    ])

                const row = new MessageActionRow().addComponents(selectMenu)
                const selectMessage = await interaction.followUp({
                    content: 'Select one or more hardmode options:',
                    components: [row],
                    fetchReply: true,
                })

                try {
                    const selectInteraction = await selectMessage.awaitMessageComponent({
                        componentType: 'SELECT_MENU',
                        time: 60000,
                    })

                    hardmode_options = selectInteraction.values

                    // Check if combining crop and silhouette modes
                    const hasCrop = hardmode_options.some(opt => opt.startsWith('crop_'))
                    const hasSilhouette = hardmode_options.includes('silhouette')
                    let warningMsg = `Selected modes: ${hardmode_options.join(', ')}`

                    if (hasCrop && hasSilhouette) {
                        warningMsg += '\n⚠️ **Warning:** Combining crop and silhouette modes will make the quiz EXTREMELY difficult!'
                    }

                    await selectInteraction.update({
                        content: warningMsg,
                        components: [],
                    })
                } catch (error) {
                    await interaction.editReply('Hardmode selection timed out, defaulting to silhouette mode')
                    hardmode_options = ['silhouette']
                }
            } else if (hasConfigHardmode) {
                hardmode_options = shipgirl_config.hardmode_options
                await interaction.followUp(`Using configured hardmode options: ${hardmode_options.join(', ')}`)
            }

            // If easymode is enabled, prompt user to select hint modes (skip if config has it)
            let easymode_options = []
            let requireBase = shipgirl_config.base_only || false
            if (isEasymode && !hasConfigEasymode) {
                const easymodeSelectMenu = new MessageSelectMenu()
                    .setCustomId('easymode_select')
                    .setPlaceholder('Select hint modes')
                    .setMinValues(1)
                    .setMaxValues(7)
                    .addOptions([
                        {
                            label: 'Name Hint',
                            description: 'Show answer masked with underscores (e.g., "_ _ _ _ _")',
                            value: 'name_hint',
                        },
                        {
                            label: 'Progressive Name Hint',
                            description: 'Gradually reveal characters at 25% and 60% time marks',
                            value: 'progressive_name_hint',
                        },
                        {
                            label: 'Nation Hint',
                            description: 'Show the nation of the ship',
                            value: 'nation_hint',
                        },
                        {
                            label: 'Hull Type Hint',
                            description: 'Show the hull type of the ship',
                            value: 'hull_type_hint',
                        },
                        {
                            label: 'Category Hint',
                            description: 'Show the series/category of the ship',
                            value: 'category_hint',
                        },
                        {
                            label: 'Base Only',
                            description: 'Only show base forms (no alternative outfits)',
                            value: 'base_only',
                        },
                        {
                            label: 'Description Hint',
                            description: 'Show description tags after 30% time (requires hardmode)',
                            value: 'description_hint',
                        },
                    ])

                const easymodeRow = new MessageActionRow().addComponents(easymodeSelectMenu)

                const easymodeSelectMessage = await interaction.followUp({
                    content: 'Select one or more easy mode options:',
                    components: [easymodeRow],
                    fetchReply: true,
                })

                try {
                    const easymodeSelectInteraction = await easymodeSelectMessage.awaitMessageComponent({
                        componentType: 'SELECT_MENU',
                        time: 60000,
                    })

                    easymode_options = easymodeSelectInteraction.values

                    // Check if base_only is selected
                    if (easymode_options.includes('base_only')) {
                        requireBase = true
                    }

                    // Check if description_hint is selected without hardmode
                    if (easymode_options.includes('description_hint') && !isHardmode) {
                        await easymodeSelectInteraction.update({
                            content: `Selected modes: ${easymode_options.join(', ')}\n⚠️ **Warning:** Description hint requires hardmode to be enabled. It will be ignored.`,
                            components: [],
                        })
                        easymode_options = easymode_options.filter(opt => opt !== 'description_hint')
                    } else {
                        await easymodeSelectInteraction.update({
                            content: `Selected modes: ${easymode_options.join(', ')}`,
                            components: [],
                        })
                    }
                } catch (error) {
                    await interaction.editReply('Easymode selection timed out, no hints will be provided')
                    easymode_options = []
                }
            } else if (hasConfigEasymode) {
                easymode_options = shipgirl_config.easymode_options
                await interaction.followUp(`Using configured easymode options: ${easymode_options.join(', ')}`)
                
                // Check if base_only is in the config
                if (easymode_options.includes('base_only')) {
                    requireBase = true
                }
            }

            //select a question (randomly)

            //let { fr_name, ship } = get_random_selection(category, requireBase)

            let db_query = {
                $and: []
            }

            const hardmode_allow_list = ['Azur Lane', 'Kantai Collection', 'Akushizu Senki', 'Abyss Horizon', 'Black Surgenights', 'Blue Oath', 'Velvet Code', 'Battleship Bishoujo Puzzle']

            const non_minor_power_nation = ['United Kingdom', 'United States', 'Japan', 'Germany', 'Soviet Union', 'Italy', 'France', 'Fictional']

            if (isHardmode) {
                // match folder against hardmode allow list
                db_query.folder = { $in: hardmode_allow_list }
            }
            if (category) {
                // Handle both single string and array of categories
                if (Array.isArray(category)) {
                    db_query.folder = { $in: category }
                } else {
                    db_query.folder = category
                }
            }
            if (nation) {
                // Handle both single string and array of nations
                if (Array.isArray(nation)) {
                    // Multiple nations selected
                    const nationQueries = []
                    let hasMinorPower = false

                    nation.forEach(n => {
                        if (n === 'Minor Power') {
                            hasMinorPower = true
                        } else {
                            nationQueries.push({ nation: n })
                            nationQueries.push({ nation: "? " + n })
                        }
                    })

                    if (hasMinorPower) {
                        // Add Minor Power logic
                        nationQueries.push({
                            $and: non_minor_power_nation.map(val => {
                                return {
                                    $not: {
                                        $or: [
                                            { nation: val },
                                            { nation: "? " + val }
                                        ]
                                    }
                                }
                            }).concat([
                                { nation: { $exists: false } }
                            ])
                        })
                    }

                    if (nationQueries.length > 0) {
                        db_query.$and.push({ $or: nationQueries })
                    }
                } else {
                    // Single nation selected (original logic)
                    if (nation === 'Minor Power') {
                        db_query.$and.push({
                            $or: non_minor_power_nation.map(val => {
                                return {
                                    $not: {
                                        $or: [
                                            { nation: val },
                                            { nation: "? " + val }
                                        ]
                                    }
                                }
                            }).concat([
                                { nation: { $exists: false } }
                            ])
                        })
                    }
                    else {
                        db_query.$and.push({
                            $or: [
                                // any element in nation field is query.nation or query.nation with question mark
                                { nation: nation },
                                { nation: "? " + nation }
                            ]
                        })
                    }
                }
            }
            if (hull_type) {
                // Handle both single string and array of hull types
                if (Array.isArray(hull_type)) {
                    const hullTypeQueries = []
                    hull_type.forEach(ht => {
                        hullTypeQueries.push({ ship_type: ht })
                        hullTypeQueries.push({ ship_type: "? " + ht })
                    })
                    db_query.$and.push({ $or: hullTypeQueries })
                } else {
                    db_query.$and.push({
                        $or: [
                            { ship_type: hull_type },
                            { ship_type: "? " + hull_type }
                        ]
                    })
                }
            }

            if (requireBase) {
                db_query.is_base = true
            }
            if (max_rating) {
                const rating_order = ['general', 'sensitive', 'questionable', 'explicit']
                const max_index = rating_order.indexOf(max_rating)
                if (max_index !== -1) {
                    const allowed_ratings = rating_order.slice(0, max_index + 1)
                    db_query.rating = { $in: allowed_ratings }
                }
            }

            // if db_query.$and is empty, remove it
            if (!db_query.$and.length) {
                delete db_query.$and
            }
            // console.dir(db_query, {depth: null})

            // First, count total possible questions for ranked score calculation
            const count_agg = [
                { $match: db_query },
                { $count: 'total' }
            ]

            let count_res = await aggregateRecord('shipgirl', count_agg, /*use_ext*/ true)
                .catch(e => {
                    console.log(e)
                })

            const totalQuestionCount = (count_res && count_res[0]) ? count_res[0].total : 0

            // make aggregate pipeline to get the random ship with the query
            const db_agg = [
                { $match: db_query },
                { $sample: { size: round } }
            ]

            let query_res = await aggregateRecord('shipgirl', db_agg, /*use_ext*/ true)
                .catch(e => {
                    console.log(e)
                })

            if (!query_res || query_res.length === 0) {
                await interaction.editReply({ content: 'Sorry, i can\'t get a new quiz for you :(' })
                return
            }

            if (!is_survival && query_res.length < round) {
                interaction.channel.send(`Only ${query_res.length} questions available, truncating the round to ${query_res.length}`)
                round = query_res.length
            }
            else if (is_survival && query_res.length < 50) {
                await interaction.editReply({ content: 'Not enough questions for survival mode (need at least 50)' })
                return
            }

            // Calculate score multiplier for ranked mode
            let score_multiplier = 1.0
            let multiplier_breakdown = {}

            if (ranked_score) {
                // 1. Question pool multiplier (baseline: 1000 questions = 1.0x)
                const questionCount = totalQuestionCount
                let poolMultiplier = 1.0
                if (questionCount < 1000) {
                    poolMultiplier = Math.sqrt(questionCount / 1000)
                } else {
                    poolMultiplier = 1 + (questionCount - 1000) / 50000
                }
                multiplier_breakdown.pool = poolMultiplier

                // 2. Hardmode multipliers
                let hardmodeMultiplier = 1.0
                if (isHardmode && hardmode_options.length > 0) {
                    const hardmodeValues = {
                        'silhouette': 1.2,
                        'crop_center': 1.1,
                        'crop_random': 1.12,
                        'crop_center_extreme': 1.2,
                        'crop_random_extreme': 1.25,
                        'crop_head': 1.02,
                        'crop_face': 1.08,
                        'crop_breast': 1.17,
                        'crop_eyes': 1.15
                    }

                    // Apply highest hardmode multiplier
                    hardmodeMultiplier = Math.max(...hardmode_options.map(opt => hardmodeValues[opt] || 1.0))
                    multiplier_breakdown.hardmode = hardmodeMultiplier
                    multiplier_breakdown.hardmode_selected = hardmode_options
                }

                // 3. Easymode multipliers (multiplicative reduction)
                let easymodeMultiplier = 1.0
                if (isEasymode && easymode_options.length > 0) {
                    const easymodeValues = {
                        'name_hint': 0.75,
                        'progressive_name_hint': 0.4,
                        'nation_hint': 0.7,
                        'hull_type_hint': 0.7,
                        'category_hint': 0.8,
                        'description_hint': 0.7,
                        'base_only': 0.5
                    }

                    // Multiply all easymode reductions together
                    easymode_options.forEach(opt => {
                        if (easymodeValues[opt]) {
                            easymodeMultiplier *= easymodeValues[opt]
                        }
                    })
                    multiplier_breakdown.easymode = easymodeMultiplier
                    multiplier_breakdown.easymode_selected = easymode_options
                }

                // 4. Time multiplier adjustment: (2/(x+0.5)) - 1/3
                const timeScoreMultiplier = Math.round(((2 / (time_multiplier + 0.5)) - (1 / 3)) * 100) / 100
                multiplier_breakdown.time = timeScoreMultiplier

                // Final multiplier
                score_multiplier = poolMultiplier * hardmodeMultiplier * easymodeMultiplier * timeScoreMultiplier
                score_multiplier = Math.round(score_multiplier * 100) / 100

                // Send multiplier breakdown message
                const breakdownMsg = `**📊 Ranked Score Multipliers:**\n` +
                    `• Question Pool: ${questionCount} questions → **x${poolMultiplier.toFixed(2)}**\n` +
                    (isHardmode ? `• Hardmode (${hardmode_options.join(', ')}): **x${hardmodeMultiplier.toFixed(2)}**\n` : '') +
                    (isEasymode ? `• Easymode (${easymode_options.join(', ')}): **x${easymodeMultiplier.toFixed(2)}**\n` : '') +
                    `• Time Limit (${time_multiplier}x): **x${timeScoreMultiplier.toFixed(2)}**\n` +
                    `\n**Total Score Multiplier: x${score_multiplier.toFixed(2)}**`

                await interaction.channel.send(breakdownMsg)
            }


            // let ship = {
            // 	char: query_res[0].char,
            // 	filename: './resources/shipgirls/' + query_res[0].folder + '/' + query_res[0].filename,
            // 	is_base: query_res[0].is_base
            // }
            // let fr_name = query_res[0].folder
            // let alias = query_res[0].alias || []
            // let alias_lowercase = alias.map(val => val.toLowerCase())

            // create the quiz multi object
            quiz_data = {
                round: round,
                current_round: 0,
                category: category,
                hardmode: isHardmode,
                hardmode_options: hardmode_options,
                easymode: isEasymode,
                easymode_options: easymode_options,
                base_only: requireBase,
                nation: nation,
                hull_type: hull_type,
                max_rating: max_rating,
                scoring_mode: scoring_mode,
                is_survival: is_survival,
                numLives: numLives,
                time_multiplier: time_multiplier,
                ranked_score: ranked_score,
                score_multiplier: score_multiplier,
                question_multipliers: new Array(round).fill(score_multiplier),
                quiz: query_res.map(val => {
                    return {
                        ship: {
                            char: val.char,
                            filename: './resources/shipgirls/' + val.folder + '/' + val.filename,
                            is_base: val.is_base,
                            nation: val.nation,
                            ship_type: val.ship_type,
                            description: val.description,
                            body_crop: val.body_crop || {}
                        },
                        fr_name: val.folder,
                        alias: val.alias || [],
                        alias_lowercase: (val.alias || []).map(val => val.toLowerCase())
                    }
                }),
                scores: new Map(),
                lives: new Map(),
                participants: new Set(),
                is_paused: false
            }

            client.shipgirl_quiz_multi.set(interaction.user.id, quiz_data)
            if (is_survival) {
                interaction.editReply(`Survival mode starting! Answer the first question to join. You have ${numLives} lives. No round limit!`)
            } else {
                interaction.editReply('Quiz starting now')
            }
        }
        else if (interaction.options.getSubcommand() === 'resume') {
            quiz_data = client.shipgirl_quiz_multi.get(interaction.user.id)
            if (quiz_data) {
                client.shipgirl_quiz_multi.set(interaction.user.id, {
                    ...quiz_data,
                    is_paused: false
                })
                interaction.reply('Quiz resuming now')
            }
            else {
                interaction.reply('There is no quiz to resume')
            }
        }

        if (!quiz_data) {
            await interaction.channel.send('How does this happened?')
            return
        }

        // For survival mode, add 30-second preparation phase before first question
        if (quiz_data.is_survival && quiz_data.current_round === 0) {
            const prepMessage = await interaction.channel.send('⏱️ **30 seconds to join!** Send any message in this channel to participate in the survival quiz!\n*(Host can type "start" to begin early)*')

            const prepCollector = interaction.channel.createMessageCollector({ time: 30000 })
            let earlyStart = false

            prepCollector.on('collect', m => {
                if (!m.author.bot) {
                    quiz_data.participants.add(m.author.id)

                    // Check if host typed "start" to skip delay
                    if (m.author.id === interaction.user.id && m.content.toLowerCase().trim() === 'start') {
                        earlyStart = true
                        prepCollector.stop()
                    }
                }
            })

            await new Promise(resolve => {
                prepCollector.on('end', () => {
                    const playerCount = quiz_data.participants.size
                    const startMsg = earlyStart ? '🚀 **Starting early!**' : '🎮'
                    interaction.channel.send(`${startMsg} **${playerCount} player${playerCount !== 1 ? 's' : ''} registered!** Starting the quiz now...`)
                    resolve()
                })
            })
        }

        for (let i = quiz_data.current_round; i < quiz_data.round; i++) {
            // check if the quiz is still active
            if (!client.shipgirl_quiz_multi.has(interaction.user.id)) {
                await interaction.channel.send('Quiz has been stopped')
                break;
            }
            if (client.shipgirl_quiz_multi.get(interaction.user.id).is_paused) {
                await interaction.channel.send('Quiz has been paused')
                break;
            }

            // For survival mode, check if all players are out of lives
            if (quiz_data.is_survival && quiz_data.current_round > 0) {
                const activePlayers = [...quiz_data.lives.entries()].filter(([_, lives]) => lives > 0)
                if (activePlayers.length === 0) {
                    await interaction.channel.send('All players have been eliminated! Game over!')
                    break;
                }
            }

            const roundDisplay = quiz_data.is_survival
                ? `Round ${i + 1}`
                : `Next question (${i + 1}/${quiz_data.round})`
            interaction.channel.send(roundDisplay)

            let { ship, fr_name, alias, alias_lowercase } = quiz_data.quiz[i]
            let img = null
            let img_base = null
            const cur_scores = quiz_data.scores

            //resize and process the image (if hardmode is selected)
            if (quiz_data.hardmode && quiz_data.hardmode_options.length > 0) {
                // Check if combining crop and silhouette
                const hasCrop = quiz_data.hardmode_options.some(opt => opt.startsWith('crop_'))
                const hasSilhouette = quiz_data.hardmode_options.includes('silhouette')
                const combineMode = hasCrop && hasSilhouette

                // Start with base image - resize now if no crop mode (saves compute time)
                let imgSharp = sharp(ship.filename)
                if (!hasCrop) {
                    imgSharp = imgSharp.resize({ height: 512 })
                }

                img_base = await imgSharp.png().toBuffer()

                // Determine which crop mode to apply
                let selectedCropMode = null
                let fallbackMode = null
                let appliedMultiplier = 1.0

                // Check for body crop modes first
                const bodyCropModes = ['crop_head', 'crop_face', 'crop_breast', 'crop_eyes']
                const selectedBodyCrop = quiz_data.hardmode_options.find(opt => bodyCropModes.includes(opt))

                if (selectedBodyCrop) {
                    // Body crop mode selected
                    const bodyCropField = selectedBodyCrop.replace('crop_', '')
                    const bodyCropData = ship.body_crop && ship.body_crop[bodyCropField]

                    if (bodyCropData && Array.isArray(bodyCropData) && bodyCropData.length === 4) {
                        // Body crop data available
                        selectedCropMode = selectedBodyCrop
                    } else {
                        // Need fallback
                        if (bodyCropField === 'head' || bodyCropField === 'face') {
                            fallbackMode = 'crop_random'
                        } else { // breast or eyes
                            fallbackMode = 'crop_random_extreme'
                        }
                        selectedCropMode = fallbackMode
                    }
                } else {
                    // Apply priority logic for standard crop modes (priority: random > center, extreme > normal)
                    if (quiz_data.hardmode_options.includes('crop_random_extreme')) {
                        selectedCropMode = 'crop_random_extreme'
                    } else if (quiz_data.hardmode_options.includes('crop_center_extreme')) {
                        selectedCropMode = 'crop_center_extreme'
                    } else if (quiz_data.hardmode_options.includes('crop_random')) {
                        selectedCropMode = 'crop_random'
                    } else if (quiz_data.hardmode_options.includes('crop_center')) {
                        selectedCropMode = 'crop_center'
                    }
                }

                // Get image metadata for crop operations
                const metadata = await sharp(img_base).metadata()
                const width = metadata.width
                const height = metadata.height

                // Helper function to validate and create silhouette
                const validateAndCreateSilhouette = async (buffer) => {
                    try {
                        const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
                        let transparentPixelCount = 0
                        const totalPixels = info.width * info.height

                        for (let i = 0; i < data.length; i += info.channels) {
                            // Check if pixel is fully transparent (alpha channel = 0)
                            if (info.channels === 4) {
                                const alpha = data[i + 3]
                                if (alpha === 0) {
                                    transparentPixelCount++
                                }
                            }
                        }

                        const transparentPixelRatio = transparentPixelCount / totalPixels

                        if (transparentPixelRatio < 0.25) {
                            // Too little transparent pixels (background fills canvas), invalid for silhouette
                            return null
                        }

                        // Validation passed, convert to silhouette
                        const silhouetteBuffer = await sharp(buffer)
                            .modulate({
                                brightness: 0,
                                saturation: 0,
                            })
                            .png()
                            .toBuffer()

                        return silhouetteBuffer
                    } catch (error) {
                        console.error('Silhouette validation error:', error)
                        return null
                    }
                }

                // Helper function to validate crop area
                const validateCropArea = async (buffer, relaxed = false) => {
                    try {
                        const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })

                        // If relaxed mode (for combine mode), only check for 2 colors
                        if (relaxed) {
                            const colorSet = new Set()
                            for (let i = 0; i < data.length; i += info.channels) {
                                const colorKey = `${data[i]},${data[i + 1]},${data[i + 2]}`
                                colorSet.add(colorKey)
                                if (colorSet.size >= 2) {
                                    return true
                                }
                            }
                            return colorSet.size >= 2
                        }

                        // Standard validation: check center pixel and color diversity
                        const centerX = Math.floor(info.width / 2)
                        const centerY = Math.floor(info.height / 2)
                        const centerIdx = (centerY * info.width + centerX) * info.channels

                        // Check if center is transparent
                        if (info.channels === 4 && data[centerIdx + 3] < 128) {
                            return false
                        }

                        // Check if center is white
                        const r = data[centerIdx]
                        const g = data[centerIdx + 1]
                        const b = data[centerIdx + 2]
                        if (r > 250 && g > 250 && b > 250) {
                            return false
                        }

                        // Check color diversity (need at least 2 distinct colors)
                        const colorSet = new Set()
                        for (let i = 0; i < data.length; i += info.channels) {
                            const colorKey = `${data[i]},${data[i + 1]},${data[i + 2]}`
                            colorSet.add(colorKey)
                            if (colorSet.size >= 2) {
                                return true
                            }
                        }

                        return colorSet.size >= 2
                    } catch (error) {
                        console.error('Validation error:', error)
                        return false
                    }
                }

                // Process based on selected mode
                if (selectedCropMode) {
                    // Notify about fallback if applicable
                    if (fallbackMode) {
                        const hardmodeValues = {
                            'crop_random': 1.12,
                            'crop_random_extreme': 1.25
                        }
                        appliedMultiplier = hardmodeValues[fallbackMode] || 1.0
                        await interaction.channel.send(`⚠️ Body crop data not available, falling back to **${fallbackMode.replace('crop_', '').replace('_', ' ')}** mode for this question (multiplier: x${appliedMultiplier})`)
                    } else {
                        const hardmodeValues = {
                            'silhouette': 1.2,
                            'crop_center': 1.1,
                            'crop_random': 1.12,
                            'crop_center_extreme': 1.2,
                            'crop_random_extreme': 1.25,
                            'crop_head': 1.02,
                            'crop_face': 1.08,
                            'crop_breast': 1.17,
                            'crop_eyes': 1.15
                        }
                        appliedMultiplier = hardmodeValues[selectedCropMode] || 1.0
                    }

                    // Update question multiplier for ranked mode
                    if (quiz_data.ranked_score && fallbackMode) {
                        // Recalculate multiplier with fallback hardmode value
                        const baseMultiplier = quiz_data.score_multiplier / multiplier_breakdown.hardmode
                        quiz_data.question_multipliers[i] = baseMultiplier * appliedMultiplier
                    }

                    // Check if this is a body crop mode
                    const isBodyCrop = selectedCropMode.startsWith('crop_') &&
                        ['crop_head', 'crop_face', 'crop_breast', 'crop_eyes'].includes(selectedCropMode)

                    let cropX, cropY, cropWidth, cropHeight

                    if (isBodyCrop && !fallbackMode) {
                        // Use body crop coordinates
                        const bodyCropField = selectedCropMode.replace('crop_', '')
                        const [x1, y1, x2, y2] = ship.body_crop[bodyCropField]

                        // Calculate crop area with multiplier
                        const centerX = (x1 + x2) / 2
                        const centerY = (y1 + y2) / 2
                        const baseWidth = x2 - x1
                        const baseHeight = y2 - y1

                        cropWidth = Math.floor(baseWidth * appliedMultiplier)
                        cropHeight = Math.floor(baseHeight * appliedMultiplier)
                        cropX = Math.max(0, Math.floor(centerX - cropWidth / 2))
                        cropY = Math.max(0, Math.floor(centerY - cropHeight / 2))

                        // Ensure crop doesn't exceed image bounds
                        if (cropX + cropWidth > width) cropX = width - cropWidth
                        if (cropY + cropHeight > height) cropY = height - cropHeight

                        // Extract and validate crop
                        const testCrop = await sharp(img_base)
                            .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
                            .png()
                            .toBuffer()

                        // if its not a body crop, validate the crop area
                        let validCrop = true
                        if (!isBodyCrop) {
                            validCrop = await validateCropArea(testCrop, combineMode)
                        }

                        if (validCrop) {
                            if (combineMode) {
                                const silhouetteResult = await validateAndCreateSilhouette(testCrop)
                                if (silhouetteResult) {
                                    img = silhouetteResult
                                } else {
                                    img = testCrop
                                }
                            } else {
                                img = testCrop
                            }
                        } else {
                            // Body crop validation failed, skip question
                            console.log('Body crop validation failed, skipping question')
                            await interaction.channel.send('Body crop area unsuitable, skipping this question')
                            continue
                        }
                    } else {
                        // Standard crop modes
                        const isExtreme = selectedCropMode.includes('extreme')
                        const isRandom = selectedCropMode.includes('random')

                        const divisor = isExtreme ? 25 : 9
                        const sqrtDivisor = Math.sqrt(divisor)
                        cropWidth = Math.floor(width / sqrtDivisor)
                        cropHeight = Math.floor(height / sqrtDivisor)

                        let validCrop = false
                        let attempts = 0
                        const maxAttempts = 20

                        // Try to find a valid crop area
                        while (!validCrop && attempts < maxAttempts) {
                            if (isRandom) {
                                // Random position
                                const maxX = width - cropWidth
                                const maxY = height - cropHeight
                                cropX = Math.floor(Math.random() * maxX)
                                cropY = Math.floor(Math.random() * maxY)
                            } else {
                                // Center position
                                cropX = Math.floor((width - cropWidth) / 2)
                                cropY = Math.floor((height - cropHeight) / 2)
                            }

                            // Extract crop and validate
                            const testCrop = await sharp(img_base)
                                .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
                                .png()
                                .toBuffer()

                            validCrop = await validateCropArea(testCrop, combineMode)

                            if (validCrop) {
                                // Apply silhouette if combine mode, otherwise just use crop
                                if (combineMode) {
                                    const silhouetteResult = await validateAndCreateSilhouette(testCrop)
                                    if (silhouetteResult) {
                                        img = silhouetteResult
                                    } else {
                                        // Silhouette validation failed, just use the crop
                                        img = testCrop
                                    }
                                } else {
                                    img = testCrop
                                }
                                break
                            }

                            attempts++
                            // For center crop, don't retry since position is fixed
                            if (!isRandom) break
                        }

                        // If no valid crop found, fall back to silhouette (if selected) or skip question
                        if (!validCrop) {
                            console.log(`Failed to find valid crop area after ${attempts} attempts`)
                            if (hasSilhouette) {
                                console.log('Falling back to silhouette mode')
                                const silhouetteResult = await validateAndCreateSilhouette(img_base)
                                if (silhouetteResult) {
                                    img = silhouetteResult
                                } else {
                                    console.log('Silhouette validation also failed, skipping question')
                                    await interaction.channel.send('Image unsuitable for selected hardmode options, skipping this question')
                                    continue
                                }
                            } else {
                                await interaction.channel.send('Failed to find valid crop area, skipping this question')
                                continue
                            }
                        }
                    }
                } else if (hasSilhouette) {
                    // Only silhouette mode without crop
                    const silhouetteResult = await validateAndCreateSilhouette(img_base)
                    if (silhouetteResult) {
                        img = silhouetteResult
                    } else {
                        console.log('Silhouette validation failed, skipping question')
                        await interaction.channel.send('Image unsuitable for silhouette mode, skipping this question')
                        continue
                    }
                } else {
                    // No valid mode selected, use original
                    img = img_base
                }
            }
            else {
                img = await sharp(ship.filename)
                    .png()
                    .toBuffer()
            }

            if (!img) {
                await interaction.channel.send('Error in processing image, skipping this question')
                continue
            }

            // Resize to final height of 512 for the question (only if crop mode was used)
            if (quiz_data.hardmode && quiz_data.hardmode_options.some(opt => opt.startsWith('crop_'))) {
                img = await sharp(img)
                    .resize({ height: 512 })
                    .png()
                    .toBuffer()

                // Also resize img_base if in hardmode for reveal
                if (img_base) {
                    img_base = await sharp(img_base)
                        .resize({ height: 512 })
                        .png()
                        .toBuffer()
                }
            } else if (!quiz_data.hardmode) {
                // Non-hardmode path needs resize
                img = await sharp(img)
                    .resize({ height: 512 })
                    .png()
                    .toBuffer()
            }

            //post the question

            const BASE_TIME_LIMIT = (ship.char.length > 10) ? 15 : 10
            const TIME_LIMIT = Math.ceil(BASE_TIME_LIMIT * quiz_data.time_multiplier)

            // Helper function to create name hint with underscores
            const createNameHint = (name) => {
                return name.split('').map(char => {
                    if (char === ' ') return '  '
                    return '_ '
                }).join('').trim()
            }

            // Helper function to reveal characters progressively
            // Generate a consistent random order for character reveals
            const chars = ship.char.split('')
            const nonSpaceIndices = chars.map((c, i) => c !== ' ' ? i : -1).filter(i => i !== -1)
            const revealOrder = [...nonSpaceIndices].sort(() => Math.random() - 0.5)

            const revealCharacters = (name, percentage) => {
                const chars = name.split('')
                const numToReveal = Math.ceil(chars.filter(c => c !== ' ').length * percentage)
                const toReveal = new Set(revealOrder.slice(0, numToReveal))

                return chars.map((char, i) => {
                    if (char === ' ') return '  '
                    if (toReveal.has(i)) return char + ' '
                    return '_ '
                }).join('').trim()
            }

            // Build initial hint text
            let hintText = ''
            if (quiz_data.easymode && quiz_data.easymode_options.length > 0) {
                const hints = []

                if (quiz_data.easymode_options.includes('name_hint') || quiz_data.easymode_options.includes('progressive_name_hint')) {
                    hints.push(`**Name:** \`${createNameHint(ship.char)}\``)
                }
                if (quiz_data.easymode_options.includes('nation_hint')) {
                    const nationInfo = ship.nation || 'Unknown'
                    hints.push(`**Nation:** ${nationInfo}`)
                }
                if (quiz_data.easymode_options.includes('hull_type_hint')) {
                    const hullInfo = ship.ship_type || 'Unknown'
                    hints.push(`**Hull Type:** ${hullInfo}`)
                }
                if (quiz_data.easymode_options.includes('category_hint')) {
                    hints.push(`**Category:** ${fr_name}`)
                }

                if (hints.length > 0) {
                    hintText = '\n\n**Hints:**\n' + hints.join('\n')
                }
            }

            const question_embeded = new MessageEmbed()
                .setColor('#0099ff')
                .setTitle('Question')
                .setDescription(`Who is this ship girl? You have ${TIME_LIMIT} seconds.${hintText}`)
                .setImage('attachment://img.png')
                .setFooter({ text: "Your last message in this channel before timeout is your final answer" });

            const result_embeded = new MessageEmbed()
                .setTitle('Result')
                .setDescription(`Answer: ${ship.char} from ${fr_name}
*Accepted answers:* ${[ship.char].concat(alias).join(', ')}`)

            let msgRef = await interaction.channel.send({
                embeds: [question_embeded], files: [
                    { attachment: img, name: 'img.png' }]
            })

            // Schedule progressive hints
            const hintTimeouts = []

            // Track description hint state
            let descriptionHintAdded = false
            let descriptionHintText = ''

            if (quiz_data.easymode && quiz_data.easymode_options.includes('progressive_name_hint')) {
                // 25% time mark - reveal 20% of characters
                hintTimeouts.push(setTimeout(async () => {
                    try {
                        const hints = []
                        hints.push(`**Name:** \`${revealCharacters(ship.char, 0.2)}\``)

                        if (quiz_data.easymode_options.includes('nation_hint')) {
                            const nationInfo = ship.nation || 'Unknown'
                            hints.push(`**Nation:** ${nationInfo}`)
                        }
                        if (quiz_data.easymode_options.includes('hull_type_hint')) {
                            const hullInfo = ship.ship_type || 'Unknown'
                            hints.push(`**Hull Type:** ${hullInfo}`)
                        }
                        if (quiz_data.easymode_options.includes('category_hint')) {
                            hints.push(`**Category:** ${fr_name}`)
                        }

                        let description = `Who is this ship girl? You have ${TIME_LIMIT} seconds.\n\n**Hints:**\n${hints.join('\n')}`
                        if (descriptionHintAdded) {
                            description += descriptionHintText
                        }

                        const updatedEmbed = new MessageEmbed()
                            .setColor('#0099ff')
                            .setTitle('Question')
                            .setDescription(description)
                            .setImage('attachment://img.png')
                            .setFooter({ text: "Your last message in this channel before timeout is your final answer" })

                        await msgRef.edit({ embeds: [updatedEmbed] })
                    } catch (error) {
                        console.error('Error updating hint at 25%:', error)
                    }
                }, TIME_LIMIT * 1000 * 0.25))

                // 60% time mark - reveal 50% of characters
                hintTimeouts.push(setTimeout(async () => {
                    try {
                        const hints = []
                        hints.push(`**Name:** \`${revealCharacters(ship.char, 0.5)}\``)

                        if (quiz_data.easymode_options.includes('nation_hint')) {
                            const nationInfo = ship.nation || 'Unknown'
                            hints.push(`**Nation:** ${nationInfo}`)
                        }
                        if (quiz_data.easymode_options.includes('hull_type_hint')) {
                            const hullInfo = ship.ship_type || 'Unknown'
                            hints.push(`**Hull Type:** ${hullInfo}`)
                        }
                        if (quiz_data.easymode_options.includes('category_hint')) {
                            hints.push(`**Category:** ${fr_name}`)
                        }

                        let description = `Who is this ship girl? You have ${TIME_LIMIT} seconds.\n\n**Hints:**\n${hints.join('\n')}`
                        if (descriptionHintAdded) {
                            description += descriptionHintText
                        }

                        const updatedEmbed = new MessageEmbed()
                            .setColor('#0099ff')
                            .setTitle('Question')
                            .setDescription(description)
                            .setImage('attachment://img.png')
                            .setFooter({ text: "Your last message in this channel before timeout is your final answer" })

                        await msgRef.edit({ embeds: [updatedEmbed] })
                    } catch (error) {
                        console.error('Error updating hint at 60%:', error)
                    }
                }, TIME_LIMIT * 1000 * 0.6))
            }

            // Description hint at 30% time (requires hardmode)
            if (quiz_data.easymode && quiz_data.easymode_options.includes('description_hint') && quiz_data.hardmode) {
                hintTimeouts.push(setTimeout(async () => {
                    try {
                        // Get description tags from ship data
                        const descTags = ship.description || []
                        if (descTags.length > 0) {
                            // Select up to 10 random tags
                            const selectedTags = [...descTags].sort(() => Math.random() - 0.5).slice(0, 10)

                            descriptionHintText = `\n\n**Description Tags:** ${selectedTags.join(', ')}`
                            descriptionHintAdded = true

                            // Build current hints
                            const hints = []
                            if (quiz_data.easymode_options.includes('name_hint') || quiz_data.easymode_options.includes('progressive_name_hint')) {
                                hints.push(`**Name:** \`${createNameHint(ship.char)}\``)
                            }
                            if (quiz_data.easymode_options.includes('nation_hint')) {
                                const nationInfo = ship.nation || 'Unknown'
                                hints.push(`**Nation:** ${nationInfo}`)
                            }
                            if (quiz_data.easymode_options.includes('hull_type_hint')) {
                                const hullInfo = ship.ship_type || 'Unknown'
                                hints.push(`**Hull Type:** ${hullInfo}`)
                            }
                            if (quiz_data.easymode_options.includes('category_hint')) {
                                hints.push(`**Category:** ${fr_name}`)
                            }

                            let description = `Who is this ship girl? You have ${TIME_LIMIT} seconds.`
                            if (hints.length > 0) {
                                description += `\n\n**Hints:**\n${hints.join('\n')}`
                            }
                            description += descriptionHintText

                            const updatedEmbed = new MessageEmbed()
                                .setColor('#0099ff')
                                .setTitle('Question')
                                .setDescription(description)
                                .setImage('attachment://img.png')
                                .setFooter({ text: "Your last message in this channel before timeout is your final answer" })

                            await msgRef.edit({ embeds: [updatedEmbed] })
                        }
                    } catch (error) {
                        console.error('Error updating description hint at 30%:', error)
                    }
                }, TIME_LIMIT * 1000 * 0.3))
            }

            //collect answerer

            let startTimestamp = new Date().valueOf()
            let answerer = new Map()

            const collector = interaction.channel.createMessageCollector({ time: TIME_LIMIT * 1000 });

            collector.on('collect', m => {
                // For survival mode first question, also register participants who answer (in addition to prep phase)
                if (quiz_data.is_survival && quiz_data.current_round === 0) {
                    quiz_data.participants.add(m.author.id)
                }
                // In survival mode after first question, only accept answers from registered participants
                if (quiz_data.is_survival && quiz_data.current_round > 0 && !quiz_data.participants.has(m.author.id)) {
                    return
                }
                answerer.set(m.author.id, m)
            });

            collector.on('end', collected => {

                // Clear all hint timeouts
                hintTimeouts.forEach(timeout => clearTimeout(timeout))

                //check for right answers

                const correct_answerer = []
                const near_correct_answerer = []
                const correct_answerer_display = []
                const near_correct_answerer_display = []

                answerer.forEach(entry => {
                    const userId = entry.author.id
                    const username = entry.author.username

                    // In survival mode, initialize lives for new participants (first round only)
                    if (quiz_data.is_survival && quiz_data.current_round === 0 && !quiz_data.lives.has(username)) {
                        quiz_data.lives.set(username, quiz_data.numLives)
                    }

                    // In survival mode, skip players with 0 lives
                    if (quiz_data.is_survival && quiz_data.lives.get(username) === 0) {
                        return
                    }

                    if (entry.content.toLowerCase() === ship.char.toLowerCase() || alias_lowercase.includes(entry.content.toLowerCase())) {
                        correct_answerer.push([username, (entry.createdTimestamp - startTimestamp) / 1000, userId])
                        correct_answerer_display.push(`- ${username} - ${(entry.createdTimestamp - startTimestamp) / 1000}s`)
                    }
                    else if (levenshtein.get(entry.content.toLowerCase(), ship.char.toLowerCase()) <= Math.floor(ship.char.length * 0.2)
                        || alias_lowercase.some(val => levenshtein.get(entry.content.toLowerCase(), val) <= Math.floor(val.length * 0.2))) {
                        near_correct_answerer.push([username, (entry.createdTimestamp - startTimestamp) / 1000, userId])
                        near_correct_answerer_display.push(`- ${username} - ${(entry.createdTimestamp - startTimestamp) / 1000}s`)
                    }
                })
                let answerer_list = ""
                if (correct_answerer_display.length === 0) answerer_list = "None"
                else answerer_list = correct_answerer_display.join('\n')
                let near_answerer_list = ""
                if (near_correct_answerer_display.length === 0) near_answerer_list = "None"
                else near_answerer_list = near_correct_answerer_display.join('\n')

                result_embeded.addField('People who answered correctly:', answerer_list)
                result_embeded.addField('People whose answers are nearly correct (~80% match):', near_answerer_list)

                if (quiz_data.hardmode) {
                    const new_question_embeded = question_embeded.setImage('attachment://img_base.png')
                    msgRef.edit({
                        embeds: [new_question_embeded], files: [
                            { attachment: img_base, name: 'img_base.png' }]
                    })
                }

                //console.log(`Collected ${collected.size} items`);
                interaction.channel.send({ embeds: [result_embeded] })

                // add score
                // if scoring mode is classic, add 1 point for correct answer, 0.5 for near correct answer
                // if scoring mode is speed, add (TIME_LIMIT - time) * 2 / TIME_LIMIT point for correct answer, mulyiply by 0.5 for near correct answer
                // if scoring mode is survival, add 1 point for correct, 0.5 for near correct, 0 and lose life for wrong
                const scores = quiz_data.scores

                if (quiz_data.is_survival) {
                    // Handle survival mode scoring and lives
                    const answered_users = new Set()
                    const multiplier = quiz_data.ranked_score ? quiz_data.question_multipliers[i] : 1.0

                    correct_answerer.forEach(val => {
                        scores.set(val[0], (scores.get(val[0]) || 0) + (1 * multiplier))
                        answered_users.add(val[0])
                    })
                    near_correct_answerer.forEach(val => {
                        scores.set(val[0], (scores.get(val[0]) || 0) + (0.5 * multiplier))
                        answered_users.add(val[0])
                    })

                    // Deduct lives for wrong answers and participants who didn't answer
                    const answeredUserIds = new Set([...answerer.keys()])

                    quiz_data.participants.forEach(userId => {
                        const userEntry = [...answerer.values()].find(m => m.author.id === userId)

                        if (!userEntry) {
                            // Didn't answer at all - lose a life
                            // Find username from lives map (they must have participated before)
                            const username = [...quiz_data.lives.keys()].find(name => {
                                // Check if this username's userId matches
                                // We need to find any previous message from this user
                                return quiz_data.scores.has(name)
                            })

                            // Try to find username by searching through all participants
                            for (const [storedUsername, _] of quiz_data.lives) {
                                // We'll deduct life for all participants who didn't answer
                                // Check if this user didn't answer by userId
                                if (!answeredUserIds.has(userId)) {
                                    // Find the username that corresponds to this userId
                                    // Since we can't directly map userId to username without a message,
                                    // we need to use a different approach
                                    break
                                }
                            }
                            return
                        }

                        const username = userEntry.author.username
                        if (!answered_users.has(username)) {
                            // Wrong answer - lose a life
                            const currentLives = quiz_data.lives.get(username) || quiz_data.numLives
                            quiz_data.lives.set(username, Math.max(0, currentLives - 1))
                            scores.set(username, (scores.get(username) || 0) + 0)
                        }
                    })

                    // Also check for participants who have lives but didn't answer this round
                    for (const [username, lives] of quiz_data.lives) {
                        if (lives > 0 && !answered_users.has(username)) {
                            // This participant didn't answer - check if they're still in the game
                            const userAnsweredThisRound = [...answerer.values()].some(m => m.author.username === username)
                            if (!userAnsweredThisRound) {
                                // Didn't answer at all - lose a life
                                const currentLives = quiz_data.lives.get(username) || quiz_data.numLives
                                quiz_data.lives.set(username, Math.max(0, currentLives - 1))
                                scores.set(username, (scores.get(username) || 0) + 0)
                            }
                        }
                    }
                } else {
                    // Original scoring logic for Classic and Speed modes
                    const multiplier = quiz_data.ranked_score ? quiz_data.question_multipliers[i] : 1.0
                    correct_answerer.forEach(val => {
                        const base_score = quiz_data.scoring_mode === 'Speed' ? (TIME_LIMIT - val[1]) * 2 / TIME_LIMIT : 1
                        const score_add = base_score * multiplier
                        scores.set(val[0], (scores.get(val[0]) || 0) + score_add)
                    })
                    near_correct_answerer.forEach(val => {
                        const base_score = quiz_data.scoring_mode === 'Speed' ? (TIME_LIMIT - val[1]) / TIME_LIMIT : 0.5
                        const score_add = base_score * multiplier
                        scores.set(val[0], (scores.get(val[0]) || 0) + score_add)
                    })
                    answerer.forEach(val => {
                        if (!correct_answerer.map(val => val[0]).includes(val.author.username) && !near_correct_answerer.map(val => val[0]).includes(val.author.username)) {
                            scores.set(val.author.username, (scores.get(val.author.username) || 0) + 0)
                        }
                    })
                }
            });

            // await until the collector ends
            await new Promise(resolve => {
                collector.on('end', resolve)
            })

            // post current score
            quiz_data.scores = cur_scores
            quiz_data.current_round = i + 1
            if (client.shipgirl_quiz_multi.has(interaction.user.id)) {
                const is_paused = client.shipgirl_quiz_multi.get(interaction.user.id).is_paused
                client.shipgirl_quiz_multi.set(interaction.user.id, {
                    ...quiz_data,
                    is_paused: is_paused
                })
            }

            let score_list = ""
            console.dir(cur_scores, { depth: null })
            if (cur_scores.size === 0) score_list = "None"
            else {
                if (quiz_data.is_survival) {
                    // Show scores with lives for survival mode
                    score_list = [...cur_scores].sort((a, b) => b[1] - a[1]).map((val, idx) => {
                        const lives = quiz_data.lives.get(val[0]) || 0
                        const livesDisplay = '❤️'.repeat(lives) + '🖤'.repeat(quiz_data.numLives - lives)
                        return (idx === 0 ? '**' : '') + `${val[0]}: ${val[1].toFixed(2)} [${livesDisplay}]` + (idx === 0 ? '**' : '')
                    }).join('\n')
                } else {
                    score_list = [...cur_scores].sort((a, b) => b[1] - a[1]).map((val, idx) => (idx === 0 ? '**' : '') + `${val[0]}: ${val[1].toFixed(2)}` + (idx === 0 ? '**' : '')).join('\n')
                }
            }
            const score_embeded = new MessageEmbed()
                .setTitle(quiz_data.is_survival ? 'Current Score & Lives' : 'Current Score')
                .setDescription(score_list)
                .setColor('#0099ff')

            await interaction.channel.send({ embeds: [score_embeded] })
            await new Promise(resolve => setTimeout(resolve, 1000))
        }

        // post final score
        let score_list = ""
        if (quiz_data.scores.size === 0) score_list = "None"
        else {
            if (quiz_data.is_survival) {
                score_list = [...quiz_data.scores].sort((a, b) => b[1] - a[1]).map((val, idx) => {
                    const lives = quiz_data.lives.get(val[0]) || 0
                    const livesDisplay = '❤️'.repeat(lives) + '🖤'.repeat(quiz_data.numLives - lives)
                    return (idx === 0 ? '**' : '') + `${val[0]}: ${val[1].toFixed(2)} [${livesDisplay}]` + (idx === 0 ? '**' : '')
                }).join('\n')
            } else {
                score_list = [...quiz_data.scores].sort((a, b) => b[1] - a[1]).map((val, idx) => (idx === 0 ? '**' : '') + `${val[0]}: ${val[1].toFixed(2)}` + (idx === 0 ? '**' : '')).join('\n')
            }
        }
        const score_embeded = new MessageEmbed()
            .setTitle('Final Score')
            .setDescription(score_list)
            .setColor('#55ff55')

        await interaction.channel.send({ embeds: [score_embeded] })
    },
};