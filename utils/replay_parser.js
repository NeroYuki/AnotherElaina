const { Readable } = require('stream');
const unzipper = require('unzipper')
const javaDeserialization = require('java-deserialization');

const CURSOR_ID_DOWN = 0
const CURSOR_ID_MOVE = 1
const CURSOR_ID_UP = 2

const RESULT_0 = 1
const RESULT_50 = 2
const RESULT_100 = 3
const RESULT_300 = 4

const BYTE_LENGTH = 1
const SHORT_LENGTH = 2
const INT_LENGTH = 4
const FLOAT_LENGTH = 4
const LONG_LENGTH = 8

// Decompress replay data (this always throw unexpected EoF error, im not sure if its the data itself cant be extracted properly without 
// Java's ZipInputStream or i messed up somewhere, but all required data should be resolved before the error is thrown)
function replay_decompress(data) {
    return new Promise((resolve, reject) => {

        const stream = new Readable();
        stream._read = () => {}
        stream.push(data)
        stream.push(null)
        stream.pipe((unzipper.Parse())
            .on('entry', async function (entry) {
                const fileName = entry.path;
                const type = entry.type;
                const size = entry.vars.uncompressedSize; 
                //if entry names is 'data', it contains all the stuff we need, load the decompressed data, resolve it and GTFO!
                if (fileName === "data") {
                    var content = await entry.buffer();
                    resolve(content)
                } 
                else {
                //if its not, drain it to decrease memory usage (its not like it ever happen when reading these files anyway)
                    entry.autodrain().on('error', e => {console.log(e);})
                }
            })
            //should throw everytime due to unexpected EoF (Cant find central directory), but if data is resolved before reaching it we are ok
            //should throw if there is another error anyway (after 2 seconds to prevent the function from stucking only)
            .on('error', e => { 
                setTimeout(() => reject(), 2000)
            }))

    }).catch()
}

