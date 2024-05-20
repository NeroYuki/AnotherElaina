// use the img2img tab

const { server_pool } = require("./ai_server_config")

function groundingDino_execute(prompt, image, session_hash) {
    // should return array of bouding boxes coordinates
    const req_data = [
        image,
		"GroundingDINO_SwinT_OGC (694MB)",
		prompt,
		0.3,            ///threshold
    ]

    return new Promise(async (resolve, reject) => {
        const option_adetailer = {
            method: 'POST',
            body: JSON.stringify({
                fn_index: server_pool[0].fn_index_execute_grounding_dino_preview,
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

function segmentAnything_execute(prompt, boundingBox, image, session_hash) {
    // should return array of masks
    const req_data = [
        "sam_vit_h_4b8939.pth",
        image,
        [], // segment marker
        [],
        true,   //enable grounding dino
        "GroundingDINO_SwinT_OGC (694MB)", // dino model
        prompt, // dino prompt
        0.3, // threshold
        true, // preview?
        [
            boundingBox // selected bounding box
        ],
        []
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

function expandMask(segment_output, image, mask_selection, session_hash, extend_by) {
    const req_data = [
        segment_output,
        mask_selection,    //which mask
        extend_by,     //extend by how much
        image    // final result
    ]

    return new Promise(async (resolve, reject) => {
        const option_adetailer = {
            method: 'POST',
            body: JSON.stringify({
                fn_index: server_pool[0].fn_index_execute_expand_mask,
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
                fn_index: server_pool[0].fn_index_unload_segmentation_model,
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