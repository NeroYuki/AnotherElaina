const test = require('node:test');
const assert = require('node:assert/strict');
const { buildH3Workflow, videoShape, H3_MODELS } = require('../utils/comfy_media');
const { mediaKind, prepareVideoReference } = require('../utils/video_reference');
const { enrichVideoPrompt, scriptPrompt, QUALITIES } = require('../utils/video_prompt');

test('Turbo selects matching adapter shifts; base and hybrid sampling never use a mismatched adapter or cache', () => {
    for (const [width, height, lora, shift] of [[768, 448, H3_MODELS.turbo, 12], [1344, 768, H3_MODELS.turbo768, 6], [768, 1344, H3_MODELS.turbo768, 6]]) {
        const graph = buildH3Workflow({ prompt: 'Bird flying.', shape: videoShape(width, height), seed: 0, upscale: false });
        assert.equal(graph.turbo.inputs.lora_name, lora);
        assert.equal(graph.shift.inputs.shift_video, shift);
        assert.equal(graph.shift.inputs.shift_audio, 3);
        assert.equal(graph['105:9'].inputs.steps, 8);
        assert.equal(graph['105:17'].inputs.sampler_name, 'euler');
        assert.equal(graph['105:120'].inputs.attention, 'comfy kitchen attention');
        assert.equal(graph['105:10'].class_type, 'VAEDecodeTiled');
        assert.ok(!Object.values(graph).some(node => /EasyCache|Spectrum|Sage/.test(node.class_type)));
    }
    const base = buildH3Workflow({ prompt: 'Bird flying.', shape: videoShape(768, 448), optimize: false });
    assert.equal(base.turbo, undefined);
    assert.equal(base['105:9'].inputs.steps, 20);
});

test('extended clips preserve the total frame grid, bound each sampler, and trim context exactly once', () => {
    for (let seconds = 16; seconds <= 60; seconds++) {
        const shape = videoShape(768, 448, seconds);
        assert.equal(shape.length % 17, 5);
        assert.ok(shape.seconds >= seconds && shape.seconds < seconds + 17 / 24);
        assert.equal(shape.segments.reduce((sum, segment) => sum + segment.visibleFrames, 0), shape.length);
        for (const [index, segment] of shape.segments.entries()) {
            assert.equal(segment.length % 17, 5);
            assert.ok(segment.length <= 124);
            assert.equal(segment.trim, index ? 22 : 0);
            assert.equal(segment.length - segment.trim, segment.visibleFrames);
        }
    }
    assert.throws(() => videoShape(768, 448, 61), /1–60/);
});

test('extended reference workflows retain hybrid models, both boundary anchors, native audio, and streaming upscale', () => {
    for (const kind of ['image', 'video', 'audio']) {
        const shape = videoShape(768, 448, 20);
        const graph = buildH3Workflow({ prompt: shape.segments.map((_, i) => `Clip ${i + 1}`), shape, seed: Number.MAX_SAFE_INTEGER,
            image: { name: 'first.png' }, lastImage: { name: 'last.png' },
            reference: { kind, duration: 20, hasAudio: kind === 'video', upload: { name: 'ref' } } });
        assert.equal(graph['105:6'].inputs.unet_name, H3_MODELS.hybrid);
        assert.equal(graph.turbo, undefined);
        assert.equal(graph['105:120'].inputs.attention, 'comfy kitchen attention');
        assert.ok(graph.clip1_input_image_guide);
        assert.ok(!graph.clip2_input_image_guide);
        assert.deepEqual(graph.last_image_guide.inputs.positive, [`clip${shape.segments.length}_motion`, 0]);
        assert.equal(graph.last_image_guide.inputs.frame_idx, -1);
        assert.equal(graph['clip2_105:15'].inputs.noise_seed, 0);
        assert.equal(graph.final_decode.inputs.audio_vae[0], '105:24');
        assert.equal(graph.stream_upscale.class_type, 'ElainaRTXVideoUpscale');
        assert.deepEqual(graph['92'].inputs.video, ['stream_upscale', 0]);
        if (kind === 'video') {
            assert.equal(graph.reference.inputs.frame_load_cap, 360);
            assert.deepEqual(graph['clip2_105:104'].inputs['ref_video_audios.ref_video_audio_0'], ['reference', 2]);
        }
        if (kind === 'audio') {
            assert.equal(graph.clip2_audio_window.inputs.start_index, (124 - 22) / 24);
            assert.deepEqual(graph['clip2_105:104'].inputs['ref_audios.ref_audio_0'], ['clip2_audio_window', 0]);
        }
        for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) {
            if (Array.isArray(value)) assert.ok(graph[value[0]], `Missing ${value[0]}`);
        }
    }
});

