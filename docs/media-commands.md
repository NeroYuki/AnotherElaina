# AI media commands: video, upscaling, and 3D

This guide covers the ComfyUI and CelForge commands in the `/wd_...` family:

- `/wd_txt2vid`, `/wd_img2vid`, and `/wd_ref2vid` generate video with native
  synchronized audio.
- `/wd_vid_upscale` post-processes an existing video: color matching, model
  upscaling, and/or RIFE frame interpolation.
- `/wd_img2model` reconstructs a 3D asset from one image and returns an orbit
  video, optionally with the GLB.

The command code and ComfyUI graph builders are in this repository. Actual
availability depends on the installed ComfyUI models/custom nodes, FFmpeg,
Chromium/Playwright, CelForge recipes, and the GPU orchestrator. A command
appearing in Discord does not prove every backend model is installed.

- [AI chat guide](ai-chat.md) — chat, scenes, memory, and lore.
- [AI image guide](../document.md) — the still-image `/wd_...` family.
- [Non-WD commands](../non-wd-commands.md) — the rest of the bot.
- [How the AI features work](ai-how-it-works.md) — a high-level tour of the
  engine types, prompt enhancement, video timing, retrieval, and cancellation.
- [H3 workflow README](../resources/workflows/h3/README.md) — importable graph
  exports.
- [H3 benchmark](h3-benchmark.md) — dated local measurements and limitations.

## At a glance

| Command | Use it for | Required input | Output |
| --- | --- | --- | --- |
| `/wd_txt2vid` | A scene generated from text, optionally guided by a reference. | `prompt` | MP4 video at 24 fps with generated synchronized audio. |
| `/wd_img2vid` | Animating an opening image, optionally toward an ending image and/or a reference. | `image` opening frame, `prompt` | MP4 video with native audio. |
| `/wd_ref2vid` | A scene driven by a required image, video, or audio reference. | `ref`, `prompt` | MP4 video using the dedicated Ref2VA model. |
| `/wd_vid_upscale` | Improving or converting an existing video. | `video` | MP4 with optional color match, upscaling, and/or frame interpolation; source audio preserved. |
| `/wd_img2model` | A 3D asset and a quick orbit preview from one character image. | `image` | Five-second 512×512 orbit MP4; optional GLB follow-up. |

