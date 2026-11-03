# Forge image workflows: OpenCode implementation handoff

Updated: 2026-11-03, Asia/Bangkok. Repository: `E:\dev\AnotherElaina`.

## Execution instructions

Implement this plan using **OpenCode workers only**. Do not create Codex subagents.
The user requested a plan handoff to conserve Codex quota. Implementation is
partially underway; the current working tree is **not ready to deploy**.

- Preserve all existing edits. Do not reset, discard, stage, commit, push, or
  create branches unless the user subsequently requests it.
- Keep generation on Forge's Gradio `/run/predict/` with positional arguments
  and `fn_index`. Do not migrate generation to the REST generation API.
- Existing read-only options/catalog requests and orchestrator service controls
  are administrative operations, not a generation API migration.
- Do not expose `.env`, bot `config.json`, credentials, or tokens to external
  model handoffs. Ordinary repository source is authorized for OpenCode.
- Do not upgrade Discord.js, download large replacement models, reset Forge
  settings, or remove existing generation features as incidental cleanup.
- No Discord registration/messages or deployment are authorized by this plan.
  Local Forge/LLM testing is authorized. Preserve the selected models and UI
  reference settings after live tests; coordinate all live inference centrally.

## Existing OpenCode jobs: avoid concurrent overwrites

Two workers were confirmed running at 20:41 Bangkok time. Wait for completion
before reviewing or modifying their owned files. PIDs are historical: verify
the process command line/task file before relying on a PID; never kill unrelated
OpenCode servers. Their old terminal session handles belonged to now-stopped
Codex coordinators and cannot be polled from the root session.

| Worker | Task file under `temp\` | Launcher / worker PID | Owned implementation |
| --- | --- | --- | --- |
| Shared image commands | `shared-image-commands-worker-task.txt` | 30984 / 33412 | img2img basic/advanced, inpaint integration, new ref2img commands, shared executor/job runner and focused tests |
| Image enhancer command integration | `image-prompt-create-worker-task.txt` | 52412 / 66276 | create basic/advanced, `image_prompt_batch.js`, batch/command tests |

Earlier jobs have finished or no longer have an active matching process:

- `temp\image-prompt-core-worker-task.txt`: enhancer/settings/LLM queue core.
- `temp\pid-anima-worker-task.txt`: initial Anima ControlNet and integrated SDXL
  PiD helpers/builders. Code exists, but final integration has not been reviewed.

Read those task files for detailed acceptance criteria. They are not the final
authority where the corrections below supersede their original instructions.

If another bounded OpenCode run is needed, use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  C:\Users\ADMIN\.codex\skills\delegate-opencode\scripts\run-worker.ps1 `
  -Repo E:\dev\AnotherElaina -TaskFile <UTF-8-task-file>
