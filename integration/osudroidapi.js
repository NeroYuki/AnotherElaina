const log = require('../elainaRebuild-utils/log.js')
const apiParamBuilder = require('../utils/api_param_builder.js')
const fs = require('fs')
const request = require('request')
const { default: axios } = require('axios');
require('dotenv').config()

const IS_EVALUATING_SPEED = require('../elainaRebuild-config/config.json').speed_evaluate

const API_ENDPOINT = 'http://ops.dgsrz.com/api'
const WEBSITE_ENDPOINT = 'http://ops.dgsrz.com'

//Helper enum and function
var modbits = {
    nomod: 0,
    nf: 1<<0,
    ez: 1<<1,
    td: 1<<2,
    hd: 1<<3,
    hr: 1<<4,
    dt: 1<<6,
    ht: 1<<8,
    nc: 1<<9,
    fl: 1<<10,
    so: 1<<12,
};

function rankread(imgsrc) {
	let rank= "";
	switch(imgsrc) {
		case '<img src="assets/images/ranking-S-small.png"/>': rank = "S"; break;
		case '<img src="assets/images/ranking-A-small.png"/>': rank = "A"; break;
		case '<img src="assets/images/ranking-B-small.png"/>': rank = "B"; break;
		case '<img src="assets/images/ranking-C-small.png"/>': rank = "C"; break;
		case '<img src="assets/images/ranking-D-small.png"/>': rank = "D"; break;
		case '<img src="assets/images/ranking-SH-small.png"/>' :rank = "SH"; break;
		case '<img src="assets/images/ranking-X-small.png"/>': rank = "X"; break;
		case '<img src="assets/images/ranking-XH-small.png"/>': rank = "XH"; break;
		default: rank = "unknown";
	}
	return rank;
}

function modchar2bit(mod) {
    var res = 0;
    if (mod.includes("e")) res += modbits.ez;
    if (mod.includes("h")) res += modbits.hd;
	if (mod.includes("r")) res += modbits.hr;
	if (mod.includes("d")) res += modbits.dt;
	if (mod.includes("c")) res += modbits.nc;
	if (mod.includes("n")) res += modbits.nf;
	if (mod.includes("t")) res += modbits.ht;
	return res;
}

function modstring2char(mod) {
    var res = "";
    if (mod.includes("Easy")) res += "e";
    if (mod.includes("HardRock")) res += "r";
    if (mod.includes("Hidden")) res += "h";
	if (mod.includes("DoubleTime")) res += "d";
	if (mod.includes("NightCore")) res += "c";
	if (mod.includes("NoFail")) res += "n";
    if (mod.includes("HalfTime")) res += "t";
    if (res == "") res = "-"
	return res;
}

async function droidApiCall(param) {
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
                // data is splited by <br>, so split it again
                resolve(data.split('<br>'))
            })
            .catch((err) => {
                log.errConsole(err)
                reject()
            })
    }).catch()
}