test('extended standalone audio omits exhausted windows and reuses short sound references', () => {
    const shape = videoShape(768, 448, 20);
    for (const duration of [2, 7]) {
        const graph = buildH3Workflow({ prompt: 'Bird flying', shape, upscale: false,
            reference: { kind: 'audio', duration, upload: { name: 'audio.wav' } } });
        for (const [index, segment] of shape.segments.entries()) {
            const start = Math.max(0, segment.startSeconds - segment.trim / 24);
            const conditioning = graph[`clip${index + 1}_105:104`].inputs;
            if (duration === 7 && start >= duration) assert.equal(conditioning['ref_audios.ref_audio_0'], undefined);
            else assert.equal(graph[`clip${index + 1}_audio_window`].inputs.start_index, duration === 2 ? 0 : start);
        }
    }
});

test('extended enrichment scripts each clip separately, preserves boundary guides, and verifies LLM unload', async () => {
    const shape = videoShape(768, 448, 20);
    let unloaded = false;
    const profile = QUALITIES.standard;
    const result = await enrichVideoPrompt({ prompt: 'A bird flies for twenty seconds', shape, quality: 'standard',
        images: [Buffer.from('first'), Buffer.from('last')] }, {
        provider: { async generate(options) {
            assert.match(options.messages[1].content[0].text, /exactly 5 audiovisual scripts/);
            assert.equal(options.responseSchema.properties.clips.minItems, shape.segments.length);
            return { providerMeta: { instanceId: profile.instanceId }, text: JSON.stringify({ clips: shape.segments.map(() => ({
                integrated_multimodal_description: '[Shot 1] A blue bird flies forward.', overall_soundscape: 'Wind.', non_diegetic_music: 'N/A',
            })) }) };
        } },
        fetchImpl: async (_url, options) => {
            if (options?.method === 'POST') unloaded = true;
            return Response.json({ loaded: unloaded ? [] : [profile.model], loading: [] });
        },
    });
    assert.equal(result.length, shape.segments.length);
    assert.match(result[0], /opening frame/);
    assert.doesNotMatch(result[1], /opening frame|ending frame/);
    assert.match(result.at(-1), /ending frame/);
    assert.equal(unloaded, true);
});

test('all reference types select hybrid, wire native autogrow sockets, and preserve both independent frame guides', () => {
    for (const [kind, hasAudio, key, output] of [['image', false, 'ref_images.ref_image_0', 0],
        ['video', false, 'ref_videos.ref_video_0', 0], ['video', true, 'ref_videos.ref_video_0', 0], ['audio', false, 'ref_audios.ref_audio_0', 0]]) {
        const graph = buildH3Workflow({ prompt: 'Follow reference.', shape: videoShape(768, 448),
            image: { name: 'first.png' }, lastImage: { name: 'last.png' },
            reference: { kind, hasAudio, upload: { name: 'reference', subfolder: 'refs' } } });
        assert.equal(graph['105:6'].inputs.unet_name, H3_MODELS.hybrid);
        assert.equal(graph.turbo, undefined);
        assert.equal(graph['105:9'].inputs.steps, 20);
        assert.equal(graph['105:104'].class_type, 'MiniMaxH3ReferenceToVideo');
        assert.equal(graph['105:104'].inputs.ref_image_size, 'match');
        assert.deepEqual(graph['105:104'].inputs[key], ['reference', output]);
        assert.equal(!!graph['105:104'].inputs['ref_video_audios.ref_video_audio_0'], hasAudio);
        assert.equal(graph.input_image_guide.inputs.frame_idx, 0);
        assert.equal(graph.last_image_guide.inputs.frame_idx, -1);
        assert.deepEqual(graph.last_image_guide.inputs.positive, ['input_image_guide', 0]);
        assert.deepEqual(graph['105:16'].inputs.conditioning, ['last_image_guide', 0]);
        for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) {
            if (Array.isArray(value)) assert.ok(graph[value[0]], `Missing ${value[0]}`);
        }
    }
});

