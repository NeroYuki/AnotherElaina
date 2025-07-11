const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const BLANK_IMG = "data:image/png;base64,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CJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiWLjIBAgQIEDAA/AABAgQIEAgKGADB0kUmQIAAAQIGgB8gQIAAAQJBAQMgWLrIBAgQIEDAAPADBAgQIEAgKGAABEsXmQABAgQIGAB+gAABAgQIBAUMgGDpIhMgQIAAAQPADxAgQIAAgaCAARAsXWQCBAgQIGAA+AECBAgQIBAUMACCpYtMgAABAgQMAD9AgAABAgSCAgZAsHSRCRAgQICAAeAHCBAgQIBAUMAACJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiWLjIBAgQIEDAA/AABAgQIEAgKGADB0kUmQIAAAQIGgB8g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AD9AgAABAgSCAgZAsHSRCRAgQICAAeAHCBAgQIBAUMAACJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiWLjIBAgQIEDAA/AABAgQIEAgKGADB0kUmQIAAAQIGgB8gQIAAAQJBAQMgWLrIBAgQIEDAAPADBAgQIEAgKGAABEsXmQABAgQIGAB+gAABAgQIBAUMgGDpIhMgQIAAAQPADxAgQIAAgaCAARAsXWQCBAgQIGAA+AECBAgQIBAUMACCpYtMgAABAgQMAD9AgAABAgSCAgZAsHSRCRAgQICAAeAHCBAgQIBAUMAACJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiW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"

const { convert_upload_path_to_file_data } = require('./common_helper');

const server_pool = [
    {
        index: 0,
        url: process.env.BOT_ENV === 'lan' ? 'http://192.168.1.7:7860' : 'http://192.168.196.142:7860',
        fn_index_create: 566,
        fn_index_abort: 62,
        fn_index_img2img: 1246,
        fn_index_controlnet: [407, 1019],        //[txt2img, img2img, 792]  
        fn_index_controlnet_annotation: [1151, 1175],   // 1121 - 1059 = 62
        // fn_index_controlnet_2: [440, 976], 
        // fn_index_controlnet_annotation_2: [1129, 1091],
        // fn_index_controlnet_3: [487, 1025],
        // fn_index_controlnet_annotation_3: [1137, 1099],
        fn_index_interrogate: 1250,
        fn_index_interrogate_deepbooru: 1251,
        // fn_index_use_script: 1138,
        fn_index_upscale: 1367,
        fn_index_change_model: 8,
        fn_index_change_support_model: 9,
        fn_index_coupler_region_preview: [290, 900],
        fn_index_change_adetailer_model1: [88, 698],
        // fn_index_change_adetailer_prompt1: [99, 644],       //+3
        // fn_index_change_adetailer_neg_prompt1: [100, 645],  //+4
        // fn_index_change_adetailer_model2: [146, 691],       //+51
        // fn_index_change_adetailer_prompt2: [148, 693],      //+54
        // fn_index_change_adetailer_neg_prompt2: [149, 694],  //+55
        fn_index_execute_segment_anything: 958,
        // fn_index_execute_grounding_dino_preview: 877,            // -3
        // fn_index_execute_expand_mask: 881,                       // +1
        // fn_index_unload_segmentation_model: 897,                 // +17
        fn_index_rembg: 1381,
        fn_fetch_wildcards: 1382,
        is_online: true,
        queue: [],
    },
    {
        index: 1,
        url: 'http://192.168.196.78:7860',
        fn_index_create: 114,
        fn_index_abort: 45,
        fn_index_img2img: 212,
        is_online: false,
    }
]

const get_data_controlnet = (preprocessor = "None", controlnet = "None", input, weight = 1, mode = "Balanced", resolution = 512, guide_start = 0, guide_end = 1, mask = null, t_a = 100, t_b = 200) => {
    return [
        "simple",
        false,
        "",
        "",
        [],
        [],
        "",                 // annotated image
        mask || "",                     // mask
        mask ? BLANK_IMG : "",          // mask overlay
        "Both",
        input ? true : false,
        preprocessor,
        controlnet,
        weight,
        input,                  // input
        BLANK_IMG,              // input overlay
        "Crop and Resize",
        resolution,        // annotator resolution
        t_a,
        t_b,
        guide_start,
        guide_end,
        false,
        mode,
    ]
}

const get_data_controlnet_annotation = (preprocessor = "None", input, mask = null) => {
    return [
        input,                  // input
        BLANK_IMG,              // input overlay
        preprocessor,
        512,        // annotator resolution
        preprocessor === "canny" ? 100 : 0,         // threshold a (some preprocessor do not use this)
        preprocessor === "canny" ? 200 : 0,         // threshold b (some preprocessor do not use this)
        512,
        512,
        false,
        "Crop and Resize",
    ]
}

const get_data_rembg = (input, rembg_model = "birefnet-general", edge_width = 0, edge_color = "#FFFFFF", alpha_mat = false, alpha_mat_fg = 240, alpha_mat_bg = 10, 
    add_shadow = false, shadow_opacity = 0.5, shadow_blur = 5, adjust_color = false, brightness = 0, contrast = 1, saturation = 1
) => {
    return [
		"Image",
		input,
		null,
		"Image",
		rembg_model,
		"RGBA",
		alpha_mat,
		alpha_mat_fg,
		alpha_mat_bg,
		false,
		"none",
		30,
		20,
		"transparent",
		"#000000",
		null,
		null,
		false,
		0,
		edge_width > 0 ? true : false,
		edge_width,
		edge_color,
		add_shadow,
		shadow_blur,
		shadow_opacity,
		adjust_color,
		brightness,
		contrast,
		saturation,
		0,
		0,
		0,
		1,
		false,
		false,
		0,
		0,
		1,
		"",
		true,
		"PNG",
		"MP4",
		95,
		false,
		512,
		512,
		"Foreground",
		"normal"
    ]
}

const tipo_mode_to_format = (mode = "Both, tag first (recommend)") => {
    if (mode === "tag only (DTG mode)") {
        return `<|special|>, <|characters|>, <|copyrights|>, 
<|artist|>, 

<|general|>,

<|quality|>, <|meta|>, <|rating|>`
    }
    if (mode === "NL only (Tag to NL)") {
        return "<|extended|>."
    }
    if (mode === "Both, tag first (recommend)") {
        return `<|special|>, <|characters|>, <|copyrights|>, 
<|artist|>, 

<|general|>,

<|extended|>.

<|quality|>, <|meta|>, <|rating|>`
    }
    if (mode === "Both, NL first (recommend)") {
        return `<|special|>, <|characters|>, <|copyrights|>, 
<|artist|>, 

<|extended|>.

<|general|>,

<|quality|>, <|meta|>, <|rating|>`
    }
    if (mode === "Both + generated NL") {
        return `<|special|>, <|characters|>, <|copyrights|>, 
<|artist|>, 

<|generated|>.

<|general|>,

<|extended|>.

<|quality|>, <|meta|>, <|rating|>`
    }

    return null
}

