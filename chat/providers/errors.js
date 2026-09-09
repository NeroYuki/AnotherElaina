'use strict';

class ProviderError extends Error {
    constructor(message, { code = 'PROVIDER_ERROR', status = null, retryable = false,
        retryAfterMs = null, cause = null } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = this.constructor.name;
        this.code = code;
        this.status = status;
        this.retryable = retryable;
        this.retryAfterMs = retryAfterMs;
    }
}

class ProviderHttpError extends ProviderError {}
class ProviderStreamError extends ProviderError {}
class EmptyModelResponseError extends ProviderError {}

function isAbortError(error) {
    return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

module.exports = {
    ProviderError,
    ProviderHttpError,
    ProviderStreamError,
    EmptyModelResponseError,
    isAbortError,
};
