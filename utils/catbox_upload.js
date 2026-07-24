const fs = require('fs');
require('dotenv').config()

const FREEIMG_API_KEY = process.env.FREE_IMG_API_KEY
const FREEIMG_API_URL = 'https://freeimage.host/api/1/upload'

async function freeimgUpload(filePath) {
    const fileBuffer = fs.readFileSync(filePath)
    const base64 = fileBuffer.toString('base64')

    const formData = new FormData()
    formData.set('source', base64)
    formData.set('format', 'json')

    const response = await fetch(`${FREEIMG_API_URL}?key=${FREEIMG_API_KEY}`, {
        method: 'POST',
        body: formData
    })

    const json = await response.json()
    if (json.status_code !== 200 || !json.success) {
        throw new Error(`Freeimage.host upload failed: ${json.error?.message || json.status_txt || 'Unknown error'}`)
    }
    return json.image.url
}

function catboxUpload(image) {
    return new Promise(async (resolve, reject) => {
        if (!image) {
            reject('No image provided')
        }

        const filename = 'temp_' + Date.now() + '.png'
        fs.writeFileSync(filename, image)

        freeimgUpload(filename)
            .then((url) => {
                console.log(url)
                fs.rmSync(filename, { force: true })
                resolve(url)
            })
            .catch((err) => {
                console.log(err)
                fs.rmSync(filename, { force: true })
                reject(err)
            })
    })
}

function catboxFileUpload(filename) {
    return new Promise(async (resolve, reject) => {
        if (!filename) {
            reject('No filename provided')
        }

        freeimgUpload(filename)
            .then((url) => {
                console.log(url)
                resolve(url)
            })
            .catch((err) => {
                console.log(err)
                reject(err)
            })
    })
}

function catboxFileUploadBuffer(buffer, filename) {
    return new Promise(async (resolve, reject) => {
        if (!buffer || !filename) {
            reject('No buffer or filename provided')
        }

        fs.writeFileSync('./temp/' + filename, buffer)

        freeimgUpload('./temp/' + filename)
            .then((url) => {
                console.log(url)
                fs.rmSync('./temp/' + filename, { force: true })
                resolve(url)
            })
            .catch((err) => {
                console.log(err)
                fs.rmSync('./temp/' + filename, { force: true })
                reject(err)
            })
    })
}

module.exports = {
    catboxUpload,
    catboxFileUpload,
    catboxFileUploadBuffer
}