const get_data_body_img2img = (index, prompt, neg_prompt, sampling_step, cfg_scale, seed, sampler, scheduler, session_hash,
    height, width, attachment, attachment2, denoising_strength, mode = 0, mask_blur = 4, mask_content = "original", upscaler = "None", 
    is_using_adetailer = false, coupler_config = null, color_grading_config = null, clip_skip = 2, enable_censor = false, 
    freeu_config = null, dynamic_threshold_config = null, pag_config = null, inpaint_area = "Whole picture", mask_padding = 32,
    use_foocus = false, use_booru_gen = false, booru_gen_config = null, is_flux = false,
    inpaint_img_upload_path = null, inpaint_mask_upload_path = null, colorbalance_config = null, do_preview = false, outpaint_config = null, 
    upscale_config = null, extra_script = "None", detail_daemon_config = null, tipo_input = null, latentmod_config = null,
    mahiro_config = null, teacache_config = null) => {
    // default mode 0 is img2img, 4 is inpainting
    // use tiled VAE if image is too large and no upscaler is used to prevent massive VRAM usage
    const shouldUseTiledVAE = ((width * height) > 3000000 && upscaler == "None") ? true : false
    const inpaint_img = convert_upload_path_to_file_data(inpaint_img_upload_path, server_pool[0].url)
    const inpaint_mask = convert_upload_path_to_file_data(inpaint_mask_upload_path, server_pool[0].url)
    // check if prompt contain "(<word>:-<decimal number>)" format
    const shouldUseNegPip = (prompt && prompt.match(/\([\w\s]+:-?\d+(\.\d+)?\)/g)) ? true : false

    if (true) {
        return [
            `task(${session_hash})`,
            mode,                      // mode (0 = img2img, 4 = inpainting)
            prompt,                 // prompt
            neg_prompt,             // neg_prompt
            [],
            (mode === 0) ? attachment : null,
            "",
            "",
            "",
            "",
            "",
            "",
            (mode === 4) ? inpaint_img : null,                   // inpaint original
            (mode === 4) ? inpaint_mask : null,                   // inpaint mask
            mask_blur,
            0,
            mask_content,
            1,
            1,
            is_flux ? 1 : cfg_scale,        // sd cfg scale
            is_flux ? cfg_scale : 1,        // distilled cfg scale
            1.5,            // still no idea what this is
            denoising_strength,
            0,
            height,
            width,
            1,
            "Crop and resize",      // resize mode
            inpaint_area,        // inpaint area
            mask_padding,         // inpaint padding
            "Inpaint masked",
            "",
            "",
            "",
            null,
            false,
            [],
            "",
            "upload",
            null,
            extra_script,
            sampling_step,
            sampler,
            scheduler,
            false,
            seed,
            false,
            -1,
            0,
            0,
            0,
            null,
            enable_censor,
            do_preview,
            is_using_adetailer,
            1,
            0.5,
            4,
            0,
            0.5,
            2,
            false,
            false,
            null,
            null,
            null,
            null,
            true,
            false,
            1,
            false,
            false,
            false,
            1.1,
            1.5,
            100,
            0.7,
            false,
            false,
            true,
            false,
            false,
            0,
            "Gustavosta/MagicPrompt-Stable-Diffusion",
            "",
            teacache_config ? true : false,		// teacache
            teacache_config?.type || "TeaCache",
            teacache_config?.threshold || 0.1,
            1,
            0,
            true,
            (coupler_config && !is_flux) ? true : false,
            coupler_config?.mode || "Basic",
            "",
            coupler_config?.direction || "Horizontal",       // direction (Horizontal or Vertical)
            coupler_config?.global || "First Line",       // use which line for global effect (First Line or Last Line or None)
            coupler_config?.global_weight || 0.5,                // global weight
            coupler_config?.adv_regions || [
                [
                    0,
                    0.5,
                    0,
                    1,
                    1
                ],
                [
                    0.5,
                    1,
                    0,
                    1,
                    1
                ]
            ],
            0.35,           // extra samplers setting, adaptive progressive
            0.75,
            0.4,
            1.5,            // langevin euler
            0.1,            // extended reverse sde
            3,
            false,          // gradient estimation
            false,
            2,
            0,
            false,
            detail_daemon_config ? true : false,           // enable detail daemon
            "both",
            detail_daemon_config?.start || 0.2,
            detail_daemon_config?.end || 0.8,
            detail_daemon_config?.bias || 0.5,
            detail_daemon_config?.amount || 0.1,
            detail_daemon_config?.exponent || 1,
            detail_daemon_config?.start_offset || 0,
            detail_daemon_config?.end_offset || 0,
            detail_daemon_config?.fade || 0,
            true,           // DD smooth schedule
            shouldUseNegPip,
            false,
            false,
            "0",
            null,
            [],
            "0",
            false,
            [],
            [],
            false,
            "0",
            "2",
            false,
            false,
            "0",
            null,
            [],
            -2,
            false,
            [],
            false,
            "0",
            null,
            null,
            (colorbalance_config && !is_flux) ? true : false,
            colorbalance_config?.alt_mode || false,
            colorbalance_config?.brightness || 0,
            colorbalance_config?.contrast || 0,
            colorbalance_config?.saturation || 1,
            colorbalance_config?.red || 0,
            colorbalance_config?.green || 0,
            colorbalance_config?.blue || 0,
            (colorbalance_config && upscale_multiplier > 1) || false,
            (colorbalance_config && is_using_adetailer) || false,
            false,
            "Straight Abs.",
            "Flat",
            use_booru_gen,          // enable DanTagGen
            "After applying other prompt processings",
            booru_gen_config?.random_seed || -1,
            booru_gen_config?.gen_length || "long",
            booru_gen_config?.ban_tags || "",
            booru_gen_config?.format || "<|special|>, \n<|characters|>, <|copyrights|>, \n<|artist|>, \n\n<|general|>, \n\n<|quality|>, <|meta|>, <|rating|>",
            booru_gen_config?.temperature || 1.35,
            booru_gen_config?.top_p || 0.9,
            booru_gen_config?.top_k || 100,
            "KBlueLeaf/DanTagGen-delta-rev2 | ggml-model-Q8_0.gguf",
            true,              // use CPU for DanTagGen
            false,
            tipo_input ? true : false,              // enable TIPO
            "After applying other prompt processings",
            booru_gen_config?.random_seed || -1,
            booru_gen_config?.tipo_tag_gen_length || "long",
            booru_gen_config?.tipo_nl_gen_length || "long",
            booru_gen_config?.ban_tags || "",
            booru_gen_config?.tipo_mode || "NL only (Tag to NL)",
            tipo_mode_to_format(booru_gen_config?.tipo_mode || "NL only (Tag to NL)") || (booru_gen_config?.tipo_mode === "custom" ?  booru_gen_config?.format : "<|extended|>."),
            booru_gen_config?.temperature || 0.5,
            booru_gen_config?.top_p || 0.95,
            booru_gen_config?.top_k || 80,
            "KBlueLeaf/TIPO-200M-ft | TIPO-200M-ft-F16.gguf",
            true,               // use CPU for TIPO
            false,
            tipo_input?.tag || "",
            tipo_input?.nl || "",
            null, 
            null,
            null,
            dynamic_threshold_config ? true : false,             // enable dynamic threshold
            dynamic_threshold_config?.mimic_scale || 7,                  // mimic scale
            dynamic_threshold_config?.mimic_percentile || 0.95,                  // mimic percentile
            "Constant",
            0,
            "Constant",
            0,
            1,
            "enable",
            "MEAN",
            "AD",
            1,
            freeu_config ? true : false,              // enable freeU
            freeu_config?.values[0] || 1.01,               // freeU B1 (flat -> depth)
            freeu_config?.values[1] || 1.02,               // freeU B2 (clean -> detail)
            freeu_config?.values[2] || 0.99,               // freeU S1 (dark -> light)
            freeu_config?.values[3] || 0.95,               // freeU S2
            false,
            0.5,
            2,
            pag_config ? true : false,                      // toggle PAG
            pag_config?.pag_scale || 3,                          // PAG scale
            false,		// HyperTile
            256,
            2,
            2,
            false,
            false,
            3,
            2,
            0,
            0.35,
            true,
            "bicubic",
            "bicubic",
            latentmod_config ? true : false,      // latent modifier
            latentmod_config?.sharpness_multiplier || 0,
            latentmod_config?.sharpness_method || "anisotropic",
            latentmod_config?.tonemap_multiplier || 0,
            latentmod_config?.tonemap_method || "reinhard",
            latentmod_config?.tonemap_percentile || 100,
            latentmod_config?.contrast_multiplier || 0,
            latentmod_config?.contrast_method || "subtract",
            latentmod_config?.combat_cfg_drift || 0,
            latentmod_config?.rescale_cfg_phi || 0,
            latentmod_config?.extra_noise_type || "gaussian",
            latentmod_config?.extra_noise_method || "add",
            latentmod_config?.extra_noise_multiplier || 0,
            latentmod_config?.extra_noise_lowpass || 100,
            latentmod_config?.divisive_norm_size || 127,
            latentmod_config?.divisive_norm_multiplier || 0,
            latentmod_config?.spectral_mod_mode || "hard_clamp",
            latentmod_config?.spectral_mod_percentile || 5,
            latentmod_config?.spectral_mod_multiplier || 0,
            latentmod_config?.affect_uncond || "None",
            latentmod_config?.dyncfg_augment || "None",
            mahiro_config?.mahiro || false,			// mahiro guidance
            false,
            "MultiDiffusion",
            768,
            768,
            64,
            4,
            false,
            1,
            false,
            false,
            "m + (M-m)*(1-x)**3",
            "* `CFG Scale` should be 2 or lower.",
            true,
            true,
            "",
            "",
            true,
            50,
            true,
            1,
            0,
            false,
            4,
            0.5,
            "Linear",
            "None",
            "<p style=\"margin-bottom:0.75em\">Recommended settings: Sampling Steps: 80-100, Sampler: Euler a, Denoising strength: 0.8</p>",
            outpaint_config?.size || 128,       // outpainting mk2
            outpaint_config?.mask_blur || 8,
            // parse direction string "LRUD" (in any order, any case) to array ["left", "right", "up", "down"]
            outpaint_config?.direction || ["left", "right", "up", "down"],
            outpaint_config?.falloff_exp || 1,
            outpaint_config?.color_var || 0.05,
            128,                            // poor man's outpaint
            4,
            "fill",
            [
                "left",
                "right",
                "up",
                "down"
            ],
            false,
            false,
            "positive",
            "comma",
            0,
            false,
            false,
            "start",
            "",
            "<p style=\"margin-bottom:0.75em\">Will upscale the image by the selected scale factor; use width and height sliders to set tile size</p>",
            64,
            "None",
            2,
            "Seed",
            "",
            "",
            "Nothing",
            "",
            "",
            "Nothing",
            "",
            "",
            true,
            false,
            false,
            false,
            false,
            false,
            false,
            0,
            false,
            5,
            1.25,
            true,
            "16bpc",
            ".tiff",
            1.2,
            "<p style=\"margin-bottom:0.75em\">Will upscale the image depending on the selected target size type</p>",
            upscale_config?.tile_width || 1024,       // upscale
            upscale_config?.tile_height || 0,
            upscale_config?.mask_blur || 16,
            upscale_config?.padding || 32,
            upscale_config?.seam_fix_width || 64,
            upscale_config?.seam_fix_denoise || 0.35,
            upscale_config?.seam_fix_padding || 32,
            upscale_config?.upscaler || "R-ESRGAN 4x+",
            true,
            upscale_config?.tile_pattern || "Linear",
            false,
            upscale_config?.seam_fix_mask_blur || 8,
            upscale_config?.seam_fix || "None", 
            "Scale from image size",
            2048,
            2048,
            upscale_config?.scale || 2,
        ]
    }
}

