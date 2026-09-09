# Implementation-agent handoff

Copy the following prompt into the implementation agent working in this repository:

---

Implement the complete Elaina conversation overhaul specified in `docs/chat-overhaul/IMPLEMENTATION_PLAN.md`. Read the entire specification, `docs/chat-overhaul/LOCAL_MODEL_FINDINGS.md`, and the relevant repository code before editing. The plan supersedes the earlier piecemeal rollout in `CHAT_EVOLUTION.md`.

Deliver one integrated system: natural roleplay conversation, persistent scenes and relationships, evidence-backed long-term memory, semantic/lexical RAG over memories and approved lore, public web search with source links, native tool calling, robust local generation/streaming, memory/scene controls, and complete setup/tests/documentation. Work packages describe dependencies, not optional separate releases. Do not stop after infrastructure or present mocked search/RAG as completion.

Use only local inference. Gemma `unsloth/gemma-4-12B-it-qat-GGUF` was exercised successfully through the existing Unsloth orchestrator. Qwen is an allowed alternative only after verifying its actual local identifier and capabilities. Do not use Gemini, paid/cloud inference, paid embeddings, or a paid evaluator at any point, including automatic fallback and background memory jobs. Search may query public engines through the specified self-hosted SearXNG service; send only minimal public queries. Preserve orchestrator admission/workload headers and do not unload or cancel unrelated GPU jobs.

Exclude chat-triggered image/video generation and natural-language execution of existing slash commands. Preserve existing non-chat commands and local image understanding. New manual scene/memory/lore controls are in scope. Do not migrate discord.js or refactor unrelated features unless a demonstrated compatibility issue makes a narrow change necessary.

The synthetic probe script and results are provided as evidence, not production code or a substitute for integration tests. In particular: explicitly disable thinking for ordinary requests; validate strict schemas; retain tool call IDs/results and streamed argument fragments; preserve promise direction/recipient/time; and render known source links in application code. Read the documented experimental limitations.

Respect existing uncommitted user changes. Implement additive database migrations and a recovery protocol compatible with Mongo single-document atomicity. Run the specified deterministic tests, local service integrations, and local-model replay cases. Verify forget/delete behavior across source records, summaries, vector indexes, caches, and delayed workers. Exercise the integrated restart/relationship/retcon/RAG/search/deletion demo in a designated test scope.

Complete setup and code so they are reviewable before broad rollout. Do not register commands globally or send experimental chatter into production channels. Do not silently turn infrastructure outages into cloud requests or mock-only completion. If a required live service is unavailable, complete all independent implementation work and identify the precise remaining activation/verification step.

Finish with a requirement-to-code/test mapping, local evaluation results and limitations, setup/run instructions, and a rollback path that never reactivates legacy Gemini-first auto routing.

---

Files in this handoff package:

- `IMPLEMENTATION_PLAN.md`: authoritative full requirements, data model, lifecycle, tools/RAG, integration, acceptance tests.
- `LOCAL_MODEL_FINDINGS.md`: observed local behavior and resulting design decisions.
- `probe-results.json`: sanitized synthetic requests and outputs.
- `scripts/chat_exploration/probe.cjs` (repository-relative): reproducible local probes.
