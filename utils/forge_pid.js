// Forge PiD (post-sample) upscaler policy.
//
// The installed distilled checkpoint is the native 4x SDXL integrated flow:
// LCM/Simple, 4 steps, CFG 1, shift 1.5, with color correction. Ordinary Hires
// Fix is not supported in the same pass. The installed Flux2 PiD checkpoint is
// undistilled, so it must not be sent through this hardcoded LCM-4 path.
//
// For non-SDXL families the same distilled SDXL PiD checkpoint is used as a
// standalone postpass: generate the base image normally, then run a Gradio
// img2img pass from the resulting RGB image with the SDXL VAE/Gemma modules.

const { resolve_supported_family } = require('./forge_img2img_scripts')

const PID_UPSCALER = 'PiD'
const PID_LEGACY_UPSCALER = 'PiD 4x'
const PID_SCALE = 4
const PID_MAX_BASE_DIMENSION = 1024
const PID_CHECKPOINT = 'pid_sdxl_1024_to_4096_4step_bf16 [c8dd35d7d5]'
const PID_VAE = 'sdxl_vae.safetensors'
const PID_TEXT_ENCODER = 'gemma_2_2b_fp16.safetensors'
const PID_POSTPASS_SAMPLER = 'LCM'
const PID_POSTPASS_SCHEDULER = 'Simple'
const PID_POSTPASS_STEPS = 4
const PID_POSTPASS_CFG = 1
const PID_POSTPASS_SHIFT = 1.5
const PID_POSTPASS_CANCELLED = 'PID_POSTPASS_CANCELLED'
const PID_POSTPASS_RESTORE_FAILED = 'PID_POSTPASS_RESTORE_FAILED'

function is_pid_upscaler(value) {
    return value === PID_UPSCALER || value === PID_LEGACY_UPSCALER
}

function read_base_dimension(value, name) {
    if (!Number.isInteger(value) || value <= 0 || value % 8 !== 0 || value > PID_MAX_BASE_DIMENSION) {
        throw new Error(
            `PiD requires ${name} to be a positive integer divisible by 8 and no larger than ` +
            `${PID_MAX_BASE_DIMENSION}px (received ${value}); the 4x pass would otherwise exceed the 4K output cap.`,
        )
    }
    return value
}

function read_degrade_sigma(value) {
    if (value === undefined || value === null) return 0
    if (typeof value === 'boolean' || value === '' || typeof value === 'object') {
        throw new Error('PiD degrade_sigma must be a finite number between 0 and 1.')
    }
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        throw new Error('PiD degrade_sigma must be a finite number between 0 and 1.')
    }
    return parsed
}

function read_color_correction(value) {
    if (value === undefined || value === null) return true
    if (typeof value !== 'boolean') {
        throw new Error('PiD color_correction must be a boolean.')
    }
    return value
}

function read_prompt(value) {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') {
        throw new Error('PiD prompt must be a string.')
    }
    return value
}

/**
 * Validate a PiD request and return the exact policy to use.
 *
 * SDXL base latents can use Forge's native integrated pass. Other known image
 * families produce RGB output, so they use the standalone SDXL PiD postpass.
 * The caller still owns selecting PiD through the command upscaler choice,
 * fixed cooldowns, and excluding incompatible extra scripts.
 */
function prepare_pid_upscale({ model, width, height, prompt = '', degrade_sigma = 0, color_correction = true } = {}) {
    // Forge's active checkpoint cache can include a display hash. The family
    // resolver expects the plain filename/basename, so strip display-only
    // brackets before checking.
    const family_model = typeof model === 'string'
        ? model.replace(/\s*\[[0-9a-f]{6,}\]\s*/gi, '')
        : model
    const family = resolve_supported_family(family_model)
    if (!family) {
        throw new Error(
            `PiD needs a known image checkpoint; "${model || 'unknown'}" is not in the configured model catalogs. ` +
            'Select a supported checkpoint or choose another upscaler.',
        )
    }

    const base_width = read_base_dimension(width, 'width')
    const base_height = read_base_dimension(height, 'height')

    return {
        enabled: true,
        stage: family === 'xl' ? 'integrated' : 'postpass',
        family,
        scale: PID_SCALE,
        checkpoint: PID_CHECKPOINT,
        vae: PID_VAE,
        text_encoder: PID_TEXT_ENCODER,
        prompt: read_prompt(prompt),
        degrade_sigma: read_degrade_sigma(degrade_sigma),
        color_correction: read_color_correction(color_correction),
        width: base_width * PID_SCALE,
        height: base_height * PID_SCALE,
    }
}

function pid_cancelled_error() {
    const error = new Error('PiD postpass was cancelled.');
    error.code = PID_POSTPASS_CANCELLED;
    return error
}

