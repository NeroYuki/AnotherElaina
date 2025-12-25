const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const { exec } = require('child_process');
const { promisify } = require('util');
const { uploadAudio, startInference, streamOutput, getBeatmap } = require('./utils/mapperinator_execute');
const NodeID3 = require('node-id3');
const { getAudioDurationInSeconds } = require('get-audio-duration');

const execPromise = promisify(exec);

// Load beatmap users data
const beatmapUsers = JSON.parse(fs.readFileSync('./beatmap_users.json', 'utf8'));

// ============================================
// HARDCODED CONFIGURATION
// ============================================
const CONFIG = {
    // Server configuration
    server_address: 'http://192.168.1.2:7050',
    
    // Audio file path (replace with your audio file)
    audio_file_path: "E:\\music_2_trimmed\\09.Fire Beat.mp3",
    
    // Background image path (optional, set to null if not needed)
    image_file_path: null, // e.g., './temp/background.jpg'
    
    // Mapper IDs to iterate through
    mapper_ids: [
        null,
        1634445,
        643394,
        3250792,
        8688812,
        2805457,
        2308676,
        3475189,
        5918561,
        6933054,
        3376777,
        5960077,
        227717,
        4086497,
        1603923,
        4966334,
        2841009,
        3827077,
        53378,
        5062061,
        3545579,
        5645667,
        918297,
        1848318,
        1367570,
        5075660,
        2848604,
        153323,
        631530,
        104401,
        873961,
        44308,
        6381153,
        443031,
        7262798,
        2942381,
        9823042,
        1943309,
        1243669,
        3621552,
        1156742,
        3143784,
    ],
    
    // Beatmap generation parameters
    model: 'v30', // 'v30' or 'v31'

    //EXPERIMENTAL SETTINGS
    //=============================================
    enable_bf16: true, // Use bf16 precision if supported
    enable_flash_attn: true, // Use flash attention if supported
    //=============================================

    lora_path: "D:\\AIstuff\\Mapperatorinator\\lora\\Mapperatorinator-v30-LoRA-highSR",

    difficulty: 10,
    sv: 1.4,
    tick_rate: 1,
    cs: 4.2,
    od: 10,
    ar: 10,
    hp: 5,
    seed: '',
    gamemode: '0', // 0=Standard, 1=Taiko, 2=Catch, 3=Mania
    year: null,
    cfg_scale: 3.0,
    temperature: 0.95,
    top_p: 0.9,
    super_timing: false,
    add_hitsounds: true,
    hold_note_ratio: 0.3, // Only for mania
    scroll_speed_ratio: 0, // Only for catch/mania
    
    // Optional overrides (set to null to use metadata from audio)
    artist: null,
    title: null,
    
    // Output directory
    output_dir: 'E:/ai_beatmap',
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get mapper name from user_id
 */
function getMapperName(user_id, nullIndex = null) {
    if (user_id === null || user_id === undefined) {
        if (nullIndex !== null) {
            return `N/A-${nullIndex}`;
        }
        return 'N/A';
    }
    const numericId = typeof user_id === 'number' ? user_id : parseInt(user_id);
    const user = beatmapUsers.find(u => u.user_id === numericId);
    if (user && user.username && user.username.length > 0) {
        return user.username[0];
    }
    return `mapper_${numericId}`; // fallback to user_id if not found
}

/**
 * Load audio file from disk
 */
function loadAudioFile(filePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`Audio file not found: ${filePath}`));
        }
        
        const audioBuffer = fs.readFileSync(filePath);
        resolve(audioBuffer);
    });
}

/**
 * Extract metadata from audio file
 */
function extractMetadata(audioBuffer) {
    try {
        const options = {
            include: ['TIT2', 'TPE1'],
        };
        const tags = NodeID3.read(audioBuffer, options);
        return tags;
    } catch (err) {
        console.log('Failed to extract metadata:', err.message);
        return {};
    }
}

/**
 * Get audio file duration in seconds
 */
async function getAudioDuration(filePath) {
    try {
        const duration = await getAudioDurationInSeconds(filePath);
        return duration || 0;
    } catch (err) {
        console.log('Failed to extract audio duration:', err.message);
        return 0;
    }
}

/**
 * Preprocess audio file: re-encode to MP3 128kbps and normalize volume
 */