```

That helper selects `opencode2 run`, `opencode-go/deepseek-v4.1-flash`,
`deepseek-worker`. Do not launch an interactive TUI or switch workers/models.

## User-visible outcome

1. `/wd_img2img` and its advanced version do real denoising img2img.
2. Separate `/wd_ref2img` and advanced equivalent run native reference/edit
   conditioning, loading the required installed edit LoRA automatically.
3. Up to four references: reuse the three existing ControlNet attachment slots
   as `reference_2`, `reference_3`, `reference_4` in ref commands. Native separate
   references are the default; optional grid/horizontal/vertical collage layouts.
4. Anima inpainting uses the supplied Anima006 inpaint ControlNet correctly.
5. PiD is an upscale choice for image generation, including reference workflows.
6. Shared img/ref/inpaint inference, preview, abort, and result delivery replace
   duplicated command code while retaining existing features.
7. `wd_setting` controls image prompt enrichment: off/standard/high quality,
   enhance once for all images or enhance each, and auto/tags/natural additions.
8. Every command/subcommand option list, choice list, and select menu stays at
   **25 entries or fewer**, including legacy checkpoints.

## Work already in the working tree

Inspect actual files; implementation reports are advisory, not final validation.

- `utils/image_prompt.js`, `tests/image_prompt.test.js`: core enhancer exists.
  Earlier coordinator reported 19 focused image/video tests passing.
- `wd_setting.js`, `common_helper.js`: three `image_prompt_*` settings added.
- `video_prompt.js`: shared serialized LLM queue/unload helpers exported so
  video/image enhancement cannot unload each other's active LLM inference.
- `utils/forge_session.js`: per-instance asynchronous lease helper exists.
- `utils/forge_reference.js`: root wrote reference policy, LoRA injection and
  availability checks, mode snapshot/change/restore, and reference preparation.
  **It has not yet had focused tests or live validation.**
- `proxy_config.js`: Forge requests default to `X-AI-Instance: forge-gpu0`, so
  model/CN/quicksetting changes and inference reach the same instance. Other
  services are unaffected; explicit extra headers can override affinity.
- `load_discord_img.js`: PNG uploads now use UUID filenames, avoiding collisions
  between concurrent uploads previously all named `image.png`.
- `anima_inpaint.js`, `forge_pid.js`, associated tests, `controlnet_execute.js`,
  and `ai_server_config.js`: initial helper/builder work exists from OpenCode.
- Shared command/executor/job and prompt-batch files are being written by the
  active workers. Do not overwrite them before those workers exit.

The working tree was clean when this request began; the previous Forge refresh,
model additions, retired Nunchaku selection, and outpaint repair are committed
baseline. Keep those behaviors. All changes for this new request are uncommitted.

## Phase 1: verify runtime and current Gradio schema

Forge: `G:\AIStuff\sd-webui-forge-neo`. Shared models:
`G:\AIStuff\stable-diffusion-webui\models`. Orchestrator:
`G:\bootstrap_scripts\gpu-orchestrator`, proxy11230/dashboard11231.

Root found the launcher still passed obsolete `--model-ref`, which current
Forge silently ignores. This prevented new shared LoRA/ControlNet discovery.
Root changed only that token to:

```text
--forge-ref-a1111-home "%A1111_HOME%"
```

`A1111_HOME` still points at the shared models root. Backup:
`G:\AIStuff\sd-webui-forge-neo\tmp\webui-user-before-reference-path-20261103-203051.bat`.
Both instances were checked idle, then stopped/started through orchestrator
controls. **Readiness and catalog discovery after this restart still need checking.**
Do not redo the earlier dependency repair: comfy-kitchen0.2.40 already imports
the required layout; VERSION_UID is already PY313. Preserve Python3.11,
Torch2.10/CUDA13/Sage and custom `modules/api/api.py` changes. TIPO/DanTagGen
extension import errors are known nonfatal; do not broaden this task into them.

Saved runtime snapshot before the restart:
`temp\forge-reference-settings-before.json`. It contains only selected
checkpoint/reference settings for ports7860/7861. Restore these after live tests.
Both instances share on-disk config; restore GPU0 last if saving settings.

Current captured schema: `temp\forge-config-ref2img-current.json`.
Actual existing indices **did not shift**; quicksetting callbacks were appended.

| Function | fn_index / positions |
| --- | --- |
| txt2img | 618, 276 arguments |
| img2img/inpaint | 1338, 310 arguments |
| Abort | 46 |
| Model / companion modules | 2 / 3 |
| CN unit base txt/img | 468 / 1150; per-unit increments44 /46 |
| CN type filter txt/img | 472 /1154 |
| CN annotation bases | 1264 /1282; increments6 |
| Klein / Qwen21 / Anima / Krea / MOSS reference callbacks | 1467 /1468 /1469 /1470 /1471 |
| ImageStitch txt fields | 217 enable,218 Gallery array,219 max side |
| ImageStitch img fields | 244 enable,245 Gallery array,246 max side |
| PiD txt/img fields | 45..51 /66..72 |

After restart, re-fetch `/config` and validate signatures by API name/input
labels, not volatile numeric component IDs, UUIDs or accordion element IDs.
Refresh `tests/fixtures/forge-schema-20261103.json` and add quicksetting signatures
if necessary. Never apply an assumed fixed offset without verifying it.

## Phase 2: finish reference policy and atomic execution

Public interfaces already agreed with workers:

```js
withForgeSession(callback, { key: 'forge-gpu0' })
getReferencePolicy(model, { workflow: 'denoise'|'reference'|'inpaint', editVariant: 'general'|'identity' })
prepareReferencePrompt(prompt, model, { editVariant })
withForgeImageMode({ model, workflow, session_hash, endpoint, headers, prompt, editVariant }, callback, deps?)
prepareReferenceInputs({ images, layout, session_hash, endpoint, direct_url, width, height, max_side }, deps?)
// -> { attachment: dataURI, references: GalleryImage[], imageCount, layout }
```

Reference-capable families: Qwen2.1, Klein, Anima, MOSS, Krea2. Ref dropdowns must
offer these actual installed models, not reuse the SD/SDXL-only advanced list.
Known supported ref checkpoints may be force-loaded outside the old cached3.
Keep ordinary command cache behavior unless fixing a frozen-model race.

| Family | Reference setting | Required edit LoRA |
| --- | --- | --- |
| Qwen2.1 | qwen21_do_reference=true | none |
| Klein | klein_do_reference=true | none |
| Anima | anima_do_reference=true | AnimeEditV2 |
| Krea2 | krea2_do_reference=true | krea2_general_edit_v2 OR krea2_identity_edit_v2 |
| MOSS | moss_do_reference=Moss-Image-Edit | moss_image_edit_lora_rank_64_bf16 |

Denoise/inpaint disable the corresponding reference setting (`false`, MOSS
`Disable`), then restore the prior UI value in `finally`. Reference defaults to
denoise1. Do not load both Krea edit LoRAs at1; explicit identity edit tags must
prevent automatic general-edit injection. Preserve explicit user LoRA weights.

The reference helper uses read-only `/sdapi/v1/loras` catalog validation; confirm
the corrected launcher exposes each required file. Required LoRAs live in shared
`Lora`. `moss_sk_i-404` was inspected but is not proven to be an edit adapter;
do not auto-select it or assume its conditioning format.

Hold one Forge lease across model selection, mode changes, CN/ADetailer setup,
all inference/postpasses, and cleanup. Enhancement/downloads happen before the
lease. Freeze effective checkpoint before LLM work, then re-sync/reselect it
inside the lease to prevent style/model races. All setup, upload, generation,
preview and abort requests must retain the same instance-affinity header.

Native ImageStitch Gallery payload:
`[{image:{path,url,mime_type:'image/png',meta:{_type:'gradio.FileData'}},caption:null}]`.
The img2img primary attachment is already reference1; Gallery contains only
additional refs. Pass width/height into reference preparation to letterbox the
primary rather than crop it when output aspect differs. Additional references
retain their own aspect. Reference max-side is <=2048 (native slider), default1024.

Both builders receive an optional final `generation_options` argument after
DAAM: `{references, reference_max_side, pid}`. Confirm singular
`reference_max_side` works; the first worker draft used inconsistent aliases.

## Phase 3: review shared command consolidation

After worker33412 exits, review thin basic/advanced img/ref adapters and shared
executor/job runner. Inpaint should retain SAM/manual-mask preparation but share
inference/preview/cancel/download/result code. Preserve native tiled upscale,
Native Outpaint overlap repair, Flux fallbacks, profiles, negative prompt rules,
ADetailer, Coupler, ControlNet, DAAM and cooldowns.

Fix these known post-worker integration items:

- Supported-only ref model menu; known ref selection can load outside cached3.
- Reuse CN attachment slots for refs; never also pass them to ControlNet.
- Pass width/height to `prepareReferenceInputs`.
- Enhancer `images` must be **Buffers**, not data URI strings.
- Keep SAM and CN state changes inside the Forge lease.
- Stop collectors/timers in `finally`. A stale/completed cancel button must
  never issue global abort against a later job; abort only the owned active POST.
- Confirm output selection chooses actual PiD final images, not the base image.

Worker found existing Comfy JSON/node mismatches: Kontext LoadImage is node41
(old code5), fill-outpaint LoadImage17 (old15), and some optional nodes are absent.
Review any fixes against resource JSON; do not silently drop those features.

## Phase 4: Anima006 inpainting

File: shared `ControlNet\animaLllite_006-inpainting.safetensors`.
It is an older **3-channel** LLLite model, not a new4-channel masked-input model.

Use:

```js
get_anima_inpaint_unit({model, preprocessor_override: null, overrides: null})
// null for non-Anima, otherwise first unit using:
// alias controlnet_inpaint -> animaLllite_006-inpainting
// preprocessor inpaint_noobai, type Inpaint, weight1, Balanced, resolution1024
```

The correct canonical mask is white=edit. `inpaint_noobai` black-fills the edit
pixels and clears the mask before old LLLite fallback. Generic None+mask keeps
the wrong region; global/only preprocessors emit incompatible negative sentinels.
Pass only explicit saved/user unit overrides, not the old generic default `fill`.
Explicit incompatible preprocessors should fail with a clear message. Disable
Anima reference mode for this workflow and verify the actual source/mask pair.

## Phase 5: complete PiD, especially reference workflows

Safe installed distilled assets:

- `pid_sdxl_1024_to_4096_4step_bf16 [c8dd35d7d5]`
- `sdxl_vae.safetensors`
- `gemma_2_2b_fp16.safetensors`

Native integrated pass: **4x, LCM/Simple,4 steps, CFG1,shift1.5**. It conflicts
with Hires Fix. The installed Flux2 PiD file lacks `_4step_` and is **undistilled**;
never send it through that hardcoded LCM4 integrated pass.

Initial `prepare_pid_upscale` currently gates SDXL only. Finish the approved
universal path instead of rejecting all reference-model users:

1. Return `stage:'integrated'` for compatible SDXL base latents.
2. Return `stage:'postpass'` for other RGB-generating families.
3. For postpass, first generate normally, fetch the resulting PNG, then load
   standalone SDXL PiD and run Gradio img2img from RGB with its SDXL VAE/Gemma,
   LCM/Simple4, CFG1,shift1.5,denoise1 and4x output. This avoids incompatible
   direct MOSS/Klein/Qwen latents and needs no model downloads.
4. Restore original checkpoint/preset/modules in `finally`, under the same lease.

Agreed helper proposal (not yet implemented):

```js
run_pid_postpass(packet, {
  model, prompt, endpoint, headers, session_hash, pid,
  onTask, shouldCancel, predict, switchModel, restoreModel, fetchImage
})
// packet and predict result are Forge response bodies, not Axios wrappers.
// predict({fn_index,session_hash,data}) -> body
// switchModel({checkpoint,preset,modules}); restoreModel() in finally
// return normalized packet containing ONLY final upscale images + aligned metadata
```

- Keep base sides<=1024 / output<=4096 for the initial workflow; validate exact4x.
- Integrated PiD appends results after originals. Correct selection/batch metadata
  and output dimensions/cooldown/workload must reflect the final upscale.
- Change active task ID for each postpass; cancellation stops remaining jobs.
- Remove base-model `<lora:...>` load tags from the PiD-only caption to avoid
  loading incompatible LoRAs onto PiD, while retaining base prompt/metadata.
- Integrated PiD has native LAB color correction; standalone direct PiD does not.
  Validate raw output first. Do not claim correction occurred or add a new client
  color algorithm before seeing a real need.
- Export `generation_upscaler_selection` for explicit generation consumers.
  **Leave native `upscaler_selection` unchanged** for Extras `/wd_upscale` and
  any other caller that cannot handle literal PiD. The first draft may need fixing.
- Builders only enable integrated PiD when stage=integrated; postpass still
  disables HR/SeedVR for the base request without enabling incompatible PiD.

## Phase 6: prompt enhancer and batch integration

Core API:

```js
enrichImagePrompts({prompt,model,count:1,settings,workflow,images:[],onProgress}, deps?)
// -> {prompts:[one shared prompt OR count variants],perImage,style,quality}
```

Settings use long keys: `image_prompt_quality`, `image_prompt_batch`,
`image_prompt_style`. Do not feed the short normalization result
`{quality,batch,style}` back as settings. Defaults off/all/auto preserve prior use.
Auto additions: tags for ordinary SD/XL/Anima; natural for other families and
reference/edit workflows. Explicit user tags/natural wins.

Preserve the original prompt **byte-for-byte as immutable prefix**, including
unknown activation phrases, `<lora:name:weight>`, wildcard/dynamic LoRA syntax.
The LLM adds validated details; it does not fully convert/rewrite that prefix.
Reject new adapter/control syntax in additions and retain existing prompt parsing
exactly once. Do not duplicate LoRAs when appending per-image additions after
the existing prompt analyzer/wildcard pipeline.

- all: one enhancement then existing batch_count/batch_size request.
- each: one batched structured LLM call returns exactlyN variants; run N
  sequential single-image Forge requests under one lease; preserve total limits.
- Deterministic seeds progress per image; random seeds stay random.
- Merge metadata/DAAM heatmaps correctly; each-mode has no synthetic grid, so do
  not apply the old first-item grid/path-rewrite branch to merged results.
- Shared image/video LLM queue must wait for verified unload before Forge work;
  enhancement refusal/error must not mutate a Forge model or partially submit.
- Integrate helper in img/ref/inpaint as well as create basic/advanced. Count1
  modes still honor quality/style settings.

## Phase 7: focused verification, then final service tests

Review diffs for incomplete edits, dropped features, wrong ownership, callback
cleanup, local file changes and accidental secret reads. Include all new tests
in the appropriate npm script once workers finish (workers were told not to edit
package.json). Run focused new suites first, then existing Forge/media/video
prompt tests. Do not write implementation-mirroring tests or rerun broad unrelated
chat suites absent a concrete reason.

Required checks:

1. Serialized options/choices/selects<=25, including legacy and new ref commands.
2. Reference quicksetting restore on success/error/cancel, same-instance affinity,
   concurrent job serialization, and no stale abort after releasing the lease.
3. Four native refs and stitched layouts retain all input content/order; Gallery
   FileData schema correct; zero/invalid counts, skinny images and bad input fail
   clearly. Add tests for currently untested `forge_reference.js` and session lock.
4. Anima preprocessing/mask semantics, proper alias/catalog discovery, and no
   accidental Anima reference/Edit LoRA in inpaint flow.
5. PiD4x outputs chosen over originals; ordinary disabled payloads unchanged;
   native Extras never receives PiD; postpass restores model on all outcomes.
6. Enhancer all/each counts, exact original LoRA/trigger syntax retention,
   style overrides, shared LLM serialization/unload, batch cancellation/metadata.
7. Live Gradio tests: Qwen denoise vs reference, MOSS edit LoRA, Anima edit LoRA,
   Krea general/identity as feasible, two/four references, Anima masked inpaint,
   SDXL integrated PiD and non-SDXL RGB PiD postpass. Inspect actual images, not
   merely HTTP200 or dimensions. Keep modest resolutions/steps for smoke tests,
   but adequate settings for judging edit/mask/upscale behavior.

Restore saved runtime settings after tests. Update user docs with commands,
reference order/layout, PiD fixed4x/limits, and enhancer all/each behavior. Report
observed tests, remaining real limitations and restart/re-registration steps.
Do not claim deployment or command registration occurred.

## Primary technical references

- [Forge ImageStitch implementation](G:/AIStuff/sd-webui-forge-neo/extensions-builtin/sd_forge_image_stitch/scripts/image_stitch.py)
- [Forge PiD implementation](G:/AIStuff/sd-webui-forge-neo/extensions-builtin/sd_forge_pid/scripts/pid.py)
- [NVIDIA PiD](https://huggingface.co/nvidia/PiD)
- [PiD checkpoint variants](https://huggingface.co/Comfy-Org/PixelDiT)
- [Anima006 author workflow](https://huggingface.co/hanzogak/Anima-LLLite-Inpainting/blob/main/006workflow.json)
- [MOSS edit author](https://huggingface.co/chinoll/Moss-Image-Edit)
- [MOSS adapter packaging/conditioning](https://huggingface.co/Comfy-Org/MOSS-Image/commit/3e54c0f1c07e42619d1711d81f93782c7f78e8d1)
- [Krea2 edit author implementation](https://github.com/lbouaraba/comfyui-krea2edit)

## Suggested instruction to the next OpenCode agent

> Read docs/plans/forge-image-workflows-handoff.md and the referenced worker task
> files. First identify and wait for existing OpenCode workers on owned files;
> preserve their changes. Review and finish phases1–7, using the agreed helper
> interfaces and Gradio generation. Do not create Codex subagents, change
> Discord.js, expose secrets, commit, register Discord commands, or deploy. Run
> targeted tests and authorized local service checks, restore runtime settings,
> and report evidence plus any unresolved limitations.