const get_data_body = (index, prompt, neg_prompt, sampling_step, cfg_scale, seed, sampler, scheduler, session_hash,
    height, width, upscale_multiplier, upscaler, upscale_denoise_strength, upscale_step, face_restore = false, is_using_adetailer = false, 
    coupler_config = null, color_grading_config = null, clip_skip = 2, enable_censor = false, 
    freeu_config = null, dynamic_threshold_config = null, pag_config = null, use_foocus = false, use_booru_gen = false, booru_gen_config = null, 
    is_flux = false, colorbalance_config = null, do_preview = false, detail_daemon_config = null, tipo_input = null, latentmod_config = null,
    mahiro_config = null, teacache_config = null, batch_count = 1, batch_size = 1) => {

    // use tiled VAE if image is too large and no upscaler is used to prevent massive VRAM usage
    const shouldUseTiledVAE = ((width * height) > 1600000) ? true : false
    // check if prompt contain "(<word>:-<decimal number>)" format
    const shouldUseNegPip = (prompt && prompt.match(/\([\w\s]+:-?\d+(\.\d+)?\)/g)) ? true : false

    console.log(upscale_multiplier, upscaler, upscale_denoise_strength, upscale_step)
    if (true) {
        return [
            `task(${session_hash})`,
            prompt,
            neg_prompt,
            [],
            batch_count,
            batch_size,
            is_flux ? 1 : cfg_scale,
            is_flux ? cfg_scale : 3.5,
            height,
            width,
            upscale_multiplier > 1 ? true : false,      // Hires fix
            upscale_denoise_strength,    
            upscale_multiplier,
            upscaler,
            upscale_step,
            0,
            0,
            "Use same checkpoint",
            "Use same sampler",
            "Use same scheduler",
            "",
            "",
            null,
            "None",
            sampling_step,
            sampler,
            scheduler,
            false,  // refiner?
            seed,
            false,
            -1,     // variation seed
            0,
            0,
            0,
            null, // no idea (maybe clip skip?)
            enable_censor,
            do_preview,
            is_using_adetailer,
            false,
            null,
            null,
            null,
            null,
            true,       // dynamic prompt
            false,
            1,
            false,
            false,
            false,  // magic prompt (dynamic prompt)
            1.1,
            1.5,
            100,
            0.7,
            false,
            false,
            true,
            false,
            false,
            0,
            "Gustavosta/MagicPrompt-Stable-Diffusion",
            "",
            teacache_config ? true : false,		// teacache
            teacache_config?.type || "TeaCache",
            teacache_config?.threshold || 0.1,
            1,
            0,
            true,
            (coupler_config && !is_flux) ? true : false,        // forge coupler
            coupler_config?.mode || "Basic",
            "",
            coupler_config?.direction || "Horizontal",       // direction (Horizontal or Vertical)
            coupler_config?.global || "First Line",       // use which line for global effect (First Line or Last Line or None)
            coupler_config?.global_weight || 0.5,                // global weight
            coupler_config?.adv_regions || [
                [
                    0,
                    0.5,
                    0,
                    1,
                    1
                ],
                [
                    0.5,
                    1,
                    0,
                    1,
                    1
                ]
            ],
            0.35,           // extra samplers setting, adaptive progressive
            0.75,
            0.4,
            1.5,            // langevin euler
            0.1,            // extended reverse sde
            3,
            false,          // gradient estimation
            false,
            2,
            0,
            false,
            detail_daemon_config ? true : false,           // enable detail daemon
            "both",
            detail_daemon_config?.start || 0.2,
            detail_daemon_config?.end || 0.8,
            detail_daemon_config?.bias || 0.5,
            detail_daemon_config?.amount || 0.1,
            detail_daemon_config?.exponent || 1,
            detail_daemon_config?.start_offset || 0,
            detail_daemon_config?.end_offset || 0,
            detail_daemon_config?.fade || 0,
            true,           // DD smooth schedule
            shouldUseNegPip,       // use NegPip
            false,      // segment anything?
            false,
            "0",
            null,
            [],
            "0",
            false,
            [],
            [],
            false,
            "0",
            "2",
            false,
            false,
            "0",
            null,
            [],
            -2,
            false,
            [],
            false,
            "0",
            null,
            null,
            (colorbalance_config && !is_flux) ? true : false,
            colorbalance_config?.alt_mode || false,
            colorbalance_config?.brightness || 0,
            colorbalance_config?.contrast || 0,
            colorbalance_config?.saturation || 1,
            colorbalance_config?.red || 0,
            colorbalance_config?.green || 0,
            colorbalance_config?.blue || 0,
            (colorbalance_config && upscale_multiplier > 1) || false,
            (colorbalance_config && is_using_adetailer) || false,
            false,
            "Straight Abs.",
            "Flat",
            use_booru_gen,          // enable DanTagGen
            "After applying other prompt processings",
            booru_gen_config?.random_seed || -1,
            booru_gen_config?.gen_length || "long",
            booru_gen_config?.ban_tags || "",
            booru_gen_config?.format || "<|special|>, \n<|characters|>, <|copyrights|>, \n<|artist|>, \n\n<|general|>, \n\n<|quality|>, <|meta|>, <|rating|>",
            booru_gen_config?.temperature || 1.35,
            booru_gen_config?.top_p || 0.9,
            booru_gen_config?.top_k || 100,
            "KBlueLeaf/DanTagGen-delta-rev2 | ggml-model-Q8_0.gguf",
            true,              // use CPU for DanTagGen
            false,
            tipo_input ? true : false,              // enable TIPO
            "After applying other prompt processings",
            booru_gen_config?.random_seed || -1,
            booru_gen_config?.tipo_tag_gen_length || "long",
            booru_gen_config?.tipo_nl_gen_length || "long",
            booru_gen_config?.ban_tags || "",
            booru_gen_config?.tipo_mode || "NL only (Tag to NL)",
            tipo_mode_to_format(booru_gen_config?.tipo_mode || "NL only (Tag to NL)") || (booru_gen_config?.tipo_mode === "custom" ?  booru_gen_config?.format : "<|extended|>."),
            booru_gen_config?.temperature || 0.5,
            booru_gen_config?.top_p || 0.95,
            booru_gen_config?.top_k || 80,
            "KBlueLeaf/TIPO-200M-ft | TIPO-200M-ft-F16.gguf",
            true,               // use CPU for TIPO
            false,
            tipo_input?.tag || "",
            tipo_input?.nl || "",
            null,       // ControlNet
            null,
            null,
            dynamic_threshold_config ? true : false,              // enable dynamic threshold
            dynamic_threshold_config?.mimic_scale || 7,                  // mimic scale
            dynamic_threshold_config?.mimic_percentile || 0.95,                  // mimic percentile
            "Constant",
            0,
            "Constant",
            0,
            1,
            "enable",
            "MEAN",
            "AD",
            1,
            freeu_config ? true : false,              // enable freeU
            freeu_config?.values[0] || 1.01,               // freeU B1 (flat -> depth)
            freeu_config?.values[1] || 1.02,               // freeU B2 (clean -> detail)
            freeu_config?.values[2] || 0.99,               // freeU S1 (dark -> light)
            freeu_config?.values[3] || 0.95,               // freeU S2
            false,
            0.5,
            2,
            pag_config ? true : false,                      // toggle PAG
            pag_config?.pag_scale || 3,                          // PAG scale
            false,		// HyperTile
            256,
            2,
            2,
            false,
            false,      // HR fix
            3,          
            2,
            0,
            0.35,
            true,
            "bicubic",
            "bicubic",
            latentmod_config ? true : false,      // latent modifier
            latentmod_config?.sharpness_multiplier || 0,
            latentmod_config?.sharpness_method || "anisotropic",
            latentmod_config?.tonemap_multiplier || 0,
            latentmod_config?.tonemap_method || "reinhard",
            latentmod_config?.tonemap_percentile || 100,
            latentmod_config?.contrast_multiplier || 0,
            latentmod_config?.contrast_method || "subtract",
            latentmod_config?.combat_cfg_drift || 0,
            latentmod_config?.rescale_cfg_phi || 0,
            latentmod_config?.extra_noise_type || "gaussian",
            latentmod_config?.extra_noise_method || "add",
            latentmod_config?.extra_noise_multiplier || 0,
            latentmod_config?.extra_noise_lowpass || 100,
            latentmod_config?.divisive_norm_size || 127,
            latentmod_config?.divisive_norm_multiplier || 0,
            latentmod_config?.spectral_mod_mode || "hard_clamp",
            latentmod_config?.spectral_mod_percentile || 5,
            latentmod_config?.spectral_mod_multiplier || 0,
            latentmod_config?.affect_uncond || "None",
            latentmod_config?.dyncfg_augment || "None",
            mahiro_config?.mahiro || false,			// mahiro guidance
            false,
            "MultiDiffusion",
            768,
            768,
            64,
            4,
            false,      // style align
            1,
            false,      // never OOM
            false,
            "m + (M-m)*(1-x)**3",
            false,      // extra script (default)
            false,
            "positive",
            "comma",
            0,
            false,
            false,
            "start",
            "",
            "Seed",
            "",
            "",
            "Nothing",
            "",
            "",
            "Nothing",
            "",
            "",
            true,
            false,
            false,
            false,
            false,
            false,
            false,
            0,
            false,
            5,
            1.25,
            true,
            "16bpc",
            ".tiff",
            1.2
        ]
    }
}

