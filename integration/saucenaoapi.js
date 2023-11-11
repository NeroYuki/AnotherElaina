const IS_EVALUATING_SPEED = require('../config.json').speed_evaluate
const { default: axios } = require('axios');
const apiParamBuilder = require('../utils/api_param_builder.js')
const log = require('../utils/log.js')
require('dotenv').config()

const GLOBAL_MATCHING_THRESHOLD = 80

//convert web response from sauceNAO server to compact object only contain required info
function saucenaoprocess(data) {
    let obj = JSON.parse(data)
    //console.log(JSON.stringify(obj, " "))
    let result_obj = {
        message: -1, //unknown error
        characters: "Unknown",
        title: "Unknown",
        artist: "Unknown",
        material: "Unknown",
        pixiv_link: "",
        danbooru_link: "",
        gelbooru_link: "",
        thumbnail: ""
    } 
    let status = obj.header.status
    if (status != 0) {
        result_obj.message = -2; //cant communicate with sauceNAO
        return result_obj
    }

    var result = obj.results
    if (obj.results == 0) {
        result_obj.message = 0; //cant find any image
        return result_obj
    }

    let pixiv_info; var pixivFlag = false;
    let danbooru_info; var danbooruFlag = false;
    let gelbooru_info; var gelbooruFlag = false;

    for (var i in result) {
        if (pixivFlag && danbooruFlag) break;
        if (!result_obj.thumbnail && result[i].header.similarity > GLOBAL_MATCHING_THRESHOLD) 
            result_obj.thumbnail = result[i].header.thumbnail
        if (result[i].header.index_id == 5 && result[i].header.similarity > GLOBAL_MATCHING_THRESHOLD) 
            { pixiv_info = result[i].data; pixivFlag = true; }
        else if (result[i].header.index_id == 9 && result[i].header.similarity > GLOBAL_MATCHING_THRESHOLD) 
            { danbooru_info = result[i].data; danbooruFlag = true; }
        else if (result[i].header.index_id == 25 && result[i].header.similarity > GLOBAL_MATCHING_THRESHOLD) 
            { gelbooru_info = result[i].data; gelbooruFlag = true; }
    }
    // console.log(thumbnail)
    // console.log(pixiv_info)
    // console.log(danbooru_info)

    if (pixivFlag) {
        result_obj.title = pixiv_info.title
        result_obj.artist = pixiv_info.member_name
        result_obj.pixiv_link = pixiv_info.ext_urls[0]
    }

    if (danbooruFlag) {
        result_obj.material = danbooru_info.material
        result_obj.characters = danbooru_info.characters
        result_obj.danbooru_link = danbooru_info.ext_urls[0]
    }

    if (gelbooruFlag) {
        result_obj.gelbooru_link = gelbooru_info.ext_urls[0]
    }

    if (!result_obj.thumbnail) {
        result_obj.message = 0;  //cant find any image
        return result_obj
    }
    else {
        result_obj.message = 1 //success
    }

    //let mirrorLink = ((danbooruLink)? "[danbooru](" + danbooruLink + ")\n" : "") + ((gelbooruLink)? "[gelbooru](" + gelbooruLink + ")" : "")

    return result_obj

}

const SAUCENAO_ENDPOINT = "https://saucenao.com"

async function sauceNAOApiCall(param, index) {
    return new Promise((resolve, reject) => {
        let url = SAUCENAO_ENDPOINT + param.toString();

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
                resolve(saucenaoprocess(data))
            })
            .catch((err) => {
                log.errConsole(err)
                reject()
            })

    }).catch()
}

module.exports.getsauce = (url) => {
    return new Promise(async (resolve, reject) => {
        let builder = new apiParamBuilder("search.php")
        builder.addParam("db", "999")
        builder.addParam("output_type", "2")
        builder.addParam("minimum_similarity", GLOBAL_MATCHING_THRESHOLD.toFixed(0))
        builder.addParam("dbmask", "16777760")
        builder.addParam("testmode", "1")
        builder.addParam("api_key", process.env.SAUCENAO_KEY)
        builder.addParam("url", url)
        let result = await sauceNAOApiCall(builder)
        resolve(result)
    }).catch();
}