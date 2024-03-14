const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const BLANK_IMG = "data:image/png;base64,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CJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiWLjIBAgQIEDAA/AABAgQIEAgKGADB0kUmQIAAAQIGgB8gQIAAAQJBAQMgWLrIBAgQIEDAAPADBAgQIEAgKGAABEsXmQABAgQIGAB+gAABAgQIBAUMgGDpIhMgQIAAAQPADxAgQIAAgaCAARAsXWQCBAgQIGAA+AECBAgQIBAUMACCpYtMgAABAgQMAD9AgAABAgSCAgZAsHSRCRAgQICAAeAHCBAgQIBAUMAACJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiWLjIBAgQIEDAA/AABAgQIEAgKGADB0kUmQIAAAQIGgB8g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AD9AgAABAgSCAgZAsHSRCRAgQICAAeAHCBAgQIBAUMAACJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiWLjIBAgQIEDAA/AABAgQIEAgKGADB0kUmQIAAAQIGgB8gQIAAAQJBAQMgWLrIBAgQIEDAAPADBAgQIEAgKGAABEsXmQABAgQIGAB+gAABAgQIBAUMgGDpIhMgQIAAAQPADxAgQIAAgaCAARAsXWQCBAgQIGAA+AECBAgQIBAUMACCpYtMgAABAgQMAD9AgAABAgSCAgZAsHSRCRAgQICAAeAHCBAgQIBAUMAACJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiW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"

