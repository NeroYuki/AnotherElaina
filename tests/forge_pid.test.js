const test = require('node:test')
const assert = require('node:assert/strict')

const {
    PID_UPSCALER,
    PID_LEGACY_UPSCALER,
    PID_CHECKPOINT,
    PID_VAE,
    PID_TEXT_ENCODER,
    PID_POSTPASS_CANCELLED,
    PID_POSTPASS_RESTORE_FAILED,
    is_pid_upscaler,
    prepare_pid_upscale,
    strip_lora_tags,
    build_postpass_request,
    run_pid_postpass,
} = require('../utils/forge_pid')

const SDXL_MODEL = 'wai_nsfw_illustrious_v120.safetensors'
const FLUX_MODEL = 'flux1-dev-Q8_0.gguf'
const ANIMA_MODEL = 'anima-base-v1.safetensors'

test('PiD aliases only recognise the supported upscaler names', () => {
    assert.equal(PID_UPSCALER, 'PiD')
    assert.equal(is_pid_upscaler(PID_UPSCALER), true)
    assert.equal(is_pid_upscaler(PID_LEGACY_UPSCALER), true)
    assert.equal(is_pid_upscaler('PiD 2x'), false)
    assert.equal(is_pid_upscaler('pid'), false)
    assert.equal(is_pid_upscaler(null), false)
})

test('PiD preparation uses the installed distilled SDXL companions and fixed 4x size', () => {
    const result = prepare_pid_upscale({
        model: SDXL_MODEL,
        width: 768,
        height: 512,
        prompt: 'clean up details',
        degrade_sigma: 0,
        color_correction: false,
    })

    assert.deepEqual(result, {
        enabled: true,
        stage: 'integrated',
        family: 'xl',
        scale: 4,
        checkpoint: PID_CHECKPOINT,
        vae: PID_VAE,
        text_encoder: PID_TEXT_ENCODER,
        prompt: 'clean up details',
        degrade_sigma: 0,
        color_correction: false,
        width: 3072,
        height: 2048,
    })
    assert.equal(PID_CHECKPOINT, 'pid_sdxl_1024_to_4096_4step_bf16 [c8dd35d7d5]')
    assert.equal(PID_VAE, 'sdxl_vae.safetensors')
    assert.equal(PID_TEXT_ENCODER, 'gemma_2_2b_fp16.safetensors')

    assert.equal(prepare_pid_upscale({ model: SDXL_MODEL, width: 1024, height: 1024 }).width, 4096)
    assert.equal(prepare_pid_upscale({ model: SDXL_MODEL, width: 1024, height: 1024 }).height, 4096)
    assert.equal(prepare_pid_upscale({ model: SDXL_MODEL, width: 512, height: 512, degrade_sigma: 0 }).degrade_sigma, 0)
    assert.equal(prepare_pid_upscale({ model: SDXL_MODEL, width: 512, height: 512 }).prompt, '')
    assert.equal(prepare_pid_upscale({ model: SDXL_MODEL, width: 512, height: 512 }).color_correction, true)
})

test('PiD preparation accepts SDXL archive basenames and mapped inpaint checkpoints', () => {
    for (const model of [
        'archive\\realvisxl_v5.safetensors',
        'realvisxl_v5.safetensors',
        'juggernautxl_inpaint.safetensors',
        'realvisxl_v3_inpaint.safetensors',
        'wai_nsfw_illustrious_v120.safetensors [c8dd35d7d5]',
    ]) {
        const result = prepare_pid_upscale({ model, width: 512, height: 512 })
        assert.equal(result.enabled, true, model)
        assert.equal(result.stage, 'integrated', model)
        assert.equal(result.checkpoint, PID_CHECKPOINT, model)
    }
})

