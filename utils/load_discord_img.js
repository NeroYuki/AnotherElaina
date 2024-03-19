const { default: axios } = require('axios');

function loadImage(url, getBuffer = false) {
    // download image from the given url and convert them to base64 dataURI (with proper mime type) or buffer use axios
    // possible security issue with arbitrary file download, need to check for magic header that match the mime type

    return new Promise((resolve, reject) => {
        axios.get(url, { responseType: 'arraybuffer' })
            .then((response) => {
                if (getBuffer) {
                    resolve(Buffer.from(response.data, 'binary'));
                    return;
                }
                let image = Buffer.from(response.data, 'binary').toString('base64');
                let mime = response.headers['content-type'];

                // TODO: check for magic header

                resolve(`data:${mime};base64,${image}`);
            })
            .catch((error) => {
                console.log(error);
                reject(error);
            });
    })
}

module.exports = {
    loadImage
}