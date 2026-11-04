# Forge image workflows: implementation report

Date: 2026-11-03 (Asia/Bangkok). Repository: `E:\dev\AnotherElaina`.

No commits, pushes, Discord command registration, or deployment were performed.

## Implemented

- Shared img2img/reference executor and job runner:
  - `utils/forge_image_command.js` (thin command adapters, reference mode, prompt enrichment, lease, PiD selection)
  - `utils/forge_image_job.js` (preview/progress, cancellation ownership, temp-file-aware result selection, PiD postpass hook, delivery)
- New `/wd_ref2img` and `/wd_ref2img_adv` with primary image plus `reference_2`..`reference_4`, native/grid/horizontal/vertical layouts, and general/identity edit variants.
- Reference policy and leased mode switching in `utils/forge_reference.js`; focused tests added.
- Per-instance serialized Forge lease in `utils/forge_session.js`; focused tests added.
- Anima 006 inpaint helper and `load_controlnet` Anima branch; Anima reference mode is disabled during the inpaint request.
- PiD:
  - SDXL uses Forge's integrated PiD pass.
  - Other known RGB families use the standalone SDXL PiD RGB postpass with checkpoint/preset/module restore in `finally`.
  - `generation_upscaler_selection` exposes PiD only to generation commands; native `upscaler_selection` (Extras) is unchanged.
  - Create commands support integrated PiD (SDXL) and reject non-SDXL postpass with a clear message.
- Image prompt enhancement and all/each batching integrated into create, img2img, reference, and inpaint commands.
- Option/choice limits kept at <=25; new commands and PiD choice tested.
- Updated `document.md` for reference commands, PiD, Anima inpaint, and image prompt enhancement.

## Automated verification

Passing latest runs:

- `npm run test:forge` — 92 passed
- `npm run test:image` — 29 passed
- `npm run test:media` — 29 passed
- Focused `node --check` on changed commands/helpers

Coverage includes reference policy/LoRA injection/restore, session serialization, multi-reference schema, temp-file result selection, PiD integrated/postpass helpers and model restore, image prompt all/each counts and metadata, option limits, and existing Forge schema/outpaint/tiled/media suites.

## Live Forge results (local, no Discord)

Validated on GPU0:

- Qwen 2.1 denoise produced a distorted teapot; reference mode produced a clean blue-glass edit from the same source and restored `qwen21_do_reference`.
- MOSS edit LoRA added gold trim and changed the teapot to blue; `moss_image_edit_lora_rank_64_bf16` was injected once.
- Anima edit LoRA produced a green teapot with gold trim; `AnimeEditV2` was injected once.
- Krea2 general and identity both produced distinct blue-glass edits using the correct edit LoRA.
- Four native references (primary + three Gallery references) completed successfully with Qwen. The edit followed the reference content, but the requested four-object lineup was not guaranteed; this is model behavior, not payload failure.
- Anima masked inpaint with `animaLllite_006-inpainting` + `inpaint_noobai` changed the white-mask region to a green teapot. The surrounding region still changed at high denoise/whole-picture settings, so users should lower denoise or choose a more restrictive inpaint area to preserve the rest of the image.
- SDXL integrated PiD produced valid 2048x2048 and 4096x4096 results (verified image content and dimensions, not just HTTP 200).
- Anima RGB PiD postpass produced a valid 2048x2048 result and restored the original Anima checkpoint afterwards.
- Runtime snapshot restored: GPU0 checkpoint `moss_image_sft_bf16.safetensors`, MOSS modules, and all reference options (`qwen21`, `klein`, `anima`, `krea2` true; `moss` `Moss-Image-Edit`). GPU1 restored to `moss_image_base_bf16.safetensors` with its original `anima=false`, `krea2=false`, `moss=Disable` reference settings. Both instances idle.
- Forge launcher remains at `G:\AIStuff\sd-webui-forge-neo\webui-user.bat` with the original `--sage` flag. Pre-test launcher backup: `G:\AIStuff\sd-webui-forge-neo\tmp\webui-user-before-pid-sage-test-20261103.bat`.

## PiD / SageAttention fix

PiD passes produced NaN/blank images when Forge ran with `--sage`:

```
Encountered NaN in Latent; Try --disable-sage
```

Benchmarks:

- SDXL txt2img, 1024x1024, 20 steps, two runs: `--disable-sage` 4.57 s average; `--sage` 4.30 s average (~6%).
- Qwen 2.1 reference edit, 768x768, 12 steps, two runs after warmup: `--disable-sage` 18.28 s average; `--sage` 18.24 s average (effectively identical).

Because the heavy-model gain is negligible and the SDXL gain is small, Forge Neo was patched instead of disabling Sage globally:

