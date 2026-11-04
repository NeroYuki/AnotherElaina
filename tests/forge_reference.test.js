const test = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')

const {
    SETTING_KEYS,
    EDIT_LORAS,
    REFERENCE_LAYOUTS,
    getReferencePolicy,
    prepareAnimaEditInstruction,
    prepareReferencePrompt,
    withForgeImageMode,
    prepareReferenceInputs,
} = require('../utils/forge_reference')
const { model_selection_qwen21, model_selection_moss, model_selection_kontext } = require('../utils/ai_server_config')

const QWEN = model_selection_qwen21[0].value
const MOSS = model_selection_moss[0].value
const KONTEXT = model_selection_kontext[0].value
const ANIMA = 'anima-base-v1.safetensors'
const KREA = 'krea2_turbo_int8_convrot.safetensors'
const SDXL = 'wai_nsfw_illustrious_v120.safetensors'
const ALL_EDIT_LORAS = ['AnimeEditV2', 'moss_image_edit_lora_rank_64_bf16', 'krea2_general_edit_v2', 'krea2_identity_edit_v2']
    .map(name => ({ name, alias: name, path: `Lora/${name}.safetensors` }))

async function png(width, height, color = '#ff0000') {
    return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()
}

function fakeHttp({ options = {}, loras = ALL_EDIT_LORAS, failWhen = null } = {}) {
    const posts = []
    let gets = 0
    const http = {
        async get(url) {
            gets++
            if (url.endsWith('/sdapi/v1/options')) return { data: { ...options } }
            if (url.endsWith('/sdapi/v1/loras')) return { data: loras || [] }
            throw new Error(`Unexpected GET ${url}`)
        },
        async post(url, body) {
            posts.push({ url, body })
            if (failWhen && failWhen(body)) return { data: { error: 'failed' } }
            return { data: {} }
        },
    }
    return { http, posts, gets: () => gets }
}

test('reference policy covers only reference-capable families and their edit LoRAs', () => {
    assert.deepEqual(Object.values(SETTING_KEYS).sort(), [
        'anima_do_reference', 'klein_do_reference', 'krea2_do_reference', 'moss_do_reference', 'qwen21_do_reference',
    ])
    assert.deepEqual(REFERENCE_LAYOUTS, ['native', 'grid', 'horizontal', 'vertical'])

    assert.equal(getReferencePolicy(QWEN, { workflow: 'reference' }).family, 'qwen21')
    assert.equal(getReferencePolicy(MOSS, { workflow: 'reference' }).setting.value, 'Moss-Image-Edit')
    assert.equal(getReferencePolicy(ANIMA, { workflow: 'reference' }).lora.name, EDIT_LORAS.anima)
    assert.equal(getReferencePolicy(KREA, { workflow: 'reference', editVariant: 'identity' }).lora.name, EDIT_LORAS.krea_identity)
    assert.equal(getReferencePolicy(KREA, { workflow: 'reference', editVariant: 'general' }).lora.name, EDIT_LORAS.krea)
    assert.equal(getReferencePolicy(KONTEXT, { workflow: 'reference' }).family, 'kontext')
    assert.equal(getReferencePolicy(KONTEXT, { workflow: 'reference' }).setting, null)
    assert.equal(getReferencePolicy(KONTEXT, { workflow: 'reference' }).lora, null)

    assert.equal(getReferencePolicy(QWEN, { workflow: 'denoise' }).setting.value, false)
    assert.equal(getReferencePolicy(MOSS, { workflow: 'denoise' }).setting.value, 'Disable')
    assert.equal(getReferencePolicy(ANIMA, { workflow: 'inpaint' }).setting.value, false)
    assert.equal(getReferencePolicy(SDXL, { workflow: 'denoise' }).setting, null, 'ordinary SDXL has no reference switch')
    assert.equal(getReferencePolicy(SDXL, { workflow: 'denoise' }).family, null)

    assert.throws(() => getReferencePolicy(SDXL, { workflow: 'reference' }), /requires Qwen 2\.1, Klein, Anima, MOSS, Krea2, or Flux Kontext/)
    assert.throws(() => getReferencePolicy(QWEN, { workflow: 'reference', editVariant: 'other' }), /Unknown reference edit variant/)
})

