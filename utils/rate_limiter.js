const fs = require('fs');
const path = require('path');

/**
 * Rate limiter for API requests with per-minute and per-day limits
 * Persists data to disk to survive bot restarts
 */
class RateLimiter {
    constructor() {
        this.limits = {
            online: {
                per_minute: 10,
                per_day: 250
            },
            online_lite: {
                per_minute: 15,
                per_day: 1000
            }
        }
        
        // Path to store rate limit data
        this.dataPath = path.join(__dirname, '..', 'temp', 'rate_limit_data.json');
        
        // Track requests with timestamps
        this.requests = {
            online: [],
            online_lite: []
        }
        
        // Load existing data from disk
        this.loadData();
        
        // Clean up old requests on startup
        this.cleanupOldRequests();
        
        // Auto-save data periodically (every 30 seconds)
        this.saveInterval = setInterval(() => {
            this.saveData();
        }, 30000);
        
        // Save data when process exits
        process.on('SIGINT', () => {
            this.saveData();
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            this.saveData();
            process.exit(0);
        });
    }
    
    /**
     * Load rate limit data from disk
     */
    loadData() {
        try {
            if (fs.existsSync(this.dataPath)) {
                const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
                this.requests = data.requests || { online: [], online_lite: [] };
                console.log('[Rate Limiter] Loaded existing rate limit data from disk');
                
                // Log current status
                const onlineCount = this.requests.online.length;
                const onlineLiteCount = this.requests.online_lite.length;
                console.log(`[Rate Limiter] Restored ${onlineCount} online requests, ${onlineLiteCount} online_lite requests`);
            } else {
                console.log('[Rate Limiter] No existing rate limit data found, starting fresh');
            }
        } catch (error) {
            console.error('[Rate Limiter] Error loading rate limit data:', error);
            this.requests = { online: [], online_lite: [] };
        }
    }
    
    /**
     * Save rate limit data to disk
     */
    saveData() {
        try {
            // Ensure temp directory exists
            const tempDir = path.dirname(this.dataPath);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const data = {
                requests: this.requests,
                lastSaved: Date.now()
            };
            
            fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('[Rate Limiter] Error saving rate limit data:', error);
        }
    }
    
    /**
     * Clean up old requests (older than 24 hours)
     */
    cleanupOldRequests() {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        Object.keys(this.requests).forEach(mode => {
            const oldCount = this.requests[mode].length;
            this.requests[mode] = this.requests[mode].filter(timestamp => timestamp > oneDayAgo);
            const newCount = this.requests[mode].length;
            
            if (oldCount !== newCount) {
                console.log(`[Rate Limiter] Cleaned up ${oldCount - newCount} old requests for ${mode} mode`);
            }
        });
        
        // Save after cleanup
        this.saveData();
    }
    
