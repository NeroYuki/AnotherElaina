'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');

const COMMAND_NAMES = { simple: 'wd_create', advanced: 'wd_create_adv' };
const ORIGINAL_PROMPT = 'trigger, <lora:dynamic_lora:0.75>, __wildcard__';
const PROCESSED_PROMPT = 'trigger, <lora:dynamic_lora:0.75>, resolved';

function startFileServer({ failFirstProgress = false } = {}) {
    const progressRequests = [];
    const abortRequests = [];
    let progressFailures = 0;
    const server = http.createServer((req, res) => {
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                let parsed = {};
                try { parsed = JSON.parse(body); }
                catch { parsed = {}; }
                if (req.url.startsWith('/internal/progress')) {
                    progressRequests.push(parsed);
                    if (failFirstProgress && progressFailures === 0) {
                        progressFailures += 1;
                        res.writeHead(504, { 'Content-Type': 'text/plain' });
                        res.end("Upstream 'sdwebui-forge-neo' timed out.");
                        return;
                    }
                }
                else if (req.url.startsWith('/run/predict')) abortRequests.push(parsed);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ completed: true }));
            });
            return;
        }
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.from('image-bytes'));
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({
            url: `http://127.0.0.1:${server.address().port}`,
            progressRequests,
            abortRequests,
            get progressFailures() { return progressFailures; },
            close: () => new Promise(done => server.close(done)),
        }));
    });
}

function makeInteraction({ prompt, bulkSize, defaultNegPrompt }) {
    const edits = [];
    const channelSends = [];
    const collector = { stopped: false, on() {}, stop() { this.stopped = true; } };
    const values = {
        prompt,
        neg_prompt: '',
        seed: '42',
        default_neg_prompt: defaultNegPrompt,
        upscaler_mode: 'Lanczos',
        upscaler: 'Lanczos',
        checkpoint: null,
        profile: 'test-profile',
        bulk_size: String(bulkSize),
        controlnet_config: null,
        adetailer_config: null,
        colorbalance_config: null,
    };
    const interaction = {
        id: 'interaction-test',
        guildId: null,
        user: { id: 'user-test', toString: () => 'user-test' },
        options: {
            getString: name => values[name] ?? null,
            getInteger: name => (name === 'width' || name === 'height' ? 512 : null),
            getNumber: name => (name === 'upscale_multiplier' ? 1 : null),
            getBoolean: () => false,
            getAttachment: () => null,
        },
        async deferReply() {},
        async reply(payload) { edits.push(payload); },
        async editReply(payload) { edits.push(payload); return payload; },
        channel: {
            id: 'channel-test',
            nsfw: false,
            async send(payload) { channelSends.push(payload); return payload; },
            createMessageComponentCollector() { return collector; },
        },
    };
    return { interaction, edits, channelSends, collector };
}

function makeClient() {
    return {
        cooldowns: new Map(),
        usersetting_config: new Map(),
        adetailer_config: new Map(),
        boorugen_config: new Map(),
        latentmod_config: new Map(),
        colorbalance_config: new Map(),
        controlnet_config: new Map(),
    };
}

function fullPromptAnalyzeResult(prompt) {
    return {
        prompt: prompt.replace('__wildcard__', 'resolved'),
        coupler_config: null,
        color_grading_config: null,
        freeu_config: null,
        dynamic_threshold_config: null,
        pag_config: null,
        use_booru_gen: false,
        use_foocus: false,
        tipo_input: null,
        detail_daemon_config: null,
        mahiro_config: null,
        teacache_config: null,
        modulation_config: null,
    };
}

