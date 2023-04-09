const { default: axios } = require('axios');

function loadImage(url, getBuffer = false) {
    // download image from the given url and convert them to base64 dataURI (with proper mime type) or buffer use axios

    return new Promise((resolve, reject) => {
        axios.get(url, { responseType: 'arraybuffer' })
            .then((response) => {
                if (getBuffer) {
                    resolve(Buffer.from(response.data, 'binary'));
                    return;
                }
                let image = Buffer.from(response.data, 'binary').toString('base64');
                let mime = response.headers['content-type'];
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