const model_name_hash_mapping = new Map([
    ["362dae27f8", "RefSlave v2"],
    ["bd518b9aee", "CetusMix v3 (Coda)"],
    ["fbcf965a62", "Anything v4.5"],
    ["a074b8864e", "Counterfeit v2.5"],
    ["e03274b1e7", "MeinaMix v7"],
    ["d01a68ae76", "PastelMix v2.1"],
    ["4b118b2d1b", "Yozora v1"],
    ["f303d10812", "AbyssOrangeMix v3 A1"],
    ["7f96a1a9ca", "Anything v5"],
    ["4d957c560b", "Anime-like 2D v2"],
    ["cca17b08da", "DarkSushiMix"],
    ["68c0a27380", "CetusMix (Coda v2)"],
    ["d77922554c", "Momokos v1"],
    ["6ee4f31532", "CuteYukiMix"],
    ["6292dd40d6", "MeinaPastel v6"],
    ['40a9f4ec37', "9527 v1"],
    ['b334cb73d8', "HimawariMix v8"],
    ['52cb3c2e67', "Azure Blue v1.2 (SDXL)"],
    ['31e35c80fc', "SDXL Base v1"],
    ['8263f26927', "IrisMix v5b"],
    ['b8d6d19b35', "ChromaNeoFT v2"],
    ['6f4f816f9d', "AnimagineXL v1"],
    ['c5f2372baf', "HimawariMix XL v1"],
    ['c53dabc181', "NekorayXL v0.6"],
    ['f301898175', "X2AnimeXL v2"],
    ['51a0c178b7', "KohakuXL v0.7b"],
    ['1449e5b0b9', "AnimagineXL v3"],
    ['d48c2391e0', "AAMXL v1"],
    ['8238e80fdd', "AAMXL Turbo"],
    ['c9e3e68f89', "Juggernaut XL"],
    ['4496b36d48', "Dreamshaper XL Turbo"],
    ['54ef3e3610', "MeinaMix v11"],
    ['322526e7d1', "HimawariMixXL v6"],
    ['e3c47aedb0', "AnimagineXL v3.1"],
    ['8421598e93', "Anything XL v1"],
    ['67ab2fd8ec', "PonyDiffusionXL v6"],
    ['c8df560d29', "Juggernaut Lightning"],
    ['fdbe56354b', "Dreamshaper XL Lightning"],
    ['516047db97', "KohakuXL Epsilon"],
    ['73ed24bde3', "ArtiWaifu v1"],
    ['b1689257e6', "Juggernaut XL Inpaint"],
    ['ddb3b8b7d6', "AnimagineXL v3.1 Inpaint"],
    ['eae6ac778c', "ChimeraXL v2"],
])
// limit at 25 (probably less due to character limitation)
const model_selection = [
    { name: 'Pastel Mix v2.1', value: 'pastelmix.safetensors' },
    { name: 'Counterfeit v2.5', value: 'counterfeit.safetensors' },
    { name: 'MeinaMix v11', value: 'archive/meinamix_v11.safetensors' },
    { name: 'HimawariMix v8', value: 'himawarimix.safetensors' },
    { name: 'Anything v5', value: 'anythingv5.safetensors' },
    { name: 'CetusMix (Coda v2)', value: 'archive/cetusmix_coda2.safetensors' },
    { name: 'RichyRichMix v2', value: 'archive/richyrichmix_v2.safetensors' },
    { name: 'CuteYukiMix', value: 'archive/cuteyukimix.safetensors' },
    { name: 'IrisMix v5b', value: 'archive/irismix_v5b.safetensors'},
]