- `G:\AIStuff\sd-webui-forge-neo\backend\attention.py`: when `backend.args.dynamic_args.pid` is true, `attention_sage` delegates to `attention_pytorch`. This applies to both the integrated PiD pass and the standalone PiD RGB postpass.
- `G:\AIStuff\sd-webui-forge-neo\webui-user.bat` remains on `--sage`.
- Backup: `G:\AIStuff\sd-webui-forge-neo\tmp\attention-before-pid-sage-bypass-20261103.py`.

Validated after the patch with `--sage`:

- SDXL integrated PiD: 4096x4096, non-uniform content, 25 MB PNG.
- Anima RGB PiD postpass: 2048x2048, non-uniform content, 8 MB PNG.
- Ordinary Qwen 2.1 reference generation remained at the Sage speed (18.22 s average after warmup).

## Model catalog / reference-model updates (post-handoff)

- Flux Fill and Flux Kontext were upgraded from Q6_K to Q8_0 in the bot model list and ComfyUI workflows:
  - `comfy_sym\flux1-fill-dev-Q8_0.gguf`
  - `comfy_sym\flux1-kontext-dev-Q8_0.gguf`
  - `resources/flux_kontext.json` and `resources/flux_fill_inpaint.json` updated. The Flux Outpaint workflow still uses the separate Nunchaku Fill path.
- MOSS Image SFT Int8 ConvRot (`moss_image_sft_int8_convrot.safetensors`) was added to the MOSS/curated/experimental lists.
- Flux Kontext was removed from the experimental menu (freeing the slot for MOSS int8) and added to the reference-command checkpoint menu. The experimental list remains at 25 entries.
- Ref2img auto-conversion:
  - `flux1-dev*` selections and an active Flux Dev model are mapped to the installed Flux Kontext Q8 checkpoint.
  - The mapped model is force-loaded, and explicit reference checkpoints are force-loaded as well to avoid the old cached3 restriction.
  - Flux Kontext has no family reference switch or edit LoRA; it uses Forge's native Kontext reference latents.
- A live 512x512/8-step Flux Kontext Q8 ref2img smoke was started but was extremely slow (~80 s/step) and was interrupted. The menu/substitution/force-load paths are covered by unit tests, but native Forge Kontext Q8 ref2img performance still needs a dedicated follow-up.

## High-resolution VRAM / text encoder offload

Forge's generic `free_memory()` path sorts by already-offloaded bytes, so a fully resident `JointTextEncoder` is considered last and can stay on the GPU while the active diffusion model is partially unloaded.

Added to Forge Neo:

- `backend/memory_management.py`: `free_text_encoders_if_needed()` fully offloads `JointTextEncoder` residency before sampling. Any encoder at least 2 GB (Flux T5/CLIP, Qwen, MOSS, PiD Gemma) is always moved to system RAM when it fits; small SDXL CLIP encoders are only offloaded when memory is tight. `--gpu-only` is skipped.
- `backend/sampling/sampling_function.py`: calls it from `sampling_prepare()` before loading the diffusion model.
- Backups: `tmp/memory_management-before-te-offload-20261103.py`, `tmp/sampling_function-before-te-offload-20261103.py`.

Measured:

- Qwen 2.1, 1536x1536, 8 steps: 50.1 s -> 20.5 s, 8,922 MB freed to RAM.
- Flux Kontext Q8, 256x256, 4 steps: 17.3 s, 5,397 MB T5/CLIP freed to RAM; KModel then loaded fully (12,125 MB) instead of partially.
- Qwen 1024x1024/8 steps: 6.9 s with the encoder offloaded.
- SDXL 1536x1536/20 steps: 9.5 s; its small text encoder stays resident.

The offload target is the normal `ModelPatcher.offload_device` (system RAM). The helper checks `psutil` available RAM first (encoder size + 512 MB margin) and skips the offload with a warning if the host cannot hold it. `--gpu-only` is skipped because its offload device is the GPU.

Note: Flux Fill in Forge-native img2img still hits a shape mismatch (`mat1 and mat2 shapes cannot be multiplied`) because Fill expects its masked/inpaint conditioning path. That is a model-semantics issue, not VRAM. The bot's Flux Fill usage remains the ComfyUI inpaint workflow; the Q8 filename was updated there.

## MOSS layout prompts and Coupler conversion

MOSS-Image accepts a JSON layout prompt with `summary.caption`, `items[].label/caption/bbox`, and `bbox_coord_space: "abs_centralized"` + `bbox_format: "yxyx"`. The bot mirrors Forge's built-in `sd_forge_json_builder` conversion, including the centered absolute coordinates, floor/ceil export precision, and parenthesis escaping.

