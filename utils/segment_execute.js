// use the img2img tab

const { server_pool } = require("./ai_server_config")
const { convert_upload_path_to_file_data } = require("./common_helper")

function groundingDino_execute(prompt, image_path, session_hash, useSwinB = false, threshold = 0.3) {
    // should return array of bouding boxes coordinates
    const req_data = [
        convert_upload_path_to_file_data(image_path, server_pool[0].url),
		useSwinB ? "GroundingDINO_SwinB (938MB)" : "GroundingDINO_SwinT_OGC (694MB)",
		prompt,
		threshold || 0.3            ///threshold
    ]

    return new Promise(async (resolve, reject) => {
        const option_adetailer = {
            method: 'POST',
            body: JSON.stringify({
                fn_index: server_pool[0].fn_index_execute_segment_anything - 3,
                session_hash: session_hash,
                data: req_data
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }

        try {
            await fetch(`${server_pool[0].url}/run/predict/`, option_adetailer)
                .then(res => {
                    console.log(res.status)
                    if (res.status !== 200) {
                        throw 'Failed to preview bounding box'
                    }
                    return res
                }).then(res => res.json())
                .then(data => {
                    resolve({
                        bb: data.data[0],
                        bb_num: data.data[1].value.length
                    });
                })
        }
        catch (err) {
            console.log(err)
            reject(err)
            return
        }
    })
}

function segmentAnything_execute(prompt, boundingBoxes, image_path, session_hash, useSwinB = false, threshold = 0.3) {
    // should return array of masks
    const req_data = [
        "sam_vit_h_4b8939.pth",
        convert_upload_path_to_file_data(image_path, server_pool[0].url),
        [], // segment marker
        [],
        true,   //enable grounding dino
        useSwinB ? "GroundingDINO_SwinB (938MB)" : "GroundingDINO_SwinT_OGC (694MB)", // grounding dino model
        prompt, // dino prompt
        threshold || 0.3, // threshold
        true, // preview?
        boundingBoxes, // selected bounding box
        //[]
    ]

    return new Promise(async (resolve, reject) => {
        const option_adetailer = {
            method: 'POST',
            body: JSON.stringify({
                fn_index: server_pool[0].fn_index_execute_segment_anything,
                session_hash: session_hash,
                data: req_data
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }

        try {
            await fetch(`${server_pool[0].url}/run/predict/`, option_adetailer)
                .then(res => {
                    console.log(res.status)
                    if (res.status !== 200) {
                        throw 'Failed to segment'
                    }
                    return res
                })
                .then(res => res.json())
                .then(data => {
                    console.log(data)
                    resolve(data.data[0]);
                })
        }
        catch (err) {
            console.log(err)
            reject(err)
            return
        }
    })
}

function expandMask(segment_output, image_path, mask_selection, session_hash, extend_by) {
    const req_data = [
        segment_output,
        mask_selection,    //which mask
        extend_by,     //extend by how much
        convert_upload_path_to_file_data(image_path, server_pool[0].url),   // final result
    ]

    return new Promise(async (resolve, reject) => {
        const option_adetailer = {
            method: 'POST',
            body: JSON.stringify({
                fn_index: server_pool[0].fn_index_execute_segment_anything + 1,
                session_hash: session_hash,
                data: req_data
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }

        try {
            await fetch(`${server_pool[0].url}/run/predict/`, option_adetailer)
                .then(res => {
                    console.log(res.status)
                    if (res.status !== 200) {
                        throw 'Failed to expand mask'
                    }
                    return res
                }).then(res => res.json())
                .then(data => {
                    resolve(data.data[0]);
                })
        }
        catch (err) {
            console.log(err)
            reject(err)
            return
        }
    })
}

function unloadAllModel(session_hash) {
    const req_data = []

    return new Promise(async (resolve, reject) => {
        const option_adetailer = {
            method: 'POST',
            body: JSON.stringify({
                fn_index: server_pool[0].fn_index_execute_segment_anything + 17,
                session_hash: session_hash,
                data: req_data
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }

        try {
            await fetch(`${server_pool[0].url}/run/predict/`, option_adetailer)
                .then(res => {
                    console.log(res.status)
                    if (res.status !== 200) {
                        throw 'Failed to unload segmentation model'
                    }
                    resolve()
                })
        }
        catch (err) {
            console.log(err)
            reject(err)
            return
        }
    })
}

module.exports = {
    groundingDino_execute,
    segmentAnything_execute,
    expandMask,
    unloadAllModel
}