//only for retrieving .odr file
async function droidReplayCall(param) {
    
    return new Promise((resolve, reject) => {
        let url = API_ENDPOINT + param.toString();
        let data_array = []
        // request(url)
        //     .on('response', res => {
        //         if (res.statusCode != 200) {
        //             log.errConsole("Non-200 status code")
        //             reject()
        //         }
        //     })
        //     .on('data', chunk => data_array.push(Buffer.from(chunk)))
        //     .on('complete', () => {
        //         let result = Buffer.concat(data_array)
        //         //console.log(result)
        //         resolve(result)
        //     })
        //     .on('error', e => {
        //         log.errConsole(e)
        //         reject()
        //     })

        // rewrite the code above with axios (remember the result is a buffer)
        axios.get(url, { responseType: 'arraybuffer' })
            .then((res) => {
                if (res.status !== 200) {
                    throw 'Server can be reached but returned non-200 status'
                }
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

async function droidProfileCall(param) {
    return new Promise((resolve, reject) => {
        let url = WEBSITE_ENDPOINT + param.toString();
        let profileObject = {
            username: "",
            avatarLink: "",
            location: "",
            score: 0,
            scoreRank: 0,
            playCount: 0,
            recentPlays: [],
        }
        request(url, {}, (err, res, body) => {
            if (err) {
                log.errConsole(err)
                reject()
            }
            if (res.statusCode != 200) {
                log.errConsole("Non-200 status code")
                reject()
            }
            try {
                //proceed to parse the shit out of the site
                let lines = body.split('\n');
                for (x = 0; x < lines.length; x++) {
                    if (lines[x].includes('h3 m-t-xs m-b-xs')) {
                        lines[x] = lines[x].replace('<div class="h3 m-t-xs m-b-xs">',"");
						lines[x] = lines[x].replace('<\/div>',"");
						lines[x] = lines[x].trim();
						profileObject.username = lines[x];
                        lines[x-3] = lines[x-3].replace('<img src="',"");
                        lines[x-3] = lines[x-3].replace('" class="img-circle">',"");
                        lines[x-3] = lines[x-3].trim();
                        profileObject.avatarLink = lines[x-3];
                        lines[x+1] = lines[x+1].replace('<small class="text-muted"><i class="fa fa-map-marker"><\/i>',"");
                        lines[x+1] = lines[x+1].replace("<\/small>","");
                        lines[x+1] = lines[x+1].trim()
                        profileObject.location = lines[x+1]
                        lines[x+8] = lines[x+8].replace('<span class="m-b-xs h4 block">',"");
						lines[x+8] = lines[x+8].replace('<\/span>',"");
						lines[x+8] = lines[x+8].trim();
						profileObject.scoreRank = (parseInt(lines[x + 8])-1).toString();
                    }
                    if (lines[x].includes('Technical Analysis')) {
						lines[x+3] = lines[x+3].replace('<span class="pull-right">',"");
						lines[x+3] = lines[x+3].replace('<\/span>',"");
						lines[x+3] = lines[x+3].trim()
						profileObject.score = parseInt(lines[x+3])
						lines[x+13] = lines[x+13].replace('<span class="pull-right">',"");
						lines[x+13] = lines[x+13].replace('<\/span>',"");
						lines[x+13] = lines[x+13].trim()
						profileObject.playCount = parseInt(lines[x+13])
					}
                    //fetching recent plays (up to 50)
                    if (lines[x].includes('<small>') && lines[x - 1].includes('class="block"')) {
                        var play = {
                            filename: "", 
                            score: 0,
                            combo: 0, 
                            mark: 0,
                            mode: "",
                            accuracy: 0, 
                            miss: 0, 
                            date: undefined,
                            hash: ""
                        }
                        lines[x-1] = lines[x-1].replace("<strong class=\"block\">","");
                        lines[x-1] = lines[x-1].replace("<\/strong>","");
                        lines[x] = lines[x].replace("<\/small>","");
                        lines[x] = lines[x].replace("<small>","");
                        lines[x+1] = lines[x+1].replace('<span id="statics" class="hidden">{"miss":','');
                        lines[x+1] = lines[x+1].replace('}</span>','')
                        play.filename = lines[x-1].trim();
                        var mshs = lines[x+1].trim().split(',');
                        play.miss = parseInt(mshs[0]);
                        play.hash = mshs[1].split(':')[1];
                        //console.log(play.hash)
                        let components = lines[x].split("/"); 
                        play.date = new Date(components[0]); 
                        play.mode = modstring2char(components[2]); 
                        play.combo = parseInt(components[3].trim()); 
                        play.accuracy = parseFloat(components[4].trim());
                        profileObject.recentPlays.push(play)
                    }
                }
                resolve(profileObject)
            }
            catch (err) {
                log.errConsole(err)
                reject()
            }
        })
    }).catch()
}

module.exports.getUserInfo = (option) => {
    return new Promise(async (resolve, reject) => {
        if (IS_EVALUATING_SPEED) log.TimertoConsole.prototype.start()
        if (option === undefined) {
            log.toConsole("No option is provided")
            reject()
        }
        if (option.uid === undefined && option.username === undefined) {
            log.errConsole("Insufficient option")
            reject()
        }
        //TODO: add support for no-apikey operation
        if (process.env.OSUDROID_API_KEY === undefined) {
            log.errConsole("No api key is provided")
            if (option.uid === undefined) {
                log.errConsole("No uid is provided")
                reject()
            }
            let profileParam = new apiParamBuilder("profile.php")
            profileParam.addParam("uid", option.uid)
            let profileObject = await droidProfileCall(profileParam)
            profileObject.uid = parseInt(option.uid)
            log.toConsole(profileObject)
            resolve(profileObject)
        }
        else {
            let param = new apiParamBuilder("getuserinfo.php")
            param.addParam("apiKey", process.env.OSUDROID_API_KEY)
            if (option.uid !== undefined && !isNaN(parseInt(option.uid))) param.addParam("uid", parseInt(option.uid));
            if (option.username !== undefined) param.addParam("username", option.username)
            let result = await droidApiCall(param)
            //return 2 element: player info (seperated by spaces) and json string include rank and recent play
            let playerInfo = result[0].split(' ')
            if (playerInfo[0] !== "SUCCESS") {
                log.errConsole("User is not found in the database")
                reject()
            }
            let scoreInfo = JSON.parse(result[1])

            let resultObject = {
                uid: parseInt(playerInfo[1]),
                username: playerInfo[2],
                score: parseInt(playerInfo[3]),
                playCount: parseInt(playerInfo[4]),
                accuracy: parseFloat(playerInfo[5]) * 100,
                scoreRank: scoreInfo.rank,
                recentPlays: scoreInfo.recent,
                avatarLink: "",
                location: ""
            }

            //still have to request profile page to get location and avatar link
            //option.fullInfo = false to disable scrapper

            let fullInfo = true;
            if (option.fullInfo !== undefined) fullInfo = Boolean(option.fullInfo)
            if (fullInfo) {
                let profileParam = new apiParamBuilder("profile.php")
                profileParam.addParam("uid", resultObject.uid)
                let profileObject = await droidProfileCall(profileParam)
                resultObject.avatarLink = profileObject.avatarLink
                resultObject.location = profileObject.location
            }

            //return userInfo object
            if (IS_EVALUATING_SPEED) log.TimertoConsole.prototype.end()
            resolve(resultObject)
        }
    }).catch()
}

module.exports.getReplayFile = (option) => {
    return new Promise(async (resolve, reject) => {
        if (IS_EVALUATING_SPEED) log.TimertoConsole.prototype.start()
        if (option === undefined) {
            log.toConsole("No option is provided")
            reject()
        }
        if (option.sid === undefined) {
            log.errConsole("Insufficient option")
            reject()
        }

        let param = new apiParamBuilder("upload")
        param.addCall(option.sid + ".odr")

        let replayResult = await droidReplayCall(param)
        if (replayResult === undefined) {
            log.errConsole("Failed to retrieve replay")
            reject()
        } 

        if (IS_EVALUATING_SPEED) log.TimertoConsole.prototype.end()
        console.log(replayResult)
        resolve(replayResult)
    }).catch()
}

module.exports.getScoreInfo = (option) => {
    return new Promise(async (resolve, reject) => {
        if (IS_EVALUATING_SPEED) log.TimertoConsole.prototype.start()
        if (option === undefined) {
            log.toConsole("No option is provided")
            reject()
        }
        if (option.uid === undefined && option.hash === undefined) {
            log.errConsole("Insufficient option")
            reject()
        }
        if (process.env.OSUDROID_API_KEY === undefined) {
            log.errConsole("No api key is provided")
            reject()
        }

        const available_order = ["sid", "date", "score"]
        //TODO: maybe fallback to v1 if possible?
        let param = new apiParamBuilder("scoresearchv2.php")
        param.addParam("apiKey", process.env.OSUDROID_API_KEY)
        if (option.uid !== undefined && !isNaN(parseInt(option.uid))) param.addParam("uid", parseInt(option.uid));
        if (option.hash !== undefined) param.addParam("hash", option.hash);
        if (option.order !== undefined && available_order.indexOf(option.order) != -1) param.addParam("order", option.order)
        if (option.page !== undefined && !isNaN(parseInt(option.page))) param.addParam("page", parseInt(option.page))

        //log.toConsole(param.toString())

        let result = await droidApiCall(param) 
        result.shift()
        if (result.length == 0) {
            log.errConsole("No score is found with this parameter")
            reject()
        }

        let scoreInfoResult = []
        result.forEach((line) => {
            let components = line.split(' ')
            let scoreInfoEntry = {
                sid: parseInt(components[0]),
                uid: parseInt(components[1]),
                username: components[2],
                score: parseInt(components[3]),
                max_combo: parseInt(components[4]),
                grade: components[5],
                mod: modchar2bit(components[6]),
                acc: parseInt(components[7]) / 1000,
                miss: parseInt(components[8]),
                time: new Date(parseInt(components[9]) * 1000),
                filename: components[10],
                hash: components[11]
            }
            scoreInfoResult.push(scoreInfoEntry)
        })

        if (IS_EVALUATING_SPEED) log.TimertoConsole.prototype.end()
        resolve(scoreInfoResult)
    }).catch()
}