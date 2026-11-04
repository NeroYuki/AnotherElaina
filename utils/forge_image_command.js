'use strict';

// Shared img2img / reference-edit command executor and payload builder.
//
// Thin command files supply the slash-command schema. Everything after option
// parsing lives here so the basic, advanced and reference commands share the
// same lease, prompt enrichment, Forge setup and delivery path.

const crypt = require('crypto');
const {
    server_pool,
    get_prompt,
    get_negative_prompt,
    get_worker_server,
    get_data_body_img2img,
    model_selection,
    model_selection_xl,
    model_selection_flux,
    model_selection_flux_dev,
    model_selection_kontext,
    model_selection_inpaint,
    model_selection_curated,
    model_selection_anima,
    model_selection_qwen21,
    model_selection_moss,
    model_selection_krea,
    model_selection_flux_klein_4b,
    model_selection_flux_klein_9b,
    sampler_to_comfy_name_mapping,
    scheduler_to_comfy_name_mapping,
} = require('./ai_server_config.js');
const { byPassUser, censorGuildIds, optOutGuildIds } = require('../config.json');
const { serviceHeaders } = require('./proxy_config');
const { forgeWorkload } = require('./orchestrator_workload');
const SD_HEADERS = serviceHeaders('sdwebui');
const { loadImage, uploadPngBufferToGradio } = require('./load_discord_img.js');
const { load_controlnet } = require('./controlnet_execute.js');
const { load_adetailer } = require('./adetailer_execute.js');
const { cached_model, model_change, sync_active_model } = require('./model_change.js');
const {
    full_prompt_analyze,
    preview_coupler_setting,
    fetch_user_defined_wildcard,
    get_teacache_config_from_prompt,
    get_debug_prompt_analyze,
} = require('./prompt_analyzer.js');
const { load_profile } = require('./profile_helper.js');
const { clamp, parse_common_setting } = require('./common_helper');
const { get_model_family_defaults } = require('./model_defaults');
const {
    TILED_UPSCALE_SCRIPT,
    NATIVE_OUTPAINT_SCRIPT,
    normalize_extra_script,
    prepare_tiled_upscale,
} = require('./forge_img2img_scripts');
const { prepare_native_outpaint } = require('./forge_outpaint');
const { is_pid_upscaler, prepare_pid_upscale, run_pid_postpass } = require('./forge_pid');
const { withForgeSession } = require('./forge_session');
const { runForgeImageJob, dataUriToBuffer } = require('./forge_image_job');
const { runComfyImageJob } = require('./comfy_image_job');
const workflow_outpaint = require('../resources/flux_fill_outpaint.json');
const workflow_kontext = require('../resources/flux_kontext.json');

const REFERENCE_MAX_SIDE = 1024;
const REFERENCE_LAYOUTS = [
    { name: 'Native', value: 'native' },
    { name: 'Horizontal', value: 'horizontal' },
    { name: 'Grid', value: 'grid' },
    { name: 'Vertical', value: 'vertical' },
];
const REFERENCE_EDIT_VARIANTS = [
    { name: 'General', value: 'general' },
    { name: 'Identity', value: 'identity' },
];

function unique_choices(lists, limit = 25) {
    const seen = new Set();
    const result = [];
    for (const list of lists) {
        for (const item of list || []) {
            if (!item || typeof item.value !== 'string' || seen.has(item.value)) continue;
            seen.add(item.value);
            result.push(item);
            if (result.length >= limit) return result;
        }
    }
    return result;
}

const REFERENCE_SUPPORTED_MODELS = [
    ...(model_selection_anima || []),
    ...(model_selection_qwen21 || []),
    ...(model_selection_moss || []),
    ...(model_selection_krea || []),
    ...(model_selection_flux_klein_4b || []),
    ...(model_selection_flux_klein_9b || []),
    ...(model_selection_kontext || []),
    ...(model_selection_flux_dev || []),
];
const REFERENCE_SUPPORTED_VALUES = new Set(REFERENCE_SUPPORTED_MODELS.map(item => item.value));
const KONTEXT_MODEL = model_selection_kontext?.[0]?.value || 'comfy_sym\\flux1-kontext-dev-Q8_0.gguf';
const MOSS_REFERENCE_MODEL = (model_selection_moss || [])
    .find(item => basename(item.value) === 'moss_image_sft_bf16.safetensors')?.value
    || (model_selection_moss || [])
        .find(item => basename(item.value) === 'moss_image_base_bf16.safetensors')?.value
    || 'moss_image_sft_bf16.safetensors';

function is_moss_int8_checkpoint(model) {
    return /^moss_image_.*int8_convrot\.safetensors$/i.test(basename(model));
}

function moss_bf16_equivalent(model) {
    if (!is_moss_int8_checkpoint(model)) return null;
    const candidate = basename(model).replace(/_int8_convrot\.safetensors$/i, '_bf16.safetensors');
    return (model_selection_moss || [])
        .find(item => basename(item.value) === candidate)?.value || MOSS_REFERENCE_MODEL;
}

// Flux Dev has no native reference/edit conditioning, and MOSS int8
// checkpoints cannot apply the bf16 edit LoRA. For reference commands,
// transparently use a compatible checkpoint instead.
function resolve_reference_checkpoint(model) {
    if (!model) return model;
    const name = basename(model);
    if (name.startsWith('flux1-dev')) return KONTEXT_MODEL;
    if (is_moss_int8_checkpoint(model)) return moss_bf16_equivalent(model);
    return model;
}

// Reference layout/reference-edit only supports the families implemented by
// forge_reference. Keep this option list <= 25 and do not offer checkpoints
// that the helper would immediately reject.
const REFERENCE_CHECKPOINT_SELECTION = unique_choices([
    (model_selection_curated || []).filter(item => REFERENCE_SUPPORTED_VALUES.has(item.value)),
    REFERENCE_SUPPORTED_MODELS,
]);

function normalize_model_name(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    return value.trim().replaceAll('\\', '/').split('/').pop().toLowerCase();
}

function basename(value) {
    return String(value || '').replaceAll('\\', '/').split('/').pop().toLowerCase();
}

function data_uri(buffer, mime = 'image/png') {
    return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}

function as_attachment_data_uri(value) {
    if (typeof value === 'string' && value.startsWith('data:image/')) return value;
    if (Buffer.isBuffer(value)) return data_uri(value);
    return value;
}

function read_option(interaction, method, name) {
    try {
        return interaction?.options?.[method]?.(name) ?? null;
    }
    catch {
        return null;
    }
}

function load_reference_module() {
    try {
        return require('./forge_reference');
    }
    catch (error) {
        if (error?.code === 'MODULE_NOT_FOUND' && /forge_reference/.test(error.message)) return null;
        throw error;
    }
}

function require_reference_function(name, deps = {}) {
    const fn = deps[name] || load_reference_module()?.[name];
    if (typeof fn !== 'function') {
        throw new Error(
            `Reference image support is unavailable: the shared forge_reference helper (${name}) is missing. ` +
            'Only img2img/inpaint can run until it is installed.',
        );
    }
    return fn;
}

