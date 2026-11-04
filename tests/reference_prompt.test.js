'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseInstructionResponse,
    preserveControlTokens,
    controlTokens,
    systemPrompt,
    rewriteAnimaEditPrompt,
    rewriteEditInstruction,
} = require('../utils/reference_prompt');
const {
    prepareReferencePromptWithLLM,
} = require('../utils/forge_reference');
const {
    model_selection_qwen21,
    model_selection_moss,
    model_selection_krea,
    model_selection_flux_klein_9b,
} = require('../utils/ai_server_config');

const ANIMA = 'anima-base-v1.safetensors';
const MOSS = model_selection_moss[0].value;
const QWEN = model_selection_qwen21[0].value;
const KREA = model_selection_krea[0].value;
const KLEIN = model_selection_flux_klein_9b[0].value;
const TWO_IMAGES = [Buffer.from('first'), Buffer.from('second')];

function fakeProvider(responses) {
    const requests = [];
    let index = 0;
    return {
        requests,
        async generate(request) {
            requests.push(request);
            const value = responses[Math.min(index, responses.length - 1)];
            index += 1;
            if (value instanceof Error) throw value;
            return {
                text: typeof value === 'string' ? value : JSON.stringify(value),
                finishReason: 'stop',
                providerMeta: { instanceId: 'unsloth-gpu0' },
            };
        },
    };
}

test('parses a fenced Anima instruction response and rejects empty values', () => {
    assert.equal(
        parseInstructionResponse('```json\n{"instruction":"Change the dress to red."}\n```'),
        'Change the dress to red.',
    );
    assert.throws(() => parseInstructionResponse('not json'), /no JSON object/);
    assert.throws(() => parseInstructionResponse('{"instruction":"  "}'), /empty instruction/);
});

test('preserves LoRA, wildcard, and profile tokens missing from the rewrite', () => {
    const original = 'make her dress red <lora:style:0.6> __outfit__ %%profile%%';
    assert.deepEqual(controlTokens(original), ['<lora:style:0.6>', '__outfit__', '%%profile%%']);
    assert.equal(
        preserveControlTokens('Change the dress to red.', original),
        'Change the dress to red. <lora:style:0.6> __outfit__ %%profile%%',
    );
    assert.equal(
        preserveControlTokens('Change the dress to red. <lora:style:0.6> __outfit__ %%profile%%', original),
        'Change the dress to red. <lora:style:0.6> __outfit__ %%profile%%',
    );
});

test('family prompts make MOSS requests concrete and keep Anima instruction-focused', () => {
    assert.match(systemPrompt('moss'), /concrete visual descriptions/);
    assert.match(systemPrompt('moss'), /removed or replaced/);
    assert.match(systemPrompt('anima'), /direct natural-language instruction/);
});

test('multi-reference prompts use the target model image-index syntax', () => {
    const qwen = systemPrompt('qwen21', { layout: 'native', referenceCount: 2 });
    assert.match(qwen, /<image1>, <image2>/);
    assert.match(qwen, /Never use \[image 1\]/);
    const krea = systemPrompt('krea', { layout: 'native', referenceCount: 2 });
    assert.match(krea, /image 1, image 2/);
    assert.doesNotMatch(krea, /<image1>/);
    const panels = systemPrompt('klein', { layout: 'horizontal', referenceCount: 2 });
    assert.match(panels, /left-to-right/);
    assert.match(panels, /panels by position/);
});

test('rewrites a MOSS request with Qwen and names the target family', async () => {
    const provider = fakeProvider([{ instruction: 'Replace her outfit with a white t-shirt and blue jeans, removing the maid headdress and apron.' }]);
    const result = await rewriteEditInstruction(
        { prompt: 'change her to casual clothes', images: [], family: 'moss' },
        { provider, unload: false, retryInvalid: false },
    );
    assert.match(result, /white t-shirt/);
    assert.match(provider.requests[0].messages[0].content, /MOSS-Image Edit/);
    assert.match(provider.requests[0].messages[1].content[0].text, /MOSS-Image/);
});

test('rewrites an Anima request with Qwen and returns the instruction', async () => {
    const provider = fakeProvider([{ instruction: 'Change the dress to a vivid red color.' }]);
    const result = await rewriteAnimaEditPrompt(
        { prompt: 'make her dress red', images: [] },
        { provider, unload: false, retryInvalid: false },
    );
    assert.equal(result, 'Change the dress to a vivid red color.');
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0].instanceId, 'unsloth-gpu0');
    assert.match(provider.requests[0].messages[0].content, /Anima Edit/);
    assert.match(provider.requests[0].messages[1].content[0].text, /make her dress red/);
});

test('retries once when the Anima instruction response is invalid', async () => {
    const provider = fakeProvider(['not json', { instruction: 'Change the dress to red.' }]);
    const result = await rewriteAnimaEditPrompt(
        { prompt: 'make her dress red' },
        { provider, unload: false, retryInvalid: true },
    );
    assert.equal(provider.requests.length, 2);
    assert.equal(result, 'Change the dress to red.');
    assert.match(provider.requests[1].messages.at(-1).content, /That response was invalid/);
});

test('prepareReferencePromptWithLLM rewrites Anima/MOSS and multi-reference Qwen/Krea/Klein', async () => {
    const calls = [];
    const deps = {
        rewriteAnimaEditPrompt: async input => {
            calls.push(input);
            return 'Change the dress to red.';
        },
    };

    const anima = await prepareReferencePromptWithLLM('make her dress red', ANIMA, {}, deps);
    assert.equal(anima, 'Change the dress to red. Keep the character, pose, and background unchanged. <lora:AnimeEditV2:1>');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, 'make her dress red');
    assert.equal(calls[0].family, 'anima');

    const moss = await prepareReferencePromptWithLLM('change her to casual clothes', MOSS, {}, deps);
    assert.equal(moss, 'Change the dress to red. Keep the character, pose, and background unchanged. <lora:moss_image_edit_lora_rank_64_bf16:1>');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].family, 'moss');

    const qwenSingle = await prepareReferencePromptWithLLM('a cat', QWEN, {}, deps);
    assert.equal(qwenSingle, 'a cat');
    assert.equal(calls.length, 2);

    const qwenMulti = await prepareReferencePromptWithLLM(
        'put the character from [image 1] into the outfit and pose from [image 2]',
        QWEN,
        { images: TWO_IMAGES },
        deps,
    );
    assert.equal(
        qwenMulti,
        'Change the dress to red. Apply only the requested changes and preserve the attributes that should stay unchanged.',
    );
    assert.equal(calls.length, 3);
    assert.equal(calls[2].family, 'qwen21');
    assert.equal(calls[2].referenceCount, 2);

    const kreaMulti = await prepareReferencePromptWithLLM(
        'put the character from image 1 into the outfit and pose from image 2',
        KREA,
        { images: TWO_IMAGES },
        deps,
    );
    assert.equal(
        kreaMulti,
        'Change the dress to red. Apply only the requested changes and preserve the attributes that should stay unchanged. <lora:krea2_general_edit_v2:1>',
    );
    assert.equal(calls[3].family, 'krea');

    const kleinMulti = await prepareReferencePromptWithLLM(
        'put the character from image 1 into the outfit and pose from image 2',
        KLEIN,
        { images: TWO_IMAGES, layout: 'horizontal' },
        deps,
    );
    assert.equal(
        kleinMulti,
        'Change the dress to red. Apply only the requested changes and preserve the attributes that should stay unchanged.',
    );
    assert.equal(calls[4].family, 'klein');
    assert.equal(calls[4].layout, 'horizontal');
});