const server_pool = [
    {
        index: 0,
        url: 'http://192.168.196.142:7860',
        fn_index_create: 497,
        fn_index_abort: 55,
        fn_index_img2img: 1094,
        fn_index_controlnet: [229, 756],        //[txt2img, img2img]
        fn_index_controlnet_annotation: [996, 1020],
        fn_index_controlnet_2: [311, 840], 
        fn_index_controlnet_annotation_2: [1004, 1028],
        fn_index_controlnet_3: [392, 923],
        fn_index_controlnet_annotation_3: [1012, 1036],
        fn_index_interrogate: 1098,
        fn_index_upscale: 1170,
        fn_index_change_model: 1273,
        fn_index_change_clip_skip: 1280,
        fn_index_change_adetailer_model1: [97, 624],
        fn_index_change_adetailer_prompt1: [99, 626],
        fn_index_change_adetailer_neg_prompt1: [100, 627],
        fn_index_change_adetailer_model2: [146, 673],
        fn_index_change_adetailer_prompt2: [148, 675],
        fn_index_change_adetailer_neg_prompt2: [149, 676],
        is_online: true,
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

const get_data_controlnet = (preprocessor = "none", controlnet = "None", input, weight = 1, mode = "Balanced", resolution = 512, guide_start = 0, guide_end = 1) => {
    return [
        null,
        false,
        "",
        "",
        [],
        [],
        input,
        null,
        "Both",
        input ? true : false,
        preprocessor,
        controlnet,
        weight,
        input ? {
            "image": input,
            "mask": BLANK_IMG
        } : null,
        "Crop and Resize",
        resolution,        // annotator resolution
        0,         // threshold a (some preprocessor do not use this)
        0,         // threshold b (some preprocessor do not use this)
        guide_start,
        guide_end,
        false,
        mode,
    ]
}

const get_data_controlnet_annotation = (preprocessor = "openpose", input) => {
    return [
        input ? {
            "image": input,
            "mask": BLANK_IMG
        } : null,
        preprocessor,
        512,        // annotator resolution
        64,         // threshold a
        64,         // threshold b
        512,
        512,
        false,
        "Crop and Resize",
    ]
}

const get_data_body_img2img = (index, prompt, neg_prompt, sampling_step, cfg_scale, seed, sampler, session_hash,
    height, width, attachment, attachment2, denoising_strength, mode = 0, mask_blur = 4, mask_content = "original", upscaler = "None", is_using_adetailer = false) => {
    // default mode 0 is img2img, 4 is inpainting
    // use tiled VAE if image is too large and no upscaler is used to prevent massive VRAM usage
    const shouldUseTiledVAE = ((width * height) > 3000000 && upscaler == "None") ? true : false

    return [
        `task(${session_hash})`,
        mode,                      // mode (0 = img2img, 4 = inpainting)
        prompt,                 // prompt
        neg_prompt,             // neg_prompt
        [],
        (mode === 0) ? attachment : null,
        null,
        null,
        null,
        null,
        (mode === 4) ? attachment : null,                   // inpaint original
        (mode === 4) ? attachment2 : null,                   // inpaint mask
        sampling_step,
        sampler,
        mask_blur,                  // mask blur
        0,                  // mask mode
        mask_content,         // mask content
        1,
        1,
        cfg_scale,
        1.5,                // the fuck is this?
        denoising_strength,
        0,
        height,
        width,
        1,
        "Crop and resize",      // resize mode
        "Only masked",        // inpaint area
        32,                 // inpaint padding
        "Inpaint masked",
        "",
        "",
        "",
        [],
        false,
        [],
        "",
        upscaler != "None" ? "Ultimate SD upscale" : "None",        // script used
        false,
        1,
        0.5,
        4,
        0,
        0.5,
        2,
        false,
        "",
        0.8,
        seed,
        false,
        -1,
        0,
        0,
        0,
        is_using_adetailer,
        false,
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
        false,
        false,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        null,
        "Refresh models",
        false,              // use refiner?
        "None",             // select refiner model
        20,                 // percentage of step the refiner will take over
        0.9,
        5,
        "0.0001",
        false,
        "None",
        "",
        0.1,
        false,
        null,
        null,
        null,
        false,
        7,
        1,
        "Constant",
        0,
        "Constant",
        0,
        1,
        "enable",
        "MEAN",
        "AD",
        1,
        false,
        1.01,
        1.02,
        0.99,
        0.95,
        false,
        0.5,
        2,
        false,
        256,
        2,
        0,
        false,
        false,
        3,
        2,
        0,
        0.35,
        true,
        "bicubic",
        "bicubic",
        false,
        0,
        "anisotropic",
        0,
        "reinhard",
        100,
        0,
        "subtract",
        0,
        0,
        "gaussian",
        "add",
        0,
        100,
        127,
        0,
        "hard_clamp",
        5,
        0,
        "None",
        "None",
        false,
        "MultiDiffusion",
        768,
        768,
        64,
        4,
        false,
        false,
        shouldUseTiledVAE,
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
        128,
        8,
        [
            "left",
            "right",
            "up",
            "down"
        ],
        1,
        0.05,
        128,
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
        [],
        "Nothing",
        "",
        [],
        "Nothing",
        "",
        [],
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        0,
        false,
        "<p style=\"margin-bottom:0.75em\">Will upscale the image depending on the selected target size type</p>",
        512,
        0,
        8,
        32,
        64,
        0.35,
        32,
        upscaler,
        true,
        "Linear",
        false,
        8,
        "None",
        "From img2img2 settings",
        2048,
        2048,
        2,
        [],
        "",
        "",
        ""
    ]
}

const get_data_body = (index, prompt, neg_prompt, sampling_step, cfg_scale, seed, sampler, session_hash,
    height, width, upscale_multiplier, upscaler, upscale_denoise_strength, upscale_step, face_restore = false, is_using_adetailer = false) => {

    // use tiled VAE if image is too large and no upscaler is used to prevent massive VRAM usage
    const shouldUseTiledVAE = ((width * height) > 1600000) ? true : false

    if (index === 0) return [
        `task(${session_hash})`,
        prompt,                 // prompt
        neg_prompt,             // neg_prompt
        [],
        sampling_step,
        sampler,
        1,
        1,
        cfg_scale,
        height,
        width,
        (upscale_multiplier > 1) ? true : false, //hires fix
        upscale_denoise_strength, //upscale denoise strength
        upscale_multiplier, // upscale ratio
        upscaler, //upscaler
        upscale_step,
        0,
        0,
        "Use same checkpoint",
        "Use same sampler",
        "",
        "",
        [],
        "None",
        false,
        "",
        0.8,
        seed,
        false,
        -1,
        0,
        0,
        0,
        is_using_adetailer,
        false,
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
        false,
        false,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        null,
        "Refresh models",
        false,              // use refiner?
        "None",             // select refiner model
        20,                 // percentage of step the refiner will take over
        0.9,
        5,
        "0.0001",
        false,
        "None",
        "",
        0.1,
        false,
        null,
        null,
        null,
        false,
        7,
        1,
        "Constant",
        0,
        "Constant",
        0,
        1,
        "enable",
        "MEAN",
        "AD",
        1,
        false,
        1.01,
        1.02,
        0.99,
        0.95,
        false,
        0.5,
        2,
        false,
        256,
        2,
        0,
        false,
        false,
        3,
        2,
        0,
        0.35,
        true,
        "bicubic",
        "bicubic",
        false,
        0,
        "anisotropic",
        0,
        "reinhard",
        100,
        0,
        "subtract",
        0,
        0,
        "gaussian",
        "add",
        0,
        100,
        127,
        0,
        "hard_clamp",
        5,
        0,
        "None",
        "None",
        false,
        "MultiDiffusion",
        768,
        768,
        64,
        4,
        false,
        false,
        shouldUseTiledVAE,
        false,
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
        [],
        "Nothing",
        "",
        [],
        "Nothing",
        "",
        [],
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        0,
        false
    ]
    else return [
        `task(${session_hash})`,
        prompt,                 // prompt
        neg_prompt,             // neg_prompt
        [],
        sampling_step,
        sampler,
        false,
        false,
        1,
        1,
        cfg_scale,
        seed,
        -1,
        0,
        0,
        0,
        false,
        height,
        width,
        (upscale_multiplier > 1) ? true : false, //hires fix
        upscale_denoise_strength, //upscale denoise strength
        upscale_multiplier, // upscale ratio
        upscaler, //upscaler
        upscale_step,
        0,
        0,
        [],
        "None",
        false,
        false,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        "LoRA",
        "None",
        1,
        1,
        "Refresh models",
        false,
        false,
        "positive",
        "comma",
        0,
        false,
        false,
        "",
        "Seed",
        "",
        "Nothing",
        "",
        "Nothing",
        "",
        true,
        false,
        false,
        false,
        0,
    ]
}

function get_negative_prompt(neg_prompt, override_neg_prompt, remove_nsfw_restriction) {
    let res = neg_prompt
    // add default neg prompt
    const default_neg_prompt = '(worst quality, low quality:1.4), '
    if (!override_neg_prompt) {
        res = default_neg_prompt + res
    }

    // add nsfw as neg prompt by default
    if (!remove_nsfw_restriction) {
        res = '((nsfw)), ' + res
    }
    return res
}

// all use standard weight of 0.85
const word_to_lora_model = [
    {
        "keyword": ["2b"],
        "lora": "<lora:2bNierAutomataLora_v2b:0.85>"
    },
    {
        "keyword": ["chen"],
        "lora": "<lora:ArknightsChen5concept_10:0.85>"
    },
    {
        "keyword": ["jeanne d arc", "jeanne darc"],
        "lora": "<lora:JeanneDarcAzurLaneSwimsuit_v10:0.85>"
    },
    {
        "keyword": ["asuna"],
        "lora": "<lora:Asuna_Medium:0.85>"
    },
    {
        "keyword": ["aru"],
        "lora": "<lora:Rikuhachima Aru:0.85>"
    },
    {
        "keyword": ["karin"],
        "lora": "<lora:Karin_medium:0.85>"
    },
    {
        "keyword": ["karin bunny"],
        "lora": "<lora:Karin_Bunnyhard:0.85>"
    },
    {
        "keyword": ["raikou", "raikou"],
        "lora": " <lora:Raikou_Medium:0.85>"
    },
    {
        "keyword": ["shuten"],
        'lora': '<lora:Shuten_medium:0.85>'
    },
    {
        "keyword": ["barbara"],
        'lora': '<lora:Barbara_mediumpruned:0.85>'
    },
    {
        "keyword": ["diluc"],
        'lora': '<lora:Diluc_Mediumpruned:0.85>'
    },
    {
        "keyword": ["eula"],
        'lora': '<lora:eulaMedium:0.85>'
    },
    {
        "keyword": ["ganyu"],
        'lora': '<lora:Ganyu_Medium:0.85>'
    },
    {
        "keyword": ["jean"],
        'lora': '<lora:Jean_Medium:0.85>'
    },
    {
        "keyword": ["keqing"],
        'lora': '<lora:keqing_medium:0.85>'
    },
    {
        "keyword": ["kujou sara"],
        'lora': '<lora:kujou sara_Heavy:0.85>'
    },
    {
        "keyword": ["lisa"],
        'lora': '<lora:Lisa_Medium:0.85>'
    },
    {
        "keyword": ["mona"],
        'lora': '<lora:Mona_mediumpruned:0.85>'
    },
    {
        "keyword": ["raiden shogun"],
        'lora': '<lora:raiden shogun_LoRA:0.85>'
    },
    {
        "keyword": ["rosaria"],
        'lora': '<lora:rosaria_mediumpruned:0.85>'
    },
    {
        "keyword": ["shenhe"],
        'lora': '<lora:Shenhe_Medium:0.85>'
    },
    {
        "keyword": ["yelan"],
        'lora': '<lora:Yelan_Hard:0.85>'
    },
    {
        "keyword": ["yoimiya"],
        'lora': '<lora:Yoimiya_mediumpruned:0.85>'
    },
    {
        "keyword": ["zhongli"],
        'lora': '<lora:Zhongli_Medium:0.85>'
    },
    {
        "keyword": ["yae miko"],
        'lora': '<lora:yae miko_Mediumpruned:0.85>'
    },
    {
        "keyword": ["aponia"],
        'lora': '<lora:Aponia_Hardpruned:0.85>'
    },
    {
        "keyword": ["reisalin stout", 'ryza'],
        'lora': '<lora:reisalin stout_mediumpruned:0.85>'
    },
    {
        "keyword": ["agir"],
        'lora': '<lora:agir6:0.85>'
    },
    {
        "keyword": ["amagi"],
        'lora': '<lora:amagi10:0.85>'
    },
    {
        "keyword": ["atago"],
        'lora': '<lora:atagoAzurLaneFull_atagoUnet2e4Telr8e4:0.85>'
    },
    {
        "keyword": ["atdan"],
        'lora': '<lora:atdanStyleLora_lk:0.85>'
    },
    {
        "keyword": ["august von parseval"],
        'lora': '<lora:augustVonParsevalMaid_augustmaid000002:0.85>'
    },
    {
        "keyword": ["brest"],
        'lora': '<lora:brestAzurLane_v106:0.85>'
    },
    {
        "keyword": ["chen hai", "chenhai"],
        'lora': '<lora:chenhaiAzurLane_v10:0.85>'
    },
    {
        "keyword": ["elaina"],
        'lora': '<lora:elaina_v3:0.85>'
    },
    {
        "keyword": ["elbing"],
        'lora': '<lora:elbingAzurLaneTheThroneOf_v1:0.85>'
    },
    {
        "keyword": ["enterprise"],
        'lora': '<lora:enterpriseAzurLane_v10:0.85>'
    },
    {
        "keyword": ["hitori gotou"],
        'lora': '<lora:gotHitoriBocchiBocchi_v10:0.85>'
    },
    {
        "keyword": ["helena"],
        'lora': '<lora:helenaAzurLane_v2:0.85>'
    },
    {
        "keyword": ["cheshire"],
        'lora': '<lora:hmsCheshireAzurLane_delta:0.85>'
    },
    {
        "keyword": ["kashino"],
        'lora': '<lora:kashinoAzurLaneSwimsuit_kashinov108:0.85>'
    },
    {
        "keyword": ["kita ikuyo"],
        'lora': '<lora:kitaIkuyoBocchiThe_v10:0.85>'
    },
    {
        "keyword": ["kitagawa marin"],
        'lora': '<lora:kitagawaMarinUniform_v10:0.85>'
    },
    {
        "keyword": ["mahiru"],
        'lora': '<lora:mahiruShiinaTheAngelNext_1:0.85>'
    },
    // {
    //     "keyword": ["elaina"],
    //     'lora': '<lora:majoNoTabitabiElaina_v20:0.85>'
    // },
    {
        "keyword": ["makima"],
        'lora': '<lora:makimaChainsawMan_offset:0.85>'
    },
    {
        "keyword": ["nijika ijichi"],
        'lora': '<lora:nijikaIjichiOfBocchiThe_v10:0.85>'
    },
    {
        "keyword": ["prinz eugen"],
        'lora': '<lora:prinzEugenAzurLane_v1:0.85>'
    },
    {
        "keyword": ["roon"],
        'lora': '<lora:roonAzurLane_v1:0.85>'
    },
    {
        "keyword": ["ryo yamada"],
        'lora': '<lora:ryoYamadaBocchiTheRock_v10:0.85>'
    },
    {
        "keyword": ["shinano"],
        'lora': '<lora:shinanoAzurLane_v10:0.85>'
    },
    {
        "keyword": ["taihou"],
        'lora': '<lora:taihouAzurLane_v30:0.85>'
    },
    {
        "keyword": ["takao"],
        'lora': '<lora:takaoAzurLaneFull_takao7682:0.85>'
    },
    {
        "keyword": ["unicorn"],
        'lora': '<lora:unicornAzurLaneLora_v2NAI:0.85>'
    },
    {
        "keyword": ["victorious"],
        'lora': '<lora:victoriousAzurLane_victoriousorigin:0.85>'
    },
    {
        "keyword": ["inuyama aoi"],
        'lora': '<lora:yurucampInuyamaaoi_yurucampInuyamaaoiV1:0.85>'
    },
    {
        "keyword": ["amber"],
        "lora": "<lora:amberGenshinImpact_flexibleV1:0.85>"
    },
    {
        "keyword": ["anime tarot"],
        "lora": "<lora:animetarotV51:0.85>"
    },
    {
        "keyword": ["texas"],
        "lora": "<lora:arknightsTexasThe_v10:0.85>"
    },
    {
        "keyword": ["hanfu ruqun"],
        "lora": "<lora:elegantHanfuRuqun_v10:0.85>"
    },
    {
        "keyword": ["klee"],
        "lora": "<lora:kleeGenshinImpact_kleeGenshinImpact:0.85>"
    },
    {
        "keyword": ["korean doll"],
        "lora": "<lora:koreanDollLikenesss_v10:0.85>"
    },
    {
        "keyword": ["nahida"],
        "lora": "<lora:nahidaGenshinImpact_v10:0.85>"
    },
    {
        "keyword": ["torino aqua"],
        "lora": "<lora:torinoAquaStyleLora_offset:0.85>"
    },
    {
        "keyword": ["suigintou"],
        "lora": " <lora:RozenMaidenSuigintou_RozenMaidenSuigintou:0.85>"
    },
    {
        "keyword": ["vtuber", "virtual youtuber", "chubba", "vchubba"],
        "lora": "<lora:allVtubersLora_hll31:0.85>"
    },
    {
        "keyword": ["pastel style"],
        "lora": " <lora:pastelMixStylizedAnime_pastelMixLoraVersion:0.85>"
    },
    {
        "keyword": ["sovetsky soyuz"],
        "lora": "<lora:SNSovetskySoyuzLeaderOfThe_sovetskySoyuzV11:0.85>"
    },
    {
        "keyword": ["an yasuri"],
        "lora": "<lora:YasuriAnYasuriStyle_offset:0.85>"
    },
    {
        "keyword": ["admiral graf spee"],
        "lora": "<lora:admiralGrafSpeeAzur_bigClaws:0.85>"
    },
    {
        "keyword": ["arya"],
        "lora": "<lora:aryaSanLora_v1:0.85>"
    },
    {
        "keyword": ["shoukaku"],
        "lora": "<lora:azurLaneShoukaku_v10:0.85>"
    },
    {
        "keyword": ["zuikaku"],
        "lora": "<lora:azurLaneZuikaku_v10:0.85>"
    },
    {
        "keyword": ["baltimore"],
        "lora": "<lora:baltimoreAzurLane_v01:0.85>"
    },
    {
        "keyword": ["kawakaze"],
        "lora": "<lora:kawakazeAzurLane_v10:0.85>"
    },
    {
        "keyword": ["illustrious"],
        "lora": "<lora:illustriousMaidenLilysRadiance_v10:0.85>"
    },
    {
        "keyword": ["hood azur lane"],
        "lora": "<lora:hoodAzurLane_v01:0.85>"
    },
    {
        "keyword": ["duke of york"],
        "lora": "<lora:hmsDukeOfYorkAzur_v1:0.85>"
    },
    {
        "keyword": ["essex"],
        "lora": "<lora:essexAzurLane_v10:0.85>"
    },
    {
        "keyword": ["bremerton"],
        "lora": "<lora:bremertonAzurLane_v1:0.85>"
    },
    {
        "keyword": ["bismarck"],
        "lora": "<lora:bismarckAzurLaneLora_v10EarlyRelease:0.85>"
    },
    {
        "keyword": ["kisaki"],
        "lora": "<lora:kisakiBlueArchive_v10:0.85>"
    },
    {
        "keyword": ["elbeazln", "elbe"],
        "lora": "<lora:kmsElbeAzurLane_releaseV10:0.85>"
    },
    {
        "keyword": ["le malin"],
        "lora": "<lora:leMalinAzurLaneBunnysuit_lemalinbunny000004:0.85>"
    },
    {
        "keyword": ["perseus"],
        "lora": "<lora:perseusAzurLaneNurse_perseusnurse000008:0.85>"
    },
    {
        "keyword": ["miyu edelfelt", "miyu"],
        "lora": "<lora:prismaIllyaMiyu_miyuEdelfelt:0.85>"
    },
    {
        "keyword": ["prisma illya", "illya"],
        "lora": "<lora:prismaIllyaMiyu_prismaIllya:0.85>"
    },
    {
        "keyword": ["eqlc"],
        "lora": "<lora:queenElizabethAzur_queenElizabethV1:0.85>"
    },
    {
        "keyword": ["z23"],
        "lora": "<lora:z23AzurLane_v1:0.85>"
    },
    {
        "keyword": ["yukikaze"],
        "lora": "<lora:yukikazeAzurLane_v10:0.85>"
    },
    {
        "keyword": ["renoazln", "renocrazln", "renobnazln"],
        "lora": "<lora:ussRenoAzurLane_releaseV1:0.85>"
    },
    {
        "keyword": ["acrgazln", "anchorage"],
        "lora": "<lora:ussAnchorageAzurLane_releaseV1:0.85>"
    },
    {
        "keyword": ["kurumi"],
        "lora": "<lora:tokisakiKurumi_v10:0.85>"
    },
    {
        "keyword": ["tashkent"],
        "lora": "<lora:tashkent_v10:0.85>"
    },
    {
        "keyword": ["sirius"],
        "lora": "<lora:siriusAzurLaneMaid_v1:0.85>"
    },
    {
        "keyword": ["z46"],
        "lora": "<lora:z46AzurLaneFullLora_z4610:0.85>"
    },
    {
        "keyword": ["plmtazln"],
        "lora": "<lora:hmsPlymouthAzurLane_releaseV21:0.85>"
    },
    {
        "keyword": ["hand fix"],
        "lora": "<lora:fixhandxianyv_v10:0.85>",
        "remove_trigger": true
    },
    {
        "keyword": ["haruka chibi"],
        "lora": "<lora:komowataHarukaChibiArt_v20:0.85>",
    },
    {
        "keyword": ["lineart"],
        "lora": "<lora:animeoutlineV4_16:0.85>",
    },
    {
        "keyword": ["oyuwari"],
        "lora": "<lora:oyuwariArtStyleLora_v2012870:0.85>",
    },
    {
        "keyword": ["kasugano sora"],
        "lora": "<lora:KasuganoSora_ksV1:0.85>",
    },
    {
        "keyword": ["xingqiu"],
        "lora": "<lora:xingqiuV20Genshin_v20:0.85>"
    },
    {
        "keyword": ["forswall"],
        "lora": "<lora:forswallLOTMLordOf_1:0.85>"
    },
    {
        "keyword": ["hoshino ai"],
        "lora": "<lora:hoshinoAiOshiNoKo_v90:0.85>"
    },
    {
        "keyword": ["add detail"],
        "lora": "<lora:add_detail:1>"
    },
    {
        "keyword": ["white background full body", "simple background full body"],
        "lora": "<lora:tachi-e:0.85>"
    },
    {
        "keyword": ["hinatsuru ai", "yashajin ai", "sadatou ayano", "charlotte izoard", "mizukoshi mio", "sora ginko", "kiyotaki keika", "sainokami ika", "kuzuryuu yaichi"],
        "lora": "<lora:RyuuouNoOshigoto_all:0.85>"
    },
    {
        "keyword": ["akagi miria", "ichihara nina", "koga koharu", "matoba risa", "ryuzaki kaoru", "sakurai momoka", "sasaki chie", "tachibana arisu", "yuuki haru", "u149ani", "yonai p"],
        "lora": "<lora:u149-v4.0:0.85>"
    },
    {
        "keyword": ["chino"],
        "lora": "<lora:KafuuChinoV1:0.85>"
    },
    {
        "keyword": ["princess carry"],
        "lora": "<lora:princess_carry_v0.1:0.85>"
    },
    {
        "keyword": ["clothes tug", "skirt tug", "dress tug", "shirt tug", "sweater tug"],
        "lora": "<lora:skirt_tug_v0.1:0.85>"
    },
    {
        "keyword": ["rest feet up"],
        "lora": "<lora:restfeetup55_rvkwi:0.85>",
        "remove_trigger": true
    },
    {
        "keyword": ["hugging own legs"],
        "lora": "<lora:hugging_own_legs_v0.3:0.85>"
    },
    {
        "keyword": ["kabedon pov"],
        "lora": "<lora:kabedon_pov:0.85>"
    },
    {
        "keyword": ["kirara"],
        // recommended keyword 1girl, green eyes, official, two tails, paw,
        "lora": "<lora:Genshin_Kirara_AP_v3:0.85>",
        "remove_trigger": true
    },
    {
        "keyword": ["saltbaememe"],
        // recommended keyword salt, sunglases
        "lora": "<lora:SaltBaeMeme:0.85>",
    },
    {
        "keyword": ["queensgravememe"],
        // recommended keyword v, smile
        "lora": "<lora:GrantGustinNextToOliverQueensGraveMeme:0.85>",
    },
    {
        "keyword": ["pepepunchmeme"],
        "lora": "<lora:PepePunchMeme:0.85>",
    },
    {
        "keyword": ["thisisfine"],
        "lora": "<lora:thisisfineV3:0.85>",
    },
    {
        "keyword": ["kantoku"],
        "lora": "<lora:kantoku_v0.1:0.85>",
    }
]

const word_to_sdxl_lora_model = [
    {
        "keyword": ["lineart"],
        "lora": "<lora:sdxl_lineart:1.00>",
    },
    {
        // recommended keyword: night, starry sky, night sky, ladyshadow
        "keyword": ["ladyshadow"],
        "lora": "<lora:shadow-XL:1.00>",
    },
    {
        "keyword": ["watercolor (medium)"],
        "lora": "<lora:shuicai:1.00>",
    },
    {
        "keyword": ["pixel art"],
        "lora": " <lora:sdxl_pixel:1.00>",
    },
    {
        "keyword": ["simple positive"],
        "lora": "<lora:sdxl_simple_positive:1.00>",
        "remove_trigger": true
    },
    {
        "keyword": ["more anime"],
        "lora": "<lora:aesthetic_anime_v1s:1.00>",
        "remove_trigger": true
    },
    {
        "keyword": ["inkpunk"],
        "lora": "<lora:IPXL_v8:1.00>"
    },
    {
        // actual keyword: <character>_(honkai:_star_rail)
        "keyword": ["honkai star rail"],
        "ignore_keyword": ["sparkle honkai star rail"],
        "lora": "<lora:sdxl_starrail:1.00>"
    },
    {
        "keyword": ["nekopara"],
        "lora": "<lora:sdxl_nekopara:1.00>"
    },
    {
        "keyword": ["ogipote"],
        "lora": "<lora:ogipoteXL:1.00>",
        "remove_trigger": true
    },
    {
        "keyword": ["shiratama"],
        "lora": "<lora:shiratamaXL:1.00>",
        "remove_trigger": true
    },
    {
        "keyword": ["add outline"],
        "lora": "<lora:sdxl_outline:1.00>",
        "remove_trigger": true
    },
    {
        "keyword": ["artist narae"],
        "lora": "<lora:sdxl_narae:1.00>",
    },
    {
        "keyword": ["artist parsley"],
        "lora": "<lora:sdxl_parsley:1.00>",
    },
    {
        "keyword": ["artist miyasemahiro"],
        "lora": "<lora:sdxl_miyasemahiro:1.00>",
    },
    {
        // actual keyword: sparkle (honkai: star rail)
        "keyword": ["sparkle honkai star rail"],
        "lora": "<lora:sdxl_sparkle_honkaistarrail:1.00>",
    },
    {
        "keyword": ["touhou"],
        "lora": "<lora:sdxl_touhou:1.00>",
    }
]

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
])
// limit at 25 (probably less due to character limitation)
const model_selection = [
    { name: 'Anything v4.5', value: 'anything.ckpt [fbcf965a62]' },
    { name: 'Pastel Mix v2.1', value: 'pastelmix.safetensors [d01a68ae76]' },
    { name: 'Counterfeit v2.5', value: 'counterfeit.safetensors [a074b8864e]' },
    { name: 'MeinaMix v7', value: 'meinamix.safetensors [e03274b1e7]' },
    { name: 'RefSlave v2', value: 'refslave.safetensors [362dae27f8]' },
    { name: 'Anything v5', value: 'anythingv5.safetensors [7f96a1a9ca]' },
    { name: 'Yozora v1', value: 'yozora.safetensors [4b118b2d1b]' },
    { name: 'ChromaNeoFT v2', value: 'chromaneo_v2.safetensors [b8d6d19b35]' },
    { name: 'DarkSushiMix', value: 'darksushi.safetensors [cca17b08da]' },
    { name: 'CetusMix (Coda v2)', value: 'cetusmix_coda2.safetensors [68c0a27380]' },
    { name: 'Momokos v1', value: 'momokos_v10.safetensors [d77922554c]' },
    { name: 'MeinaPastel v6', value: 'meinapastel.safetensors [6292dd40d6]' },
    { name: 'CuteYukiMix', value: 'cuteyukimix.safetensors [6ee4f31532]' },
    { name: '9527 v1', value: '9527v1.ckpt [40a9f4ec37]' },
    { name: 'IrisMix v5b', value: 'irismix_v5b.safetensors [8263f26927]'},
    { name: 'Anime-like 2D v2', value: 'animelikev2.safetensors [4d957c560b]' },
]

