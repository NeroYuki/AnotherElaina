const log = require('../utils/log.js')
const apiParamBuilder = require('../utils/api_param_builder.js')
const { default: axios } = require('axios');
const he = require('he')

const WEBSITE_ENDPOINT = 'https://m.mugzone.net'
const RESOURCE_ENDPOINT = 'http://cni.malody.net'

const IS_EVALUATING_SPEED = require('../config.json').speed_evaluate

function malodyModeRead(inp) {
    let mode = "unknown";
    const available_mode = ["Key", "Step", "DJ", "Catch", "Pad", "Taiko", "Ring", "Slide"]
    for (var i = 0; i < available_mode.length; i++) {
        if (inp.includes('<img src="/static/img/mode/mode-' + i + '.png"')) { mode = available_mode[i]; break; }
    }
	return mode;
}

function malodyModeNametoID(inp) {
    const available_mode = ["Key", "Step", "DJ", "Catch", "Pad", "Taiko", "Ring", "Slide"]
    return available_mode.lastIndexOf(inp);
}

function malodyGameModRead (inp) {
    let gmod = [];
    const available_mod = ["Luck", "Flip", "Const", "Dash", "Rush", "Slow", "Hide", "Origin", "Death"]
    
    for (var i = 1; i <= available_mod.length; i++) {
        if (inp.includes('<i class="g_mod g_mod_' + i + '"></i>')) gmod.push(available_mod[i - 1])
    }
	return gmod;
}

function malodyTagRead (inp) {
    let tags = [];
    const available_tag = [ "",
        "4K", "5K", "6K", "7K", "8K", "9K", "10K", 
        "BMS Style", "Thumb Style", "SIF Style", "Chunithm Style",
        "Stepmania Style", "O2 Style", "Overmap", "Custom Style",
        "Dynamix Style", "DanceCube Style"
    ]
	
    for (var i = 0; i <= available_tag.length; i++) {
        //log.toConsole("<a href=\"\/page\/all\/chart?tag=" + i + "\">")
        if (inp.includes("<a href=\"\/page\/all\/chart?tag=" + i + "\">")) tags.push(available_tag[i])
    }
		
	return tags;
}

