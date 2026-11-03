// Orchestrator proxy routing configuration.
//
// During the migration away from direct AI-server access, all AI service HTTP
// traffic is sent to the orchestrator proxy and routed to the correct backend
// via the `X-AI-Service` header (the proxy also supports path-prefix routing,
// but header routing is used here because some services — notably sdwebui —
// expose paths like `/sdapi/...` that do not match the service-name prefix).
//
// See `migration_doc.md` for the full migration plan.

// Base URL of the orchestrator proxy. Override with `AI_PROXY_URL` if needed
// (e.g. the LAN IP when running the consumer on a different machine).
const PROXY_URL = process.env.AI_PROXY_URL || 'http://192.168.1.2:11230';

// Service identifiers understood by the proxy's `X-AI-Service` header routing.
const SERVICES = {
    sdwebui: 'sdwebui-forge-neo',
    comfyui: 'comfyui',
    audiomuse: 'audiomuse',
    mapperatorinator: 'mapperatorinator',
    lmstudio: 'lmstudio',
};

/**
 * Build request headers that route a request to `service` through the proxy.
 * Any existing headers (`extra`) are preserved; `X-AI-Service` always wins so
 * the request cannot be accidentally mis-routed.
 *
 * @param {string} service - key from `SERVICES` (or a raw service name).
 * @param {Object} [extra]  - additional headers to merge (e.g. Content-Type).
 * @returns {Object} merged headers including the routing header.
 */
function serviceHeaders(service, extra = {}) {
    const resolved = SERVICES[service] || service;
    // Forge's model, quicksettings and ControlNet state must share the same
    // instance as inference; independently routed setup calls are not atomic.
    const affinity = resolved === SERVICES.sdwebui ? { 'X-AI-Instance': 'forge-gpu0' } : {};
    return { ...affinity, ...extra, 'X-AI-Service': resolved };
}

module.exports = {
    PROXY_URL,
    SERVICES,
    serviceHeaders,
};
