# Chat Overhaul Handover Status

Updated: 2026-09-09

## Current State

The legacy generation handler has been replaced by the local-only `chat/` subsystem. `Bot.js` initializes Mongo and chat before Discord login, routes messages and persistent controls through the conversation service, and invalidates derivatives on Discord message edit/delete.

Implemented:

- Local Gemma generation, robust SSE, thinking controls, orchestrator admission headers, cancellation/retry, native tools, and tool-result continuation.
- Stable Discord identity, IC/OOC segments, reply/image provenance, continuity queues, fenced leases, durable turns, bounded context, and long-response delivery.
- Persistent scenes, characters, directional relationships/promises, evidence-backed memory, correction lineage, episodes, lore, retention, deletion epochs, and reconciliation jobs.
- Lexical/E5/Qdrant retrieval with ACL revalidation; SearXNG search and SSRF-safe page fetching with application-rendered citations.
- `/scene`, `/memory`, `/lore`, local-only `/chat_config`, scoped legacy clear, and persistent response controls.
- Deployment assets, setup/migration/smoke/evaluation scripts, 30 replay fixtures, tests, and operator documentation.

## Verification Completed

- Mongo migration created and verified all chat collections/indexes.
- Pinned E5 revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78` produced a normalized 384-dimensional vector; runtime downloads are disabled.
- Local Gemma smoke passed; live capability probe confirmed 8,192 context, vision, native tools, and optional reasoning.
- Docker-backed Qdrant and SearXNG are healthy. Strict local and subsystem smoke passed, including a real SearXNG query and the rebuilt Qdrant alias.
- Live lore ingestion/reindex and an ACL-scoped E5 semantic round-trip passed against Qdrant.
- A fake-Discord end-to-end turn passed against real Mongo, Gemma, E5/Qdrant, and the background job queue: scene creation, placeholder delivery, streamed edits, durable commit, selected scene head, and memory-extraction admission were verified without connecting to Discord.
- Replay completed 40/40 local transport runs, 81 samples, median 1,201 ms and p95 2,193 ms.
- Current deterministic result: 80 passing tests and three skipped opt-in live integration tests. With `CHAT_INTEGRATION=true`, all three live tests pass.
- No Gemini/cloud inference path is referenced by the new runtime entry path.

## Release State

The local subsystem is operational and its automated release checks pass. Docker containers currently provide Qdrant on `127.0.0.1:6333` and SearXNG on `127.0.0.1:8088`.

Repeat the live gate with:

```powershell
$env:CHAT_INTEGRATION = 'true'
npm run test:chat:integration
npm run chat:smoke:local -- --strict
npm run chat:smoke:subsystem -- --strict
```

The only environment-specific release gate still open is the designated private Discord guild demo, including real channel/thread permission visibility and restart/deletion behavior. Do not use a production guild for that gate.

## Remaining Risks

- Regeneration is safely replaced before retraction, but is stored as a selected child/control turn rather than a true sibling branch.
- Validate fail-closed cross-channel audience checks with real Discord channel/thread permissions in the designated guild.
- Exercise deletion during live inference/indexing against Mongo and Qdrant; scoped deletion now fences commits by incrementing the continuity epoch and rebuilding surviving vectors.
- Ambiguous Discord sends still require the bounded operator reconciliation documented in `OPERATOR_GUIDE.md`.
- Direct replay does not execute persistence/controls. Raw model outputs failed some synthetic authority/deletion expectations; only integrated replay proves the application guards end to end.
- Health metadata exists, but full exported operational latency/backlog metrics remain incomplete.
- `npm audit` reports transitive advisories in Transformers/ONNX and pre-existing dependencies, including entries without upstream fixes.

## Next Steps

1. Register commands only in a development guild after checking `config.json` guild IDs.
2. Run the private-guild restart, promise, correction, RAG, search, outage, and deletion demo.
3. Record the guild-specific evidence in `IMPLEMENTATION_REPORT.md`.
4. Do not broaden rollout until the `OPERATOR_GUIDE.md` release gates pass.

The worktree was already dirty. Unrelated user files and `temp/rate_limit_data.json` were not reverted. `data/chat-models/` is intentionally ignored.
