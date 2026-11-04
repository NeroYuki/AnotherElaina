# Elaina Mk. 2 AI Image Documentation

!!! info Scope and availability
    This page covers the AI image workflows implemented by the bot. A command being documented does not guarantee that every service behind it is enabled on a particular deployment: the Forge image backend, ComfyUI workflows, the local prompt/layout models, CelForge, and the slash-command registration are separate. If a command is missing, replies with a maintenance message, or fails to reach a backend, that is a deployment/configuration issue rather than a different command syntax.

[TOC3]

New here? Start with the [README](README.md). For the non-image half of the bot, see [Non-WD Commands](non-wd-commands.md) and [AI chat](docs/ai-chat.md). For a maintainer-oriented explanation of the architecture, see [How it works](docs/ai-how-it-works.md). Video and 3D specifics live in [Media commands](docs/media-commands.md).

### A Quick Note For People Who Have Never Used a Discord Bot Before

If you already know your way around Discord bots, feel free to skip this section. If not, here is everything you need to use this bot:

- **Slash commands**: Almost everything this bot does is triggered by a "slash command". Type `/` in the chat box and a menu of available commands pops up; keep typing the name to filter it (for example `/wd_create`) and press Enter. Discord shows what each command does before you run it.
- **Command parameters (options)**: Many commands take inputs, shown as options when you type the command. For example `/wd_create` asks for a `prompt`. Options marked with an asterisk are **required**; the rest are optional and have defaults.
- **Choice options**: Some options are menus with fixed labels, such as `upscaler`, `sampler`, `reference_layout`, or `default_neg_prompt`. Pick the **label** Discord shows; the bot may store a different internal value for it. The examples below show option names and the labels you will see.
- **Uploading images**: Commands that need an image (such as `/wd_img2img`, `/wd_ref2img`, `/wd_inpaint`, and `/wd_upscale`) have an `image:` option. Attach the file to the message, then select the attachment in the command.
- **Subcommands**: Some commands contain smaller commands inside them. For example `/wd_setting set`, `/wd_setting check`, and `/wd_setting reset`; pick the subcommand after typing the main command.
- **Context menus**: A few features are not slash commands. Right-click (or tap-and-hold on mobile) a message containing an image, go to **Apps**, and look for options such as "Find sauce" and "SD Image Info".
- **Chatting with the bot**: Mention the bot in a channel followed by your message to chat with it. See [Non-WD Commands](non-wd-commands.md) and [AI chat](docs/ai-chat.md).
- **Cooldowns**: Every generation command has a cooldown so the backend is not overloaded. If the bot says to wait, wait a little before trying again.

In this page, an example such as `/wd_create prompt:a girl` shows the command and option names. In Discord, free-text values are typed and choice values are selected from the menu.

### Start Here: Goal To Command

