const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ai_config = require('../utils/ai_server_config');
const {
    ANIMA_INPAINT_MODEL,
    ANIMA_INPAINT_PREPROCESSOR,
    is_anima_model,
    resolve_anima_controlnet_model,
    get_anima_inpaint_unit,
} = require('../utils/anima_inpaint');

const CONTROLNET_SOURCE = require.resolve('../utils/controlnet_execute.js');

// controlnet_execute normally calls the real network through node-fetch. In the
// test context we replace that one dynamic import with an injected mock while
// keeping the module's request-building code intact.
function load_controlnet_for(cached_model, fetch_impl) {
    let source = fs.readFileSync(CONTROLNET_SOURCE, 'utf8');
    source = source.replace(
        "const _nodeFetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));",
        'const _nodeFetch = (...args) => globalThis.__fetch(...args);',
    );

    const module = { exports: {} };
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        Buffer,
        console: { log() {} },
        __fetch: fetch_impl,
        require(name) {
            if (name === '../utils/ai_server_config.js') return ai_config;
            if (name === './proxy_config') return { serviceHeaders: () => ({ 'X-Test-Service': 'sdwebui' }) };
            if (name === './model_change.js') return { cached_model: [cached_model] };
            if (name === './anima_inpaint.js') return require('../utils/anima_inpaint');
            throw new Error(`Unexpected dependency in controlnet_execute: ${name}`);
        },
    });
    return module.exports.load_controlnet;
}

function make_fetch_recorder() {
    const requests = [];
    const fetch_impl = async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return { status: 200 };
    };
    return { requests, fetch_impl };
}

function controlnet_config({ model = 'controlnet_inpaint', preprocessor = 'inpaint_noobai', weight = 1, second = null } = {}) {
    const unit = (overrides = {}) => ({
        preprocessor,
        model,
        weight,
        type: 'Inpaint',
        resolution: 1024,
        mode: 'Balanced',
        t_a: 32,
        t_b: 200,
        ...overrides,
    });
    const dormant = unit({ preprocessor: 'fill', model: 'not_an_active_model' });
    return {
        do_preview_annotation: false,
        control_net: [
            unit(),
            // Dormant old-SDXL leftovers without input must be ignored.
            second ? unit(second) : dormant,
            dormant,
        ],
    };
}

const mask = 'data:image/png;base64,WHITE_EDIT_MASK';
const source_image = 'data:image/png;base64,SOURCE';

test('Anima helpers pin the 006 checkpoint, recognise canonical basenames, and map aliases', () => {
    assert.equal(ANIMA_INPAINT_MODEL, 'animaLllite_006-inpainting');
    assert.equal(ANIMA_INPAINT_PREPROCESSOR, 'inpaint_noobai');

    for (const model of [
        'anima-base-v1.safetensors',
        'archive\\wai_anima_v10.safetensors',
        'anima-aesthetic-v1_1.safetensors',
        'animaginexl_v40_opt.safetensors',
    ]) {
        assert.equal(is_anima_model(model), model !== 'animaginexl_v40_opt.safetensors', model);
    }
    assert.equal(is_anima_model(null), false);
    assert.equal(is_anima_model('wai_nsfw_illustrious_v120.safetensors'), false);

    for (const alias of [
        'controlnet_inpaint',
        'animaLllite_006-inpainting',
        'animaLllite_006-inpainting.safetensors',
        'C:\\forge\\models\\ControlNet\\animaLllite_006-inpainting [0123abcd].safetensors',
    ]) {
        assert.equal(resolve_anima_controlnet_model(alias), ANIMA_INPAINT_MODEL, alias);
    }
    assert.equal(resolve_anima_controlnet_model('None'), 'None');
    assert.equal(resolve_anima_controlnet_model(null), 'None');
    assert.equal(resolve_anima_controlnet_model(undefined), 'None');

    assert.throws(
        () => resolve_anima_controlnet_model('controlnet_openpose'),
        /only support the Anima inpaint ControlNet/,
    );
    assert.throws(() => resolve_anima_controlnet_model('ipadapter'), /inpaint_noobai/);
});