test('non-SDXL families select the standalone RGB postpass', () => {
    for (const [model, family] of [
        [FLUX_MODEL, 'flux'],
        [ANIMA_MODEL, 'anima'],
        ['qwen_image_2.1_int8_convrot.safetensors', 'qwen21'],
        ['krea2_turbo_int8_convrot.safetensors', 'krea'],
        ['moss_image_base_bf16.safetensors', 'moss'],
    ]) {
        const result = prepare_pid_upscale({ model, width: 768, height: 512 })
        assert.equal(result.stage, 'postpass', model)
        assert.equal(result.family, family, model)
        assert.equal(result.checkpoint, PID_CHECKPOINT, model)
        assert.equal(result.width, 3072, model)
        assert.equal(result.height, 2048, model)
    }
})

test('PiD preparation rejects unknown and undistilled PiD checkpoints', () => {
    for (const model of [
        'pid_1.5_flux2_1024_to_4096_bf16.safetensors',
        'unknown.safetensors',
        '',
    ]) {
        assert.throws(
            () => prepare_pid_upscale({ model, width: 512, height: 512 }),
            /not in the configured model catalogs/,
            model,
        )
    }
})

test('PiD preparation validates base dimensions, sigma, prompt, and color correction', () => {
    for (const [width, height] of [
        [0, 512], [512, 0], [-8, 512], [1004, 512], [512, 1032], [512.5, 512], ['512', 512],
    ]) {
        assert.throws(
            () => prepare_pid_upscale({ model: SDXL_MODEL, width, height }),
            /positive integer divisible by 8/,
            `${width}x${height}`,
        )
    }

    for (const degrade_sigma of [-0.01, 1.01, Infinity, NaN, 'nope', true, {}]) {
        assert.throws(
            () => prepare_pid_upscale({ model: SDXL_MODEL, width: 512, height: 512, degrade_sigma }),
            /degrade_sigma/,
        )
    }
    assert.equal(prepare_pid_upscale({ model: SDXL_MODEL, width: 512, height: 512, degrade_sigma: '0' }).degrade_sigma, 0)
    assert.equal(prepare_pid_upscale({ model: SDXL_MODEL, width: 512, height: 512, degrade_sigma: 1 }).degrade_sigma, 1)

    assert.throws(
        () => prepare_pid_upscale({ model: SDXL_MODEL, width: 512, height: 512, prompt: 5 }),
        /prompt must be a string/,
    )
    for (const color_correction of [0, 1, 'true', null]) {
        if (color_correction === null) {
            assert.equal(prepare_pid_upscale({ model: SDXL_MODEL, width: 512, height: 512, color_correction }).color_correction, true)
        }
        else {
            assert.throws(
                () => prepare_pid_upscale({ model: SDXL_MODEL, width: 512, height: 512, color_correction }),
                /color_correction must be a boolean/,
            )
        }
    }
})

test('PiD preparation does not mutate the supplied options', () => {
    const options = { model: SDXL_MODEL, width: 512, height: 768, prompt: 'keep', degrade_sigma: 0.25, color_correction: false }
    const original = structuredClone(options)
    prepare_pid_upscale(options)
    assert.deepEqual(options, original)
})

test('PiD postpass strips base-model LoRA tags but keeps ordinary prompt text', () => {
    assert.equal(
        strip_lora_tags('masterpiece,  <lora:anime_style:0.8>  a cat <LYCO:bad>`'),
        'masterpiece, a cat <LYCO:bad>`',
    )
    assert.equal(strip_lora_tags(''), '')
})

test('PiD postpass request uses the fixed LCM-4 standalone settings', () => {
    const data = build_postpass_request({
        attachment: 'data:image/png;base64,AAAA',
        prompt: 'a cat',
        seed: 42,
        sessionHash: 'session',
        width: 4096,
        height: 3072,
    })

    assert.equal(data.length, 310)
    assert.equal(data[17], 1)
    assert.equal(data[18], 1)
    assert.equal(data[19], 1)
    assert.equal(data[20], 1.5)
    assert.equal(data[22], 0)
    assert.equal(data[24], 3072)
    assert.equal(data[25], 4096)
    assert.equal(data[40], 'None')
    assert.equal(data[48], 4)
    assert.equal(data[49], 'LCM')
    assert.equal(data[50], 'Simple')
    assert.equal(data[58], 42)
    assert.equal(data[66], false, 'the integrated PiD accordion must stay disabled')
})