function resolve_api(deps = {}) {
    return {
        cached_model: deps.cached_model || cached_model,
        model_change: deps.model_change || model_change,
        sync_active_model: deps.sync_active_model || sync_active_model,
        loadImage: deps.loadImage || loadImage,
        uploadPngBufferToGradio: deps.uploadPngBufferToGradio || uploadPngBufferToGradio,
        load_controlnet: deps.load_controlnet || load_controlnet,
        load_adetailer: deps.load_adetailer || load_adetailer,
        get_data_body_img2img: deps.get_data_body_img2img || get_data_body_img2img,
        get_worker_server: deps.get_worker_server || get_worker_server,
        get_prompt: deps.get_prompt || get_prompt,
        get_negative_prompt: deps.get_negative_prompt || get_negative_prompt,
        get_model_family_defaults: deps.get_model_family_defaults || get_model_family_defaults,
        full_prompt_analyze: deps.full_prompt_analyze || full_prompt_analyze,
        preview_coupler_setting: deps.preview_coupler_setting || preview_coupler_setting,
        fetch_user_defined_wildcard: deps.fetch_user_defined_wildcard || fetch_user_defined_wildcard,
        get_teacache_config_from_prompt: deps.get_teacache_config_from_prompt || get_teacache_config_from_prompt,
        get_debug_prompt_analyze: deps.get_debug_prompt_analyze || get_debug_prompt_analyze,
        load_profile: deps.load_profile || load_profile,
        parse_common_setting: deps.parse_common_setting || parse_common_setting,
        prepare_tiled_upscale: deps.prepare_tiled_upscale || prepare_tiled_upscale,
        prepare_native_outpaint: deps.prepare_native_outpaint || prepare_native_outpaint,
        is_pid_upscaler: deps.is_pid_upscaler || is_pid_upscaler,
        prepare_pid_upscale: deps.prepare_pid_upscale || prepare_pid_upscale,
        run_pid_postpass: deps.run_pid_postpass || run_pid_postpass,
        withForgeSession: deps.withForgeSession || withForgeSession,
        runForgeImageJob: deps.runForgeImageJob || runForgeImageJob,
        enrichImagePrompts: deps.enrichImagePrompts || ((options) => require('../utils/image_prompt').enrichImagePrompts(options)),
        withForgeImageMode: deps.withForgeImageMode || null,
        jobDeps: deps.jobDeps || {},
    };
}

/**
 * Run a callback inside the shared Forge image-mode helper when it is
 * available. Reference workflow is strict: a missing helper must fail instead
 * of silently leaving Forge in a model-specific image-stitch mode.
 */
async function withForgeImageModeCompat(options, callback, deps = {}) {
    const helper = deps.withForgeImageMode || load_reference_module()?.withForgeImageMode;
    if (typeof helper !== 'function') {
        if (options?.workflow === 'reference') {
            throw new Error(
                'Reference image mode is unavailable: the shared forge_reference helper (withForgeImageMode) is missing.',
            );
        }
        return callback();
    }
    return helper(options, callback);
}

function read_image_command_request(interaction, client, profile, config = {}) {
    const advanced = !!config.advanced;
    const reference = config.workflow === 'reference';
    const allowControlNet = !!config.allowControlNet;
    const allowAdetailer = !!config.allowAdetailer;
    const allowExtraScript = !!config.allowExtraScript;
    const getString = name => read_option(interaction, 'getString', name);
    const getInteger = name => read_option(interaction, 'getInteger', name);
    const getNumber = name => read_option(interaction, 'getNumber', name);
    const getBoolean = name => read_option(interaction, 'getBoolean', name);
    const getAttachment = name => read_option(interaction, 'getAttachment', name);

    const prompt = (profile?.prompt_pre || '') + (getString('prompt') || '') + (profile?.prompt || '');
    const neg_prompt = (profile?.neg_prompt_pre || '') + (getString('neg_prompt') || '') + (profile?.neg_prompt || '');
    const width = getInteger('width') || profile?.width || null;
    const height = getInteger('height') || profile?.height || null;
    const user_denoising_strength = getNumber('denoising_strength');
    let denoising_strength = clamp(
        user_denoising_strength ?? (reference ? 1 : 0.7),
        0,
        1,
    );
    const user_sampler = advanced ? getString('sampler') : null;
    const user_scheduler = advanced ? getString('scheduler') : null;
    const user_cfg = advanced ? getNumber('cfg_scale') : null;
    const user_step = advanced ? getInteger('sampling_step') : null;
    const sampler = user_sampler || profile?.sampler || 'Euler';
    const scheduler = user_scheduler || profile?.scheduler || 'Automatic';
    let cfg_scale = clamp(user_cfg ?? profile?.cfg_scale ?? 7, 0, 30);
    let sampling_step = clamp(user_step ?? profile?.sampling_step ?? (advanced ? 20 : 25), 1, 100);
    const default_neg_prompt = getString('default_neg_prompt') || (advanced || reference ? 'n_sfw' : 'q_sfw');
    if (default_neg_prompt === 'n_nsfw' && neg_prompt.trim() === '') cfg_scale = 1;

    const force_server_selection = advanced
        ? clamp(getInteger('force_server_selection') ?? -1, -1, 1)
        : -1;
    const controlnet_input_option = allowControlNet ? getAttachment('controlnet_input') : null;
    const controlnet_input_option_2 = allowControlNet ? getAttachment('controlnet_input_2') : null;
    const controlnet_input_option_3 = allowControlNet ? getAttachment('controlnet_input_3') : null;
    const controlnet_config = allowControlNet
        ? (getString('controlnet_config') || profile?.controlnet_config ||
            (client.controlnet_config?.has(interaction.user.id) ? client.controlnet_config.get(interaction.user.id) : null))
        : null;
    const checkpoint = getString('checkpoint') || profile?.checkpoint || null;
    const upscaler = getString('upscaler') || 'None';
    const clip_skip = clamp(
        (advanced ? getInteger('clip_skip') : null) || profile?.clip_skip || 1,
        1,
        12,
    );
    const do_adetailer = allowAdetailer ? (getBoolean('do_adetailer') || false) : false;
    const adetailer_config = getString('adetailer_config') ||
        profile?.adetailer_config ||
        (client.adetailer_config?.has(interaction.user.id) ? client.adetailer_config.get(interaction.user.id) : null);
    const booru_gen_config = profile?.boorugen_config ||
        (client.boorugen_config?.has(interaction.user.id) ? client.boorugen_config.get(interaction.user.id) : null);
    const latentmod_config = profile?.latentmod_config ||
        (client.latentmod_config?.has(interaction.user.id) ? client.latentmod_config.get(interaction.user.id) : null);
    const colorbalance_config = getString('colorbalance_config') ||
        profile?.colorbalance_config ||
        (client.colorbalance_config?.has(interaction.user.id) ? client.colorbalance_config.get(interaction.user.id) : null);
    const extra_script = allowExtraScript ? normalize_extra_script(getString('extra_script') || 'None') : 'None';
    if (extra_script === NATIVE_OUTPAINT_SCRIPT && user_denoising_strength == null) denoising_strength = 1;
    const outpaint_config = profile?.script_outpaint_config ||
        (client.img2img_outpaint_config?.has(interaction.user.id) ? client.img2img_outpaint_config.get(interaction.user.id) : null);
    const upscale_config = profile?.script_upscale_config ||
        (client.img2img_upscale_config?.has(interaction.user.id) ? client.img2img_upscale_config.get(interaction.user.id) : null);

    const usersetting_config = client.usersetting_config?.has(interaction.user.id)
        ? client.usersetting_config.get(interaction.user.id) : null;
    const usersetting = parse_common_setting(usersetting_config);
    if (usersetting?.seedvr2_model && extra_script !== TILED_UPSCALE_SCRIPT && extra_script !== NATIVE_OUTPAINT_SCRIPT &&
        !is_pid_upscaler(upscaler)) {
        interaction.channel?.send?.(`SeedVR2 upscaling active (${usersetting.seedvr2_model}, target ${usersetting.seedvr2_resolution ?? 1600}px shortest edge)`);
    }

    let seed = -1;
    try {
        seed = parseInt(getString('seed')) || -1;
    }
    catch {
        seed = -1;
    }

    const reference_options = reference
        ? ['reference_2', 'reference_3', 'reference_4']
            .map((name, index) => ({ slot: index + 2, option: getAttachment(name) }))
        : [];

    return {
        advanced,
        reference,
        prompt,
        neg_prompt,
        width,
        height,
        denoising_strength,
        sampler,
        scheduler,
        cfg_scale,
        sampling_step,
        user_sampler,
        user_scheduler,
        user_cfg,
        user_step,
        default_neg_prompt,
        force_server_selection,
        controlnet_input_option,
        controlnet_input_option_2,
        controlnet_input_option_3,
        controlnet_config,
        checkpoint,
        upscaler,
        clip_skip,
        do_adetailer,
        adetailer_config,
        booru_gen_config,
        latentmod_config,
        colorbalance_config,
        extra_script,
        outpaint_config,
        upscale_config,
        usersetting,
        seed,
        reference_options,
        reference_layout: reference ? (getString('reference_layout') || 'native') : 'native',
        edit_variant: reference ? (getString('edit_variant') || 'general') : 'general',
        attachment_option: getAttachment('image'),
        profile,
    };
}

