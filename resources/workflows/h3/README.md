# MiniMax H3 workflows

These API-format graphs import directly into the installed ComfyUI frontend
(drag JSON onto the canvas or use **Open**). ComfyUI creates and arranges editable
nodes. Select/upload your files in the load nodes before queuing.

| File | Model and default sampling |
| --- | --- |
| `text-to-video.json` | FL2VA INT8 ConvRot + FL2V 768p Turbo, Euler/simple, 8 steps, shifts 6/3 |
| `image-to-video.json` | Same, with an opening frame; connect `last_frame` for an ending frame |
| `reference-image-to-video.json` | Ref2VA INT8 ConvRot, res_multistep/simple, 20 steps, image reference |
| `reference-video-to-video.json` | Ref2VA, 20 steps, video and optional soundtrack reference |
| `reference-audio-to-video.json` | Ref2VA, 20 steps, standalone audio reference |
| `hybrid-frames-and-reference.json` | Hybrid, 20 steps, reference plus opening and ending image guides |
| `extended-text-to-video.json` | 20-second FL2VA Turbo chain with latent motion/audio context |
| `extended-image-to-video.json` | Same, with opening and ending frame guides |
| `extended-hybrid-frames-and-reference.json` | 20-second hybrid chain with reference and both boundary guides |
| `extended-reference-audio-to-video.json` | 20-second Ref2VA chain with timeline audio windows |

All use native Kitchen INT8 dense attention, matched reference sizing, tiled
video VAE decoding, 24 fps, synchronized audio, and MP4/H.264 output. No Spectrum,
EasyCache, sparse attention, or FastH3 is stacked onto Turbo. Desktop exports
omit RTX upscaling to make native render cost clear; the bot's existing
`do_upscale` option still defaults to 2× RTX super resolution.

At a short edge below 704 pixels the bot selects the installed non-768p Turbo
adapter and its trained 12/3 shifts. At 704 and above it uses the 768p adapter
and 6/3 shifts. Both use strength 1.0 and Euler/simple at 8 steps. `no_optimize`
uses the undistilled FL2VA model with 20 steps unless `steps` overrides it.
`/wd_ref2vid` uses the dedicated Ref2VA model. Optional `ref` inputs on the
text/image commands use hybrid base sampling. The installed FL2V Turbo
adapters are not reference adapters. Short workflows use the existing nodes.
Extended workflows require the installed MiniMax H3 Extender 3.0.12; see
[installation and duration options](../../../docs/media-commands.md).

The extended graphs use public Extender motion-context, disk-join and final-decode
nodes so native reference conditioning and boundary frame guides remain editable.
Five-second sampling windows overlap by 22 frames, removed once during assembly.
Each clip has its own prompt node. The bot enriches these prompts as a coordinated
sequence; the desktop examples repeat the sample prompt. Clip caches are stored
under the extender's `custom_nodes/ComfyUI_MiniMax_H3_Extender/cache` directory. Each bot
generation gets a separate cache identity; caches can be removed when ComfyUI is
idle after saving the final output. Model residency remains owned by the GPU
orchestrator.

For video references, connect the VHS audio output only when the source has a
soundtrack; disconnect `ref_video_audios.ref_video_audio_0` for silent videos.
Set VHS to 24 fps and format `None`. Bot inputs are normalized and capped at
15 seconds or the output duration, whichever is shorter. Use native reference
tags `<Picture 1>`, `<Video 1>`, and `<Audio 1>` in prompts. Video soundtracks
receive `<Audio 1>`; opening/ending guides are separate from these IDs.

The JSON files contain no LLM service calls. Discord prompt enrichment runs
before the graph and verifies its LLM is unloaded before submission. ComfyUI
model residency stays under the GPU orchestrator's control.

Regenerate these exports after builder changes:

```powershell
node scripts/export_h3_workflows.cjs
```

Sampling settings follow the
[LightX2V model specifications](https://github.com/ModelTC/Minimax-H3-Turbo#1-model-specs)
and [ComfyUI instructions](https://github.com/ModelTC/Minimax-H3-Turbo/blob/main/COMFYUI_SETUP_AND_INFERENCE.md).
The [hybrid model](https://huggingface.co/smhfacct/Minimax-H3-fl2va-ref2va-hybrid-models)
is an experimental merge; reference and visual fidelity depend on the scene.
