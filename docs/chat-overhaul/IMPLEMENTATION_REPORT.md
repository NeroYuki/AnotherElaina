# Chat Overhaul Implementation Report

Date: 2026-09-09

## Delivered Mapping

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Local-only generation | `chat/model_profiles.js`, `chat/config.js`, `chat/providers/local_openai.js`, safe legacy mapping in `commands/operating/chat_config.js` | Model-profile/provider tests and context-verifying live Gemma smoke |
| Mention/reply identity and ordering | `chat/discord/ingest.js`, `chat/conversation/{service,queue}.js` | Ingest, queue, lease, duplicate, stream tests |
| Durable scenes and controls | `chat/persistence/`, `chat/conversation/scene_controls.js`, `commands/chat/` | Live Mongo migration plus persistence/control tests |
| Persona and player agency | `chat/persona/`, deterministic cross-player retcon guard in `conversation/service.js` | Persona and conversation tests |
| Evidence-backed memory | `chat/memory/`, extraction jobs and projections in `chat/index.js` | Schema, evidence, deletion-race, correction, and bounded-summary tests |
| Semantic and lexical RAG | `chat/retrieval/`, local pinned E5 setup, Qdrant adapter | E5 artifact verified locally; offline ACL/rank/reindex tests |
| Tools and public search | `chat/tools/`, `chat/web/`, SearXNG deployment | Native fragmented tool tests, SSRF and citation tests |
| Streaming and Discord delivery | `chat/providers/sse.js`, `chat/discord/respond.js`, delta callbacks in `chat/conversation/turn_state.js` | Unicode/EOF/error, throttled live edits, persisted stream preference, and long-message tests |
| Reset, deletion, retention | `chat/memory/forget.js`, edit/delete invalidation, retention/reconciliation jobs | Deletion isolation/race tests; live Mongo indexes |
| Operations | `.env.chat.example`, `deploy/chat/`, `scripts/chat/`, operator guide | Compose validation, migration, smoke and replay commands |

## Evaluation Results

- Deterministic suite: 93 passing tests plus three opt-in live integration tests, 96 total when enabled.
- Local embedding: `Xenova/multilingual-e5-small` at revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`, 384 dimensions, loaded from the local cache with runtime downloads disabled.
- Mongo: migration succeeded and all chat collections/indexes were created.
- Local Gemma smoke: visible thinking-disabled response succeeded, and the post-admission service status confirmed the configured 16,384-token context and `UD-Q4_K_XL` variant.
- Docker-backed services: strict local and subsystem smoke passed. SearXNG returned real results, and Qdrant retained the verified rebuilt collection behind `chat_active`.
- Live integration: all three opt-in tests passed with `CHAT_INTEGRATION=true`: service reachability, ACL-scoped E5/Qdrant retrieval, and a complete synthetic Discord turn through scene creation, local generation, streamed/final delivery, Mongo commit, scene-head selection, and derivation-job admission.
- Reported current-data regression: the exact “how much a dollar is in Japanese yen” Discord prompt passed three consecutive integrated runs. Each run persisted `web_search`, returned current source-backed evidence, rendered citations, and emitted no `IC:`/`OOC:` label in streaming or final output. Current-data categories now receive deterministic application-level web-tool admission even if the model initially refuses or omits a tool call.
- Discord citations now render every allowed URL inside `<...>` to suppress embed previews. The live current-data integration asserts there are no unenclosed URLs.
- The episode summarizer now sends a bounded canonical transcript instead of full persistence documents and retries once at half-budget after a backend context rejection. Provider errors identify configured, loaded, and prompt token counts when available.
- A live 12-turn oversized-record reproduction compacted the summary payload to 8,719 bytes and returned a valid structured summary with the model loaded at 16,384 tokens.
- Qwen managed loading was verified through the real proxy after correcting the Unsloth API contract. The application sends `model=unsloth/Qwen3.8-27B-GGUF` and workload quantization `UD-Q4_K_M`; the orchestrator passes these as separate `model_path` and `gguf_variant` fields. Live status confirmed GPU 0, one parallel slot, and a 16,384-token context before the completion succeeded.
- Model configuration uses bare repository IDs plus separate GGUF variants for Gemma `UD-Q4_K_XL`, Qwen 3.8 27B `UD-Q4_K_M`, and resource-gated Flash-Next `UD-IQ3_XXS`, matching the Unsloth load API contract.
- Real-time response density: runtime styles now include `compact` (default), `emoji`, and `expressive`, persisted through `/chat_config`. Compact and emoji use lower generation/word bounds without truncating citations; emoji also converts recognized action-only prose into one reaction emoji. Against the reported flying-target/thermal-vision input, live Gemma produced a 33-word compact reply and a 22-word emoji reply.
- Replay: 40/40 direct local-provider transport runs passed, covering all 30 fixtures and three runs of each correction/deletion fixture; 81 samples, median 1,201 ms, p95 2,193 ms.
- Human-review caveat: the direct-provider harness deliberately does not execute persistence and controls. Its outputs demonstrated unsupported behavior in several synthetic deletion/authority scenarios; application validation and deterministic controls address those boundaries, but this is not a Discord end-to-end semantic pass.

## Remaining Environment Gate

Qdrant, SearXNG, Mongo, the pinned embedding, and local Gemma have now been exercised together. Repeat the automated live gate with:

```powershell
$env:CHAT_INTEGRATION = 'true'
npm run test:chat:integration
npm run chat:smoke:local -- --strict
npm run chat:smoke:subsystem -- --strict
```

The designated Discord restart/search/deletion demonstration remains a release gate because only Discord itself can prove the configured guild, channel, thread, and role visibility. It must not be run in a production guild. Register commands in the configured development guild, then follow `OPERATOR_GUIDE.md`.

Production runs the bot and MongoDB on a separate Linux machine, currently `192.168.1.9`. Qdrant and SearXNG are now published only on the Windows Ethernet address `192.168.1.3`, with a Private-profile firewall rule restricted to the Linux `/32` plus the service host itself. Qdrant API-key authentication is enabled and propagated through runtime config. The existing AI proxy remains separately managed and was reachable at `192.168.1.3:11230`. All Windows-origin strict and live integration checks pass after the rebind. Final remote verification must still run from Linux; this session could reach its SSH port but had no SSH credentials.
