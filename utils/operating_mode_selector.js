const { rateLimiter } = require('./rate_limiter')
const { canMakeGeminiRequest } = require('./gemini_request')
const comfyClient = require('./comfy_client')

/**
 * Determine the best available operating mode based on rate limits and system status
 * @param {boolean} hasImages - Whether the request includes images
 * @param {boolean} localOnly - Whether to avoid online modes (for auto_local mode)
 * @returns {string} - The best available operating mode
 */
function getBestOperatingMode(hasImages = false, localOnly = false) {
    // If localOnly is true, skip online modes entirely
    if (!localOnly) {
        // Priority order: online -> online_lite -> vision -> standard -> saving
        
        // First priority: online (if rate limits allow)
        if (canMakeGeminiRequest('online')) {
            //console.log('[Mode Selection] Using online mode - rate limits OK')
            return 'online'
        }
        
        // Second priority: online_lite (if rate limits allow)
        if (canMakeGeminiRequest('online_lite')) {
            //console.log('[Mode Selection] Using online_lite mode - rate limits OK')
            return 'online_lite'
        }
        
        // If online modes are rate limited, check local GPU resources
        //console.log('[Mode Selection] Online modes rate limited, checking local resources...')
        
        // Log remaining requests for debugging
        const onlineLiteRemaining = rateLimiter.getRemainingRequests('online_lite')
        const onlineRemaining = rateLimiter.getRemainingRequests('online')
        
        //console.log(`[Rate Limit Status] online_lite: ${onlineLiteRemaining.per_minute}/min, ${onlineLiteRemaining.per_day}/day remaining`)
        //console.log(`[Rate Limit Status] online: ${onlineRemaining.per_minute}/min, ${onlineRemaining.per_day}/day remaining`)
    } else {
        //console.log('[Mode Selection] Local only mode - skipping online options')
    }
    
    // Check if we can use local GPU
    if (comfyClient.comfyStat.gpu_vram_used < 4 || globalThis.llm_load_timer) {
        if (hasImages) {
            // console.log('[Mode Selection] Using vision mode - local GPU available with images')
            return 'standard'
        } else {
            // console.log('[Mode Selection] Using standard mode - local GPU available')
            return 'standard'
        }
    } else {
        if (localOnly) {
            // console.log('[Mode Selection] Using saving mode - local GPU busy and local-only mode active')
        } else {
            // console.log('[Mode Selection] Using saving mode - local GPU busy and online modes rate limited')
        }
        return 'saving'
    }
}

/**
 * Get the time until the next online request is available
 * @returns {object} - Time until next request for each mode
 */
function getTimeUntilNextOnlineRequest() {
    return {
        online_lite: rateLimiter.getTimeUntilNextRequest('online_lite'),
        online: rateLimiter.getTimeUntilNextRequest('online')
    }
}

/**
 * Check if any online mode is currently available
 * @returns {boolean} - true if any online mode can be used
 */
function isAnyOnlineModeAvailable() {
    return canMakeGeminiRequest('online_lite') || canMakeGeminiRequest('online')
}

/**
 * Get a status report of all operating modes
 * @returns {object} - Status of all modes
 */
function getOperatingModeStatus() {
    const onlineLiteRemaining = rateLimiter.getRemainingRequests('online_lite')
    const onlineRemaining = rateLimiter.getRemainingRequests('online')
    const timeUntilNext = getTimeUntilNextOnlineRequest()
    
    return {
        online_lite: {
            available: canMakeGeminiRequest('online_lite'),
            remaining: onlineLiteRemaining,
            timeUntilNext: timeUntilNext.online_lite
        },
        online: {
            available: canMakeGeminiRequest('online'),
            remaining: onlineRemaining,
            timeUntilNext: timeUntilNext.online
        },
        local_gpu: {
            available: comfyClient.comfyStat.gpu_vram_used < 4 || globalThis.llm_load_timer,
            vram_used: comfyClient.comfyStat.gpu_vram_used,
            llm_timer_active: !!globalThis.llm_load_timer
        }
    }
}

module.exports = {
    getBestOperatingMode,
    getTimeUntilNextOnlineRequest,
    isAnyOnlineModeAvailable,
    getOperatingModeStatus
}
