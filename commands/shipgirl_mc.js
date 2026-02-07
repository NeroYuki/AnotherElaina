const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const sharp = require('sharp');
const { aggregateRecord } = require('../database/database_interaction');
const fs = require('fs');

// Load random options
const SHIP_TYPES = fs.readFileSync('./resources/random_ship_type.txt', 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && l !== 'Unknown');
    
const NATIONS = fs.readFileSync('./resources/random_nation.txt', 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && l !== 'Unknown' && l !== 'Fictional');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shipgirl_mc')
        .setDescription('Multiple choice shipgirl quiz with buttons')
        .addStringOption(option =>
            option.setName('question_type')
                .setDescription('Type of question to ask')
                .addChoices(
                    { name: 'Random', value: 'random' },
                    { name: 'Who is this shipgirl?', value: 'name' },
                    { name: 'Which game/franchise?', value: 'category' },
                    { name: 'What is the hull type?', value: 'hull_type' },
                    { name: 'Where does this shipgirl come from?', value: 'nation' },
                    { name: 'What is the birthday?', value: 'birthday' },
                    { name: 'What is the real life height?', value: 'height' },
                    { name: 'What is the real life weight?', value: 'weight' },
                ))
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
                    { name: 'Blur', value: 'blur' },
                    { name: 'Blur Extreme', value: 'blur_extreme' },
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
                .setDescription('Maximum risque rating of shipgirls to be used (default: sensitive)')
                .addChoices(
                    { name: 'General', value: 'general' },
                    { name: 'Sensitive', value: 'sensitive' },
                    { name: 'Questionable', value: 'questionable' },
                    { name: 'Explicit', value: 'explicit' },
                ))
        .addBooleanOption(option =>
            option.setName('base_only')
                .setDescription('No alternative outfits / forms will be included')
            )
        .addBooleanOption(option =>
            option.setName('buzzer_mode')
                .setDescription('First correct answer instantly ends the question')
            )
        .addStringOption(option =>
            option.setName('nation')
                .setDescription('Specify which nation to be used for the quiz')
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
                .setDescription('Specify which hull type to be used for the quiz')
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
            ),

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
        let question_type = interaction.options.getString('question_type') || 'name' // Default to random
        
        // If config has question_type preference, use it
        if (!interaction.options.getString('question_type') && shipgirl_config.question_type) {
            question_type = shipgirl_config.question_type
        }
        
        // If question_type is an array (from config multi-select), pick a random one
        if (Array.isArray(question_type)) {
            question_type = question_type[Math.floor(Math.random() * question_type.length)]
        }
        
        // If random is selected, pick a random question type
        if (question_type === 'random') {
            const questionTypes = ['name', 'category', 'hull_type', 'nation', 'birthday', 'height', 'weight']
            question_type = questionTypes[Math.floor(Math.random() * questionTypes.length)]
        }
        
        // Handle hardmode
        let hardmode_options = []
        const commandHardmode = interaction.options.getString('hardmode')
        if (commandHardmode) {
            hardmode_options = [commandHardmode]
        } else if (shipgirl_config.hardmode) {
            if (shipgirl_config.hardmode_options && shipgirl_config.hardmode_options.length > 0) {
                hardmode_options = shipgirl_config.hardmode_options
            } else if (typeof shipgirl_config.hardmode === 'string') {
                hardmode_options = [shipgirl_config.hardmode]
            } else {
                hardmode_options = ['silhouette']
            }
        }
        
        const requireBase = interaction.options.getBoolean('base_only') || (shipgirl_config.base_only ? shipgirl_config.base_only : false) || (shipgirl_config.easymode_options && shipgirl_config.easymode_options.includes('base_only'))
        const nation = interaction.options.getString('nation') || (shipgirl_config.nation ? shipgirl_config.nation : null)
        const hull_type = interaction.options.getString('hull_type') || (shipgirl_config.hull_type ? shipgirl_config.hull_type : null)
        const max_rating = interaction.options.getString('max_rating') || (shipgirl_config.max_rating ? shipgirl_config.max_rating : 'sensitive')
        const buzzer_mode = interaction.options.getBoolean('buzzer_mode') || false
        
        const isHardmode = hardmode_options.length > 0

        //make a temporary reply to not get timeout'd
        await interaction.deferReply();

        //Build database query
        let db_query = {
            $and: []
        }

        const hardmode_allow_list = ['Azur Lane', 'Kantai Collection', 'Akushizu Senki', 'Abyss Horizon', 'Black Surgenights', 'Blue Oath', 'Velvet Code', 'Battleship Bishoujo Puzzle'] 
        const non_minor_power_nation = ['United Kingdom', 'United States', 'Japan', 'Germany', 'Soviet Union', 'Italy', 'France', 'Fictional']
    
        if (isHardmode) {
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
                const hullTypeQueries = []
                hull_type.forEach(ht => {
                    hullTypeQueries.push({ship_type: ht})
                    hullTypeQueries.push({ship_type: "? " + ht})
                })
                db_query.$and.push({ $or: hullTypeQueries })
            } else {
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

        // Add filters based on question type to ensure required data exists
        if (question_type === 'hull_type') {
            db_query.ship_type = { $exists: true, $ne: null, $ne: 'Unknown', $ne: '? Unknown' }
        } else if (question_type === 'nation') {
            db_query.nation = { $exists: true, $ne: null, $ne: 'Unknown', $ne: '? Unknown', $ne: 'Fictional', $ne: '? Fictional' }
        } else if (question_type === 'birthday') {
            db_query.birthday = { $exists: true, $ne: null, $ne: '' }
        } else if (question_type === 'height') {
            db_query.height = { $exists: true, $ne: null, $ne: '' }
        } else if (question_type === 'weight') {
            db_query.displacement = { $exists: true, $ne: null, $ne: '' }
        }

        // if db_query.$and is empty, remove it
        if (!db_query.$and.length) {
            delete db_query.$and
        }
    
        console.dir(db_query, {depth: null})

        // Get random ship
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
            body_crop: query_res[0].body_crop,
            folder: query_res[0].folder,
            birthday: query_res[0].birthday,
            height: query_res[0].height,
            displacement: query_res[0].displacement
        }
        let fr_name = query_res[0].folder
        let alias = query_res[0].alias || []

        // Get wrong choices using fallback criteria
        const { wrongChoices, correctAnswer, questionText } = await getQuestionData(ship, fr_name, db_query, question_type)
        
        if (wrongChoices.length < 3) {
            await interaction.editReply({content: 'Sorry, not enough choices available for this quiz :('})
            return
        }

        // Select 3 random wrong choices
        const selectedWrong = wrongChoices.sort(() => Math.random() - 0.5).slice(0, 3)
        
        // Create choices array with correct answer
        const allChoices = [...selectedWrong, correctAnswer].sort(() => Math.random() - 0.5)
        const correctIndex = allChoices.indexOf(correctAnswer)

        // Process image
        let img = null
        let img_base = null

        if (isHardmode) {
            img_base = await sharp(ship.filename)
                .resize({height: 512})
                .png()
                .toBuffer()

            // Check which hardmode options are selected
            const hasSilhouette = hardmode_options.includes('silhouette')
            const hasBlur = hardmode_options.includes('blur') || hardmode_options.includes('blur_extreme')
            const hasCrop = hardmode_options.some(opt => opt.startsWith('crop_'))
            const combineMode = hasCrop && hasSilhouette

            // Helper function to validate and create silhouette
            const validateAndCreateSilhouette = async (buffer) => {
                try {
                    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
                    
                    if (info.channels !== 4) {
                        return null
                    }
                    
                    let hasValidContent = false
                    for (let i = 0; i < data.length; i += 4) {
                        if (data[i + 3] > 128) {
                            hasValidContent = true
                            break
                        }
                    }
                    
                    if (!hasValidContent) {
                        return null
                    }
                    
                    const silhouetteBuffer = await sharp(buffer)
                        .negate({ alpha: false })
                        .flatten({ background: { r: 255, g: 255, b: 255 } })
                        .negate()
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
                    
                    const centerX = Math.floor(info.width / 2)
                    const centerY = Math.floor(info.height / 2)
                    const centerIdx = (centerY * info.width + centerX) * info.channels
                    
                    if (info.channels === 4 && data[centerIdx + 3] < 128) {
                        return false
                    }
                    
                    const r = data[centerIdx]
                    const g = data[centerIdx + 1]
                    const b = data[centerIdx + 2]
                    if (r > 250 && g > 250 && b > 250) {
                        return false
                    }
                    
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
            
            const metadata = await sharp(img_base).metadata()
            const width = metadata.width
            const height = metadata.height
            
            if (hasCrop) {
                let selectedCropMode = null
                const bodyCropModes = ['crop_head', 'crop_face', 'crop_breast', 'crop_eyes']
                const selectedBodyCrop = hardmode_options.find(opt => bodyCropModes.includes(opt))
                
                if (selectedBodyCrop) {
                    selectedCropMode = selectedBodyCrop
                } else {
                    if (hardmode_options.includes('crop_random_extreme')) {
                        selectedCropMode = 'crop_random_extreme'
                    } else if (hardmode_options.includes('crop_center_extreme')) {
                        selectedCropMode = 'crop_center_extreme'
                    } else if (hardmode_options.includes('crop_random')) {
                        selectedCropMode = 'crop_random'
                    } else if (hardmode_options.includes('crop_center')) {
                        selectedCropMode = 'crop_center'
                    }
                }
                
                const isBodyCrop = bodyCropModes.includes(selectedCropMode)
                
                let cropX, cropY, cropWidth, cropHeight
                let validCrop = false
                
                if (isBodyCrop) {
                    const bodyCropField = selectedCropMode.replace('crop_', '')
                    const bodyCropData = ship.body_crop && ship.body_crop[bodyCropField]
                    
                    if (bodyCropData && Array.isArray(bodyCropData) && bodyCropData.length === 4) {
                        const [x1, y1, x2, y2] = bodyCropData
                        const centerX = (x1 + x2) / 2
                        const centerY = (y1 + y2) / 2
                        const baseWidth = x2 - x1
                        const baseHeight = y2 - y1
                        
                        cropWidth = Math.floor(baseWidth)
                        cropHeight = Math.floor(baseHeight)
                        cropX = Math.max(0, Math.floor(centerX - cropWidth / 2))
                        cropY = Math.max(0, Math.floor(centerY - cropHeight / 2))
                        
                        if (cropX + cropWidth > width) cropX = width - cropWidth
                        if (cropY + cropHeight > height) cropY = height - cropHeight
                        
                        const testCrop = await sharp(img_base)
                            .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
                            .png()
                            .toBuffer()
                        
                        img = testCrop
                        validCrop = true
                    } else {
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
                    const isExtreme = selectedCropMode.includes('extreme')
                    const isRandom = selectedCropMode.includes('random')
                    
                    const divisor = isExtreme ? 25 : 9
                    const sqrtDivisor = Math.sqrt(divisor)
                    cropWidth = Math.floor(width / sqrtDivisor)
                    cropHeight = Math.floor(height / sqrtDivisor)
                    
                    let attempts = 0
                    const maxAttempts = 20
                    
                    while (!validCrop && attempts < maxAttempts) {
                        if (isRandom) {
                            const maxX = width - cropWidth
                            const maxY = height - cropHeight
                            cropX = Math.floor(Math.random() * maxX)
                            cropY = Math.floor(Math.random() * maxY)
                        } else {
                            cropX = Math.floor((width - cropWidth) / 2)
                            cropY = Math.floor((height - cropHeight) / 2)
                        }
                        
                        const testCrop = await sharp(img_base)
                            .extract({ left: cropX, top: cropY, width: cropWidth, height: cropHeight })
                            .png()
                            .toBuffer()
                        
                        validCrop = await validateCropArea(testCrop)
                        
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
                            break
                        }
                        
                        attempts++
                        if (!isRandom) break
                    }
                    
                    if (!validCrop) {
                        console.log(`Failed to find valid crop area after ${attempts} attempts`)
                        if (hasSilhouette) {
                            console.log('Falling back to silhouette mode')
                            const silhouetteResult = await validateAndCreateSilhouette(img_base)
                            if (silhouetteResult) {
                                img = silhouetteResult
                            } else {
                                console.log('Silhouette validation also failed, skipping question')
                                await interaction.editReply({content: 'Image unsuitable for selected hardmode options, please try again'})
                                return
                            }
                        } else {
                            await interaction.editReply({content: 'Image unsuitable for crop mode, please try again'})
                            return
                        }
                    }
                }
            } else if (hasSilhouette) {
                const silhouetteResult = await validateAndCreateSilhouette(img_base)
                if (silhouetteResult) {
                    img = silhouetteResult
                } else {
                    console.log('Silhouette validation failed')
                    await interaction.editReply({content: 'Image unsuitable for silhouette mode, please try again'})
                    return
                }
            } else {
                img = img_base
            }
            
            if (hasCrop) {
                img = await sharp(img)
                    .resize({height: 512})
                    .png()
                    .toBuffer()

                img_base = await sharp(img_base)
                    .resize({height: 512})
                    .png()
                    .toBuffer()
            }
            
            if (hasBlur) {
                const blurRadius = hardmode_options.includes('blur_extreme') ? 36 : 12
                img = await sharp(img)
                    .blur(blurRadius)
                    .png()
                    .toBuffer()
            }
        } else {
            img = await sharp(ship.filename)
                .resize({height: 512})
                .png()
                .toBuffer()
        }

        if (!img) {
            await interaction.editReply({content: 'Sorry, i can\'t get a new quiz for you :('})
            return
        }

        // Create buttons for choices
        const buttons = []
        for (let i = 0; i < 4; i++) {
            buttons.push(
                new MessageButton()
                    .setCustomId(`choice_${i}_${interaction.id}`)
                    .setLabel(`${i + 1}. ${allChoices[i]}`)
                    .setStyle('PRIMARY')
            )
        }

        const row1 = new MessageActionRow().addComponents(buttons[0], buttons[1])
        const row2 = new MessageActionRow().addComponents(buttons[2], buttons[3])

        const TIME_LIMIT = 10

        const question_embeded = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('Question - Multiple Choice')
            .setDescription(`${questionText} You have ${TIME_LIMIT} seconds.\n\nSelect one of the options below:`)
            .setImage('attachment://img.png')
            .setFooter({text: buzzer_mode ? "Buzzer mode: First correct answer ends the question" : "Everyone can answer once"});

        await interaction.editReply({ 
            embeds: [question_embeded], 
            files: [{ attachment: img, name: 'img.png' }],
            components: [row1, row2]
        })

        // Track answers
        let startTimestamp = new Date().valueOf()
        let answerers = new Map() // userId -> { choice, timestamp, username }
        let questionEnded = false

        const filter = i => i.customId.endsWith(interaction.id)
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: TIME_LIMIT * 1000 })

        collector.on('collect', async i => {
            // Check if user already answered
            if (answerers.has(i.user.id)) {
                await i.reply({ content: 'You have already answered this question!', ephemeral: true })
                return
            }

            // Extract choice index
            const choiceIndex = parseInt(i.customId.split('_')[1])
            const isCorrect = choiceIndex === correctIndex
            
            // Record answer
            answerers.set(i.user.id, {
                choice: choiceIndex,
                timestamp: i.createdTimestamp,
                username: i.user.username,
                isCorrect: isCorrect
            })

            if (isCorrect && buzzer_mode && !questionEnded) {
                // End question immediately in buzzer mode
                questionEnded = true
                await i.update({ content: `✅ ${i.user.username} got it right! Ending question...` })
                collector.stop('buzzer')
            } else {
                await i.deferUpdate()
            }
        })

        collector.on('end', async (collected, reason) => {
            // Disable all buttons
            const disabledRow1 = new MessageActionRow().addComponents(
                buttons[0].setDisabled(true).setStyle(correctIndex === 0 ? 'SUCCESS' : 'SECONDARY'),
                buttons[1].setDisabled(true).setStyle(correctIndex === 1 ? 'SUCCESS' : 'SECONDARY')
            )
            const disabledRow2 = new MessageActionRow().addComponents(
                buttons[2].setDisabled(true).setStyle(correctIndex === 2 ? 'SUCCESS' : 'SECONDARY'),
                buttons[3].setDisabled(true).setStyle(correctIndex === 3 ? 'SUCCESS' : 'SECONDARY')
            )

            // Update question with disabled buttons
            await interaction.editReply({ components: [disabledRow1, disabledRow2] })

            // Compile results
            const correct_answerers = []
            const wrong_answerers = []

            answerers.forEach((data, userId) => {
                const timeStr = `${((data.timestamp - startTimestamp) / 1000).toFixed(2)}s`
                if (data.isCorrect) {
                    correct_answerers.push(`- ${data.username} - ${timeStr}`)
                } else {
                    wrong_answerers.push(`- ${data.username} - ${timeStr} (chose: ${allChoices[data.choice]})`)
                }
            })

            const result_embeded = new MessageEmbed()
                .setTitle('Result')
                .setDescription(getResultDescription(question_type, correctAnswer, ship, fr_name, alias))
                .addField('Correct answers:', correct_answerers.length > 0 ? correct_answerers.join('\n') : 'None')
                .addField('Wrong answers:', wrong_answerers.length > 0 ? wrong_answerers.join('\n') : 'None')

            if (isHardmode && img_base) {
                const new_question_embeded = question_embeded.setImage('attachment://img_base.png')
                await interaction.editReply({ 
                    embeds: [new_question_embeded], 
                    files: [{ attachment: img_base, name: 'img_base.png' }],
                    components: [disabledRow1, disabledRow2]
                })
            }

            await interaction.followUp({ embeds: [result_embeded] })
        })
    },
};

