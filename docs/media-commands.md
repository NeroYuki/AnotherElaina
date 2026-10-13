# Restored media commands

`/wd_img2model` uploads an image to CelForge, creates a durable run, and renders
the exported GLB into a five-second, 512×512 orbit MP4 at 24 fps. The orbit video
is the primary reply. Set `download_glb:true` to receive the GLB separately.
TRELLIS 1024 cascade is the default recipe; TRELLIS 512 and Pixal single
1024/1536 are also available. CelForge owns foreground preprocessing, so the
old `remove_background` switch has been removed.

`/wd_txt2vid` and `/wd_img2vid` use the installed INT8 FL2VA model with an
8-step Turbo LoRA, Euler/simple sampling, native Kitchen INT8 attention,
tiled video VAE decoding, synchronized audio, and optional 2× RTX video super
resolution. Near 768p (short edge at least 704 pixels), the 768p adapter uses
video/audio shifts 6/3; smaller canvases use the other installed adapter and
12/3 shifts. Both use LoRA strength 1.0. No cache or sparse approximation is
stacked onto the distilled sampling path.

Image-to-video connects the opening frame to
`MiniMaxH3ImageToVideo.first_frame`; `last_image` optionally anchors the ending.
Both commands accept an optional `ref` attachment: image, video, or audio.
`/wd_ref2vid` requires `ref` and `prompt` and uses the installed dedicated
Ref2VA INT8 ConvRot model. Optional references on text/image commands use the
installed B25–49 INT8 hybrid model. Both use native `MiniMaxH3ReferenceToVideo`,
with `ref_image_size:match` to bound reference tokens. It defaults to 20 base
steps: the installed Turbo LoRAs were trained for FL2VA, not Ref2VA. With
image-to-video, `MiniMaxH3AddGuide` attaches opening and ending frames to the
reference conditioning without consuming the reference's `<Picture 1>` ID.

References are limited to 200 MiB. Images are decoded/rotated to PNG. FFmpeg
normalizes video to 24 fps and the output canvas, preserving its soundtrack;
audio becomes 32 kHz stereo WAV. Video references use their first 15 seconds or the output
duration, whichever is shorter; native H3 also trims reference video to its
17k+5 frame grid. A silent video has no soundtrack connection. Video references
require at least five frames; undecodable inputs fail before GPU submission.
The bot requires FFmpeg and FFprobe on PATH (or `FFMPEG_PATH` / `FFPROBE_PATH`).

Importable desktop workflows are in
[resources/workflows/h3](../resources/workflows/h3/README.md); they are exported
from the same builder as the commands with `node scripts/export_h3_workflows.cjs`.
They contain no LLM calls and default to native output without RTX upscaling.

All three commands enrich the user's prompt before submitting H3. `prompt_quality`
defaults to `standard`: Gemma 12B (`UD-Q4_K_XL`) on the RTX 3060. `high` uses
Qwen 27B (`UD-Q4_K_M`) on the RTX 3090 Ti. `off` preserves the supplied prompt
verbatim. These are the same fixed model profiles used by chat; video quality
selection does not change the chat model or a global service pin.

The rewriter follows the [MiniMax audiovisual prompt guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md).
It receives the requested duration plus the effective duration after H3 frame
alignment, and returns validated visual/action, soundscape and music sections.
For image-to-video it also receives compressed previews of the opening and
optional ending image. References add an image preview, three chronological
video previews, or audio metadata with the correct native reference tags.
The rewriter cannot hear reference audio; it retains the user's description
instead of guessing words, voice characteristics, or music. Reference previews
remain separate from frame anchors. Alignment instructions use
the effective duration; cut times must increase within the timeline. Supplied
dialogue and visible text are instructed to remain verbatim.

Video rewrites serialize through their model unload. The bot awaits a targeted
Unsloth unload with `force_cancel_active:false` and verifies the model is no
longer loaded before submitting H3. Rewrite errors still attempt cleanup. A
busy, failed or unconfirmed unload stops the command before video inference;
other consumers' work is never forcibly cancelled. The desktop template's LM
Studio load/rewrite/unload and text-preview nodes are removed from the graph.

