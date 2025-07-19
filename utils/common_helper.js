const fs = require('fs');

function listAllFiles(root_dir, current_dir = '', allFilesList = []) {
    if (current_dir === '') current_dir = root_dir
    const files = fs.readdirSync(current_dir);
    files.map(file => {
        const name = current_dir + '/' + file;
        if (fs.statSync(name).isDirectory()) { // check if subdirectory is present
            listAllFiles(root_dir, name, allFilesList);     // do recursive execution for subdirectory
        } else {
            // push filename relative to root_dir
            allFilesList.push(name.replace(root_dir + '/', ''));
        }
    })

    return allFilesList;
}

function convert_upload_path_to_file_data(upload_path, worker_endpoint) {
    if (!upload_path) {
        return null
    }
    // prune the server url
    upload_path = upload_path.replace(`${worker_endpoint}/file=`, '')
    return {
        path: upload_path,
        url: `${worker_endpoint}/file=${upload_path}`
    }
}


function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

function truncate(str, n){
    return (str.length > n) ? str.substr(0, n-1) + '...' : str;
}

function try_parse_json_and_return_formated_string(input) {
    try {
        const json = JSON.parse(input)
        return JSON.stringify(json, null, 2)
    }
    catch (error) {
        return "Invalid JSON"
    }
}

/**
 * Calculates the optimal grid dimensions for displaying multiple images
 * @param {number} imageWidth - Width of each individual image
 * @param {number} imageHeight - Height of each individual image
 * @param {number} imageCount - Number of images to arrange in grid
 * @returns {Object} Object containing grid dimensions and layout information
 */
function calculateOptimalGrid(imageWidth, imageHeight, imageCount) {
    // Early return for edge cases
    if (imageCount <= 1) {
        return {
            columns: 1,
            rows: 1,
            gridWidth: imageWidth,
            gridHeight: imageHeight
        };
    }
    
    const aspectRatio = imageWidth / imageHeight;
    
    // Find the most efficient grid layout
    // Start with a square-ish grid and adjust based on aspect ratio
    let columns = Math.ceil(Math.sqrt(imageCount));
    let rows = Math.ceil(imageCount / columns);
    
    // Adjust grid to better match the original image aspect ratio
    if (aspectRatio > 1) {
        // For landscape images, prefer more columns
        while ((columns - 1) * rows >= imageCount && columns > 1) {
            columns--;
        }
    } else {
        // For portrait images, prefer more rows
        while (columns * (rows - 1) >= imageCount && rows > 1) {
            rows--;
        }
        
        // Further optimize to make grid more square-like
        if (columns * rows - imageCount > columns) {
            columns = Math.ceil(imageCount / rows);
        }
    }
    
    // Calculate final grid dimensions
    const gridWidth = columns * imageWidth;
    const gridHeight = rows * imageHeight;
    
    return {
        columns,
        rows,
        gridWidth,
        gridHeight
    };
}

/**
 * Parses the img_count input and calculates optimal batch configuration
 * 
 * @param {string|number} imgCountInput - Input can be a number or string in format "NxM"
 * @param {number} height - Image height in pixels
 * @param {number} width - Image width in pixels
 * @param {number} upscale_multiplier - Upscale factor (default 1)
 * @returns {Object} Object containing total image count, batch count, and batch size
 */
function parseImageCount(imgCountInput, height, width, upscale_multiplier = 1, max_image = 16) {
    const MAX_IMAGES = max_image; // Maximum images allowed, default is 16
    let img_count = 0;
    let batch_count = 1;
    let batch_size = 1;
    let useCustomBatching = false;
    
    // Calculate the maximum batch size based on image dimensions
    const reference_size = 2048 * 2048; // Reference size safe for batch size of 4
    const max_batch_size = Math.floor(reference_size * 4 / (height * width * upscale_multiplier * upscale_multiplier));

    console.log(imgCountInput, height, width, upscale_multiplier, max_batch_size)
    
    // Parse input format
    if (typeof imgCountInput === 'string' && imgCountInput.includes('x')) {
        // Format: <batch_count>x<batch_size>
        const parts = imgCountInput.toLowerCase().split('x');
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            batch_count = parseInt(parts[0], 10);
            batch_size = parseInt(parts[1], 10);
            img_count = batch_count * batch_size;
            useCustomBatching = true;
        } else {
            // Invalid format, default to 1
            img_count = 1;
            batch_count = 1;
            batch_size = 1;
        }
    } else {
        // Simple number format
        img_count = parseInt(imgCountInput, 10);
        if (isNaN(img_count) || img_count < 1) {
            img_count = 1;
            batch_count = 1;
            batch_size = 1;
        }
    }
    
    // Cap total image count at MAX_IMAGES
    if (img_count > MAX_IMAGES) {
        img_count = MAX_IMAGES;
        // attempt to adhere to custom batching by reducing batch count first until batch_count x batch_size <= MAX_IMAGES, if batch_count == 1, then reduce batch_size
        if (useCustomBatching && batch_count > 1) {
            while (batch_count * batch_size > MAX_IMAGES && batch_count > 1) {
                batch_count--;
            }
            if (batch_count * batch_size > MAX_IMAGES) {
                batch_size = Math.floor(MAX_IMAGES / batch_count);
            }
        }
    }
    
    // If custom batching was specified and we're under the cap, use it
    if (useCustomBatching && img_count <= MAX_IMAGES) {
        return {
            bulk_size: img_count,
            batch_count,
            batch_size
        };
    }
    
    // Otherwise, calculate optimal batch configuration
    batch_size = Math.min(max_batch_size, img_count);
    
    // Adjust batch size to ensure it divides img_count evenly
    while (img_count % batch_size !== 0 && batch_size > 1) {
        batch_size--;
    }
    
    batch_count = Math.ceil(img_count / batch_size);
    
    return {
        bulk_size: img_count,
        batch_count,
        batch_size
    };
}

function parse_common_setting(setting_json) {
    if (setting_json) {
        try {
            const usersetting_config_obj = JSON.parse(setting_json)
            return {
                do_preview: usersetting_config_obj?.do_preview ?? true
            }
        }
        catch (err) {
            console.log("Failed to parse user setting config", err)
        }
    }
    else {
        return {
            do_preview: true
        }
    }
}


module.exports = {
    listAllFiles,
    convert_upload_path_to_file_data,
    clamp,
    truncate,
    try_parse_json_and_return_formated_string,
    calculateOptimalGrid,
    parseImageCount,
    parse_common_setting
}
