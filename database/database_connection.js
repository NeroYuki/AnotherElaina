require('dotenv').config()
const mongodb = require('mongodb')


module.exports = (function() {
    var maindb = '';
    var extdb = '';
    var elainadb = '';
  
    return { // public interface
        async initElainaDB() {
            const elainaURI =
                "mongodb://" +
                process.env.MONGODB_REMOTE_KEY +
                "@elainadb-shard-00-00-r6qx3.mongodb.net:27017,elainadb-shard-00-01-r6qx3.mongodb.net:27017,elainadb-shard-00-02-r6qx3.mongodb.net:27017/test?ssl=true&replicaSet=ElainaDB-shard-0&authSource=admin&retryWrites=true";
            const client = await new mongodb.MongoClient(elainaURI).connect();

            console.log("Connection to Elaina DB established");

            elainadb = client.db("ElainaDB");
        },
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
        },
        getElainaConnection: function () {
            return elainadb
        }
    };
}) ();