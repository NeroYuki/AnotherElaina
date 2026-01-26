const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');
const sharp = require('sharp');
const levenshtein = require('fast-levenshtein');
const { aggregateRecord } = require('../database/database_interaction');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shipgirl')
        .setDescription('Guess who is this ship girl')
        .addStringOption(option =>
            option.setName('category')
                .setDescription('Specify which series to be used for the quiz')
                .addChoices(
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
            option.setName('hardmode')
                .setDescription('Image processing mode (only works for specific series)')
                .addChoices(
                    { name: 'Silhouette', value: 'silhouette' },
                    { name: 'Crop Center (1/9)', value: 'crop_center' },
                    { name: 'Crop Random (1/9)', value: 'crop_random' },
                    { name: 'Crop Center Extreme (1/25)', value: 'crop_center_extreme' },
                    { name: 'Crop Random Extreme (1/25)', value: 'crop_random_extreme' },
                    { name: 'Crop Head', value: 'crop_head' },
                    { name: 'Crop Face', value: 'crop_face' },
                    { name: 'Crop Breast', value: 'crop_breast' },
                    { name: 'Crop Eyes', value: 'crop_eyes' },
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
    .addStringOption(option =>
        option.setName('easymode')
            .setDescription('Hint mode to make the quiz easier')
            .addChoices(
                { name: 'Name Hint', value: 'name_hint' },
                { name: 'Progressive Name Hint', value: 'progressive_name_hint' },
                    { name: 'Nation Hint', value: 'nation_hint' },
                    { name: 'Hull Type Hint', value: 'hull_type_hint' },
                    { name: 'Category Hint', value: 'category_hint' },
                    { name: 'Description Hint (requires hardmode)', value: 'description_hint' },
                ))
        .addBooleanOption(option =>
            option.setName('base_only')
                .setDescription('No alternative outfits / forms will be included')
            )
        .addStringOption(option =>
            option.setName('nation')
                .setDescription('Specify which nation to be used for the quiz, might be incorrect')
                .addChoices(
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
    ,

    async init() {},

    async execute(interaction, client) {

        let shipgirl_config = {}
        try {
            shipgirl_config = JSON.parse(client.shipgirl_quiz_config.get(interaction.user.id))
        }
        catch (e) {
            shipgirl_config = {}
        }

        //parse option

        const category = interaction.options.getString('category') || (shipgirl_config.category ? shipgirl_config.category : null)
        
        // Handle hardmode - check if config has hardmode_options array (new format) or single hardmode value (old format)
        let hardmodeOption = interaction.options.getString('hardmode')
        if (!hardmodeOption && shipgirl_config.hardmode) {
            // Use config - check if it's the new format with hardmode_options array
            if (shipgirl_config.hardmode_options && shipgirl_config.hardmode_options.length > 0) {
                // New format: randomly select one from the array
                hardmodeOption = shipgirl_config.hardmode_options[Math.floor(Math.random() * shipgirl_config.hardmode_options.length)]
            } else if (typeof shipgirl_config.hardmode === 'string') {
                // Old format: single string value
                hardmodeOption = shipgirl_config.hardmode
            } else {
                // Boolean true without options, default to silhouette
                hardmodeOption = 'silhouette'
            }
        }
        
        // Handle easymode - check if config has easymode_options array (new format)
        let easymodeOption = interaction.options.getString('easymode')
        if (!easymodeOption && shipgirl_config.easymode) {
            // Use config - check if it's the new format with easymode_options array
            if (shipgirl_config.easymode_options && shipgirl_config.easymode_options.length > 0) {
                // New format: randomly select one from the array
                easymodeOption = shipgirl_config.easymode_options[Math.floor(Math.random() * shipgirl_config.easymode_options.length)]
            } else if (typeof shipgirl_config.easymode === 'string') {
                // Old format: single string value
                easymodeOption = shipgirl_config.easymode
            }
        }
        
        const requireBase = interaction.options.getBoolean('base_only') || (shipgirl_config.base_only ? shipgirl_config.base_only : false) || (shipgirl_config.easymode_options && shipgirl_config.easymode_options.includes('base_only'))
        const nation = interaction.options.getString('nation') || (shipgirl_config.nation ? shipgirl_config.nation : null)
        const hull_type = interaction.options.getString('hull_type') || (shipgirl_config.hull_type ? shipgirl_config.hull_type : null)
        const max_rating = interaction.options.getString('max_rating') || (shipgirl_config.max_rating ? shipgirl_config.max_rating : 'explicit')
        
        const isHardmode = !!hardmodeOption
        const isEasymode = !!easymodeOption        

        //make a temporary reply to not get timeout'd
        await interaction.deferReply();

        //select a question (randomly)

        //let { fr_name, ship } = get_random_selection(category, requireBase)

        let db_query = {
            $and: []
        }

        const hardmode_allow_list = ['Azur Lane', 'Kantai Collection', 'Akushizu Senki', 'Abyss Horizon', 'Black Surgenights', 'Blue Oath', 'Velvet Code', 'Battleship Bishoujo Puzzle'] 

        const non_minor_power_nation = ['United Kingdom', 'United States', 'Japan', 'Germany', 'Soviet Union', 'Italy', 'France', 'Fictional']
    
        if (isHardmode) {
            // match folder against hardmode allow list
            db_query.folder = {$in: hardmode_allow_list}
        }
        if (category) {
            if (Array.isArray(category)) {
                db_query.folder = {$in: category}
            } else {
                db_query.folder = category
            }
        }
        if (nation) {
            if (Array.isArray(nation)) {
                // Multiple nations selected
                const nationQueries = []
                nation.forEach(n => {
                    if (n === 'Minor Power') {
                        nationQueries.push({
                            $and: non_minor_power_nation.map(val => {
                                return {
                                    $nor: [
                                        {nation: val},
                                        {nation: "? " + val}
                                    ]
                                }
                            }).concat([
                                {nation: {$exists: true}}
                            ])
                        })
                    } else {
                        nationQueries.push({
                            $or: [
                                {nation: n},
                                {nation: "? " + n}
                            ]
                        })
                    }
                })
                db_query.$and.push({$or: nationQueries})
            } else {
                // Single nation
                if (nation === 'Minor Power') {
                    db_query.$and.push({
                        $and: non_minor_power_nation.map(val => {
                            return {
                                $nor: [
                                    {nation: val},
                                    {nation: "? " + val}
                                ]
                            }
                        }).concat([
                            {nation: {$exists: true}}
                        ])
                    })
                }
                else {
                    db_query.$and.push({
                        $or: [
                            {nation: nation},
                            {nation: "? " + nation}
                        ]
                    })
                }
            }
        }
        if (hull_type) {
            if (Array.isArray(hull_type)) {
                // Multiple hull types selected
                const hullTypeQueries = []
                hull_type.forEach(ht => {
                    hullTypeQueries.push({ship_type: ht})
                    hullTypeQueries.push({ship_type: "? " + ht})
                })
                db_query.$and.push({ $or: hullTypeQueries })
            } else {
                // Single hull type
                db_query.$and.push({
                    $or: [
                        {ship_type: hull_type},
                        {ship_type: "? " + hull_type}
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
    
        console.dir(db_query, {depth: null})

        // make aggregate pipeline to get the random ship with the query
        const db_agg = [
            {$match: db_query},
            {$sample: {size: 1}}
        ]
    
        let query_res = await aggregateRecord('shipgirl', db_agg, /*use_ext*/ true)
            .catch(e => {
                console.log(e)
            })

        if (!query_res || query_res.length === 0) {
            await interaction.editReply({content: 'Sorry, i can\'t get a new quiz for you :('})
            return
        }

        let ship = {
            char: query_res[0].char,
            filename: './resources/shipgirls/' + query_res[0].folder + '/' + query_res[0].filename,
            is_base: query_res[0].is_base,
            nation: query_res[0].nation,
            ship_type: query_res[0].ship_type,
            description: query_res[0].description,
            body_crop: query_res[0].body_crop
        }
        let fr_name = query_res[0].folder
        let alias = query_res[0].alias || []
        let alias_lowercase = alias.map(val => val.toLowerCase())		//resize and process the image (if hardmode is selected)

        let img = null
        let img_base = null

        if (isHardmode) {
            // Check if this is a crop mode
            const hasCrop = hardmodeOption.startsWith('crop_')
            const hasSilhouette = hardmodeOption === 'silhouette'
            
            // Start with base image - resize now if no crop mode (saves compute time)
            let imgSharp = sharp(ship.filename)
            if (!hasCrop) {
                imgSharp = imgSharp.resize({height: 512})
            }
            
            img_base = await imgSharp.png().toBuffer()
            
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
                    
                    if (transparentPixelRatio > 0.75) {
                        // Too many transparent pixels (background fills canvas), invalid for silhouette
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
            const validateCropArea = async (buffer) => {
                try {
                    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
                    
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
                        const colorKey = `${data[i]},${data[i+1]},${data[i+2]}`
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
            
            // Get image metadata for crop operations
            const metadata = await sharp(img_base).metadata()
            const width = metadata.width
            const height = metadata.height
            
            // Process based on selected mode
            if (hasCrop) {
                // Check if this is a body crop mode
                const bodyCropModes = ['crop_head', 'crop_face', 'crop_breast', 'crop_eyes']
                const isBodyCrop = bodyCropModes.includes(hardmodeOption)
                
                let cropX, cropY, cropWidth, cropHeight
                let validCrop = false
                
                if (isBodyCrop) {
                    // Body crop mode
                    const bodyCropField = hardmodeOption.replace('crop_', '')
                    const bodyCropData = ship.body_crop && ship.body_crop[bodyCropField]
                    
                    if (bodyCropData && Array.isArray(bodyCropData) && bodyCropData.length === 4) {
                        // Body crop data available
                        const [x1, y1, x2, y2] = bodyCropData
                        
                        // Calculate crop area
                        const centerX = (x1 + x2) / 2
                        const centerY = (y1 + y2) / 2
                        const baseWidth = x2 - x1
                        const baseHeight = y2 - y1
                        
                        cropWidth = Math.floor(baseWidth)
                        cropHeight = Math.floor(baseHeight)
                        cropX = Math.max(0, Math.floor(centerX - cropWidth / 2))
                        cropY = Math.max(0, Math.floor(centerY - cropHeight / 2))
                        
                        // Ensure crop doesn't exceed image bounds
                        if (cropX + cropWidth > width) cropX = width - cropWidth
                        if (cropY + cropHeight > height) cropY = height - cropHeight
                        
                        // Extract crop
                        const testCrop = await sharp(img_base)
                            .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
                            .png()
                            .toBuffer()
                        
                        img = testCrop
                        validCrop = true
                    } else {
                        // Body crop data not available, fall back to random crop
                        console.log('Body crop data not available, falling back to random crop')
                        const fallbackMode = (bodyCropField === 'head' || bodyCropField === 'face') ? 'random' : 'random_extreme'
                        
                        const divisor = fallbackMode === 'random_extreme' ? 25 : 9
                        const sqrtDivisor = Math.sqrt(divisor)
                        cropWidth = Math.floor(width / sqrtDivisor)
                        cropHeight = Math.floor(height / sqrtDivisor)
                        
                        let attempts = 0
                        const maxAttempts = 20
                        
                        while (!validCrop && attempts < maxAttempts) {
                            const maxX = width - cropWidth
                            const maxY = height - cropHeight
                            cropX = Math.floor(Math.random() * maxX)
                            cropY = Math.floor(Math.random() * maxY)
                            
                            const testCrop = await sharp(img_base)
                                .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
                                .png()
                                .toBuffer()
                            
                            validCrop = await validateCropArea(testCrop)
                            
                            if (validCrop) {
                                img = testCrop
                                break
                            }
                            
                            attempts++
                        }
                        
                        if (!validCrop) {
                            console.log('Body crop fallback failed')
                            await interaction.editReply({content: 'Image unsuitable for crop mode, please try again'})
                            return
                        }
                    }
                } else {
                    // Standard crop mode
                    const isExtreme = hardmodeOption.includes('extreme')
                    const isRandom = hardmodeOption.includes('random')
                    
                    const divisor = isExtreme ? 25 : 9
                    const sqrtDivisor = Math.sqrt(divisor)
                    cropWidth = Math.floor(width / sqrtDivisor)
                    cropHeight = Math.floor(height / sqrtDivisor)
                    
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
                        
                        validCrop = await validateCropArea(testCrop)
                        
                        if (validCrop) {
                            img = testCrop
                            break
                        }
                        
                        attempts++
                        // For center crop, don't retry since position is fixed
                        if (!isRandom) break
                    }
                    
                    // If no valid crop found, skip question
                    if (!validCrop) {
                        console.log(`Failed to find valid crop area after ${attempts} attempts`)
                        await interaction.editReply({content: 'Image unsuitable for crop mode, please try again'})
                        return
                    }
                }
            } else if (hasSilhouette) {
                // Only silhouette mode
                const silhouetteResult = await validateAndCreateSilhouette(img_base)
                if (silhouetteResult) {
                    img = silhouetteResult
                } else {
                    console.log('Silhouette validation failed')
                    await interaction.editReply({content: 'Image unsuitable for silhouette mode, please try again'})
                    return
                }
            } else {
                // No valid mode selected, use original
                img = img_base
            }
            
            // Resize to final height of 512 for the question (only if crop mode was used)
            if (hasCrop) {
                img = await sharp(img)
                    .resize({height: 512})
                    .png()
                    .toBuffer()

                // Also resize img_base for reveal
                img_base = await sharp(img_base)
                    .resize({height: 512})
                    .png()
                    .toBuffer()
            }
        }
        else {
            img = await sharp(ship.filename)
                .resize({height: 512})
                .png()
                .toBuffer()
        }

        if (!img) {
            await interaction.editReply({content: 'Sorry, i can\'t get a new quiz for you :('})
            return
        }

        //post the question
        
        const TIME_LIMIT = (ship.char.length > 10) ? 15 : 10

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
        if (isEasymode) {
            const hints = []
            
            if (easymodeOption === 'name_hint' || easymodeOption === 'progressive_name_hint') {
                hints.push(`**Name:** \`${createNameHint(ship.char)}\``)
            }
            if (easymodeOption === 'nation_hint') {
                const nationInfo = ship.nation || 'Unknown'
                hints.push(`**Nation:** ${nationInfo}`)
            }
            if (easymodeOption === 'hull_type_hint') {
                const hullInfo = ship.ship_type || 'Unknown'
                hints.push(`**Hull Type:** ${hullInfo}`)
            }
            if (easymodeOption === 'category_hint') {
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
            .setFooter({text: "Your last message in this channel before timeout is your final answer"});

        const result_embeded = new MessageEmbed()
            .setTitle('Result')
            .setDescription(`Answer: ${ship.char} from ${fr_name}
*Accepted answers:* ${[ship.char].concat(alias).join(', ')}`)

        await interaction.editReply({ embeds: [question_embeded], files: [
            { attachment: img, name: 'img.png' } ]
        })

        //collect answerer

        let startTimestamp = new Date().valueOf()
        let answerer = new Map()

        const collector = interaction.channel.createMessageCollector({time: TIME_LIMIT * 1000 });

        collector.on('collect', m => {
            answerer.set(m.author.id, m)
        });

        // Schedule progressive hints
        const hintTimeouts = []
        
        // Track description hint state
        let descriptionHintAdded = false
        let descriptionHintText = ''
        
        if (isEasymode && easymodeOption === 'progressive_name_hint') {
            // 25% time mark - reveal 20% of characters
            hintTimeouts.push(setTimeout(async () => {
                try {
                    const hints = []
                    hints.push(`**Name:** \`${revealCharacters(ship.char, 0.2)}\``)
                    
                    let description = `Who is this ship girl? You have ${TIME_LIMIT} seconds.\n\n**Hints:**\n${hints.join('\n')}`
                    if (descriptionHintAdded) {
                        description += descriptionHintText
                    }
                    
                    const updatedEmbed = new MessageEmbed()
                        .setColor('#0099ff')
                        .setTitle('Question')
                        .setDescription(description)
                        .setImage('attachment://img.png')
                        .setFooter({text: "Your last message in this channel before timeout is your final answer"})
                    
                    await interaction.editReply({ embeds: [updatedEmbed] })
                } catch (error) {
                    console.error('Error updating hint at 25%:', error)
                }
            }, TIME_LIMIT * 1000 * 0.25))
            
            // 60% time mark - reveal 50% of characters
            hintTimeouts.push(setTimeout(async () => {
                try {
                    const hints = []
                    hints.push(`**Name:** \`${revealCharacters(ship.char, 0.5)}\``)
                    
                    let description = `Who is this ship girl? You have ${TIME_LIMIT} seconds.\n\n**Hints:**\n${hints.join('\n')}`
                    if (descriptionHintAdded) {
                        description += descriptionHintText
                    }
                    
                    const updatedEmbed = new MessageEmbed()
                        .setColor('#0099ff')
                        .setTitle('Question')
                        .setDescription(description)
                        .setImage('attachment://img.png')
                        .setFooter({text: "Your last message in this channel before timeout is your final answer"})
                    
                    await interaction.editReply({ embeds: [updatedEmbed] })
                } catch (error) {
                    console.error('Error updating hint at 60%:', error)
                }
            }, TIME_LIMIT * 1000 * 0.6))
        }
        
        // Description hint at 30% time (requires hardmode)
        if (isEasymode && easymodeOption === 'description_hint' && isHardmode) {
            hintTimeouts.push(setTimeout(async () => {
                try {
                    // Get description tags from ship data
                    const descTags = ship.description || []
                    if (descTags.length > 0) {
                        // Select up to 10 random tags
                        const selectedTags = [...descTags].sort(() => Math.random() - 0.5).slice(0, 10)
                        
                        descriptionHintText = `\n\n**Description Tags:** ${selectedTags.join(', ')}`
                        descriptionHintAdded = true
                        
                        let description = `Who is this ship girl? You have ${TIME_LIMIT} seconds.`
                        description += descriptionHintText
                        
                        const updatedEmbed = new MessageEmbed()
                            .setColor('#0099ff')
                            .setTitle('Question')
                            .setDescription(description)
                            .setImage('attachment://img.png')
                            .setFooter({text: "Your last message in this channel before timeout is your final answer"})
                        
                        await interaction.editReply({ embeds: [updatedEmbed] })
                    }
                } catch (error) {
                    console.error('Error updating description hint at 30%:', error)
                }
            }, TIME_LIMIT * 1000 * 0.3))
        }

        collector.on('end', collected => {

            // Clear all hint timeouts
            hintTimeouts.forEach(timeout => clearTimeout(timeout))

            //check for right answers

            const correct_answerer = []
            const near_correct_answerer = []

            answerer.forEach(entry => {
                if (entry.content.toLowerCase() === ship.char.toLowerCase() || alias_lowercase.includes(entry.content.toLowerCase()))
                    correct_answerer.push(`- ${entry.author.username} - ${(entry.createdTimestamp - startTimestamp)/1000}s`)
                else if (levenshtein.get(entry.content.toLowerCase(), ship.char.toLowerCase()) <= Math.floor(ship.char.length * 0.2)
                    || alias_lowercase.some(val => levenshtein.get(entry.content.toLowerCase(), val) <= Math.floor(val.length * 0.2)))
                    near_correct_answerer.push(`- ${entry.author.username} - ${(entry.createdTimestamp - startTimestamp)/1000}s`)
            })
            let answerer_list = ""
            if (correct_answerer.length === 0) answerer_list = "None"			
            else answerer_list = correct_answerer.join('\n')
            let near_answerer_list = ""
            if (near_correct_answerer.length === 0) near_answerer_list = "None"			
            else near_answerer_list = near_correct_answerer.join('\n')

            result_embeded.addField('People who answered correctly:', answerer_list)
            result_embeded.addField('People whose answers are nearly correct (~80% match):', near_answerer_list)

            if (isHardmode && img_base) {
                const new_question_embeded = question_embeded.setImage('attachment://img_base.png')
                interaction.editReply({ embeds: [new_question_embeded], files: [
                    { attachment: img_base, name: 'img_base.png' } ]
                })
            }

        //console.log(`Collected ${collected.size} items`);
        interaction.followUp({ embeds: [result_embeded] })
    });
    },
};