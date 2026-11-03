'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    runImagePromptBatch,
    mergeBatchResponses,
    isImagePromptBatchCancelled,
    ImagePromptBatchCancelled,
} = require('../utils/image_prompt_batch');

function images(...paths) {
    return paths.map(path => ({ image: { path } }));
}

function response(paths, { metadata = {}, duration = 1, status = 200 } = {}) {
    return {
        status,
        data: {
            data: [ { value: images(...paths) }, null, JSON.stringify(metadata) ],
            duration,
        },
    };
}

test('all/off sends exactly one unchanged request with the original session', async () => {
    const expected = response(['/tmp/grid.png', '/tmp/a.png', '/tmp/b.png'], {
        metadata: { seed: 7, sd_model_hash: 'hash', sd_model_name: 'model' }, duration: 4,
    });
    const sent = [], tasks = [];
    const result = await runImagePromptBatch({
        plan: { prompts: ['processed base, shared addition'], perImage: false },
        count: 5,
        seed: 42,
        sessionHash: 'session-a',
        buildRequest: args => ({ marker: 'request', ...args }),
        send: async request => { sent.push(request); return expected; },
        onTask: task => tasks.push(task),
    });

    assert.equal(result, expected);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], {
        marker: 'request', prompt: 'processed base, shared addition', seed: 42,
        sessionHash: 'session-a', index: 0, perImage: false,
    });
    assert.deepEqual(tasks, [ { sessionHash: 'session-a', index: 0, seed: 42, perImage: false } ]);
});

test('each sends count sequential single-image requests with distinct prompts, sessions and seeds', async () => {
    const prompts = ['base, one', 'base, two', 'base, three'];
    const sent = [], tasks = [];
    let inFlight = false;
    const result = await runImagePromptBatch({
        plan: { prompts, perImage: true },
        count: 3,
        seed: 100,
        sessionHash: 'root',
        buildRequest: args => ({ ...args }),
        send: async request => {
            assert.equal(inFlight, false, 'requests must be sequential');
            inFlight = true;
            sent.push(request);
            const index = sent.length;
            const reply = response([`/tmp/img-${index}.png`], {
                metadata: {
                    seed: request.seed,
                    sd_model_hash: `hash-${index}`,
                    sd_model_name: `model-${index}`,
                    all_prompts: [request.prompt],
                    all_seeds: [request.seed],
                },
                duration: index,
            });
            inFlight = false;
            return reply;
        },
        onTask: task => tasks.push(task),
    });

    assert.deepEqual(sent.map(request => request.prompt), prompts);
    assert.deepEqual(sent.map(request => request.sessionHash), [
        'root-image-1', 'root-image-2', 'root-image-3',
    ]);
    assert.deepEqual(sent.map(request => request.seed), [100, 101, 102]);
    assert.deepEqual(tasks.map(task => task.sessionHash), [
        'root-image-1', 'root-image-2', 'root-image-3',
    ]);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.data[0].value.map(item => item.image.path), [
        '/tmp/img-1.png', '/tmp/img-2.png', '/tmp/img-3.png',
    ]);
    assert.equal(result.data.duration, 6);
    const metadata = JSON.parse(result.data.data[2]);
    assert.equal(metadata.seed, 100);
    assert.equal(metadata.index_of_first_image, 0);
    assert.deepEqual(metadata.all_prompts, prompts);
    assert.deepEqual(metadata.all_seeds, [100, 101, 102]);
});

test('random seeds stay random for every per-image request', async () => {
    const seeds = [];
    await runImagePromptBatch({
        plan: { prompts: ['a', 'b'], perImage: true },
        count: 2,
        seed: -1,
        sessionHash: 'root',
        buildRequest: args => args,
        send: async request => {
            seeds.push(request.seed);
            return response(['/tmp/x.png']);
        },
    });
    assert.deepEqual(seeds, [-1, -1]);
});

test('per-image PiD batches keep only the final upscaled image from each request', async () => {
    const replies = [
        response(['/tmp/base-1.png', '/tmp/pid-1.png'], {
            metadata: { seed: 1, all_prompts: ['one'], all_seeds: [1] }, duration: 2,
        }),
        response(['/tmp/base-2.png', '/tmp/pid-2.png'], {
            metadata: { seed: 2, all_prompts: ['two'], all_seeds: [2] }, duration: 3,
        }),
    ];
    const result = await runImagePromptBatch({
        plan: { prompts: ['one', 'two'], perImage: true },
        count: 2,
        seed: 1,
        sessionHash: 'root',
        buildRequest: args => ({ ...args }),
        send: async () => replies.shift(),
        pidImagesPerRequest: 1,
    });

    assert.deepEqual(result.data.data[0].value.map(item => item.image.path), [
        '/tmp/pid-1.png', '/tmp/pid-2.png',
    ]);
    assert.deepEqual(JSON.parse(result.data.data[2]).all_seeds, [1, 2]);
    assert.equal(result.data.duration, 5);
    await assert.rejects(
        runImagePromptBatch({
            plan: { prompts: ['one'], perImage: true },
            count: 1,
            seed: 1,
            sessionHash: 'root',
            buildRequest: args => ({ ...args }),
            send: async () => response(['/tmp/base.png']),
            pidImagesPerRequest: 2,
        }),
        /fewer PiD images/,
    );
});


