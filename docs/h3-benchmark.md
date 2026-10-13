# H3 speed measurements — 13 October 2026

Measured locally on the RTX 3090 Ti (24 GB), Windows, ComfyUI 0.37.0,
PyTorch 2.12.1+cu130, Comfy Kitchen 0.2.36, and aimdo 0.5.5. The RTX 3060
was not used for video sampling. The orchestrator remained in Observe mode
with Auto-unload enabled. No models or Python packages were downloaded.

All short outputs contain 124 frames (5.1667 seconds) at 24 fps with audio.
Times include submission, model preparation, conditioning, sampling, VAE
decode, encoding, and up to two seconds of completion polling. They exclude
prompt enrichment, input upload and output download. Warm runs reuse the text
conditioning, but use different seeds so sampling and saving are executed again.
These are execution/speed measurements, not a comparison of visual quality.

| Workflow | Canvas → output | Steps | Wall time | Sampler stage |
| --- | --- | ---: | ---: | ---: |
| Turbo text, cold | 768×448 | 8 | 61.93 s | 38.55 s |
| Turbo text, warm 1 | 768×448 | 8 | 47.30 s | 35.53 s |
| Turbo text, warm 2 | 768×448 | 8 | 46.71 s | 35.85 s |
| Turbo text, PyTorch attention | 768×448 | 8 | 65.19 s | 49.13 s |
| Turbo image | 768×448 | 8 | 55.33 s | 40.31 s |
| Turbo text, Standard | 1024×768 | 8 | 139.85 s | 115.62 s |
| Turbo text, Standard + RTX 2× | 1024×768 → 2048×1536 | 8 | 141.56 s | 113.86 s |
| Hybrid image reference | 768×448 | 20 | 119.00 s | 99.26 s |
| Dedicated Ref2VA image reference | 768×448 | 20 | 110.49 s | 99.47 s |

Kitchen's two warm Fast runs averaged **47.01 s**, versus **65.19 s** for
the single PyTorch comparison: about **28% less wall time**. The sampler stage
averaged 35.69 s versus 49.13 s, about 27% less time. This is one local
comparison, not a claim about every resolution or prompt. RTX processing itself
took 1.56 s in the Standard upscale run; encoding took 8.35 s. The two Standard
runs had different seeds and different cache states, so their wall-time
difference should not be treated as an isolated upscale cost.

Peak total GPU usage, sampled once per second with `nvidia-smi`, ranged from
20,295 to 23,781 MiB. This includes model residency, caches and other desktop
GPU usage; it is not a PyTorch allocation measurement.

The bot graphs explicitly patch the H3 model with
`ModelAttentionBackend: comfy kitchen attention`. Local source verification
confirmed that this override takes precedence over both the server default
and checkpoint-preferred attention. A standalone CUDA test of
`comfy_kitchen.int8_attention` produced finite BF16 output on the 3090 Ti;
capability checks also passed on the 3060. SageAttention is already installed,
but these runs use Kitchen INT8. Kitchen and Sage are alternatives for one
attention operation. Kitchen weight/fused operations may still coexist with
Sage attention in other workflows.

Raw measurements, output paths, stage timings, seeds and frame checks are in
[the short-run JSON](../resources/benchmarks/h3-2026-10-13-short.json).
Reproduce the same matrix when ComfyUI is idle:

```powershell
$env:BOT_ENV = 'lan'
node scripts/benchmark_h3.cjs short
```

The script targets `comfyui-gpu0` through the GPU orchestrator, saves outputs
locally, and never sends Discord messages. It requires the local image fixture
`temp/h3-reference.png` produced by `node scripts/h3_smoke.cjs validate`.
The first run is cold only if ComfyUI was just restarted or its models were
unloaded before running the script.

Long-video support uses the public nodes from
[MiniMax H3 Extender](https://github.com/tritant/ComfyUI_MiniMax_H3_Extender),
version 3.0.12, pinned at `60efaf15c589d6671ef43e7c0946913a54221865`.
Each native sampler receives at most 124 frames. Later clips include 22 frames
of motion/audio context, trimmed once during disk assembly. The full output
duration remains on H3's frame grid. Streaming RTX upscaling preserves the
assembled audio while processing one decoded frame at a time.

Gemma 12B on the 3060 generated four coordinated scripts for the 16-second
hybrid test in **19.526 s**, including model preparation and verified unload.
This is separate from the ComfyUI render time.

The **20.0417-second Turbo test passed** with 481 frames at 24 fps,
1536×896 after streaming RTX 2× upscaling, and synchronized audio
(20.042 s). It took **429.33 s (7 min 9 s)**: 201.36 s sampling across five
clips, 185.99 s in Extender final decode/assembly, and 28.31 s streaming
upscale. The stock Extender final node also generates seam-correction and
browser-preview caches; this overhead is included. Peak total GPU use was
23,815 MiB. The synthetic sample shows appearance drift across continuations
and the sphere sometimes leaves the frame, so this check demonstrates a working
long output rather than guaranteed subject consistency.

The **hybrid reference + both boundary guides** test passed at **16.5 seconds**:
396 frames at 24 fps, 768×448, and audio duration 16.5 s. Four clips at 20 steps
took **574.89 s (9 min 35 s)**, including 423.13 s sampling and 128.50 s final
decode/assembly. Peak total GPU use was 23,273 MiB. The opening and ending
frames match the supplied synthetic guide layout, and the orange subject's
appearance remains substantially more consistent in this sample.

Raw long-run timing and frame checks are in
[the extended-run JSON](../resources/benchmarks/h3-2026-10-13-extended.json).
Qwen 27B on the 3090 Ti also returned all four long-clip scripts and verified
its unload in **48.502 s**. That test used text only; the Gemma test included
three image previews, so these two rewrite timings are not a controlled LLM
speed comparison. The render timings above exclude both rewrites.

A subsequent short Turbo generation passed after the extender's motion-context
patches had run: 124 frames at 24 fps with synchronized audio, 62.695 s including
submission and completion polling after the Qwen handoff. A final local Forge
request then verified that Observe-mode Auto-unload reclaimed **18,400 MiB**
from idle ComfyUI before generation. ComfyUI finished with an empty queue and
the orchestrator with zero active leases. The final media test suite passed
all **29 tests**.

The 1–60-second options were published and read back in the existing global
and three test-guild command scopes. Use `custom_length:20` on `/wd_txt2vid`
(with any preset), or `length:20` on `/wd_img2vid` and `/wd_ref2vid`.
The bot process was not running locally; its next start/restart must load the
updated handlers. Saved extended templates are in ComfyUI's
`user/default/workflows/AnotherElaina_H3` folder.