H3 runs at 24 fps, including its audio timeline. Dimensions are aligned to 32
pixels and limited to 1344×768 total pixels. Durations are rounded up to the
17k+5 frame grid: a requested five seconds produces 124 frames (5.17 seconds).
Seed zero is valid. Legacy model, negative-prompt, CFG, shift, and FPS controls
have been removed because this workflow does not use them. `no_optimize`
selects base FL2VA sampling instead of Turbo (default 20 steps); reference
requests always use base sampling. `steps` overrides the default;
`do_upscale:false` disables RTX super resolution.

All three video commands accept **1–60 seconds**. Text-to-video uses
`custom_length`, now honored with every preset; image/reference commands use
`length`. Requests above 15 seconds use the installed
[MiniMax H3 Extender](https://github.com/tritant/ComfyUI_MiniMax_H3_Extender)
motion-context, disk-join and final-decode nodes. Each sampler handles at most
124 frames; subsequent clips carry 22 frames of video/audio context, trimmed
once when joining. The complete output stays on the same 17k+5 frame grid.
Opening and ending images anchor only the beginning and end of the full video.
References retain their model selection and native identifiers. Long standalone
audio is preserved up to the output duration and sliced along the clip timeline;
short sound references can be reused. Exhausted timeline audio is omitted from
later clips. Reference videos remain capped at 15 seconds and are reused as
references, rather than treated as a full-length source performance.

Long prompt enrichment returns a separate validated script per clip in one LLM
request, then verifies the LLM unload before rendering. With enrichment off,
the supplied prompt is reused for each clip. The 2× RTX option stays available:
the repository-owned `ElainaRTXVideoUpscale` node streams the assembled video
through the already installed NVIDIA SDK one frame at a time, then copies the
assembled audio. This bounds frame memory independently of video duration.
Long videos can take several minutes, especially with references and base
sampling. Results can use a channel reply after Discord's interaction expires.

The extender is installed persistently at
`G:/ComfyUI_windows_portable/ComfyUI/custom_nodes/ComfyUI_MiniMax_H3_Extender`,
version 3.0.12, reviewed commit `60efaf15c589d6671ef43e7c0946913a54221865`.
Its source is unmodified. The streaming node lives beside it in
`custom_nodes/anotherelaina_h3` and is maintained in this repository under
`resources/comfy_nodes/anotherelaina_h3`. Both survive ComfyUI restarts.
`scripts/install_h3_extender.ps1 -Restart` reinstalls the adapter and restarts
only an idle GPU-0 server. It checks the pinned extender revision and existing
dependencies; it does not upgrade packages or download models. The extender's
optional latent-refine/upscaler feature is disabled in these workflows.

Kitchen INT8 and Sage are alternative attention implementations for one
attention call. Kitchen's quantized weight/fused operations can coexist with
Sage attention, but these H3 graphs explicitly select Kitchen INT8 attention.
The server's startup message about its global PyTorch default does not override
the graph's per-model `ModelAttentionBackend` selection. Benchmark procedure
and measured results are in [h3-benchmark.md](h3-benchmark.md).

`/wd_vid_upscale` retains the old VHS → color matching → model upscale → RIFE →
VHS encode chain, pruning unused stages. It preserves source audio. Required
compatibility repairs are applied to each submitted graph:

- Use installed upscaler filenames without the obsolete `forge\` prefix.
- Set RIFE's `ckpt_name`, integer `multiplier`, and new required defaults
  `dtype`, `torch_compile`, and `batch_size`.
- Replace missing `DF_Multiply`/`JWIntegerToFloat` nodes with the installed core
  `ComfyMathExpression`, using the loaded video's FPS.
- Set the VHS load format to `None` to avoid automatic AnimateDiff resampling.
- Preserve uploaded subfolders and native SaveVideo/VHS output metadata.

Comfy submissions continue through `AI_PROXY_URL` with orchestrator workload
headers. HTTP history polling supplements WebSocket progress, so cached or
missed events still complete the command. The restored commands do not send
global ComfyUI model-unload requests; ComfyUI VRAM cleanup remains owned by the
orchestrator. CelForge uses its separate case/run API and queue;
it is not a ComfyUI graph or a configured AI proxy service.

## Setup

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
`G:/bootstrap_scripts/gpu-orchestrator/backend/proxy.py`, with a backup beside it;
it is not a managed extension and upstream updates can overwrite it.
On 13 October, the authorized control-routing fix was also deployed to
`backend/router.py` and `backend/proxy.py`. It allows Unsloth GET status and
configured cleanup endpoints through when free VRAM is below admission
headroom. GPU placement checks and cleanup locks still apply; generation and
model loading retain capacity checks. The idle orchestrator was restarted
without stopping its managed AI servers. Exact source backups are in
`G:/bootstrap_scripts/gpu-orchestrator/backups/control-routing-20261013-080744`.
The review patch is `resources/patches/orchestrator-control-capacity.patch`;
`scripts/deploy_orchestrator_control_fix.ps1` prepares, tests, backs up, and
deploys it. These are source changes that survive restart; an upstream source
replacement may require reapplying them. Unsupported instance routing fails
explicitly; `prompt_quality:off` can run without prompt enrichment support.

The subsequent [Observe-mode handoff fix](orchestrator-handoff.md) makes
Auto-unload release idle competing services before generation while preserving
Observe mode. This includes ComfyUI → Forge and Forge → ComfyUI handoffs.

After future schema changes, re-register commands and restart the bot. The existing
`node register-command.js` updates configured test guilds;
`node register-command.js --global` updates global commands. Registration is a
separate deployment step. On 13 October 2026, only the three video commands
were updated/created in their existing global and three configured test-guild
scopes; their resulting registrations were read back successfully. A bot
start/restart is still required to load changed source code; no local bot
process was running during the checks.

The extender update raised the duration limit to 60 seconds for these same
global and three test-guild command registrations, and read-back verification
passed for every scope. `node scripts/deploy_h3_commands.cjs --apply` performs
this narrow update and saves a timestamped schema backup in `temp`.
The local bot process was still stopped; its next start/restart must load the
updated handlers. The four extended desktop templates were also copied to
`G:/ComfyUI_windows_portable/ComfyUI/user/default/workflows/AnotherElaina_H3`.

Files within Discord's attachment limit are attached directly. Larger outputs
are uploaded to Catbox and returned as links. The new media path uses Catbox's
file API because the old shared helper now targets an image-only host.

## Verification

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
seed error, preventing H3 inference while validating the real output graph.
The postprocess check runs a one-second synthetic clip through AnimeSharp 2×
and RIFE49 and checks 128×128 output, 8 fps, and retained audio. The orbit check
renders the actual supplied GLB and checks 120 frames at 24 fps. Local smoke
outputs are retained under ignored `temp/`.

Enrichment checks verify the model's physical GPU while loaded, then confirm
it has unloaded. `--generate standard` also passes the rewritten prompt into
a real four-step H3 execution. Optional routing regression checks use the
orchestrator's Python environment:

```powershell
G:/bootstrap_scripts/gpu-orchestrator/.venv/Scripts/python.exe -B tests/video_prompt_routing_test.py G:/bootstrap_scripts/gpu-orchestrator
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
(RTX 3060), and Qwen 27B with both image anchors on GPU 0 (RTX 3090 Ti).
Both models unloaded successfully. An additional Gemma rewrite → unload →
H3 generation passed the same frame, resolution and audio checks. All 47
existing orchestrator regression tests and three request-placement contract
tests passed. The idle orchestrator was restarted to activate the extension;
bot restart and slash-command registration remain deployment steps.

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
submission and retrieval.
All 47 existing orchestrator tests and three new low-capacity control-routing
checks passed. These checks validate execution and
output formats; they do not measure reference fidelity across arbitrary media.

The extender update passed 29 media tests, a 20.04-second Turbo output with
streaming RTX 2×, and a 16.5-second hybrid output with both boundary guides.
Both had the exact expected frame count and synchronized audio. Long-script
enrichment and verified unload passed on Gemma and Qwen. A short Turbo request
still passed after the extender ran, and the subsequent Forge handoff reclaimed
18,400 MiB from ComfyUI while keeping Observe mode and Auto-unload enabled.
Detailed timings and the sample's observed continuity limits are recorded in
[h3-benchmark.md](h3-benchmark.md).

MiniMax implementation reference: [ComfyUI's native H3 node source](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py).
