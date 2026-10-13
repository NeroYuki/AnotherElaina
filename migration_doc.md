# Migration Note — Pointing Consumers at the Orchestrator Proxy

> Applies to: **AnotherElaina** (`E:\dev\AnotherElaina`) and any other consumer
> of the AI services.
> Proxy: **http://127.0.0.1:11230** (or the LAN IP if remote).

## TL;DR

**For HTTP-only consumers:** change the base URL from the service port to the
proxy port, and add the `X-AI-Service` header (or use a path prefix).

**For AnotherElaina specifically:** it's NOT a simple port change. It uses
**WebSockets** (comfyui `/ws`) which the proxy does NOT support yet (Phase 7),
and it has **hardcoded server addresses** in multiple files. For accurate VRAM
admission, generation requests also need the Phase 4.1 workload contract in
Section 7. See below.

---

## 1. What the proxy supports (Phase 2)

| Feature | Status |
|---|---|
| HTTP GET/POST/PUT/PATCH/DELETE passthrough | ✅ |
| SSE streaming (`text/event-stream`) | ✅ |
| `X-AI-Service` header routing | ✅ |
| Path-prefix routing (`/comfyui/...`, `/lmstudio/...`) | ✅ |
| Request logging | ✅ |
| **WebSocket proxying** (`/ws`) | ❌ **NOT YET** (Phase 7) |
| **Cancel propagation** (client disconnect cancels upstream) | ❌ NOT YET |

---

## 2. General consumer changes (HTTP-only)

### Option A: `X-AI-Service` header (recommended)

Point the base URL at the proxy and add the header:

```js
// Before
const url = 'http://192.168.1.2:8188/prompt';

// After
const url = 'http://127.0.0.1:11230/prompt';
const headers = { 'X-AI-Service': 'comfyui', 'Content-Type': 'application/json' };
```

### Option B: Path prefix

```js
// Before
const url = 'http://192.168.1.2:8188/prompt';

// After
const url = 'http://127.0.0.1:11230/comfyui/prompt';
```

### Service names for the header

| Service | `X-AI-Service` value | Path prefix |
|---|---|---|
| comfyui | `comfyui` | `/comfyui/...` |
| sdwebui-forge-neo | `sdwebui-forge-neo` | `/sdapi/...` (NOT a prefix — see note) |
| audiomuse | `audiomuse` | `/audiomuse/...` |
| mapperatorinator | `mapperatorinator` | `/mapperatorinator/...` |
| lmstudio | `lmstudio` | `/lmstudio/...` |

> **⚠️ sdwebui path prefix caveat:** the proxy's prefix map uses the service
> name (`/sdwebui-forge-neo/...`), NOT `/sdapi/...`. The `/sdapi/...` paths are
> only reachable via the `X-AI-Service: sdwebui-forge-neo` header. If you want
> `/sdapi/...` to route to sdwebui by prefix, that needs a config addition
> (custom prefix mapping) — not yet implemented.

---

## 3. AnotherElaina-specific migration

AnotherElaina is the main consumer. It has **multiple hardcoded server
addresses** and uses **WebSockets**. Here's the full inventory:

### 3.1 Files with hardcoded server addresses

| File | Current address | Service | Change needed |
|---|---|---|---|
| `utils/ai_server_config.js` | `server_pool[0].url` = `http://192.168.1.2:7860` (lan) / `http://192.168.196.142:7860` (non-lan) | sdwebui | → proxy + header |
| `utils/comfy_client.js` | `SERVER_ENDPOINT` = `192.168.1.2:8188` / `192.168.196.142:8188` | comfyui | → proxy + header (HTTP) + **WS caveat** |
| `utils/forge_api_execute.js` | `server_pool[0].url` | sdwebui | → proxy + header |
| `utils/model_change.js` | `server_pool[0].url` | sdwebui | → proxy + header |
| `utils/controlnet_execute.js` | `server_pool[server_index].url` | sdwebui | → proxy + header |
| `utils/adetailer_execute.js` | `server_pool[server_index].url` | sdwebui | → proxy + header |
| `utils/segment_execute.js` | `server_pool[0].url` | sdwebui | → proxy + header |
| `utils/load_discord_img.js` | `worker_endpoint` param | sdwebui | → proxy + header |
| `commands/osu_mapperatorinator.js` | `http://192.168.1.2:7050` / `...142:7050` | mapperatorinator | → proxy + header |
| `commands/osu_mai_mod.js` | `http://192.168.1.2:7051` / `...142:7051` | mapperatorinator (alt) | → proxy + header |
| `commands/osu_mai_mod.js` | `http://192.168.1.2:7052` | mapset_verifier | **NOT proxied** (not in config) |

