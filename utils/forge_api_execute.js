const { server_pool } = require('./ai_server_config');

/**
 * Get Forge backend memory statistics
 * @returns {Promise<Object|null>} Memory stats object with ram and cuda info, or null on failure
 */
async function getForgeMemory() {
	try {
		const serverUrl = server_pool[0].url;
		const response = await fetch(`${serverUrl}/sdapi/v1/memory`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return await response.json();
	} catch (error) {
		console.error('[Forge API] Failed to fetch memory:', error);
		return null;
	}
}

/**
 * Get Forge backend progress and job status
 * @returns {Promise<Object|null>} Progress object with state info, or null on failure
 */
async function getForgeProgress() {
	try {
		const serverUrl = server_pool[0].url;
		const response = await fetch(`${serverUrl}/sdapi/v1/progress`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return await response.json();
	} catch (error) {
		console.error('[Forge API] Failed to fetch progress:', error);
		return null;
	}
}

/**
 * Unload the currently loaded checkpoint to free VRAM
 * @returns {Promise<Object|null>} Empty object on success, or null on failure
 */
async function unloadForgeCheckpoint() {
	try {
		const serverUrl = server_pool[0].url;
		const response = await fetch(`${serverUrl}/sdapi/v1/unload-checkpoint`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return await response.json();
	} catch (error) {
		console.error('[Forge API] Failed to unload checkpoint:', error);
		return null;
	}
}

module.exports = {
	getForgeMemory,
	getForgeProgress,
	unloadForgeCheckpoint
};
