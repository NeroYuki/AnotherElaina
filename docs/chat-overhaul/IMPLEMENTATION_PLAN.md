# Elaina integrated chat overhaul — implementation specification

Date: 2026-09-09. Repository: `E:\dev\AnotherElaina`.

This specification supersedes the staged-release recommendation in `CHAT_EVOLUTION.md`. Deliver one integrated overhaul of the conversation subsystem. Internal implementation order is dependency management, not permission to stop after a foundation-only release.

## 1. Objective, scope, and binding decisions

Build Elaina as a roleplay character with persistent scenes, developing relationships, long-term memories, retrieval of past experiences and lore, public web search, and real tool execution. Preserve her ability to handle ordinary conversation and out-of-character factual questions. The result must run end to end through Discord and the existing local GPU orchestrator.

**No Gemini or other paid/cloud inference.** This covers generation, control/planning, memory extraction, summarization, embeddings, reranking, tests, and fallback. Never run the old `auto` path during evaluation. Public web search necessarily sends a search query to public search engines; it does not authorize cloud inference or transmission of the conversation transcript. Do not add paid search APIs as automatic fallbacks.

Use local Gemma as the initial default: exact tested identifier `unsloth/gemma-4-12B-it-qat-GGUF`. The owner also permits `qwen-3.8-27b`; its actual server identifier, quantization, availability, and capabilities were not verified. Treat Qwen as a configurable local alternative, not an assumed available model or a mandatory download. The delivered feature set must work on Gemma alone. Do not route every small job to a different model and cause repeated GPU swaps.

Included in this delivery:

- Mention/reply handling, stable identity, ordered turns, robust streaming, usable errors and cancellation.
- Persistent scenes, player characters, relationships, promises, corrections, regeneration, and reset/delete semantics.
- Automatic evidence-backed memory extraction, episode summaries, semantic and lexical retrieval, curated lore ingestion.
- Native local tool calling, schema validation, tool-result continuation, public web search and bounded page reading with citations.
- A consistent voice guide, scene-aware pacing, and a distinction between fictional events and real-user information.
- User/owner controls, deployment assets, database/index setup, evaluation fixtures, and operational documentation.
- Preservation of existing local image understanding where supported by the configured backend; no new image generation workflow.

Excluded from this delivery: natural-language execution of existing slash commands; chat-triggered image/video/audio generation; arbitrary command/MCP discovery; autonomous off-screen roleplay; unsolicited scheduled messages; DMs; a Discord library migration; unrelated command refactors. New manual slash commands to manage scenes, memory, and lore are part of this delivery, distinct from letting the model invoke existing slash commands.

Implement in CommonJS to fit the repo. Use native Node fetch for the new chat stack; do not mix Node Readable and WHATWG stream APIs. Keep unrelated `wd_*`, quizzes, integrations, and orchestrator behavior intact. Use one new conversation service behind `event/on_message.js`/`Bot.js`, with no legacy fallback capable of calling Gemini.

## 2. Local experiments and design consequences

The exploration made 15 synthetic local completion requests through the existing orchestrator, including two steps of a native tool cycle. It did not log into Discord, read a live database, make Gemini calls, or benchmark Qwen. Reproducible script: `scripts/chat_exploration/probe.cjs`. Sanitized requests/results: `docs/chat-overhaul/probe-results.json`. Detailed interpretation: `LOCAL_MODEL_FINDINGS.md` in this directory.

| Observation | Implementation consequence |
| --- | --- |
| Active Gemma status reported vision, tools, and optional reasoning; loaded context was 8,192 | Start from the tested 8K operating budget. A reported larger native maximum is not a memory-allocation guarantee. |
| Initial default-thinking response spent all 240 output tokens on reasoning and returned no visible text | Send `chat_template_kwargs: { enable_thinking: false }` for normal chat and background jobs. Empty output and output-limit termination need explicit handling. Never expose reasoning fields. |
| The same continuity case with thinking disabled produced an 84-token answer in 1.59 seconds | Normal conversation can use a single local generation call after retrieval. This is a single warm sample, not a latency SLA. |
| Native `web_search` call and a subsequent tool result worked | Use OpenAI-style structured tool calls/results. Do not parse function names from arbitrary dialogue text. |
| Streaming dialogue and fragmented tool arguments worked through native fetch | Accumulate tool arguments by call index/ID and validate after stream completion, before execution. |
| `json_object` returned valid JSON with the wrong action enum and missing field | JSON parse success is not schema success. Use strict schemas where supported plus application validation on every output. |
| One `json_schema` controller example conformed | Probe this capability and retain one bounded repair path. One successful example is not proof of universal schema compliance. |
| Generic extracted promise omitted the recipient and deadline; a more specific schema preserved both | Use typed relation/promise records with evidence, not bare subject/predicate/object triples alone. |
| Gemma handled an umbrella-color correction and rejected an unaccepted travel proposal as fact | Automatic extraction is viable with validation and correction lineage. Do not let model confidence decide truth. |
| An attack inside retrieved lore did not become a debt, but the first reply narrated the attack | Keep trust boundaries in prompts and validation; add a style instruction to ignore irrelevant embedded instructions silently. |
| Both grounding variants omitted requested citation IDs | Render known source links in application code. Never depend on the model to preserve citations. |
| Pastry-heavy prompts produced repetitive bread references and one confusion about who owed whom | Persona and relationship prompts need focused examples and directional records; grammatical fluency alone is not continuity quality. |

The first native-tool fixture explicitly asked about a fictional project and was refused. That was a flawed search test, not proof that native tools fail; the corrected real-documentation query worked. Tool results in the probe were supplied fixtures, not live searches.

## 3. User experience and default semantics

**Activation.** Respond to explicit mentions and replies whose referenced message was authored by this bot. Ignore other bots and webhooks. Fetch a missing reply target only inside the accessible channel, with a deadline. A mention inside a reply must still work. Attachment-only addressed messages should work when a supported image is present. Remove only the bot mention; preserve other people's mentions as participant references.

