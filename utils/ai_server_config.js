const server_pool = [
    {
        index: 0,
        url: 'http://0.0.0.0:7860',
        fn_index_create: 115,
        fn_index_abort: 45,
        is_online: true,
    },
    {
        index: 1,
        url: 'http://192.168.196.78:7860',
        fn_index_create: 114,
        fn_index_abort: 45,
        is_online: false,
    }
]

const get_data_body = (index, prompt, neg_prompt, sampling_step, cfg_scale, seed, sampler, session_hash,
    height, width, upscale_multiplier, upscaler, upscale_denoise_strength, upscale_step) => {
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
        [],
        "None",
        "<div class=\"dynamic-prompting\">\n    <h3><strong>Combinations</strong></h3>\n\n    Choose a number of terms from a list, in this case we choose two artists: \n    <code class=\"codeblock\">{2$$artist1|artist2|artist3}</code><br/>\n\n    If $$ is not provided, then 1$$ is assumed.<br/><br/>\n\n    If the chosen number of terms is greater than the available terms, then some terms will be duplicated, otherwise chosen terms will be unique. This is useful in the case of wildcards, e.g.\n    <code class=\"codeblock\">{2$$__artist__}</code> is equivalent to <code class=\"codeblock\">{2$$__artist__|__artist__}</code><br/><br/>\n\n    A range can be provided:\n    <code class=\"codeblock\">{1-3$$artist1|artist2|artist3}</code><br/>\n    In this case, a random number of artists between 1 and 3 is chosen.<br/><br/>\n\n    Wildcards can be used and the joiner can also be specified:\n    <code class=\"codeblock\">{{1-$$and$$__adjective__}}</code><br/>\n\n    Here, a random number between 1 and 3 words from adjective.txt will be chosen and joined together with the word 'and' instead of the default comma.\n\n    <br/><br/>\n\n    <h3><strong>Wildcards</strong></h3>\n    \n\n    <br/>\n    If the groups wont drop down click <strong onclick=\"check_collapsibles()\" style=\"cursor: pointer\">here</strong> to fix the issue.\n\n    <br/><br/>\n\n    <code class=\"codeblock\">WILDCARD_DIR: E:\\AIstuff\\stable-diffusion-webui\\extensions\\sd-dynamic-prompts\\wildcards</code><br/>\n    <small onload=\"check_collapsibles()\">You can add more wildcards by creating a text file with one term per line and name is mywildcards.txt. Place it in E:\\AIstuff\\stable-diffusion-webui\\extensions\\sd-dynamic-prompts\\wildcards. <code class=\"codeblock\">__&#60;folder&#62;/mywildcards__</code> will then become available.</small>\n</div>\n\n",
        true,
        false,
        1,
        false,
        false,
        false,
        100,
        0.7,
        false,
        false,
        false,
        false,
        false,
        false,
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
        "AddNet Model 1",
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
    const default_neg_prompt = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry,missing fingers,bad hands,missing arms, long neck, '
    if (!override_neg_prompt) {
        res = default_neg_prompt + res
    }

    // add nsfw as neg prompt by default
    if (!remove_nsfw_restriction) {
        res = 'nsfw, ' + res
    }
    return res
}

function get_worker_server(force_server_selection) {
    // random between server index with is_online = true
    let server_index = 0
    if (force_server_selection === -1) {
        // random server
        const online_server_pool = server_pool.filter(server => server.is_online)
        server_index = Math.floor(Math.random() * online_server_pool.length)
    }
    else {
        // force server
        server_index = force_server_selection
    }

    return server_index
}

function initiate_server_heartbeat() {
    setInterval(async () => {
        for (let i = 1; i < server_pool.length; i++) {
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
    }, 30000)
}

module.exports = {
    server_pool,
    get_negative_prompt,
    get_data_body,
    get_worker_server,
    initiate_server_heartbeat
}