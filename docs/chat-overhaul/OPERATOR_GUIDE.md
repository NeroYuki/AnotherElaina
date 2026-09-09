# Chat Overhaul Operator Guide

This guide covers the integrated local-only chat runtime described by `IMPLEMENTATION_PLAN.md`. It does not authorize Gemini, another cloud inference provider, a paid evaluator, or a cloud fallback. Public SearXNG queries contain only the minimum public search subject.

## Runtime configuration

Start from `.env.chat.example` and merge the required values into the deployment environment. Do not commit credentials. Load dotenv before requiring any `chat/` module.

The initial tested generation model is `unsloth/gemma-4-12B-it-qat-GGUF`; deployment now requests and verifies a 16,384-token context, with thinking disabled by default. `CHAT_LOCAL_ONLY` must remain `true`. The embedding artifact is pinned to `Xenova/multilingual-e5-small` revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`; this revision was read from the Hugging Face model API on 2026-09-09. Runtime remote model loading remains disabled after explicit setup.

Generation models use an exact allowlist and fixed GGUF variants:

| `/chat_config` mode | `CHAT_MODEL` | Quantization | Gate |
| --- | --- | --- | --- |
| `gemma` | `unsloth/gemma-4-12B-it-qat-GGUF` | `UD-Q4_K_XL` | none |
| `qwen_27b` | `unsloth/Qwen3.8-27B-GGUF` | `UD-Q4_K_M` | sufficient local VRAM/RAM |
| `qwen_flash_next` | `unsloth/Qwen3.8-Flash-Next-GGUF` | `UD-IQ3_XXS` | `CHAT_ALLOW_EXTREME_MODEL=true` plus sufficient resources |

Leave `CHAT_MODEL_QUANTIZATION` empty to select the profile variant automatically. If set, it acts as an assertion and startup fails when it does not match the selected profile. The workload manifest carries both `CHAT_CONTEXT_TOKENS` and the GGUF variant. `npm run chat:smoke:local` performs a completion, reads `/api/inference/status`, and fails if the loaded context is smaller than configured. `/chat_config mode:Status` reports the runtime model, quantization, and context. Re-register the development-guild slash commands after upgrading because the Qwen choices changed.

`CHAT_EPISODE_INPUT_TOKENS` bounds background episode-summary input separately from ordinary chat context. The summarizer strips Mongo IDs and operational metadata, keeps only the canonical speaker/message/assistant transcript, and retries once with half the budget if the backend still reports a context overflow.

`CHAT_RESPONSE_STYLE` controls Discord response density. `compact` is the default and bounds ordinary replies to `CHAT_COMPACT_MAX_OUTPUT_TOKENS` plus `CHAT_COMPACT_MAX_WORDS` while preserving citation appendices. `emoji` applies the same bounds, asks the model to avoid narrated body language, and replaces recognized standalone action prose with at most one fitting emoji. `expressive` restores longer roleplay prose up to `CHAT_MAX_OUTPUT_TOKENS`. The owner can change the active style with `/chat_config`; the selection is persisted in `chat-runtime-config` and restored on restart.

All web source URLs are rendered as `<https://...>` so Discord does not create one embed preview per citation.

Run `npm run chat:setup:embedding` once during explicit setup. That command alone permits the pinned artifact download, verifies the 384-dimensional output, and stores it under `CHAT_EMBEDDING_CACHE`; normal runtime loading remains offline-only.

Private DNS names used for inference or service smoke checks must be listed in `CHAT_ALLOWED_INFERENCE_HOSTS` or `CHAT_ALLOWED_SERVICE_HOSTS`. Literal loopback and RFC 1918 addresses are accepted automatically. This allowlist is for operator-selected infrastructure only; it is not an inference-provider fallback list.

When the bot runs on a separate Linux host, AI, Qdrant, and SearXNG URLs use the Windows service machine's stable LAN address or private DNS name. MongoDB runs locally on Linux and remains at `127.0.0.1:27017`. Configure `CHAT_SERVICE_BIND_ADDRESS` to the Windows machine's concrete LAN address before starting Qdrant/SearXNG, and run `npm run chat:smoke:remote` on Linux. Remote smoke rejects loopback AI, Qdrant, and SearXNG endpoints while permitting Linux-local MongoDB. Restrict Windows ports 6333 and 8088 to the Linux bot host; the existing AI proxy and Mongo deployments remain separately managed.