// Helper function to get question data based on type
async function getQuestionData(ship, fr_name, baseQuery, questionType) {
    let correctAnswer = ''
    let questionText = ''
    let wrongChoices = []

    switch (questionType) {
        case 'name':
            correctAnswer = ship.char
            questionText = 'Who is this ship girl?'
            wrongChoices = await getWrongChoicesName(ship, baseQuery)
            break
            
        case 'category':
            correctAnswer = fr_name === 'Artist Original Content' ? 'None' : fr_name
            questionText = 'Which game/franchise does this shipgirl come from?'
            wrongChoices = await getWrongChoicesCategory(ship, baseQuery)
            break
            
        case 'hull_type':
            correctAnswer = ship.ship_type.replace(/^\? /, '')
            questionText = 'What is the hull type of this ship girl?'
            wrongChoices = await getWrongChoicesHullType(ship)
            break
            
        case 'nation':
            // Remove question mark prefix if present
            correctAnswer = Array.isArray(ship.nation) ? ship.nation[0].replace(/^\? /, '') : ship.nation.replace(/^\? /, '')
            questionText = 'Where does this ship girl come from?'
            wrongChoices = await getWrongChoicesNation(ship)
            break
            
        case 'birthday':
            // Parse birthday to m/d format using regex
            const birthdayRaw = ship.birthday.replace(/^\? /, '')
            const birthdayMatch = birthdayRaw.match(/(\d{1,2})\/(\d{1,2})/)
            if (!birthdayMatch) {
                // Fallback if regex fails
                correctAnswer = birthdayRaw
            } else {
                correctAnswer = `${birthdayMatch[1]}/${birthdayMatch[2]}`
            }
            questionText = 'What is the birthday of this ship girl?'
            wrongChoices = getRandomDates(3)
            break
            
        case 'height':
            // Clean and standardize height format
            const heightRaw = ship.height.replace(/^\? /, '')
            const heightMatch = heightRaw.match(/([\d,.]+)\s*([a-zA-Z]+)/)
            if (heightMatch) {
                correctAnswer = `${heightMatch[1]}${heightMatch[2]}`
            } else {
                correctAnswer = heightRaw
            }
            questionText = 'What is the real life "height" of this ship girl?'
            wrongChoices = await getWrongChoicesHeight(ship, baseQuery)
            break
            
        case 'weight':
            // Clean and standardize displacement format
            const weightRaw = ship.displacement.replace(/^\? /, '')
            const weightMatch = weightRaw.match(/([\d,.]+)\s*([a-zA-Z]+)/)
            if (weightMatch) {
                correctAnswer = `${weightMatch[1]}${weightMatch[2]}`
            } else {
                correctAnswer = weightRaw
            }
            questionText = 'What is the real life "weight" (displacement) of this ship girl?'
            wrongChoices = await getWrongChoicesWeight(ship, baseQuery)
            break
    }

    return { wrongChoices, correctAnswer, questionText }
}

