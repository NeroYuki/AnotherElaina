const Catbox = require('catbox.moe');
const fs = require('fs');
require('dotenv').config()

const catboxClient = new Catbox.Catbox(process.env.CATBOX_USER_HASH)

function catboxUpload(image) {
    return new Promise(async (resolve, reject) => {
        if (!image) {
            reject('No image provided')
        }

        const filename = 'temp_' + Date.now() + '.png'
        
        // save the image buffer to a temporary file and upload the fucking file to catbox
        fs.writeFileSync(filename, image, {encoding: 'binary'})
    
        await catboxClient.upload(filename)
            .then((res) => {
                console.log(res)
                fs.rmSync(filename, {force: true})
                resolve(res)
            })
            .catch((err) => {
                console.log(err)
                fs.rmSync(filename, {force: true})
                reject(err)
            })
    })
}

module.exports = {
    catboxUpload
}