### 3.2 The WebSocket problem (comfyui)

`utils/comfy_client.js` connects to:
```js
new ws(`ws://${this.SERVER_ENDPOINT}/ws?clientId=${this.clientId}`)
```

**The proxy does NOT proxy WebSockets yet.** So comfyui's `/ws` must either:
1. **Stay direct** — point `SERVER_ENDPOINT` at comfyui directly
   (`192.168.1.2:8188`) for the WS, and use the proxy only for HTTP
   (`/prompt`, `/view`, `/api/free`, `/api/upload/image`). This is the
   **recommended interim** approach.
2. Wait for Phase 7 (WS proxying) — then everything goes through the proxy.

> **Why this matters:** comfyui's progress/execution events come over the WS.
> If you route the WS through the proxy before it's supported, generation
> progress breaks.

### 3.3 The gradio `/run/predict` flow (sdwebui)

AnotherElaina's `wd_*` commands use gradio's `/run/predict/` with hardcoded
`fn_index` values. The proxy passes these through **transparently** (it's a
generic reverse proxy), so **no change to the fn_index logic** — only the URL.

The gradio flow uses these endpoints (all HTTP, all proxied fine):
- `POST /run/predict/` — generation + model change
- `POST /upload?upload_id=<session_hash>` — file upload
- `GET /file=<path>` — file serving
- `GET /internal/progress` — progress polling
- `GET /sdapi/v1/memory`, `/sdapi/v1/progress` — stats

### 3.4 The `server_pool` structure

`utils/ai_server_config.js` has a `server_pool` array with `url` per server.
The cleanest change: **add the proxy as the URL** and keep the `X-AI-Service`
header in the request builders. But since `server_pool[0]` is used for BOTH
sdwebui AND (via `server_pool[0].url`) other things, you'd need to:

1. Change `server_pool[0].url` to `http://127.0.0.1:11230`
2. Add `X-AI-Service: sdwebui-forge-neo` to every request that uses
   `server_pool[0].url` (in `wd_*` commands, `model_change.js`,
   `controlnet_execute.js`, `adetailer_execute.js`, `segment_execute.js`,
   `forge_api_execute.js`, `load_discord_img.js`).

> **⚠️ This is the fragile part.** `server_pool[0].url` is used in ~10 files.
> A safer approach: add a helper that wraps the URL + header, e.g.:
> ```js
> const PROXY = 'http://127.0.0.1:11230';
> const SD_HEADERS = { 'X-AI-Service': 'sdwebui-forge-neo' };
> // then: fetch(`${PROXY}/run/predict/`, { headers: SD_HEADERS, ... })
> ```

---

## 4. Recommended migration order

1. **Test the proxy** with curl first (see `docs/phase2-proxy.md`).
2. **LM Studio** (if any consumer uses it): simplest — just change the base
   URL to `http://127.0.0.1:11230` + `X-AI-Service: lmstudio`. OpenAI-compat
   means most clients accept a base URL override.
3. **comfyui HTTP** (via ComfyClient): change `SERVER_ENDPOINT` to the proxy
   for HTTP calls, keep WS direct (interim).
4. **sdwebui gradio** (via AnotherElaina `wd_*`): change `server_pool[0].url`
   to the proxy + add header everywhere.
5. **mapperatorinator / audiomuse**: change base URL + header.
6. **After Phase 7 (WS proxying)**: move comfyui's WS through the proxy too.