// Helper function to get result description
function getResultDescription(questionType, correctAnswer, ship, fr_name, alias) {
    switch (questionType) {
        case 'name':
            return `**Answer:** ${ship.char} from ${fr_name}\n${alias.length > 0 ? `*Also accepted:* ${alias.join(', ')}` : ''}`
        case 'category':
            return `**Answer:** ${correctAnswer}\n**Shipgirl:** ${ship.char}`
        case 'hull_type':
            return `**Answer:** ${correctAnswer}\n**Shipgirl:** ${ship.char} from ${fr_name}`
        case 'nation':
            return `**Answer:** ${correctAnswer}\n**Shipgirl:** ${ship.char} from ${fr_name}`
        case 'birthday':
            return `**Answer:** ${correctAnswer}\n**Shipgirl:** ${ship.char} from ${fr_name}`
        case 'height':
            return `**Answer:** ${correctAnswer}\n**Shipgirl:** ${ship.char} from ${fr_name}`
        case 'weight':
            return `**Answer:** ${correctAnswer}\n**Shipgirl:** ${ship.char} from ${fr_name}`
        default:
            return `**Answer:** ${correctAnswer}`
    }
}

// Helper function to get wrong choices for name question
async function getWrongChoicesName(correctShip, baseQuery) {
    const excludeChars = [correctShip.char]
    
    // Define search criteria in order of priority
    const searchCriteria = [
        // Same category (folder), ship type, and nation
        {
            ...baseQuery,
            folder: correctShip.folder,
            ship_type: correctShip.ship_type,
            nation: correctShip.nation,
            char: { $nin: excludeChars }
        },
        // Same ship type and nation
        {
            ...baseQuery,
            ship_type: correctShip.ship_type,
            nation: correctShip.nation,
            char: { $nin: excludeChars }
        },
        // Same ship type only
        {
            ...baseQuery,
            ship_type: correctShip.ship_type,
            char: { $nin: excludeChars }
        },
        // Same nation only
        {
            ...baseQuery,
            nation: correctShip.nation,
            char: { $nin: excludeChars }
        },
        // Same category only
        {
            ...baseQuery,
            folder: correctShip.folder,
            char: { $nin: excludeChars }
        },
        // Any character in database
        {
            ...baseQuery,
            char: { $nin: excludeChars }
        }
    ]

    // Try each criterion until we get at least 3 choices
    for (const criterion of searchCriteria) {
        try {
            // Clean up query
            let cleanQuery = { ...criterion }
            if (cleanQuery.$and && cleanQuery.$and.length === 0) {
                delete cleanQuery.$and
            }

            const results = await aggregateRecord('shipgirl', [
                { $match: cleanQuery },
                { $sample: { size: 25 } }
            ], true)

            if (results && results.length >= 3) {
                // Return unique character names
                const uniqueChars = [...new Set(results.map(r => r.char))]
                const filtered = uniqueChars.filter(char => char !== correctShip.char)
                if (filtered.length >= 3) {
                    return filtered
                }
            }
        } catch (e) {
            console.error('Error searching for wrong choices:', e)
        }
    }

    return []
}

