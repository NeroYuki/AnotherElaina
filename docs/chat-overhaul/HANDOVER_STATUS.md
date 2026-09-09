# Chat Overhaul Handover Status

Updated: 2026-09-09

## Current State

The legacy generation handler has been replaced by the local-only `chat/` subsystem. `Bot.js` initializes Mongo and chat before Discord login, routes messages and persistent controls through the conversation service, and invalidates derivatives on Discord message edit/delete.

Implemented:

- Local Gemma/Qwen model profiles, robust SSE, thinking controls, context/quantization-aware orchestrator admission headers, cancellation/retry, native tools, and tool-result continuation.
- Stable Discord identity, IC/OOC segments, reply/image provenance, continuity queues, fenced leases, durable turns, bounded context, and long-response delivery.
- Persistent scenes, characters, directional relationships/promises, evidence-backed memory, correction lineage, episodes, lore, retention, deletion epochs, and reconciliation jobs.
- Lexical/E5/Qdrant retrieval with ACL revalidation; SearXNG search and SSRF-safe page fetching with application-rendered citations.
- `/scene`, `/memory`, `/lore`, local-only `/chat_config`, scoped legacy clear, and persistent response controls.
- Deployment assets, setup/migration/smoke/evaluation scripts, 30 replay fixtures, tests, and operator documentation.

## Verification Completed

- Mongo migration created and verified all chat collections/indexes.
- Pinned E5 revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78` produced a normalized 384-dimensional vector; runtime downloads are disabled.
- Local Gemma smoke passed and now asserts the post-admission context. The live service loaded the configured 16,384-token context with `UD-Q4_K_XL`; capability status also exposes a degraded flag if a loaded model is smaller than `CHAT_CONTEXT_TOKENS`.
- Docker-backed Qdrant and SearXNG are healthy. Strict local and subsystem smoke passed, including a real SearXNG query and the rebuilt Qdrant alias.
- Live lore ingestion/reindex and an ACL-scoped E5 semantic round-trip passed against Qdrant.
- A fake-Discord end-to-end turn passed against real Mongo, Gemma, E5/Qdrant, and the background job queue: scene creation, placeholder delivery, streamed edits, durable commit, selected scene head, and memory-extraction admission were verified without connecting to Discord.
- Replay completed 40/40 local transport runs, 81 samples, median 1,201 ms and p95 2,193 ms.
- Current deterministic result: 93 passing tests and three skipped opt-in live integration tests. With `CHAT_INTEGRATION=true`, all three live tests pass, for 96 total.
- Current-data routing is application-enforced for exchange rates, prices, weather, scores/schedules, officeholders, recent news, and explicit current/latest requests. The exact reported USD/JPY Discord prompt completed three consecutive integrated runs with a persisted web search and cited sources.
- Model-visible segment JSON was removed. Persona examples no longer teach response-side `OOC:` labels, and both streamed and final delivery remove leaked `IC:`/`OOC:` control labels.
- Response style is configurable as `compact` (default), `emoji`, or `expressive` through environment and `/chat_config`, with restart persistence. Compact/emoji responses have token and visible-word bounds while citation appendices remain intact. A live reproduction of the reported long-action pattern returned 33 words in compact mode and 22 words in emoji mode.
- Discord source URLs are always rendered inside `<...>`, including resolved inline citations and the source appendix, to suppress link-preview embed spam.
- Episode summaries no longer serialize raw Mongo records. They receive a compact canonical transcript under `CHAT_EPISODE_INPUT_TOKENS` and retry once at half that budget after a context-size rejection.
- A live synthetic reproduction with 12 oversized Mongo-like turn records compacted to 8,719 input bytes and completed a valid episode summary under the 16,384-token model context.
- Explicit local profiles are available for Gemma `UD-Q4_K_XL`, `unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M`, and gated `unsloth/Qwen3.8-Flash-Next-GGUF:UD-IQ3_XXS`.
- No Gemini/cloud inference path is referenced by the new runtime entry path.

## Release State

The local subsystem is operational and its automated release checks pass. Docker containers currently provide Qdrant on `192.168.1.2:6333` and SearXNG on `192.168.1.2:8088` under the source-restricted firewall rule described below.

The production topology uses a separate Linux bot host at current DHCP address `192.168.1.9`; MongoDB runs locally on that Linux host. Qdrant and SearXNG now bind only to the Windows Ethernet address at `192.168.1.2:6333` and `:8088`. A Private-profile Windows firewall rule permits those ports only from `192.168.1.9` and the service host itself, and Qdrant also requires a generated API key stored in ignored deployment/runtime environment files. The existing AI proxy at `192.168.1.2:11230` remains separately managed. `npm run chat:smoke:remote` rejects loopback remote-service endpoints while allowing Linux-local MongoDB.

Repeat the live gate with:

```powershell
$env:CHAT_INTEGRATION = 'true'
npm run test:chat:integration
npm run chat:smoke:local -- --strict
npm run chat:smoke:subsystem -- --strict
```

The Windows-side LAN bind, firewall scope, and full local integration suite pass. The Linux-origin remote smoke remains open because SSH authentication was unavailable to this session. The designated private Discord guild demo also remains open, including real channel/thread permission visibility and restart/deletion behavior. Do not use a production guild for that gate.

## Remaining Risks

- Regeneration is safely replaced before retraction, but is stored as a selected child/control turn rather than a true sibling branch.
- Validate fail-closed cross-channel audience checks with real Discord channel/thread permissions in the designated guild.
- Exercise deletion during live inference/indexing against Mongo and Qdrant; scoped deletion now fences commits by incrementing the continuity epoch and rebuilding surviving vectors.
- Ambiguous Discord sends still require the bounded operator reconciliation documented in `OPERATOR_GUIDE.md`.
- Direct replay does not execute persistence/controls. Raw model outputs failed some synthetic authority/deletion expectations; only integrated replay proves the application guards end to end.
- Health metadata exists, but full exported operational latency/backlog metrics remain incomplete.
- `npm audit` reports transitive advisories in Transformers/ONNX and pre-existing dependencies, including entries without upstream fixes.

## Next Steps

1. Copy the runtime endpoints and Qdrant key to the Linux deployment environment and run `npm run chat:smoke:remote` there. Update the `/32` firewall source when the Linux DHCP lease changes, or reserve `192.168.1.9` in DHCP.
2. Register commands only in a development guild after checking `config.json` guild IDs.
3. Run the private-guild restart, promise, correction, RAG, search, outage, and deletion demo.
4. Record the host and guild evidence in `IMPLEMENTATION_REPORT.md`.
5. Do not broaden rollout until the `OPERATOR_GUIDE.md` release gates pass.

The worktree was already dirty. Unrelated user files remain untouched; test-generated changes to `temp/rate_limit_data.json` were cleaned after verification. `data/chat-models/` is intentionally ignored.