test('Anima inpaint unit keeps a fresh default and honours explicit zero overrides', () => {
    assert.equal(get_anima_inpaint_unit({ model: 'flux1-dev-Q8_0.gguf' }), null);

    assert.deepEqual(get_anima_inpaint_unit({ model: 'anima-base-v1.safetensors' }), {
        model: 'controlnet_inpaint',
        preprocessor: 'inpaint_noobai',
        type: 'Inpaint',
        weight: 1,
        mode: 'Balanced',
        resolution: 1024,
        t_a: 32,
        t_b: 200,
    });

    const overrides = { weight: 0, mode: 'ControlNet is more important', resolution: 768, t_a: 0, t_b: 0, model: 'ignored' };
    const frozen = structuredClone(overrides);
    const unit = get_anima_inpaint_unit({ model: 'wai_anima_v10.safetensors', overrides });
    assert.equal(unit.weight, 0);
    assert.equal(unit.mode, 'ControlNet is more important');
    assert.equal(unit.resolution, 768);
    assert.equal(unit.t_a, 0);
    assert.equal(unit.t_b, 0);
    assert.equal(unit.model, 'controlnet_inpaint', 'override model must not replace the pinned alias');
    assert.deepEqual(overrides, frozen, 'overrides must not be mutated');
    assert.notEqual(unit, get_anima_inpaint_unit({ model: 'wai_anima_v10.safetensors' }));

    assert.throws(
        () => get_anima_inpaint_unit({ model: 'anima-base-v1.safetensors', preprocessor_override: 'fill' }),
        /inpaint_noobai/,
    );
    assert.throws(
        () => get_anima_inpaint_unit({ model: 'anima-base-v1.safetensors', overrides: { preprocessor: 'inpaint_only' } }),
        /inpaint_noobai/,
    );
    assert.equal(
        get_anima_inpaint_unit({
            model: 'anima-base-v1.safetensors',
            preprocessor_override: 'inpaint_noobai',
            overrides: { preprocessor: 'fill' },
        }).preprocessor,
        'inpaint_noobai',
        'explicit root override wins over saved config',
    );
});

test('load_controlnet maps Anima units and preserves the white-edit mask', async () => {
    const { requests, fetch_impl } = make_fetch_recorder();
    const load_controlnet = load_controlnet_for('anima-base-v1.safetensors', fetch_impl);

    await load_controlnet(
        'session', 0, source_image, source_image, null,
        JSON.stringify(controlnet_config({
            weight: 0,
            second: { model: 'controlnet_inpaint', preprocessor: 'inpaint_noobai' },
        })),
        { channel: { async send() {} } }, 0, mask, false, {},
    );

    const payloads = requests.filter(request => request.body.data.length === 20);
    assert.equal(payloads.length, 2, 'first unit plus one enabled additional unit');
    const first = payloads[0].body.data;
    assert.equal(first[2], mask, 'the canonical mask is preserved for inpaint_noobai to clear');
    assert.equal(first[6], 'inpaint_noobai');
    assert.equal(first[7], ANIMA_INPAINT_MODEL, 'Anima must never fall through to the SD15 mapping');
    assert.equal(first[8], 0, 'numeric weight zero is respected');
    assert.equal(payloads[0].body.fn_index, ai_config.server_pool[0].fn_index_controlnet[0]);

    const second = payloads[1].body.data;
    assert.equal(second[6], 'inpaint_noobai');
    assert.equal(second[7], ANIMA_INPAINT_MODEL);
    assert.equal(payloads[1].body.fn_index - payloads[0].body.fn_index, 44);
    assert.equal(second[2] == null || second[2] === '', true, 'additional units do not receive the first mask');
});

test('load_controlnet rejects unsupported Anima preprocessors and ControlNets', async () => {
    const { fetch_impl } = make_fetch_recorder();
    const load_controlnet = load_controlnet_for('anima-base-v1.safetensors', fetch_impl);
    const interaction = { channel: { async send() {} } };

    await assert.rejects(
        load_controlnet(
            'session', 0, source_image, null, null,
            JSON.stringify(controlnet_config({ preprocessor: 'fill' })),
            interaction, 0, mask, false, {},
        ),
        /inpaint_noobai/,
    );

    await assert.rejects(
        load_controlnet(
            'session', 0, source_image, null, null,
            JSON.stringify(controlnet_config({ model: 'controlnet_openpose' })),
            interaction, 0, mask, false, {},
        ),
        /only support the Anima inpaint ControlNet/,
    );
});

test('load_controlnet keeps the existing non-Anima SDXL mapping unchanged', async () => {
    const { requests, fetch_impl } = make_fetch_recorder();
    const load_controlnet = load_controlnet_for('wai_nsfw_illustrious_v120.safetensors', fetch_impl);

    await load_controlnet(
        'session', 0, source_image, null, null,
        JSON.stringify(controlnet_config({ model: 'controlnet_inpaint', preprocessor: 'fill', weight: 0 })),
        { channel: { async send() {} } }, 0, null, false, {},
    );

    const payload = requests.filter(request => request.body.data.length === 20).at(-1).body.data;
    assert.equal(payload[6], 'fill');
    assert.equal(payload[7], 'controlnetxlCNXL_destitechInpaintv2');
    assert.equal(payload[8], 0);
});