test('prepareReferencePrompt wraps Anima edits as explicit instructions and injects the LoRA once', () => {
    assert.equal(
        prepareReferencePrompt('a cat', ANIMA),
        'Edit the image: a cat. Apply only the requested changes and keep everything else unchanged. <lora:AnimeEditV2:1>',
    )
    assert.equal(
        prepareReferencePrompt('a cat, ', ANIMA),
        'Edit the image: a cat. Apply only the requested changes and keep everything else unchanged. <lora:AnimeEditV2:1>',
    )
    assert.equal(
        prepareReferencePrompt('a cat <lora:AnimeEditV2:0.4>', ANIMA),
        'Edit the image: a cat <lora:AnimeEditV2:0.4>. Apply only the requested changes and keep everything else unchanged.',
    )
    assert.equal(
        prepareReferencePrompt('a cat <lora:krea2_identity_edit_v2:0.7>', KREA, { editVariant: 'identity' }),
        'a cat <lora:krea2_identity_edit_v2:0.7>',
    )
    assert.equal(
        prepareReferencePrompt('a cat <lora:krea2_general_edit_v2:0.7>', KREA, { editVariant: 'identity' }),
        'a cat <lora:krea2_general_edit_v2:0.7>',
        'never add the other Krea edit LoRA at weight 1',
    )
    assert.equal(
        prepareReferencePrompt('a cat <lora:krea2_identity_edit_v2:0.7>', KREA, { editVariant: 'general' }),
        'a cat <lora:krea2_identity_edit_v2:0.7>',
        'explicit identity tags suppress general injection',
    )
    assert.equal(prepareReferencePrompt('a cat', QWEN), 'a cat')
    assert.equal(prepareReferencePrompt('a cat', KONTEXT), 'a cat')
})

test('Anima edit wrapping is idempotent and preserves explicit instructions', () => {
    const once = prepareAnimaEditInstruction('make her dress red')
    assert.equal(once, 'Edit the image: make her dress red. Apply only the requested changes and keep everything else unchanged.')
    assert.equal(prepareAnimaEditInstruction(once), once)
    assert.equal(
        prepareAnimaEditInstruction('Edit this image: change the background'),
        'Edit this image: change the background. Apply only the requested changes and keep everything else unchanged.',
    )
    assert.equal(
        prepareAnimaEditInstruction('Change the background. Apply only the requested changes and keep everything else unchanged.'),
        'Edit the image: Change the background. Apply only the requested changes and keep everything else unchanged.',
    )
})

test('withForgeImageMode flips the reference option and restores it after success', async () => {
    const { http, posts } = fakeHttp({ options: { anima_do_reference: false } })
    let inside = null
    await withForgeImageMode({
        model: ANIMA, workflow: 'reference', session_hash: 'session', endpoint: 'http://forge.test', headers: { 'X-Test': '1' },
    }, async policy => {
        inside = policy
    }, { http })

    assert.equal(inside.family, 'anima')
    assert.equal(posts.length, 2)
    assert.equal(posts[0].body.fn_index, 1469)
    assert.deepEqual(posts[0].body.data, [true])
    assert.deepEqual(posts[1].body.data, [false])
    assert.equal(posts[0].body.session_hash, 'session')
})

test('withForgeImageMode restores the option when the callback throws', async () => {
    const { http, posts } = fakeHttp({ options: { moss_do_reference: 'Disable' } })
    await assert.rejects(withForgeImageMode({
        model: MOSS, workflow: 'reference', session_hash: 'session', endpoint: 'http://forge.test',
    }, async () => { throw new Error('generation failed') }, { http }), /generation failed/)

    assert.equal(posts.length, 2)
    assert.deepEqual(posts[0].body.data, ['Moss-Image-Edit'])
    assert.deepEqual(posts[1].body.data, ['Disable'])
})

test('withForgeImageMode does not write when the option already matches or is irrelevant', async () => {
    const { http, posts } = fakeHttp({ options: { anima_do_reference: true } })
    await withForgeImageMode({ model: ANIMA, workflow: 'reference', session_hash: 's', endpoint: 'e' }, async () => {}, { http })
    assert.equal(posts.length, 0)

    const ordinary = fakeHttp({ options: {} })
    await withForgeImageMode({ model: SDXL, workflow: 'denoise', session_hash: 's', endpoint: 'e' }, async () => {}, { http: ordinary.http })
    assert.equal(ordinary.posts.length, 0)
})

test('withForgeImageMode validates the option and required LoRA before generation', async () => {
    const { http } = fakeHttp({ options: {} })
    await assert.rejects(withForgeImageMode({
        model: ANIMA, workflow: 'reference', session_hash: 's', endpoint: 'e',
    }, async () => {}, { http }), /anima_do_reference is unavailable/)

    const catalog = fakeHttp({ options: { anima_do_reference: false }, loras: [{ name: 'AnimeEditV2', alias: 'AnimeEditV2', path: 'Lora/AnimeEditV2.safetensors' }] })
    await withForgeImageMode({ model: ANIMA, workflow: 'reference', session_hash: 's', endpoint: 'e' }, async () => {}, { http: catalog.http })
    assert.equal(catalog.posts.length, 2)

    const missing = fakeHttp({ options: { anima_do_reference: false }, loras: [] })
    await assert.rejects(withForgeImageMode({
        model: ANIMA, workflow: 'reference', session_hash: 's', endpoint: 'e',
    }, async () => {}, { http: missing.http }), /Required edit LoRA AnimeEditV2 is not visible/)
    assert.equal(missing.posts.length, 0)
})