test('PiD postpass switches models, predicts once, and normalizes only final images', async () => {
    const order = []
    let predicted = null
    const packet = {
        data: [{ value: [{ image: { path: '/tmp/base.png' } }] }, null, JSON.stringify({ seed: 7 })],
        duration: 2,
    }

    const result = await run_pid_postpass(packet, {
        model: ANIMA_MODEL,
        prompt: 'a cat <lora:anime_style:0.8>',
        endpoint: 'http://forge.test',
        headers: { 'X-Test': '1' },
        session_hash: 'session',
        pid: prepare_pid_upscale({ model: ANIMA_MODEL, width: 512, height: 768 }),
        seed: 7,
        onTask: id => order.push(`task:${id}`),
        switchModel: async selection => {
            order.push(`switch:${selection.checkpoint}`)
            assert.deepEqual(selection.modules, [PID_VAE, PID_TEXT_ENCODER])
        },
        restoreModel: async () => order.push('restore'),
        fetchImage: async () => Buffer.from('base'),
        getOptions: async () => ({
            sd_model_checkpoint: 'anima-base-v1.safetensors',
            forge_preset: 'xl',
            forge_additional_modules: ['qwen_image_vae.safetensors', 'qwen_3_06b_base.safetensors'],
        }),
        predict: async request => {
            predicted = request
            order.push('predict')
            return {
                data: [
                    { value: [{ image: { path: '/tmp/grid.png' } }, { image: { path: '/tmp/final.png' } }, { image: { path: 'C:\\Temp\\gradio\\abc\\tmpmask.png' } }] },
                    null,
                    JSON.stringify({ seed: 7, sd_model_name: 'pid_sdxl' }),
                ],
                duration: 3,
            }
        },
    })

    assert.deepEqual(order, [`switch:${PID_CHECKPOINT}`, 'task:session', 'predict', 'restore'])
    assert.equal(predicted.data[2], 'a cat')
    assert.equal(predicted.data[24], 3072)
    assert.equal(predicted.data[25], 2048)
    assert.equal(result.data[0].value.length, 1)
    assert.equal(result.data[0].value[0].image.path, '/tmp/final.png')
    assert.equal(result.duration, 5)
})

test('PiD postpass restores the original model after prediction failure', async () => {
    let restored = false
    const packet = { data: [{ value: [{ image: { path: '/tmp/base.png' } }] }], duration: 1 }
    await assert.rejects(run_pid_postpass(packet, {
        endpoint: 'http://forge.test',
        session_hash: 'session',
        pid: { ...prepare_pid_upscale({ model: FLUX_MODEL, width: 512, height: 512 }) },
        fetchImage: async () => Buffer.from('base'),
        getOptions: async () => ({ sd_model_checkpoint: FLUX_MODEL, forge_additional_modules: [] }),
        switchModel: async () => {},
        restoreModel: async () => { restored = true },
        predict: async () => { throw new Error('boom') },
    }), /boom/)
    assert.equal(restored, true)
})

test('PiD postpass cancellation leaves the model untouched', async () => {
    const packet = { data: [{ value: [{ image: { path: '/tmp/base.png' } }] }] }
    await assert.rejects(run_pid_postpass(packet, {
        endpoint: 'http://forge.test',
        session_hash: 'session',
        pid: prepare_pid_upscale({ model: ANIMA_MODEL, width: 512, height: 512 }),
        shouldCancel: () => true,
        fetchImage: async () => { throw new Error('must not fetch') },
        switchModel: async () => { throw new Error('must not switch') },
        restoreModel: async () => { throw new Error('must not restore') },
        predict: async () => { throw new Error('must not predict') },
    }), error => error.code === PID_POSTPASS_CANCELLED)
})