## Initialization order

1. Load environment variables and validate local-only configuration.
2. Await the existing Mongo connection and create or verify chat indexes.
3. Construct the repository, conversation service, background reconciliation, and deletion-epoch workers.
4. Load the pinned CPU embedding artifact from `CHAT_EMBEDDING_CACHE` with remote loading disabled.
5. Probe Qdrant, SearXNG JSON search, and local provider capabilities; record unavailable optional services as degraded.
6. Configure the three commands and persistent component router with the initialized chat service.
7. Register message and interaction intake only after dependencies are ready.
8. Log in to Discord in a designated test scope.

Mongo unavailability must block persistent turns. Qdrant or embedding unavailability may use authorized lexical/recent fallback. SearXNG unavailability may disable current web lookup but must not disable ordinary roleplay or invoke cloud inference.

## Discord integration

Normalize message events with `chat/discord/ingest.js` before persistence:

```js
const { normalizeDiscordMessage } = require('./chat/discord/ingest');

const normalized = await normalizeDiscordMessage({
    message,
    botUserId: client.user.id,
    enabled: chatConfig.enabled,
    observationEnabled: binding?.observeParticipants,
    isParticipant: binding?.participantIds.includes(message.author.id),
    isOptedOut: await repository.isMemoryOptedOut(message.author.id),
    replyTimeoutMs: 1500
});
```

The result is `{ kind: "addressed" | "observation", reason, event }` or `{ kind: "ignored", reason }`. `event.eventId` is `discord:<guildId>:<channelId>:<messageId>`. The event retains raw content, bot-mention-stripped content, stable author IDs, explicit IC/OOC segments and offsets, reply provenance, mention IDs, timestamps, and bounded attachment metadata. Only the bot mention is removed. Other mentions remain participant references.

Reply fetch stays within `message.fetchReference()` or the message's accessible channel and has a bounded deadline. A mention remains addressed even when its reply target was deleted. A reply without a mention is addressed only after proving the target author is this bot. Other bots, webhooks, DMs, disabled mode, opted-out observations, and unrelated passive attachments are rejected before persistence.

Configure commands after constructing the service:

```js
const scene = require('./commands/chat/scene');
const memory = require('./commands/chat/memory');
const lore = require('./commands/chat/lore');
const components = require('./chat/discord/components');

const { configuredOwnerIds } = require('./chat/discord/permissions');
const commandDependencies = { chatService, repository, ownerIds: configuredOwnerIds(), clock };
scene.configure(commandDependencies);
memory.configure(commandDependencies);
lore.configure(commandDependencies);
components.configure(commandDependencies);
```

Each command also exposes `init(dependencies)`. Calling `init()` without arguments is intentionally side-effect free so the current recursive command loader can discover modules before the chat service is ready.

Persistent buttons do not use collectors. Route them centrally before the generic command-only interaction guard:

```js
client.on('interactionCreate', async interaction => {
    if (interaction.isButton() && await components.handle(interaction)) return;
    // Existing slash/select routing follows.
});
```

Button IDs contain only a version, action code, opaque entity ID, and revision. They never contain memory text or authorization claims. `getControlContext` must load current authorization and revision from authoritative storage on every click. Restarts therefore do not invalidate a valid operation, while changed revisions and deletion epochs make old controls stale.

## Service contract

Command and component modules require this chat-service surface:

```js
await chatService.executeControl({
    action,
    actor: { userId, username, isOwner, isModerator },
    scope: { guildId, channelId, threadId },
    input
});

await chatService.getControlContext({
    action,
    entityId,
    revision,
    actor,
    scope
});
```