Prompt quality, frame anchors, and references do different jobs. Do not use
"reference" and "opening/ending frame" interchangeably; see
[Anchors, references, and audio](#anchors-references-and-audio).

## Everyday use

### Text to video

```text
/wd_txt2vid prompt:A courier runs through a rain-soaked market, dodging crates while a bell rings overhead. preset:Standard custom_length:8 prompt_quality:standard
```

Common options:

| Option | Values / default | Notes |
| --- | --- | --- |
| `prompt` | required | Describe the scene, motion, dialogue, and sound. |
| `ref` | optional attachment | Image, video, or audio reference. This switches to the hybrid H3 model; it is not an opening frame. |
| `preset` | `Fast` (768×448, 5 s), `Standard`/`sd` (1024×768, 5 s), `Long` (1024×768, 10 s), `Custom`; default Standard | `Custom` uses the custom width/height; duration overrides are covered below. |
| `custom_width`, `custom_height` | 32–1344, snapped to 32 px; defaults 1024/768 | Total pixels are capped at 1344×768. |
| `custom_length` | 1–60 seconds | Overrides the preset duration; over 15 seconds uses the H3 Extender. |
| `portrait` | boolean | Swaps width and height. |
| `seed` | non-negative integer | Omit for random; `0` is valid. |
| `steps` | 1–50 | Defaults to 8 with Turbo; 20 with a reference or `no_optimize`. |
| `do_upscale` | boolean, default true | Applies 2× RTX video super resolution before encoding. |
| `no_optimize` | boolean | Uses base FL2VA sampling instead of the Turbo LoRA. References always use base sampling. |
| `prompt_quality` | `standard` (default), `high`, `off` | Controls the local prompt-rewriting model; see [Prompt enrichment](#prompt-enrichment). |

### Image to video

```text
/wd_img2vid image:[attach opening.png] last_image:[attach ending.png] prompt:The character turns from the window and walks toward the door as rain intensifies. preset:High length:12 prompt_quality:standard
```

Common options:

| Option | Values / default | Notes |
| --- | --- | --- |
| `image` | required attachment | The opening frame. Common image input is decoded and normalized. |
| `prompt` | required | Describe motion, dialogue, and sound between the anchors. |
| `last_image` | optional attachment | Anchors the ending frame. |
| `ref` | optional attachment | Additional image/video/audio reference using the hybrid model. |
| `preset` | `Fast` (0.4 MP), `Standard`/`std` (0.8 MP), `High` (1.0 MP); default Standard | Preserves the image's aspect ratio while fitting the target megapixel budget. |
| `length` | 1–60 seconds, default 5 | Over 15 seconds uses the H3 Extender. |
| `seed`, `steps`, `do_upscale`, `no_optimize`, `prompt_quality` | same as text-to-video | `steps` defaults to 8 without a reference; references use 20. |

The opening image is connected to H3's first-frame input. `last_image` is
optional; when present, it anchors the end of the full video. With a reference
plus frame guides, the bot uses `MiniMaxH3AddGuide` so the guide images do not
consume the reference's `<Picture 1>` identifier.

### Reference to video

```text
/wd_ref2vid ref:[attach reference.mp4] prompt:Use the same character and outfit, walking through a sunlit corridor. The reference soundtrack should continue naturally. preset:Wide length:8 prompt_quality:high
```

Common options:

| Option | Values / default | Notes |
| --- | --- | --- |
| `ref` | required | Image, video, or audio reference. |
| `prompt` | required | Describe the scene and how the reference should be used. |
| `preset` | `Fast` (768×448), `Standard`/`sd` (1024×768), `Wide` (1344×768); default Standard | |
| `length` | 1–60 seconds, default 5 | Over 15 seconds uses the H3 Extender. |
| `portrait` | boolean | Swaps width and height. |
| `seed` | non-negative integer | Omit for random. |
| `steps` | 1–50, default 20 | The installed Turbo LoRAs were trained for FL2VA, not Ref2VA, so reference requests use base sampling. |
| `do_upscale` | boolean, default true | 2× RTX video super resolution. |
| `prompt_quality` | `standard`, `high`, `off` | Local prompt enrichment. |

`/wd_ref2vid` uses the dedicated Ref2VA INT8 ConvRot model. Optional `ref`
attachments on `/wd_txt2vid` and `/wd_img2vid` instead use the installed hybrid
B25–49 INT8 model. Both use native `MiniMaxH3ReferenceToVideo` with
`ref_image_size:match` to bound reference tokens.

### Video post-processing

```text
/wd_vid_upscale video:[attach clip.mp4] color_correction:hm-mvgd-hm ref_image:[attach color-reference.png] upscaler:2x-AnimeSharpV4_RCAN.safetensors frame_interpolation:rife49.pth fps_multiplier:2
```

Common options:

| Option | Values / default | Notes |
| --- | --- | --- |
| `video` | required attachment | Source video. |
| `color_correction` | `None` (default), `mkl`, `hm`, `reinhard`, `mvgd`, `hm-mvgd-hm`, `hm-mkl-hm` | Matches the source's colors to `ref_image`; it does not change content. |
| `color_correction_strength` | 0–10, default 1 | |
| `ref_image` | attachment | Required when color correction is not `None`. |
| `upscaler` | `None`, AnimeSharp v3/v4 2×, AnimeSharp 4×, NMKD Siax 4×, UltraSharp 4×, ESRGAN 4× | Installed model filenames are used without an obsolete `forge\` prefix. |
| `frame_interpolation` | `None`, `RIFE47`, `RIFE49` | Adds interpolated frames. |
| `fps_multiplier` | whole number 1–10, default 2 | `1` disables interpolation. |

At least one of color correction, upscaling, or interpolation must be selected.
The workflow preserves the source audio and rewrites the frame-rate expression
for the new frame count. RIFE changes frame rate and smoothness while keeping
the intended duration; it does not invent true detail. A model upscaler can
sharpen or restyle edges; it is not a guarantee of restored information.

### Image to 3D model

```text
/wd_img2model image:[attach character.png] recipe:trellis_1024_cascade seed:12345 download_glb:true
```

Common options:

| Option | Values / default | Notes |
| --- | --- | --- |
| `image` | required | PNG, JPEG, or WebP character image. Orientation is normalized; alpha is preserved. |
| `recipe` | `trellis_1024_cascade` (default), `trellis_512`, `pixal_single_1024`, `pixal_single_1536` | CelForge validates the recipe name against its supported set. |
| `seed` | 0–4294967295 | Omit for random. |
| `download_glb` | boolean, default false | Adds the GLB as a follow-up file. The orbit video remains the primary reply. |

TRELLIS 1024 cascade is the default recipe; TRELLIS 512 is the faster option.
The bot uploads the image to CelForge, creates a durable case and run, polls
until completion, downloads the exported GLB, then renders a five-second,
512×512 orbit MP4 at 24 fps (120 frames) in headless Chromium and FFmpeg. The
GLB is optional because the orbit is the quick, Discord-friendly preview.

CelForge owns foreground preprocessing. The bot normalizes orientation and
preserves alpha, but there is no `remove_background` option in the command. A
clean, centered subject with a simple background usually gives the
reconstruction less to guess, but preprocessing quality is still a backend
concern.

A single-image reconstruction cannot know what it cannot see. The back, hidden
surfaces, true scale, internal structure, material response, and exact
proportions are inferred. Treat the GLB as a visual asset or starting point, not
a metrically accurate scan, engineering model, or CAD guarantee. Thin
structures, text, transparent materials, and complex accessories are especially
likely to be approximate.

## Anchors, references, and audio

### Opening and ending frames are anchors

For `/wd_img2vid`:

- `image` is the **opening frame** at 0.00 seconds.
- `last_image`, when supplied, is the **ending frame** near the end of the
  requested video.
- With a short native graph, the anchor images are attached directly as H3
  first/last frame conditioning.
- With a reference present, the anchors are added as H3 guides so they remain
  separate from the reference tokenizer.
- With a video longer than 15 seconds, the opening frame anchors the first clip
  and the ending frame anchors the final clip. The full output still targets the
  requested duration.

### References are not anchors

A `ref` attachment supplies appearance, style, motion, or sound. It is not a
frame that the output must match at a particular timestamp. The prompt rewriter
receives different context for each kind:

- **Image reference:** one preview, labelled `<Picture 1>`, not a frame anchor.
- **Video reference:** three chronological previews (start, middle, near end),
  labelled as reference samples, not target timing. A soundtrack, when present,
  is connected as `<Audio 1>`.
- **Audio reference:** metadata and duration only. The rewriter cannot hear it,
  so it must rely on the user's description and must not invent lyrics, voices,
  or music characteristics.

A silent video reference has no soundtrack connection. A video reference is
normalized to 24 fps and the output canvas, capped at the first 15 seconds or
the output duration (whichever is shorter), and must contain at least five
frames. Undecodable references fail before GPU submission. References are
limited to 200 MiB.

On `/wd_txt2vid` and `/wd_img2vid`, the optional `ref` switches to the hybrid
model. `/wd_ref2vid` requires a reference and uses the dedicated Ref2VA model.
Frame guides remain separate from the reference's native `<Picture N>`,
`<Video N>`, and `<Audio N>` identifiers.

### Generated audio versus reference audio

H3 generates a synchronized audio track as part of the video. The audio is
decoded through the audio VAE and muxed into the MP4.

Reference audio is different: the audio file (or a video's soundtrack) is
passed to H3 as reference conditioning, but the **prompt-rewriting LLM cannot
hear it**. The rewriter receives only metadata and the user's description, so it
is instructed not to guess words, voice traits, or music. The generated audio
can use the reference, but the text prompt cannot describe unheard details as
if they were observed.

## Prompt enrichment

The three video-generating commands accept `prompt_quality`:

- `standard` — default. Uses the fixed local Gemma 12B profile
  (`UD-Q4_K_XL`) on the configured standard GPU.
- `high` — uses the fixed local Qwen 27B profile (`UD-Q4_K_M`) on the configured
  high-resource GPU.
- `off` — submits the supplied prompt directly. No rewriter model or
  `X-AI-Instance` orchestrator routing is required for enrichment.

These are the same fixed local profiles used by chat, but choosing `high` here
does not change the chat model or a global service pin. Actual model availability
and placement are orchestrator concerns.

The rewriter follows the
[MiniMax audiovisual prompt guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md).
It receives the requested duration and the effective duration after H3 frame
alignment, and returns validated visual/action, soundscape, and music sections.
For image-to-video it also receives compressed previews of the opening and
optional ending image. References add an image preview, three chronological
video previews, or audio metadata with the correct native reference tags.

The rewriter cannot hear reference audio. It retains the user's description
instead of guessing words, voice characteristics, or music. Reference previews
remain separate from frame anchors. Alignment instructions use the effective
duration; cut times must increase within the timeline. Supplied dialogue and
visible text are instructed to remain verbatim.

Video rewrites serialize through their model unload. The bot awaits a targeted
Unsloth unload with `force_cancel_active:false` and verifies the model is no
longer loaded before submitting H3. Rewrite errors still attempt cleanup. A
busy, failed, or unconfirmed unload stops the command before video inference;
other consumers' work is never forcibly cancelled. The desktop template's LM
Studio load/rewrite/unload and text-preview nodes are removed from the graph.

Long videos use one LLM request that returns a validated script per clip, then
verify the LLM unload before rendering. With enrichment off, the supplied prompt
is reused for each clip.

## Duration, resolution, and the frame grid

H3 runs at 24 fps, including its audio timeline.

- Durations are 1–60 seconds.
- Dimensions are aligned to 32 pixels and limited to 1344×768 total pixels.
- The requested duration is rounded up to H3's `17k+5` frame grid. A requested
  five seconds produces 124 frames (about 5.17 seconds), for example.
- `seed:0` is valid.
- Legacy model, negative-prompt, CFG, shift, and FPS controls are not exposed by
  these commands because the current H3 workflow does not use them.

Requests above 15 seconds use the installed
[MiniMax H3 Extender](https://github.com/tritant/ComfyUI_MiniMax_H3_Extender)
motion-context, disk-join, and final-decode nodes. Each sampler handles at most
124 frames; subsequent clips carry 22 frames of video/audio context, trimmed
once when joining. The complete output stays on the same `17k+5` frame grid.

Long-video tradeoffs:

- Opening and ending images anchor only the beginning and end of the full video.
- References retain their model selection and native identifiers.
- Long standalone audio is preserved up to the output duration and sliced along
  the clip timeline; short sound references can be reused. Exhausted timeline
  audio is omitted from later clips.
- Reference videos remain capped at 15 seconds and are reused as references,
  rather than treated as a full-length source performance.
- Continuity across clips is not guaranteed. Appearance drift, motion
  discontinuities, and subject framing changes can appear. The dated benchmark
  sample documents drift rather than promising perfect consistency.

Long videos can take several minutes, especially with references and base
sampling. See the historical timings in [h3-benchmark.md](h3-benchmark.md); they
are execution measurements, not a speed promise.

## Upscaling and post-processing choices

There are three different things that can be called "upscaling":

| Control | What it changes | Where it runs |
| --- | --- | --- |
| `do_upscale` on a generation command | Applies 2× RTX video super resolution to generated frames before encoding. For extended videos, a streaming node processes one assembled frame at a time, then copies the assembled audio. | ComfyUI / RTX node |
| `upscaler` on `/wd_vid_upscale` | Runs an installed AnimeSharp, UltraSharp, ESRGAN, or NMKD model over the existing video. | ComfyUI post-processing graph |
| `frame_interpolation` + `fps_multiplier` on `/wd_vid_upscale` | RIFE inserts intermediate frames, raising the frame rate without changing the intended duration. | ComfyUI post-processing graph |

`color_correction` is separate again: it matches colors to a reference image,
but it does not copy the reference's content. Color matching, upscaling, and
interpolation can be combined, but each adds processing time. At least one must
be selected.

The post-processing command retains the old VHS → color matching → model upscale
→ RIFE → VHS encode chain, pruning unused stages. It preserves source audio and
applies required compatibility repairs to each submitted graph:

- Use installed upscaler filenames without the obsolete `forge\` prefix.
- Set RIFE's `ckpt_name`, integer `multiplier`, and required defaults `dtype`,
  `torch_compile`, and `batch_size`.
- Replace missing `DF_Multiply`/`JWIntegerToFloat` nodes with the installed core
  `ComfyMathExpression`, using the loaded video's FPS.
- Set the VHS load format to `None` to avoid automatic AnimateDiff resampling.
- Preserve uploaded subfolders and native SaveVideo/VHS output metadata.

## Limits and operational behavior

- Reference attachments are limited to 200 MiB. CelForge accepts source images
  up to 20 MiB after the bot downloads and normalizes them.
- Video references need at least five frames; undecodable inputs fail before
  GPU submission.
- The bot requires FFmpeg and FFprobe on PATH (or `FFMPEG_PATH` /
  `FFPROBE_PATH`). CelForge orbit rendering also needs a Chromium/Chrome
  installation or `CELFORGE_CHROME_PATH`.
- Files within Discord's attachment limit are attached directly. Larger outputs
  are uploaded to Catbox and returned as links. The new media path uses Catbox's
  file API because the old shared helper now targets an image-only host. Catbox
  is an external public host; a returned link is not a private attachment.
  Outputs over Catbox's 200 MiB limit fail without a hosted link.
- Long generations can outlive Discord's interaction token. Progress edits stay
  quiet after expiry, while the final result and optional GLB follow-up fall
  back to a channel message when the interaction is no longer usable.
- ComfyUI submissions go through `AI_PROXY_URL` with orchestrator workload
  headers. HTTP history polling supplements WebSocket progress, so cached or
  missed events can still complete the command. The restored commands do not
  send global ComfyUI model-unload requests; ComfyUI VRAM cleanup remains owned
  by the orchestrator.
- CelForge uses its separate case/run API and queue. It is not a ComfyUI graph
  and is not a configured AI proxy service. Its run can remain available in
  CelForge after the Discord interaction expires or after the client's bounded
  poll timeout.

### Cancellation

The ComfyUI-backed media commands in this guide (`/wd_txt2vid`, `/wd_img2vid`,
`/wd_ref2vid`, and `/wd_vid_upscale`) share the job lifecycle in
`utils/comfy_image_job.js`. The same shared path also serves the ComfyUI image
commands outside this guide.

- A **Cancel** button appears on the progress reply before the ComfyUI prompt is
  submitted. Input download, normalization, and upload to ComfyUI can happen
  before the button appears.
- Only the person who started the request can use it; this is a
  requester-filtered Discord control, not a general moderator control.
- The bot requests cancellation of that exact submitted job using its instance
  affinity, then waits for terminal confirmation. It does not cancel whatever
  else happens to be running on the backend.
- A stale button from a completed request cannot cancel a later request.
- If cancellation cannot be confirmed, the bot reports a failure rather than
  claiming the job stopped. A job that finishes first wins.

`/wd_img2model` does **not** currently expose that Cancel capability. It uses
the CelForge client and `mediaReply`; there is no Cancel button or targeted
CelForge cancellation call in the command source. Treat the CelForge run as
durable: the Discord reply may be abandoned while CelForge continues.

## Maintainer notes

The rest of this page is for operators and maintainers. Everyday Discord users
do not need these details.

### H3 graph and model details

`/wd_txt2vid` and `/wd_img2vid` use the installed INT8 FL2VA model with an
8-step Turbo LoRA, Euler/simple sampling, native Kitchen INT8 attention, tiled
video VAE decoding, synchronized audio, and optional 2× RTX video super
resolution. Near 768p (short edge at least 704 pixels), the 768p adapter uses
video/audio shifts 6/3; smaller canvases use the other installed adapter and
12/3 shifts. Both use LoRA strength 1.0. No cache or sparse approximation is
stacked onto the distilled sampling path.

Image-to-video connects the opening frame to
`MiniMaxH3ImageToVideo.first_frame`; `last_image` optionally anchors the ending.
Both commands accept an optional `ref` attachment: image, video, or audio.
`/wd_ref2vid` requires `ref` and `prompt` and uses the installed dedicated
Ref2VA INT8 ConvRot model. Optional references on text/image commands use the
installed B25–49 INT8 hybrid model. Both use native
`MiniMaxH3ReferenceToVideo`, with `ref_image_size:match` to bound reference
tokens. Ref2VA defaults to 20 base steps: the installed Turbo LoRAs were trained
for FL2VA, not Ref2VA. With image-to-video, `MiniMaxH3AddGuide` attaches opening
and ending frames to the reference conditioning without consuming the
reference's `<Picture 1>` ID.

References are limited to 200 MiB. Images are decoded/rotated to PNG. FFmpeg
normalizes video to 24 fps and the output canvas, preserving its soundtrack;
audio becomes 32 kHz stereo WAV. Video references use their first 15 seconds or
the output duration, whichever is shorter; native H3 also trims reference video
to its `17k+5` frame grid. A silent video has no soundtrack connection. Video
references require at least five frames; undecodable inputs fail before GPU
submission.

Importable desktop workflows are in
[resources/workflows/h3](../resources/workflows/h3/README.md); they are exported
from the same builder as the commands with
`node scripts/export_h3_workflows.cjs`. They contain no LLM calls and default to
native output without RTX upscaling.

### Prompt-rewriter internals

Each rewriter script returns exactly three validated string fields:
`integrated_multimodal_description`, `overall_soundscape`, and
`non_diegetic_music`. Validation requires a `[Shot 1]` opening, sequential shot
numbers, increasing cut times inside the effective duration, and nonempty
sections. Long prompts return one script per clip.

The installed prompt-quality profiles are Gemma 12B (`UD-Q4_K_XL`, standard GPU
placement) and Qwen 27B (`UD-Q4_K_M`, high-resource placement). `off` bypasses
the rewriter and its unload check entirely.

### H3 Extender installation

The extender is installed persistently at
`G:/ComfyUI_windows_portable/ComfyUI/custom_nodes/ComfyUI_MiniMax_H3_Extender`,
version 3.0.12, reviewed commit `60efaf15c589d6671ef43e7c0946913a54221865`.
Its source is unmodified. The streaming node lives beside it in
`custom_nodes/anotherelaina_h3` in that ComfyUI installation. Both survive
ComfyUI restarts. The original adapter copy and one-off installer are retained
in the local working-copy archive, rather than maintained in the bot repository.

Maintain the installed adapter in ComfyUI's checkout and restart only an idle
server after changes. The extender's optional latent-refine/upscaler feature is
disabled in these workflows.

### Attention backend

Kitchen INT8 and Sage are alternative attention implementations for one
attention call. Kitchen's quantized weight/fused operations can coexist with
Sage attention, but these H3 graphs explicitly select Kitchen INT8 attention.
The server's startup message about its global PyTorch default does not override
the graph's per-model `ModelAttentionBackend` selection. Benchmark procedure and
measured results are in [h3-benchmark.md](h3-benchmark.md).

### Setup

ComfyUI routing, CelForge access, prompt-enrichment routing, and browser/FFmpeg
dependencies are configured here.

Run `npm install` in AnotherElaina. Set these optional environment values in
the bot's `.env`:

```dotenv
# The existing CelForge API binds to loopback on the same machine.
CELFORGE_URL=http://127.0.0.1:8333
# Defaults to ffmpeg/ffprobe on PATH. FFmpeg must include libx264.
FFMPEG_PATH=E:/ffmpeg/bin/ffmpeg.exe
FFPROBE_PATH=E:/ffmpeg/bin/ffprobe.exe
# Windows defaults to installed Google Chrome; override when needed.
CELFORGE_CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe
```

Start CelForge with its existing `scripts/start.ps1`. The bot requires access
to that address; set `CELFORGE_URL` to an accessible API if it runs elsewhere.
On Linux, install a rendering browser with `npx playwright install chromium`.
No CelForge code or model environments need modification.

Prompt enrichment requires the orchestrator's `X-AI-Instance` request control
and matching response header. This selects a configured instance for one
request while retaining normal placement verification and admission. The
previous local change is a direct persistent source edit in
`G:/bootstrap_scripts/gpu-orchestrator/backend/proxy.py`, with a backup beside
it; it is not a managed extension and upstream updates can overwrite it. On 13
October, the authorized control-routing fix was also deployed to
`backend/router.py` and `backend/proxy.py`. It allows Unsloth GET status and
configured cleanup endpoints through when free VRAM is below admission
headroom. GPU placement checks and cleanup locks still apply; generation and
model loading retain capacity checks. The idle orchestrator was restarted
without stopping its managed AI servers. Exact source backups are in
`G:/bootstrap_scripts/gpu-orchestrator/backups/control-routing-20261013-080744`.
The one-off review patch and deployment helpers are retained in the local
working-copy archive. The maintained implementation and tests live in the
orchestrator checkout. These source changes survive restart; an upstream source
replacement may require reapplying them. Unsupported instance routing fails
explicitly; `prompt_quality:off` can run without prompt enrichment support.

The subsequent [Observe-mode handoff fix](orchestrator-handoff.md) makes
Auto-unload release idle competing services before generation while preserving
Observe mode. This includes ComfyUI → Forge and Forge → ComfyUI handoffs.

After future schema changes, re-register commands and restart the bot. The
existing `node register-command.js` updates configured test guilds;
`node register-command.js --global` updates global commands. Registration is a
separate deployment step. On 13 October 2026, only the three video commands were
updated/created in their existing global and three configured test-guild scopes;
their resulting registrations were read back successfully. A bot start/restart
is still required to load changed source code; no local bot process was running
during the checks.

The extender update raised the duration limit to 60 seconds for these same
global and three test-guild command registrations, and read-back verification
passed for every scope. `node scripts/deploy_h3_commands.cjs --apply` performs
this narrow update and saves a timestamped schema backup in `temp`. The local
bot process was still stopped; its next start/restart must load the updated
handlers. The four extended desktop templates were also copied to
`G:/ComfyUI_windows_portable/ComfyUI/user/default/workflows/AnotherElaina_H3`.

### Historical verification (not rerun for this guide)

These are dated records of checks performed during implementation. They are not
a claim that the same tests or timings were repeated for this documentation
update, and they do not establish visual quality across arbitrary inputs.

```powershell
npm run test:media
node scripts/h3_smoke.cjs validate
# Each mode runs real five-second inference, retaining the output in temp/:
node scripts/h3_smoke.cjs text
node scripts/h3_smoke.cjs image
node scripts/h3_smoke.cjs hybrid
node scripts/h3_smoke.cjs ref
node scripts/h3_smoke.cjs video
node scripts/h3_smoke.cjs audio
node scripts/h3_smoke.cjs text768
node scripts/h3_smoke.cjs enrich standard
node scripts/h3_smoke.cjs enrich high
node scripts/h3_smoke.cjs enrich high --generate
node scripts/media_smoke.cjs --validate
node scripts/media_smoke.cjs --postprocess
node scripts/media_smoke.cjs --enrich standard
node scripts/media_smoke.cjs --enrich high PATH/TO/OPENING.png PATH/TO/ENDING.png
node scripts/media_smoke.cjs --generate standard
node scripts/media_smoke.cjs --orbit G:/AIStuff/celforge/temp.glb
# Optional real inference checks:
node scripts/media_smoke.cjs --model G:/AIStuff/celforge/tests/fixtures/camera/view-0.png
node scripts/media_smoke.cjs --generate
```

The validation check submits deliberately invalid seeds and expects only the
seed error, preventing H3 inference while validating the real output graph. The
postprocess check runs a one-second synthetic clip through AnimeSharp 2× and
RIFE49 and checks 128×128 output, 8 fps, and retained audio. The orbit check
renders the actual supplied GLB and checks 120 frames at 24 fps. Local smoke
outputs are retained under ignored `temp/`.

Enrichment checks verify the model's physical GPU while loaded, then confirm it
has unloaded. `--generate standard` also passes the rewritten prompt into a real
four-step H3 execution. Run maintained routing and handoff regressions from the
orchestrator checkout using its Python environment:

```powershell
Push-Location G:/bootstrap_scripts/gpu-orchestrator
try {
    ./.venv/Scripts/python.exe -B -m unittest backend.test_phase43 backend.test_service_control backend.test_service_handoff
} finally {
    Pop-Location
}
```

On 12 October 2026, all 18 media regression tests and 97 enabled chat tests
passed (three chat integration tests were disabled). Live ComfyUI validation
passed for text and image H3 graphs. The real AnimeSharp/RIFE clip and an
existing GLB orbit render passed their output checks. A new TRELLIS 512 run
(`85b54660-f79e-4daf-9fdb-f4738ecc2dea`) also completed through the CelForge
client, exported a 17,228,708-byte GLB, and produced the expected orbit MP4.
A real H3 generation at four sampling steps produced 124 frames at 24 fps,
1536×896 after RTX 2× upscaling, and an audio stream. This checks execution and
delivery formats; the reduced-step smoke is not a quality benchmark.

Prompt enrichment passed live on both selected GPUs: Gemma 12B on GPU 1
(RTX 3060), and Qwen 27B with both image anchors on GPU 0 (RTX 3090 Ti). Both
models unloaded successfully. An additional Gemma rewrite → unload → H3
generation passed the same frame, resolution, and audio checks. All 47 existing
orchestrator regression tests and three request-placement contract tests passed.
The idle orchestrator was restarted to activate the extension; bot restart and
slash-command registration remain deployment steps.

On 13 October 2026, the optimized update passed 24 media tests and 97 chat
tests (three optional integration checks skipped). All eight schema cases
validated against live ComfyUI. Real five-second generations passed for Turbo
text/image, hybrid image references with both frame guides, hybrid video with
soundtrack, hybrid standalone audio, and dedicated Ref2VA image references.
Each produced 124 frames at 24 fps with synchronized audio. The default
1024×768 Turbo adapter plus RTX 2× also passed with 2048×1536 output. Five-image
Gemma enrichment (two frame guides plus three chronological reference video
previews) passed with verified unload. After the control-routing deployment,
the same five-image Qwen enrichment and proxy unload verification also passed.
The complete Qwen rewrite → verified unload → hybrid generation with both frame
guides and a video/soundtrack reference passed: 124 frames, 768×448, 24 fps,
and synchronized audio. The hybrid execution took 171 seconds including
submission and retrieval. All 47 existing orchestrator tests and three new
low-capacity control-routing checks passed. These checks validate execution and
output formats; they do not measure reference fidelity across arbitrary media.

The extender update passed 29 media tests, a 20.04-second Turbo output with
streaming RTX 2×, and a 16.5-second hybrid output with both boundary guides.
Both had the exact expected frame count and synchronized audio. Long-script
enrichment and verified unload passed on Gemma and Qwen. A short Turbo request
still passed after the extender ran, and the subsequent Forge handoff reclaimed
18,400 MiB from ComfyUI while keeping Observe mode and Auto-unload enabled.
Detailed timings and the sample's observed continuity limits are recorded in
[h3-benchmark.md](h3-benchmark.md).

## Further reading

Primary references and related material:

- [MiniMax H3 audiovisual prompt writing guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)
  — the shot, soundscape, dialogue, reference-tag, and timeline conventions
  followed by the prompt rewriter.
- [ComfyUI native MiniMax H3 nodes](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py)
  — the node definitions used by the generated graphs.
- [MiniMax H3 Extender](https://github.com/tritant/ComfyUI_MiniMax_H3_Extender)
  — motion-context, disk-join, and final-decode nodes for clips longer than one
  native sampling window.
- [LightX2V MiniMax H3 Turbo model specifications](https://github.com/ModelTC/Minimax-H3-Turbo#1-model-specs)
  — adapter and sampling guidance used for the Turbo path.
- [ComfyUI setup and inference instructions for MiniMax H3 Turbo](https://github.com/ModelTC/Minimax-H3-Turbo/blob/main/COMFYUI_SETUP_AND_INFERENCE.md)
  — installation and graph guidance.
- [Hybrid FL2VA/Ref2VA model card](https://huggingface.co/smhfacct/Minimax-H3-fl2va-ref2va-hybrid-models)
  — the experimental merge used when a reference is added to a text/image
  command; fidelity depends on the scene.
- [TRELLIS project](https://github.com/microsoft/TRELLIS) and
  [TRELLIS paper](https://arxiv.org/abs/2412.01506) — background on the
  structured 3D-latent reconstruction family named by the TRELLIS recipes.
- [H3 workflow README](../resources/workflows/h3/README.md) — importable
  desktop graphs and their sampling defaults.
- [H3 benchmark](h3-benchmark.md) — dated local speed and continuity
  measurements, explicitly historical.
- [AI chat guide](ai-chat.md) — the chat subsystem and its own local model,
  retrieval, and privacy caveats.
