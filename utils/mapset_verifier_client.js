const ws = require('ws');

const RECORD_SEPARATOR = String.fromCharCode(0x1E);

const mapsetVerifierClient = {
    client: null,
    isConnected: false,
    SERVER_ENDPOINT: 'localhost:7052',
    
    init: function() {
        const url = `ws://${this.SERVER_ENDPOINT}/mapsetverifier/signalr`;
        console.log(`Connecting to MapsetVerifier at ${url}`);
        
        const client = new ws(url);

        client.on('open', () => {
            console.log('Connected to MapsetVerifier server');
            // Send handshake
            const handshake = JSON.stringify({ protocol: "json", version: 1 }) + RECORD_SEPARATOR;
            client.send(handshake);
        });

        client.on('message', (data) => {
            this.handleMessage(data);
        });

        client.on('close', () => {
            console.log('Disconnected from MapsetVerifier server');
            this.isConnected = false;
        });

        client.on('error', (error) => {
            console.log('MapsetVerifier Error:', error);
            this.isConnected = false;
        });

        this.client = client;
        return this.client;
    },

    handleMessage: function(data) {
        const text = data.toString();
        const messages = text.split(RECORD_SEPARATOR);

        for (const message of messages) {
            if (!message.trim()) continue;

            try {
                const parsed = JSON.parse(message);
                
                // Handle handshake response (empty object usually)
                if (Object.keys(parsed).length === 0) {
                    console.log('MapsetVerifier Handshake successful');
                    this.isConnected = true;
                    continue;
                }

                // Log messages
                // console.log('MapsetVerifier Message:', parsed);
                
                // You can add custom event handling here based on parsed.target or parsed.type
                
            } catch (e) {
                console.log('Failed to parse MapsetVerifier message:', message);
            }
        }
    },

    sendMessage: function(method, arg) {
        if (!this.client || this.client.readyState !== ws.OPEN) {
            console.log('MapsetVerifier Client is not connected');
            return;
        }

        // SignalR Invocation
        const payload = {
            type: 1,
            target: "ClientMessage",
            arguments: [method, arg]
        };

        this.client.send(JSON.stringify(payload) + RECORD_SEPARATOR);
    },

    requestDocumentation: function() {
        this.sendMessage('RequestDocumentation', '');
    },

    requestBeatmapset: function(path) {
        this.sendMessage('RequestBeatmapset', path);
    }
};

module.exports = mapsetVerifierClient;
