const { default: axios } = require('axios');
const sharp = require('sharp');

function loadImage(url, getBuffer = false, noDataURIHeader = false, safeLoad = false) {
    // download image from the given url and convert them to base64 dataURI (with proper mime type) or buffer use axios
    // possible security issue with arbitrary file download, need to check for magic header that match the mime type

    return new Promise((resolve, reject) => {
        axios.get(url, { responseType: 'arraybuffer' })
            .then(async (response) => {
                if (getBuffer) {
                    resolve(Buffer.from(response.data, 'binary'));
                    return;
                }
                let image = Buffer.from(response.data, 'binary').toString('base64');
                let mime = response.headers['content-type'];

                // TODO: check for magic header

                if (safeLoad && mime != 'image/png') {
                    console.log("Attempt safe image load")
                    const attachment_process = sharp(Buffer.from(response.data, 'binary'))

                    await attachment_process
                        // .metadata()
                        // .then((metadata) => {
                        //     return attachment_process
                        //         .resize(Math.ceil(metadata.width / 8) * 8, Math.ceil(metadata.height / 8) * 8)
                        //         .png()
                        //         .toBuffer()
                        // })
                        .png()
                        .toBuffer()
                        .then(async data => {
                            image = data.toString('base64')
                        })
                        .catch((err) => {
                            console.log("Safe image load:", err)
                            interaction.reply({ content: "Failed to convert image to png", ephemeral: true });
                            return
                        })
                }

                if (noDataURIHeader) {
                    resolve(image);
                }
                else {
                    resolve(safeLoad ? `data:image/png;base64,${image}` : `data:${mime};base64,${image}`);
                }
            })
            .catch((error) => {
                console.log(error);
                reject(error);
            });
    })
}

function uploadDiscordImageToGradio(url, session_hash, worker_endpoint) {
    // download image from the given url and convert them to buffer and upload to gradio using /upload?upload_id={session_hash}
    return new Promise((resolve, reject) => {
        axios.get(url, { responseType: 'arraybuffer' })
            .then((response) => {
                // bin_buffer = Buffer.from(response.data, 'binary');
                let mime = response.headers['content-type'];

                // convert array buffer to blob
                let blob = new Blob([response.data], { type: mime });

                // check if mime is image
                if (!mime.startsWith('image')) {
                    reject('Not an image');
                    return;
                }
                console.log(`Uploading image with mime: ${mime}`);
                // adjust filename to match the mime type
                let filename_ext = mime.split('/')[1];
                // add random filename
                let random_string = Date.now().toString(36) + Math.random().toString(36).substring(2);
                let filename = `image_${random_string}.${filename_ext}`;

                // -----------------------------26627894059524141072594727081
                // Content-Disposition: form-data; name="files"; filename="Belfast.jpg"
                // Content-Type: image/jpeg

                // <binary data>
                // -----------------------------26627894059524141072594727081--
                // make form data to replicate the above
                const form_data = new FormData();
                form_data.append('files', blob, filename);

                // upload to gradio (use multipart form data, Content-Type: <mime>, followed by the binary data)
                axios.post(`${worker_endpoint}/upload?upload_id=${session_hash}`, form_data, 
                    { headers: {
                        'Content-Type': 'multipart/form-data',
                    }})
                    .then((res) => {
                        resolve(res.data[0]);
                    })
                    .catch((err) => {
                        console.log(err);
                        reject(err);
                    })
        })
    })
}

function uploadPngBufferToGradio(buffer, session_hash, worker_endpoint) {
    // upload image buffer to gradio using /upload?upload_id={session_hash}
    return new Promise((resolve, reject) => {
        // convert array buffer to blob
        let blob = new Blob([buffer], { type: 'image/png' });

        // make form data to replicate the above
        const form_data = new FormData();
        form_data.append('files', blob, 'image.png');

        // upload to gradio (use multipart form data, Content-Type: <mime>, followed by the binary data)
        axios.post(`${worker_endpoint}/upload?upload_id=${session_hash}`, form_data, 
            { headers: {
                'Content-Type': 'multipart/form-data',
            }})
            .then((res) => {
                resolve(res.data[0]);
            })
            .catch((err) => {
                console.log(err);
                reject(err);
            })
    })
}

module.exports = {
    loadImage,
    uploadDiscordImageToGradio,
    uploadPngBufferToGradio,
}