const model_selection_xl = [
    { name: 'Azure Blue v1.2', value: 'azureblue_v12.safetensors [52cb3c2e67]' },
    { name: 'X2AnimeXL v2', value: 'x2animexl.safetensors [f301898175]' },
    { name: 'NekorayXL v0.6', value: 'nekorayxl.safetensors [c53dabc181]' },
    { name: 'AnimagineXL v3', value: 'animaginexl_v3.safetensors [1449e5b0b9]' },
    { name: 'KohakuXL v0.7b', value: 'kohakuxl.safetensors [51a0c178b7]'},
    { name: "AAMXL v1", value: 'aamxl_v1.safetensors [d48c2391e0]'},
    { name: 'AAMXL Turbo', value: 'aamxl_turbo.safetensors [8238e80fdd]'},
    { name: 'Juggernaut XL', value: 'juggernautxl_turbo.safetensors [c9e3e68f89]'},
    { name: 'Dreamshaper XL Turbo', value: 'dreamshaperxl_turbo.safetensors [4496b36d48]'},
]

const controlnet_preprocessor_selection = [
    { name: 'None', value: 'none' },
    { name: 'Canny', value: 'canny' },
    { name: 'Depth', value: 'depth_midas' },
    { name: 'Depth (LERes)', value: 'depth_leres++' },
    { name: 'HED', value: 'softedge_hed' },
    { name: 'Lineart Anime', value: 'lineart_anime' },
    { name: 'OpenPose', value: 'openpose' },
    { name: 'OpenPose (Face)', value: 'openpose_face' },
    { name: 'OpenPose (Hand)', value: 'openpose_hand' },
    { name: 'OpenPose (Full)', value: 'openpose_full' },
    { name: 'Segmentation', value: 'seg_ufade20k' },
    { name: 'CLIP Vision', value: 't2ia_style_clipvision' },
    { name: 'Color', value: 't2ia_color_grid' },
    { name: 'Sketch', value: 't2ia_sketch_pidi' },
]