async function preprocessAudio(inputPath) {
    const outputDir = './temp';
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const randomId = crypto.randomBytes(8).toString('hex');
    const outputPath = path.join(outputDir, `processed_${randomId}.mp3`);
    
    console.log('  Preprocessing audio with ffmpeg...');
    console.log('    - Re-encoding to MP3 128kbps');
    console.log('    - Normalizing volume (loudnorm)');
    
    try {
        // Use ffmpeg to:
        // 1. Normalize audio with loudnorm filter (EBU R128 standard)
        // 2. Re-encode to MP3 at 128kbps
        const ffmpegCmd = `ffmpeg -i "${inputPath}" -af loudnorm=I=-16:TP=-1.5:LRA=11 -b:a 128k -y "${outputPath}"`;
        
        const { stdout, stderr } = await execPromise(ffmpegCmd);
        
        if (!fs.existsSync(outputPath)) {
            throw new Error('Processed audio file was not created');
        }
        
        const originalSize = fs.statSync(inputPath).size;
        const processedSize = fs.statSync(outputPath).size;
        console.log(`  ✓ Audio preprocessed: ${outputPath}`);
        console.log(`    Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`    Processed size: ${(processedSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`    Size reduction: ${((1 - processedSize / originalSize) * 100).toFixed(1)}%`);
        
        return outputPath;
    } catch (err) {
        console.error('  ✗ Failed to preprocess audio:', err.message);
        console.error('  Falling back to original audio file...');
        return inputPath; // Return original path if preprocessing fails
    }
}

/**
 * Download and prepare beatmap content
 */
async function downloadBeatmap(server_address, beatmap_path, beatmap_info, mapper_id, audio_filename, image_filename = null, nullIndex = null) {
    try {
        console.log(`  Downloading beatmap: ${beatmap_path}`);
        const beatmap_content_raw = await getBeatmap(server_address, beatmap_path);
        
        if (!beatmap_content_raw) {
            throw new Error('Failed to download beatmap');
        }
        
        // Manually edit the beatmap content
        let beatmap_content = beatmap_content_raw;
        beatmap_content = beatmap_content.replace(/^Title:.*$/m, `Title:${beatmap_info.title}`);
        beatmap_content = beatmap_content.replace(/^TitleUnicode:.*$/m, `TitleUnicode:${beatmap_info.title}`);
        beatmap_content = beatmap_content.replace(/^Artist:.*$/m, `Artist:${beatmap_info.artist}`);
        beatmap_content = beatmap_content.replace(/^ArtistUnicode:.*$/m, `ArtistUnicode:${beatmap_info.artist}`);
        beatmap_content = beatmap_content.replace(/^AudioFilename:.*$/m, `AudioFilename:${audio_filename}`);
        beatmap_content = beatmap_content.replace(/^Mode: None$/m, `Mode: 0`);
        beatmap_content = beatmap_content.replace(/^OverallDifficulty:.*$/m, `OverallDifficulty:${beatmap_info.od}`);
        beatmap_content = beatmap_content.replace(/^ApproachRate:.*$/m, `ApproachRate:${beatmap_info.ar}`);
        beatmap_content = beatmap_content.replace(/^HPDrainRate:.*$/m, `HPDrainRate:${beatmap_info.hp}`);
        
        const mapper_name = getMapperName(mapper_id, nullIndex);
        beatmap_content = beatmap_content.replace(/^Version:.*$/m, `Version:Mapperatorinator V30 - ${mapper_name}`);
        
        // Set background image if provided
        if (image_filename) {
            // Check if there's already a background line and replace it, or add it
            if (/^0,0,".*"/.test(beatmap_content)) {
                beatmap_content = beatmap_content.replace(/^0,0,".*"/m, `0,0,"${image_filename}"`);
            } else {
                // Add background line in [Events] section
                beatmap_content = beatmap_content.replace(/^\[Events\]$/m, `[Events]\n0,0,"${image_filename}"`);
            }
        }
        
        // Add BeatmapID and BeatmapSetID
        beatmap_content = beatmap_content.replace(/^(Tags:.*)$/m, `$1\nBeatmapID:0\nBeatmapSetID:-1`);
        
        const sanitized_mapper_name = mapper_name.replace(/[\\//\\\\\:\*\?\"\<\>\|]/g, '');
        const beatmap_filename = beatmap_info.artist.replace(/[\\//\\\\\:\*\?\"\<\>\|]/g, '') + 
                               ' - ' + 
                               beatmap_info.title.replace(/[\\//\\\\\:\*\?\"\<\>\|]/g, '') + 
                               ` [Mapperatorinator - ${sanitized_mapper_name}]` + '.osu';
        
        console.log(`  ✓ Beatmap downloaded: ${beatmap_filename}`);
        
        return {
            content: beatmap_content,
            filename: beatmap_filename,
            mapper_id: mapper_id
        };
    } catch (err) {
        throw new Error(`Failed to download beatmap: ${err.message}`);
    }
}

/**
 * Create a single .osz file containing all beatmaps
 */
async function createBeatmapSet(beatmaps, audio_file, audio_filename, beatmap_info, image_file = null, image_filename = null) {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('Creating final beatmap set...');
        console.log('='.repeat(60));
        
        // Create output directory if it doesn't exist
        if (!fs.existsSync(CONFIG.output_dir)) {
            fs.mkdirSync(CONFIG.output_dir, { recursive: true });
        }
        
        const zip_filename = beatmap_info.artist.replace(/[\\/\\\:\*\?\"\<\>\|]/g, '') + 
                            ' - ' + 
                            beatmap_info.title.replace(/[\//\\\:\*\?\"\<\>\|]/g, '') + 
                            '_' + Date.now() + '.osz';
        
        const zip_path = path.join(CONFIG.output_dir, zip_filename);
        const output = fs.createWriteStream(zip_path);
        const zip = archiver('zip', {
            zlib: { level: 9 }
        });
        
        return new Promise((resolve, reject) => {
            output.on('close', () => {
                console.log(`✓ Beatmap set created: ${zip_filename}`);
                console.log(`  Total size: ${(zip.pointer() / 1024 / 1024).toFixed(2)} MB`);
                console.log(`  Contains ${beatmaps.length} difficulties`);
                resolve(zip_path);
            });
            
            zip.on('error', (err) => {
                reject(err);
            });
            
            zip.pipe(output);
            
            // Add all beatmap difficulties
            console.log(`Adding ${beatmaps.length} difficulties to beatmap set...`);
            beatmaps.forEach((beatmap, index) => {
                console.log(`  [${index + 1}/${beatmaps.length}] ${beatmap.filename}`);
                zip.append(Buffer.from(beatmap.content), { name: beatmap.filename });
            });
            
            // Add audio file
            console.log(`Adding audio file: ${audio_filename}`);
            zip.append(audio_file, { name: audio_filename });
            
            // Add image file if exists
            if (image_file) {
                console.log(`Adding background image: ${image_filename}`);
                zip.append(image_file, { name: image_filename });
            }
            
            zip.finalize();
        });
    } catch (err) {
        throw new Error(`Failed to create beatmap set: ${err.message}`);
    }
}

/**
 * Wait for generation to complete by streaming output
 */
function waitForCompletion(server_address) {
    return new Promise((resolve, reject) => {
        let lastOutput = '';
        
        streamOutput(server_address, async (data) => {
            if (data) {
                lastOutput = data;
                // Print progress without newline
                process.stdout.write(`\r  Progress: ${data.substring(0, 80)}...`);
            }
            
            if (data && data.includes("Generated beatmap saved")) {
                console.log('\n  ✓ Generation completed!');
                
                // Extract beatmap path from output
                const match = data.match(/Generated beatmap saved to (.+\.osu)/);
                if (match) {
                    resolve(match[1]);
                } else {
                    reject(new Error('Could not extract beatmap path from output'));
                }
            }
        }).catch((err) => {
            reject(new Error(`Stream error: ${err.message}`));
        });
    });
}

/**
 * Process a single mapper ID
 */
async function processMapperID(mapper_id, uploaded_audio_path, audio_filename, beatmap_info, image_filename = null, nullIndex = null) {
    const startTime = Date.now();
    const mapper_name = getMapperName(mapper_id, nullIndex);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Processing Mapper ID: ${mapper_id} (${mapper_name})`);
    console.log(`${'='.repeat(60)}`);
    
    try {
        // Step 1: Start inference
        console.log('  Starting inference...');
        const keycount = CONFIG.gamemode === '3' ? CONFIG.cs : 1;
        
        const inference_params = {
            audio_path: uploaded_audio_path,
            beatmap_path: '',
            output_path: './output',
            model: CONFIG.model,
            enable_bf16: CONFIG.enable_bf16,
            enable_flash_attn: CONFIG.enable_flash_attn,
            difficulty: CONFIG.difficulty,
            slider_multiplier: CONFIG.sv,
            slider_tick_rate: CONFIG.tick_rate,
            circle_size: CONFIG.cs,
            hp_drain_rate: CONFIG.hp,
            approach_rate: CONFIG.ar,
            overall_difficulty: CONFIG.od,
            keycount: keycount,
            hold_note_ratio: CONFIG.hold_note_ratio,
            scroll_speed_ratio: CONFIG.scroll_speed_ratio,
            seed: CONFIG.seed,
            gamemode: CONFIG.gamemode,
            year: CONFIG.year,
            mapper_id: mapper_id !== null ? String(mapper_id) : '',
            cfg_scale: CONFIG.cfg_scale,
            temperature: CONFIG.temperature,
            top_p: CONFIG.top_p,
            super_timing: CONFIG.super_timing,
            hitsounded: CONFIG.add_hitsounds,
            descriptors: [],
            negative_descriptors: [],
            in_context_options: [],
            lora_path: CONFIG.lora_path,
        };
        
        await startInference(CONFIG.server_address, inference_params);
        console.log('  ✓ Inference started');
        
        // Step 2: Wait for completion
        console.log('  Waiting for generation to complete...');
        const beatmap_path = await waitForCompletion(CONFIG.server_address);
        
        // Step 3: Download beatmap
        const beatmap = await downloadBeatmap(
            CONFIG.server_address,
            beatmap_path,
            beatmap_info,
            mapper_id,
            audio_filename,
            image_filename,
            nullIndex
        );
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000; // in seconds
        console.log(`✓ Successfully processed mapper ID: ${mapper_id}`);
        console.log(`  Time taken: ${duration.toFixed(2)}s`);
        
        return { ...beatmap, duration };
        
    } catch (err) {
        console.error(`✗ Failed to process mapper ID ${mapper_id}:`, err.message);
        throw err;
    }
}

/**
 * Main execution function
 */
async function main() {
    console.log('\n' + '='.repeat(60));
    console.log('Mapperatorinator Bulk Runner');
    console.log('='.repeat(60));
    console.log(`Audio file: ${CONFIG.audio_file_path}`);
    console.log(`Server: ${CONFIG.server_address}`);
    console.log(`Model: ${CONFIG.model}`);
    console.log(`Mapper IDs: ${CONFIG.mapper_ids.length}`);
    console.log(`Output directory: ${CONFIG.output_dir}`);
    console.log('='.repeat(60));
    
    try {
        // Preprocess audio file
        console.log('\nPreprocessing audio file...');
        const processed_audio_path = await preprocessAudio(CONFIG.audio_file_path);
        
        // Load audio file
        console.log('\nLoading preprocessed audio file...');
        const audio_file = await loadAudioFile(processed_audio_path);
        const audio_filename = path.basename(processed_audio_path);
        console.log(`✓ Audio loaded: ${audio_filename} (${audio_file.length} bytes)`);
        
        // Load image file if provided
        let image_file = null;
        let image_filename = null;
        if (CONFIG.image_file_path) {
            try {
                console.log('Loading background image...');
                image_file = await loadAudioFile(CONFIG.image_file_path); // reuse same function for file loading
                image_filename = path.basename(CONFIG.image_file_path);
                console.log(`✓ Background image loaded: ${image_filename} (${image_file.length} bytes)`);
            } catch (err) {
                console.log(`⚠ Failed to load background image: ${err.message}`);
                console.log('  Continuing without background image...');
            }
        }
        
        // Extract metadata (from original file for better tag reading)
        const tags = extractMetadata(audio_file);
        console.log('✓ Metadata extracted:', tags);
        
        // Get audio duration (from processed file)
        const audio_duration = await getAudioDuration(processed_audio_path);
        console.log(`✓ Audio duration: ${audio_duration.toFixed(2)}s`);
        
        // Prepare beatmap info (shared across all difficulties)
        const artist = CONFIG.artist || tags.artist || 'Unknown Artist';
        const title = CONFIG.title || tags.title || 'Unknown Title';
        
        const beatmap_info = {
            artist: artist,
            title: title,
            od: CONFIG.od,
            ar: CONFIG.ar,
            hp: CONFIG.hp,
        };
        
        // Upload audio file once for all beatmaps
        console.log('\nUploading audio file...');
        const randomId = crypto.randomBytes(16).toString('hex');
        const unique_audio_filename = `audio_${randomId}.${audio_filename.split('.').pop()}`;
        const audio_path_res = await uploadAudio(CONFIG.server_address, audio_file, unique_audio_filename);
        const uploaded_audio_path = './temp/' + audio_path_res.path.split('\\').pop().split('/').pop();
        console.log(`✓ Audio uploaded: ${audio_path_res.path}`);
        console.log(`  Will be reused for all ${CONFIG.mapper_ids.length} beatmaps`);
        
        // Process each mapper ID and collect beatmaps
        const beatmaps = [];
        const results = [];
        const durations = [];
        
        // Track null count for unique identifiers
        let nullCount = 0;
        
        for (let i = 0; i < CONFIG.mapper_ids.length; i++) {
            const mapper_id = CONFIG.mapper_ids[i];
            
            // Calculate nullIndex for null mapper_ids
            let nullIndex = null;
            if (mapper_id === null) {
                nullCount++;
                nullIndex = nullCount;
            }
            
            console.log(`\n[${i + 1}/${CONFIG.mapper_ids.length}] Processing mapper ID: ${mapper_id}`);
            
            try {
                const beatmap = await processMapperID(mapper_id, uploaded_audio_path, audio_filename, beatmap_info, image_filename, nullIndex);
                beatmaps.push(beatmap);
                durations.push(beatmap.duration);
                results.push({ mapper_id, status: 'success', difficulty: beatmap.filename, duration: beatmap.duration });
            } catch (err) {
                console.error(`Failed to process mapper ID ${mapper_id}:`, err.message);
                results.push({ mapper_id, status: 'failed', error: err.message });
                
                // Optional: Continue with next mapper ID or stop on error
                // To stop on first error, uncomment the following line:
                // throw err;
            }
            
            // Optional: Add delay between requests
            if (i < CONFIG.mapper_ids.length - 1) {
                console.log('  Waiting 3 seconds before next request...');
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
        
        // Create single beatmap set with all difficulties
        if (beatmaps.length > 0) {
            console.log(`\nCreating beatmap set with ${beatmaps.length} difficulties...`);
            const beatmap_set_path = await createBeatmapSet(
                beatmaps,
                audio_file,
                audio_filename,
                beatmap_info,
                image_file,
                image_filename
            );
            
            console.log(`\n✓ Beatmap set saved to: ${beatmap_set_path}`);
        } else {
            console.log('\n✗ No beatmaps were generated successfully!');
        }
        
        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('SUMMARY');
        console.log('='.repeat(60));
        const successful = results.filter(r => r.status === 'success').length;
        const failed = results.filter(r => r.status === 'failed').length;
        console.log(`Total: ${results.length}`);
        console.log(`Successful: ${successful}`);
        console.log(`Failed: ${failed}`);
        
        if (durations.length > 0) {
            const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
            const totalDuration = durations.reduce((a, b) => a + b, 0);
            const avgMultiplier = audio_duration > 0 ? audio_duration / avgDuration : 0;
            console.log(`\nTiming Statistics:`);
            console.log(`  Average time per map: ${avgDuration.toFixed(2)}s`);
            console.log(`  Total inference time: ${totalDuration.toFixed(2)}s`);
            console.log(`  Fastest: ${Math.min(...durations).toFixed(2)}s`);
            console.log(`  Slowest: ${Math.max(...durations).toFixed(2)}s`);
            if (audio_duration > 0) {
                console.log(`  Real-time multiplier: ${avgMultiplier.toFixed(2)}x (${audio_duration.toFixed(2)}s audio / ${avgDuration.toFixed(2)}s inference)`);
            }
        }
        
        if (failed > 0) {
            console.log('\nFailed mapper IDs:');
            results.filter(r => r.status === 'failed').forEach(r => {
                console.log(`  - ${r.mapper_id}: ${r.error}`);
            });
        }
        
        if (successful > 0) {
            console.log('\nSuccessful difficulties:');
            results.filter(r => r.status === 'success').forEach(r => {
                console.log(`  - mapper_${r.mapper_id}: ${r.difficulty} (${r.duration.toFixed(2)}s)`);
            });
        }
        
        console.log('\n✓ Bulk processing completed!');
        console.log(`Output directory: ${CONFIG.output_dir}`);
        
        // Clean up processed audio file
        if (processed_audio_path !== CONFIG.audio_file_path && fs.existsSync(processed_audio_path)) {
            try {
                fs.unlinkSync(processed_audio_path);
                console.log('\n✓ Cleaned up temporary processed audio file');
            } catch (err) {
                console.log('⚠ Failed to clean up temporary file:', err.message);
            }
        }
        
    } catch (err) {
        console.error('\n✗ Fatal error:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main().then(() => {
        console.log('\nExiting...');
        process.exit(0);
    }).catch(err => {
        console.error('Unhandled error:', err);
        process.exit(1);
    });
}

module.exports = { main, processMapperID };