test('PiD postpass reports a restore failure after successful sampling', async () => {
    const packet = {
        data: [{ value: [{ image: { path: '/tmp/base.png' } }] }],
        duration: 2,
    }

    await assert.rejects(run_pid_postpass(packet, {
        endpoint: 'http://forge.test',
        session_hash: 'session',
        pid: prepare_pid_upscale({ model: ANIMA_MODEL, width: 512, height: 512 }),
        fetchImage: async () => Buffer.from('base'),
        getOptions: async () => ({ sd_model_checkpoint: ANIMA_MODEL, forge_additional_modules: [] }),
        switchModel: async () => {},
        restoreModel: async () => { throw new Error('restore boom') },
        predict: async () => ({
            data: [{ value: [{ image: { path: '/tmp/final.png' } }] }],
            duration: 1,
        }),
    }), error => {
        assert.equal(error.code, PID_POSTPASS_RESTORE_FAILED)
        assert.match(error.message, /completed, but the original Forge checkpoint could not be restored/)
        assert.match(error.message, /restore boom/)
        assert.equal(error.cause.message, 'restore boom')
        return true
    })
})

test('PiD postpass carries the inference cause when restore also fails', async () => {
    const packet = {
        data: [{ value: [{ image: { path: '/tmp/base.png' } }] }],
    }

    await assert.rejects(run_pid_postpass(packet, {
        endpoint: 'http://forge.test',
        session_hash: 'session',
        pid: prepare_pid_upscale({ model: ANIMA_MODEL, width: 512, height: 512 }),
        fetchImage: async () => Buffer.from('base'),
        getOptions: async () => ({ sd_model_checkpoint: ANIMA_MODEL, forge_additional_modules: [] }),
        switchModel: async () => {},
        restoreModel: async () => { throw new Error('restore boom') },
        predict: async () => { throw new Error('inference boom') },
    }), error => {
        assert.equal(error.code, PID_POSTPASS_RESTORE_FAILED)
        assert.match(error.message, /PiD postpass failed \(inference boom\)/)
        assert.match(error.message, /could not be restored/)
        assert.match(error.message, /restore boom/)
        assert.equal(error.cause.message, 'inference boom')
        assert.equal(error.restoreError.message, 'restore boom')
        return true
    })
})

test('PiD postpass still restores after a cancelled inference', async () => {
    let cancelled = false
    let restored = false
    const packet = { data: [{ value: [{ image: { path: '/tmp/base.png' } }] }] }

    await assert.rejects(run_pid_postpass(packet, {
        endpoint: 'http://forge.test',
        session_hash: 'session',
        pid: prepare_pid_upscale({ model: ANIMA_MODEL, width: 512, height: 512 }),
        fetchImage: async () => Buffer.from('base'),
        getOptions: async () => ({ sd_model_checkpoint: ANIMA_MODEL, forge_additional_modules: [] }),
        switchModel: async () => {},
        restoreModel: async () => { restored = true },
        predict: async () => {
            cancelled = true
            return { data: [] }
        },
        shouldCancel: () => cancelled,
    }), error => error.code === PID_POSTPASS_CANCELLED)
    assert.equal(restored, true)
})

test('PiD postpass rejects an integrated policy and missing base dimensions', async () => {
    const packet = { data: [{ value: [{ image: { path: '/tmp/base.png' } }] }] }
    await assert.rejects(
        run_pid_postpass(packet, {
            endpoint: 'http://forge.test',
            session_hash: 'session',
            pid: prepare_pid_upscale({ model: SDXL_MODEL, width: 512, height: 512 }),
        }),
        /non-SDXL \(postpass\)/,
    )
    await assert.rejects(
        run_pid_postpass(packet, { endpoint: 'http://forge.test', session_hash: 'session', model: ANIMA_MODEL }),
        /prepared pid policy or base width and height/,
    )
})