//from decompressed data, translate them into json format
function replay_parse(content) {
    //console.log(content)
    //javaDeserialization can only somewhat parse some string field, the rest will be a clusterfuck of buffer we need to manually parse :(
    var raw_object = javaDeserialization.parse(content)
    //console.log(raw_object)
    var result_object = {
        replay_version: raw_object[0].version,
        folder_name: raw_object[1],
        file_name: raw_object[2],
        file_hash: raw_object[3],
        //parse the first buffer section into these
        time: raw_object[4].readBigUInt64BE(0),
        hit300k: raw_object[4].readInt32BE(8),
        hit300: raw_object[4].readInt32BE(12),
        hit100k: raw_object[4].readInt32BE(16),
        hit100: raw_object[4].readInt32BE(20),
        hit50: raw_object[4].readInt32BE(24),
        hit0: raw_object[4].readInt32BE(28),
        score: raw_object[4].readInt32BE(32),
        max_combo: raw_object[4].readInt32BE(36),
        accuracy: raw_object[4].readFloatBE(40),
        is_full_combo: raw_object[4][44],
        player_name: raw_object[5],
        play_mod: raw_object[6].elements,
        force_speed: -1,
        force_ar: -1,
        //cursor movement data, max at 10 concurrent cursors, contain time, id enum, x and y
        cursor_movement: undefined,
        //hit object data, contain N result of hit objects, contain accuracy (offset), tickset (for slider?) and result enum
        hit_object_data: undefined,
    }
    let start_pos = 7
    if (result_object.replay_version > 3) {
        let pair = raw_object[7].split('|')
        for (let it = 0; it < pair.length; it++) {
            if (pair[it].includes('x')) result_object.force_speed = parseFloat(pair[it].replace('x', ''))
            if (pair[it].includes('AR')) result_object.force_ar = parseFloat(pair[it].replace('AR', ''))
        }
        start_pos = 8
    }
    //console.log(result_object)
    var replay_data_buffer_array = []
    for (var i = start_pos; i < raw_object.length; i++) {
        replay_data_buffer_array.push(raw_object[i])
    }

    //merge all buffer section into one for better control when parsing 
    var replay_data_buffer = Buffer.concat(replay_data_buffer_array)
    //console.log(replay_data_buffer.length)
    var buffer_counter = 0

    var msize = replay_data_buffer.readInt32BE(buffer_counter)
    buffer_counter += INT_LENGTH
    var move_array_collection = []

    //parse movement data
    for (var x = 0; x < msize; x++) {
        // if (x === 1) buffer_counter += fix_buffer
        var move_size = replay_data_buffer.readInt32BE(buffer_counter)
        buffer_counter += INT_LENGTH
        var move_array = {
            size: move_size,
            time: [],
            x: [],
            y: [],
            id: []
        }
        for (var i = 0; i < move_size; i++) {
            move_array.time[i] = replay_data_buffer.readInt32BE(buffer_counter)
            buffer_counter += INT_LENGTH
            move_array.id[i] = move_array.time[i] & 3
            move_array.time[i] >>= 2;
            if (move_array.id[i] != CURSOR_ID_UP) {
                if (result_object.replay_version >= 5) {
                    move_array.x[i] = replay_data_buffer.readFloatBE(buffer_counter)
                    buffer_counter += FLOAT_LENGTH
                    move_array.y[i] = replay_data_buffer.readFloatBE(buffer_counter)
                    buffer_counter += FLOAT_LENGTH
                }
                else {
                    move_array.x[i] = replay_data_buffer.readInt16BE(buffer_counter)
                    buffer_counter += SHORT_LENGTH
                    move_array.y[i] = replay_data_buffer.readInt16BE(buffer_counter)
                    buffer_counter += SHORT_LENGTH
                }
            }
            else {
                move_array.x[i] = -1
                move_array.y[i] = -1
            }
        }
        //console.log(move_array)
        move_array_collection.push(move_array)
        
    }

    //console.log(res_string)

    var replay_object_array = []
    var replay_object_length = replay_data_buffer.readInt32BE(buffer_counter)
    buffer_counter += INT_LENGTH
    console.log(replay_object_length)

    //parse result data
    for (var i = 0; i < replay_object_length; i++) {
        var replay_object_data = {
            accuracy: 0,
            tickset: [],
            result: 0,
        }
        replay_object_data.accuracy = replay_data_buffer.readInt16BE(buffer_counter)
        buffer_counter += SHORT_LENGTH
        var len = replay_data_buffer.readInt8(buffer_counter)
        buffer_counter += BYTE_LENGTH 
        //console.log(len)
        if (len > 0) {
            var bytes = []
            for (var j = 0; j < len; j++) {
                bytes.push(replay_data_buffer.readInt8(buffer_counter))
                buffer_counter += BYTE_LENGTH 
            }
            for (var j = 0; j < len * 8; j++) {
                replay_object_data.tickset[j] = (bytes[len - j / 8 - 1] & 1 << (j % 8)) != 0;
            }
        }
        if (result_object.replay_version >= 1) {
            replay_object_data.result = replay_data_buffer.readInt8(buffer_counter)
            buffer_counter += BYTE_LENGTH 
        }
        //console.log(replay_object_data)
        replay_object_array.push(replay_object_data)
    }

    result_object.cursor_movement = move_array_collection
    result_object.hit_object_data = replay_object_array

    //sanity check (if all of the data have been parse (we reach the end of buffer))
    console.log(replay_data_buffer.length - buffer_counter + " bytes of data left!")
    return result_object
}

//main module, input compress replay data, output replay data in json format
module.exports.parse = (replay_data) => {
    return new Promise(async (resolve, reject) => {
        let decompressed_data = await replay_decompress(replay_data)
        let replay_full_data = replay_parse(decompressed_data)
        resolve(replay_full_data)
    }).catch()
}