const controlnet_model_selection = [
    { name: 'None', value: 'None' },
    { name: 'T2I-Adapter - Canny', value: 't2iadapter_canny_sd14v1 [80bfd79b]' },
    { name: 'T2I-Adapter - Color', value: 't2iadapter_color_sd14v1 [8522029d]' },
    { name: 'T2I-Adapter - Depth', value: 't2iadapter_depth_sd14v1 [fa476002]' },
    { name: 'T2I-Adapter - OpenPose', value: 't2iadapter_openpose_sd14v1 [7e267e5e]' },
    { name: 'T2I-Adapter - Seg', value: 't2iadapter_seg_sd14v1 [6387afb5]' },
    { name: 'T2I-Adapter - Sketch', value: 't2iadapter_sketch_sd14v1 [e5d4b846]' },
    { name: 'T2I-Adapter - Style', value: 't2iadapter_style_sd14v1 [202e85cc]' },
    { name: 'ControlNet - OpenPose', value: 'control_v11p_sd15_openpose [cab727d4]'},
    { name: 'ControlNet - SoftEdge', value: 'control_v11p_sd15_softedge [a8575a2a]'},
    { name: 'ControlNet - Lineart Anime', value: 'control_v11p_sd15s2_lineart_anime [3825e83e]'},
    { name: 'InstantID - Keypoint', value: 'control_instant_id_sdxl [c5c25a50]'},
    { name: 'InstantID - IPAdapter', value: 'ip-adapter_instant_id_sdxl [eb2d3ec0]'}
]

