const { SlashCommandBuilder } = require('@discordjs/builders');
const shipgirl = require('../resources/shipgirl_quiz.json')
const { MessageEmbed, MessageActionRow, MessageSelectMenu } = require('discord.js');
const sharp = require('sharp');
const levenshtein = require('fast-levenshtein');
const { aggregateRecord } = require('../database/database_interaction');
const base_shipgirl = []

const all_sum = shipgirl.reduce((pv, cv) => pv + cv.count, 0)
let base_sum = 0

function get_random_selection(category = null, require_base = false) {
    let fr_name = ""
    let ship = null

    let selector = 0
    if (!category) {
        //from random series
        let cur_entry = 0
        if (!require_base) {
            selector = Math.floor(Math.random() * all_sum)
            while (selector >= shipgirl[cur_entry].count) {
                selector -= shipgirl[cur_entry].count
                cur_entry += 1
            }
            fr_name = shipgirl[cur_entry].name
            ship = shipgirl[cur_entry].img[selector]
        }
        else {
            selector = Math.floor(Math.random() * base_sum)
            while (selector >= base_shipgirl[cur_entry].count) {
                selector -= base_shipgirl[cur_entry].count
                cur_entry += 1
            }
            fr_name = base_shipgirl[cur_entry].name
            ship = base_shipgirl[cur_entry].img[selector]
        }

    }
    else {
        //from fixed series
        let fr_index = shipgirl.findIndex(val => val.name === category)
        if (fr_index !== -1) {
            fr_name = shipgirl[fr_index].name
            if (!require_base) {
                selector = Math.floor(Math.random() * shipgirl[fr_index].count)
                ship = shipgirl[fr_index].img[selector]
            }
            else {
                selector = Math.floor(Math.random() * base_shipgirl[fr_index].count)
                ship = base_shipgirl[fr_index].img[selector]
            }
        }
    }

    return {
        ship: ship,
        fr_name: fr_name
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shipgirl_config')
        .setDescription('Configure the shipgirl quiz you want to play')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the shipgirl quiz config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the current shipgirl quiz config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Setup the shipgirl quiz config')
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
                .addStringOption(option =>
                    option.setName('max_rating')
                        .setDescription('Maximum risque rating of shipgirls to be used (default: explicit)')
                        .addChoices(
                            { name: 'General', value: 'general' },
                            { name: 'Sensitive', value: 'sensitive' },
                            { name: 'Questionable', value: 'questionable' },
                            { name: 'Explicit', value: 'explicit' },
                        ))
                .addBooleanOption(option =>
                    option.setName('hardmode')
                        .setDescription('Enables image processing modes (you will select after starting)')
                    )
                .addBooleanOption(option =>
                    option.setName('easymode')
                        .setDescription('Enables hint modes to make the quiz easier (you will select after starting)')
                    )
                .addBooleanOption(option =>
                    option.setName('base_only')
                        .setDescription('No alernative outfits / forms will be included')
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

    async execute(interaction, client) {

        //parse option

        if (interaction.options.getSubcommand() === 'reset') {
            client.shipgirl_quiz_config.delete(interaction.user.id)
            await interaction.reply('shipgirl quiz config has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.shipgirl_quiz_config.get(interaction.user.id)
            if (config_string) {
                try {
                    let config = JSON.parse(config_string)
                    let configText = `Current shipgirl quiz config:\n`
                    
                    // Category
                    if (Array.isArray(config.category)) {
                        configText += `Category: ${config.category.join(', ')}\n`
                    } else {
                        configText += `Category: ${config.category || "Any"}\n`
                    }
                    
                    configText += `Max Rating: ${config.max_rating || "explicit"}\n`
                    configText += `Hardmode: ${config.hardmode || false}\n`
                    if (config.hardmode && config.hardmode_options) {
                        configText += `  - Options: ${config.hardmode_options.join(', ')}\n`
                    }
                    configText += `Easymode: ${config.easymode || false}\n`
                    if (config.easymode && config.easymode_options) {
                        configText += `  - Options: ${config.easymode_options.join(', ')}\n`
                    }
                    configText += `Base Only: ${config.base_only || false}\n`
                    
                    // Nation
                    if (Array.isArray(config.nation)) {
                        configText += `Nation: ${config.nation.join(', ')}\n`
                    } else {
                        configText += `Nation: ${config.nation || "Any"}\n`
                    }
                    
                    // Hull Type
                    if (Array.isArray(config.hull_type)) {
                        configText += `Hull Type: ${config.hull_type.join(', ')}`
                    } else {
                        configText += `Hull Type: ${config.hull_type || "Any"}`
                    }
                    
                    await interaction.reply(configText);
                }
                catch (error) {
                    await interaction.reply('Current shipgirl quiz config is invalid');
                }
            }
            else {
                await interaction.reply('shipgirl quiz config has not been set');
            }
            return
        }

        const category = interaction.options.getString('category') || null
        const max_rating = interaction.options.getString('max_rating') || null
        const isHardmode = interaction.options.getBoolean('hardmode') || false
        const isEasymode = interaction.options.getBoolean('easymode') || false
        const base_only = interaction.options.getBoolean('base_only') || false
        const nation = interaction.options.getString('nation') || null
        const hull_type = interaction.options.getString('hull_type') || null

        // Defer reply for potential multi-select interactions
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

        // Handle multiple category selection
        let finalCategory = category
        if (category === 'MULTIPLE') {
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
            finalCategory = await handleMultiSelect('category', 'MULTIPLE', categoryOptions, 'categories')
        }

        // Handle multiple nation selection
        let finalNation = nation
        if (nation === 'MULTIPLE') {
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
            finalNation = await handleMultiSelect('nation', 'MULTIPLE', nationOptions, 'nations')
        }

        // Handle multiple hull_type selection
        let finalHullType = hull_type
        if (hull_type === 'MULTIPLE') {
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
            finalHullType = await handleMultiSelect('hull_type', 'MULTIPLE', hullTypeOptions, 'hull types')
        }

        // If hardmode is enabled, prompt user to select processing modes
        let hardmode_options = []
        if (isHardmode) {
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
                        description: 'Show head + hair area (fallback: random)',
                        value: 'crop_head',
                    },
                    {
                        label: 'Crop Face',
                        description: 'Show face area (fallback: random)',
                        value: 'crop_face',
                    },
                    {
                        label: 'Crop Breast',
                        description: 'Show breast area (fallback: random extreme)',
                        value: 'crop_breast',
                    },
                    {
                        label: 'Crop Eyes',
                        description: 'Show eyes area (fallback: random extreme)',
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
        }

        // If easymode is enabled, prompt user to select hint modes
        let easymode_options = []
        if (isEasymode) {
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
        }

        const config = {
            category: finalCategory,
            max_rating: max_rating,
            hardmode: isHardmode,
            hardmode_options: hardmode_options,
            easymode: isEasymode,
            easymode_options: easymode_options,
            base_only: base_only,
            nation: finalNation,
            hull_type: finalHullType
        }

        const config_string = JSON.stringify(config)

        await interaction.editReply("Shipgirl quiz config has been set");

        client.shipgirl_quiz_config.set(interaction.user.id, config_string);
    },
};