**Default scope.** A channel or thread has one active shared scene binding after its first addressed turn. It belongs to a continuity/world. Two channels are separate continuities by default. Explicit resume/share operations may connect scenes only after verifying the destination audience is authorized. Do not assume two channels in one guild have the same readers. A thread is its own scene binding by default.

**Passive context.** Persist messages only from joined scene participants in enabled scene channels. The first author becomes a participant; other users join explicitly or by addressing Elaina in that scene. Passive participant messages provide observation/context, not an automatic request for a response. Exclude bot status messages, command output, unrelated attachments, and opted-out users from memory. Do not backfill entire guild histories. Explicit source messages referenced by a reply may be included as bounded quoted context with provenance.

**Turn-taking.** Use mentions and replies by default. An optional scene setting may allow a short addressed follow-up window, default off; if enabled, limit it to the initiating participant, 90 seconds, and at most three follow-ups. Do not build an ambient “decide whether to interrupt everyone” model loop for this release.

**Roleplay/OOC.** Support `OOC:` and `IC:` segments, plus `((...))` as an OOC convention; keep their raw text and segment boundaries. The model can infer tone for unmarked text but inference alone cannot change permissions, memory scope, or user controls. OOC corrections from an authorized participant can correct their own character facts. Shared-world retcons require the scene owner or moderator. Ordinary IC speech such as “forget I said that” is not a destructive storage command.

**Player agency.** Users own their characters. Elaina can act, react, suggest plans, and introduce modest environmental detail consistent with the scene. She must not supply player dialogue, decide player emotions, invent acceptance of a proposal, or declare a major relationship change on another player's behalf. Store proposals as proposals until accepted.

**Style.** Use first-person dialogue and optional brief action beats. Match the user's language and approximate verbosity. OOC factual replies are direct, with minimal or no stage directions. Vary sentence structure and avoid forced bread jokes, repetitive gestures, constant questions, and restating retrieved memories. Elaina's goals and mood are small scene attributes supported by events, not random autonomous meters. No automatic intimacy escalation or daily fabricated adventures.

**Time.** Keep real UTC timestamps, user/guild display timezone, and fictional scene time separate. “Tomorrow” in a promise means tomorrow in the scene unless explicitly real-world. Returning after a week does not silently advance the fictional clock.

**Feedback.** Use Discord typing while preparing; create one owned reply/placeholder and edit it with bounded frequency. Show a quiet “Looking that up…” state only when a tool actually starts. Ordinary roleplay should not expose tool JSON, retrieval scores, schema repairs, or memory extraction status. Sources belong at the end of factual responses, not appended to every in-character memory callback.

## 4. Stack and service boundaries

| Responsibility | Choice |
| --- | --- |
| Bot/application | Existing Node/CommonJS app, new `chat/` subsystem |
| Inference | Existing proxy `/v1/chat/completions`, `X-AI-Service: unsloth`, existing workload headers |
| Authoritative persistence | Existing MongoDB connection, new namespaced collections |
| Vector retrieval | Self-hosted Qdrant, a rebuildable index of eligible Mongo records |
| Embeddings | Local CPU worker using `@huggingface/transformers` and a pinned ONNX `Xenova/multilingual-e5-small` revision |
| Public search | Self-hosted SearXNG JSON API; no paid engine keys |
| Web extraction | Dedicated safe HTTP fetcher plus Cheerio text extraction; no browser execution |
| Validation | Ajv JSON Schema with one canonical schema per record/tool |
| Tests | Node test runner with injected providers/stores/clock; separate local integration/evaluation commands |

Keep embeddings off the generation GPU by default. Download the embedding artifact once during explicit setup, verify the pinned revision/artifact, then load from the local cache with runtime remote model loading disabled. The proposed E5 model is multilingual; test retrieval in the languages actually used by the owner. Use `query: ` and `passage: ` prefixes, normalized mean pooling, 384-dimensional vectors, and respect the model's 512-token input limit. Verify these details against the selected artifact before indexing. [E5 model card](https://huggingface.co/intfloat/multilingual-e5-small/raw/main/README.md), [ONNX model package](https://huggingface.co/Xenova/multilingual-e5-small), [Transformers.js](https://huggingface.co/docs/transformers.js/index).

Provide a Docker Compose file for Qdrant and SearXNG with persistent storage, health checks, pinned versions/digests selected at implementation time, and ports bound to loopback by default. Existing Mongo remains configurable rather than provisioning a second database. Remote deployment may explicitly bind a private LAN address with authentication/firewall rules; do not expose a vector index or private search instance publicly.