// Helper function to get wrong choices for category question
async function getWrongChoicesCategory(correctShip, baseQuery) {
    const excludeFolders = [correctShip.folder]
    
    // Try to find ships with the same name first
    try {
        const sameNameQuery = {
            ...baseQuery,
            char: correctShip.char,
            folder: { $nin: excludeFolders }
        }
        if (sameNameQuery.$and && sameNameQuery.$and.length === 0) {
            delete sameNameQuery.$and
        }
        
        const sameNameResults = await aggregateRecord('shipgirl', [
            { $match: sameNameQuery },
            { $sample: { size: 50 } }
        ], true)
        
        if (sameNameResults && sameNameResults.length >= 3) {
            const uniqueFolders = [...new Set(sameNameResults.map(r => r.folder))]
            const filtered = uniqueFolders.filter(f => f !== correctShip.folder).map(f => f === 'Artist Original Content' ? 'None' : f)
            if (filtered.length >= 3) {
                return filtered
            }
        }
    } catch (e) {
        console.error('Error searching for same name ships:', e)
    }
    
    // Fall back to ships with same ship_type
    try {
        const sameTypeQuery = {
            ...baseQuery,
            ship_type: correctShip.ship_type,
            folder: { $nin: excludeFolders }
        }
        if (sameTypeQuery.$and && sameTypeQuery.$and.length === 0) {
            delete sameTypeQuery.$and
        }
        
        const sameTypeResults = await aggregateRecord('shipgirl', [
            { $match: sameTypeQuery },
            { $sample: { size: 50 } }
        ], true)
        
        if (sameTypeResults && sameTypeResults.length >= 3) {
            const uniqueFolders = [...new Set(sameTypeResults.map(r => r.folder))]
            const filtered = uniqueFolders.filter(f => f !== correctShip.folder).map(f => f === 'Artist Original Content' ? 'None' : f)
            if (filtered.length >= 3) {
                return filtered
            }
        }
    } catch (e) {
        console.error('Error searching for same type ships:', e)
    }
    
    // Random categories
    const allCategories = [
        'Azur Lane', 'Kantai Collection', 'Warship Girls R', 'Axis Senki', 
        'Abyss Horizon', 'Black Surgenights', 'Blue Oath', 'Velvet Code',
        'Victory Belles', 'Battleship Girl', 'Battleship Bishoujo Puzzle', 'None'
    ]
    return allCategories.filter(c => c !== correctShip.folder && c !== (correctShip.folder === 'Artist Original Content' ? 'None' : correctShip.folder))
}