const controlnet_model_selection_xl = [
    { name: 'None', value: 'None' },
    { name: 'T2I-Adapter - Canny', value: 'kohya_controllllite_xl_canny [2ed264be]' },
    { name: 'T2I-Adapter - Color', value: 'bdsqlsz_controlllite_xl_t2i-adapter_color_shuffle [8ff329d6]' },
    { name: 'T2I-Adapter - Depth', value: 'kohya_controllllite_xl_depth [9f425a8d]' },
    { name: 'T2I-Adapter - OpenPose', value: 't2i-adapter_xl_openpose [18cb12c1]' },
    // { name: 'T2I-Adapter - Seg', value: 't2iadapter_seg_sd14v1 [6387afb5]' },
    { name: 'T2I-Adapter - Sketch', value: 't2i-adapter_diffusers_xl_sketch [72b96ab1]' },
    // { name: 'T2I-Adapter - Style', value: 't2iadapter_style_sd14v1 [202e85cc]' },
    { name: 'ControlNet - OpenPose', value: 'kohya_controllllite_xl_openpose_anime_v2 [b0fa10bb]'},
    { name: 'ControlNet - SoftEdge', value: 'bdsqlsz_controlllite_xl_softedge [c28ff1c4]'},
    { name: 'ControlNet - Lineart Anime', value: 't2i-adapter_diffusers_xl_lineart [bae0efef]'},
    { name: 'InstantID - Keypoint', value: 'control_instant_id_sdxl [c5c25a50]'},
    { name: 'InstantID - IPAdapter', value: 'ip-adapter_instant_id_sdxl [eb2d3ec0]'}
]