---

## 5. What does NOT need changing

- **The `fn_index` values** in `ai_server_config.js` — proxy passes through.
- **The `session_hash` flow** — proxy preserves query strings and bodies.
- **The `cached_model` LRU logic** in `model_change.js` — client-side only.
- **The `is_online` heartbeat** in `ai_server_config.js` — it pings `server_pool[i].url`; if that's the proxy, it'll report the proxy's health (which is fine — the proxy 503s dead services).

---

## 6. Open questions / caveats

- **`osu_mai_mod.js` port 7051** — this is a *different* mapperatorinator
  instance (port 7051, not 7050). It's not in the orchestrator config. Either
  add it or leave it direct.
- **`osu_mai_mod.js` port 7052 (mapset_verifier)** — not an AI service, not
  proxied. Leave direct.
- **LAN access** — if consumers run on another machine, the proxy must bind to
  `0.0.0.0` (config `bind_host`) and the LAN IP must be used instead of
  `127.0.0.1`. Currently bound to `127.0.0.1` (local-only).
- **Auth** — the proxy has no auth yet. If exposed to LAN, add the token
  (config `auth_token`) — planned for Phase 6.

---

## 7. Phase 4.1 — VRAM workload contract

### 7.1 Why AnotherElaina must provide metadata

AnotherElaina knows the generation intent before Forge receives an opaque
Gradio `data[]` array and before ComfyUI receives a mutated workflow. The
orchestrator cannot reliably reconstruct all of the following afterward:

- model family and selected checkpoint/support models;
- width, height, batch count/size, and video frame count;
- base, hires, VAE, ADetailer, upscale, interpolation, and video stages;
- tiled VAE, ControlNet, SeedVR2, TeaCache, and other peak-affecting flags; and
- which models execute sequentially instead of simultaneously.

Every generation or explicit model-load request must therefore include a
versioned, content-free workload manifest. Prompts, images, Discord IDs,
usernames, and other user content are prohibited from the manifest.

### 7.2 Wire format

```http
X-AI-Job-ID: <UUID>
X-AI-Workload: <base64url-encoded compact JSON, without padding>
```

`X-AI-Service` remains unchanged. All three headers are proxy metadata and are
stripped before forwarding to Forge/ComfyUI. The decoded workload is limited to
4096 bytes.

Schema v1:

```json
{
  "schema_version": 1,
  "task_kind": "txt2img",
  "model": {
    "checkpoint": "noobaixl_mdnt_vpred_v1.safetensors",
    "family": "sdxl",
    "support_models": []
  },
  "shape": {
    "width": 1080,
    "height": 1368,
    "batch_size": 1,
    "batch_count": 1,
    "frames": null
  },
  "stages": [
    {"kind": "base", "width": 1080, "height": 1368, "batch_size": 1}
  ],
  "features": {
    "tiled_vae": false,
    "controlnet_count": 0,
    "adetailer": false,
    "seedvr2": false,
    "upscaler": null,
    "teacache": false
  },
  "workflow_hash": null
}
```

Required fields are `schema_version`, `task_kind`, `model.family`, `shape`, and
`stages`. Unknown optional fields are allowed so the contract can evolve.

Initial `task_kind` values are `txt2img`, `img2img`, `inpaint`, `outpaint`,
`upscale`, `txt2video`, `img2video`, `image2model`, `model_change`, and `other`.

`stages` represents peak-producing phases. A hires request, for example, has a
base stage and a hires stage with its scaled dimensions and effective batch.
Video stages additionally carry `frames` where known.

### 7.3 Implementation shape

Add `utils/orchestrator_workload.js` as the only owner of:

- UUID creation (`crypto.randomUUID()`);
- schema validation and normalization;
- compact JSON + base64url encoding;
- the 4096-byte decoded-size check;
- safe header creation; and
- stable workflow-template hashing without prompts, seeds, upload filenames,
  or other volatile/user values.

Suggested public surface:

