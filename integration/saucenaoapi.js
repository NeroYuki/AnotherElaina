const IS_EVALUATING_SPEED = require('../config.json').speed_evaluate
const { default: axios } = require('axios');
const apiParamBuilder = require('../utils/api_param_builder.js')
const log = require('../utils/log.js')
require('dotenv').config()

const GLOBAL_MATCHING_THRESHOLD = 65

const SERVER_INDEX = {
    pixiv: 5,
    danbooru: 9,
    gelbooru: 25,
    yandere: 12,
    konachan: 26,
    sankaku: 27,
    anime: 21,
    mangadex: 37,
    ehentai_misc: 38
}

//convert web response from sauceNAO server to compact object only contain required info
function saucenaoprocess(data) {
    let obj = JSON.parse(data)
    // console.log(JSON.stringify(obj, null, 2))
    let result_obj = {
        message: -1, //unknown error
        characters: "Unknown",
        title: "-",
        artist: "Unknown",
        material: "Unknown",
        pixiv_link: "",
        danbooru_link: "",
        gelbooru_link: "",
        yandere_link: "",
        sankaku_link: "",
        konachan_link: "",
        thumbnail: "",
        source: "",
        similarity: 0
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

    let result_data = {}
    let dynamic_matching_threshold = GLOBAL_MATCHING_THRESHOLD

    for (var i in result) {
        // danbooru, gelbooru, yande.re, sankaku was hosted on the same server, so we can use the same thumbnail
        // pixiv is different and even if we have 
        console.log(result[i].header.index_id, result[i].header.similarity, dynamic_matching_threshold)
        if (result[i].header.similarity > dynamic_matching_threshold && Object.values(SERVER_INDEX).includes(result[i].header.index_id)) {
            if (!result_obj.thumbnail) {
                // enter strict mode 
                dynamic_matching_threshold = Math.max(parseFloat(result[i].header.similarity) - 3, GLOBAL_MATCHING_THRESHOLD)
            }
            result_obj.thumbnail = result[i].header.thumbnail
            result_obj.similarity = result[i].header.similarity
            if (result[i].header.index_id == SERVER_INDEX.ehentai_misc) {
                result_data = {
                    ...result_data,
                    material: result[i].data.eng_name || result[i].data.jp_name || result[i].data.source,
                    creator: result[i].data.creator.join(", "),
                }
            }
            else {
                result_data = {
                    ...result_data,
                    ...result[i].data,
                    ext_urls: (result_data.ext_urls || []).concat(result[i].data.ext_urls || [])
                }
            }
        }
    }

    console.log(result_data)
    if (Array.isArray(result_data.creator)) result_data.creator = result_data.creator.join(", ")

    if (result_data) {
        result_obj.title = result_data.title || result_obj.title
        result_obj.artist = result_data.member_name ? result_data.member_name + (result_data.creator? " (" + result_data.creator + ")" : "") : (result_data.creator || result_obj.artist)
        result_obj.material = result_data.material || result_obj.material
        result_obj.characters = result_data.characters || result_obj.characters
        result_obj.pixiv_link = result_data.ext_urls?.find(url => url.includes("pixiv")) || result_obj.pixiv_link
        result_obj.danbooru_link = result_data.ext_urls?.find(url => url.includes("danbooru")) || result_obj.danbooru_link
        result_obj.gelbooru_link = result_data.ext_urls?.find(url => url.includes("gelbooru")) || result_obj.gelbooru_link
        result_obj.yandere_link = result_data.ext_urls?.find(url => url.includes("yande.re")) || result_obj.yandere_link
        result_obj.sankaku_link = result_data.ext_urls?.find(url => url.includes("sankaku")) || result_obj.sankaku_link
        result_obj.konachan_link = result_data.ext_urls?.find(url => url.includes("konachan")) || result_obj.konachan_link
        result_obj.source = result_data.source || result_obj.source
    }

    // if source is i.pximg.net, only get the last part of the url (pixiv id) and append it to https://www.pixiv.net/en/artworks/
    if (result_obj.source && result_obj.source.includes("i.pximg.net")) {
        result_obj.source = "https://www.pixiv.net/en/artworks/" + result_obj.source.split("/").pop()
        result_obj.pixiv_link = result_obj.source
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
        //console.log(url)

        // rewrite the above code with axios
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw 'Failed to connect to SauceNAO'
                }
                return response.text()
            })
            .then(data => {
                resolve(saucenaoprocess(data))
            })
            .catch(error => {
                console.log('Error:', error);
                reject(error);
            });

    }).catch()
}

module.exports.getsauce = (url) => {
    const key_pool = [process.env.SAUCENAO_KEY, process.env.SAUCENAO_KEY_2, process.env.SAUCENAO_KEY_3]
    return new Promise(async (resolve, reject) => {
        let builder = new apiParamBuilder("search.php")
        builder.addParam("db", "999")
        builder.addParam("output_type", "2")
        builder.addParam("minimum_similarity", GLOBAL_MATCHING_THRESHOLD.toFixed(0))
        builder.addParam("dbmaski", "5101317275")
        builder.addParam("testmode", "1")
        builder.addParam("numres", 8)
        builder.addParam("hide", 1)
        builder.addParam("api_key", key_pool[Math.floor(Math.random() * key_pool.length)])
        builder.addParam("url", url)
        let result = await sauceNAOApiCall(builder)
        resolve(result)
    }).catch();
}