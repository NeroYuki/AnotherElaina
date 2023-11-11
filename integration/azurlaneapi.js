const log = require('../utils/log.js')
const apiParamBuilder = require('../utils/api_param_builder.js')
const { default: axios } = require('axios');

const IS_EVALUATING_SPEED = require('../config.json').speed_evaluate

const GATEWAY_ENDPOINT = [
    "http://blhxusgate.yo-star.com",                    //EN server login
    "http://blhxjploginapi.azurlane.jp",                //JP server login
    "http://118.178.152.242",                           //CN-Android server login  
]                          

async function azurlaneApiCall(param, index) {
    return new Promise((resolve, reject) => {
        let url = GATEWAY_ENDPOINT[index] + param.toString();

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

    }).catch()
}

module.exports.serverStatus = (option) => {
    return new Promise(async (resolve, reject) => {
        if (IS_EVALUATING_SPEED) log.TimertoConsole.prototype.start()
        let region = 'en'
        let region_index = 0;
        if (option && option.region) region = option.region

        const available_region = ['en', 'jp', 'cn-a']

        if (available_region.indexOf(region) != -1) {
            region_index = available_region.indexOf(region)
        }
        else {
            log.errConsole("Unknown region")
            reject()
        }

        let param = new apiParamBuilder("")
        param.addParam("cmd", "load_server?")

        let result = await azurlaneApiCall(param, region_index)

        if (result === undefined) reject()

        let statusResult = []
        const state_code = ["Normal", "Offline", "Full", "Busy"]
        const flag_code = ["Normal", "Hot", "New"]

        result.forEach((serverStatus) => {
            let serverStatus_entry = {
                id: parseInt(serverStatus.id),
                name: serverStatus.name,
                state: state_code[parseInt(serverStatus.state)] || "unknown",
                flag: flag_code[parseInt(serverStatus.flag)] || "unknown",
                priority: parseInt(serverStatus.sort)
            }
            statusResult.push(serverStatus_entry)
        })
        console.log(statusResult)

        if (IS_EVALUATING_SPEED) log.TimertoConsole.prototype.end()
        resolve(statusResult)
    }).catch()
}