async function runCommand({ commandName, server, prompt = ORIGINAL_PROMPT, bulkSize = 2,
    settings = { image_prompt_quality: 'standard', image_prompt_batch: 'each', image_prompt_style: 'tags' },
    enrichment, enrichError, parseImageCountResult, syncModels, modelChangeResult, responsePaths }) {
    const events = [];
    let lockDepth = 0;
    let syncCalls = 0;
    const cachedModel = ['frozen.safetensors'];
    const posts = [];
    const getDataBodyCalls = [];
    const parseCalls = [];
    const expectedBulk = parseImageCountResult?.bulk_size ?? bulkSize;

    const aiConfig = {
        server_pool: [{
            url: server.url,
            fn_index_create: 101,
            fn_index_abort: 102,
            fn_index_coupler_region_preview: [103],
        }],
        get_data_body: (...args) => {
            getDataBodyCalls.push(args);
            const data = [];
            data[0] = `task(${args[8]})`;
            data[1] = args[1];
            data[2] = '{}';
            data[5] = args[5];
            return data;
        },
        get_negative_prompt: value => value,
        initiate_server_heartbeat() {},
        get_worker_server: () => 0,
        get_prompt: value => value,
        model_name_hash_mapping: {},
        check_model_filename: value => value,
        model_selection: [],
        upscaler_selection: [],
        generation_upscaler_selection: [],
        model_selection_xl: [],
        model_selection_curated: [],
        model_selection_inpaint: [],
        model_selection_flux: [],
        model_selection_legacy: [],
        sampler_selection: [],
        scheduler_selection: [],
        sampler_to_comfy_name_mapping: {},
        scheduler_to_comfy_name_mapping: {},
        resolve_hires_models: () => ({ checkpoint: null, support_models: [], requested_checkpoint: null }),
    };

    const modelChange = {
        cached_model: cachedModel,
        sync_active_model: async () => {
            syncCalls++;
            if (syncModels) cachedModel[0] = syncModels[syncCalls - 1] ?? syncModels[syncModels.length - 1];
            events.push({ type: syncCalls === 1 ? 'sync-outer' : 'sync-inner', lockDepth });
            return cachedModel[0];
        },
        model_change: async (model, forced) => {
            events.push({ type: 'model-change', model, forced, lockDepth });
            if (modelChangeResult === false) return false;
            cachedModel[0] = model;
            return true;
        },
    };

    const imagePrompt = {
        enrichImagePrompts: async args => {
            events.push({ type: 'enrich', lockDepth, prompt: args.prompt, model: args.model, count: args.count });
            if (enrichError) throw enrichError;
            return enrichment;
        },
    };

    const forgeSession = {
        withForgeSession: async callback => {
            lockDepth++;
            events.push({ type: 'lock-acquire', lockDepth });
            try { return await callback(); }
            finally {
                events.push({ type: 'lock-release', lockDepth });
                lockDepth--;
            }
        },
    };

    const promptAnalyzer = {
        full_prompt_analyze: value => {
            events.push({ type: 'parse', prompt: value });
            return fullPromptAnalyzeResult(value);
        },
        fetch_user_defined_wildcard: async value => value,
        get_teacache_config_from_prompt: () => ({ teacache_config: null }),
        get_debug_prompt_analyze: (value, neg) => ({ prompt: value, neg_prompt: neg, debug_prompt: null }),
        preview_coupler_setting() {},
    };

    const commonHelper = {
        clamp: (num, min, max) => (num <= min ? min : num >= max ? max : num),
        calculateOptimalGrid: (width, height) => ({ columns: 1, rows: 1, gridWidth: width, gridHeight: height }),
        parseImageCount: () => {
            parseCalls.push(true);
            if (parseImageCountResult) return parseImageCountResult;
            return { bulk_size: bulkSize, batch_count: bulkSize, batch_size: 1 };
        },
        parse_common_setting: () => ({ ...settings }),
    };

    const axiosStub = {
        post: async (url, payload) => {
            const index = posts.length;
            posts.push({ url, payload });
            events.push({ type: 'post', sessionHash: payload.session_hash, lockDepth, index });
            const createData = payload.data;
            const paths = typeof responsePaths === 'function'
                ? responsePaths(index, createData)
                : (responsePaths || [`/image-${index}.png`]);
            return {
                status: 200,
                data: {
                    data: [
                        { value: paths.map(value => ({ image: { path: value } })) },
                        null,
                        JSON.stringify({
                            seed: createData[5],
                            sd_model_hash: 'hash',
                            sd_model_name: 'model',
                            all_prompts: [createData[1]],
                            all_seeds: [createData[5]],
                        }),
                    ],
                    duration: 1,
                },
            };
        },
    };

    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === '../config.json' || request === '../../config.json') {
            return { byPassUser: [], censorGuildIds: [], optOutGuildIds: [] };
        }
        if (request === 'dotenv') return { config() {} };
        if (String(request).includes('database_interaction')) {
            return { queryRecordLimit() {}, addRecord() {}, queryRecord() {}, editRecords() {}, removeRecords() {} };
        }
        if (request === 'axios') return { default: axiosStub };
        if (request === '../utils/ai_server_config.js') return aiConfig;
        if (request === '../utils/model_change.js') return modelChange;
        if (request === '../utils/image_prompt') return imagePrompt;
        if (request === '../utils/forge_session') return forgeSession;
        if (request === '../utils/image_prompt_batch') {
            return originalLoad.call(this, request, parent, isMain);
        }
        if (request === '../utils/prompt_analyzer.js') return promptAnalyzer;
        if (request === '../utils/profile_helper.js') {
            return {
                load_profile: async () => ({
                    prompt_pre: '', prompt: '', neg_prompt_pre: '', neg_prompt: '',
                    width: 512, height: 512, sampler: 'Euler', scheduler: 'Automatic',
                    sampling_step: 1, cfg_scale: 5,
                }),
            };
        }
        if (request === '../utils/adetailer_execute.js') return { load_adetailer: async () => {} };
        if (request === '../utils/controlnet_execute.js') return { load_controlnet: async () => {} };
        if (request === '../utils/catbox_upload.js') return { catboxUpload: async () => null };
        if (request === '../utils/model_defaults') return { get_model_family_defaults: () => null };
        if (request === '../utils/orchestrator_workload') {
            return { forgeWorkload: workload => workload, workloadHeaders: () => ({}) };
        }
        if (request === '../utils/proxy_config') return { serviceHeaders: () => ({}) };
        if (request === '../utils/comfy_client') {
            return { sendPrompt() {}, getImage() {}, freeMemory() {} };
        }
        if (request === '../utils/load_discord_img.js') return { loadImage: async () => null };
        if (request === '../utils/common_helper') return commonHelper;
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const commandPath = path.join(__dirname, '..', 'commands', COMMAND_NAMES[commandName]);
        delete require.cache[require.resolve(commandPath)];
        const command = require(commandPath);
        const { interaction, edits, channelSends, collector } = makeInteraction({
            prompt, bulkSize, defaultNegPrompt: commandName === 'simple' ? 'q_sfw' : 'n_sfw',
        });
        const client = makeClient();
        await command.execute(interaction, client);
        return {
            events, posts, getDataBodyCalls, parseCalls, edits, channelSends, collector,
            cachedModel, expectedBulk, interaction,
        };
    }
    finally {
        Module._load = originalLoad;
    }
}

