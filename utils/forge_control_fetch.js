const { serviceHeaders } = require('./proxy_config');

const SD_HEADERS = serviceHeaders('sdwebui');

async function fetchForgeControl(url, options = {}, retryOnDisconnect = false) {
    const request = {
        ...options,
        headers: { ...SD_HEADERS, ...options.headers },
    };
    try {
        return await fetch(url, request);
    } catch (error) {
        const code = error.cause?.code ?? error.code;
        if (!retryOnDisconnect || !['ECONNRESET', 'UND_ERR_SOCKET'].includes(code)) throw error;
        return fetch(url, {
            ...request,
            headers: { ...request.headers, Connection: 'close' },
        });
    }
}

module.exports = { fetchForgeControl };