function build_generation_options({ pid = null, references = null, reference_max_side = REFERENCE_MAX_SIDE } = {}) {
    if (!pid && (!Array.isArray(references) || references.length === 0)) return undefined;
    const options = {};
    if (Array.isArray(references) && references.length > 0) {
        options.references = references;
        options.reference_max_side = reference_max_side;
    }
    if (pid) options.pid = pid;
    return options;
}

function build_img2img_payload({
    serverIndex,
    prompt,
    negPrompt,
    samplingStep,
    cfgScale,
    seed,
    sampler,
    scheduler,
    sessionHash,
    height,
    width,
    attachment,
    mask = null,
    denoisingStrength,
    mode = 0,
    maskBlur = 4,
    maskContent = 'original',
    upscaler = 'None',
    useAdetailer = false,
    couplerConfig = null,
    colorGradingConfig = null,
    clipSkip = 2,
    enableCensor = false,
    freeuConfig = null,
    dynamicThresholdConfig = null,
    pagConfig = null,
    inpaintArea = 'Whole picture',
    maskPadding = 32,
    useFoocus = false,
    useBooruGen = false,
    booruGenConfig = null,
    currentModel = '',
    inpaintUploadPath = null,
    inpaintMaskUploadPath = null,
    colorBalanceConfig = null,
    userSetting = null,
    outpaintConfig = null,
    upscaleConfig = null,
    extraScript = 'None',
    detailDaemonConfig = null,
    tipoInput = null,
    latentModConfig = null,
    mahiroConfig = null,
    teacacheConfig = null,
    modulationConfig = null,
    daamConfig = null,
    generationOptions = undefined,
}) {
    return get_data_body_img2img(
        serverIndex, prompt, negPrompt, samplingStep, cfgScale,
        seed, sampler, scheduler, sessionHash, height, width, attachment, mask, denoisingStrength,
        mode, maskBlur, maskContent, upscaler,
        useAdetailer, couplerConfig, colorGradingConfig, clipSkip, enableCensor,
        freeuConfig, dynamicThresholdConfig, pagConfig, inpaintArea, maskPadding,
        useFoocus, useBooruGen, booruGenConfig, currentModel, inpaintUploadPath, inpaintMaskUploadPath,
        colorBalanceConfig, userSetting, outpaintConfig, upscaleConfig, extraScript,
        detailDaemonConfig, tipoInput, latentModConfig, mahiroConfig, teacacheConfig,
        modulationConfig, daamConfig, generationOptions,
    );
}

function parse_json_config(raw, label, interaction) {
    try {
        const parsed = JSON.parse(raw);
        interaction.channel?.send?.(`Applying ${label} config`);
        return parsed;
    }
    catch {
        interaction.channel?.send?.(`Failed to parse ${label} config`);
        return { error: true };
    }
}

function find_node_id(workflow, classType) {
    return Object.keys(workflow).find(key => workflow[key]?.class_type === classType) || null;
}

function comfy_progress_message(workflow, progress) {
    if (progress?.node == null) return null;
    const title = workflow[progress.node]?._meta?.title || workflow[progress.node]?.class_type;
    return 'Processing: ' + (title || 'ComfyUI') +
        (progress.max ? ` (${progress.value}/${progress.max})` : '');
}

async function execute_comfy_flux_kontext(interaction, client, data) {
    const workflow = JSON.parse(JSON.stringify(workflow_kontext));
    workflow['27'] && Object.assign(workflow['27'].inputs, { width: data.width });
    workflow['30'] && Object.assign(workflow['30'].inputs, { width: data.width, height: data.height });
    workflow['6'] && Object.assign(workflow['6'].inputs, { text: data.prompt });
    workflow['16'] && Object.assign(workflow['16'].inputs, { sampler_name: data.sampler });
    workflow['17'] && Object.assign(workflow['17'].inputs, { steps: data.sampling_step, scheduler: data.scheduler });
    workflow['26'] && Object.assign(workflow['26'].inputs, { guidance: data.cfg_scale });
    workflow['25'] && Object.assign(workflow['25'].inputs, { noise_seed: Math.floor(Math.random() * 2_000_000_000) });
    workflow['60'] && Object.assign(workflow['60'].inputs, { rel_l1_thresh: data.teacache_strength });

    return runComfyImageJob(interaction, workflow, {
        initialContent: 'Submitting ComfyUI Flux Kontext workflow…',
        successContent: 'Comfy backend returned file',
        async prepare(context) {
            const image_info = await context.uploadImage(
                data.attachment,
                Date.now() + '_' + data.attachment_option.name,
                data.attachment_option.contentType,
            ).catch(error => {
                console.log('Failed to upload image', error);
                return null;
            });
            if (image_info == null) throw new Error('Failed to receive input image');
            const loadImageNode = find_node_id(workflow, 'LoadImage');
            if (loadImageNode) workflow[loadImageNode].inputs.image = image_info.name;

            const { unloadForgeCheckpoint } = require('./forge_api_execute');
            await unloadForgeCheckpoint();
            return workflow;
        },
        progress: progress => comfy_progress_message(workflow, progress),
        errorContent: error => error?.error || error?.message || String(error),
    });
}

async function execute_comfy_flux_outpaint(interaction, client, data) {
    const workflow = JSON.parse(JSON.stringify(workflow_outpaint));
    workflow['3'] && Object.assign(workflow['3'].inputs, {
        steps: data.sampling_step,
        sampler_name: data.sampler,
        scheduler: data.scheduler,
        seed: Math.floor(Math.random() * 2_000_000_000),
    });
    workflow['23'] && Object.assign(workflow['23'].inputs, { text: data.prompt });
    const teacacheNode = find_node_id(workflow, 'TeaCache');
    if (teacacheNode) workflow[teacacheNode].inputs.rel_l1_thresh = data.teacache_strength;

    const outpaint_config = {
        top: (data.outpaint_config_obj?.direction.includes('up') ? data.outpaint_config_obj.top || data.outpaint_config_obj.size : 0),
        bottom: (data.outpaint_config_obj?.direction.includes('down') ? data.outpaint_config_obj.bottom || data.outpaint_config_obj.size : 0),
        left: (data.outpaint_config_obj?.direction.includes('left') ? data.outpaint_config_obj.left || data.outpaint_config_obj.size : 0),
        right: (data.outpaint_config_obj?.direction.includes('right') ? data.outpaint_config_obj.right || data.outpaint_config_obj.size : 0),
        feathering: data.outpaint_config_obj?.mask_blur || 24,
    };
    if (workflow['44']) Object.assign(workflow['44'].inputs, outpaint_config);

    return runComfyImageJob(interaction, workflow, {
        initialContent: 'Submitting ComfyUI Flux Outpaint workflow…',
        successContent: 'Comfy backend returned file',
        async prepare(context) {
            const image_info = await context.uploadImage(
                data.attachment,
                Date.now() + '_' + data.attachment_option.name,
                data.attachment_option.contentType,
            ).catch(error => {
                console.log('Failed to upload image', error);
                return null;
            });
            if (image_info == null) throw new Error('Failed to receive input image');
            const loadImageNode = find_node_id(workflow, 'LoadImage');
            if (loadImageNode) workflow[loadImageNode].inputs.image = image_info.name;

            const { unloadForgeCheckpoint } = require('./forge_api_execute');
            await unloadForgeCheckpoint();
            return workflow;
        },
        progress: progress => comfy_progress_message(workflow, progress),
        errorContent: error => error?.error || error?.message || String(error),
    });
}