// if model is in this list, remove it when construct the model selection
const model_selection_legacy = [
    { name: 'Counterfeit v2.5', value: 'counterfeit.safetensors' },
    { name: 'Anything v5', value: 'anythingv5.safetensors' },
    { name: 'CetusMix (Coda v2)', value: 'archive/cetusmix_coda2.safetensors' },
    { name: 'MeinaMix v11', value: 'archive/meinamix_v11.safetensors' },
    { name: 'RichyRichMix v2', value: 'archive/richyrichmix_v2.safetensors' },
    { name: 'CuteYukiMix', value: 'archive/cuteyukimix.safetensors' },
    { name: 'IrisMix v5b', value: 'archive/irismix_v5b.safetensors'},
    { name: 'KohakuXL Zeta', value: 'archive/kohakuxl_zeta.safetensors'},
    { name: 'Dreamshaper XL Lightning', value: 'archive/dreamshaperxl_lightning.safetensors'},
    { name: 'PonyDiffusionXL v6', value: 'archive/ponydiffusionxl_v6.safetensors'},
    { name: 'PonyRealism v2.2', value: 'archive/ponyrealism_v22.safetensors'},
    { name: 'IllusionBreed v3', value: 'illusionbreed_vpred_v30.safetensors'},
    { name: 'AnimagineXL v3', value: 'archive/animaginexl_v3.safetensors'},
    { name: 'NekorayXL v0.6', value: 'archive/nekorayxl.safetensors' },
    { name: 'ArtiWaifu v2', value: 'archive/artiwaifu_v2.safetensors'},
    { name: 'IllustriousXL v1', value: 'archive/Illustriousxl_v10.safetensors'},
    { name: 'IllustriousXL v1.1', value: 'archive/Illustriousxl_v11.safetensors'},
    { name: 'WAI-NSFW-IllustriousXL v10', value: 'archive/wai_nsfw_illustrious_v100.safetensors'},
    { name: 'RealVisXL v5', value: 'archive/realvisxl_v5.safetensors'},
    { name: 'SilenceMix v1', value: 'archive/silencemix_v10.safetensors'},
    { name: 'Flux.dev Q4_K_S', value: 'archive/flux1-dev-Q4_K_S.gguf' },
    { name: 'PrefectPony v5.0', value: 'archive/prefectpony_v50.safetensors'},
    { name: 'AutismMix PonyXL', value: 'archive/autismmix_ponyxl.safetensors'},
    { name: 'IllumiyumeXL V-pred v3.2' , value: 'illumiyumexl_vpred_v32.safetensors'},
]

