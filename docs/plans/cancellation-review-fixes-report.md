# Backend cancellation and review fixes

Verified 2026-11-04 (Asia/Bangkok). Changes are uncommitted; no Discord
registration or messages, bot restart, or dependency upgrades were performed.

## Behaviour

- Forge create/basic/advanced and the shared img2img/ref2img/inpaint runner use
  one cancellation controller. Interrupts retain Gradio `/run/predict/`, the
  current `fn_index`, JSON payloads, and explicit instance affinity.
- Pending cancellation waits for proof that the submitted task is active.
  Unknown/failed ownership probes never issue a global interrupt. In-flight
  interrupts settle before task ownership or the Forge lease releases.
- Cancellation skips remaining enhanced batch requests and PiD passes, removes
  controls, suppresses result delivery, and reports backend interruption errors.
- ComfyUI image fallbacks, interrogation, video generation and video processing
  have owner-filtered Cancel controls. The shared Promise runner also supports
  `AbortSignal` cancellation while retaining the legacy callback API.
- Comfy cancellation uses the submitted prompt ID and returned instance with
  `/api/jobs/{prompt_id}/cancel`. It removes the selected queued workflow or
  interrupts that workflow. Backend terminal/queue evidence is required before
  reporting cancellation and releasing the orchestrator reservation.
- Completed/stale buttons cannot interrupt later requests. Model loading or
  another uninterruptible backend operation may delay cancellation confirmation.

## Review findings resolved

1. Cancellation starts before Discord acknowledgement and pending interrupts
   drain before Forge lease release; delayed acknowledgement has regressions.
2. Coupler layout conversion preserves the original LoRA, wildcard, profile and
   control tokens while sanitizing generated layout captions.
3. PiD checkpoint restoration failures propagate to the command, including
   sampling and restoration causes when both fail.
4. Layout sessions abort pending input waits, guard asynchronous continuations,
   and drain active actions. Layout inference/unload uses the shared LLM queue,
   without keeping the queue locked during human input waits.

## Local proxy changes

`G:\bootstrap_scripts\gpu-orchestrator\backend\proxy.py` distinguishes safe,
explicitly placed cancellation/status/file requests from new generation work.
The Forge service in `config/config.yaml` has `control_fn_indexes: [46]`.
Only the allowlisted callback with integer index, empty input array, nonempty
session hash and explicit instance bypasses generation admission. Normal model
changes and generation remain protected. Refresh this allowlist if a later
Forge update moves the interrupt callback.

The idle orchestrator was restarted to load these changes. Forge and ComfyUI
processes were not restarted. Protection remains Observe with auto-unload on.
The proxy also has `backend/test_proxy_forge_control.py` and
`backend/test_cancel_control_reads.py` regression suites.

## Verification

- Full JavaScript suites: 136 Forge, 38 image, 45 media tests passed.
- Three additional targeted regressions passed after final review: cancelling
  enhanced batches through both create commands, and delayed Discord
  acknowledgement in the Comfy image runner. Total: 222 JavaScript tests.
- Full local proxy suite: 69 tests passed.
- Syntax checks and `git diff --check` passed.
- Live Forge: cancelled a 50-step MOSS request after sampling began; the backend
  stopped and a subsequent two-step request completed.
- Live Comfy: cancelled a queued prompt while preserving the running prompt,
  then cancelled the running prompt. Both cancellation outcomes were confirmed,
  the queue emptied, and a subsequent small workflow completed.
- Both Forge instances' checkpoints, companion modules and reference settings
  match the saved pre-test snapshot. No orchestrator leases remain.

Ignored local evidence: `temp/cancel-forge-live-report.json`,
`temp/cancel-comfy-live-report.json`, `temp/cancel-runtime-before.json`,
`temp/cancel-final-*-tests.log`, `temp/cancel-final-command-regressions.log`,
and `temp/cancel-proxy-tests-unrestricted.log`.

Reload/restart the bot process to activate its updated code. Slash-command
schemas did not change in this task, so these cancellation changes do not need
command re-registration.