// Helper function to get wrong choices for hull_type question
async function getWrongChoicesHullType(correctShip) {
    const correctType = correctShip.ship_type.replace(/^\? /, '')
    return SHIP_TYPES.filter(t => t !== correctType).sort(() => Math.random() - 0.5)
}

// Helper function to get wrong choices for nation question
async function getWrongChoicesNation(correctShip) {
    const correctNation = Array.isArray(correctShip.nation) 
        ? correctShip.nation[0].replace(/^\? /, '') 
        : correctShip.nation.replace(/^\? /, '')
    return NATIONS.filter(n => n !== correctNation).sort(() => Math.random() - 0.5)
}

// Helper function to generate random dates
function getRandomDates(count) {
    const dates = []
    for (let i = 0; i < count; i++) {
        const month = Math.floor(Math.random() * 12) + 1
        const day = Math.floor(Math.random() * 28) + 1 // Use 28 to avoid invalid dates
        dates.push(`${month}/${day}`)
    }
    return dates
}

// Helper function to get wrong choices for height question
async function getWrongChoicesHeight(correctShip, baseQuery) {
    // Try to get heights from same hull type first
    try {
        const sameTypeQuery = {
            ...baseQuery,
            ship_type: correctShip.ship_type,
            height: { $exists: true, $ne: null },
            char: { $ne: correctShip.char }
        }
        if (sameTypeQuery.$and && sameTypeQuery.$and.length === 0) {
            delete sameTypeQuery.$and
        }
        
        const results = await aggregateRecord('shipgirl', [
            { $match: sameTypeQuery },
            { $sample: { size: 50 } }
        ], true)
        
        if (results && results.length >= 3) {
            const heights = results.map(r => {
                const heightRaw = r.height.replace(/^\? /, '')
                const heightMatch = heightRaw.match(/([\d,.]+)\s*([a-zA-Z]+)/)
                return heightMatch ? `${heightMatch[1]}${heightMatch[2]}` : heightRaw
            }).filter(h => h !== correctShip.height)
            
            const uniqueHeights = [...new Set(heights)]
            if (uniqueHeights.length >= 3) {
                return uniqueHeights.slice(0, 10)
            }
        }
    } catch (e) {
        console.error('Error searching for height:', e)
    }
    
    // Generate random heights based on correct answer
    return generateRandomMeasurements(correctShip.height, 3)
}