async function withServer(callback, options) {
    const server = await startFileServer(options);
    try { return await callback(server); }
    finally { await server.close(); }
}

function enrichmentForEach(prompt, count) {
    return {
        prompts: Array.from({ length: count }, (_, index) => `${prompt}, variant ${index + 1}`),
        perImage: true,
        style: 'tags',
        quality: 'standard',
    };
}

for (const commandName of ['simple', 'advanced']) {
    test(`${commandName}: enhances before the Forge lease, then emits one single-image request per variant`, async () => {
        await withServer(async server => {
            const result = await runCommand({
                commandName,
                server,
                bulkSize: 2,
                syncModels: ['frozen.safetensors', 'other.safetensors'],
                enrichment: enrichmentForEach(ORIGINAL_PROMPT, 2),
            });

            const enrich = result.events.find(event => event.type === 'enrich');
            const lock = result.events.find(event => event.type === 'lock-acquire');
            const innerSync = result.events.find(event => event.type === 'sync-inner');
            const mutation = result.events.find(event => event.type === 'model-change');
            assert.ok(enrich, 'enhancer ran');
            assert.ok(lock, 'Forge lease acquired');
            assert.ok(result.events.indexOf(enrich) < result.events.indexOf(lock), 'enhancement precedes the lease');
            assert.equal(enrich.lockDepth, 0);
            assert.equal(enrich.prompt, ORIGINAL_PROMPT);
            assert.equal(enrich.model, 'frozen.safetensors');
            assert.equal(innerSync.lockDepth, 1);
            assert.equal(mutation.lockDepth, 1);
            assert.equal(mutation.forced, true);

            const parse = result.events.filter(event => event.type === 'parse');
            assert.equal(parse.length, 1, 'prompt pipeline runs exactly once');
            assert.equal(parse[0].prompt, ORIGINAL_PROMPT);

            assert.equal(result.posts.length, 2);
            const sessions = result.posts.map(post => post.payload.session_hash);
            assert.equal(new Set(sessions).size, 2);
            assert.match(sessions[0], /-image-1$/);
            assert.match(sessions[1], /-image-2$/);

            const prompts = result.getDataBodyCalls.map(args => args[1]);
            assert.deepEqual(prompts, [
                `${PROCESSED_PROMPT}, variant 1`,
                `${PROCESSED_PROMPT}, variant 2`,
            ]);
            for (const prompt of prompts) {
                assert.equal((prompt.match(/<lora:dynamic_lora:0\.75>/g) || []).length, 1);
            }
            assert.deepEqual(result.getDataBodyCalls.map(args => [args[35], args[36]]), [[1, 1], [1, 1]]);
            assert.deepEqual(result.getDataBodyCalls.map(args => args[5]), [42, 43]);

            assert.equal(result.collector.stopped, true);
            assert.deepEqual(server.abortRequests, []);
            assert.ok(server.progressRequests.some(request => /-image-2\)$/.test(request.id_task)), 'progress polling follows the per-variant task');
            assert.ok(result.channelSends.some(payload => typeof payload.content === 'string' && payload.content.includes('Additional image')));
        });
    });
}

