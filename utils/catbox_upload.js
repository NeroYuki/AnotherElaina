const Catbox = require('node-catbox');
const fs = require('fs');
require('dotenv').config()

const catboxClient = new Catbox.Catbox(process.env.CATBOX_USER_HASH)

function catboxUpload(image) {
    return new Promise(async (resolve, reject) => {
        if (!image) {
            reject('No image provided')
        }

        const filename = 'temp_' + Date.now() + '.png'
        
        // save the image buffer to a temporary file and upload the file to catbox
        fs.writeFileSync(filename, image, {encoding: 'binary'})
    
        await catboxClient.uploadFile({
            path: filename,
        })
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

function catboxFileUpload(filename) {
    return new Promise(async (resolve, reject) => {
        if (!filename) {
            reject('No filename provided')
        }

        // upload the file with said filename to catbox
        await catboxClient.uploadFile({
            path: filename,
        })
            .then((res) => {
                console.log(res)
                resolve(res)
            })
            .catch((err) => {
                console.log(err)
                reject(err)
            })

    })
}

module.exports = {
    catboxUpload,
    catboxFileUpload
}