// Helper function to get wrong choices for weight question
async function getWrongChoicesWeight(correctShip, baseQuery) {
    // Try to get displacements from same hull type first
    try {
        const sameTypeQuery = {
            ...baseQuery,
            ship_type: correctShip.ship_type,
            displacement: { $exists: true, $ne: null },
            char: { $ne: correctShip.char }
        }
        if (sameTypeQuery.$and && sameTypeQuery.$and.length === 0) {
            delete sameTypeQuery.$and
        }
        
        const results = await aggregateRecord('shipgirl', [
            { $match: sameTypeQuery },
            { $sample: { size: 50 } }
        ], true)
        
        if (results && results.length >= 3) {
            const weights = results.map(r => {
                const weightRaw = r.displacement.replace(/^\? /, '')
                const weightMatch = weightRaw.match(/([\d,.]+)\s*([a-zA-Z]+)/)
                return weightMatch ? `${weightMatch[1]}${weightMatch[2]}` : weightRaw
            }).filter(d => d !== correctShip.displacement)
            
            const uniqueWeights = [...new Set(weights)]
            if (uniqueWeights.length >= 3) {
                return uniqueWeights.slice(0, 10)
            }
        }
    } catch (e) {
        console.error('Error searching for displacement:', e)
    }
    
    // Generate random weights based on correct answer
    return generateRandomMeasurements(correctShip.displacement, 3)
}

// Helper function to generate random measurements with variance
function generateRandomMeasurements(original, count) {
    // Remove question mark and standardize format
    const cleanOriginal = original.replace(/^\? /, '')
    const matches = cleanOriginal.match(/([\d,.]+)\s*([a-zA-Z]+)/)
    if (!matches) return []
    
    const value = parseFloat(matches[1].replace(/,/g, ''))
    const unit = matches[2]
    
    const results = []
    for (let i = 0; i < count; i++) {
        // Generate ±10-30% variance
        const variance = 0.1 + Math.random() * 0.2 // 10-30%
        const multiplier = Math.random() > 0.5 ? (1 + variance) : (1 - variance)
        const newValue = Math.round(value * multiplier * 100) / 100
        results.push(`${newValue.toLocaleString()}${unit}`)
    }
    
    return results
}