```js
createJobId()
normalizeWorkload(manifest)
encodeWorkload(manifest)
workloadHeaders(service, manifest, extraHeaders = {})
hashWorkflowTemplate(workflow)
```

Prefer new semantic request builders that produce an envelope:

```js
{
  data,       // existing Gradio array or ComfyUI workflow
  jobId,
  workload,   // normalized schema-v1 object
  headers     // service + job + encoded workload headers
}
```

Do not teach the orchestrator the positional layout of `data[]`. During
migration, existing `get_data_body()` and `get_data_body_img2img()` may remain
as compatibility wrappers, but the semantic inputs used to build the array and
the workload manifest must come from the same object to prevent drift.

### 7.4 Forge coverage

Migrate generation calls in this order:

1. `commands/wd_create.js` and `commands/wd_create_adv.js`
2. `commands/wd_img2img.js` and `commands/wd_img2img_adv.js`
3. `commands/wd_inpaint.js`
4. `commands/wd_upscale.js`

The Forge manifest must be built before `get_data_body()`/
`get_data_body_img2img()` converts semantic values into `data[]`. Attach the
headers only to `/run/predict/` generation and explicit model-change requests.
Upload, file, progress, preview, health, and interrupt calls do not need a
workload manifest.

Forge-specific fields include:

- active checkpoint and architecture family;
- resolved hires checkpoint/support models;
- base and hires dimensions;
- batch count and batch size;
- img2img/inpaint mode and input dimensions when known;
- tiled VAE, ControlNet count, ADetailer, SeedVR2, upscaler, and TeaCache; and
- ordered base/hires/ADetailer/VAE/upscale stages.

### 7.5 ComfyUI coverage

Migrate submission through `utils/comfy_client.js`, with manifests constructed
by the owning command before `sendPrompt()`:

1. Flux Kontext and Flux fill/outpaint paths in `wd_img2img*.js`
2. `commands/wd_txt2vid.js`
3. `commands/wd_img2vid.js`
4. `commands/wd_vid_upscale.js`
5. `commands/wd_img2model.js`

Change `sendPrompt(workflow, callback)` compatibly to accept an optional third
argument:

```js
sendPrompt(workflow, callback, { jobId, workload })
```

The method adds workload headers only to the HTTP `/prompt` request. The direct
ComfyUI WebSocket remains unchanged; the orchestrator correlates its job ID to
the `prompt_id` returned by `/prompt`.

Use a stable hash of the unmodified workflow template/topology. Do not hash a
workflow after inserting prompt text, seed, uploaded-image filename, or other
per-user values.

### 7.6 Required cleanup before collecting labels

Both Flux Kontext implementations currently overwrite node 30's width with
`data.height`:

```js
workflow["30"]["inputs"]["height"] = workflow["30"]["inputs"]["width"] = data.height
```

Correct this in `commands/wd_img2img.js` and
`commands/wd_img2img_adv.js` before Phase 4.1 data collection. Otherwise the
manifest and executed workflow disagree, poisoning predictor labels.

### 7.7 Tests and completion criteria

Add unit/fixture coverage for:

- base SD/SDXL and newer-family txt2img;
- hires with same and different checkpoint/support models;
- img2img, inpaint, outpaint, ControlNet, ADetailer, SeedVR2, and upscale;
- each ComfyUI video/image workflow family;
- base64url round-trip, deterministic normalization, and oversize rejection;
- absence of prompts, user identity, seeds, and upload filenames;
- `X-AI-Service`, `X-AI-Job-ID`, and `X-AI-Workload` on generation requests;
- absence of workload headers on upload/progress/file/health requests; and
- compatibility of existing direct WebSocket progress handling.

AnotherElaina's Phase 4.1 work is complete when every supported generation
entry point emits a valid manifest derived from the same semantic object as the
executed request, and the orchestrator can correlate that job through service
completion without parsing Forge's positional array.

The orchestrator's source-of-truth design is
`G:\bootstrap_scripts\gpu-orchestrator\docs\phase4.1-vram-admission-redesign.md`.
