// Model, quicksettings and ControlNet state belong to a Forge instance, not to
// an individual Gradio session. Keep their setup and inference in one lease.
const tails = new Map();

async function withForgeSession(callback, { key = 'forge-gpu0' } = {}) {
    const previous = tails.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    tails.set(key, current);
    await previous;
    try {
        return await callback();
    }
    finally {
        release();
        if (tails.get(key) === current) tails.delete(key);
    }
}

module.exports = { withForgeSession };