test('reference attachment detection rejects unrelated files; preparation checks real content and bounds uploads', async () => {
    for (const [name, type] of [['photo.webp', 'image'], ['clip.mov', 'video'], ['speech.m4a', 'audio']]) assert.equal(mediaKind({ name }), type);
    assert.throws(() => mediaKind({ name: 'program.exe' }), /image, video, or audio/);
    await assert.rejects(prepareVideoReference({ name: 'clip.mp4', size: 201 * 1024 * 1024 }, videoShape(768, 448)), /200 MiB/);
    await assert.rejects(prepareVideoReference({ name: 'photo.png' }, videoShape(768, 448), { buffer: Buffer.from('not an image') }), /unsupported image format/);
    const sharp = require('sharp');
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: 'red' } }).png().toBuffer();
    const result = await prepareVideoReference({ name: 'photo.png' }, videoShape(768, 448), { buffer: png, upload: async (_buffer, name, mime) => {
        assert.equal(mime, 'image/png'); return { name };
    } });
    assert.equal(result.previews.length, 1);
    assert.match(result.promptContext, /not an opening or ending frame/);
});

test('CPU reference preparation bounds duration by the actual stream, samples previews, and omits absent soundtracks', async () => {
    const fs = require('fs/promises');
    const sharp = require('sharp');
    const preview = await sharp({ create: { width: 64, height: 48, channels: 3, background: 'blue' } }).png().toBuffer();
    for (const [kind, sound] of [['video', true], ['video', false], ['audio', true]]) {
        const calls = [];
        const result = await prepareVideoReference({ name: `ref.${kind === 'video' ? 'mp4' : 'wav'}` }, videoShape(768, 448), {
            buffer: Buffer.from('source'), upload: async (data, name) => { assert.ok(data.length); return { name }; },
            execute: async (_program, args, options) => {
                calls.push(args);
                assert.equal(options.windowsHide, true);
                if (args.includes('-show_streams')) return { stdout: JSON.stringify({ format: { duration: 30 }, streams: [
                    ...(kind === 'video' ? [{ codec_type: 'video', duration: '2' }] : []),
                    ...(sound ? [{ codec_type: 'audio', duration: '30' }] : []),
                ] }) };
                await fs.writeFile(args.at(-1), args.at(-1).endsWith('.jpg') ? preview : Buffer.from('normalized'));
                return { stdout: '' };
            },
        });
        const args = calls[1];
        assert.equal(result.duration, kind === 'video' ? 2 : videoShape(768, 448).seconds);
        assert.equal(result.hasAudio, kind === 'video' && sound);
        assert.equal(result.previews.length, kind === 'video' ? 3 : 0);
        assert.equal(args.includes('-an'), kind === 'video' && !sound);
        if (sound) assert.ok(args.includes('32000'));
        await assert.rejects(fs.stat(calls[0].at(-1)), { code: 'ENOENT' });
    }
});

test('long audio preparation retains the full timeline while video references retain their existing cap', async () => {
    const fs = require('fs/promises');
    for (const kind of ['audio', 'video']) {
        const result = await prepareVideoReference({ name: kind === 'audio' ? 'ref.wav' : 'ref.mp4' }, videoShape(768, 448, 30), {
            vision: false, buffer: Buffer.from('source'), upload: async () => ({ name: 'ref' }),
            execute: async (_program, args) => {
                if (args.includes('-show_streams')) return { stdout: JSON.stringify({ streams: [
                    { codec_type: 'video', duration: '45' }, { codec_type: 'audio', duration: '45' },
                ] }) };
                await fs.writeFile(args.at(-1), 'normalized');
                return { stdout: '' };
            },
        });
        assert.equal(result.duration, kind === 'audio' ? videoShape(768, 448, 30).seconds : 15);
    }
});

