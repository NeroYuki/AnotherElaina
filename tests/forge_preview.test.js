const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { serviceHeaders } = require('../utils/proxy_config');

function loadPreview(fetch) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../utils/prompt_analyzer'), 'utf8'), {
        module, Buffer, fetch, console: { log() {} },
        require(name) {
            if (name === '../database/database_interaction') return {};
            if (name === './ai_server_config') return { server_pool: [{ direct_url: 'http://forge.test' }] };
            if (name === './proxy_config') return { serviceHeaders };
            throw new Error(`Unexpected dependency: ${name}`);
        },
    });
    return module.exports.preview_coupler_setting;
}

for (const legacy of [false, true]) {
    test(`Coupler preview downloads ${legacy ? 'inline image' : 'Gradio file'} and sends the image bytes`, async () => {
        const bytes = Buffer.from('preview-image');
        const requests = [], sent = [];
        const preview = loadPreview(async (url, options) => {
            requests.push({ url, options });
            if (requests.length === 1) return {
                status: 200,
                json: async () => ({ data: [legacy ? `data:image/png;base64,${bytes.toString('base64')}` : { path: 'C:/forge cache/preview.png' }] }),
            };
            return { ok: true, arrayBuffer: async () => bytes };
        });
        await preview({ channel: { send: async message => sent.push(message) } }, 512, 512,
            { coupler_config: { mode: 'Advanced', adv_regions: [[0, 1, 0, 1, 1]] } }, 356, 'session', 'http://proxy.test');
        const request = JSON.parse(requests[0].options.body);
        assert.equal(request.fn_index, 356);
        assert.deepEqual(request.data, ['Advanced', '512x512', [[0, 1, 0, 1, 1]]]);
        assert.equal(requests[0].options.headers['X-AI-Service'], 'sdwebui-forge-neo');
        assert.equal(requests.length, legacy ? 1 : 2);
        if (!legacy) {
            assert.equal(requests[1].url, 'http://proxy.test/file=C:/forge cache/preview.png');
            assert.equal(requests[1].options.headers['X-AI-Service'], 'sdwebui-forge-neo');
        }
        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0].files[0].attachment, bytes);
    });
}

test('Coupler preview does not send a failed file download as an image', async () => {
    let sent = false, calls = 0;
    const preview = loadPreview(async () => ++calls === 1
        ? { status: 200, json: async () => ({ data: [{ path: 'missing.png' }] }) }
        : { ok: false });
    await preview({ channel: { send: async () => { sent = true; } } }, 512, 512,
        { coupler_config: { mode: 'Advanced', adv_regions: [] } }, 356, 'session');
    assert.equal(sent, false);
});
