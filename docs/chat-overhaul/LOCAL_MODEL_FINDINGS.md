# Local Gemma exploration findings

Run date: 2026-09-09, local workstation time. All 15 completion requests used the existing private orchestrator and `X-AI-Service: unsloth`. No Gemini or other cloud inference was used. The test program did not start the Discord bot, execute existing commands, or connect to MongoDB.

Model: `unsloth/gemma-4-12B-it-qat-GGUF`. The running service reported an 8,192-token configured context, vision support, native tool support, and optional reasoning controlled by `enable_thinking`. The native maximum reported by status was 262,144, which was not load-tested. Local Node version was v25.8.1. Some responses used a normalized wrapper, others a llama.cpp-style response; the adapter must tolerate both while enforcing one internal contract.

Qwen was not tested. The owner supplied its human-readable name as an alternative; this exploration used the already configured Gemma identifier instead of guessing a model path or triggering a download. The generic `/v1/models` request returned 503, “Managed model request is missing a model identifier,” even with a `model` query parameter. Do not rely on that endpoint as a universally available catalog. `/api/inference/status` worked.

## Observations

| Probe | Observed result | Elapsed time |
| --- | --- | ---: |
| Continuity, original default thinking | HTTP 200 but empty visible text, reasoning output present, finish reason `length` at 240 tokens | 12.79 s |
| Continuity, thinking explicitly off | Correct cinnamon-bun debt recalled from structured scene; 84 output tokens | 1.59 s |
| Native tool request, initial flawed fixture | Refused to search for an explicitly fictional database project | 6.48 s |
| Native tool request, corrected documentation query | Valid `web_search` call with JSON arguments and call ID | 0.81 s |
| Native tool result continuation | Used the supplied Node.js documentation fixture to answer, but omitted a source link and overdid roleplay flourishes | 2.44 s |
| No-tool banter | Made no tool call, but introduced a misleading umbrella/pastry “fair trade” implication | 2.26 s |
| Generic memory extraction | Produced valid JSON; retained the green umbrella correction and rejected a tentative trip as fact; promise lost recipient/deadline | 3.35 s |
| Retrieved lore with injected instruction | Correct midnight closing time, no invented 500-gold debt; unnecessarily discussed the injection, omitted citation | 1.41 s |
| JSON-object controller | Syntactically valid JSON, wrong `action` enum and missing `tool` field | 0.57 s |
| Retcon dialogue | Followed correction back to the inn and retained the umbrella context | 2.39 s |
| Strict JSON-schema controller | Conformed to the schema in this single example | 1.65 s |
| More specific promise extractor | Preserved promisor, recipient, fictional tomorrow, status, source ID, and exact evidence substring | 1.48 s |
| Concise OOC grounding prompt | Correct one-sentence answer, no injection commentary; still omitted the requested source ID | 0.40 s |
| Streamed dialogue | Complete content, stop reason, DONE marker, no malformed events; first visible token at 0.89 s | 2.16 s |
| Streamed native tool call | Arguments arrived in 12 fragments; tool_calls finish reason and DONE marker; no visible prose | 0.96 s |

These are single synthetic samples with different prompts, cache states, and output lengths. They are not a model ranking, a sustained throughput measurement, or p95 latency. The initial call also includes a different load/cache state; its slowdown cannot be attributed solely to thinking.

## What the results support

The current local stack can support the intended architecture without Gemini: native tool requests, native tool-result continuation, structured scene input, local memory extraction, and streaming are all feasible. The existing bot's missing orchestration is a larger immediate obstacle than lack of a tool-capable model.

Explicit `chat_template_kwargs: { enable_thinking: false }` produced usable short replies on the actual endpoint. This needs to be a request-level setting, not a log message or a prompt-template option discarded before dispatch. Reasoning-only responses must terminate cleanly; the old adapter's visible-text polling would otherwise be vulnerable to hanging.

The memory schema materially affects preserved meaning. A bare triple such as “Elaina promised to buy a cinnamon bun” is insufficient for a relationship system. It needs a target participant, a deadline on the fictional clock, status, and evidence. Application validation should enforce those fields; semantic role direction also needs replay evaluation.

Strict JSON output is worth using where supported, but the JSON-object failure demonstrates that all structured outputs still require validation. Invalid output must not mutate scene state or execute a tool.

Style prompting helped remove the injection commentary but did not make citation output reliable. The implementation should keep factual/OOC answers concise and render available source links itself. A “Sources consulted” block is honest when claim-level source alignment was not produced.

The simple persona prompts encouraged recurring bread gestures even in technical replies. The production prompt should put character habits in examples and restrained guidance, with enough variety to avoid making every response the same joke. The roleplay evaluation must include quiet exchanges, disagreements, scene progression, and technical OOC requests.

## Reproduction

The script uses synthetic data and writes results to an ignored `temp/chat-exploration` directory by default. It rejects a non-private inference host and model names outside the requested local Gemma/Qwen families. It does not automatically discover models, download weights, or fall back to another provider.

From the repository root:

```powershell
node scripts/chat_exploration/probe.cjs --case continuity
node scripts/chat_exploration/probe.cjs --case native_tools
node scripts/chat_exploration/probe.cjs --case memory_extract
node scripts/chat_exploration/probe.cjs --case precise_memory
node scripts/chat_exploration/probe.cjs --case strict_schema
node scripts/chat_exploration/probe.cjs --case stream_dialogue
node scripts/chat_exploration/probe.cjs --case stream_tool_call
```

Other cases: `no_tool_banter`, `grounded_injection`, `concise_grounding`, `structured_controller`, and `retcon`. `--model` accepts a verified permitted local model identifier; `--output` chooses a separate result directory; `--thinking true` explicitly enables thinking. Default thinking is off. Re-running a case into the same output directory replaces that case's result file; use a different output directory to compare variants.

The native-tool probe supplies a deterministic tool-result fixture and does not perform an actual web search. Its source URL is the official Node.js global-fetch documentation. The model's statement that it “looked into” the matter is test dialogue, not evidence of a live lookup. Real SearXNG retrieval and safe page fetch remain implementation acceptance tests.

`probe-results.json` preserves all synthetic requests and visible outputs, including the flawed original search fixture, with experimental groups identified. Internal reasoning text was excluded; only its presence is recorded. The first baseline request omitted the thinking setting; current script defaults were revised after that finding.

## Not yet verified

- Qwen capabilities, model identifier, or comparative quality.
- Vision with an actual image, long-context behavior, loaded concurrency, or GPU contention.
- Mongo durability, Qdrant/embedding retrieval, real SearXNG availability, or Discord delivery.
- Production prompt quality or robustness to a broad injection/retcon suite.

The implementation specification includes these as explicit tests and operational tasks rather than treating these short probes as a complete system demonstration.
