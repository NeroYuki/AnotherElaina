// const data = `{"3": {"inputs": {"seed": 156680208700286, "steps": 20, "cfg": 8.0, "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}, "class_type": "KSampler"}, "4": {"inputs": {"ckpt_name": "nekorayxl.safetensors"}, "class_type": "CheckpointLoaderSimple"}, "5": {"inputs": {"width": 1024, "height": 1024, "batch_size": 1}, "class_type": "EmptyLatentImage"}, "6": {"inputs": {"text": "beautiful scenery nature glass bottle landscape, , purple galaxy bottle,", "clip": ["4", 1]}, "class_type": "CLIPTextEncode"}, "7": {"inputs": {"text": "text, watermark", "clip": ["4", 1]}, "class_type": "CLIPTextEncode"}, "8": {"inputs": {"samples": ["3", 0], "vae": ["4", 2]}, "class_type": "VAEDecode"}, "9": {"inputs": {"filename_prefix": "ComfyUI", "images": ["8", 0]}, "class_type": "SaveImage"}}`

function parsePromptGraph(data) {
    var obj = JSON.parse(data);
    var fields = {}

    // search for node with class_type "SaveImage"
    for (const [key, value] of Object.entries(obj)) {
        if (value.class_type == "SaveImage") {
            // iterate through the inputs of the SaveImage node
            for (const [input_key, input_value] of Object.entries(value.inputs)) {
                // if field is an array of 1 string and 1 number, it is a connection to another node
                if (Array.isArray(input_value) && input_value.length == 2 && typeof input_value[0] === 'string' && typeof input_value[1] === 'number') {
                    // traverse the node
                    backTraverseNode(obj, input_value[0], fields, "/" + input_key);
                }
                else {
                    // if field is not an array, it is a value, add to fields, add number to key if it is a duplicate
                    if (fields[input_key] == undefined) {
                        fields[input_key] = input_value;
                    }
                    else {
                        let i = 1;
                        while (fields[input_key + i] != undefined) {
                            i++;
                        }
                        fields[input_key + i] = input_value;
                    }
                    
                }
            }
        }
    }

    return fields;
}

function backTraverseNode(obj, nodeId, fields, breadcrumb = "") {
    for (const [input_key, input_value] of Object.entries(obj[nodeId].inputs)) {
        // if field is an array of 1 string and 1 number, it is a connection to another node
        if (Array.isArray(input_value) && input_value.length == 2 && typeof input_value[0] === 'string' && typeof input_value[1] === 'number') {
            // traverse the node
            backTraverseNode(obj, input_value[0], fields, "/" + input_key + breadcrumb);
        }
        else {
            // if field is not an array, it is a value, add to fields, add number to key if it is a duplicate
            if (fields[input_key + breadcrumb] == undefined) {
                fields[input_key + breadcrumb] = input_value;
            }
            else {
                let i = 1;
                while (fields[(input_key + i) + breadcrumb] != undefined) {
                    i++;
                }
                fields[(input_key + i) + breadcrumb] = input_value;
            }
            
        }
    }
}

// parsePromptGraph(data);

module.exports = {
    parsePromptGraph
}