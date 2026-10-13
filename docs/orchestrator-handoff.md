# Idle service handoff in Observe mode

The previous proxy required protection mode `enforce` before running admission
cleanup. With `observe` and `auto_unload: true`, it logged insufficient VRAM
but still forwarded generation without unloading ComfyUI. The reported Forge
request was followed by dedicated VRAM usage reaching 99.2%.

The deployed fix keeps Observe mode and the persisted Auto-unload preference.
Before protected generation requests, it unloads verified idle competing
listeners on the selected physical GPU. The incoming service keeps its own
resident models. Read/status requests and Auto-unload being off do not trigger
a handoff. Busy or unverified listeners and unrelated GPUs are skipped.

Cleanup uses configured service endpoints, including ComfyUI's native `/free`
with `unload_models` and `free_memory`. No extension or model is required.
Without the optional ComfyUI residency adapter, release verification uses the
observed physical VRAM increase. An already empty service can therefore report
`no-observed-effect`; an HTTP 200 alone is not treated as a verified release.

Observe still allows requests that exceed estimated memory budgets. Cleanup
exclusion is mandatory while an unload runs, including all logical instances
sharing the same listener. The fix does not forcibly cancel active work.

Release verification refreshes physical GPU memory directly through the
existing NVML runtime instead of waiting for slow Windows process scans.
Older in-flight monitor polls cannot overwrite these newer VRAM readings.
This also updates the counters used when rechecking routing after cleanup.

The source changes are in the orchestrator's `backend/proxy.py`,
`backend/guards.py`, and `backend/monitor.py`, with
`backend/test_service_handoff.py` added. The initial source backup is at
`G:/bootstrap_scripts/gpu-orchestrator/backups/idle-handoff-20261013-083243`;
the subsequent verification update is backed up at
`G:/bootstrap_scripts/gpu-orchestrator/backups/idle-handoff-20261013-083900`.
The review diff is `resources/patches/orchestrator-idle-handoff.patch`.
The orchestrator was restarted without restarting managed AI services.

Verification: all 58 orchestrator checks passed, including eleven new handoff,
busy-runtime, shared-listener, cleanup cancellation, low-VRAM, and memory
freshness cases.

The live H3 → Forge handoff passed on 13 October 2026. H3 left GPU 0 with
823 MiB free. The orchestrator recorded `service-handoff` and verified
17,504 MiB (17.1 GiB) reclaimed from ComfyUI before forwarding the Forge
generation. The two-step 512×512 image completed successfully; the complete
request including cleanup took 8.55 seconds. Observe mode remained enabled.
The measured report is `temp/handoff-smoke.json`.

To repeat the live handoff check while the services are idle:

```powershell
node scripts/h3_smoke.cjs text
node scripts/handoff_smoke.cjs
```

The first command leaves H3 models resident. The second submits a local two-step
512×512 Forge request and requires a matching `service-handoff` eviction with
at least 1 GiB reclaimed. Outputs and the measured report remain in ignored
`temp/`; nothing is sent to Discord.