test('withForgeImageMode surfaces a failed option change', async () => {
    const { http } = fakeHttp({ options: { anima_do_reference: false }, failWhen: () => true })
    await assert.rejects(withForgeImageMode({
        model: ANIMA, workflow: 'reference', session_hash: 's', endpoint: 'e',
    }, async () => {}, { http }), /Failed to change Forge reference mode/)
})

test('prepareReferenceInputs uploads only additional native references', async () => {
    const uploaded = []
    const images = [await png(100, 80), await png(90, 120), await png(64, 64)]
    const prepared = await prepareReferenceInputs({
        images, layout: 'native', session_hash: 'session', endpoint: 'http://forge.test', direct_url: 'http://direct.test',
    }, {
        upload: async buffer => {
            uploaded.push(buffer)
            return `/tmp/ref${uploaded.length}.png`
        },
    })

    assert.equal(prepared.imageCount, 3)
    assert.equal(prepared.layout, 'native')
    assert.equal(uploaded.length, 2)
    assert.match(prepared.attachment, /^data:image\/png;base64,/)
    assert.equal(prepared.references.length, 2)
    assert.equal(prepared.references[0].image.path, '/tmp/ref1.png')
    assert.equal(prepared.references[0].caption, null)
    assert.equal(prepared.references[0].image.mime_type, 'image/png')
    assert.deepEqual(prepared.references[0].image.meta, { _type: 'gradio.FileData' })
    assert.match(prepared.references[0].image.url, /^http:\/\/direct\.test\/file=\/tmp\/ref1\.png/)
})

test('prepareReferenceInputs can match native extra references to the output dimensions', async () => {
    const uploaded = [];
    const images = [await png(100, 80), await png(90, 120), await png(64, 64)];
    await prepareReferenceInputs({
        images, layout: 'native', session_hash: 'session', endpoint: 'http://forge.test',
        width: 512, height: 512, match_output_size: true,
    }, {
        upload: async buffer => {
            uploaded.push(buffer);
            return `/tmp/ref${uploaded.length}.png`;
        },
    });
    assert.equal(uploaded.length, 2);
    for (const buffer of uploaded) {
        const metadata = await sharp(buffer).metadata();
        assert.equal(metadata.width, 512);
        assert.equal(metadata.height, 512);
    }
});

test('prepareReferenceInputs stitches layouts in order and honours output dimensions', async () => {
    const images = [await png(100, 100, '#ff0000'), await png(100, 100, '#00ff00'), await png(100, 100, '#0000ff'), await png(100, 100, '#ffffff')]
    for (const layout of ['grid', 'horizontal', 'vertical']) {
        const prepared = await prepareReferenceInputs({
            images, layout, session_hash: 's', endpoint: 'http://forge.test',
        })
        const buffer = Buffer.from(prepared.attachment.split(',')[1], 'base64')
        const metadata = await sharp(buffer).metadata()
        assert.equal(prepared.references.length, 0)
        assert.equal(metadata.format, 'png')
        if (layout === 'horizontal') assert.ok(metadata.width > metadata.height)
        if (layout === 'vertical') assert.ok(metadata.height > metadata.width)
        if (layout === 'grid') assert.equal(metadata.width, metadata.height)
    }

    const letterboxed = await prepareReferenceInputs({
        images: [await png(100, 50)], layout: 'native', session_hash: 's', endpoint: 'http://forge.test',
        width: 512, height: 512,
    })
    const metadata = await sharp(Buffer.from(letterboxed.attachment.split(',')[1], 'base64')).metadata()
    assert.equal(metadata.width, 512)
    assert.equal(metadata.height, 512)
})

test('prepareReferenceInputs rejects invalid counts, layouts, sides, and input', async () => {
    await assert.rejects(prepareReferenceInputs({ images: [], layout: 'native', session_hash: 's', endpoint: 'e' }), /between one and four/)
    await assert.rejects(prepareReferenceInputs({ images: new Array(5).fill(await png(8, 8)), layout: 'native', session_hash: 's', endpoint: 'e' }), /between one and four/)
    await assert.rejects(prepareReferenceInputs({ images: [await png(8, 8)], layout: 'unknown', session_hash: 's', endpoint: 'e' }), /Unknown reference layout/)
    for (const max_side of [63, 2049, 0, 1.5, 'wide']) {
        await assert.rejects(prepareReferenceInputs({ images: [await png(8, 8)], max_side, session_hash: 's', endpoint: 'e' }), /maximum side/)
    }
    await assert.rejects(prepareReferenceInputs({ images: ['not-an-image'], session_hash: 's', endpoint: 'e' }), /could not be decoded/)
    await assert.rejects(prepareReferenceInputs({ images: [Buffer.alloc(0)], session_hash: 's', endpoint: 'e' }), /missing/)
    await assert.rejects(prepareReferenceInputs({ images: [await png(8, 8)], width: 16, session_hash: 's', endpoint: 'e' }), /64–2048/)
})