`executeControl` returns `{ ok, message, components?, export?, confirmation? }`. `message` is user-safe and is truncated before Discord delivery. `export` must already be ACL-filtered plain JSON. `confirmation` is `{ id, revision, expiresAt }`, where `id` is an opaque 1-64 character stored token. Broad memory clear creates this record first; the button click resolves it again and executes `memory_clear` only for the issuing user/current scope/current epoch.

`getControlContext` returns the authoritative `revision` and may return `allowedUserId`, `allowedUserIds`, `ownerOnly`, `moderatorOnly`, and `expiresAt`. The service remains responsible for resource-level ACL checks, scene ownership, canonical-head requirements, audience compatibility, confirmation consumption, idempotency, and deletion-epoch comparison. Discord permission flags alone never authorize access to private records.

Supported command actions are:

| Action | Input |
| --- | --- |
| `scene.new` | `title`, `observeParticipants` |
| `scene.status` | empty object |
| `scene.resume` | `sceneId` |
| `scene.end` | empty object |
| `scene.character` | `name`, `description` |
| `scene.settings` | `observeParticipants`, `followupWindowSeconds`, `offline` |
| `memory.show` | `kind`, `limit` |
| `memory.forget` | `memoryId` |
| `memory.clear.prepare` | `scope` |
| `memory.export` | `scope` |
| `memory.optout` | `enabled` |
| `lore.add` | `label`, `source` |
| `lore.remove` | `sourceId` |
| `lore.status` | `limit` |
| `lore.reindex` | optional `sourceId` |

Persistent component actions are `continue`, `regenerate`, `debug`, `scene_status`, `memory_clear`, and `scene_end`. Debug and all command output are ephemeral. Continue and regenerate may cause the service to deliver a normal channel response, but their interaction acknowledgement remains ephemeral. Regeneration must require the current head or an explicit branch operation in the service.

## Command rollout

Register `/scene`, `/memory`, and `/lore` only in one configured development guild first. Build the request body from each module's `data.toJSON()`. Do not use a global application-command route during validation. The repository's existing `register-command.js` targets every guild in `config.json`, so verify its target list before using it for a test rollout.

Validate these behaviors in a private test channel before adding another guild: mention, reply to a bot-authored message, mention inside a reply, addressed image-only input, ignored bot/webhook, stale button, unauthorized memory access, cross-channel scene resume rejection, and ephemeral export.

## Offline tests

Run all owned deterministic tests without starting Discord or network services:

```powershell
node --test tests/chat/unit/*.test.js tests/chat/replay/*.test.js
node scripts/chat/evaluate.cjs
```

The second command validates fixture shape and category counts only. The fixture at `tests/chat/replay/fixtures/scenarios.json` contains 30 multi-turn scenarios: 10 scene/relationship continuity, 5 correction/deletion, 5 lore/memory retrieval, 5 tool/factual, and 5 style/OOC/multilingual.

## Local service smoke

Start the operator-approved Mongo, Qdrant, SearXNG, and local inference proxy first. Then run:

```powershell
node scripts/chat/smoke_local.cjs --strict
```

The smoke script exercises a visible thinking-disabled local completion, Qdrant collection listing, a real SearXNG JSON query, and Mongo ping when configured. Without `--strict`, only local inference is a release-blocking script failure; every degraded check is still printed. Release validation must use `--strict`. SearXNG returning HTTP 403 usually means JSON is missing from `search.formats`.

The smoke script does not prove retrieval quality, index ACL filtering, safe-fetch isolation, or deletion correctness. Those require integrated tests against the initialized chat service.

Run the opt-in live integration suite after strict smoke:

```powershell
$env:CHAT_INTEGRATION = 'true'
npm run test:chat:integration
```

This suite performs a real SearXNG query, an ACL-scoped embedding/Qdrant round-trip, and a complete synthetic Discord turn using an isolated temporary Mongo database. It does not log in to Discord or send a real message.

## Local replay evaluation

Direct local-provider capture:

```powershell
node scripts/chat/evaluate.cjs --run --output data/chat-evaluation.json
```

Select one scenario with `--scenario scene-umbrella-restart`. Correction/deletion scenarios run three times by default; change the bounded repeat count with `--critical-runs 1..10`.