function map_outpaint_checkpoint(value) {
    return model_selection_inpaint.find(item => basename(item.value) === basename(value))?.inpaint || null;
}

async function choose_and_apply_model({
    api, interaction, request, frozenModel, frozenWasActive = false, outpaintTarget, strict = false, forceModel = false,
}) {
    const target = outpaintTarget || request.checkpoint;
    const active = api.cached_model[0];
    if (!target) {
        // No explicit checkpoint: the frozen active model is still the model
        // the LLM saw. Restore it even if another queued job evicted the JS
        // cache.
        if (normalize_model_name(active) === normalize_model_name(frozenModel) || !frozenModel) {
            return active;
        }
        const changed = await api.model_change(frozenModel, true).catch(error => {
            console.log(error);
            return false;
        });
        if (!changed) {
            throw new Error(
                `The model **${frozenModel}** that was active before prompt enhancement could not be restored.`,
            );
        }
        await interaction.channel?.send?.(
            `Active model changed to **${frozenModel}**\ncurrently cached models: ${api.cached_model.join(', ')}`,
        );
        return frozenModel;
    }

    const same = normalize_model_name(active) === normalize_model_name(target);
    const report = async (checkpoint, succeeded) => {
        if (succeeded) {
            await interaction.channel?.send?.(
                `Active model changed to **${checkpoint}**\ncurrently cached models: ${api.cached_model.join(', ')}`,
            );
        }
        else {
            await interaction.channel?.send?.(
                `Model is not cached or model change failed, fallback to **${active}**\ncurrently cached models: ${api.cached_model.join(', ')}`,
            );
        }
    };

    const force = !!outpaintTarget || (forceModel && !same);
    if (!same || force || request.checkpoint) {
        let changed = await api.model_change(target, force).catch(error => {
            console.log(error);
            return false;
        });
        if (!changed && frozenWasActive && !force) {
            // The checkpoint was active when the prompt enhancer started but
            // another job evicted it from the JS cache while we waited.
            changed = await api.model_change(target, true).catch(error => {
                console.log(error);
                return false;
            });
        }
        if (!changed) {
            if (strict) {
                throw new Error(
                    `The selected model **${target}** is not cached or could not be loaded. ` +
                    `Reference mode cannot fall back to **${active}** because its edit policy may not apply.`,
                );
            }
            await report(target, false);
            return active;
        }
        await report(target, true);
        return target;
    }

    return active;
}

function align_reference_dimensions(family, width, height, { referenceCount = 1, layout = 'native' } = {}) {
    let nextWidth = width;
    let nextHeight = height;
    if ((family === 'anima' || family === 'krea') && referenceCount > 1 && layout === 'native') {
        nextWidth = Math.max(64, Math.round(nextWidth / 64) * 64);
        nextHeight = Math.max(64, Math.round(nextHeight / 64) * 64);
    }
    if (family === 'qwen21') {
        // Qwen 2.1's VAE encoder requires even latent dimensions and the
        // official pipeline rounds output dimensions to multiples of 32.
        nextWidth = Math.max(32, Math.round(nextWidth / 32) * 32);
        nextHeight = Math.max(32, Math.round(nextHeight / 32) * 32);
    }
    return { width: nextWidth, height: nextHeight };
}

function adjust_dimensions(width, height, attachmentOption) {
    let nextWidth = width;
    let nextHeight = height;
    if (!nextHeight) {
        nextHeight = attachmentOption?.height || 1024;
    }
    if (!nextWidth) {
        nextWidth = attachmentOption?.width || 1024;
    }
    if (nextWidth > 2048 || nextHeight > 2048) {
        const ratio = nextWidth / nextHeight;
        if (nextWidth > nextHeight) {
            nextWidth = 2048;
            nextHeight = Math.floor(2048 / ratio);
        }
        else {
            nextHeight = 2048;
            nextWidth = Math.floor(2048 * ratio);
        }
    }
    if (nextHeight % 8 !== 0 || nextWidth % 8 !== 0) {
        nextHeight = Math.ceil(nextHeight / 8) * 8;
        nextWidth = Math.ceil(nextWidth / 8) * 8;
    }
    return { width: nextWidth, height: nextHeight };
}

function resolve_family_cfg(defaults) {
    if (!defaults) return null;
    // Families with cfg=1 and a separate distilled/shift value (Flux, Z-Image,
    // Krea) put the shift in cfg_scale. Klein also has cfg=1 but no dcfg, so it
    // must keep a real CFG of 1 rather than falling through to the generic 7.
    if (defaults.cfg === null || defaults.cfg === undefined) return defaults.dcfg ?? null;
    if (defaults.cfg === 1 && defaults.dcfg !== null && defaults.dcfg !== undefined) return defaults.dcfg;
    return defaults.cfg;
}

function apply_forced_img2img_defaults(model, target) {
    if (model === 'anima-turbo-v1_0.safetensors') {
        Object.assign(target, { sampler: 'ER SDE', scheduler: 'SGM Uniform', cfg_scale: 1, sampling_step: 8 });
    }
    else if (model === 'dreamshaperxl_turbo.safetensors') {
        Object.assign(target, { sampler: 'DPM++ SDE', scheduler: 'Karras', cfg_scale: 2, sampling_step: 8 });
    }
    else if (model === 'juggernautxl_turbo.safetensors') {
        Object.assign(target, { sampler: 'DPM++ 2M', scheduler: 'Karras', cfg_scale: 5, sampling_step: 30 });
    }
    else if (model === 'juggernautxl_lightning.safetensors') {
        Object.assign(target, { sampler: 'DPM++ SDE', cfg_scale: 2, sampling_step: 4 });
    }
    else if (model === 'dreamshaperxl_lightning.safetensors') {
        Object.assign(target, { sampler: 'DPM++ SDE', scheduler: 'Karras', cfg_scale: 2, sampling_step: 4 });
    }
    else if (model === 'noobaixl_vpred_v1.safetensors') {
        Object.assign(target, { sampler: 'Euler', scheduler: 'Automatic', cfg_scale: 5.5, sampling_step: 30 });
    }
    else if (model === 'noobaixl_v1_1.safetensors') {
        Object.assign(target, { sampler: 'DPM++ 2M', scheduler: 'Automatic', cfg_scale: 5.5, sampling_step: 30 });
    }
    else if (model === 'animaginexl_v40.safetensors') {
        Object.assign(target, { sampler: 'Euler a', scheduler: 'Automatic', cfg_scale: 6, sampling_step: 30 });
    }
    else if (model === 'illumiyumexl_vpred_v31.safetensors') {
        Object.assign(target, { sampler: 'Euler a', scheduler: 'SGM Uniform', cfg_scale: 5.5, sampling_step: 28 });
    }
    else if (model === 'wai_nsfw_illustrious_v120.safetensors') {
        Object.assign(target, { sampler: 'Euler a CFG++', scheduler: 'SGM Uniform', cfg_scale: 1.5, sampling_step: 28 });
    }
}

/**
 * Execute one img2img or reference-edit command.
 */
