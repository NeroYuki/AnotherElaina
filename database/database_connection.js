require('dotenv').config()
const mongodb = require('mongodb')

module.exports = (function() {
    var maindb = '';
  
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
                console.log("db connection established");
                cb()
            })
        },
        getConnection: function () {
            if (maindb === '') this.initConnection
            return maindb
        }
    };
}) ();