test('DAAM heatmaps are grouped first, grids are dropped, and actual images are concatenated', () => {
    const merged = mergeBatchResponses([
        response(['/tmp/h1.png', '/tmp/h2.png', '/tmp/grid1.png', '/tmp/a.png'], {
            metadata: { index_of_first_image: 3, all_prompts: ['a'], all_seeds: [1], seed: 1 },
            duration: 2,
        }),
        response(['/tmp/h3.png', '/tmp/h4.png', '/tmp/grid2.png', '/tmp/b.png'], {
            metadata: { index_of_first_image: 3, all_prompts: ['b'], all_seeds: [2], seed: 2 },
            duration: 3,
        }),
    ], 2);

    assert.deepEqual(merged.data.data[0].value.map(item => item.image.path), [
        '/tmp/h1.png', '/tmp/h2.png', '/tmp/h3.png', '/tmp/h4.png',
        '/tmp/a.png', '/tmp/b.png',
    ]);
    assert.equal(merged.data.duration, 5);
    const metadata = JSON.parse(merged.data.data[2]);
    assert.equal(metadata.index_of_first_image, 4);
    assert.deepEqual(metadata.all_prompts, ['a', 'b']);
    assert.deepEqual(metadata.all_seeds, [1, 2]);
    assert.equal(metadata.seed, 1);
});

test('a grid identified by index_of_first_image is dropped', () => {
    const merged = mergeBatchResponses([
        response(['/tmp/grid.png', '/tmp/actual.png'], {
            metadata: { index_of_first_image: 1 },
        }),
    ], 0);
    assert.deepEqual(merged.data.data[0].value.map(item => item.image.path), ['/tmp/actual.png']);
});

test('invalid successful payloads are rejected instead of silently dropping images', () => {
    assert.throws(() => mergeBatchResponses([{
        status: 200, data: { data: [ { value: [] } ], duration: 1 },
    }]), /no image paths/);
    assert.throws(() => mergeBatchResponses([{
        status: 200, data: { data: [ { value: images('/tmp/h.png') } ], duration: 1 },
    }], 2), /fewer images than the expected DAAM heatmaps/);
    assert.throws(() => mergeBatchResponses([{
        status: 200, data: { data: [ { value: images('/tmp/h.png', '/tmp/grid.png') }, null, JSON.stringify({ index_of_first_image: 2 }) ], duration: 1 },
    }], 1), /no images after its grid/);
    assert.throws(() => mergeBatchResponses([response(['/tmp/a.png'], { status: 500 })]), /status 500/);
    assert.throws(() => mergeBatchResponses([{
        status: 200, data: { data: [ { value: images('/tmp/a.png') }, null, '{bad' ] },
    }]), /invalid metadata JSON/);
});

test('cancellation before the next submission stops remaining variants', async () => {
    let checks = 0, sends = 0;
    await assert.rejects(runImagePromptBatch({
        plan: { prompts: ['a', 'b', 'c'], perImage: true },
        count: 3,
        seed: 1,
        sessionHash: 'root',
        buildRequest: args => args,
        send: async () => { sends++; return response(['/tmp/x.png']); },
        shouldCancel: () => ++checks >= 4,
    }), isImagePromptBatchCancelled);
    assert.equal(sends, 1);
});

test('a transport error rejects immediately and does not submit later variants', async () => {
    const sent = [];
    await assert.rejects(runImagePromptBatch({
        plan: { prompts: ['a', 'b', 'c'], perImage: true },
        count: 3,
        seed: 1,
        sessionHash: 'root',
        buildRequest: args => args,
        send: async request => {
            sent.push(request);
            if (sent.length === 2) throw new Error('transport failed');
            return response(['/tmp/x.png']);
        },
    }), /transport failed/);
    assert.deepEqual(sent.map(request => request.prompt), ['a', 'b']);
});

test('mis-sized plans and explicit cancellation errors are rejected before transport', async () => {
    let sends = 0;
    await assert.rejects(runImagePromptBatch({
        plan: { prompts: ['a', 'b'], perImage: true },
        count: 3,
        seed: 1,
        sessionHash: 'root',
        buildRequest: args => args,
        send: async () => { sends++; return response(['/tmp/x.png']); },
    }), /expected 3 prepared prompts, received 2/);
    assert.equal(sends, 0);

    assert.equal(isImagePromptBatchCancelled(new ImagePromptBatchCancelled()), true);
    assert.equal(isImagePromptBatchCancelled(new Error('other')), false);
});
