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
const { model_selection_qwen21, model_selection_moss } = require('../utils/ai_server_config');

const ANIMA = 'anima-base-v1.safetensors';
const MOSS = model_selection_moss[0].value;
const QWEN = model_selection_qwen21[0].value;

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

test('prepareReferencePromptWithLLM rewrites Anima and MOSS but skips other families', async () => {
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

    const qwen = await prepareReferencePromptWithLLM('a cat', QWEN, {}, deps);
    assert.equal(qwen, 'a cat');
    assert.equal(calls.length, 2);
});
