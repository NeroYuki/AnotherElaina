const axios = require('axios');
const FormData = require('form-data');

/**
 * Sends a POST request to the `start_inference` endpoint with all required parameters.
 * @param {string} url - The base URL of the API (e.g., "http://localhost:5000").
 * @param {Object} params - The parameters to send in the request.
 * @returns {Promise<Object>} - The response from the API.
 */
async function startInference(url, params) {
    const endpoint = `${url}/start_inference`;
    const formData = new FormData();

    // Add required paths
    formData.append('model', params.model || 'v30');
    formData.append('audio_path', params.audio_path || '');
    formData.append('output_path', params.output_path || '');
    // formData.append('beatmap_path', params.beatmap_path || '');

    // Add basic settings
    //formData.append('gamemode', params.gamemode || '');
    formData.append('difficulty', params.difficulty || '');
    //formData.append('year', params.year || '');

    // Add numeric settings
    const numericParams = [
        'slider_multiplier', 'circle_size', 'keycount', 'hold_note_ratio',
        'scroll_speed_ratio', 'cfg_scale', 'temperature', 'top_p', 'seed'
    ];
    numericParams.forEach(param => {
        if (params[param] !== undefined) {
            formData.append(param, params[param]);
        }
    });

    // Add mapper_id
    formData.append('mapper_id', params.mapper_id || '');

    // Add timing and segmentation
    // formData.append('start_time', params.start_time || '');
    // formData.append('end_time', params.end_time || '');

    // Add checkboxes
    //if (params.hitsounded) formData.append('hitsounded', 'true');
    //if (params.add_to_beatmap) formData.append('add_to_beatmap', 'true');
    if (params.super_timing) formData.append('super_timing', 'true');

    // Add descriptors
    // if (Array.isArray(params.descriptors)) {
    //     params.descriptors.forEach(descriptor => formData.append('descriptors', descriptor));
    // }

    // Add negative descriptors
    // if (Array.isArray(params.negative_descriptors)) {
    //     params.negative_descriptors.forEach(negative => formData.append('negative_descriptors', negative));
    // }

    // Add in-context options
    // if (Array.isArray(params.in_context_options) && params.beatmap_path) {
    //     params.in_context_options.forEach(option => formData.append('in_context_options', option));
    // }

    try {
        const response = await axios.post(endpoint, formData, {
            headers: formData.getHeaders(),
        });
        return response.data;
    } catch (error) {
        console.log('Error sending request to start_inference:', error.message);
        throw error;
    }
}

// sending a GET request to the `localhost:7050/stream_output` endpoint, the response is text/event-stream, send a callback function to handle the data
async function streamOutput(url, callback) {
    const endpoint = `${url}/stream_output`;
    try {
        const response = await axios.get(endpoint, {
            headers: {
                'Accept': 'text/event-stream',
            },
            responseType: 'stream',
            adapter: 'fetch', // <- this option can also be set in axios.create()
        }).then(async (response) => {
            console.log('axios got a response');
            const stream = response.data;

            // consume response
            const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                //console.log(value);
                callback(value);
            }
        })
    } catch (error) {
        console.log('Error sending request to stream_output:', error.message);
        throw error;
    }
}

// sending a POST request to the `localhost:7050/upload_audio` endpoint, input audio is a buffer, param is formdata with audio_file being the only field
async function uploadAudio(url, audioBuffer, filename) {
    const endpoint = `${url}/upload_audio`;
    const formData = new FormData();
    formData.append('audio_file', audioBuffer, { filename: filename });

    try {
        const response = await axios.post(endpoint, formData);
        return response.data;
    } catch (error) {
        console.log('Error uploading audio:', error.message);
        throw error;
    }
}

// sending a POST request to the `localhost:7050/upload_osu_file_content` endpoint, input audio is a buffer, param is formdata with beatmap_path being the only field
async function getBeatmap(url, beatmapPath) {
    const endpoint = `${url}/upload_osu_file_content`;
    const formData = new FormData();
    formData.append('beatmap_path', beatmapPath);

    try {
        const response = await axios.post(endpoint, formData);
        return response.data;
    } catch (error) {
        console.log('Error uploading osu file:', error.message);
        throw error;
    }
}


module.exports = {
    startInference,
    streamOutput,
    uploadAudio,
    getBeatmap,
};