| What you want to do | Start with | Main controls | Notes |
|---|---|---|---|
| Make an image from a description | `/wd_create` or `/wd_create_adv` | `prompt`, `neg_prompt`, `checkpoint`, `width`, `height`, `seed` | Basic mode uses the curated checkpoint menu. Advanced mode exposes sampler, scheduler, CFG, steps, clip skip, hires controls, ControlNet, and ADetailer. Extra scripts are an img2img feature. |
| Keep an existing image's composition but change style/detail | `/wd_img2img` or `/wd_img2img_adv` | `image`, `prompt`, `denoising_strength` | Low denoise preserves more; high denoise changes more. This is whole-image denoising, not identity-preserving reference editing. |
| Use one to four images as references for an edit | `/wd_ref2img` or `/wd_ref2img_adv` | `image`, `reference_2`…`reference_4`, `reference_layout`, `edit_variant`, `checkpoint` | The selected model must have native reference/edit conditioning. See the [compatibility matrix](#reference-model-compatibility). |
| Redraw only part of an image | `/wd_inpaint` | `image`, `mask` or `segment_anything_prompt`, `prompt`, `denoising_strength`, `mask_blur` | The mask defines the edit region; blur, resizing and whole-picture processing can also affect the surrounding appearance. Use `mask_color: Raw - No detection` for a saved raw mask. |
| Extend the canvas | `/wd_img2img` or `/wd_img2img_adv` with `extra_script: Native Outpaint`; or a Flux script | `/wd_script_outpaint set`, then `extra_script` | Native Outpaint is SD1/SDXL only. Flux Outpaint and Flux Kontext run on ComfyUI. |
| Upscale while generating | Hires Fix in `/wd_create`/`/wd_create_adv`; Tiled Latent Upscale in img2img; PiD in generation commands | `upscale_multiplier`, `upscaler`/`upscaler_mode`, extra script | These are different operations with different limits. See [Upscaling paths](#upscaling-paths-hires-tiled-extras-seedvr2-and-pid). |
| Upscale an existing image without regenerating it | `/wd_upscale` | `upscaler`, `upscale_multiplier`, `seedvr2_model` | Classic upscalers are fast; SeedVR2 reconstructs detail and is much heavier. |
| Control pose, depth, lineart, or layout | `/wd_controlnet set`, then a generation command with `controlnet_input` | `controlnet_model`, `controlnet_preprocessor`, weight/mode | ControlNet is applied on Forge SD/SDXL requests; it is not applied to Flux generation in this bot. |
| Fix faces or hands | `/wd_adetailer set`, then `do_adetailer:true` in an advanced command; or `/wd_inpaint` | detector, threshold, mask blur/padding, denoise | ADetailer repaints detected regions. Inpainting gives you direct control over the region. |
| Put different subjects in different regions | Forge Coupler tags in the prompt, or `/wd_layout_draft` | `<=>`, `\|\|`, Advanced `\|x1:x2,y1:y2,weight\|` regions | Coupler is for SD/SDXL. Layout drafts can also save a reusable `<layout:name>` token. |
| Add detail to a short prompt automatically | `/wd_setting set` with `image_prompt_quality` | `image_prompt_quality`, `image_prompt_batch`, `image_prompt_style`, `image_prompt_layout` | Off by default. The enhancer appends text only and preserves the original prompt. |
| Save and reuse generation settings | `/wd_profile_add`, then `profile:<name>` | prompt prefixes, size, sampler, CFG, steps, checkpoint, configs | Profiles are stored per user; another user's profile can be used as a fallback if you do not own that name. |
| Describe an image | `/wd_interrogate` | `engine`, `florence_task`, `florence_prompt` | Florence 2 family only; CLIP/DeepBooru are retired. |
| Read generation metadata or find a source | Context menu **SD Image Info** / **Find sauce**, or `/wd_imginfo` | image attachment | Metadata can be stripped by the uploader; sauce search is best-effort. |
| Make a video | `/wd_txt2vid`, `/wd_img2vid`, `/wd_ref2vid`, `/wd_vid_upscale` | prompt, image/reference, preset, length, upscale | Implemented with MiniMax H3 workflows; availability depends on the ComfyUI/media service. See [Media commands](docs/media-commands.md). |
| Make a 3D model | `/wd_img2model` | `image`, `recipe`, `seed`, `download_glb` | Uses CelForge and returns an orbit video; GLB is optional. This command does not expose a Cancel button. |

### Cancelling a Generation

Use the **Cancel** button on the bot's progress reply. The button is filtered to the person who started the request, so another user cannot cancel your job.

- **Forge generation** (`/wd_create`, `/wd_create_adv`, `/wd_img2img`, `/wd_img2img_adv`, `/wd_ref2img`, `/wd_ref2img_adv`, `/wd_inpaint`): cancellation is owned by the command instance. The bot waits until it can prove that *this* request is the one running before sending Forge's global interrupt. If the request is still queued, it waits and re-checks instead of interrupting whoever is currently generating. A cancel that arrives before the image request is submitted suppresses that submission.
- **Preparation and step boundaries**: input preparation, prompt enrichment, and some model setup can finish before a Cancel button appears. Once the button is available, cancellation records your intent; model setup, uploads, result rendering, and PiD restoration can finish before the next inference is suppressed. The bot keeps tracking a submitted request until it has stopped.
- **ComfyUI generation** (`Flux Outpaint`, `Flux Kontext`, Flux inpaint, interrogation, and the media workflows): the bot requests cancellation of the exact queued or running prompt on the exact ComfyUI instance. It confirms queue/history/websocket evidence before calling the job cancelled. Cancelling while an upload is still running prevents submission.
- **Batches**: if the bot is sending images one at a time (for example `image_prompt_batch: Each`), it checks cancellation before each image and stops before the next one. A cancellation inside a single multi-image Forge request stops that inference; do not assume all backend internals stop at the same instant.
- **Failure reporting**: if the backend refuses or cannot confirm cancellation, the bot says so instead of pretending the job was cancelled. A button from a finished request cannot stop a later request.
- **Not universal**: not every command exposes Cancel. For example `/wd_img2model` (CelForge), profile/config commands, `/wd_upscale`, and `/wd_rembg` do not attach the shared generation Cancel control. Check the progress reply before assuming a button exists.

### Text To Image (`/wd_create`, `/wd_create_adv`)

The beginning of everything: describe what you want, optionally choose a checkpoint, and generate.

```text
/wd_create prompt:1girl, silver hair, standing on a rooftop at night, city lights, looking at viewer
```

Useful optional values:

- `neg_prompt` — things you do not want in the result. For current distilled/flow models, negative prompting may have little effect; do not rely on it to fix a composition.
- `checkpoint` — a menu label from the command's checkpoint list. See [Model selection](#model-selection-menus-cache-and-active-model).
- `width` / `height` — output size; the bot rounds to multiples of 8. Basic `/wd_create` clamps to 512–2048 per side; advanced `/wd_create_adv` allows 64–4096; img2img, reference, and inpaint paths cap at 2048. Stay near the model's trained resolution rather than using the maximum just because it is accepted.
- `seed` — reproducibility. `-1` means random.
- `default_neg_prompt` — one of `Quality - SFW`, `Quality - NSFW`, `None - SFW`, or `No Default`. This controls the injected quality/SFW prompt text; `No Default` disables that prompt preset. Channel/guild output-censor settings are a separate control.
- `profile` — reuse a saved setup. See [Saving a generation profile](#saving-a-generation-profile-wd_profile).
- `bulk_size` — basic/advanced text-to-image can generate more than one image per request (up to 6 for regular users; the backend still applies its own limits). `Each` prompt enhancement does not raise this limit.

Basic `/wd_create` also exposes `upscale_multiplier` and `upscaler_mode` (`Latent - VERY SLOW`, `ERSGAN - Normal`, `Lanczos - Fastest`, or `PiD - fixed 4x (SDXL)`). Advanced `/wd_create_adv` separates the hires controls into `upscale_multiplier`, `upscaler`, `upscale_denoise_strength`, and `upscale_step`, and adds sampler, scheduler, `cfg_scale`, `sampling_step`, `clip_skip`, `keep_metadata`, ControlNet, ADetailer, and more.

#### Starter Examples

A 2:3 portrait on an Illustrious-family model with a saved quality baseline:

```text
/wd_create prompt:1girl, original character, black coat, snowy street, cinematic lighting checkpoint:WAI-NSFW-IllustriousXL v16 width:832 height:1216 default_neg_prompt:Quality - SFW
```

Advanced control over sampler and guidance:

```text
/wd_create_adv prompt:1girl, silver hair, red eyes, library, warm light checkpoint:AnimagineXL v4 sampler:Euler a scheduler:Automatic cfg_scale:6 sampling_step:28 width:1024 height:1024 clip_skip:1
```

A natural-language model (Qwen/MOSS/Flux/Krea) usually does better with a sentence than a comma-separated tag pile:

```text
/wd_create prompt:A quiet bookshop at dusk, warm lamps, rain on the windows, a cat sleeping on the counter, detailed background
```

Use a saved style profile and override only the subject:

```text
/wd_create prompt:a knight resting beside a campfire, profile:soft_painting width:1216 height:832 seed:123456789
```

#### Prompting

There are two common prompt styles:

```text
Natural language: A girl with long black hair sits in a chair, drinking tea from a china cup while looking at the viewer.
Booru tags: 1girl, long hair, black hair, sitting, on chair, holding cup, teacup, drinking, looking at viewer
```

Neither style is universally better. Tag-style prompting tends to suit SD1.x, SDXL/Illustrious, Pony, and Anima-style anime checkpoints; natural language tends to suit Flux/Chroma, Klein, Qwen, MOSS, Lumina, Krea, and similar newer models. Some models understand both but respond more predictably to one.

For tag-style models, a common order is `subject count, character name, franchise/source, clothing/pose, setting, lighting, style/quality`. The exact trigger tags are model-specific; consult the model card rather than assuming a universal character list.

**Weighting.** A pair of parentheses raises emphasis by roughly 10%: `((chair))` is about `1.21×`. A pair of square brackets lowers it: `[[big breast]]` is roughly `(big breast:0.81)`. You can also use numeric weights such as `(chair:1.2)` or negative weights where the backend supports them. Extreme values can damage composition; start small.

**Prompt order and BREAK.** Long prompts tend to lose influence toward the end. Some backends accept `BREAK` to split the prompt into chunks:

```text
ganyu, genshin impact BREAK office lady outfit, office interior
```

**Quality tags.** Many booru-trained models use quality tags such as `masterpiece`, `best quality`, `good quality`, `bad quality`, and `worst quality`. Pony-lineage models often use `score_9`, `score_8`, `score_7`, and so on. Adding every quality tag at once is not a guarantee of a better image.

**Negative prompts.** `neg_prompt` is for things you want to avoid. Quality tags are often the most useful part. Current guidance-distilled models (several Flux/Krea/Qwen Turbo presets) run at low or CFG 1 style guidance, where a negative prompt may have little or no effect. That is a property of the guidance setup, not a universal rule for every model or workflow. If you need strong negative control, use a model/workflow that exposes meaningful CFG, or use masking/inpainting to correct the region.

**Resolution.** These models were trained around particular resolutions. A rough starting point:

| Model class | Typical starting bucket |
|---|---|
| SD1.x | 512×512 class; 768×512 and similar aspect ratios |
| SDXL / Illustrious / Pony / Anima | 1024×1024 class; 832×1216 and 1216×832 are common |
| Flux / Chroma / Klein / Qwen / MOSS / Krea / Lumina | 1024–1408 class; check the model card |

Going well outside the trained area tends to produce repeated bodies, long necks, extra limbs, or blur. The bot warns when the requested area is above a model-class threshold, but that is a warning rather than a hard stop. Dimensions are rounded to multiples of 8; the basic txt2img, img2img, reference, and inpaint commands cap at 2048 per side, while advanced txt2img accepts up to 4096. Acceptance is not a quality guarantee. For a larger finished image, generate in-distribution and upscale rather than asking for a huge canvas directly.

Further reading: [Danbooru tag groups](https://danbooru.donmai.us/wiki_pages/tag_groups) explains common tag families; the [Latent Diffusion paper](https://arxiv.org/abs/2112.10752) and [SDXL paper](https://arxiv.org/abs/2307.01952) cover the model side.

#### Core Vocabulary (How It Works)

<details>
<summary>Checkpoint, VAE, and text encoder</summary>

A **checkpoint** is the main model bundle used to denoise latents. In practice a checkpoint often includes a U-Net/backbone, a text encoder, and a VAE (or the bot loads companion VAE/text-encoder files separately). The **VAE** converts between pixel space and the compressed latent space. The **text encoder** turns your prompt into conditioning vectors. A mismatched VAE/text encoder can produce colour shifts, blur, or errors, which is why the bot loads companion modules when switching model families.

</details>

<details>
<summary>Seed, steps, sampler, scheduler, CFG, shift, denoise</summary>

- **Seed** initializes the noise pattern. Same prompt, model, settings, and seed usually produce the same image, though backend nondeterminism can still cause small differences.
- **Sampling steps** are how many denoising iterations run. More is not automatically better; past a point it mainly costs time.
- **Sampler** is the numerical method used to move from noise toward an image. **Scheduler** controls how noise levels are spaced across those steps.
- **CFG scale** is classifier-free guidance. Higher values push harder toward the prompt and can produce a burnt-in look; lower values allow more freedom and can drift. Distilled models often use CFG 1 or a low value.
- **Shift / distilled CFG** is a separate control used by some flow/distilled model families. Do not treat it as a second ordinary CFG slider; use the model family's defaults unless you know the model's recommended range.
- **Denoising strength** controls how much noise is introduced before img2img or inpaint sampling. Lower values usually retain more source content; higher values allow larger changes. Resizing, VAE conversion and postprocessing can still alter pixels at low or zero denoise, so it is not a pixel-preservation or quality slider.

</details>

<details>
<summary>LoRA, textual embedding, and ControlNet are different things</summary>

- A **LoRA** is a small adapter that modifies the main model's behaviour, usually for a character, style, or concept. It is not a full checkpoint, and compatibility depends on the base architecture and training target.
- A **textual embedding** is a learned token or set of tokens that changes prompt conditioning. It is usually small and model-family-specific.
- **ControlNet** adds spatial conditioning from an input image (pose, depth, lineart, tile, and so on) so the denoiser follows that structure. This is a different role from a style/subject LoRA; some lightweight control implementations also use adapter-style weights.
- **IP-Adapter** is image-prompt conditioning; it is neither a LoRA nor a standard ControlNet preprocessor, even though both appear in the ControlNet configuration menu.

</details>

### Model Selection: Menus, Cache, And Active Model

#### What The Menus Actually Show

The `checkpoint` menu is a convenience list, **not the full installed catalog**, and different commands show different lists:

| Where | What the menu contains |
|---|---|
| `/wd_create`, `/wd_img2img` | The small **curated** list (ten models). Useful as a default set, not a complete inventory. |
| `/wd_create_adv`, `/wd_img2img_adv` | Standard SD1.x and SDXL-lineage checkpoints, excluding legacy entries. |
| `/wd_ref2img`, `/wd_ref2img_adv` | Only checkpoints with implemented reference/edit conditioning, capped to keep the option list manageable. |
| `/wd_modelchange` | Standard checkpoints plus a **LEGACY MODELS** submenu; `experimental_checkpoint` exposes additional families. |
| `/wd_setting set hires_checkpoint` | Standard checkpoints plus **LEGACY MODELS** and **EXPERIMENTAL MODELS** submenus. |
| `/wd_profile_add checkpoint` | Standard checkpoints plus legacy/experimental submenus. |

The **active model** is whatever Forge currently has loaded. If you omit `checkpoint`, a generation command uses the active model. If you choose a checkpoint, the bot tries to switch to it; when it is not cached or cannot be loaded, non-reference commands generally report the failure and continue with the active model, while a reference command with an explicit checkpoint fails instead of silently using a model whose edit policy might not apply. Use `/wd_modelchange` to load a model outside the current menu, including `experimental_checkpoint` for newer families. A successful forced model change has a 30-minute cooldown; ordinary per-request selections do not.

The bot tracks roughly the three most recently used checkpoints in its own cache, but Forge still has to load anything it does not currently hold. A cached entry can be evicted by another request. If the model you selected is slow to load, that is model loading, not a broken prompt.

**Display labels versus filenames.** Discord shows a friendly label; profiles, logs, and cached-model messages may show the stored filename (often a basename without the `archive/` or `comfy_sym/` directory). Examples:

| Menu label | Stored filename (example) |
|---|---|
| `AnimagineXL v4` | `animaginexl_v40_opt.safetensors` |
| `NoobAIXL v1.1` | `noobaixl_v1_1.safetensors` |
| `WAI-NSFW-IllustriousXL v16` | `wai_nsfw_illustrious_v160.safetensors` |
| `Flux2 Klein 9B NVFP4` | `flux-2-klein-9b-nvfp4.safetensors` |
| `Qwen Image 2.1 Turbo Int8 ConvRot` | `qwen_image_2.1_turbo_int8_convrot.safetensors` |
| `MOSS Image SFT BF16` | `moss_image_sft_bf16.safetensors` |
| `Krea 2 Turbo` | `krea2_turbo_int8_convrot.safetensors` |
| `Flux Kontext.dev Q8_0` | `comfy_sym/flux1-kontext-dev-Q8_0.gguf` |
| `Pastel Mix v2.1` | `pastelmix.safetensors` |

The same checkpoint can therefore appear under a short name in a menu and a longer filename in a cache report. Treat them as the same model, not two installations.

#### Installed Catalog At A Glance

The lists below follow the current `utils/ai_server_config.js` catalogs. They are **deployment notes, not benchmark rankings**: model quality depends on the prompt, settings, LoRA, and what you are trying to make.

**Curated menu** (shown by basic `/wd_create` and `/wd_img2img`):

| Label | Family | Default preset notes |
|---|---|---|
| `Flux2 Klein 9B NVFP4` | Klein | Euler / Beta, 4 steps, CFG 1 |
| `WAI-NSFW-IllustriousXL v16` | Illustrious/SDXL | 24-step SDXL family default; command sampler/scheduler defaults apply |
| `IllumiyumeXL V-pred v3.1` | Illustrious V-pred | V-pred model; the bot may apply a simple latent-modifier fallback |
| `Krea 2 Turbo` | Krea | Euler / Simple, 8 steps, CFG 1 |
| `Pastel Mix v2.1` | SD1.x | DPM++ 2M / Karras, 32 steps, CFG 7; 512-class |
| `Qwen Image 2.1 Int8 ConvRot` | Qwen 2.1 | Euler / Simple, 40 steps, CFG 1 |
| `Qwen Image 2.1 Turbo Int8 ConvRot` | Qwen 2.1 Turbo | Euler / Simple, 8 steps, CFG 1 |
| `Qwen Image 2.1 Uncensored Int8 ConvRot` | Qwen 2.1 | Euler / Simple, 40 steps, CFG 1 |
| `MOSS Image Base BF16` | MOSS | Euler / Simple, 36 steps, CFG 3, shift 5 |
| `MOSS Image SFT BF16` | MOSS | Euler / Simple, 36 steps, CFG 3, shift 5 |

**Additional active SD1.x and SDXL-lineage menu labels** include `Pastel Mix v2.1`, `HimawariMix v8`, `AnimagineXL v4`, `AnimagineXL v3.1`, `NoobAIXL v1.1`, `NoobAIXL V-pred v1.0`, `NoobAIXL MDNT V-pred v1.0`, `Seele NoobAIXL V-pred v2.0`, `Chenkin NoobAI v0.5`, `Chenkin NoobAI v0.3 Rectified Flow`, `ChimeraXL v2`, `Juggernaut XL`, `StableYogis Realism v4`, `SilverMoonMix3 v2`, `SilenceMix v3`, `ZukiCuteIL v5`, `ZukiNewCuteIL v1`, `ColorPalette v1`, `PVC Model Style v1.1`, `Mugen - Aesthetic`, `IllustriousXL v2.0`, and `WAI-NSFW-IllustriousXL v16`. The legacy picker also exposes older entries such as `AnimagineXL v3`, `NekorayXL v0.6`, `Dreamshaper XL Lightning`, `PonyDiffusionXL v6`, `PonyRealism v2.2`, `IllusionBreed v3`, `RealVisXL v5`, `IllustriousXL v1.0/v1.1`, `WAI-NSFW-IllustriousXL v12`, `PrefectPony v5.0`, `AutismMix PonyXL`, `IllumiyumeXL V-pred v3.2`, and `Rouwei V-pred v0.8`. They remain installed for compatibility, but do not treat "legacy" as a quality ranking.

**Experimental menu** (`experimental_checkpoint`): Flux/Chroma (`Flux.dev Q8_0`, `Flux Krea.dev Q8_0`, `Flux Fill.dev Q8_0`, `Pixelwave Flux v3 Q8_0`, `Chroma1 HD Q8_0`, `Chroma1 HD Flash Q8_0`, `Chroma Detail v0.94 Q8_0`), Klein (`Flux2 Klein 9B NVFP4`, `Flux2 Klein 9B Int8 ConvRot`, `Flux2 Klein 4B`), `Anima Base v1`, `Anima Aesthetic v1.1`, `Anima Turbo v1.0`, `WAI Anima v1`, `Neta Lumina v1`, `NetaYume Lumina v3`, Qwen 2.1 (standard/Turbo/Uncensored), MOSS (Base/SFT BF16/SFT Int8 ConvRot), `Z Image Turbo`, and Krea 2 (Turbo/Raw). Flux Kontext is available in the reference menu rather than the experimental generation list.

Family-level defaults are applied when you leave fields unset. The important ones are:

| Family | Default sampler / scheduler | Steps | Guidance notes |
|---|---|---|---|
| SD1.x | DPM++ 2M / Karras | 32 | CFG 7 |
| SDXL / Illustrious / Pony | no family sampler override; 24 steps | 24 | command/profile default |
| Flux / Chroma | Euler / SGM Uniform | 20 | distilled guidance (CFG 1, dcfg 3) |
| Klein | Euler / Beta | 4 | CFG 1 |
| Anima | ER SDE / Beta | 32 | CFG 4 |
| Lumina | no family sampler override | 32 | dcfg 6 |
| Qwen 2.1 | Euler / Simple | 40 (Turbo 8) | CFG 1 |
| MOSS | Euler / Simple | 36 | CFG 3, dcfg 5 |
| Z Image Turbo | Euler / Beta | 9 | CFG 1, dcfg 9 |
| Krea 2 | Euler / Simple | 8 | CFG 1, dcfg 1.15 |

Overrides from the command/profile take priority. `dcfg` is the family's distilled/guidance default from `model_defaults`; the command maps it to the appropriate CFG/shift field for that family. Individual models may have additional forced presets in the command code; if a model's card recommends different settings, follow the card or your own measured results rather than treating the table as a universal law.

Further reading: [Flux model family](https://blackforestlabs.ai/announcing-black-forest-labs/), [Flux Kontext model card](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev), [Qwen Image 2.1](https://huggingface.co/Qwen/Qwen-Image-2.1), [Qwen Image 2.1 Turbo](https://huggingface.co/Qwen/Qwen-Image-2.1-Turbo), [MOSS Image Base](https://huggingface.co/OpenMOSS-Team/MOSS-Image-Base), and the [Animagine XL 4.0 model card](https://huggingface.co/cagliostrolab/animagine-xl-4.0). For the current installed labels, the source of truth is [utils/ai_server_config.js](utils/ai_server_config.js).

### Image To Image (`/wd_img2img`, `/wd_img2img_adv`)

Image-to-image takes an existing image, adds noise based on `denoising_strength`, and denoises it again with your prompt. It is a whole-image process: it does not know which pixels are a face, a logo, or a background unless you mask them.

- `denoising_strength` near `0.2`–`0.45` keeps composition and makes a refined variant.
- Around `0.5`–`0.75` changes style and detail substantially while keeping the rough layout.
- Near `0.9`–`1.0` reinterprets the image and may lose the original subject. If you need identity preservation, use reference editing or inpainting instead.

```text
/wd_img2img image:[attachment] prompt:1girl, watercolor illustration, soft light, detailed background denoising_strength:0.45 width:1024 height:1024 default_neg_prompt:Quality - SFW
```

Advanced mode adds sampler, scheduler, CFG, steps, clip skip, ControlNet, ADetailer, and extra scripts.

#### Tiled Latent Upscale

This is an img2img extra script, not the retired `Ultimate SD upscale` and not SeedVR2. It keeps the source image as the img2img input, multiplies the requested base width/height by `upscale_multiplier`, and uses Forge's native `Latent Upscale` resize mode with Mixture of Diffusers or MultiDiffusion tiling. It refines at a larger size; it does not create a new scene from nothing.

Configure it with:

```text
/wd_script_upscale set upscale_multiplier:2 method:Mixture of Diffusers tile_width:1024 tile_height:1024 tile_overlap:128 tile_batch_size:1
```

Then select `extra_script: Tiled Latent Upscale` in `/wd_img2img` or `/wd_img2img_adv`.

Settings:

- `upscale_multiplier`: output multiplier from 1 to 4; default 2. Use 1 for tiled refinement at the same output size.
- `method`: `Mixture of Diffusers` (default) or `MultiDiffusion`.
- `tile_width` / `tile_height`: tile size, snapped to 64px. Width defaults to 1024; height 0 means "same as width"; values are clamped to 256–2048.
- `tile_overlap`: overlap in pixels, snapped to 16px, default 128. It must be smaller than both tile dimensions.
- `tile_batch_size`: tiles per batch, 1–8, default 1. Larger batches use more memory.

Only SD1/SDXL checkpoints (and their mapped inpaint checkpoints) are supported. Target dimensions are capped at 8192px. Use a conservative `denoising_strength` (roughly 0.2–0.45); higher values change the image more. Bigger tiles, batches, and scales cost more time and memory. If seams appear, increase overlap, use larger tiles, or lower the scale/denoise rather than stacking more postprocessing.

Example:

```text
/wd_img2img_adv image:[attachment] prompt:1girl, fu xuan, detailed outfit, soft light denoising_strength:0.35 sampler:DPM++ 2M scheduler:Automatic sampling_step:35 default_neg_prompt:No Default extra_script:Tiled Latent Upscale
```

`Tiled Latent Upscale` and `Native Outpaint` are offered in both img2img commands. The Flux-based scripts (`Flux Outpaint`, `Flux Kontext`) are also available there.

### Reference Editing (`/wd_ref2img`, `/wd_ref2img_adv`)

Reference commands use a model's native reference/edit conditioning. They are not "img2img with a high denoise": the model receives one or more reference images through a dedicated path, and the prompt describes the edit.

The primary `image` is the edit target/first reference. `reference_2`, `reference_3`, and `reference_4` add up to three more images (four total).

```text
/wd_ref2img_adv image:[target] reference_2:[second image] prompt:put the character from reference 2 into a rainy city street, cinematic lighting reference_layout:Native edit_variant:General
```

#### Reference Model Compatibility

| Checkpoint family | Installed reference-capable checkpoints | Reference switch / policy | Required edit LoRA |
|---|---|---|---|
| Qwen 2.1 | Standard, Turbo, Uncensored | `qwen21_do_reference` | None |
| Klein (Flux2) | 9B NVFP4, 9B Int8 ConvRot, 4B | `klein_do_reference` | None |
| Anima | Base, Aesthetic, Turbo, WAI | `anima_do_reference` | `AnimeEditV2` (added automatically). Every Anima reference edit runs a mandatory Qwen 27B instruction pass; the edit LoRA follows the rewritten instruction far more reliably than a terse tag or command. |
| MOSS | Base, SFT BF16, SFT Int8 ConvRot | `moss_do_reference` (`Moss-Image-Edit`; `Disable` outside reference) | `moss_image_edit_lora_rank_64_bf16` (added automatically). SFT Int8 ConvRot is automatically replaced by SFT BF16 for reference edits; the edit LoRA does not apply reliably to the int8 checkpoint. MOSS also runs the mandatory Qwen 27B instruction pass, which expands vague outfit/style requests into concrete visual targets. |
| Krea 2 | Turbo, Raw | `krea2_do_reference` | `krea2_general_edit_v2` for General; `krea2_identity_edit_v2` for Identity |
| Flux Kontext | `Flux Kontext.dev Q8_0` | native reference/context path | None |
| Flux Dev | Not reference-capable | Automatically replaced by the installed Flux Kontext checkpoint; the bot tells you it did so | None |
| SD1.x / SDXL / Illustrious / Pony / other families | Not reference-capable in this workflow | Use img2img, inpaint, or a model from the table above | — |

The bot checks the required edit LoRA is visible to Forge before generation. If it is missing, the request fails with a clear message instead of producing an unedited image. An explicit `<lora:...>` tag in your prompt is detected and not duplicated. A second Krea edit LoRA is not added at weight 1 over your existing one.

Klein reference edits use the family CFG of 1; the generic CFG value is not applied, which avoids the colorful artifacts and mottled backgrounds that appear at higher CFG. Anima and MOSS reference edits run a mandatory instruction pass with Qwen 27B (`Qwen3.8-27B-GGUF`, `UD-Q4_K_M`, `unsloth-gpu0`) before the image request. The pass receives the reference image(s) and the user's prompt, rewrites it as a direct natural-language instruction, and appends the edit LoRA. For MOSS, vague requests such as `change her to casual clothes` are expanded into concrete targets, including which existing items should be removed or replaced. Write the change itself, for example `make her dress red`; the bot supplies the surrounding instruction. If the instruction pass fails, the image request is not submitted, so you never get a silently unedited reference image. The pass runs even when `image_prompt_quality` is Off; enabling that setting adds the normal enrichment pass afterward.

Reference commands default `denoising_strength` to 1. They do not use ControlNet attachments or extra scripts, and references are never also sent to ControlNet. Prompts still accept ordinary LoRAs and wildcard syntax.

#### Reference Layouts, Order, And Letterboxing

- `reference_layout: Native` (default) sends the first image as the normal img2img input and the remaining images through Forge's native ImageStitch reference gallery. It is **not** a literal collage; the model receives separate reference conditioning.
- `Horizontal`, `Vertical`, and `Grid` build one combined image from all references. The order is always `image`, `reference_2`, `reference_3`, `reference_4`. Horizontal forms one row, Vertical one column, and Grid uses enough columns to fit the square root. Each tile is resized with "contain" and gets white padding, so mixing portrait and landscape references can add visible white bars.
- For Native, each reference is resized to fit within the reference side limit (1024px by default), flattened onto white, and padded to a multiple of 64 on the right/bottom. The primary image is also resized/padded and the output is contained into the requested `width`/`height`, so unusual aspect ratios can letterbox.
- Anima Native multi-reference requests resize every reference to the same output dimensions and round the target to multiples of 64. Anima concatenates reference latents along the temporal axis, so references with different H/W sizes otherwise fail with `Sizes of tensors must match`.
- Output dimensions are 64–2048px per side and default to the primary upload's size. Reference count is limited to four. If you need a specific border-free result, crop the input to the target aspect ratio first.

#### Choosing Reference Versus Img2img, Inpaint, Or Outpaint

| Path | What is preserved | Best use |
|---|---|---|
| img2img denoise | Rough composition/colors through the noised image latent | Style passes, detail variants, anime-fying a photo when exact identity is not critical |
| Native reference edit | The model's learned reference/identity conditioning, not exact pixels | "Use this character/outfit/object in a new scene"; combine up to four references |
| Masked inpaint | Everything outside the mask | Local fixes, object replacement, region edits |
| Outpaint | The original source rectangle, except a narrow overlap strip at expanded edges | Extending the frame, adding sky/background around a subject |

Do not assume a reference model will preserve every pixel. It may change pose, clothing details, or background in service of the prompt. For exact preservation, mask the region or use img2img with low denoise.

Further reading: [IP-Adapter](https://arxiv.org/abs/2308.06721) explains image-prompt conditioning; model-specific reference behaviour belongs in the checkpoint card linked above.

### Inpainting (`/wd_inpaint`)

Inpainting redraws a selected area of an image and keeps the rest. Use it to fix hands/faces, replace an object, remove something, or change a local feature.

The bot supports two ways to define the area:

1. **Manual mask** — attach a `mask` image. White (or the selected mask colour) marks the editable area; black protects the rest.
2. **Automatic detection** — provide `segment_anything_prompt`. GroundingDINO finds candidate boxes, then SegmentAnything refines the shape. You choose the detected box; the bot can also return a reusable mask image.

```text
/wd_inpaint image:[attachment] prompt:1girl, red bunnygirl latex outfit, knee-high stockings, beautiful color, best quality neg_prompt:worst quality, bad quality, jpeg artifacts, bad anatomy, 2girls, cropped, more than 2 legs denoising_strength:1 mask_blur:4 mask_content:Fill - Keep color segment_anything_prompt:bunnygirl latex outfit
```

Key controls:

- `denoising_strength`: how much the masked area is noised. `1` is common for a full replacement; lower values preserve more of the original region.
- `mask_blur`: feathers the mask boundary. Higher values blend more but can leak changes outside the intended edge.
- `mask_content`: `Fill - Keep color`, `Original - Keep both color and comp.`, `Latent Noise - Keep composition`, or `Latent Nothing - Keep nothing`. The default is `Latent Nothing - Keep nothing`.
- `mask_color`: the colour used to detect the mask. Use `Raw - No detection` for a mask saved from automatic mode or an exact black/white mask.
- `mask_increase_padding`: expands the detected mask by this many pixels (0–64; default 24).
- `inpaint_area`: `Whole picture`, `Whole picture - Masked control`, or `Only masked`. Leave it on `Whole picture` unless you know why you need the others.
- `controlnet_preprocessor_override`: `None - No preprocessor`, `Fill`, `Inpaint`, or `Inpaint NoobAI`.

If `default_neg_prompt` is `No Default` and the negative prompt is empty, the command forces CFG 1. That is a current implementation detail, not a recommendation for every model.

#### Anima Inpainting Guardrail

When the active checkpoint is Anima, `/wd_inpaint` uses the installed inpaint ControlNet pair below. This older 3-channel LLLite model expects the white-mask edit pixels to be black-filled; `inpaint_noobai` does that.

| Active family | ControlNet model | Preprocessor | Resolution |
|---|---|---|---|
| Anima | `animaLllite_006-inpainting` | `inpaint_noobai` | 1024 |
| Other SD/SDXL | your `/wd_controlnet` config, or the inpaint default | your saved choice | saved/default |

The command's normal `Fill` preprocessor is not passed through as an override. If you supply a saved ControlNet config for Anima, select `Inpaint NoobAI` explicitly. Other Anima ControlNet models or preprocessors fail with a clear compatibility message instead of silently producing a bad mask. Anima reference edit mode is disabled for the inpaint request and restored afterwards.

### Outpainting

#### Native Outpaint (SD1/SDXL)

`Native Outpaint` expands the canvas and uses Forge's native masked inpainting to generate the added margins. The padding is initialized by extending the nearest edge pixel of the source outward, including at the corners, so there is no stretched or blurred copy of the whole image. The source stays in its exact original rectangle, and native inpainting repaints a narrow overlap strip along each expanded side to blend the join. The central area stays masked, while mask blur feathers the transition on both sides of the overlap. Subject details near an expanded edge, such as a face or object touching the border, can still change inside that strip.

Configure it with `/wd_script_outpaint set`, then choose `extra_script: Native Outpaint` in either img2img command.

- `size`: padding per selected side (default 128px), snapped up to 8px.
- `direction`: accepts `LRUD` (left, right, up, down); case-insensitive.
- `top`, `bottom`, `left`, `right`: override individual sides. `0` means "use `size` for this selected side".
- `overlap`: how many pixels inside each expanded source edge are repainted (default 64, snapped up to 8px). It is capped at a quarter of the source side, so at least the central half stays black in the mask before feathering. Sides without padding do not get an overlap strip.
- `mask_blur`: default 32; explicit 0 disables blending. Existing saved settings keep their stored value, including an explicit 0.
- Omitted `denoising_strength` defaults to 1 for this mode.

```text
/wd_script_outpaint set size:128 direction:LRUD
```

```text
/wd_img2img_adv image:[attachment] prompt:a woman in a red dress standing in a city street with buildings in the background and a bird flying overhead, official art, a detailed painting denoising_strength:1 sampler:Euler scheduler:Normal cfg_scale:5 sampling_step:24 extra_script:Native Outpaint
```

This path supports SD1/SDXL. It uses the matching inpaint checkpoint when the bot has a mapping; otherwise it keeps the selected SD1/SDXL model. Dedicated inpaint checkpoints usually work best. Describe the complete desired scene in the prompt. Qwen 2.1 and MOSS are not enabled for masked outpainting: Qwen's tested path left the margins unchanged, and MOSS lacks a validated masked-outpaint path in this installation. Their reference-editing paths are separate (see [Reference Model Compatibility](#reference-model-compatibility)). Coupler regions cannot be combined with Native Outpaint.

The removed `Outpainting mk2` and `Ultimate SD upscale` selections are retained only as retired aliases for stale interactions: `Outpainting mk2` maps to `Native Outpaint`, and `Ultimate SD upscale` maps to `Tiled Latent Upscale`. Existing saved settings remain usable; obsolete outpaint falloff/colour-variance and upscale seam-fix/upscaler fields are ignored. Legacy upscale `padding` maps to twice that value as tile overlap.

#### Flux Outpaint And Flux Kontext (Extra Scripts)

These two extra scripts are available in both img2img commands for Flux-based work:

- **Flux Outpaint** uses the Flux Fill model to outpaint an image. Select `extra_script: Flux Outpaint`; the script sets sensible Fill-model sampler/scheduler/CFG values.
- **Flux Kontext** uses the Flux Kontext model's context/reference behavior to expand or reframe an image from the prompt. Select `extra_script: Flux Kontext`.

Both run on the ComfyUI backend and need the installed Flux Fill/Kontext checkpoints. Not every Forge-side feature is available in those ComfyUI workflows. These are not masked inpainting: if you need exact mask boundaries, use `/wd_inpaint` or Native Outpaint on a supported model.

### Upscaling Paths: Hires, Tiled, Extras, SeedVR2, And PiD

These options solve different problems. More is not always better.

| Path | Where | What it does | Important limits |
|---|---|---|---|
| Hires Fix | `/wd_create`, `/wd_create_adv` when `upscale_multiplier` > 1 | Generates a base image, then runs a second denoising pass at a larger size | Txt2img only. More detail, but can distort anatomy or composition. `upscale_denoise_strength` and `upscale_step` control the second pass. |
| Tiled Latent Upscale | img2img extra script | Encodes the source, tiles the latent, denoises tiles, and blends them at higher resolution | SD1/SDXL only; scale 1–4; target max 8192; seam risk if overlap/tiles/denoise are poor |
| `/wd_upscale` classic upscalers | Extras | Lanczos/ESRGAN/AnimeSharp-type pixel upscaling; no prompt and no denoise | Useful for already-finished images. Learned upscalers can infer textures; they do not guarantee recovery of the original missing detail. |
| `/wd_upscale` SeedVR2 | Extras | Diffusion-based reconstruction of detail at a target shortest side | Much heavier than classic upscalers; may hallucinate detail. Ignores traditional upscalers when selected. |
| SeedVR2 setting | `/wd_setting set seedvr2_model` | Selects a SeedVR2 pass for the txt2img generation path | Target shortest side defaults to 1600; use `/wd_upscale` for an explicit pass after editing |
| PiD | Generation `upscaler`/`upscaler_mode` | Fixed 4× upscale using the installed distilled SDXL PiD checkpoint | Base side ≤1024px, divisible by 8; output ≤4096px; cannot stack with Hires/Tiled/Outpaint/Flux scripts |

Basic `/wd_create` chooses the hires denoise/step internally; use `/wd_create_adv` if you need to tune `upscale_denoise_strength` and `upscale_step`.

#### Hires Fix Versus Tiled Latent

Hires Fix is a second txt2img pass: the model samples the enlarged image again. Tiled Latent works from an existing image in img2img and tiles the latent so memory use stays manageable. If you are making a new image, start with Hires Fix. If you already have an image and want a larger refined version, use Tiled Latent or `/wd_upscale`.

#### Ordinary Extras And SeedVR2

`/wd_upscale` defaults to `upscale_multiplier:1` (no upscaling). Classic upscalers sharpen and interpolate; they do not know your prompt. `R-ESRGAN 4x+` and `R-ESRGAN 4x+ Anime6B` are common choices for anime art, and `NMKD-Siax 4x` is a common photographic choice, but test on your own image.

Current Forge Extras no longer supports GFPGAN/CodeFormer: if you set `gfpgan_visibility` or `codeformer_visibility` above zero without SeedVR2, the command tells you to leave them at zero. Use SeedVR2 or generative inpainting if you need face reconstruction.

SeedVR2 is a neural upscaler, not a classic resize. It is much more compute-intensive and can invent plausible texture. It is a good choice for a final image when quality matters more than speed. The `/wd_upscale` `seedvr2_model` option overrides the traditional upscaler/codeformer/gfpgan path; `trim_padding` crops the transparent padding added for divisibility.

The saved generation setting is selected automatically in txt2img. The img2img/reference paths retain their own extra-script selection, so use `/wd_upscale` explicitly for a dependable SeedVR2 pass after an edit. Choose one generative upscale path at a time; clear the saved SeedVR2 setting before using txt2img PiD.

Further reading: [SeedVR project](https://github.com/ByteDance-Seed/SeedVR) and the [Real-ESRGAN project](https://github.com/xinntao/Real-ESRGAN).

#### PiD

`PiD` is a fixed 4× upscaler available in the generation `upscaler`/`upscaler_mode` choices for `/wd_create`, `/wd_create_adv`, `/wd_img2img`, `/wd_img2img_adv`, `/wd_ref2img`, and `/wd_ref2img_adv`. It always uses the installed distilled SDXL PiD checkpoint at a fixed 4× scale.

The field name depends on the command: basic txt2img uses `upscaler_mode`; advanced txt2img, img2img, and reference commands use `upscaler`; `/wd_upscale` also uses `upscaler`, but its Extras list does not include PiD.

- **SDXL checkpoints** use Forge's native integrated PiD pass. Hires Fix is disabled automatically for that request because the two passes cannot run together.
- **Non-SDXL img2img and reference workflows** use a PiD postpass: generate the base image normally, then run a temporary standalone PiD img2img pass on the RGB result. The original checkpoint, preset, and companion modules are restored afterwards on success, failure, or cancellation. If restoration fails, the bot reports it because Forge's active checkpoint is global.
- **Txt2img PiD is SDXL-only.** `/wd_create` and `/wd_create_adv` reject a non-SDXL PiD request and point you to `/wd_img2img` or `/wd_ref2img`. The advanced txt2img choice label mentions "RGB postpass" because it shares the generation upscaler list, but the txt2img command still enforces the integrated-SDXL path.
- Keep each base side at 1024px or less, divisible by 8, and keep the 4× output within 4096px. PiD cannot be combined with Hires Fix, Tiled Latent Upscale, Native Outpaint, or a Flux Comfy script.
- Native `/wd_upscale` (Extras) never receives PiD; use a generation command for it.
- The option uses the distilled SDXL PiD checkpoint. The installed Flux2 PiD checkpoint is undistilled and is deliberately not sent through the hardcoded LCM/4-step PiD path.

PiD is not a magic detail generator. It is a fixed-scale upscaler with its own artifacts and output limits. Inspect the result at 100%; if the backend returns blank/NaN output, treat it as a backend compatibility issue and see [How it works](docs/ai-how-it-works.md) rather than simply retrying with a larger base size.

### Image Prompt Enhancement

The optional prompt enhancer adds compatible detail without replacing your prompt. It keeps your original prompt byte-for-byte, including LoRA tags, trigger phrases, wildcard syntax, profile tokens, and control syntax, and appends only validated new text. It never adds new control syntax or model adapters.

Configure it with `/wd_setting set`:

- `image_prompt_quality`: `Off — use my prompt directly` (default), `Standard — Gemma 12B`, or `High — Qwen 27B`.
- `image_prompt_batch`: `All — one shared enhancement per batch` (default) or `Each — separate additions per image`.
- `image_prompt_style`: `Auto — choose by model family` (default), `Tags — comma-separated tags`, or `Natural — descriptive sentences`. Auto uses tags for SD/SDXL/Anima-style generation and natural language for other families and reference editing.
- `image_prompt_layout`: `Off — plain prompt/enrichment (default)`, `Auto — MOSS JSON; Coupler for SD/SDXL`, `MOSS JSON — bbox layout for MOSS models`, or `Coupler regions — Forge Coupler for SD/SDXL`. Layout planning replaces plain enrichment for that request.

Example:

```text
/wd_setting set image_prompt_quality:High — Qwen 27B image_prompt_batch:Each — separate additions per image image_prompt_style:Natural — descriptive sentences
```

How it behaves:

- `Off` returns the prompt unchanged. No LLM call is made.
- `All` makes one shared addition and uses it for the whole batch. `Each` asks for one independent addition per image, sends the images sequentially, and advances a deterministic seed by one per image. Random seeds (`-1`) stay random. The command's total image limit still applies.
- The enhancer is instructed not to add `<lora:...>`, embeddings, wildcards, profile syntax, weighted parentheses, `BREAK`/`AND` directives, or other control tokens. The bot validates the additions and rejects forbidden syntax.
- The response must contain exactly the requested number of additions. Invalid JSON, the wrong count, an empty addition, truncation, or a failed/unsupported model unload aborts the request. The command reports that image generation was not started.
- Enhancement runs before the Forge model lease, and the intended checkpoint is frozen first. For txt2img, if another request changes the active model while the LLM is working, the bot re-syncs and restores the frozen checkpoint before generating; if that restore fails, it does not submit the image. Img2img and reference commands follow the same freeze-and-restore path, but a non-reference model that cannot be applied may produce a fallback message and continue with the active model. A reference command with an explicit checkpoint is strict and will not silently fall back.
- Layout planning uses the same serialized local-model queue as enhancement. The LLM is unloaded and verified before image generation starts. If the queue is busy, the request waits rather than evicting another consumer's model.

Further reading: the deployment profiles are `unsloth/gemma-4-12B-it-qat-GGUF` for Standard and `unsloth/Qwen3.8-27B-GGUF` for High. See the [Gemma 4 12B profile](https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF) and [Qwen3.8 27B profile](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF); exact quantization and availability are deployment details.

### Layout Drafts And Forge Coupler

#### `/wd_layout_draft`

MOSS-Image accepts a JSON layout prompt with `summary` and `items`. Each item has a `label` (`object`, `character`, or `text`), a `caption`, and a bbox. The compiled form uses `bbox_coord_space: abs_centralized` and `bbox_format: yxyx`, mirroring OpenMOSS/Forge's JSON builder conversion.

Create a reusable layout:

```text
/wd_layout_draft prompt:a minimalist travel poster with a blue mountain and the title EXPLORE width:1024 height:1024
```

`prompt` is required. `width` and `height` are clamped to 256–2048 and rounded to a multiple of 16; both default to 1024. The draft is generated by Qwen 27B and shown as a labelled preview.

The message has four buttons:

- **Adjust** — type a change request in the channel (for example "move the title to the bottom" or "make the character larger"). The LLM revises the complete layout, re-renders it, and keeps the session open.
- **Save** — name the layout with letters, numbers, hyphen, or underscore (1–32 characters). The bot stores it for your Discord user and returns a JSON file containing the draft, the compiled MOSS prompt, and a Coupler prompt.
- **Coupler prompt** — returns the Forge Coupler Advanced prompt and a `coupler-config.json` mapping. The prompt is sent as an ephemeral message; if it is too long for a code block, it is attached as `coupler-prompt.txt`.
- **Cancel** — closes the session immediately.

Session behaviour: the draft session lasts 10 minutes. Adjust waits up to 3 minutes for your change request; Save waits up to 2 minutes per naming attempt and allows two attempts. Cancelling or expiring aborts the channel waiters, ignores late answers, and removes stale controls. If a button is pressed while another action is still running, the bot tells you it is still working instead of starting a second revision. Each draft/revise call unloads the layout model inside the shared queue before returning; the session does not pin the LLM for the full 10 minutes. The final cleanup also requests a queued unload.

Use a saved layout in a prompt with `<layout:name>`:

```text
/wd_create prompt:<layout:travel_poster> warm sunset light
```

Only one layout token is supported per prompt. The saved draft is recompiled at the requested generation size, so the same layout can be reused at another aspect ratio.

- MOSS models receive the compiled JSON layout.
- SD/SDXL models receive the equivalent Forge Coupler Advanced prompt.
- Other model families are not supported for saved layouts and produce an error. Layout drafts are not a universal spatial-control mechanism.

Layout planning uses the same serialized Unsloth queue as prompt enhancement and unloads the model before image generation. A saved layout is stored per user; using the same name again updates that user's layout. Names are not globally shared.

#### Forge Coupler

Forge Coupler divides the canvas into regions with their own prompt text. It is useful when two subjects bleed into each other.

Basic mode uses `<=>` between subjects (horizontal split) and `||` for a vertical stack:

```text
2girls, august von parseval \(azur lane\), azur lane, artist: eufoniuz, serious face <=> 2girls, ceres fauna, hololive, artist: eufoniuz, happy face
```

A `[GLOBAL]` line applies to all regions. `[GLOBAL:<value>]` controls its weight (default 0.5):

```text
[GLOBAL] 2girls, artist: eufoniuz, (masterpiece:1.2), best quality <=> 2girls, august von parseval \(azur lane\), azur lane, serious face <=> 2girls, ceres fauna, hololive, happy face
```

Advanced mode assigns rectangles with `|x_start:x_end,y_start:y_end,weight|` fractions. For example, `|0:0.5,0:1,1|` is the left half:

```text
[GLOBAL] 2girls, artist: eufoniuz, best quality <=> |0:0.5,0:1,1| 2girls, august von parseval \(azur lane\), azur lane, serious face <=> |0.5:1,0:1,1| 2girls, ceres fauna, hololive, happy face
```

When Advanced mode is detected, the bot sends a region preview image. Coupler is an SD/SDXL workflow here, and layout-generated Coupler prompts are only offered for SD/SDXL; it is disabled for Flux. It cannot be combined with Native Outpaint and may round the output to a multiple of 64. Treat newer experimental families as unsupported for Coupler until verified. Coupler routes prompt text per region; it is not identity conditioning. For identity, use reference editing or an inpaint mask.

Layout-generated Coupler prompts use Advanced regions: a full-canvas summary region at weight 0.5 plus one region per layout item at weight 1. The generated config uses `mode: Advanced`, `direction: Vertical`, `global: None`, and the region list. You can paste the returned prompt into `/wd_create` on an SD/SDXL model.

### Advanced Controls

These settings are discoverable through dedicated commands. They persist per user until reset.

| Control | Setup command | Used by | Notes |
|---|---|---|---|
| ControlNet | `/wd_controlnet set` | `/wd_create_adv`, `/wd_img2img_adv`, `/wd_inpaint` | Up to three units. Advanced create/img2img use `controlnet_input` plus `_2`/`_3`; inpaint uses its `image` as the first input and exposes `controlnet_input_2`/`controlnet_input_3`. |
| ADetailer | `/wd_adetailer set` | `/wd_create_adv`, `/wd_img2img_adv`, `/wd_ref2img_adv` | Requires `do_adetailer:true`; provide the saved config or `adetailer_config`. |
| Colour balance / vectorscope | `/wd_colorbalance set` | Forge SD/SDXL generation | Latent colour/brightness/contrast bias. Not applied to Flux. |
| Latent modifier | `/wd_latentmod set` | Forge generation | Advanced latent-space modifiers. `simple` mode exposes rescale CFG only. |
| Prompt expansion (legacy) | `/wd_boorugen set` | Legacy prompt parser | Current Forge schema removed the TIPO/DanTagGen widgets; see the guardrail below. |
| Tiled upscale config | `/wd_script_upscale set` | img2img extra script | See [Tiled Latent Upscale](#tiled-latent-upscale). |
| Outpaint config | `/wd_script_outpaint set` | img2img extra script | See [Native Outpaint](#native-outpaint-sd1sdxl). |
| Personal settings | `/wd_setting set` | Generation commands | Preview, hires overrides, SeedVR2, image prompt enhancement, layout planning. |
| Profiles | `/wd_profile_add` | Generation commands | Reusable generation setups, including configs. |

#### ControlNet

ControlNet adds spatial conditioning from an input image. Up to three units can be chained; the second and third use `_2` and `_3` option suffixes.

`/wd_controlnet set` options:

- `controlnet_model` — ControlNet, T2I-Adapter, IP-Adapter, InstantID, Union, or Inpaint model.
- `controlnet_preprocessor` — feature extractor such as Canny, Depth, HED, Lineart Anime, OpenPose, Segmentation, Tile Resample, CLIP H/IPAdapter, or CLIP G/IPAdapter.
- `controlnet_weight` — how strongly the control is enforced (default 1).
- `controlnet_resolution` — preprocessor resolution (default 512).
- `controlnet_mode` — `Balanced`, `Prompt` (my prompt is more important), or `ControlNet` (ControlNet is more important).
- `controlnet_threshold_a` / `controlnet_threshold_b` — preprocessor thresholds (default 100/200).
- `do_preview_annotation` — send the extracted annotation image for debugging.

Use it by passing `controlnet_input` (and optional `_2`/`_3`) to an advanced generation command. `/wd_inpaint` uses its `image` as the first ControlNet input and accepts `controlnet_input_2`/`controlnet_input_3`. A saved config is applied automatically; `controlnet_config` can override it for one request.

Guardrails: ControlNet is applied on Forge SD/SDXL requests. It is not applied to Flux generation in this bot, and reference commands reject ControlNet attachments. For Anima inpainting, only the Anima inpaint ControlNet pair described above is accepted. Incompatible combinations fail with an error instead of silently ignoring the control image.

Further reading: [ControlNet paper](https://arxiv.org/abs/2302.05543) and the [Diffusers ControlNet guide](https://huggingface.co/docs/diffusers/en/using-diffusers/controlnet).

#### ADetailer

ADetailer detects a region (usually faces or hands) and repaints it with an img2img pass at a lower denoise.

`/wd_adetailer set` options include:

- `adetailer_model` — YOLO Face/Hand/Eyes/Breast/Head+Hair/Person/Watermark/World, GroundingDINO Tiny/Base, or Florence2 Base/Large (with or without fine-tuning).
- `object_to_detect` — object list for open-vocabulary models (YOLO World, GroundingDINO, Florence2), e.g. `person` or `eyes. hair.`.
- `adetailer_prompt` / `adetailer_neg_prompt` — prompt override for the detected region; `[SEP]` separates prompts for multiple detections. Empty reuses the main prompt.
- `adetailer_detection_threshold` — default 0.3.
- `adetailer_mask_blur` — default 4.
- `adetailer_mask_padding` — default 32.
- `adetailer_denoise_strength` — default 0.4.

Set `do_adetailer:true` in an advanced command. If the config is missing, the detail pass is not applied. ADetailer increases generation time and can over-smooth a face if the denoise is too high; use inpaint when you need exact placement.

Further reading: [ADetailer repository](https://github.com/Bing-su/adetailer).

#### Detail Daemon, FreeU, PAG, Dynamic Threshold, Mahiro, Modulation

These are prompt-tag features parsed by the bot. They are advanced and model-dependent; start with small values.

- **Detail Daemon**: `|dd: <amount>|` or `|dd: <amount>, <start>-<end>, <bias>|`. Example: `|dd: 0.2|`. It injects controlled noise during sampling to change busyness/detail. Start subtle; high amounts can create artifacts.
- **FreeU**: `|freeu: <b1>, <b2>, <s1>, <s2>|`, e.g. `|freeu: 1.05, 1.2, 0.99, 0.95|`. It manipulates VAE decoder features. Effects are model-dependent.
- **Perturbed-Attention Guidance**: `|pag: <scale>|` or `|pag: <scale>, <adaptive>|`, e.g. `|pag: 3|` or `|pag: 3, 0.5|`. It can improve prompt adherence but costs time and can over-sharpen.
- **Dynamic Threshold**: `|dt: <mimic_scale>, <mimic_percentile>|`, e.g. `|dt: 7, 0.95|`. It scales guidance down in later steps to reduce burnt-in output at high CFG.
- **Mahiro guidance**: `|mahiro|`. An alternative guidance path that emphasizes positive conditioning.
- **Modulation guidance**: `|modulation|`. Only supported for Anima models; it is disabled with a warning on other families.

Further reading: [FreeU paper](https://arxiv.org/abs/2309.11497), [PAG paper](https://arxiv.org/abs/2403.17377), and the [Detail Daemon repository](https://github.com/muerrilla/sd-webui-detail-daemon).

#### Vectorscope / Colour Balance

`/wd_colorbalance set` introduces a bias during latent denoising:

- `brightness` / `contrast` — -5 to 5, default 0.
- `saturation` — 0.25 to 1.75, default 1.
- `red` / `green` / `blue` — -4 to 4 per channel. Positive red warms; negative blue pushes toward yellow.
- `alt_mode` — interferes deeper in denoising. Stronger effect, more instability/artefacts.

It is not applied to Flux.

#### Latent Modifier

This directly manipulates the latent during generation. `simple_mode` exposes only `rescale_cfg_phi`; advanced mode exposes sharpness, tonemap, contrast, CFG drift, extra noise, divisive normalisation, spectral modification, and dyn-CFG augmentation. Most users should leave it alone. V-pred models may receive a safe simple fallback when no latent modifier is configured; do not override that blindly.

#### TeaCache / First-Block Cache

Prompt syntax:

- `(>> <value>)` or `(>> tc <value>)` — TeaCache, e.g. `(>> 0.2)`.
- `(>> fbc <value>)` — First-block Cache, e.g. `(>> fbc 0.2)`.

These skip some computation for speed, but output can become unpredictable, especially on SD models. Treat them as opt-in experiments, not free performance.

Further reading: [TeaCache paper](https://arxiv.org/abs/2411.19108).

#### Extension Compatibility Guardrails

- **Flux and ControlNet**: the bot does not apply ControlNet to Flux generation even though Flux ControlNet files may appear in the catalog. Use a supported SD/SDXL request.
- **Reference commands**: no ControlNet attachments and no extra scripts. They use the reference model's own edit path.
- **Native Outpaint / Tiled Latent**: SD1/SDXL only; they cannot be combined with PiD, Hires Fix, or each other. Native Outpaint also cannot be combined with Coupler regions.
- **Anima inpainting**: `/wd_inpaint` uses only `animaLllite_006-inpainting` + `inpaint_noobai`; other ControlNet pairs fail rather than guessing.
- **Missing checkpoint**: non-reference commands may fall back to the active model and tell you; a reference command with an explicit checkpoint fails instead of applying an incompatible edit policy.
- **Removed TIPO/DanTagGen widgets**: the current Forge schema no longer has the TIPO/DanTagGen controls. `/wd_boorugen` still accepts and stores `tipo_mode`, `tipo_tag_gen_length`, and `tipo_nl_gen_length` for backward compatibility, and the prompt parser still recognizes `[BOORU]`, `[FOOCUS]`, and `[TIPO]`, but do not rely on these to change the image on this backend. Use image prompt enrichment or a direct prompt instead.
- **GFPGAN/CodeFormer**: current Forge Extras rejects nonzero face-restoration values; use SeedVR2 or generative inpainting.

### Personal Settings And Profiles

#### Personal Generation Settings (`/wd_setting`)

These settings are held per Discord user in the running bot's memory. They last until changed, reset, or the bot restarts:

- `/wd_setting set` — configure.
- `/wd_setting check` — review the stored JSON.
- `/wd_setting reset` — clear.

Each `set` writes a new configuration bundle rather than merging just one field into the old bundle. Include the options you want to keep in the same command; omitted fields return to their defaults. Use `check` afterward if a previous choice seems to have disappeared.

Options:

- `do_preview` — show a live preview during generation. The current implementation stores `true` when you leave it unset (the command description may still say false); preview costs a little time.
- `hires_checkpoint`, `hires_sampler`, `hires_scheduler` — force a different checkpoint/sampler/scheduler for the Hires Fix pass. Family defaults fill in sampler/scheduler/CFG/shift when a different hires checkpoint is selected and you leave those fields unset.
- `hires_positive` / `hires_negative` — extra prompt text appended only during the hires pass.
- `hires_cfg` / `hires_shift` — CFG and distilled shift overrides for the hires pass.
- `seedvr2_model` — select automatic SeedVR2 in the txt2img path; `Disable` turns it off. For an explicit pass after editing, use `/wd_upscale`.
- `seedvr2_resolution` — target shortest side for SeedVR2 (default 1600).
- `image_prompt_quality` / `image_prompt_batch` / `image_prompt_style` / `image_prompt_layout` — see [Image Prompt Enhancement](#image-prompt-enhancement) and [Layout Drafts](#layout-drafts-and-forge-coupler).

Explicit command values usually override profile values, but family presets and compatibility guards can override unsupported combinations. Personal settings control their named features, such as hires overrides or prompt enhancement; they are not a universal layer over every generation parameter. Check the stored settings and profile when a result uses an unexpected value.

The extension setup commands also use per-user in-memory maps. Save supported ControlNet/ADetailer/outpaint/upscale configuration JSON in a generation profile if you need to reuse it after a restart. Profiles are stored in the database; saved layout drafts are stored separately in the bot's layout file.

#### Saving A Generation Profile (`/wd_profile`)

Profiles save a reusable generation setup:

- `/wd_profile_add name:<name>` — create or update a profile. Names may contain letters, numbers, `/`, and `_`; whitespace and other special characters are rejected. `/wd_profile_detail server_wildcard:true` can look up a server-side wildcard profile instead of a database profile.
- `/wd_profile_list` — list your profiles, or another `user`'s profiles, with pagination.
- `/wd_profile_detail name:<name>` — show full settings; optionally specify `user`.
- `/wd_profile_remove name:<name>` — delete one of your profiles.

A profile can store prompt prefixes/suffixes (`prompt_pre`, `prompt`, `neg_prompt_pre`, `neg_prompt`), width/height, sampler, scheduler, CFG, steps, seed, upscale controls, clip skip, checkpoint, and saved ADetailer/ControlNet/colour-balance/BooruGen/outpaint/upscale/latent-modifier configs.

Using `profile:<name>` searches your profiles first, then another user's profile with the same name as a fallback. The profile's checkpoint is still subject to the cache/model-switch rules.

Profiles can also be used as wildcards: `%%my_style%%` substitutes the prompt stored in that profile, with the same ownership/fallback search.

### Utilities

#### Image Simple Upscale (`/wd_upscale`)

`/wd_upscale` upscales an attachment or `image_url` with classic AI upscalers or SeedVR2. Classic upscalers avoid a prompt-driven denoising pass, but learned textures can still differ from the source. See [Upscaling paths](#upscaling-paths-hires-tiled-extras-seedvr2-and-pid).

- `upscale_multiplier` defaults to 1 (no upscaling).
- `upscaler` / `upscaler_2` / `upscaler_2_visibility` combine two classic upscalers.
- `seedvr2_model` switches to SeedVR2 and ignores traditional upscalers/face restoration when set.
- `trim_padding` crops transparent padding added for divisibility.
- `private_mode` makes the reply ephemeral.
- GFPGAN/CodeFormer options exist for compatibility, but current Forge rejects nonzero values; leave them at 0.

#### Background Removal (`/wd_rembg`)

`/wd_rembg` removes the background and can add an edge, shadow, background colour, or colour adjustments.

- `birefnet-general` is a good default; `birefnet-massive` can remove too much of the subject.
- `isnet-general-use` and `isnet-anime` are alternatives.
- `edge_width` > 0 adds an outline; `edge_color` sets its colour.
- `alpha_mat` and its foreground/background values refine semi-transparent edges.
- `shadow_opacity`/`shadow_blur` add a shadow; `brightness`/`contrast`/`saturation` adjust colour.

#### Describe An Image (`/wd_interrogate`)

`/wd_interrogate` uses Florence 2-family models; CLIP and DeepBooru have been removed.

- `engine: Florence 2` (default) — natural-language captioning.
- `engine: Florence 2 Finetuned` — the fine-tuned caption model.
- `engine: Florence 2 PromptGen` — prompt/tag-oriented output; the command switches to PromptGen automatically for `prompt_gen_*` tasks.
- `florence_task` — `Caption`, `Caption (Detailed)`, `Caption (Extra Detailed)`, `Caption (Booru Tags)`, `Caption (Mixed)`, `Caption (Analyze)`, `Region Caption`, `Region Caption (Detailed)`, `OCR (Region Highlight)`, `Find Object`, `Find Object Segment`, or `Document Visual Question Answering`.
- `florence_prompt` — used by Find Object, Find Object Segment, and DocVQA.

#### Find Image Source And Generation Info

The message context menu has **Find sauce** (SauceNAO, best-effort) and **SD Image Info** (reads generation metadata when present). `/wd_imginfo` does the same for an attached image. Uploaders and social platforms can strip metadata; no tool can recover information that is no longer in the file. SD WebUI metadata is usually easier to parse than ComfyUI workflows, but support depends on the file.

### Video And 3D

These commands are implemented, but they depend on separate media services and models. If the service is not registered or online, the command can still be present but fail; that is an availability issue, not a syntax issue.

- `/wd_txt2vid` — text-to-video with MiniMax H3; options include `prompt`, optional `ref`, `preset`, `custom_width`, `custom_height`, `custom_length`, `portrait`, `seed`, `steps`, `do_upscale`, `no_optimize`, and `prompt_quality`.
- `/wd_img2vid` — animate an opening image; options include `image`, `prompt`, optional `last_image`, optional `ref`, `preset`, `length`, `seed`, `steps`, `do_upscale`, `no_optimize`, and `prompt_quality`.
- `/wd_ref2vid` — reference-driven video with `ref`, `prompt`, `preset`, `length`, `portrait`, `seed`, `steps`, `do_upscale`, and `prompt_quality`.
- `/wd_vid_upscale` — video post-processing with `video`, optional `color_correction` and `ref_image`, `upscaler`, `frame_interpolation`, and `fps_multiplier`.
- `/wd_img2model` — CelForge 3D conversion with `image`, optional `recipe`, `seed`, and `download_glb`; returns an orbit MP4 and optionally the GLB. It does **not** attach the shared Cancel button.

See [Media commands](docs/media-commands.md) for the current workflow details, limits, and service requirements.

### Model Knowledge Base And Resources

These lists are starting points for understanding what a model may recognize. They are not current quality rankings and they do not guarantee a character will appear.

**NoobAI / Illustrious lineage**: the training data includes Danbooru and other sources; knowledge cut-offs and character coverage depend on the specific fine-tune. Community character spreadsheets and model cards are more reliable than guessing tags.

**AnimagineXL lineage**: v4 uses a newer Danbooru-based dataset; older v3/v3.1 used a smaller/pruned set. Character lists:

- [AnimagineXL v3 character list](https://huggingface.co/spaces/cagliostrolab/animagine-xl-3.1/raw/main/wildcard/characterfull.txt)
- [AnimagineXL v3.1 additions](https://huggingface.co/spaces/cagliostrolab/animagine-xl-3.1/raw/main/wildcard/character31.txt)

**PonyDiffusionXL lineage**: a distinct prompt/LoRA ecosystem; do not assume an ordinary SDXL LoRA will behave the same. Pony-specific character knowledge is community-maintained; check the model card and the [Pony character page](https://ponychar.com/) if you use that lineage.

**SDXL / Flux recognition**: models may recognize prominent characters, artists, or real people from pretraining data, but this is unreliable and can change with fine-tunes. Use explicit descriptions or LoRAs when identity matters.

#### Textual Embedding Resource List

Textual embeddings are small prompt modifiers. Do not stack many at once; they can conflict and degrade output.

Embedding | Put it in the negative prompt? | Compatible family
---------|--------------------------------|------------------
smooth_qual | no | SDXL
smooth_neg | yes | SDXL
aisistxl_v2 | yes | SDXL
xl_negative_v2 | yes | SDXL
neg_hands_pony | yes | Pony
neg_hands_xl | yes | SDXL
unaestheticXLv31 | yes | SDXL
unaestheticXL_Alb2 | yes | SDXL
verybadimagenegative_v1.3 | yes | SDXL
bad_artist_neg | yes | SDXL
aidxlv05_neg | yes | SDXL
charturnerv2 | no | SD1.x
badhandv4 | yes | SD1.x
bad_prompt_version2 | yes | SD1.x
easynegative | yes | SD1.x

#### LoRA And Wildcard Resources

The large external lists live outside this repository:

- [LoRA Resource List](https://rentry.co/elainaresource)
- [Wildcard Resource List](https://rentry.co/elainaresourcewildcard)

These are community resources, not endorsements. Check the base model, trigger words, and license before using a LoRA. LoRA compatibility is not universal: a Pony LoRA, an SDXL LoRA, and a Flux LoRA are different targets even if the file extension is the same.

Besides prebuilt wildcards, you can use a saved generation profile as a wildcard with `%%profile_name%%`. If you do not own a profile with that name, the bot falls back to another user's profile with the same name.

### Troubleshooting

| Symptom | Likely cause | What to try |
|---|---|---|
| The image ignores my requested change | Denoise too low, prompt too vague, or the model is not following the edit | Raise img2img denoise gradually; describe the change more specifically; use reference edit or inpaint for the relevant region |
| The whole image changed when I only wanted a small edit | Whole-image img2img or high denoise | Use `/wd_inpaint` with a mask, or lower `denoising_strength` |
| Two characters share hair/clothes/features | Prompt bleeding across regions | Use Forge Coupler regions or `/wd_layout_draft`; keep each region's prompt specific |
| Hands/faces are damaged | Small generation area, model limitation, or high-denoise second pass | Use ADetailer with a face/hand detector, or inpaint the region; avoid over-sharpening |
| Output is blurry or distorted at the edges | Resolution outside the model's trained area or extreme aspect ratio | Move toward a trained bucket; generate smaller and upscale; avoid huge canvases |
| The model did not change | Checkpoint not cached/load failed, or the command fell back to the active model | Check the bot's cache/fallback message; use `/wd_modelchange`; retry when the backend is idle |
| `reference_layout: Native` does not look like my images | Native references use separate conditioning, not a collage; the model may reinterpret them | Try `Horizontal`, `Vertical`, or `Grid` for a literal collage; make the prompt describe the desired result; choose a reference-capable model |
| Reference edit fails on Anima/MOSS/Krea | Required edit LoRA is not visible or the model is not reference-capable | Check the bot's error; confirm the LoRA/model is installed; use a listed reference model |
| Flux Dev was replaced by Flux Kontext | Flux Dev has no reference conditioning | Expected; the bot tells you. Use Kontext or a different reference model |
| Tiled upscale has visible seams | Tile overlap too small, tiles too small, scale/denoise too aggressive | Increase `tile_overlap`, enlarge tiles, reduce `upscale_multiplier` or denoise |
| Native Outpaint changed a face at the edge | The overlap strip intentionally repaints inside the expanded edge | Reduce `overlap`, add more padding, or compose the subject farther from the border |
| PiD output is blank or the wrong size | Backend/PiD compatibility issue or base size limits | Keep base side ≤1024 and divisible by 8; don't stack Hires/Tiled/Outpaint/Flux scripts; check [How it works](docs/ai-how-it-works.md) |
| `GFPGAN`/`CodeFormer` options do nothing | Current Forge Extras removed them | Leave them at 0; use SeedVR2 or inpaint |
| Prompt enhancement failed and no image was made | LLM error, invalid additions, truncation, or unconfirmed unload | Read the error; shorten the prompt or use `All`; retry when the LLM service is free. The bot intentionally does not submit a partial result |
| Layout session expired | The draft session lasts 10 minutes | Re-run `/wd_layout_draft`; controls from the old session are stale |
| Saved layout not found | Wrong user scope or name | Save it with the same user, check the name, and use `<layout:name>` exactly |
| TIPO/BooruGen controls seem ineffective | Current Forge schema removed TIPO/DanTagGen widgets | Use image prompt enhancement or write the prompt directly; treat `[TIPO]`/`[BOORU]`/`[FOOCUS]` as legacy |
| Cancel failed or did not stop the job | Backend refused/could not confirm, or the request was already finished | Check the progress message; a stale button cannot cancel a later job. Try again on the current request if the button is still present |
| Video/3D command fails | Media service, model, or CelForge not enabled | See [Media commands](docs/media-commands.md) and check whether the service is registered/online |

### Further Reading

| Topic | Link | Why read it |
|---|---|---|
| Latent diffusion / Stable Diffusion | [Rombach et al., 2022](https://arxiv.org/abs/2112.10752) | The original latent-diffusion design behind checkpoint/VAE/latent vocabulary |
| SDXL | [Podell et al., 2023](https://arxiv.org/abs/2307.01952) | SDXL architecture and training choices |
| LoRA | [Hu et al., 2021](https://arxiv.org/abs/2106.09685) | What a LoRA actually adapts |
| ControlNet | [Zhang et al., 2023](https://arxiv.org/abs/2302.05543) | Spatial conditioning and how it differs from style/subject adaptation |
| IP-Adapter | [Ye et al., 2023](https://arxiv.org/abs/2308.06721) | Image-prompt adapters for compatible ControlNet units; separate from native ref2img conditioning |
| FreeU | [Si et al., 2023](https://arxiv.org/abs/2309.11497) | The decoder-feature trick behind the FreeU prompt tag |
| Perturbed-Attention Guidance | [Ahn et al., 2024](https://arxiv.org/abs/2403.17377) | The guidance method behind the PAG prompt tag |
| TeaCache | [Liu et al., 2024](https://arxiv.org/abs/2411.19108) | Caching/skipping trade-offs |
| SeedVR | [ByteDance-Seed/SeedVR](https://github.com/ByteDance-Seed/SeedVR) | Neural video/image upscaling background for SeedVR2 |
| Florence 2 | [Florence-2 model card](https://huggingface.co/microsoft/Florence-2-large) | Captioning, OCR, region, and grounding tasks used by `/wd_interrogate` |
| Forge Neo | [Forge Classic/Neo project](https://github.com/Haoming02/sd-webui-forge-classic) | The maintained Forge fork used by this integration, including its native extensions |
| ComfyUI | [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Backend for the ComfyUI image/video workflows |
| Model cards | [Animagine XL 4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0), [Qwen Image 2.1](https://huggingface.co/Qwen/Qwen-Image-2.1), [MOSS Image Base](https://huggingface.co/OpenMOSS-Team/MOSS-Image-Base), [Flux Kontext](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev) | Prompt style, recommended settings, and architecture-specific limits |

### Unrelated FAQ

- **Why `/wd_...`?** The first generation commands used a WaifuDiffusion model; the name stuck even after the backend and model family changed.
- **Is there a fee?** No. There are cooldowns to keep the shared backend usable.
- **Can the bot do anything besides generating images?** Yes. See [Non-WD Commands](non-wd-commands.md) for chat, quizzes, osu!/osu!droid/Malody, Spotify genre lookups, and more.
- **Are the video commands broken?** They are implemented with MiniMax H3 workflows, but they require the media service and models to be available. See [Media commands](docs/media-commands.md). A missing/failed service is not the same as a missing command.
- **Where can I see what the bot is doing?** `/ping` checks the AI server connection and `/server_stat` shows resource stats. The bot owner can use `/chat_config mode:Status` for current local chat configuration. `/ratestatus` reports legacy online-mode counters, not local model/GPU admission.

### Maintainer Notes

The user-facing behaviour above is implemented across the command and utility modules. For architecture, service routing, schema assumptions, and deployment limits, read [How it works](docs/ai-how-it-works.md) instead of relying on operational notes in this page. Catalog definitions live in [utils/ai_server_config.js](utils/ai_server_config.js); family defaults live in [utils/model_defaults.js](utils/model_defaults.js). Reference policy and edit LoRAs are in [utils/forge_reference.js](utils/forge_reference.js); PiD limits are in [utils/forge_pid.js](utils/forge_pid.js).
