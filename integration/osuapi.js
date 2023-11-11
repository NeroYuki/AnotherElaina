const log = require('../utils/log.js')
const apiParamBuilder = require('../utils/api_param_builder.js')
const { default: axios } = require('axios');
require('dotenv').config()

const IS_EVALUATING_SPEED = require('../config.json').speed_evaluate

const API_ENDPOINT = 'https://osu.ppy.sh/api'
const DOWNLOAD_ENDPOINT = 'https://osu.ppy.sh/osu'

async function osuApiCall(param) {
    return new Promise((resolve, reject) => {
        let url = API_ENDPOINT + param.toString();

        // rewrite the above code with axios
        axios.get(url)
            .then((res) => {
                if (res.status !== 200) {
                    throw 'Server can be reached but returned non-200 status'
                }
                // data is returned as string, parse it to JSON
                return res.data
            })
            .then((data) => {
                resolve(data)
            })
            .catch((err) => {
                log.errConsole(err)
                reject()
            })

    })
}

async function osuDownloadCall(bid) {
    return new Promise((resolve, reject) => {
        let url = DOWNLOAD_ENDPOINT + "/" + bid
        // let mapData = ""
        // request(url)
        //     .on('data', data => mapData += data)
        //     .on('complete', res => resolve(mapData))
        //     .on('error', err => {
        //         log.errConsole(err)
        //         reject()
        //     })

        // rewrite the above code with axios
        axios.get(url)
            .then((res) => {
                if (res.status !== 200) {
                    throw 'Server can be reached but returned non-200 status'
                }
                // data is returned as string, parse it to JSON
                return res.data
            })
            .then((data) => {
                resolve(data)
            })
            .catch((err) => {
                log.errConsole(err)
                reject()
            })
    })
}

module.exports.getBeatmapInfo = (option) => {
    return new Promise(async (resolve, reject) => {
        if (option === undefined) {
            log.toConsole("No option is provided")
            reject()
        }
        if (option.beatmapid === undefined && option.maphash === undefined) {
            log.errConsole("Insufficient option")
            reject()
        }
        if (process.env.OSU_API_KEY === undefined) {
            log.errConsole("No api key is provided")
            reject()
        }
        let param = new apiParamBuilder("get_beatmaps")
        param.addParam('k', process.env.OSU_API_KEY)
        if (option.beatmapid !== undefined) param.addParam('b', option.beatmapid)
        if (option.maphash !== undefined) param.addParam('h', option.maphash)
        var resultObject = await osuApiCall(param)
        if (resultObject[0] === undefined) {
            log.errConsole("Specified beatmap is not found")
            reject()
        } 
        resolve(resultObject[0])
    })
}

module.exports.downloadMapFile = (option) => {
    return new Promise(async (resolve, reject) => {
        if (option === undefined) {
            log.toConsole("No option is provided")
            reject()
        }
        if (option.beatmapid === undefined) {
            log.errConsole("Insufficient option")
            reject()
        }
        let param = option.beatmapid
        var resultData = await osuDownloadCall(param)
        resolve(resultData)
    })
}