const model_selection_xl = [
    { name: 'PrefectPony v5.0', value: 'archive/prefectpony_v50.safetensors'},
    { name: 'AutismMix PonyXL', value: 'archive/autismmix_ponyxl.safetensors'},
    { name: 'NoobAIXL v1.1', value: 'noobaixl_v1_1.safetensors'},
    { name: 'NoobAIXL V-pred v1.0', value: 'noobaixl_vpred_v1.safetensors'},
    { name: 'NekorayXL v0.6', value: 'archive/nekorayxl.safetensors' },
    { name: 'AnimagineXL v4', value: 'animaginexl_v40_opt.safetensors' },
    { name: 'AnimagineXL v3', value: 'archive/animaginexl_v3.safetensors'},
    { name: 'AnimagineXL v3.1', value: 'animaginexl_v31.safetensors'},
    { name: 'ChimeraXL v2', value: 'chimera2_xl.safetensors'},
    { name: 'KohakuXL Zeta', value: 'archive/kohakuxl_zeta.safetensors'},
    { name: 'Juggernaut XL', value: 'archive/juggernautxl_turbo.safetensors'},
    { name: 'PonyRealism v2.2', value: 'archive/ponyrealism_v22.safetensors'},
    { name: 'Dreamshaper XL Lightning', value: 'archive/dreamshaperxl_lightning.safetensors'},
    { name: 'RealVisXL v5', value: 'archive/realvisxl_v5.safetensors'},
    { name: 'StableYogis Realism v4', value: 'stableyogi_realism_v40.safetensors'},
    { name: 'PonyDiffusionXL v6', value: 'archive/ponydiffusionxl_v6.safetensors'},
    { name: 'SilverMoonMix3 v2', value: 'silvermoonmix03_v20.safetensors'},
    { name: 'IllusionBreed v3', value: 'illusionbreed_vpred_v30.safetensors'},
    { name: 'SilenceMix v1', value: 'archive/silencemix_v10.safetensors'},
    { name: 'SilenceMix v3', value: 'silencemix_v30.safetensors'},
    { name: 'ZukiCuteIL v5', value: 'zukicuteil_v50.safetensors'},
    { name: 'ZukiNewCuteIL v1', value: 'zukinewcuteil_v10.safetensors'},
    { name: 'ArtiWaifu v2', value: 'archive/artiwaifu_v2.safetensors'},
    { name: 'IllustriousXL v1', value: 'archive/Illustriousxl_v10.safetensors'},
    { name: 'IllustriousXL v1.1', value: 'archive/Illustriousxl_v11.safetensors'},
    { name: 'IllustriousXL v2.0', value: 'Illustriousxl_v20.safetensors'},
    { name: 'WAI-NSFW-IllustriousXL v10', value: 'archive/wai_nsfw_illustrious_v100.safetensors'},
    { name: 'WAI-NSFW-IllustriousXL v12', value: 'wai_nsfw_illustrious_v120.safetensors'},
    { name: 'CatTower NoobAIXL V-pred v1.5' , value: 'cattowernoobaixl_vpred_v15.safetensors'},
    { name: 'IllumiyumeXL V-pred v3.1' , value: 'illumiyumexl_vpred_v31.safetensors'},
    { name: 'IllumiyumeXL V-pred v3.2' , value: 'illumiyumexl_vpred_v32.safetensors'},
    { name: 'NoobAIXL MDNT V-pred v1.0' , value: 'noobaixl_mdnt_vpred_v1.safetensors'},
    { name: 'Rouwei V-pred v0.8' , value: 'archive/rouwei_vpred_v0_8.safetensors'},
    { name: 'ColorPalette v1' , value: 'colorpalette_v10.safetensors'},
]

const model_selection_inpaint = [
    { value: 'animaginexl_v31.safetensors', inpaint: 'animaginexl_v31_inpaint.safetensors'},
    { value: 'archive/juggernautxl_turbo.safetensors', inpaint: 'juggernautxl_inpaint.safetensors'},
    { value: 'archive/realvisxl_v5.safetensors', inpaint: 'archive/realvisxl_v3_inpaint.safetensors'}
]

const model_selection_flux = [
    { name: 'Flux.dev Q4_K_S', value: 'archive/flux1-dev-Q4_K_S.gguf' },
    { name: 'Flux.dev Q6_K', value: 'flux1-dev-Q6_K.gguf' },
    { name: 'Flux.dev Q8_0', value: 'flux1-dev-Q8_0.gguf'},
    { name: 'Pixelwave Flux v3 Q8_0', value: 'pixelwave-flux-Q8_0.gguf'}
]

const model_selection_curated = [
    { name: 'NoobAIXL v1.1', value: 'noobaixl_v1_1.safetensors'},
    { name: 'WAI-NSFW-IllustriousXL v12', value: 'wai_nsfw_illustrious_v120.safetensors'},
    { name: 'IllumiyumeXL V-pred v3.1' , value: 'illumiyumexl_vpred_v31.safetensors'},
    { name: 'StableYogis Realism v4', value: 'stableyogi_realism_v40.safetensors'},
    { name: 'Flux.dev Q6_K', value: 'flux1-dev-Q6_K.gguf' },
    { name: 'Pastel Mix v2.1', value: 'pastelmix.safetensors' },
]

const controlnet_preprocessor_selection = [
    { name: 'None', value: 'None' },
    { name: 'Canny', value: 'canny' },
    { name: 'Depth', value: 'depth_anything_v2' },
    { name: 'Depth (LERes)', value: 'depth_leres++' },
    { name: 'Depth (MiDaS)', value: 'depth_midas' },
    { name: 'HED', value: 'softedge_hed' },
    { name: 'Lineart Anime', value: 'lineart_anime' },
    { name: 'OpenPose', value: 'dw_openpose' },
    { name: 'OpenPose (Hand)', value: 'dw_openpose_hand' },
    { name: 'OpenPose (Full)', value: 'dw_openpose_full' },
    { name: 'Segmentation', value: 'seg_ufade20k' },
    { name: 'Tile Resample', value: 'tile_resample' },
    { name: 'CLIP H (IPAdapter)', value: 'CLIP-ViT-H (IPAdapter)' },
    { name: 'CLIP Vision', value: 't2ia_style_clipvision' },
    { name: 'Color', value: 't2ia_color_grid' },
    { name: 'Sketch', value: 't2ia_sketch_pidi' },
    { name: 'Threshold', value: 'threshold' },
    { name: 'Shuffle', value: 'shuffle' },
    { name: 'Blur (Gaussian)', value: 'blur_gaussian' },
    { name: 'Fill', value: 'fill'},
    { name: 'CLIP G (IPAdapter)', value:'CLIP-ViT-bigG (IPAdapter)'}
]