SearXNG must enable JSON in `search.formats`; otherwise its JSON requests can return 403. Search availability depends on the upstream engines; failures must become clear tool errors, never invented results. [SearXNG Search API](https://docs.searxng.org/dev/search_api.html).

Exploration also found `E:\dev\web-search` and `E:\dev\web-search-mcp`. The first scrapes Google HTML; the second uses browser/Bing/Brave and HTTP DuckDuckGo fallbacks, with extra extraction and MCP machinery. They are not integrated with this bot. Use them only as implementation reference. Do not introduce an absolute sibling-repo runtime dependency, automatically spawn their browser pools, or trust their content-size limits. The specified release uses the bounded SearXNG adapter; generic MCP support is unnecessary to meet tool use here.

Do not require Mongo Atlas vector features or assume replica-set transactions exist. Mongo provides atomic single-document updates; the design below uses a continuity commit pointer and recoverable jobs rather than multi-document transactions. [MongoDB atomicity](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/). Qdrant payload filters must apply scope constraints during search, followed by source authorization revalidation. [Qdrant filtering](https://qdrant.tech/documentation/search/filtering/).

## 5. Modules and contracts

Suggested layout; merge small adjacent files if helpful, but preserve these boundaries:

```text
chat/
  index.js                     # init/start/stop; dependency injection; no login side effects
  config.js                    # validate settings; forbid cloud inference
  discord/{ingest,respond,components,permissions}.js
  conversation/{service,queue,context_builder,turn_state,scene_controls}.js
  providers/{local_openai,capabilities,sse,errors}.js
  persona/{elaina.json,examples.json,prompt_builder.js}
  schemas/{message,scene,memory,extraction,tool}.json
  persistence/{mongo,collections,leases,repository,jobs}.js
  memory/{extract,validate,project,summarize,forget}.js
  retrieval/{embed_worker,vector_index,lexical,rank,ingest}.js
  tools/{registry,runner,memory_search,knowledge_search,web_search,web_fetch,clock,roll_dice}.js
  web/{safe_fetch,extract,source_registry}.js
  observability/{metrics,trace}.js
commands/chat/{scene,memory,lore}.js
scripts/chat/{migrate,reindex,ingest_lore,evaluate,smoke_local}.cjs
tests/chat/{unit,integration,replay}/
deploy/chat/{compose.yaml,searxng-settings.yml,README.md}
resources/lore/                 # curated manifest and approved text only
```

Expose provider methods conceptually as:

```js
generate({ messages, tools, responseSchema, maxOutputTokens, thinking, signal, jobId })
// -> { text, toolCalls, finishReason, usage, model, providerMeta }

stream(request)
// AsyncIterable of textDelta | toolCallDelta | usage | finished

toolRunner.run({ call, trustedContext, signal })
// -> { ok, data, sources, error: { code, retryable } | null }

conversationService.handle({ event, signal })
// Resolves only after the turn has reached a recoverable terminal state.
```

Trusted context contains IDs/authorization/budgets constructed by the application. A model-generated `userId`, `guildId`, path, endpoint, or unrestricted filter is never trusted. Input serialization must distinguish system instructions, actual messages, retrieved data, and tool results.

## 6. Durable data model and indexes

Use UUIDs or validated strings for internal IDs and Discord snowflakes as strings. Every record has `schemaVersion`, `createdAt`, and appropriate `updatedAt`. Scope includes guild, continuity, scene/branch where applicable, audience restrictions, and a deletion epoch. Do not put an unbounded transcript inside one Mongo document.

| Collection | Main fields and invariants | Required indexes |
| --- | --- | --- |
| `chat_continuities` | Owner, guild, allowed audience, personaVersion, active status, committedEventId, revision, lease owner/fencing token/expiry, deletionEpoch | guild/owner; unique ID |
| `chat_scenes` | continuityId, branchId, title, participants, bounded projected state, snapshotWatermark, selectedHeadTurnId, projectionRevision, deletionEpoch | continuity/status; unique ID |
| `chat_bindings` | channel/thread ID, activeSceneId, enabled, follow-up setting, audience policy | unique guild/channel/thread binding key |
| `chat_characters` | ownerUserId, continuityId, characterId, displayName/aliases, explicit character description | unique continuity/character; continuity/owner |
| `chat_turns` | event type, source message IDs, parentEventId in continuity log, parentTurnId in scene branch, branchId, ordinal, role, author/character, IC/OOC segments, content parts, request ID, lifecycle, generation variants, delivery IDs, cancellation/error | unique event idempotency key; scene/branch/ordinal; sourceDiscordMessageId |
| `chat_memories` | Typed claim/event/promise, subject/target, source IDs and exact evidence, validity/correction links, confidence category, salience, scope, derivation version, deletionEpoch | scope/type/status; source IDs; unique derivation key; subject/target |
| `chat_relationships` | Projected relationship summary, open promises, event references, watermark/revision; bounded and rebuildable | unique continuity/character pair/direction |
| `chat_episodes` | Summary, source turn interval/IDs, scene/branch, topic tags, participant IDs, projection revision | scope/time; source interval; derivation key |
| `chat_documents` / `chat_chunks` | Approved source metadata, content hash/revision, text chunks, source locations, ACL, lifecycle | unique source/hash/revision and document/chunk; scope/type |
| `chat_jobs` | type, entity/source IDs, expected epoch/revision, idempotency key, state, lease, attempts, nextRunAt | unique idempotency key; state/nextRunAt |
| `chat_tool_runs` | turnId, callId, tool/version, argument hash, result/reference, sources, status, deadline | unique turnId/callId; TTL on expendable cached results |

Qdrant payloads contain source record IDs, corpus kind, scope/ACL labels, source revision and epoch. Store the minimum needed text or only IDs; Mongo is authoritative. Index payload fields used for filtering. Vector collection names include embedding model/version, dimension, and distance metric. Never mix vectors from different revisions of the embedding model; reindex into a new collection and swap a configured alias after verification.

A promise must preserve direction and time:

```json
{
  "kind": "promise",
  "subjectCharacterId": "elaina",
  "targetCharacterId": "ren",
  "action": "buy Ren a cinnamon bun as repayment for the umbrella loan",
  "due": { "clock": "fictional", "relativeToTurnId": "t2", "value": "tomorrow" },
  "status": "open",
  "sourceTurnIds": ["t2"],
  "evidence": [{ "turnId": "t2", "quote": "Ren, I will buy you a cinnamon bun tomorrow to repay you." }]
}
```

A memory status is `candidate`, `active`, `superseded`, `retracted`, or `deleted`. Confidence is an evidence category (`explicit`, `inferred`, `uncertain`), not an arbitrary model probability. Fictional facts and real-user preferences occupy distinct types and cannot be silently converted into each other. Sensitive real-user information is not inferred from roleplay.

## 7. Turn lifecycle, ordering, and failure recovery

1. Normalize the Discord event without losing IDs, mentions, timestamps, reply relationships, or image metadata. Check enabled state and permissions before persistence or inference. Deduplicate Discord event delivery with a unique event key.
2. Resolve the continuity/scene and participant. Queue work by continuity so scenes sharing relationship state do not race. Independent continuities may run concurrently within a configured global limit; default local inference concurrency is one.
3. Acquire a renewable lease on the continuity document with a monotonically increasing fencing token. Expired workers must not commit. Lease expiry is checked in the update predicate, not entrusted to delayed TTL cleanup. Heartbeat while inference runs; use cancellation and `finally` to release. This lease and the authoritative commit pointer must live in the same document so one conditional update can check both.
4. Persist a pending turn containing its parent continuity event, parent scene turn, revision/epoch, and source input. Capture an immutable context snapshot. Do not mutate a shared message array during generation.
5. Read current scene/relationship projections, eligible memories, selected history, and lore retrieval. If a projection lags, include raw committed turns after its watermark. No unsummarized committed tail may silently disappear; if it cannot fit, synchronously compact that tail or return a bounded busy/degraded response.
6. Apply deterministic explicit control actions (authorized reset, selected scene, character switch). For ordinary dialogue, generate with eligible native tools. Tool selection should usually share the first generation call; do not add an obligatory LLM planning pass to every greeting.
7. Assemble and validate any complete tool calls; execute bounded allowed tools; append native assistant tool calls and tool results; resume generation. Stop at budget, cancellation, or a final answer. No tool/control text is sent to Discord as dialogue.
8. Persist the completed draft and a delivery plan before final delivery. Use one previously recorded placeholder/message ID when possible. Mark partial streams as incomplete until finalized. Await edits/sends; capture every continuation message ID.
9. After successful final delivery, atomically compare-and-swap the continuity's `committedEventId`/revision using parent event pointer, epoch, unexpired lease, and fencing token. Its linked event log defines accepted events; explicit branch-selection events determine which dialogue variants are canonical within a scene. Scene heads/state are recoverable projections, not a second independent commit authority. Pending/abandoned drafts are never memory sources. Delivery after a lost lease must be prevented where possible; if an already visible draft loses the commit race, mark it superseded and recover explicitly.
10. Mark the turn finalized and enqueue idempotent extraction/summary/index work. If the process crashes between pointer commit and enqueue, a reconciliation scan discovers committed turns lacking derived jobs. Do not require an atomic cross-collection transaction for correctness.
11. Release the lease. Subsequent turns can proceed with the raw committed tail even if extraction is pending. Long-term projections remain consistent with their watermarks. Workers must verify canonical ancestry and epoch before publishing derived state. Publish derived scene/relationship updates while holding the same continuity lease, or through an equivalent serialized event, so a projection cannot race a retcon/reset; expensive inference/embedding work stays outside that short publication lock.

Passive participant messages are `observation` events in this same ordered log, committed without generation or Discord delivery. Scene switches, correction decisions, variant selection, and deletion markers are typed control events. Filter transcript construction by scene and selected branch; do not display internal control events as character dialogue. Avoid loading the entire continuity chain on each request: maintain validated sequence/head projections and repair them from the log after crashes.

Discord and Mongo cannot commit atomically together. Use a recoverable delivery protocol, not a claim of exactly-once network delivery. An ambiguous initial send is reconciled against a short, bounded scan of the bot's recent messages referencing the same trigger plus the recorded delivery state. Do not automatically generate and resend a new answer when prior delivery might have succeeded. If reconciliation is inconclusive, leave an explicit uncertain-delivery state for retry/status handling.

Tools with effects, including dice randomness, use `turnId + callId` idempotency. A retry returns the recorded outcome. Search can be retried within its deadline, but cache/result provenance must show which execution produced it. Never silently restart a partially delivered answer on a different model.

On Mongo unavailability, refuse to advance a persistent scene and give a short service error. On Qdrant/embedding outage, load exact current state plus authorized lexical/recent memory fallback and report degradation in admin status. On search outage, keep roleplay usable and admit inability to verify current facts. These fallbacks must never call a cloud model.

## 8. Context assembly and generation

Assemble, in order: fixed policy and persona; concise owner-approved voice examples; current scene snapshot; directional relationship/promises; relevant retrieved memory/lore as labeled evidence; bounded recent committed transcript; pending input; native tool results where applicable. System roles are only application-owned instructions. Retrieved prose never becomes an executable instruction.

Initial **8,192-token** budget, including tools and output reservation:

| Allocation | Starting cap |
| --- | ---: |
| Persona/policy/examples | 800 |
| Scene/relationships | 700 |
| Retrieved episodes/lore | 900 |
| Recent transcript plus current user input | 2,600 |
| Tool schemas | 500 |
| Tool-result reserve | 1,400 |
| Visible generation output | 512 |
| Tokenizer/template margin | 780 |

This allocation is a starting policy, not a requirement to fill every bucket. Borrow unused space; enforce the total. Use a server tokenizer only if its API is verified; otherwise a pinned local compatible tokenizer. Until exact tokenization is available, use a conservative UTF-8 byte upper estimate and larger margin, not characters/4. Count tool JSON and reply framing. Vision inputs need a separately tested reservation or reduced text window. Trim low-ranked retrieval and old summarized turns before current input, current facts, or tool-call/result pairs. Keep persisted history intact.

Default visible output limit 512 tokens; allow up to 1,024 for explicit longer responses if context budgeting accommodates it. Default thinking off. `<think>` is an explicit user request for a bounded reasoning-enabled local call: configure a larger total generation budget, reserve enough room, keep reasoning private, and handle reasoning-only exhaustion with one fresh thinking-disabled retry before any visible reply. Do not assume reasoning tokens are accurately reported: the baseline probe showed a separate reasoning field with zero reported reasoning-token usage.

SSE must handle arbitrary byte boundaries, multi-byte UTF-8, CRLF, empty deltas, usage-only events, missing usage, stream errors, final buffers, length stops, and `[DONE]`. Accumulate all tool-call fragments. Execute only after the full response indicates tool calls and validation succeeds. If text is emitted before a tool call, buffer it until the response type is known or show only a neutral status; never publish speculative “I have done X.” Model output/reasoning delimiters must not leak into Discord.

Rate-limit Discord edits to a configurable interval, initially 1.5–2 seconds, with one in-flight edit per message. Split text below Discord's message limit, preserving code fences and the final sources block. Set `allowedMentions` explicitly so generated `@everyone`, roles, or user mentions cannot notify arbitrary people. Handle deleted messages, missing permissions, invalid attachment types, and collector expiry without leaving timers alive.

## 9. Memory extraction, summaries, and corrections

Run one structured extraction job per finalized turn initially, low priority behind foreground inference. Temperature near zero, thinking disabled, strict schema if supported. Bound the input to the new canonical turn, necessary local context, and relevant existing candidate facts. Avoid replaying the entire transcript for every write. Each job records the model, prompt version, source IDs, epoch, and derivation key.

Extract typed changes: scene facts, object ownership/location, character facts, directional relationship events, promises with recipients/deadlines, open plans, explicit preferences, and correction/retraction links. Source quotes must be exact substrings of canonical source messages. The service supplies IDs and authorized scope; reject outputs referencing nonexistent sources or participants. An exact quote is necessary provenance, not sufficient semantic proof—apply type/actor rules and exercise semantic correctness in evaluation.

Validation rules:

- No model-written policy/permission changes, hidden instructions, new owners, or arbitrary collection paths.
- Only a player's explicit statement can establish their character's actions, decisions, or feelings. Elaina's own delivered speech/actions can establish her commitments.
- Preserve negation, uncertainty, subject/object direction, and hypothetical/proposed status. Do not turn an unaccepted plan into scene history.
- OOC real-user preferences require an explicit real-user assertion and appropriate scope. Character occupation is not the user's occupation.
- Contradictions require a correction link or a conflict record. Never silently overwrite an established fact because a newer model inference differs.
- A model confidence value cannot override a source, moderator permission, or user correction.

Allow one repair call with validation errors, then dead-letter the job while retaining source turns. Retried jobs are deduplicated. Failed extraction must not block every future conversation indefinitely; current context includes raw committed turns, and the admin status exposes the backlog.

Create an episode summary when a scene ends or after roughly 12 new addressed turns / 2,000 unsummarized tokens, configurable. Merge by bounded sections and source intervals. Include location/time progression, participants, significant events, unresolved threads, and relationship changes. Preserve exact structured promises separately. Index episode summaries and selected active memories; do not embed every filler acknowledgement. A summary cannot erase contradictory evidence or add events absent from its source interval.

Regenerate targets a specific owned bot turn. For the current head, create a sibling variant from the same parent and choose it only after successful delivery. Invalidate projections/index records derived from the displaced variant. If later turns exist, require an explicit branch/fork action; never rewrite a deep ancestor beneath active later conversation. Continue appends a new linked continuation with its own identity; do not concatenate into old stored text without provenance.

OOC retcons create explicit correction events and invalidate affected descendants/projections as needed. Scene state is rebuilt from still-valid claims plus the correction. A correction to a player's character is restricted to that player or a moderator; broad scene retcons use scene-owner/moderator authorization. Keep an audit of correction IDs without preserving content the user explicitly deleted.

Forget/delete protocol: immediately increase the affected scope's deletion epoch or install a scoped tombstone; block retrieval of affected records; cancel matching queued jobs; purge/redact turns, memories, relationship summaries, episode summaries, vector points, tool caches, and attachments/captions; rebuild surviving mixed-participant summaries; invalidate in-memory caches; verify completion. Workers check the epoch before both inference and commit, so old work cannot resurrect content. A text message edit/delete event invalidates its derivatives as well. Do not claim to delete copies already posted on Discord or in infrastructure backups unless those are explicitly included and verified.

Default retention proposal: raw messages and transient tool traces 90 days; explicitly curated lore and active user-approved/durable roleplay facts until removed; expendable web caches 15 minutes; inactive episodes configurable. Surface this policy in scene creation/status and owner docs. Before source expiration, retain only the minimal evidence excerpt needed for a kept memory under the declared durable-memory policy; otherwise expire its derived records too. Memory opt-out disables durable personal extraction, not the ability to answer the current message. Commands must clearly distinguish “end scene,” “start fresh scene,” and “delete stored content.”

## 10. Retrieval and lore ingestion

Mandatory RAG in this release combines exact state, semantic search, and lexical matching. It is not deferred to a later milestone.

1. Construct a query from the current message, reply target, scene topic, and explicit character names. Do not use a raw full-history dump. Use deterministic construction first; query rewriting is optional only if evaluation shows a benefit.
2. Apply audience, guild, continuity, scene/branch, corpus kind, active status, and epoch filters at the retrieval layer. Approved global character lore is a separate explicitly readable corpus. Limit all queries, including lexical fallback.
3. Retrieve up to 20 semantic and 20 lexical candidates. Lexical retrieval can use Mongo text indexes plus exact normalized names/tags with `default_language: none`; test its behavior for the owner's languages. No unrestricted regex over all history.
4. Revalidate every returned source against authoritative Mongo state/ACL and canonical branch ancestry. Stale Qdrant results must be dropped, not included because they ranked highly.
5. Fuse ranks with reciprocal rank fusion (initial constant 60), then use modest deterministic recency/salience bonuses. Preserve diversity across episodes; select around 6 results within the token budget. Treat numerical thresholds as calibration parameters, not proof of relevance.
6. Load actual evidence text and source IDs. Current exact scene state and explicit corrections outrank older episodes. If evidence is absent or conflicting, Elaina should acknowledge uncertainty instead of claiming a fabricated shared memory.

Use chunking around 250–350 embedding tokens with approximately 40-token overlap, respecting section boundaries and the embedding model limit. Store document/section/source offsets and content hash. Indexing is idempotent; changed source revisions replace old chunks via the job system. Deleting/unsharing a document blocks retrieval immediately even if vector cleanup lags.

Implement owner/moderator lore ingestion of `.md`/`.txt` files, approved plain-text Discord attachments, and explicit public HTML URLs through the safe fetcher. Maximum initial file size 1 MiB; reject binaries and hidden files. Maintain a manifest under `resources/lore/` for bundled seed lore. Never recursively ingest the repository, `.env`, configuration secrets, databases, or unrelated chat channels. Third-party canon material must be intentionally supplied/selected by the owner; do not scrape a large copyrighted corpus to populate RAG.

Seed the persona/lore from the active existing Elaina description after separating stable character information from repetitive visual details; keep the source and version. Use the owner's current adult-character portrayal consistently. Remove the unused legacy character-prompt variants from the new runtime path, but do not silently blend their conflicting lore into the seed.

## 11. Tool registry, web behavior, and validation

Each tool has a stable name/version, purpose, JSON input schema, output schema, timeout, maximum result size, authorization policy, cache policy, and side-effect classification. Schemas disallow unknown properties. The registry is application-owned and allowlisted; model text cannot register a tool.

| Tool | Input | Behavior |
| --- | --- | --- |
| `memory_search` | query, optional memory kind | Search only the caller's eligible continuity/scene evidence; scope supplied by application |
| `knowledge_search` | query, optional approved corpus label | Retrieve approved lore/reference passages |
| `web_search` | query, optional language/time range | Up to 5 public results with stable source IDs, title, URL, snippet, retrieval time |
| `web_fetch` | sourceId, or explicit user-provided URL | Read bounded public HTML/text; return source text and metadata |
| `current_time` | optional validated IANA timezone | Deterministic real-world time; never advances fictional time |
| `roll_dice` | count 1–10, sides 2–100, optional modifier in -100..100 | Explicitly requested roleplay roll using crypto randomness, cached by call ID |

Memory writes, permission changes, arbitrary slash execution, file access, shell execution, and generation jobs are not tools exposed to the dialogue model. User-facing memory controls go through authorized application handlers. Search/lookup tools are sufficient to implement the requested tool-capable chat experience.

Initial per-turn limits: at most 3 tool rounds, 5 total tool calls, 2 web queries, 2 page fetches; at most 2 independent read-only tools concurrently; tool context reserve as above. Set a global turn deadline of 90 seconds for warm chat, with a separately labeled bounded cold-load/admission allowance up to 180 seconds. Tool timeouts: search 12 seconds, fetch 10 seconds, memory/lore 3 seconds. Repeated identical calls return cached results or stop the loop. Unknown tools/invalid arguments receive one structured error result; repeated invalid calls terminate tool use and generate a short limitation-aware answer.

Native function calls are the default because they worked in the probe. Capability checks are model/config-version-specific, not global. For a permitted local model that lacks native tools, implement a constrained JSON decision adapter returning `reply` or a typed tool invocation. Validate it, allow one repair, and then fail closed to a normal no-tool response with honest limitations. Do not silently execute JSON scraped out of arbitrary visible prose. The JSON adapter is a compatibility path, not the default extra call for Gemma.

Web search is used for explicit lookups and genuinely current/uncertain real-world questions. Greetings, scene continuity, or fictional facts normally use no web calls. Queries include only the minimum needed public subject, never private message excerpts, relationship records, or user IDs. An offline scene option disables external search while preserving local memory/lore tools.

Safe fetch requirements: HTTP/HTTPS only; strip credentials; reject loopback/private/link-local/multicast/reserved IPs, IPv4-mapped IPv6 forms, localhost and local domain targets; validate DNS and pin the approved resolution for the connection to prevent rebinding; revalidate every redirect, maximum 3. This restriction applies to arbitrary web targets, not configured trusted service endpoints such as SearXNG, Mongo, Qdrant, and the inference proxy, which have separate clients. No arbitrary proxies or forwarded authentication/cookies. Bound decompressed body size to 1 MiB and extracted page text to about 12,000 characters before final token clipping. Reject unsupported content types; remove scripts/styles/forms/navigation. Do not execute page JavaScript. Limit concurrency and prevent fetches from reaching the local GPU infrastructure.

Search result snippets and page contents are untrusted evidence. The response renderer maps known source IDs to actual returned URLs. If the model emits supported citation markers, resolve them; if it omits markers, append a compact “Sources consulted” list of the 1–3 sources actually supplied to the answering call. That label does not assert claim-level support. Remove/reject unknown citation IDs and invented source URLs. The model should qualify snippet-only evidence and conflicting/outdated results. Do not turn fetched web facts into scene canon or durable memories unless an authorized explicit save operation requests it.

## 12. Controls and compatibility

New manual commands should have bounded inputs and ephemeral output for memory/debug data wherever possible:

- `/scene new|status|resume|end|character|settings`: manage scene binding, continuity, ownership, characters, and opt-in observation. Resuming across channels must verify audience compatibility. New scene is not deletion.
- `/memory show|forget|clear|export|optout`: users inspect/delete their permitted records and evidence; moderators manage shared-scene records. Use confirmation UI for broad destructive clear, tied to user/scope/epoch, and distinguish stored bot memory from existing Discord messages. Export only currently authorized content, via an ephemeral attachment.
- `/lore add|remove|status|reindex`: owner or designated moderators; file/URL validation and ingestion job status. Reindex preserves source records and does not grant new access.
- `/chat_config`: owner-only `disabled`, `auto_local`, and explicit configured local model aliases; stream/thinking/budget settings. Persist configuration rather than globals. Normalize existing `byPassUser` handling to a single owner-ID predicate for chat controls.

Preserve Continue, Regenerate, and Debug affordances with central persistent component routing, scoped user authorization, and stored turn IDs. Replace the ambiguous context toggle with scene status/switch controls. A restart must not make the underlying turn operations impossible because an in-memory collector expired. Reject stale revision controls clearly. Do not expose private memory content in channel-wide debug embeds.

Compatibility mapping: old `auto`, `standard`, `saving`, and `auto_local` map to safe local configuration on the new handler; old online modes return a clear disabled-provider error. `<local>` is redundant but accepted; `<think>` follows the tested capability/budget path; `<unsafe>` can map to an explicitly configured local alias for compatibility and never bypass tool permissions or storage boundaries. Disabled chat remains disabled regardless of inline tokens. The old channel-reset command becomes an authorized wrapper over the new scoped deletion service.

There is no durable old chat transcript to migrate: old `context_storage` is process memory. Start fresh scenes by default and state this in release notes. Do not scrape Discord or import ambiguous cross-channel arrays automatically. Existing Mongo collections, command configs, and user-owned uncommitted files must remain intact.

## 13. Configuration, setup, and observability

Provide `.env.chat.example` (no real credentials) and validated configuration documentation for these settings or equivalent names:

```dotenv
CHAT_ENGINE=overhaul
CHAT_LOCAL_ONLY=true
CHAT_MODEL=unsloth/gemma-4-12B-it-qat-GGUF
CHAT_CONTEXT_TOKENS=8192
CHAT_MAX_OUTPUT_TOKENS=512
CHAT_THINKING_DEFAULT=false
CHAT_INFERENCE_CONCURRENCY=1
CHAT_TURN_TIMEOUT_MS=90000
CHAT_COLD_TIMEOUT_MS=180000
CHAT_TOOL_MAX_ROUNDS=3
CHAT_TOOL_MAX_CALLS=5
CHAT_RAW_RETENTION_DAYS=90
CHAT_BACKGROUND_CONCURRENCY=1
CHAT_OBSERVE_PARTICIPANTS=true
CHAT_FOLLOWUP_WINDOW_SECONDS=0
QDRANT_URL=http://127.0.0.1:6333
SEARXNG_URL=http://127.0.0.1:8088
CHAT_EMBEDDING_MODEL=Xenova/multilingual-e5-small
CHAT_EMBEDDING_DEVICE=cpu
CHAT_EMBEDDING_CACHE=./data/chat-models
```

Reuse `AI_PROXY_URL` and the existing Mongo environment configuration. The agent must pin and document embedding revision and dependency/container versions; do not leave a floating `main` model revision or `latest` container tag in the final setup. Runtime requests are limited to configured local inference destinations; reject a cloud inference URL/model in configuration. The test fake provider is injection-only and never selected automatically in production.

Initialization order: load dotenv before configuration modules; validate config; await Mongo connection; create/verify indexes; initialize repositories and background reconciliation; load/check local embedding runtime; verify Qdrant/search availability with explicit degraded status; then register event handling and log in. Existing command initialization must not start duplicate inference/load/unload loops. Centralize shutdown: stop intake, abort/drain bounded work, release leases, stop timers/workers, flush essential metadata, close Mongo once. Adapt the existing rate-limiter signal hooks so they cannot terminate the process before the new subsystem cleans up.

Respect orchestrator admission: send `X-AI-Workload` and job IDs for all local generation, including background extraction. Do not unload other users' models, cancel unrelated jobs, or make competing VRAM admission decisions. Honor `Retry-After`; one bounded retry for retryable admission/transport failure before visible delivery, within the original deadline. Failed/aborted jobs need correct completion/error cleanup under the existing proxy contract. Do not invent an undocumented orchestrator API.

Structured metrics: turn ID, scene ID hashed where appropriate, model/config version, queue wait, first visible token latency, total time, token usage if actually available, tool calls/timeouts, memory jobs and lag, retrieval hit/source counts, invalid outputs, cancellation, and degraded services. Never log raw prompts, private memories, URLs with query secrets, credentials, or reasoning by default. Debug traces are owner opt-in, time-limited, and deletable under the same policy.

Add health/status output for Mongo, embeddings, Qdrant, SearXNG, local provider capability probe, extraction backlog, and current operating mode. Distinguish “enabled,” “reachable,” and “successfully exercised”; absence of an error is not proof that search or retrieval works.

## 14. Implementation work packages — one complete delivery

Work through these dependencies in one implementation effort. Do not ask the owner to approve every work package. If delegation is used by that agent, assign independent modules with shared contracts and integrate them before claiming completion.

| Package | Concrete work | Files most affected |
| --- | --- | --- |
| A. Contracts and persistence | Schemas, config, Mongo readiness, collections/indexes, leases, canonical pointer, jobs, fake adapters | `chat/schemas`, `chat/persistence`, `database/database_connection.js` |
| B. Local provider and delivery | Native fetch/SSE, capability probe, thinking controls, errors/cancel, token budgeting, renderer | `chat/providers`, `chat/discord/respond.js`, `utils/orchestrator_workload.js` reuse |
| C. Conversation and persona | Scene resolution, IC/OOC identity, queue/lifecycle, persona examples, deterministic controls | `chat/conversation`, `chat/persona`, `Bot.js`, `event/on_message.js` |
| D. Memory and RAG | Typed extraction, validation, summaries, correction lineage, embeddings, Qdrant/lexical fusion, ingestion | `chat/memory`, `chat/retrieval`, `resources/lore`, scripts |
| E. Tools and search | Registry, native loop, compatibility decision adapter, SearXNG, safe fetch, source renderer, time/dice | `chat/tools`, `chat/web`, deploy assets |
| F. Controls and integration | Scene/memory/lore commands, persistent component handlers, legacy aliases, graceful shutdown | `commands/chat`, `commands/operating`, `Bot.js`, command registration |
| G. Verification and handoff | Offline regression, service integration, local replay, setup/rebuild/rollback documentation | `tests/chat`, `scripts/chat`, docs, `package.json` |

All packages are required. A mock-only web tool, placeholder vector search, in-memory production store, unvalidated model-written memories, or disabled-by-default required capability does not satisfy the request. Graceful degradation exists for outages; it is not a substitute for implementing the primary service.

Commands should be registered only to the configured development guild for validation before global deployment. Start the real bot only in a designated test scope, with local-only settings verified first. The implementation agent should make code/configuration reviewable before any broad rollout; this plan is not an instruction to publish development chatter into production channels.

## 15. Acceptance tests and release gates

Use deterministic fake provider/clock/Discord/store tests for state and error behavior, then real Mongo/Qdrant/SearXNG integrations, then local Gemma replay. Avoid tests that merely duplicate implementation details. A meaningful replay contains several turns and checks supported facts, not exact wording.

| Area | Required scenarios and pass condition |
| --- | --- |
| Local-only enforcement | All chat/control/extraction/embedding paths exercise local endpoints or test doubles; a network assertion fails any Gemini/cloud-inference request. Legacy mode aliases cannot bypass it. |
| Discord addressing | Mention, reply to bot, mention within reply, attachment-only addressed input, other-bot ignore, missing reply target, disabled mode, and opted-out observation behave as specified. |
| Identity and scope | Two users with the same display name keep separate IDs; same user in two guilds/channels has no implicit history carryover; restricted channel lore never appears in a broader audience. |
| Ordering and durability | Duplicate events, concurrent users, restarted processes, expired leases, stale workers, and failed CAS do not double-commit or mix turns. Kill/restart at each delivery/commit/job boundary and reconcile deterministically. |
| Continuity | Resume yesterday's inn scene after restart; retain the correct umbrella color, owner, location, promise direction, recipient, and fictional deadline. Switching local model/config does not destroy old turns. |
| Player agency | Suggested trip is not a completed journey; quoted speech and jokes are not user biography; Elaina cannot commit another player's emotions/actions. |
| Retcon/regenerate | Color correction supersedes old fact everywhere; replaced bot variant no longer contributes memories; non-head regeneration requires a branch; rejected continuations do not survive summaries. |
| Delete/retention | Delete during extraction/indexing and verify no resurrection; revoke source/ACL and retrieve nothing stale; expire a source according to the chosen evidence policy; old component tokens cannot restore/reset new epochs. |
| Memory extraction | Missing recipient/deadline, invalid source IDs, non-exact evidence, wrong direction, malformed JSON/schema, inferred authority, and unsupported conclusions are rejected or quarantined. |
| Retrieval | Paraphrased recall finds an older episode; exact names/lore terms find lexical matches; unrelated episode is not forced into context; stale vector records are filtered; corpus/model reindex does not mix dimensions. |
| Search and citations | Real self-hosted search returns at least one relevant public source; web fetch processes that source; final answer includes actual source links; invented IDs/URLs are not accepted; empty/blocked search produces an honest limitation. |
| Tools | Native tool cycle, streamed fragments, multiple IDs, invalid schema, unknown tool, timeout, repeated-call loop, max budget, dice idempotency, and native-tool-disabled JSON compatibility path all terminate correctly. |
| Web isolation | Private IPv4/IPv6, mapped IPs, DNS rebinding, redirect to private address, credentials, oversized/decompression payload, unsupported type, and embedded prompt injection cannot reach local services or mutate state. |
| Streams/delivery | Empty response, thinking-only length exhaustion, Unicode fragmentation, EOF without DONE, usage-only events, long Markdown, deleted message, rate limit, cancelled turn, and unhandled edit rejection all settle without timer leaks. |
| Outages | Mongo refuses durable advancement; Qdrant/embedding failure uses scoped lexical/recent fallback; SearXNG failure does not disable roleplay; no outage triggers cloud inference. |
| Regression | Existing non-chat command registration and representative command smoke tests remain unchanged; startup/shutdown do not create duplicate timers or prematurely exit. |

Build at least 30 scripted multi-turn replay scenarios: 10 scene/relationship continuity, 5 corrections/deletion, 5 lore/memory retrieval, 5 tool/factual tasks, and 5 style/OOC/multilingual cases. Run the critical control cases at least three times locally to reveal nondeterminism. Automated checks can validate schemas, source IDs, state, and tool usage; human review scores voice and player agency. Do not use Gemini or a paid judge to score outputs.

Release gates: all deterministic correctness/isolation/deletion tests pass; all required services successfully exercised; no cloud-inference requests; no critical continuity/agency failure in the replay set; factual tool replies always expose valid known source links; and a written local evaluation report includes failures, changes made, hardware/model settings, and latency/token measurements. One-off probe speeds are not acceptance thresholds. Record median/p95 warm turn and tool-turn latency, first-token latency, and extraction lag; tune for the actual deployment rather than promise unmeasured performance.

The final demo must show one continuous story across a restart, a remembered promise and relationship callback, an OOC correction, an older-lore semantic retrieval, a real web lookup with a link, a tool failure handled gracefully, and deletion verified across primary and derived stores. This demonstration is the integrated product, not seven disconnected mocks.

## 16. Deliverables and completion report

Deliver the working subsystem, manual controls, migration/index scripts, pinned service setup, local embedding setup, persona/lore seed, deterministic tests, replay fixtures, evaluated local results, and an operator guide. Document how to start services, register test commands, run tests, inspect memory provenance, rebuild indexes, retry failed jobs, and recover a stalled/uncertain turn.

Suggested scripts: `test:chat`, `test:chat:integration`, `chat:eval:local`, `chat:smoke:local`, `chat:migrate`, `chat:reindex`, `chat:ingest`. Keep ordinary unit tests offline and opt-in local service tests clearly named. Fake credentials and mock network clients must never reach production endpoints.

Rollback must disable chat or switch to an explicitly local-only compatibility handler. It must not restore the current `globalThis.operating_mode = "auto"` behavior that prioritizes Gemini. Database migrations are additive and versioned; rollback preserves new source records and disables their consumers rather than dropping data. Re-enabling uses reconciliation/index rebuild, not a fresh implicit memory wipe.

In the final implementation report, map every included requirement to concrete code and test evidence. Identify unverified live infrastructure explicitly. Do not claim complete integration if search is only mocked, embeddings never loaded, vector filters never exercised, or the Discord end-to-end demo remains untested. If a necessary live service is unavailable, finish all independent code/tests and identify the exact remaining activation step instead of substituting a cloud service.