const upscaler_selection = [
    { name: 'Lanczos - Fast', value: 'Lanczos' },
    { name: 'ESRGAN_4x', value: 'ESRGAN_4x' },
    { name: 'R-ESRGAN 4x+ Anime6B', value: 'R-ESRGAN 4x+ Anime6B' },
    { name: 'SwinIR 4x', value: 'SwinIR_4x' },
    { name: 'AnimeSharp 4x', value: '4x_AnimeSharp' },
    { name: 'UltraSharp 4x', value: '4x_UltraSharp' },
    { name: 'NMKD-Siax 4x', value: '4x_NMKD-Siax_200k' },
]

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


// attempt to find trigger word and add the respective lora model
function load_lora_from_prompt(prompt, lora_default_strength = null) {
    // create temp prompt holder
    let temp_prompt = prompt
    // lower case all temp_prompt
    temp_prompt = temp_prompt.toLowerCase()
    // turn all weight number (follow :<decimal number> pattern) to space
    temp_prompt = temp_prompt.replace(/:\d+\.\d*/g, " ")
    // turn all symbol to space
    temp_prompt = temp_prompt.replace(/[^a-zA-Z0-9 ]/g, " ")
    // normalizer space
    temp_prompt = temp_prompt.replace(/\s+/g, " ")
    // trim space  
    temp_prompt = temp_prompt.trim()
    // attempt to search for keyword in normalized temp_prompt (include word boundery)
    const lora_to_load = []
    const { cached_model } = require('./model_change');
    const is_sdxl = model_selection_xl.find(m => m.value === cached_model[0]) != null

    console.log(temp_prompt)
    if (is_sdxl) {
        for (let i = 0; i < word_to_sdxl_lora_model.length; i++) {
            const word = word_to_sdxl_lora_model[i]
            const keyword = word.keyword
            const lora = word.lora
            for (let j = 0; j < keyword.length; j++) {
                const k = keyword[j]
                const regex = new RegExp(`\\b${escape_for_regex(k)}\\b`, 'gi')
                if (temp_prompt.search(regex) !== -1) {
                    lora_to_load.push(lora)
                    // check if ignore keyword is present
                    if (word.ignore_keyword) {
                        const ignore_keyword = word.ignore_keyword
                        for (let l = 0; l < ignore_keyword.length; l++) {
                            const ignore_k = ignore_keyword[l]
                            const ignore_regex = new RegExp(`\\b${escape_for_regex(ignore_k)}\\b`, 'gi')
                            if (temp_prompt.search(ignore_regex) !== -1) {
                                lora_to_load.pop()
                                break
                            }
                        }
                    }
                    if (word.remove_trigger) {
                        prompt = prompt.replace(regex, '')
                    }
                    break
                }
            }
        }
    }
    else {
        for (let i = 0; i < word_to_lora_model.length; i++) {
            const word = word_to_lora_model[i]
            const keyword = word.keyword
            const lora = word.lora
            for (let j = 0; j < keyword.length; j++) {
                const k = keyword[j]
                const regex = new RegExp(`\\b${escape_for_regex(k)}\\b`, 'gi')
                if (temp_prompt.search(regex) !== -1) {
                    lora_to_load.push(lora)
                    if (word.ignore_keyword) {
                        const ignore_keyword = word.ignore_keyword
                        for (let l = 0; l < ignore_keyword.length; l++) {
                            const ignore_k = ignore_keyword[l]
                            const ignore_regex = new RegExp(`\\b${escape_for_regex(ignore_k)}\\b`, 'gi')
                            if (temp_prompt.search(ignore_regex) !== -1) {
                                lora_to_load.pop()
                                break
                            }
                        }
                    }
                    if (word.remove_trigger) {
                        prompt = prompt.replace(regex, '')
                    }
                    break
                }
            }
        }
    }

    // turn the list to lora loading string with syntax like [<lora:one:1.0>|<lora:two:1.0>], add them back to the prompt and return
    if (lora_to_load.length === 0) 
        return prompt

    // if lora strength is specified, replace all 0.85 with the specified strength
    if (lora_default_strength !== null) {
        for (let i = 0; i < lora_to_load.length; i++) {
            const lora = lora_to_load[i]
            if (is_sdxl) {
                lora_to_load[i] = lora.replace(/1\.00/g, lora_default_strength.toFixed(2))
            }
            else {
                lora_to_load[i] = lora.replace(/0\.85/g, lora_default_strength.toFixed(2))
            }
        }
    }
    
    const res = `${lora_to_load.join(', ')}, ${prompt}`
    return res
}

function get_prompt(prompt, remove_nsfw_restriction) {
    let res = prompt

    // add nsfw as neg prompt by default
    if (!remove_nsfw_restriction) {
        res = res.replace(/nsfw/g, '')
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
    get_worker_server,
    initiate_server_heartbeat,
    get_prompt,
    load_lora_from_prompt,
    get_data_body_img2img,
    check_model_filename,
    do_heartbeat,
    model_name_hash_mapping,
    model_selection,
    model_selection_xl,
    controlnet_preprocessor_selection,
    controlnet_model_selection,
    upscaler_selection,
    controlnet_model_selection_xl
}