const controlnet_model_selection = [
    { name: 'None', value: 'None' },
    { name: 'T2I-Adapter - Canny', value: 't2i_canny' },
    { name: 'T2I-Adapter - Color', value: 't2i_color' },
    { name: 'T2I-Adapter - Depth', value: 't2i_depth' },
    { name: 'T2I-Adapter - OpenPose', value: 't2i_openpose' },
    { name: 'T2I-Adapter - Seg (SD only)', value: 't2i_segment' },
    { name: 'T2I-Adapter - Sketch', value: 't2i_sketch' },
    { name: 'T2I-Adapter - Style (SD only)', value: 't2i_style' },
    { name: 'ControlNet - OpenPose', value: 'controlnet_openpose'},
    { name: 'ControlNet - OpenPose Accuracy (SDXL only)', value: 'controlnet_openpose_accuracy'},
    { name: 'ControlNet - SoftEdge', value: 'controlnet_softedge'},
    { name: 'ControlNet - Lineart Anime', value: 'controlnet_lineart_anime'},
    { name: 'ControlNet - Tile', value: 'controlnet_tile'},
    { name: 'IPAdapter', value: 'ipadapter'},
    { name: 'InstantID - Keypoint (SDXL only)', value: 'instantid_keypoint'},
    { name: 'InstantID - IPAdapter (SDXL only)', value: 'instantid_ipadapter'},
    { name: 'ControlNet - Union (SDXL only)', value: 'controlnet_union'},
    { name: 'ControlNet - Inpaint', value: 'controlnet_inpaint'},
]

const controlnet_model_selection_sd = [
    { name: 'None', value: 'None' },
    { name: 't2i_canny', value: 't2iadapter_canny_sd14v1 [80bfd79b]' },
    { name: 't2i_color', value: 't2iadapter_color_sd14v1 [8522029d]' },
    { name: 't2i_depth', value: 't2iadapter_depth_sd14v1 [fa476002]' },
    { name: 't2i_openpose', value: 't2iadapter_openpose_sd14v1 [7e267e5e]' },
    { name: 't2i_segment', value: 't2iadapter_seg_sd14v1 [6387afb5]' },
    { name: 't2i_sketch', value: 't2iadapter_sketch_sd14v1 [e5d4b846]' },
    { name: 't2i_style', value: 't2iadapter_style_sd14v1 [202e85cc]' },
    { name: 'controlnet_openpose', value: 'control_v11p_sd15_openpose [cab727d4]'},
    { name: 'controlnet_softedge', value: 'control_v11p_sd15_softedge [a8575a2a]'},
    { name: 'controlnet_lineart_anime', value: 'control_v11p_sd15s2_lineart_anime [3825e83e]'},
    { name: 'controlnet_tile', value: 'control_v11f1e_sd15_tile [04595688]'},
    { name: 'ipadapter', value: 'ip-adapter_sd15_plus [32cd8f7f]'},
    { name: 'controlnet_inpaint', value: 'controlnet11Models_inpaint [be8bc0ed]'},
]

const controlnet_model_selection_xl = [
    { name: 'None', value: 'None' },
    { name: 't2i_canny', value: 'kohya_controllllite_xl_canny [2ed264be]' },
    { name: 't2i_color', value: 'bdsqlsz_controlllite_xl_t2i-adapter_color_shuffle [8ff329d6]' },
    { name: 't2i_depth', value: 'kohya_controllllite_xl_depth [9f425a8d]' },
    { name: 't2i_openpose', value: 't2i-adapter_xl_openpose [18cb12c1]' },
    { name: 't2i_sketch', value: 't2i-adapter_diffusers_xl_sketch [72b96ab1]' },
    { name: 'controlnet_openpose', value: 'controlnetxlCNXL_xinsirOpenpose [d0333a45]'},
    { name: 'controlnet_openpose_accuracy', value: 'controlnetxlCNXL_xinsirOpenposeTwins [590eff90]'},
    { name: 'controlnet_softedge', value: 'bdsqlsz_controlllite_xl_softedge [c28ff1c4]'},
    { name: 'controlnet_lineart_anime', value: 't2i-adapter_diffusers_xl_lineart [bae0efef]'},
    { name: 'controlnet_tile', value: 'controlnetxlCNXL_xinsirTile [4d6257d3]'},
    //{ name: 'ipadapter', value: 'ip-adapter_xl [4209e9f7]'},
    { name: 'ipadapter', value: 'noobIPAMARK1_mark1 [13579d81]'},
    { name: 'instantid_keypoint', value: 'control_instant_id_sdxl [c5c25a50]'},
    { name: 'instantid_ipadapter', value: 'ip-adapter_instant_id_sdxl [eb2d3ec0]'},
    { name: 'controlnet_union', value: 'controlnetxlCNXL_xinsirUnion_promax [9460e4db]'},
    { name: 'controlnet_inpaint', value: 'controlnetxlCNXL_destitechInpaintv2 [e799aa20]'},
]

const controlnet_model_selection_flux = [
    { name: 'None', value: 'None' },
]

const upscaler_selection = [
    { name: 'Lanczos - Fast', value: 'Lanczos' },
    { name: 'ESRGAN_4x', value: 'ESRGAN_4x' },
    { name: 'R-ESRGAN 4x+', value: 'R-ESRGAN 4x+' },
    { name: 'R-ESRGAN 4x+ Anime6B', value: 'R-ESRGAN 4x+ Anime6B' },
    { name: 'SwinIR 4x', value: 'SwinIR_4x' },
    { name: 'AnimeSharp 4x', value: '4x_AnimeSharp' },
    { name: 'AnimeSharp v3 2x', value: '2x-AnimeSharpV3' },
    { name: 'UltraSharp 4x', value: '4x_UltraSharp' },
    { name: 'NMKD-Siax 4x', value: '4x_NMKD-Siax_200k' },
]