- `utils/moss_layout.js`: draft validation, MOSS compile/decompile, layout preview rendering (sharp/SVG), scaling, `<layout:name>` token parsing, and Forge Coupler Advanced conversion (`[x1,x2,y1,y2,weight]` normalized regions plus inline `|x1:x2,y1:y2,w|` prompt syntax).
- `utils/layout_store.js`: per-user named layouts stored in `data/moss_layouts.json` (gitignored), with atomic writes.
- `utils/layout_agent.js`: Qwen 27B (`Qwen3.8-27B-GGUF`, `UD-Q4_K_M`, `unsloth-gpu0`) layout planner with one automatic JSON-repair retry. It shares `queuePromptEnrichment` with the existing enhancers and unloads the model before image generation.
- `utils/layout_prompt.js`: resolves `image_prompt_layout` (`off`/`auto`/`moss`/`coupler`) and expands saved `<layout:name>` tokens.
- `commands/wd_layout_draft.js`: interactive draft preview with Adjust, Save, Coupler prompt, and Cancel. Adjustments are typed in the channel; Save returns a JSON file with the draft, compiled MOSS prompt, and Coupler prompt.

Layout-aware planning is wired into `/wd_create` and `/wd_create_adv` through the new `image_prompt_layout` setting. MOSS receives the compiled JSON layout with the natural prompt appended; SD/SDXL models receive the equivalent Forge Coupler prompt. The setting is ignored for other families and for img2img/reference workflows, which keep plain prompt enhancement.

Live smoke results:

- Qwen 27B layout draft: 35.2 s for a 1024x1024 poster with a title and mountain.
- MOSS SFT 512x512/36 steps with the compiled layout: 51.5 s. The preview rendered `EXPLORE` at the top and the mountain in the lower center as specified.
- SDXL `pastelmix` 512x512/8 steps with the Coupler conversion: 27.9 s. The regions were applied, but SDXL's text rendering is inaccurate; MOSS remains the intended model for literal text layouts.

## Reference-edit fixes

Reference commands now handle three model-specific edge cases:

- **MOSS int8:** `moss_image_sft_int8_convrot` cannot apply the bf16 edit LoRA. Reference requests are automatically redirected to `moss_image_sft_bf16` (or the matching BF16 variant) and the channel is told about the substitution. If the BF16 checkpoint cannot be loaded, the command fails instead of silently using int8.
- **Anima:** `AnimeEditV2` follows explicit instructions much more reliably than a bare command. `prepareReferencePrompt` wraps the user prompt as `Edit the image: ... Apply only the requested changes and keep everything else unchanged.` before appending the edit LoRA. The wrapping is idempotent and preserves explicit instructions.
- **Klein CFG:** the family-default resolver treated `cfg: 1` as "use dcfg", but Klein has no `dcfg`, so reference edits inherited the generic CFG 7. This produced colorful artifacts and mottled backgrounds. Klein now keeps CFG 1; Flux/Z-Image/Krea still use their distilled or shift values. Families with neither value (SD1.x/SDXL) now keep the caller's CFG instead of being forced to 1.

Live validation after the fixes:

- Anima Aesthetic v1.1, 1152x2048, ER SDE/Beta, wrapped prompt: dress changed to red; the wrapper is what made the edit follow the instruction.
- MOSS Image SFT BF16, 1152x2048, 36 steps: dress changed to red; the int8 checkpoint produced an unedited copy.
- Flux2 Klein 9B KV Int8, 1152x2048, 4 steps: clean red-dress edit at CFG 1; CFG 7 reproduced the artifact pattern.

## Other real limitations / notes

- Very long proxy requests used to outlive the orchestrator's flat 300s upstream read timeout: a four-reference Qwen run at 768px/12 steps completed on Forge (~9 minutes) but the client received a 504/502. The proxy no longer imposes a read/total deadline on upstream responses; connect and pool timeouts stay at 10s, write at 60s, and a client disconnect closes the upstream stream. An orchestrator restart is required for that change. Failed upstream sends are now recorded in the orchestrator request log instead of being silent.
- Progress polling is best-effort: `utils/forge_progress.js` checks `response.ok`, reads the body as text, logs the status and a body preview, and aborts after 15s. Both `/wd_create` commands and the shared image job use it, so a proxy 5xx/plain-text progress body can no longer throw a `SyntaxError` or stall the polling loop.
- `/wd_create` and `/wd_create_adv` PiD support is SDXL integrated only. Non-SDXL PiD generation currently uses `/wd_img2img` or `/wd_ref2img` postpass.
- Discord command registration is still required before users can invoke `/wd_ref2img` and `/wd_ref2img_adv`; this report and the working tree do not register them.
