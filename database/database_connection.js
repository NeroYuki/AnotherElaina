require('dotenv').config()
const mongodb = require('mongodb')


module.exports = (function() {
    var maindb = '';
    var extdb = '';
    var elainadb = '';
    var mainClient = null;
    var mainPromise = null;
    var elainaClient = null;
  
    return { // public interface
        async initElainaDB() {
            const elainaURI =
                "mongodb://" +
                process.env.MONGODB_REMOTE_KEY +
                "@elainadb-shard-00-00-r6qx3.mongodb.net:27017,elainadb-shard-00-01-r6qx3.mongodb.net:27017,elainadb-shard-00-02-r6qx3.mongodb.net:27017/test?ssl=true&replicaSet=ElainaDB-shard-0&authSource=admin&retryWrites=true";
            const client = await new mongodb.MongoClient(elainaURI).connect();

            console.log("Connection to Elaina DB established");

            elainadb = client.db("ElainaDB");
            elainaClient = client;
            return elainadb;
        },
        initConnection: function (cb = () => {}) {
            if (mainPromise) return mainPromise.then(db => { cb(); return db; });
            let uri = process.env.MONGODB_CONNECTION_STRING
            if (!uri) return Promise.reject(new Error('MONGODB_CONNECTION_STRING is required'));
            mainPromise = new mongodb.MongoClient(uri, {
                connectTimeoutMS: 30000,
                socketTimeoutMS: 30000
            }).connect().then(client => {
                mainClient = client;
                maindb = client.db('another_elaina');
                extdb = client.db('kansen_index');
                console.log("db connection established");
                cb();
                return maindb;
            }).catch(error => {
                mainPromise = null;
                throw error;
            });
            return mainPromise;
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
        },
        async close() {
            await Promise.allSettled([mainClient?.close(), elainaClient?.close()]);
            mainClient = null;
            elainaClient = null;
            mainPromise = null;
            maindb = '';
            extdb = '';
            elainadb = '';
        }
    };
}) ();