    /**
     * Destroy the rate limiter and clean up resources
     */
    destroy() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }
        this.saveData();
    }
    
    /**
     * Check if a request can be made for the given mode
     * @param {string} mode - 'online' or 'online_lite'
     * @returns {boolean} - true if request can be made, false if rate limited
     */
    canMakeRequest(mode) {
        if (!this.limits[mode]) {
            console.warn(`Unknown rate limit mode: ${mode}`)
            return false
        }
        
        const now = Date.now()
        const oneMinuteAgo = now - (60 * 1000)
        const oneDayAgo = now - (24 * 60 * 60 * 1000)
        
        // Clean up old requests
        this.requests[mode] = this.requests[mode].filter(timestamp => timestamp > oneDayAgo)
        
        // Count requests in the last minute and day
        const requestsLastMinute = this.requests[mode].filter(timestamp => timestamp > oneMinuteAgo).length
        const requestsLastDay = this.requests[mode].length
        
        // Check limits
        const withinMinuteLimit = requestsLastMinute < this.limits[mode].per_minute
        const withinDayLimit = requestsLastDay < this.limits[mode].per_day
        
        return withinMinuteLimit && withinDayLimit
    }
    
    /**
     * Record a request for the given mode
     * @param {string} mode - 'online' or 'online_lite'
     */
    recordRequest(mode) {
        if (!this.limits[mode]) {
            console.warn(`Unknown rate limit mode: ${mode}`)
            return
        }
        
        this.requests[mode].push(Date.now())
        
        // Auto-save after recording a request (but not too frequently)
        if (!this.lastSaveTime || (Date.now() - this.lastSaveTime) > 5000) {
            this.saveData();
            this.lastSaveTime = Date.now();
        }
    }
    
    /**
     * Get the remaining requests for the given mode
     * @param {string} mode - 'online' or 'online_lite'
     * @returns {object} - remaining requests per minute and per day
     */
    getRemainingRequests(mode) {
        if (!this.limits[mode]) {
            return { per_minute: 0, per_day: 0 }
        }
        
        const now = Date.now()
        const oneMinuteAgo = now - (60 * 1000)
        const oneDayAgo = now - (24 * 60 * 60 * 1000)
        
        // Clean up old requests
        this.requests[mode] = this.requests[mode].filter(timestamp => timestamp > oneDayAgo)
        
        // Count requests in the last minute and day
        const requestsLastMinute = this.requests[mode].filter(timestamp => timestamp > oneMinuteAgo).length
        const requestsLastDay = this.requests[mode].length
        
        return {
            per_minute: Math.max(0, this.limits[mode].per_minute - requestsLastMinute),
            per_day: Math.max(0, this.limits[mode].per_day - requestsLastDay)
        }
    }
    
    /**
     * Get time until next request is allowed (in milliseconds)
     * @param {string} mode - 'online' or 'online_lite'
     * @returns {number} - milliseconds until next request is allowed, 0 if allowed now
     */
    getTimeUntilNextRequest(mode) {
        if (!this.limits[mode]) {
            return Infinity
        }
        
        const now = Date.now()
        const oneMinuteAgo = now - (60 * 1000)
        
        // Get requests in the last minute
        const recentRequests = this.requests[mode].filter(timestamp => timestamp > oneMinuteAgo)
        
        if (recentRequests.length < this.limits[mode].per_minute) {
            return 0 // Can make request now
        }
        
        // Find the oldest request in the last minute
        const oldestRecentRequest = Math.min(...recentRequests)
        const timeUntilExpiry = (oldestRecentRequest + (60 * 1000)) - now
        
        return Math.max(0, timeUntilExpiry)
    }
    
    /**
     * Log current rate limit status
     * @param {string} mode - 'online' or 'online_lite'
     */
    logStatus(mode) {
        const remaining = this.getRemainingRequests(mode)
        const timeUntilNext = this.getTimeUntilNextRequest(mode)
        
        console.log(`[Rate Limiter] ${mode}: ${remaining.per_minute}/${this.limits[mode].per_minute} requests/min remaining, ${remaining.per_day}/${this.limits[mode].per_day} requests/day remaining`)
        
        if (timeUntilNext > 0) {
            console.log(`[Rate Limiter] ${mode}: Next request available in ${Math.ceil(timeUntilNext / 1000)} seconds`)
        }
    }
    
    /**
     * Reset rate limits for a specific mode or all modes
     * @param {string} mode - 'online', 'online_lite', or 'all'
     */
    resetRateLimit(mode = 'all') {
        if (mode === 'all') {
            Object.keys(this.requests).forEach(key => {
                this.requests[key] = [];
            });
            console.log('[Rate Limiter] Reset all rate limits');
        } else if (this.limits[mode]) {
            this.requests[mode] = [];
            console.log(`[Rate Limiter] Reset rate limits for ${mode}`);
        } else {
            console.warn(`[Rate Limiter] Unknown mode: ${mode}`);
            return false;
        }
        
        this.saveData();
        return true;
    }
    
    /**
     * Get detailed statistics about rate limit usage
     * @returns {object} - Detailed statistics
     */
    getDetailedStats() {
        const now = Date.now();
        const oneMinuteAgo = now - (60 * 1000);
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        
        const stats = {};
        
        Object.keys(this.limits).forEach(mode => {
            // Clean up old requests
            this.requests[mode] = this.requests[mode].filter(timestamp => timestamp > oneDayAgo);
            
            const requestsLastMinute = this.requests[mode].filter(timestamp => timestamp > oneMinuteAgo);
            const requestsLastDay = this.requests[mode];
            
            stats[mode] = {
                limits: this.limits[mode],
                usage: {
                    last_minute: requestsLastMinute.length,
                    last_day: requestsLastDay.length
                },
                remaining: {
                    per_minute: Math.max(0, this.limits[mode].per_minute - requestsLastMinute.length),
                    per_day: Math.max(0, this.limits[mode].per_day - requestsLastDay.length)
                },
                available: (
                    requestsLastMinute.length < this.limits[mode].per_minute &&
                    requestsLastDay.length < this.limits[mode].per_day
                ),
                next_available: this.getTimeUntilNextRequest(mode)
            };
        });
        
        return stats;
    }
    
    /**
     * Log current rate limit status
     * @param {string} mode - 'online' or 'online_lite'
     */
    logStatus(mode) {
        const remaining = this.getRemainingRequests(mode)
        const timeUntilNext = this.getTimeUntilNextRequest(mode)
        
        console.log(`[Rate Limiter] ${mode}: ${remaining.per_minute}/${this.limits[mode].per_minute} requests/min remaining, ${remaining.per_day}/${this.limits[mode].per_day} requests/day remaining`)
        
        if (timeUntilNext > 0) {
            console.log(`[Rate Limiter] ${mode}: Next request available in ${Math.ceil(timeUntilNext / 1000)} seconds`)
        }
    }
}

// Create a global instance
const rateLimiter = new RateLimiter()

module.exports = {
    RateLimiter,
    rateLimiter
}
