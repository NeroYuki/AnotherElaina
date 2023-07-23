const databaseConn = require('./database_connection.js')
const mongodb = require('mongodb')

module.exports.addRecord = (colName, record) => {
    return new Promise((resolve, reject) => {
        let col = databaseConn.getConnection().collection(colName)
        col.insertOne(record, function(err, res) {
            if (err) {
                console.log(err)
                reject()
            }
            else {
                resolve(res)
            }
        })
    }).catch()
}

module.exports.editRecords = (colName, query, action, option = {}) => {
    return new Promise((resolve, reject) => {
        let col = databaseConn.getConnection().collection(colName)
        col.updateMany(query, action, option, function(err, res) {
            if (err) {
                console.log(err)
                reject()
            }
            else {
                resolve(res)
            }
        })
    }).catch()
}

module.exports.removeRecords = (colName, query) => {
    return new Promise((resolve, reject) => {
        let col = databaseConn.getConnection().collection(colName)
        col.deleteMany(query, function(err, res) {
            if (err) {
                console.log(err)
                reject()
            }
            else {
                resolve(res)
            }
        })
    }).catch()
}

module.exports.queryRecord = (colName, query, projection = {}, mysort = {}) => {
    return new Promise((resolve, reject) => {
        let col = databaseConn.getConnection().collection(colName)
        col.find(query).sort(mysort).project(projection).toArray(function(err, res) {
            if (err) {
                console.log(err)
                reject()
            }
            else {
                resolve(res)
            }
        })
    }).catch()
}

module.exports.queryRecordLimit = (colName, query, limit, projection = {}, mysort = {}, skip = 0) => {
    return new Promise((resolve, reject) => {
        let col = databaseConn.getConnection().collection(colName)
        col.find(query).sort(mysort).project(projection).limit(limit).skip(skip).toArray(function(err, res) {
            if (err) {
                console.log(err)
                reject()
            }
            else {
                resolve(res)
            }
        })
    }).catch()
}

module.exports.aggregateRecord = (colName, pipeline) => {
    return new Promise((resolve, reject) => {
        let col = databaseConn.getConnection().collection(colName)
        col.aggregate(pipeline).toArray(function (err, res) {
            if (err) {
                console.log(err)
                reject()
            }
            else {
                resolve(res)
            }
        })
    }).catch()
}