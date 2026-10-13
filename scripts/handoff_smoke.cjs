// Local-only ComfyUI → Forge handoff check. Generates no Discord messages.
const axios = require('axios');
const fs = require('fs/promises');
const sharp = require('sharp');
const { PROXY_URL } = require('../utils/proxy_config');
const { forgeWorkload, workloadHeaders } = require('../utils/orchestrator_workload');

async function main() {
    const dashboard = process.env.AI_DASHBOARD_URL || 'http://127.0.0.1:11231';
    const status = async () => (await axios.get(`${dashboard}/api/status`, { timeout: 15_000 })).data;
    const before = await status();
    if (before.protection.mode !== 'observe' || !before.protection.auto_unload) throw new Error('Expected Observe + auto-unload.');
    if (before.protection.leases.length) throw new Error('Another job is active.');
    const forgeHeaders = { 'X-AI-Service': 'sdwebui-forge-neo', 'X-AI-Instance': 'forge-gpu0' };
    const options = (await axios.get(`${PROXY_URL}/sdapi/v1/options`, { headers: forgeHeaders, timeout: 15_000 })).data;
    const workload = forgeWorkload({ taskKind: 'txt2img', checkpoint: options.sd_model_checkpoint,
        width: 512, height: 512, baseSteps: 2 });
    const started = Date.now();
    console.log(`Submitting two-step Forge request; GPU 0 free before handoff: ${before.gpus.find(g => g.id === 0).vram_free_mib} MiB.`);
    const result = await axios.post(`${PROXY_URL}/sdapi/v1/txt2img`, {
        prompt: 'a small orange ball on a wooden table, simple still life', seed: 123,
        steps: 2, width: 512, height: 512, batch_size: 1, n_iter: 1,
        save_images: false, do_not_save_samples: true, do_not_save_grid: true,
    }, { headers: workloadHeaders('sdwebui', workload, forgeHeaders), timeout: 180_000 });
    const output = Buffer.from(result.data.images[0].replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
    const metadata = await sharp(output).metadata();
    if (metadata.width !== 512 || metadata.height !== 512) throw new Error('Unexpected Forge output size.');
    const after = await status();
    const eviction = after.instance_lifecycle['comfyui-gpu0']?.last_eviction;
    if (!eviction || eviction.reason !== 'service-handoff' || eviction.at < started / 1000) {
        throw new Error(`No matching ComfyUI handoff cleanup: ${JSON.stringify(eviction)}`);
    }
    if (eviction.result !== 'verified-reclaimed' || eviction.reclaimed_mib < 1024) {
        throw new Error(`ComfyUI VRAM release was not verified: ${JSON.stringify(eviction)}`);
    }
    if (after.protection.mode !== 'observe' || !after.protection.auto_unload) throw new Error('Protection policy changed.');
    await fs.mkdir('temp', { recursive: true });
    await fs.writeFile('temp/handoff-forge-output.png', output);
    const report = { started: new Date(started).toISOString(), elapsedSeconds: (Date.now() - started) / 1000,
        beforeFreeMiB: before.gpus.find(g => g.id === 0).vram_free_mib,
        afterFreeMiB: after.gpus.find(g => g.id === 0).vram_free_mib,
        eviction, output: 'temp/handoff-forge-output.png', protectionMode: after.protection.mode };
    await fs.writeFile('temp/handoff-smoke.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.response?.data || error); process.exitCode = 1; });