function malodyWebCall(param) {
    return new Promise((resolve, reject) => {
        let url = WEBSITE_ENDPOINT + param.toString()


        // rewrite the above code with axios
        axios.get(url, {
            headers: {
                Cookie: process.env.MALODY_WEB_SESSIONID
            }
        })
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

// TODO: FIX THIS
module.exports.searchUser = (option) => {
    return new Promise(async (resolve, reject) => {
        if (option === undefined) {
            log.toConsole("No option is provided")
            reject()
        }
        if (option.username === undefined) {
            log.errConsole("Insufficient option")
            reject()
        }
        let param = new apiParamBuilder("page")
        param.addCall("search")
        param.addParam("keyword", option.username)
        let data = await malodyWebCall(param)
        let userResult = {
            username: option.username,
            uid: ""
        }
        let lines = data.split('\n')
        for (x = 0; x < lines.length; x++) {
            if (lines[x].includes("Players (10 limit)")) {
                for (var offset = 1; offset < 10; offset++) {
                    //if no more player entry is found, break
                    if (!lines[x + offset].includes('<a class="textfix" href="')) break;
                    //filtering out html tag to get username and uid
                    lines[x + offset] = lines[x + offset].replace('<a class="textfix" href="','');
                    let user = lines[x + offset].split('">'); 
                    //user[0] contain uid, user[1] contain username
                    if (user.length < 2) continue; //panic if not found 2 element
                    //apply another html tag filter
                    user[1] = user[1].replace("</a>",'')
                    if (user[1] === userResult.username) userResult.uid = user[0].split("/").pop()
                }
            }
        }
        if (userResult.uid === "") {
            log.errConsole("Player not found")
            reject()
        }
        resolve(userResult)
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
        let final_uid = ""
        if (option.uid === undefined) {
            let userSearchResult = await this.searchUser({username: option.username})
            final_uid = userSearchResult.uid
        }
        else final_uid = option.uid
        let param = new apiParamBuilder("accounts")
        param.addCall("user")
        param.addCall(final_uid)
        // log.toConsole(param.toString())
        let data = await malodyWebCall(param)
        // log.toConsole(data)
        let userInfoResult = {
            username: "",               
            uid: parseInt(final_uid),
            avatar_link: RESOURCE_ENDPOINT + "/avatar/" + final_uid, 
            time: { 
                registration_date: undefined,  
                last_login: undefined,         
                play_time: undefined           
            },
            user_info: {
                age: "",
                gender: "",
                location: ""
            },
            gold: 0,
            chart: {
                stable: 0,
                unstable: 0
            },
            mode_info: [],
            //displaying_achievement: [],       not implemented due to... requiring too much effort to get any meaningful info out of this
            recent_activity: [],
            recent_play: [],
            recent_upload: [] 
        }
        let lines = data.split('\n')
        for (var x = 0; x < lines.length; x++) {
            //WARNING: a lot of hard-coded html filter below, will instantly break if something change in the website structure
            //TODO: learn how to properly scrape things lol
            if (lines[x].includes("<p class=\"name\">")) {
                userInfoResult.username = he.decode(lines[x].replace("<p class=\"name\">", "").trim())
                continue
            }
            if (lines[x].includes("<p class=\"time\">")) {
                userInfoResult.time.registration_date = new Date(lines[x + 1].split("&nbsp;").pop().replace("<\/span>", "").trim())
                userInfoResult.time.last_login = new Date(lines[x + 2].split("&nbsp;").pop().replace("<\/span>", "").trim())
                userInfoResult.time.play_time = new Date(lines[x + 3].split("Played: ").pop().replace("<\/span>", "").trim())
                continue
            }
            if (lines[x].includes("<p><span>Gender:")) {
                lines[x] = lines[x].replace("<p>", "").replace("<\/p>", "")
                let components = lines[x].split('<\/span>')
                userInfoResult.user_info.gender = components[0].replace(/<span>.*&nbsp;/g, "").trim()
                userInfoResult.user_info.age = components[1].replace(/<span>.*&nbsp;/g, "").trim()
                userInfoResult.user_info.location = components[2].replace(/<span>.*&nbsp;/g, "").trim()
                continue
            }
            if (lines[x].includes("<span>Gold:&nbsp;")) {
                userInfoResult.gold = parseInt(lines[x].replace("<span>Gold:&nbsp;", "").replace("<\/span>", "").trim())
                continue
            }
            if (lines[x].includes("<span>Stable charts:&nbsp;")) {
                userInfoResult.chart.stable = parseInt(lines[x].replace(/<span>.*&nbsp;/g, "").replace("<\/span>", "").trim())
                userInfoResult.chart.unstable = parseInt(lines[x + 1].replace(/<span>.*&nbsp;/g, "").replace("<\/span>", "").trim())
                continue
            }
            //get overall mode info (if player have yet to play one mode, it will not visible in the site, therefore no entry for said mode here)
            if (lines[x].includes("<p class=\"rank\">\#")) {
                let mode_ranking = {
                    mode_id: -1,
                    mode_name: "",
                    rank: 0,
                    exp: 0,
                    play_count: 0,
                    avg_accuracy: 0,
                    max_combo: 0
                }
                mode_ranking.mode_name = malodyModeRead(lines[x - 2])
                mode_ranking.mode_id = malodyModeNametoID(mode_ranking.mode_name)
                mode_ranking.rank = parseInt(lines[x].replace("<p class=\"rank\">\#", "").replace("<\/p>", "").trim())
                mode_ranking.exp = parseInt(lines[x + 2].replace("<span>Exp.", "").replace("<\/span>", "").trim())
                mode_ranking.play_count = parseInt(lines[x + 3].replace("<span>Playcount:", "").replace("<\/span>", "").trim())
                mode_ranking.avg_accuracy = parseFloat(lines[x + 6].replace("<span>Acc.", "").replace("\%<\/span>", "").trim())
                mode_ranking.max_combo = parseInt(lines[x + 7].replace("<span>Combo:", "").replace("<\/span>", "").trim())
                userInfoResult.mode_info.push(mode_ranking)
                continue
            }
            //get those damn recent plays
            if (lines[x].includes("<p class=\"textfix title\"><img src=\"/static/img/mode")) {
                let recent_play_entry = {
                    mode_name: "",
                    mode_id: -1,
                    chart_string: "",
                    chart_link: "",
                    cover_link: "",
                    game_mod: [],
                    score: 0,
                    max_combo: 0,
                    accuracy: 0,
                    judge: "",
                    time: ""
                }
                let components = lines[x].split(">")
                recent_play_entry.mode_name = malodyModeRead(components[1].replace(" /", ">"))
                recent_play_entry.mode_id = malodyModeNametoID(recent_play_entry.mode_name)
                recent_play_entry.chart_link = WEBSITE_ENDPOINT + components[2].replace("<a href=", "").replace(/\"/g, "")
                recent_play_entry.chart_string = he.decode(components[3].replace("</a", ""))
                if (lines[x + 1].includes("Score: ")) {
                    recent_play_entry.score = parseInt(lines[x + 1].replace("&nbsp;&nbsp;", "").replace("<p>Score: ", ""));
                    recent_play_entry.max_combo = parseInt(lines[x + 2].replace("&nbsp;&nbsp;", "").replace("Combo: ", ""));
                    recent_play_entry.accuracy = parseFloat(lines[x + 3].replace("&nbsp;&nbsp;", "").replace("Acc. :", ""));
                    recent_play_entry.judge = lines[x + 4].split(">")[1].replace("</em", "")
                    recent_play_entry.game_mod = malodyGameModRead(lines[x + 7])
                    recent_play_entry.time = lines[x + 8].replace("</span>", "").replace("<span class=\"time\">", "")
                    userInfoResult.recent_play.push(recent_play_entry)
                }
                else {
                    //if no score element found, this is actually a recently uploaded chart, therefore create new chart upload entry from known
                    //info, very hacky but who care bruh
                    let recent_upload_entry = {
                        mode: recent_play_entry.mode,
                        chart_link: recent_play_entry.chart_link,
                        chart_string: recent_play_entry.chart_string
                    }
                    userInfoResult.recent_upload.push(recent_upload_entry)
                }
                continue
            }
            //finally get player's recent activity (getting badge, edit chart entry, forum post, etc.)
            if (lines[x].includes("<div class=\"item g_rblock\">") && lines[x + 1].includes("<a class=\"textfix\" ")) {
                let activity_entry = {
                    ref_link: "",
                    activity: "",
                    time: ""
                }
                let components = lines[x + 1].split(">")
                activity_entry.ref_link = WEBSITE_ENDPOINT + components[0].replace("<a class=\"textfix\" href=", "").replace(/\"/g, "")
                activity_entry.activity = components[1].replace("<\/a", "")
                activity_entry.time = lines[x + 2].replace("<span>", "").replace("<\/span>", "")
                userInfoResult.recent_activity.push(activity_entry)
            }
        }
        //log.toConsole(JSON.stringify(userInfoResult, "", " "))
        if (IS_EVALUATING_SPEED) log.TimertoConsole.prototype.end()
        console.log(userInfoResult)
        resolve(userInfoResult)
    }).catch()
}

module.exports.getChartInfo = (option) => {
    return new Promise(async (resolve, reject) => {
        if (IS_EVALUATING_SPEED) log.TimertoConsole.prototype.start()
        if (option === undefined) {
            log.toConsole("No option is provided")
            reject()
        }
        if (option.chartid === undefined) {
            log.errConsole("Insufficient option")
            reject()
        }

        let param = new apiParamBuilder("chart")
        param.addCall(option.chartid)
        let chartInfo = {
            ref_link: WEBSITE_ENDPOINT + param.toString(),
            status: "",
            artist: "",
            track_name: "",
            mode: "",
            mode_id: "",
            chart_name: "",
            cover_link: "",
            creator: {},
            stabled_by: {},
            length: 0,
            bpm: 0,
            last_update: undefined,
            tags: [],
            play_data: {
                play_count: 0,
                like: 0,
                dislike: 0
            }
        }
        let data = await malodyWebCall(param)
        let lines = data.split('\n')
        //more scrapping mayhem
        for (var x = 0; x < lines.length; x++) {
            if (lines[x].includes("<em class=\"t")) {
                chartInfo.status = lines[x].replace(/\<em class\=\"t[0-9]+\"\>/, "").replace("</em>", "")
                let components = lines[x + 1].split("<\/span> - ")
                chartInfo.artist = components[0].replace("<span class=\"textfix artist\">", "")
                chartInfo.track_name = components[1].replace("<\/h2>", "")
            }
            if (lines[x].includes("<div class=\"cover\" ")) {
                chartInfo.cover_link = lines[x].match(/\(.*\!/).pop().replace("(", "").replace("!", "").trim()
            }
            if (lines[x].includes("<h2 class=\"mode\">")) {
                chartInfo.mode = malodyModeRead(lines[x + 1])
                chartInfo.mode_id = malodyModeNametoID(chartInfo.mode)
                chartInfo.chart_name = lines[x + 2].replace("<span>", "").replace("<\/span>", "")
            }
            if (lines[x].includes("Created by: <\/span>")) {
                let components = lines[x + 2].split("\">")
                let userResult = {
                    uid: components[0].replace("<a href=\"\/accounts\/user\/", ""),
                    username: components[1].replace("<\/a>", "")
                }
                chartInfo.creator = userResult
            }
            if (lines[x].includes("Stabled by: <\/span>")) {
                let components = lines[x + 2].split("\">")
                let userResult = {
                    uid: components[0].replace("<a href=\"\/accounts\/user\/", ""),
                    username: components[1].replace("<\/a>", "")
                }
                chartInfo.stabled_by = userResult
            }
            if (lines[x].includes("<h2 class=\"sub\">")) {
                chartInfo.length = lines[x + 2].replace(/[^1234567890\-: ]/g, "").replace(":", "")
                chartInfo.bpm = lines[x + 3].replace(/[^1234567890\-:. ]/g, "").replace(":", "")
                chartInfo.last_update = new Date(lines[x + 4].replace(/[^1234567890\-: ]/g, "").replace(":", "").trim())
            }
            if (lines[x].includes("<h2 class=\"tags\">")) {
                let section = ""
                let offset = 0    
                while (!lines[x + offset].includes("<\/h2>")) { 
                    if (lines[x + offset] === undefined) break
                    section += lines[x + offset] + " "; 
                    offset++ 
                }
                chartInfo.tags = malodyTagRead(section)
            }
            if (lines[x].includes("<div class=\"num\">")) {
                if (lines[x + 1].includes("\/static\/img\/icon-play.png")) 
                    chartInfo.play_data.play_count = lines[x + 1].split("<span class=\"l\">").pop().replace("<\/span>", "")
                if (lines[x + 1].includes("\/static\/img\/icon-love.png")) 
                    chartInfo.play_data.like = lines[x + 1].split("<span class=\"l\">").pop().replace("<\/span>", "")
                if (lines[x + 1].includes("\/static\/img\/icon-bad.png"))
                    chartInfo.play_data.dislike = lines[x + 1].split("<span class=\"l\">").pop().replace("<\/span>", "")
            }
        }
        if (IS_EVALUATING_SPEED) log.TimertoConsole.prototype.end()

        resolve(chartInfo)

    }).catch()
}