test('simple: all/off keeps the original batch request untouched', async () => {
    await withServer(async server => {
        const result = await runCommand({
            commandName: 'simple',
            server,
            bulkSize: 4,
            parseImageCountResult: { bulk_size: 4, batch_count: 2, batch_size: 2 },
            settings: { image_prompt_quality: 'standard', image_prompt_batch: 'all', image_prompt_style: 'tags' },
            enrichment: {
                prompts: [`${ORIGINAL_PROMPT}, shared detail`],
                perImage: false,
                style: 'tags',
                quality: 'standard',
            },
            responsePaths: ['/grid.png', '/one.png', '/two.png', '/three.png'],
        });

        assert.equal(result.posts.length, 1);
        assert.equal(result.getDataBodyCalls.length, 1);
        assert.deepEqual(result.getDataBodyCalls.map(args => [args[35], args[36]]), [[2, 2]]);
        assert.equal(result.getDataBodyCalls[0][1], `${PROCESSED_PROMPT}, shared detail`);
        assert.equal(result.posts[0].payload.session_hash, result.getDataBodyCalls[0][8]);
        assert.doesNotMatch(result.posts[0].payload.session_hash, /-image-/);
        assert.equal(result.collector.stopped, true);
        assert.deepEqual(server.abortRequests, []);
    });
});

test('advanced: all/off keeps the original batch request untouched', async () => {
    await withServer(async server => {
        const result = await runCommand({
            commandName: 'advanced',
            server,
            bulkSize: 4,
            parseImageCountResult: { bulk_size: 4, batch_count: 2, batch_size: 2 },
            settings: { image_prompt_quality: 'standard', image_prompt_batch: 'all', image_prompt_style: 'tags' },
            enrichment: {
                prompts: [`${ORIGINAL_PROMPT}, shared detail`],
                perImage: false,
                style: 'tags',
                quality: 'standard',
            },
            responsePaths: ['/grid.png', '/one.png', '/two.png', '/three.png'],
        });

        assert.equal(result.posts.length, 1);
        assert.equal(result.getDataBodyCalls.length, 1);
        assert.deepEqual(result.getDataBodyCalls.map(args => [args[35], args[36]]), [[2, 2]]);
        assert.doesNotMatch(result.posts[0].payload.session_hash, /-image-/);
        assert.equal(result.collector.stopped, true);
        assert.deepEqual(server.abortRequests, []);
    });
});

for (const commandName of ['simple', 'advanced']) {
    test(`${commandName}: enhancer refusal mutates no model and submits nothing`, async () => {
        await withServer(async server => {
            const result = await runCommand({
                commandName,
                server,
                bulkSize: 2,
                enrichError: new Error('enhancer blocked the request'),
            });

            assert.equal(result.events.some(event => event.type === 'lock-acquire'), false);
            assert.equal(result.events.some(event => event.type === 'model-change'), false);
            assert.equal(result.posts.length, 0);
            assert.equal(result.getDataBodyCalls.length, 0);
            const last = result.edits[result.edits.length - 1];
            assert.match(String(last.content), /Image prompt enhancement failed: enhancer blocked the request/);
            assert.match(String(last.content), /not started/);
            assert.equal(result.collector.stopped, false);
            await sleep(25);
            assert.deepEqual(server.abortRequests, []);
        });
    });
}

test('per-image progress polling uses the per-variant task id and never the abort endpoint', async () => {
    await withServer(async server => {
        const result = await runCommand({
            commandName: 'simple',
            server,
            bulkSize: 2,
            enrichment: enrichmentForEach(ORIGINAL_PROMPT, 2),
        });

        // Result image downloads keep the interaction busy past the first
        // progress poll, so the poll observes the latest per-variant id.
        assert.ok(server.progressRequests.length >= 1, 'progress poll occurred');
        const taskIds = server.progressRequests.map(request => request.id_task);
        assert.ok(taskIds.some(id => /-image-2\)$/.test(id)), String(taskIds));
        assert.ok(taskIds.every(id => id !== `task(${result.posts[0].payload.session_hash})`));
        assert.deepEqual(server.abortRequests, []);
        assert.equal(result.collector.stopped, true);
    });
});

for (const commandName of ['simple', 'advanced']) {
    test(`${commandName}: a text/plain progress 504 does not fail the command`, async () => {
        await withServer(async server => {
            const result = await runCommand({
                commandName,
                server,
                bulkSize: 2,
                enrichment: enrichmentForEach(ORIGINAL_PROMPT, 2),
            });

            assert.ok(server.progressFailures >= 1, 'the injected non-JSON progress failure was served');
            assert.ok(result.posts.length >= 1, 'the generation request still ran');
            assert.equal(
                result.edits.some(edit => /Error while creating image/.test(String(edit.content))),
                false,
                'the progress parse failure must not surface as a command error',
            );
        }, { failFirstProgress: true });
    });
}