const sampler_selection = [
    { name: 'Euler a', value: 'Euler a' },
    { name: 'Euler a CFG++', value: 'Euler a CFG++' },
    { name: 'Euler', value: 'Euler' },
    //{ name: 'Euler Dy CFG++', value: 'Euler Dy CFG++' },
    { name: 'Euler SMEA Dy CFG++', value: 'Euler Dy SMEA CFG++' },
    { name: 'DPM++ SDE', value: 'DPM++ SDE' },
    //{ name: 'LMS', value: 'LMS' },
    { name: 'DPM++ 2S a', value: 'DPM++ 2S a' },
    { name: 'DPM2 a', value: 'DPM2 a' },
    { name: 'DPM++ 2M', value: 'DPM++ 2M' },
    { name: 'LCM', value: 'LCM' },
    { name: 'UniPC', value: 'UniPC' },
    { name: 'Restart', value: 'Restart' },
    //{ name: 'DPM fast', value: 'DPM fast' },
    { name: 'DPM adaptive', value: 'DPM adaptive' },
    { name: 'DPM++ 2M SDE', value: 'DPM++ 2M SDE' },
    { name: 'DPM++ 2M SDE Heun', value: 'DPM++ 2M SDE Heun' },
    { name: 'DEIS', value: 'DEIS' }, 
    { name: 'DPM++ 4M SDE', value: 'DPM++ 4M SDE' },
    { name: 'Refined Exponential Solver', value: 'Refined Exponential Solver' },
    { name: 'Res Multistep Ancestral', value: 'Res Multistep Ancestral' },
    { name: 'Euler a Multipass', value: 'Euler a Multipass' },
    //{ name: 'Extended Reverse-Time SDE', value: 'Extended Reverse-Time SDE' },
    { name: 'Gradient Estimation', value: 'Gradient Estimation' },
    { name: 'Heun Ancestral', value: 'Heun Ancestral' },
    { name: 'Kohaku LoNyu Yog', value: 'Kohaku LoNyu Yog' },
    { name: 'Langevin Euler', value: 'Langevin Euler' },
    { name: 'Euler Max', value: 'Euler Max' }
]

const scheduler_selection = [
    { name: 'Automatic', value: 'Automatic' },
    { name: 'Uniform', value: 'Uniform'},
    { name: 'Karras', value: 'Karras'},
    { name: 'Exponential', value: 'Exponential'},
    { name: 'Polyexponential', value: 'Polyexponential'},
    { name: 'SGM Uniform', value: 'SGM Uniform'},
    { name: 'Align Your Steps', value: 'Align Your Steps'},
    { name: 'Normal', value: 'Normal'},
    { name: 'Simple', value: 'Simple'},
    { name: 'Cosine', value: 'Cosine'},
    { name: 'Beta', value: 'Beta'},
    { name: 'Karras Dynamic', value: 'Karras Dynamic'},
    { name: 'KL Optimal', value: 'KL Optimal'},
    { name: 'Align Your Steps GITS', value: 'Align Your Steps GITS'},
    { name: 'Align Your Steps 32', value: 'Align Your Steps 32'},
]

const sampler_to_comfy_name_mapping = {
    "Euler a": "euler_ancestral",
    "Euler a CFG++": "euler_ancestral_cfg_pp",
    "Euler": "euler",
    "DPM++ SDE": "dpmpp_sde",
    "LMS": "lms",
    "DPM++ 2S a": "dpmpp_2s_ancestral",
    "DPM2 a": "dpm_2_ancestral",
    "DPM++ 2M": "dpmpp_2m",
    "LCM": "lcm",
    "UniPC": "unipc",
    "DPM fast": "dpm_fast",
    "DPM++ 2M SDE": "dpmpp_2m_sde",
    "DEIS": "deis"
}

const scheduler_to_comfy_name_mapping = {
    "Uniform": "uniform",
    "Karras": "karras",
    "Exponential": "exponential",
    "SGM Uniform": "sgm_uniform",
    "Normal": "normal",
    "Simple": "simple",
    "Beta": "beta",
}

const check_model_filename = (model_filename) => {
    for (let [key, value] of model_name_hash_mapping) {
        if (model_filename.includes(key)) {
            return value
        }
    }
    return model_filename
}

function escape_for_regex(s) {
    return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
}

function get_negative_prompt(neg_prompt, override_neg_prompt, remove_nsfw_restriction, model) {
    let res = neg_prompt
    // add default neg prompt
    const default_neg_prompt = '(worst quality, low quality:1.4), '
    if (!override_neg_prompt) {
        if (model) {
            if (model_selection.find(x => x.value === model) != null) {
                res = default_neg_prompt + res
            }
            else if (model === 'animaginexl_v3.safetensors [1449e5b0b9]' || model === 'animaginexl_v31.safetensors [e3c47aedb0]') {
                res = 'lowres, (bad), text, error, fewer, extra, missing, worst quality, jpeg artifacts, low quality, watermark, unfinished, displeasing, oldest, early, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], ' + res
            }
        }
        else {
            res = default_neg_prompt + res
        }
    }

    // add nsfw as neg prompt by default
    if (!remove_nsfw_restriction) {
        res = '((nsfw)), ' + res
    }

    return res
}

function get_prompt(prompt, remove_nsfw_restriction, model = null) {
    let res = prompt

    // add nsfw as neg prompt by default
    if (!remove_nsfw_restriction) {
        res = res.replace(/nsfw/g, '')
    }

    if (model) {
    }

    return res
}

function get_worker_server(force_server_selection) {
    // random between server index with is_online = true
    let server_index = 0
    if (force_server_selection === -1) {
        // random server
        const online_server_pool = server_pool.filter(server => server.is_online)
        if (online_server_pool.length === 0) {
            console.log('All server is dead, returning -1')
            return -1
        }
        
        server_index = Math.floor(Math.random() * online_server_pool.length)

        return online_server_pool[server_index].index
    }
    else {
        // force server
        server_index = force_server_selection
    }

    // check if server is online
    if (!server_pool[server_index].is_online) {
        console.log(`Server ${server_index} is offline, returning -1`)
        return -1
    }

    return server_index
}

async function do_heartbeat() {
    for (let i = 0; i < server_pool.length; i++) {
        // ping the server
        const res = await fetch(`${server_pool[i].url}/`, { method: 'HEAD' }).catch(() => {})
        
        if (res && res.status === 200) {
            // server is alive
            server_pool[i].is_online = true
        }
        else {
            // server is dead
            console.log(`Server ${server_pool[i].url} is dead`)
            server_pool[i].is_online = false
        }
    }

    // check if all server is dead
    if (server_pool.every(server => !server.is_online)) {
        globalThis.sd_available = false
    }
}

function initiate_server_heartbeat() {
    setInterval(async () => {
        do_heartbeat()
    }, 600000)
}

module.exports = {
    server_pool,
    get_negative_prompt,
    get_data_body,
    get_data_controlnet,
    get_data_controlnet_annotation,
    get_data_rembg,
    get_worker_server,
    initiate_server_heartbeat,
    get_prompt,
    get_data_body_img2img,
    check_model_filename,
    do_heartbeat,
    model_name_hash_mapping,
    model_selection,
    model_selection_xl,
    model_selection_flux,
    model_selection_curated,
    model_selection_inpaint,
    model_selection_legacy,
    controlnet_preprocessor_selection,
    controlnet_model_selection,
    upscaler_selection,
    controlnet_model_selection_sd,
    controlnet_model_selection_xl,
    controlnet_model_selection_flux,
    sampler_selection,
    scheduler_selection,
    sampler_to_comfy_name_mapping,
    scheduler_to_comfy_name_mapping
}