// PiD only knows the base model's prompt tokens; a dropped model-specific LoRA
// would otherwise be requested on the incompatible PiD checkpoint.
function strip_lora_tags(prompt) {
    return String(prompt || '')
        .replace(/<lora:[^>\r\n]*>/gi, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
}

function packet_gallery(packet) {
    return Array.isArray(packet?.data?.[0]?.value) ? packet.data[0].value : []
}

function packet_image_path(item) {
    if (!item) return null
    if (typeof item === 'string') return item
    if (typeof item.image?.path === 'string') return item.image.path
    if (typeof item.path === 'string') return item.path
    return null
}

function is_temporary_gradio_path(filePath) {
    return /(?:^|[\\/])(?:Temp|tmp)[\\/]gradio[\\/]/i.test(String(filePath || ''))
}

function select_base_result(packet, { daamHeatmapCount = 0 } = {}) {
    const skip = Number.isInteger(daamHeatmapCount) && daamHeatmapCount > 0 ? daamHeatmapCount : 0
    const paths = packet_gallery(packet).slice(skip).map(packet_image_path).filter(Boolean)
    const generated = paths.filter(path => !is_temporary_gradio_path(path))
    const candidates = generated.length ? generated : paths
    return candidates[0] || null
}

function data_uri(buffer) {
    return `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`
}

// Positional Forge img2img payload for the standalone PiD pass. Keeping this
// separate from the main builders avoids accidentally enabling the integrated
// PiD fields or Hires Fix while preserving the ordinary 310-input schema.
function build_postpass_request({ attachment, prompt, negativePrompt = '', seed = -1, sessionHash, width, height, pid = null }) {
    const { get_data_body_img2img } = require('./ai_server_config')
    const args = new Array(47)
    args[0] = 0                     // unused server index
    args[1] = prompt
    args[2] = negativePrompt
    args[3] = PID_POSTPASS_STEPS
    args[4] = PID_POSTPASS_CFG
    args[5] = seed
    args[6] = PID_POSTPASS_SAMPLER
    args[7] = PID_POSTPASS_SCHEDULER
    args[8] = sessionHash
    args[9] = height
    args[10] = width
    args[11] = attachment
    args[13] = pid?.degrade_sigma ?? 0 // read as degrade sigma by PiD.init, then forced to denoise 1
    args[14] = 0
    args[15] = 4
    args[16] = 'original'
    args[17] = 'None'
    args[21] = 1
    args[22] = false
    args[26] = 'Whole picture'
    args[27] = 32
    args[31] = ''
    args[35] = { do_preview: false }
    args[38] = 'None'
    const data = get_data_body_img2img(...args)
    if (data[19] !== PID_POSTPASS_CFG || data[24] !== height || data[25] !== width) {
        throw new Error('The Forge img2img schema shifted; PiD postpass needs a fresh /config signature refresh.')
    }
    data[20] = PID_POSTPASS_SHIFT  // Distilled CFG Scale / shift for the PiD preset
    return data
}

function default_axios() {
    return require('axios').default || require('axios')
}

function gradio_predict({ endpoint, headers, fn_index, session_hash, data, timeout = 900000 }) {
    const axios = default_axios()
    return axios.post(`${endpoint}/run/predict/`, { fn_index, session_hash, data }, { headers, timeout })
        .then(response => response.data)
}

async function default_switch_model({ checkpoint, preset = 'pid', modules }, { endpoint, headers, session_hash }) {
    const { server_pool } = require('./ai_server_config')
    const pool = server_pool[0]
    await gradio_predict({
        endpoint, headers,
        fn_index: pool.fn_index_change_model,
        session_hash,
        data: [checkpoint, preset],
    })
    await gradio_predict({
        endpoint, headers,
        fn_index: pool.fn_index_change_support_model,
        session_hash,
        data: [Array.isArray(modules) ? modules : [], preset],
    })
}

async function default_get_options({ endpoint, headers }) {
    const axios = default_axios()
    return (await axios.get(`${endpoint}/sdapi/v1/options`, { headers, timeout: 15000 })).data
}

async function default_fetch_image({ endpoint, filePath }) {
    const { fetchImageBuffer } = require('./forge_image_job')
    return fetchImageBuffer({ endpoint, filePath })
}

function normalize_postpass_packet(packet, response, resultPath) {
    const data = Array.isArray(response?.data) ? response.data.slice() : []
    const gallery = [{
        image: { path: resultPath, url: resultPath, mime_type: 'image/png', meta: { _type: 'gradio.FileData' } },
        caption: null,
    }]
    data[0] = { ...(data[0] || {}), value: gallery }
    return {
        data,
        duration: Number(packet?.duration || 0) + Number(response?.duration || 0),
        postpass: true,
    }
}

/**
 * Run the standalone SDXL PiD pass for a non-SDXL base image.
 *
 * This must be called inside the caller's Forge lease. `packet` and the value
 * returned by `predict()` are Forge response bodies, not Axios wrappers. The
 * original checkpoint/preset/modules are restored in `finally` on every path.
 *
 * @returns {Object} normalized Forge packet containing only the final upscale.
 */
async function run_pid_postpass(packet, {
    model,
    prompt = '',
    negativePrompt = '',
    endpoint,
    headers = {},
    session_hash,
    pid = null,
    daamHeatmapCount = 0,
    seed = -1,
    base_width,
    base_height,
    onTask = () => {},
    shouldCancel = () => false,
    predict = null,
    switchModel = null,
    restoreModel = null,
    fetchImage = null,
    buildRequest = null,
    fnIndex = null,
    getOptions = null,
    logger = console,
} = {}) {
    if (!endpoint) throw new Error('PiD postpass requires a Forge endpoint.')
    if (!session_hash) throw new Error('PiD postpass requires a Gradio session hash.')

    let policy = pid
    if (!policy) {
        const width = Number(base_width)
        const height = Number(base_height)
        if (!Number.isInteger(width) || !Number.isInteger(height)) {
            throw new Error('PiD postpass requires a prepared pid policy or base width and height.')
        }
        policy = prepare_pid_upscale({ model, width, height, prompt })
    }
    if (policy.stage !== 'postpass') {
        throw new Error('PiD postpass requires a non-SDXL (postpass) PiD policy.')
    }

    const basePath = select_base_result(packet, { daamHeatmapCount })
    if (!basePath) throw new Error('PiD postpass could not find the base image in the Forge response.')

    if (shouldCancel()) throw pid_cancelled_error()

    const fetch = fetchImage || (options => default_fetch_image(options))
    const baseBuffer = await fetch({ endpoint, filePath: basePath })
    if (!Buffer.isBuffer(baseBuffer) || !baseBuffer.length) {
        throw new Error('PiD postpass could not download the base image.')
    }

    const request = (buildRequest || build_postpass_request)({
        attachment: data_uri(baseBuffer),
        prompt: strip_lora_tags(prompt || policy.prompt),
        negativePrompt,
        seed,
        sessionHash: session_hash,
        width: policy.width,
        height: policy.height,
        pid: policy,
    })

    const options = getOptions || (args => default_get_options(args))
    const original = await options({ endpoint, headers })
    if (!original?.sd_model_checkpoint) {
        throw new Error('PiD postpass could not read the original Forge checkpoint.')
    }

    const switchFn = switchModel || ((selection, context) => default_switch_model(selection, context))
    // Restore the global active checkpoint/modules without overwriting a
    // named UI-preset slot. Forge keeps `forge_preset` itself unchanged.
    const restoreFn = restoreModel || ((context) => switchFn({
        checkpoint: original.sd_model_checkpoint,
        preset: null,
        modules: original.forge_additional_modules ?? [],
    }, context))

    const predictFn = predict || (args => gradio_predict({ ...args, endpoint, headers }))
    const fn = Number.isInteger(fnIndex) ? fnIndex : require('./ai_server_config').server_pool[0].fn_index_img2img

    let taskError = null
    try {
        await switchFn({
            checkpoint: policy.checkpoint,
            preset: 'pid',
            modules: [policy.vae, policy.text_encoder],
        }, { endpoint, headers, session_hash })
        if (shouldCancel()) throw pid_cancelled_error()

        onTask(session_hash)
        const response = await predictFn({
            fn_index: fn,
            session_hash,
            data: request,
        })
        if (shouldCancel()) throw pid_cancelled_error()

        const result = packet_gallery(response).map(packet_image_path).filter(Boolean)
        if (!result.length) throw new Error('PiD postpass returned no upscaled image.')
        const generated = result.filter(path => !/(?:^|[\\/])(?:Temp|tmp)[\\/]gradio[\\/]/i.test(path))
        const resultPath = (generated.length ? generated : result)[generated.length ? generated.length - 1 : result.length - 1]
        logger.log?.('PiD postpass completed:', resultPath)
        return normalize_postpass_packet(packet, response, resultPath)
    }
    catch (error) {
        taskError = error
        throw error
    }
    finally {
        try {
            await restoreFn({ endpoint, headers, session_hash })
        }
        catch (restoreError) {
            // The Forge checkpoint is process-global. Returning an upscaled
            // image while silently leaving Forge on PiD would make every later
            // generation use the wrong model, so surface the failure with the
            // original error attached when the sampling pass also failed.
            const detail = restoreError?.message || String(restoreError)
            const failure = new Error(
                taskError
                    ? `PiD postpass failed (${taskError.message || taskError}) and the original Forge checkpoint ` +
                      `could not be restored: ${detail}`
                    : `PiD postpass completed, but the original Forge checkpoint could not be restored: ${detail}`,
            )
            failure.code = PID_POSTPASS_RESTORE_FAILED
            failure.cause = taskError || restoreError
            failure.restoreError = restoreError
            logger.error?.('Failed to restore the Forge checkpoint after PiD postpass:', restoreError)
            throw failure
        }
    }
}

module.exports = {
    PID_UPSCALER,
    PID_LEGACY_UPSCALER,
    PID_SCALE,
    PID_MAX_BASE_DIMENSION,
    PID_CHECKPOINT,
    PID_VAE,
    PID_TEXT_ENCODER,
    PID_POSTPASS_SAMPLER,
    PID_POSTPASS_SCHEDULER,
    PID_POSTPASS_STEPS,
    PID_POSTPASS_CFG,
    PID_POSTPASS_SHIFT,
    PID_POSTPASS_CANCELLED,
    PID_POSTPASS_RESTORE_FAILED,
    is_pid_upscaler,
    prepare_pid_upscale,
    strip_lora_tags,
    build_postpass_request,
    run_pid_postpass,
}