async function execute_forge_image_command(interaction, client, config = {}, deps = {}) {
    const api = resolve_api(deps);
    client = client || interaction.client;
    if (!client) throw new Error('The image command requires a Discord client');

    if (client.cooldowns?.has(interaction.user.id) && !byPassUser.includes(interaction.user.id)) {
        interaction.reply({ content: 'Please wait for cooldown to end', ephemeral: true });
        return;
    }
    await interaction.deferReply();

    const reference = config.workflow === 'reference';
    let cooldown = null;
    let applyCooldown = false;

    try {
        await api.sync_active_model();

        const profileOption = read_option(interaction, 'getString', 'profile');
        let profile = null;
        if (profileOption != null) {
            profile = await api.load_profile(profileOption, interaction.user.id).catch(error => {
                interaction.channel?.send?.(error);
                return null;
            });
        }

        const request = read_image_command_request(interaction, client, profile, {
            advanced: !!config.advanced,
            workflow: config.workflow || 'img2img',
            allowControlNet: !!config.allowControlNet,
            allowAdetailer: !!config.allowAdetailer,
            allowExtraScript: !!config.allowExtraScript,
        });

        // Flux Dev is a base generation model. Reference/edit commands need the
        // Kontext checkpoint; map explicit selections and the active model.
        let referenceReplacement = null;
        if (reference) {
            const originalReferenceModel = request.checkpoint || api.cached_model[0];
            const replacement = resolve_reference_checkpoint(originalReferenceModel);
            if (replacement !== originalReferenceModel) {
                if (request.checkpoint) request.checkpoint = replacement;
                referenceReplacement = replacement;
                const reason = basename(originalReferenceModel).startsWith('flux1-dev')
                    ? 'Flux Dev is not a reference-edit checkpoint'
                    : is_moss_int8_checkpoint(originalReferenceModel)
                        ? 'MOSS int8 checkpoints cannot apply the edit LoRA'
                        : 'The selected checkpoint is not compatible with reference editing';
                await interaction.channel?.send?.(`${reason}; using **${replacement}** for this request.`);
            }
        }

        let frozenModel = referenceReplacement || request.checkpoint || api.cached_model[0];
        let outpaintTarget = null;
        if (request.extra_script === NATIVE_OUTPAINT_SCRIPT) {
            outpaintTarget = map_outpaint_checkpoint(request.checkpoint || api.cached_model[0]);
            frozenModel = outpaintTarget || request.checkpoint || api.cached_model[0];
        }
        const frozenWasActive = normalize_model_name(api.cached_model[0]) === normalize_model_name(frozenModel);

        // Validate the edit policy (and resolve the LoRA trigger) before
        // spending an LLM call, but do it against the frozen model.
        let referencePolicy = null;
        if (reference) {
            try {
                referencePolicy = require_reference_function('getReferencePolicy', deps)(frozenModel, {
                    workflow: 'reference',
                    editVariant: request.edit_variant,
                });
            }
            catch (error) {
                await interaction.editReply({ content: error.message });
                return;
            }
        }

        const attachmentOption = request.attachment_option;
        if (!attachmentOption) {
            await interaction.editReply({ content: 'No image was provided.' });
            return;
        }

        const needsBuffer = reference || request.extra_script === 'Flux Kontext' || request.extra_script === 'Flux Outpaint';
        let attachment = await api.loadImage(
            attachmentOption.proxyURL,
            needsBuffer,
            false,
            !needsBuffer,
        ).catch(error => {
            console.log(error);
            return null;
        });
        if (!attachment) {
            await interaction.editReply({ content: 'Failed to retrieve image', ephemeral: true });
            return;
        }

        const controlnetInputs = [];
        for (const [index, option] of [
            request.controlnet_input_option,
            request.controlnet_input_option_2,
            request.controlnet_input_option_3,
        ].entries()) {
            controlnetInputs[index] = option
                ? await api.loadImage(option.proxyURL, false, false, true).catch(error => {
                    console.log(error);
                    interaction.editReply({ content: `Failed to retrieve control net image${index ? ` ${index + 1}` : ''}`, ephemeral: true });
                    return null;
                })
                : null;
        }

        const referenceBuffers = [];
        if (reference) {
            const primaryBuffer = Buffer.isBuffer(attachment) ? attachment : dataUriToBuffer(attachment);
            if (!primaryBuffer) {
                await interaction.editReply({ content: 'Failed to decode the primary reference image.' });
                return;
            }
            referenceBuffers.push(primaryBuffer);
            for (const entry of request.reference_options) {
                if (!entry.option) continue;
                const buffer = await api.loadImage(entry.option.proxyURL, true).catch(error => {
                    console.log(error);
                    interaction.editReply({ content: `Failed to retrieve reference image ${entry.slot}`, ephemeral: true });
                    return null;
                });
                if (!buffer) return;
                referenceBuffers.push(buffer);
            }
        }

        if (reference) {
            try {
                const preparePrompt = require_reference_function('prepareReferencePromptWithLLM', deps);
                request.prompt = await preparePrompt(request.prompt, frozenModel, {
                    editVariant: request.edit_variant,
                    images: referenceBuffers,
                    layout: request.reference_layout,
                    onProgress: message => interaction.editReply({ content: message }).catch(error => {
                        console.log('Unable to update reference instruction progress', error);
                    }),
                });
            }
            catch (error) {
                await interaction.editReply({ content: error.message });
                return;
            }
        }

        const sessionHash = crypt.randomBytes(16).toString('base64');
        const requestedDimensions = adjust_dimensions(request.width, request.height, attachmentOption);
        const matchReferenceSize = referencePolicy?.family === 'anima' || referencePolicy?.family === 'krea';
        const alignedDimensions = align_reference_dimensions(
            referencePolicy?.family,
            requestedDimensions.width,
            requestedDimensions.height,
            { referenceCount: referenceBuffers.length, layout: request.reference_layout },
        );
        requestedDimensions.width = alignedDimensions.width;
        requestedDimensions.height = alignedDimensions.height;
        let preparedReference = null;
        let serverIndex = -1;        if (reference) {
            serverIndex = api.get_worker_server(request.force_server_selection);
            if (serverIndex === -1) {
                await interaction.editReply({ content: 'No server is available, please try again later' });
                return;
            }
            const endpoint = server_pool[serverIndex].url;
            try {
                preparedReference = await require_reference_function('prepareReferenceInputs', deps)({
                    images: referenceBuffers,
                    layout: request.reference_layout,
                    session_hash: sessionHash,
                    endpoint,
                    direct_url: server_pool[serverIndex].direct_url,
                    width: requestedDimensions.width,
                    height: requestedDimensions.height,
                    max_side: matchReferenceSize
                        ? Math.max(requestedDimensions.width, requestedDimensions.height, REFERENCE_MAX_SIDE)
                        : REFERENCE_MAX_SIDE,
                    match_output_size: matchReferenceSize,
                });
            }
            catch (error) {
                await interaction.editReply({ content: error.message });
                return;
            }
            if (!preparedReference?.attachment) {
                await interaction.editReply({ content: 'Failed to prepare the reference images for Forge.' });
                return;
            }
            attachment = as_attachment_data_uri(preparedReference.attachment);
        }

        // LLM enhancement runs outside the Forge lease.
        try {
            const enrichment = await api.enrichImagePrompts({
                prompt: request.prompt,
                model: frozenModel,
                count: 1,
                settings: request.usersetting,
                workflow: reference ? 'ref2img' : 'img2img',
                images: reference
                    ? referenceBuffers.filter(Buffer.isBuffer)
                    : [Buffer.isBuffer(attachment) ? attachment : dataUriToBuffer(attachment)].filter(Boolean),
                onProgress: message => interaction.editReply({ content: message }).catch(() => {}),
            });
            request.prompt = enrichment.prompts[0];
        }
        catch (error) {
            await interaction.editReply({ content: 'Image prompt enrichment failed: ' + error.message });
            return;
        }

        const result = await api.withForgeSession(async () => {
            await api.sync_active_model();

            let activeModel;
            try {
                activeModel = await choose_and_apply_model({
                    api, interaction, request, frozenModel, frozenWasActive, outpaintTarget,
                    strict: reference && (!!request.checkpoint || !!referenceReplacement),
                    forceModel: reference && (!!request.checkpoint || !!referenceReplacement),
                });
            }
            catch (error) {
                await interaction.editReply({ content: error.message });
                return null;
            }

            if (api.cached_model[0].includes('_inpaint') && request.extra_script !== NATIVE_OUTPAINT_SCRIPT) {
                interaction.channel?.send?.('Active model is inpaint model, changing to main model');
                const mainModel = model_selection_inpaint
                    .find(item => item.inpaint === api.cached_model[0])?.value || api.cached_model[0];
                const changed = await api.model_change(mainModel, true).catch(error => {
                    console.log(error);
                    return false;
                });
                if (changed) {
                    await interaction.channel?.send?.(
                        `Active model changed to **${mainModel}**\ncurrently cached models: ${api.cached_model.join(', ')}`,
                    );
                    activeModel = mainModel;
                }
                else {
                    await interaction.channel?.send?.(
                        `Model is not cached or model change failed, fallback to **${api.cached_model[0]}**\n` +
                        `currently cached models: ${api.cached_model.join(', ')}`,
                    );
                }
            }
            activeModel = api.cached_model[0] || activeModel;

            let { width, height } = requestedDimensions;

            let pidPolicy = null;
            let pidConfig = null;
            let postpassPolicy = null;
            if (api.is_pid_upscaler(request.upscaler)) {
                if (request.extra_script !== 'None') {
                    await interaction.editReply({
                        content: 'PiD cannot be combined with Native Outpaint, Tiled Latent Upscale, or a Flux script. Choose one post-processing path.',
                    });
                    return null;
                }
                try {
                    pidPolicy = api.prepare_pid_upscale({
                        model: activeModel,
                        width,
                        height,
                        prompt: request.prompt,
                        degrade_sigma: 0,
                        color_correction: true,
                    });
                    if (pidPolicy.stage === 'integrated') pidConfig = pidPolicy;
                    else postpassPolicy = pidPolicy;
                }
                catch (error) {
                    await interaction.editReply({ content: error.message });
                    return null;
                }
            }

            let tiled_upscale_prepared = null;
            if (request.extra_script === TILED_UPSCALE_SCRIPT) {
                if (!request.upscale_config) {
                    await interaction.editReply({ content: 'Tiled Latent Upscale config is not set, please set it first using /wd_script_upscale' });
                    return null;
                }
                try {
                    tiled_upscale_prepared = api.prepare_tiled_upscale({
                        model: activeModel,
                        width,
                        height,
                        config: request.upscale_config,
                    });
                }
                catch (error) {
                    await interaction.editReply({ content: error.message });
                    return null;
                }
                width = tiled_upscale_prepared.width;
                height = tiled_upscale_prepared.height;
            }

            let native_outpaint_prepared = null;
            if (request.extra_script === NATIVE_OUTPAINT_SCRIPT) {
                if (!request.outpaint_config) {
                    await interaction.editReply({ content: 'Outpaint config is not set, please set it first using /wd_script_outpaint' });
                    return null;
                }
                try {
                    native_outpaint_prepared = await api.prepare_native_outpaint({
                        model: activeModel,
                        width,
                        height,
                        config: request.outpaint_config,
                        image: attachment,
                    });
                    width = native_outpaint_prepared.width;
                    height = native_outpaint_prepared.height;
                }
                catch (error) {
                    await interaction.editReply({ content: error.message });
                    return null;
                }
            }

            if (serverIndex === -1 && !reference) {
                serverIndex = api.get_worker_server(request.force_server_selection);
            }
            if (serverIndex === -1) {
                await interaction.editReply({ content: 'No server is available, please try again later' });
                return null;
            }
            const WORKER_ENDPOINT = server_pool[serverIndex].url;

            const is_xl = model_selection_xl.some(item => item.value === activeModel) ||
                native_outpaint_prepared?.family === 'xl' || tiled_upscale_prepared?.family === 'xl';
            const is_flux = model_selection_flux.some(item => item.value === activeModel);
            const is_sd15 = model_selection.some(item => item.value === activeModel);
            const is_vpred = activeModel.includes('vpred');

            if (config.advanced) {
                const familyDefaults = api.get_model_family_defaults(activeModel, 'i2i');
                if (familyDefaults) {
                    if (!request.user_sampler && !profile?.sampler && familyDefaults.sampler) request.sampler = familyDefaults.sampler;
                    if (!request.user_scheduler && !profile?.scheduler && familyDefaults.scheduler) request.scheduler = familyDefaults.scheduler;
                    if (request.user_step === null && !profile?.sampling_step && familyDefaults.step !== null) request.sampling_step = familyDefaults.step;
                    if (request.cfg_scale !== 1 && request.user_cfg === null && !profile?.cfg_scale) {
                        const familyCfg = resolve_family_cfg(familyDefaults);
                        if (familyCfg !== null) request.cfg_scale = familyCfg;
                    }
                }
            }
            else {
                const familyDefaults = api.get_model_family_defaults(activeModel, 'i2i');
                if (familyDefaults) {
                    if (familyDefaults.sampler) request.sampler = familyDefaults.sampler;
                    if (familyDefaults.scheduler) request.scheduler = familyDefaults.scheduler;
                    if (familyDefaults.step !== null) request.sampling_step = familyDefaults.step;
                    const familyCfg = resolve_family_cfg(familyDefaults);
                    if (familyCfg !== null) request.cfg_scale = familyCfg;
                }
                apply_forced_img2img_defaults(activeModel, request);
            }

            if (request.extra_script === 'Flux Outpaint') {
                Object.assign(request, { sampler: 'Euler', scheduler: 'Normal', cfg_scale: 2.5, sampling_step: 20 });
            }
            else if (request.extra_script === 'Flux Kontext') {
                Object.assign(request, { sampler: 'Euler', scheduler: 'Normal', cfg_scale: 1, sampling_step: 20 });
            }

            const outputWidth = pidPolicy ? pidPolicy.width : width;
            const outputHeight = pidPolicy ? pidPolicy.height : height;
            if (is_flux ? outputWidth * outputHeight > 1_800_000 :
                is_xl ? outputWidth * outputHeight > 1_200_000 :
                    is_sd15 ? outputWidth * outputHeight > 640_000 : outputWidth * outputHeight > 1_440_000) {
                await interaction.channel?.send?.(':warning: Image size is too large for model\'s capability and may introduce distorsion, please consider using smaller image size unless you know what you\'re doing');
            }
            if (is_vpred) {
                await interaction.channel?.send?.(':information_source: This model is using v-prediction method, which may not be compatible with every setting of the command');
            }

            const slow_samplers = ['DPM++ SDE', 'DPM++ 2M SDE', 'DPM++ 2M SDE Heun', 'Restart'];
            let compute = outputWidth * outputHeight * request.sampling_step *
                (is_flux ? 3 : (is_xl ? 1.5 : 1)) *
                (slow_samplers.includes(request.sampler) ? 1.5 : 1) *
                request.denoising_strength;
            const controlnetCount = controlnetInputs.filter(Boolean).length;
            if (controlnetCount) compute *= 1 + 0.5 * controlnetCount;
            if (config.advanced && request.do_adetailer) compute *= 1.5;
            const teacacheCheck = api.get_teacache_config_from_prompt(request.prompt, true);
            if (teacacheCheck.teacache_config) {
                compute *= Math.pow(1 - (teacacheCheck.teacache_config.threshold || 0.1), 2);
            }
            compute += request.checkpoint ? 2_000_000 : 0;
            cooldown = compute / 2_500_000;
            await interaction.editReply({
                content: `Generating image, you can create another image in ${cooldown.toFixed(2)} seconds ` +
                    `${teacacheCheck.teacache_config ? '(Teacache activated: -' + (100 * (1 - Math.pow(1 - teacacheCheck.teacache_config?.threshold || 0.1, 2))).toFixed(0) + '%)' : ''}`,
            });

            if (request.extra_script === 'Flux Outpaint') {
                if (!request.outpaint_config) {
                    await interaction.editReply({ content: 'Flux Outpaint config is not set, please set it first using /wd_script_outpaint' });
                    return null;
                }
                let outpaintConfigObject;
                try {
                    outpaintConfigObject = JSON.parse(request.outpaint_config);
                }
                catch {
                    await interaction.editReply({ content: 'Failed to parse Flux Outpaint config' });
                    return null;
                }
                api.get_teacache_config_from_prompt(request.prompt, false);
                await interaction.channel?.send?.('Flux Outpaint is selected, switching to comfy backend, not all features are supported');
                await execute_comfy_flux_outpaint(interaction, client, {
                    prompt: request.prompt,
                    neg_prompt: request.neg_prompt,
                    sampling_step: request.sampling_step,
                    cfg_scale: request.cfg_scale,
                    seed: request.seed,
                    sampler: sampler_to_comfy_name_mapping[request.sampler] ?? 'euler',
                    scheduler: scheduler_to_comfy_name_mapping[request.scheduler] ?? 'normal',
                    teacache_strength: teacacheCheck.teacache_config ? teacacheCheck.teacache_config.threshold : 0,
                    session_hash: sessionHash,
                    height,
                    width,
                    attachment,
                    attachment_option: attachmentOption,
                    outpaint_config_obj: outpaintConfigObject,
                });
                return null;
            }
            if (request.extra_script === 'Flux Kontext') {
                api.get_teacache_config_from_prompt(request.prompt, false);
                await interaction.channel?.send?.('Flux Kontext is selected, switching to comfy backend, not all features are supported');
                await execute_comfy_flux_kontext(interaction, client, {
                    prompt: request.prompt,
                    neg_prompt: request.neg_prompt,
                    sampling_step: request.sampling_step,
                    cfg_scale: request.cfg_scale,
                    seed: request.seed,
                    sampler: sampler_to_comfy_name_mapping[request.sampler] ?? 'euler',
                    scheduler: scheduler_to_comfy_name_mapping[request.scheduler] ?? 'normal',
                    teacache_strength: teacacheCheck.teacache_config ? teacacheCheck.teacache_config.threshold : 0,
                    session_hash: sessionHash,
                    height,
                    width,
                    attachment,
                    attachment_option: attachmentOption,
                });
                return null;
            }

            return await withForgeImageModeCompat({
                model: activeModel,
                workflow: reference ? 'reference' : 'denoise',
                session_hash: sessionHash,
                endpoint: WORKER_ENDPOINT,
                headers: SD_HEADERS,
                prompt: request.prompt,
                editVariant: request.edit_variant,
            }, async () => {
                if (request.controlnet_input_option && request.controlnet_config && !is_flux) {
                    await api.load_controlnet(
                        sessionHash, serverIndex,
                        controlnetInputs[0], controlnetInputs[1], controlnetInputs[2],
                        request.controlnet_config, interaction, 1,
                    ).catch(error => {
                        console.log(error);
                        interaction.editReply({ content: 'Failed to load control net:' + error });
                    });
                }

                let outpaintConfigObject = null;
                let upscaleConfigObject = null;
                if (request.extra_script === NATIVE_OUTPAINT_SCRIPT) {
                    outpaintConfigObject = native_outpaint_prepared.config;
                    await interaction.channel?.send?.(`Native Outpaint loaded (${width}x${height}, masked margins with edge blending)`);
                }
                else if (request.extra_script === TILED_UPSCALE_SCRIPT) {
                    upscaleConfigObject = tiled_upscale_prepared.config;
                    await interaction.channel?.send?.(`Tiled Latent Upscale loaded (${width}x${height}, ${upscaleConfigObject.method}, tiles ${upscaleConfigObject.tile_width}x${upscaleConfigObject.tile_height}, overlap ${upscaleConfigObject.tile_overlap})`);
                }

                const defaultNegParts = request.default_neg_prompt.split('_');
                const overrideNegPrompt = defaultNegParts[0] === 'n';
                const removeNsfwRestriction = defaultNegParts[1] === 'nsfw';
                let prompt = request.prompt;
                let negPrompt = request.neg_prompt;
                negPrompt = api.get_negative_prompt(negPrompt, overrideNegPrompt, removeNsfwRestriction, activeModel);
                prompt = api.get_prompt(prompt, removeNsfwRestriction, activeModel);

                const debugResult = api.get_debug_prompt_analyze(prompt, negPrompt);
                const daamConfig = debugResult.debug_prompt ? { prompt: debugResult.debug_prompt } : null;
                prompt = debugResult.prompt;
                negPrompt = debugResult.neg_prompt;
                if (daamConfig) interaction.channel?.send?.({ content: 'DAAM visualization enabled.' });
                let extraConfig = api.full_prompt_analyze(prompt, is_xl);
                prompt = extraConfig.prompt;
                prompt = await api.fetch_user_defined_wildcard(prompt, interaction.user.id);

                let currentWidth = width;
                let currentHeight = height;
                if (!native_outpaint_prepared && extraConfig.coupler_config &&
                    (currentHeight % 64 !== 0 || currentWidth % 64 !== 0)) {
                    interaction.channel?.send?.('Coupler detected, changing resolution to multiple of 64');
                    currentHeight = Math.ceil(currentHeight / 64) * 64;
                    currentWidth = Math.ceil(currentWidth / 64) * 64;
                    width = currentWidth;
                    height = currentHeight;
                }

                if (pidPolicy) {
                    pidPolicy = api.prepare_pid_upscale({
                        model: activeModel,
                        width,
                        height,
                        prompt,
                        degrade_sigma: 0,
                        color_correction: true,
                    });
                    if (pidPolicy.stage === 'integrated') pidConfig = pidPolicy;
                    else {
                        pidConfig = null;
                        postpassPolicy = pidPolicy;
                    }
                }

                if (extraConfig.coupler_config && extraConfig.coupler_config.mode === 'Advanced') {
                    api.preview_coupler_setting(
                        interaction, currentWidth, currentHeight, extraConfig,
                        server_pool[serverIndex].fn_index_coupler_region_preview[1], sessionHash,
                    );
                }

                const isCensor = !!((interaction.guildId && censorGuildIds.includes(interaction.guildId)) ||
                    (interaction.channel && !interaction.channel.nsfw && !optOutGuildIds.includes(interaction.guildId)));

                if (config.advanced && request.do_adetailer && request.adetailer_config) {
                    await api.load_adetailer(
                        sessionHash, serverIndex, request.adetailer_config,
                        interaction, extraConfig.coupler_config, prompt, 1,
                    ).catch(error => {
                        console.log(error);
                        interaction.editReply({ content: 'Failed to load adetailer:' + error });
                    });
                }

                if (extraConfig.use_foocus) interaction.channel?.send?.('Enhancing image with Foocus prompt expansion engine.');
                if (extraConfig.use_booru_gen) interaction.channel?.send?.('Enhancing image with BooruGen prompt expansion engine.');
                if (extraConfig.tipo_input) interaction.channel?.send?.('Enhancing image with TIPO input expansion engine.');

                let booruGenConfigObject = null;
                if (request.booru_gen_config) {
                    booruGenConfigObject = parse_json_config(request.booru_gen_config, 'BooruGen', interaction);
                    if (booruGenConfigObject.error) return null;
                }
                let colorBalanceConfigObject = null;
                if (request.colorbalance_config) {
                    colorBalanceConfigObject = parse_json_config(request.colorbalance_config, 'ColorBalance', interaction);
                    if (colorBalanceConfigObject.error) return null;
                }
                let latentModConfigObject = null;
                if (request.latentmod_config) {
                    latentModConfigObject = parse_json_config(request.latentmod_config, 'Latent Modifier', interaction);
                    if (latentModConfigObject.error) return null;
                }
                if (activeModel.toLowerCase().includes('vpred') && !latentModConfigObject) {
                    latentModConfigObject = { mode: 'simple', rescale_cfg_phi: 0.5 };
                }

                let outpaintImagePath = null;
                let outpaintMaskPath = null;
                if (native_outpaint_prepared) {
                    if (extraConfig.coupler_config) {
                        await interaction.editReply({ content: 'Native Outpaint cannot combine with Coupler regions. Remove the Coupler tags and try again.' });
                        return null;
                    }
                    try {
                        outpaintImagePath = await api.uploadPngBufferToGradio(native_outpaint_prepared.canvas, sessionHash, WORKER_ENDPOINT);
                        outpaintMaskPath = await api.uploadPngBufferToGradio(native_outpaint_prepared.mask, sessionHash, WORKER_ENDPOINT);
                    }
                    catch (error) {
                        await interaction.editReply({ content: 'Failed to upload the Native Outpaint image or mask: ' + error.message });
                        return null;
                    }
                }

                const references = Array.isArray(preparedReference?.references) ? preparedReference.references : [];
                if (reference && preparedReference?.layout && preparedReference.layout !== request.reference_layout) {
                    console.warn(`Reference helper normalized layout ${request.reference_layout} -> ${preparedReference.layout}`);
                }
                const referenceMaxSide = matchReferenceSize && references.length > 0
                    ? Math.max(requestedDimensions.width, requestedDimensions.height, REFERENCE_MAX_SIDE)
                    : REFERENCE_MAX_SIDE;
                const generationOptions = build_generation_options({
                    pid: pidConfig,
                    references,
                    reference_max_side: referenceMaxSide,
                });

                const payload = build_img2img_payload({
                    serverIndex,
                    prompt,
                    negPrompt,
                    samplingStep: request.sampling_step,
                    cfgScale: request.cfg_scale,
                    seed: request.seed,
                    sampler: request.sampler,
                    scheduler: request.scheduler,
                    sessionHash,
                    height,
                    width,
                    attachment,
                    denoisingStrength: request.denoising_strength,
                    mode: 0,
                    maskBlur: 4,
                    maskContent: 'original',
                    upscaler: (pidConfig || postpassPolicy) ? 'None' : request.upscaler,
                    useAdetailer: config.advanced ? request.do_adetailer : false,
                    couplerConfig: extraConfig.coupler_config,
                    colorGradingConfig: extraConfig.color_grading_config,
                    clipSkip: request.clip_skip,
                    enableCensor: isCensor,
                    freeuConfig: extraConfig.freeu_config,
                    dynamicThresholdConfig: extraConfig.dynamic_threshold_config,
                    pagConfig: extraConfig.pag_config,
                    inpaintArea: 'Whole picture',
                    maskPadding: 32,
                    useFoocus: config.advanced ? extraConfig.use_foocus : !overrideNegPrompt,
                    useBooruGen: extraConfig.use_booru_gen,
                    booruGenConfig: booruGenConfigObject,
                    currentModel: activeModel,
                    inpaintUploadPath: outpaintImagePath,
                    inpaintMaskUploadPath: outpaintMaskPath,
                    colorBalanceConfig: colorBalanceConfigObject,
                    userSetting: request.usersetting,
                    outpaintConfig: outpaintConfigObject,
                    upscaleConfig: upscaleConfigObject,
                    extraScript: request.extra_script,
                    detailDaemonConfig: extraConfig.detail_daemon_config,
                    tipoInput: extraConfig.tipo_input,
                    latentModConfig: latentModConfigObject,
                    mahiroConfig: extraConfig.mahiro_config,
                    teacacheConfig: extraConfig.teacache_config,
                    modulationConfig: extraConfig.modulation_config,
                    daamConfig,
                    generationOptions,
                });

                const workload = forgeWorkload({
                    taskKind: reference ? 'ref2img' : 'img2img',
                    checkpoint: activeModel,
                    width: pidPolicy ? pidPolicy.width : width,
                    height: pidPolicy ? pidPolicy.height : height,
                    ...(config.advanced ? {} : { upscaleMultiplier: 1 }),
                    useAdetailer: config.advanced && request.do_adetailer,
                    tiledVae: (pidPolicy ? pidPolicy.width * pidPolicy.height : width * height) > 3_000_000 || !!tiled_upscale_prepared,
                    features: {
                        extra_script: request.extra_script !== 'None',
                        ...(reference ? {
                            reference_layout: preparedReference?.layout || request.reference_layout,
                            reference_count: preparedReference?.imageCount ?? referenceBuffers.length,
                        } : {}),
                        ...(pidPolicy ? { pid: true, pid_stage: pidPolicy.stage } : {}),
                    },
                });

                applyCooldown = true;
                const daamHeatmapCount = daamConfig ? daamConfig.prompt.split(',').length : 0;
                return await api.runForgeImageJob({
                    interaction,
                    client,
                    serverIndex,
                    sessionHash,
                    endpoint: WORKER_ENDPOINT,
                    fnIndex: server_pool[serverIndex].fn_index_img2img,
                    abortFnIndex: server_pool[serverIndex].fn_index_abort,
                    data: payload,
                    workload,
                    customIdPrefix: reference
                        ? (config.advanced ? 'cancel_ref2img_adv_' : 'cancel_ref2img_')
                        : (config.advanced ? 'cancel_img2img_' : 'cancel_img2img_simple_'),
                    title: reference ? 'Reference Output' : 'Output',
                    daamHeatmapCount,
                    pid: pidConfig,
                    pidExpectedWidth: pidConfig?.width || null,
                    pidExpectedHeight: pidConfig?.height || null,
                    postpass: postpassPolicy ? async context => api.run_pid_postpass(context.packet, {
                        model: activeModel,
                        prompt,
                        endpoint: WORKER_ENDPOINT,
                        headers: SD_HEADERS,
                        session_hash: context.sessionHash,
                        pid: postpassPolicy,
                        daamHeatmapCount: context.daamHeatmapCount,
                        seed: context.seed,
                        shouldCancel: context.shouldCancel,
                        predict: context.predict,
                    }) : null,
                    postpassExpectedWidth: postpassPolicy?.width || null,
                    postpassExpectedHeight: postpassPolicy?.height || null,
                }, api.jobDeps);
            }, deps);
        });

        if (result?.pidWarning) {
            await interaction.channel?.send?.({ content: `:warning: ${result.pidWarning}` }).catch?.(() => {});
        }
    }
    catch (error) {
        console.log(error);
        try {
            await interaction.editReply({ content: 'Error while creating image: ' + error, components: [] });
        }
        catch (replyError) {
            console.log('cannot send error to discord', replyError);
        }
    }
    finally {
        if (applyCooldown && cooldown !== null) {
            client.cooldowns?.set(interaction.user.id, true);
            setTimeout(() => {
                client.cooldowns?.delete(interaction.user.id);
            }, cooldown);
        }
    }
}

module.exports = {
    REFERENCE_MAX_SIDE,
    REFERENCE_LAYOUTS,
    REFERENCE_EDIT_VARIANTS,
    REFERENCE_CHECKPOINT_SELECTION,
    KONTEXT_MODEL,
    MOSS_REFERENCE_MODEL,
    is_moss_int8_checkpoint,
    moss_bf16_equivalent,
    resolve_reference_checkpoint,
    align_reference_dimensions,
    resolve_family_cfg,
    read_image_command_request,
    build_generation_options,
    build_img2img_payload,
    execute_forge_image_command,
    withForgeImageModeCompat,
    map_outpaint_checkpoint,
    execute_comfy_flux_kontext,
    execute_comfy_flux_outpaint,
    load_reference_module,
    require_reference_function,
};