test('reference enrichment separates preview identifiers from anchors and never treats audio metadata as heard content', async () => {
    const script = JSON.stringify({ integrated_multimodal_description: '[Shot 1] A bird from <Picture 1> flies.', overall_soundscape: 'Wind.', non_diegetic_music: 'N/A' });
    const profile = QUALITIES.standard;
    for (const kind of ['image', 'video', 'audio']) {
        let body;
        const reference = { kind, previews: kind === 'audio' ? [] : [Buffer.from('preview')], promptContext: `Reference ${kind}; rewriter cannot hear audio.` };
        const result = await enrichVideoPrompt({ prompt: 'Follow the reference', shape: videoShape(768, 448), quality: 'standard',
            images: [Buffer.from('opening'), Buffer.from('ending')], reference }, {
            provider: { async generate(options) { body = options; return { text: script, providerMeta: { instanceId: profile.instanceId } }; } },
            fetchImpl: async () => Response.json({ loaded: [], loading: [] }),
        });
        assert.match(body.messages[1].content[0].text, /Ref2VA with opening\/ending frame guides/);
        assert.match(body.messages[1].content[1].text, /^Frame guide:/);
        assert.match(result, /^The supplied opening frame anchors.*ending frame anchors/);
        assert.doesNotMatch(result, /Picture 2.*aligns/);
        assert.match(body.messages[0].content, /you cannot hear it/);
    }
    assert.ok(!scriptPrompt(script, 5.17, 0, { kind: 'image' }).startsWith('For the target video'));
});

test('three commands pass references to both enrichment and workflow, and preparation errors prevent GPU submission', async t => {
    const refs = require('../utils/video_reference');
    const prompts = require('../utils/video_prompt');
    const media = require('../utils/comfy_media');
    const comfy = require('../utils/comfy_client');
    const loader = require('../utils/load_discord_img');
    const sharp = require('sharp');
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: 'blue' } }).png().toBuffer();
    let reference, expectedModel, fail = false, submitted = 0;
    t.mock.method(refs, 'prepareVideoReference', async attachment => { assert.equal(attachment.name, 'ref'); if (fail) throw new Error('Bad reference'); return reference; });
    t.mock.method(prompts, 'enrichVideoPrompt', async args => { assert.equal(args.reference, reference); return 'Prepared script'; });
    t.mock.method(comfy, 'uploadImage', async () => ({ name: 'image.png' }));
    t.mock.method(loader, 'loadImage', async () => png);
    t.mock.method(media, 'runVideo', async (_interaction, graph) => { submitted++; assert.equal(graph['105:6'].inputs.unet_name, expectedModel); });
    for (const name of ['wd_txt2vid', 'wd_img2vid', 'wd_ref2vid']) {
        expectedModel = name === 'wd_ref2vid' ? H3_MODELS.reference : H3_MODELS.hybrid;
        const location = require.resolve(`../commands/${name}`);
        delete require.cache[location];
        const command = require(location);
        for (const kind of ['image', 'video', 'audio']) {
            reference = { kind, upload: { name: 'reference' }, hasAudio: kind === 'video' };
            let message;
            const interaction = { deferReply: async () => {}, editReply: async payload => { message = payload.content; }, options: {
                getString: key => key === 'prompt' ? 'Idea' : null, getInteger: () => null, getBoolean: () => false, getNumber: () => 0,
                getAttachment: key => ({ name: key, url: 'https://example.com/test.png' }),
            } };
            fail = false;
            await command.execute(interaction);
            const before = submitted;
            fail = true;
            await command.execute(interaction);
            assert.equal(submitted, before);
            assert.match(message, /Bad reference/);
        }
        delete require.cache[location];
    }
    assert.equal(submitted, 9);
});