Direct-provider mode captures visible replies and latency but cannot execute persistence operations encoded in fixtures. It marks expectations for human review and must not be cited as an integrated pass. For integrated evaluation, set `CHAT_EVAL_ADAPTER` to a repository-relative CommonJS module that exports `{ localOnly: true, runScenario }` or `{ createAdapter }`. The adapter receives each complete scenario and should drive fake Discord, repository restart, tools, and state assertions. `runScenario` returns `{ ok, latencies, ...details }`.

No paid or cloud judge is used. Review voice, player agency, unsupported claims, and citations manually. Record hardware, model identifier, context/output settings, median/p95 turn latency, first-token latency, tool-turn latency, extraction lag, failures, and changes made. A transport pass is not a semantic release pass.

## Lore operations

`/lore add` accepts exactly one `.md`/`.txt` Discord attachment up to 1 MiB or one explicit HTTP(S) URL without credentials. The command performs boundary validation; the ingestion service must still apply safe-fetch DNS/IP/redirect/content limits, source hashing, ACLs, and binary rejection. Never ingest a repository path, `.env`, hidden file, arbitrary channel history, or recursive directory.

`/lore reindex` preserves source records and ACLs. Build a new revision-specific Qdrant collection, verify dimensions and filtered retrieval, then swap the configured alias. Never mix embedding revisions in one collection. `/lore remove` must block authoritative retrieval before asynchronous vector cleanup.

## Memory and deletion

`/memory show` and `/memory export` expose only currently authorized records and provenance in ephemeral responses. `/memory optout enabled:true` disables durable personal extraction; it does not prevent answering the current addressed message. `/scene new` starts a fresh scene and is not deletion. `/scene end` closes a scene and is not deletion.

Broad `/memory clear` is a two-step operation tied to user, scope, expiry, revision, and deletion epoch. On confirmation, increase the epoch or install the tombstone first, then cancel jobs and purge/redact primary and derived records. Verify turns, memories, relationships, episodes, chunks, Qdrant points, tool caches, attachment captions, summaries, and process caches. Delayed workers must compare the epoch again before publication. Existing Discord messages and infrastructure backups are not deleted unless separately included and verified; command text must not claim otherwise.

The initial raw-message/tool retention is 90 days. Fictional scene time, display timezone, and UTC retention timestamps are separate clocks.

## Recovery

For a stalled turn, stop new intake for its continuity, inspect the authoritative continuity commit pointer and lease fencing token, inspect pending delivery IDs, and reconcile against a bounded scan of recent bot messages. Do not generate a replacement while an earlier send is ambiguous. Mark an inconclusive send as uncertain delivery for explicit retry/status handling.

For failed background jobs, fix the unavailable dependency, verify source epoch/revision/canonical ancestry, and retry by idempotency key. Reconciliation must recreate missing derivation jobs for committed turns. It must not publish work from a deleted epoch or displaced generation variant.

For Qdrant corruption or embedding revision change, keep Mongo authoritative, disable semantic reads, create a new revision-specific collection, reindex eligible records with ACL payloads, validate dimensions/filters, and atomically change the alias. Do not drop Mongo source records.

For a search outage, report inability to verify current facts and keep local roleplay available. Never switch operating mode to legacy `auto`, `online`, or `online_lite`.

## Shutdown and rollback

Shutdown order is stop intake, abort or bounded-drain turns, stop background admission, release leases, stop timers/workers, flush essential metadata, and close Mongo once. Existing process signal handlers must delegate to this sequence before exit.

Rollback uses `/chat_config mode:Disabled` or stops the chat intake while preserving the additive Mongo records. Do not restore Gemini-first `globalThis.operating_mode = "auto"`. Re-enable with reconciliation and index verification, not an implicit memory wipe.

## Release gates

Do not broaden rollout until deterministic tests pass, strict smoke successfully exercises all configured services, integrated replay assertions pass, no network trace reaches cloud inference, factual tool replies expose only known returned source links, deletion shows no resurrection, and the restart/relationship/retcon/RAG/search/deletion demo succeeds in the designated test guild.
