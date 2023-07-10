const fetch = require('node-fetch');

const BLANK_IMG = "data:image/png;base64,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CJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiWLjIBAgQIEDAA/AABAgQIEAgKGADB0kUmQIAAAQIGgB8gQIAAAQJBAQMgWLrIBAgQIEDAAPADBAgQIEAgKGAABEsXmQABAgQIGAB+gAABAgQIBAUMgGDpIhMgQIAAAQPADxAgQIAAgaCAARAsXWQCBAgQIGAA+AECBAgQIBAUMACCpYtMgAABAgQMAD9AgAABAgSCAgZAsHSRCRAgQICAAeAHCBAgQIBAUMAACJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiWLjIBAgQIEDAA/AABAgQIEAgKGADB0kUmQIAAAQIGgB8g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AD9AgAABAgSCAgZAsHSRCRAgQICAAeAHCBAgQIBAUMAACJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiWLjIBAgQIEDAA/AABAgQIEAgKGADB0kUmQIAAAQIGgB8gQIAAAQJBAQMgWLrIBAgQIEDAAPADBAgQIEAgKGAABEsXmQABAgQIGAB+gAABAgQIBAUMgGDpIhMgQIAAAQPADxAgQIAAgaCAARAsXWQCBAgQIGAA+AECBAgQIBAUMACCpYtMgAABAgQMAD9AgAABAgSCAgZAsHSRCRAgQICAAeAHCBAgQIBAUMAACJYuMgECBAgQMAD8AAECBAgQCAoYAMHSRSZAgAABAgaAHyBAgAABAkEBAyBYusgECBAgQMAA8AMECBAgQCAoYAAESxeZAAECBAgYAH6AAAECBAgEBQyAYOkiEyBAgAABA8APECBAgACBoIABECxdZAIECBAgYAD4AQIECBAgEBQwAIKli0yAAAECBAwAP0CAAAECBIICBkCwdJEJECBAgIAB4AcIECBAgEBQwAAIli4yAQIECBAwAPwAAQIECBAIChgAwdJFJkCAAAECBoAfIECAAAECQQEDIFi6yAQIECBAwADwAwQIECBAIChgAARLF5kAAQIECBgAfoAAAQIECAQFDIBg6SITIECAAAEDwA8QIECAAIGggAEQLF1kAgQIECBgAPgBAgQIECAQFDAAgqWLTIAAAQIEDAA/QIAAAQIEggIGQLB0kQkQIECAgAHgBwgQIECAQFDAAAiW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"

const server_pool = [
    {
        index: 0,
        url: 'http://192.168.196.142:7860',
        fn_index_create: 276,
        fn_index_abort: 55,
        fn_index_img2img: 551,
        fn_index_controlnet: 182,
        fn_index_controlnet_annotation: 175,
        fn_index_controlnet_2: 207,
        fn_index_controlnet_annotation_2: 200,
        fn_index_controlnet_3: 232,
        fn_index_controlnet_annotation_3: 225,
        fn_index_interrogate: 555,
        fn_index_upscale: 571,
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

const get_data_controlnet = (preprocessor = "openpose", controlnet = "t2iadapter_openpose_sd14v1 [7e267e5e]", input, weight = 1, guide_start = 0, guide_end = 1) => {
    return [
        input ? true : false,
        preprocessor,
        controlnet,
        weight,
        input ? {
            "image": input,
            "mask": BLANK_IMG
        } : null,
        false,
        "Scale to Fit (Inner Fit)",
        false,
        false,
        512,        // annotator resolution
        64,         // threshold a
        64,         // threshold b
        guide_start,
        guide_end,
        false
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
    ]
}

const get_data_body_img2img = (index, prompt, neg_prompt, sampling_step, cfg_scale, seed, sampler, session_hash,
    height, width, attachment, attachment2, denoising_strength, mode = 0, mask_blur = 4, mask_content = "original") => {
    // default mode 0 is img2img, 4 is inpainting
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
        false,
        false,
        1,
        1,
        cfg_scale,
        1.5,                // the fuck is this?
        denoising_strength,
        seed,
        -1,
        0,
        0,
        0,
        false,
        null,
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
        "None",
        false,
        "MultiDiffusion",
        false,
        10,
        1,
        1,
        64,
        false,
        true,
        1024,
        1024,
        96,
        96,
        48,
        1,
        "None",
        2,
        false,
        false,
        false,
        false,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        false,
        true,
        true,
        false,
        2048,
        128,
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
        null,
        null,
        null,
        0.9,
        5,
        "0.0001",
        false,
        "None",
        "",
        0.1,
        false,
        "<ul>\n<li><code>CFG Scale</code> should be 2 or lower.</li>\n</ul>\n",
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
        0,
        null,
        false,
        null,
        false,
        null,
        false,
        50,
        [],
        "",
        "",
        ""
    ]
}

const get_data_body = (index, prompt, neg_prompt, sampling_step, cfg_scale, seed, sampler, session_hash,
    height, width, upscale_multiplier, upscaler, upscale_denoise_strength, upscale_step, face_restore = false) => {
    if (index === 0) return [
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
        "Use same sampler",
        "",
        "",
        [],
        "None",
        false,
        "MultiDiffusion",
        false,
        10,
        1,
        1,
        64,
        false,
        true,
        1024,
        1024,
        96,
        96,
        48,
        1,
        "None",
        2,
        false,
        false,
        false,
        false,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        0.4,
        0.4,
        0.2,
        0.2,
        "",
        "",
        "Background",
        0.2,
        -1,
        false,
        false,
        true,
        true,
        false,
        2048,
        128,
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
        null,
        null,
        null,
        0.9,
        5,
        "0.0001",
        false,
        "None",
        "",
        0.1,
        false,
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
        0,
        null,
        false,
        null,
        false,
        null,
        false,
        50,
        [],
        "",
        "",
        ""
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
        'lora': '<lora:elainaMajoNoTabitabi_v1:0.85>'
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
        "lora": "<lora:animeLikeTarotCardArt_v10:0.85>"
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
        "keyword": ["line art", "lineart"],
        "lora": "<lora:animeLineartStyle_v20Offset:0.85>",
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
        "keyword": ["add_detail"],
        "lora": "<lora:add_detail:1>"
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
])


// attempt to find trigger word and add the respective lora model
function load_lora_from_prompt(prompt, lora_default_strength = null) {
    // create temp prompt holder
    let temp_prompt = prompt
    // lower case all temp_prompt
    temp_prompt = temp_prompt.toLowerCase()
    // turn all symbol to space
    temp_prompt = temp_prompt.replace(/[^a-zA-Z0-9 ]/g, " ")
    // normalizer space
    temp_prompt = temp_prompt.replace(/\s+/g, " ")
    // trim space  
    temp_prompt = temp_prompt.trim()
    // attempt to search for keyword in normalized temp_prompt (include word boundery)
    const lora_to_load = []
    for (let i = 0; i < word_to_lora_model.length; i++) {
        const word = word_to_lora_model[i]
        const keyword = word.keyword
        const lora = word.lora
        for (let j = 0; j < keyword.length; j++) {
            const k = keyword[j]
            const regex = new RegExp(`\\b${k}\\b`, 'gi')
            if (temp_prompt.search(regex) !== -1) {
                lora_to_load.push(lora)
                if (word.remove_trigger) {
                    prompt = prompt.replace(regex, '')
                }
                break
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
            lora_to_load[i] = lora.replace(/0\.85/g, lora_default_strength.toFixed(2))
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

function initiate_server_heartbeat() {
    setInterval(async () => {
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
    model_name_hash_mapping
}