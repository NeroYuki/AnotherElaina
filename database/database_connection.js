require('dotenv').config()
const mongodb = require('mongodb')

module.exports = (function() {
    var maindb = '';
    var extdb = '';
  
    return { // public interface
        initConnection: function (cb) {
            let uri = process.env.MONGODB_CONNECTION_STRING
            mongodb.MongoClient.connect(uri, {
                connectTimeoutMS: 30000,
                socketTimeoutMS: 30000
            }, function(err, db) {
                if (err) {
                    console.log(err)
                    throw err;
                }
                maindb = db.db('another_elaina');
                extdb = db.db('kansen_index');
                console.log("db connection established");
                cb()
            })
        },
        getConnection: function (use_ext = false) {
            if (use_ext) {
                if (extdb === '') this.initConnection
                return extdb
            }
            
            if (maindb === '') this.initConnection
            return maindb
        }
    };
}) ();