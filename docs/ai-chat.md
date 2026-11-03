# AI chat, scenes, memory, and lore

This is the user guide for Elaina's current local chat subsystem: talking to the
bot in Discord, keeping a roleplay scene, inspecting or deleting what the bot
remembers, and adding approved lore. It describes the commands and defaults in
this repository. A deployment can select a different allowed local profile,
context size, or service address; `/chat_config mode:Status` reports the live
values.

- [Non-WD command guide](../non-wd-commands.md) — the rest of the bot.
- [AI media guide](media-commands.md) — video, upscaling, and 3D commands.
- [AI image guide](../document.md) — the `/wd_...` image family.
- [Operator guide](chat-overhaul/OPERATOR_GUIDE.md) — MongoDB, Qdrant,
  embeddings, deletion epochs, reindexing, allowlists, and deployment checks.

> **Local-only by design.** The current chat path uses an operator-configured
> local inference service. It refuses a model name containing "Gemini" and has no
> cloud-generation fallback. The old `auto`, `online`, `online_lite`, `saving`,
> `standard`, and `uncensored` chat modes are not part of this subsystem.

## Quick start

Mention the bot or reply directly to one of its messages:

```text
@Elaina Good morning. What should we do about the locked cellar?
```

A first addressed message in a channel creates a scene automatically. You can
also create one explicitly:

```text
/scene new title:The Rainy Inn observe:true
```

Then talk normally. The bot answers in the channel and attaches response
controls to the delivered reply. You do not need to use a slash command for
ordinary conversation.

Useful first commands:

```text
/scene status
/scene character name:Mira description:A travelling cartographer
/memory show limit:10
/chat_config mode:Status
```

Chatting works in server channels and threads. Direct messages, webhooks, and
other bots are ignored. The bot needs the Discord message-content intent and the
normal channel permissions configured by the operator.

## What activates a reply

A message is **addressed** to the bot when at least one of these is true:

1. It mentions the bot.
2. It is a reply to a message authored by the bot, even without a mention.
3. It falls inside an active scene's addressed follow-up window for that user.

A mention is enough even if the message also replies to a deleted or
inaccessible target. A reply without a mention is only addressed after the bot
can resolve the target and confirm that the target author is the bot. Reply
targets are not fetched across channels.

Other activation rules:

- An addressed message may be image-only, with no text.
- A message that is not addressed is ignored by default. In an active scene
  with participant observation enabled, a message from a scene participant can
  be stored as an **observation** instead of receiving a reply. Observations do
  not by themselves enqueue a memory-extraction job; they become part of the
  scene's recent history.
- Observations require an active scene, an existing participant, participant
  observation enabled, and no personal memory opt-out.
- Only the bot mention is removed from the user text. Mentions of other people
  remain in the message.
- Slash commands are separate Discord interactions and do not become chat
  turns. Other bots, webhooks, disabled chat, and direct messages are ignored
  before a chat turn is created.
- An edited or deleted Discord message invalidates the stored turn derived from
  it. This is a cleanup signal, not a promise that every derived copy is removed
  immediately.

The bot does not run a language model on every channel message. A channel is
quiet unless someone addresses the bot or the scene is configured to observe
participants.

## Scenes, participants, and IC/OOC

A **scene** is the persistent context for one channel or thread. It has a scene
ID, a title, participants, a selected branch/head turn, and a continuity that
owns memory and access scope. Starting or ending a scene is not the same as
deleting stored data.

### Scene commands

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/scene new [title] [observe]` | Switches this channel to a fresh scene. Titles are limited to 100 characters. Older scenes are not deleted. `observe` sets whether participant messages are stored as observations (default on). | Any channel member |
| `/scene status` | Shows the active scene title, opaque scene ID, participant display names, raw-retention status, and whether external search is on. | Anyone in the channel |
| `/scene resume scene_id:<id>` | Makes an existing authorized scene active in this channel again. | Scene owner, server moderator, or an allowed audience member, with a compatible channel audience |
| `/scene end` | Ends the active scene and disables the channel binding. Stored records remain. | Scene owner, server moderator, or bot owner |
| `/scene character name:<name> [description:<text>]` | Sets your player character's display name and optional description for the active continuity. Names are limited to 80 characters and descriptions to 1,000. | Any participant in the active scene |
| `/scene settings [observe] [followup_seconds] [offline]` | Changes observation, addressed follow-up window (`0`–`90` seconds; `0` disables), or external web search for the scene. | Scene owner, server moderator, or bot owner |

Examples:

```text
/scene new title:Market District observe:false
/scene settings observe:true followup_seconds:20
/scene settings offline:true
/scene status
```

Once a scene has ended, a plain mention does not silently create a replacement.
Use `/scene new` or `/scene resume` first. A new scene is created automatically
only when this channel has no scene binding yet.

Notes on scene behavior:

- Addressed messages automatically add the author as a participant and extend
  the continuity audience for that scene.
- There is no separate "join" command. Addressing the bot joins you; passive
  observation only works after you are a participant.
- `/scene status` is how you see the current participant list.
- `offline:true` disables external web search and page fetching for the scene.
  Local memory, lore, and ordinary roleplay continue.
- `followup_seconds` lets the same user continue briefly without re-mentioning
  the bot. The bot records the follow-up user and allows up to three consecutive
  follow-ups in that window.

### IC and OOC

The bot recognizes light roleplay markers on input:

- `IC:` marks in-character text.
- `OOC:` marks out-of-character instructions.
- `(( ... ))` is treated as an out-of-character parenthetical.

Example:

```text
IC: I set the lantern on the counter.
OOC: Keep the reply short, and do not decide what my character does next.
IC: ((I am not comfortable with this direction.)) I step back outside.
```

The `IC:`/`OOC:` labels are control metadata and are removed from streamed and
delivered text. Parentheticals are treated as out-of-character input. The bot
should not print, quote, or explain the labels unless you ask about them.

Out-of-character corrections cannot rewrite another player's character facts.
A recognized `OOC:` retcon of someone else's character is refused unless the
requester is the bot owner or a server moderator. Scene creation is open to
channel members, but ending a scene or changing its settings is
owner/moderator work.

## Reply buttons

Each delivered chat response can carry these buttons:

| Button | Behavior |
| --- | --- |
| **Continue** | Asks the bot to continue its previous response seamlessly without repeating it. The new response is delivered in the channel. |
| **Regenerate** | Replaces the current scene head with a fresh response to the same established evidence. The old response is marked rejected and eligible memories derived from it are retracted. It does not delete the old Discord message. |
| **Scene Status** | Shows the current scene status in an ephemeral interaction reply. |
| **Debug** | Shows the turn ID, model, revision, tool-call count, and lifecycle. This button is only attached for the bot owner. |

Authorization and revision rules:

- A response control normally belongs to the player whose turn produced it.
  The configured bot owner can override that ownership check. A server
  moderator does not automatically inherit it.
- Controls are tied to a stored revision and load current authorization when
  clicked. A stale button or changed revision reports that the control is
  unavailable rather than acting on the wrong state.
- **Continue** and **Regenerate** only work while that turn is the current scene
  head. After later turns, use the newest response's controls.
- Interaction acknowledgements are ephemeral, but normal generated replies are
  posted in the channel.

The old **Forget Everything**, **User/Channel conversation**, and other legacy
buttons are not part of the current chat path. Use `/memory` and `/scene` for
those operations.

## Models, context, thinking, and style

### Local model profiles

`/chat_config` exposes fixed local profiles. These are routing labels and code
defaults, not claims that one model is best on an external benchmark. Actual
speed and quality depend on the installed weights, GPU, quantization, context,
and current load.

| `/chat_config mode` | Local model identifier | Quantization | Resource tier / gate |
| --- | --- | --- | --- |
| `gemma` | `unsloth/gemma-4-12B-it-qat-GGUF` | `UD-Q4_K_XL` | Standard |
| `qwen_27b` | `unsloth/Qwen3.8-27B-GGUF` | `UD-Q4_K_M` | High; requires enough local VRAM/RAM |
| `qwen_flash_next` | `unsloth/Qwen3.8-Flash-Next-GGUF` | `UD-IQ3_XXS` | Extreme; requires `CHAT_ALLOW_EXTREME_MODEL=true` and a restart |

`CHAT_MODEL` must be one of these exact identifiers. If
`CHAT_MODEL_QUANTIZATION` is set, it must match the selected profile or startup
fails. Leaving it unset selects the profile's variant. A deployment may have
only some of these profiles installed; selecting one the local service cannot
serve fails or degrades instead of falling back to another provider.

### `/chat_config`

Owner-only and ephemeral:

```text
/chat_config mode:Status
/chat_config mode:auto_local stream:true style:compact
/chat_config mode:gemma
/chat_config mode:qwen_27b style:expressive
/chat_config mode:qwen_flash_next
/chat_config mode:disabled
```

| Option | Values | Effect |
| --- | --- | --- |
| `mode` (required) | `disabled`, `status`, `auto_local`, `gemma`, `qwen_27b`, `qwen_flash_next` | `disabled` turns chat off; stored scenes and memory remain. `status` prints the live configuration. `auto_local` enables local chat with the current model; it does **not** select a model automatically. The three model names select a fixed local profile. |
| `stream` | boolean | Enables or disables streamed edits while generating. The default comes from the stored runtime configuration and is on unless changed. |
| `style` | `compact`, `emoji`, `expressive` | Sets the response style. Stored and restored on restart. |

`status` also reports provider reachability, quantization, context size,
streaming, style, and optional service states from the startup probe.

### Context and output defaults

These are configuration defaults; the live values can be higher or lower:

- `CHAT_CONTEXT_TOKENS` defaults to `8192` in code; deployments may request a
  larger context. If the loaded model reports a smaller context than configured,
  the capability probe marks the service degraded.
- `CHAT_MAX_OUTPUT_TOKENS` defaults to `512` and is capped at `1024`.
- `compact` style is the default. It bounds ordinary replies to roughly
  `CHAT_COMPACT_MAX_OUTPUT_TOKENS` (`192`) and `CHAT_COMPACT_MAX_WORDS` (`90`)
  while preserving a source appendix.
- `emoji` uses the same bounds, asks for at most one fitting emoji, and replaces
  recognized standalone action prose with an emoji.
- `expressive` allows longer roleplay prose up to the normal output limit.

Thinking is per-message only. Put `<think>` in an addressed message to request
the model's thinking mode; the default is off and startup rejects a global
"thinking on" setting. The old `<local>` and `<unsafe>` tokens are **not**
recognized by the current subsystem and have no special effect; there is no
uncensored model switch.

There is no user-facing context-window, temperature, or sampler option in chat.
Those are operator configuration or model defaults.

## Images in chat

The current message path understands image attachments:

- Supported image types are detected by image MIME type or a
  `png`/`jpg`/`jpeg`/`webp`/`gif` filename.
- Up to two images from the addressed message are downloaded and sent to the
  model as image parts.
- An image-only message counts as an addressed input if the bot is mentioned or
  replied to.
- Images attached only to the replied-to message are not automatically re-sent
  as new image inputs. The quoted text can still be used as context.
- Other attachment types are not transcribed, watched, or listened to. Audio
  and video files are **not** understood as chat input.

Vision is a property of the installed local model and runtime. At startup the
bot probes the local provider for status, context, tool support, and vision and
records the result; there is no automatic switch to a cloud vision model. If
the loaded model cannot accept image parts, that turn can fail or produce a
limitation instead of silently changing providers.

## Recent context, long-term memory, lore, and retrieval

The bot uses three different kinds of context. They have different lifetimes and
different controls.

| Layer | What it contains | How it is used |
| --- | --- | --- |
| **Recent context** | The latest committed/finalized turns in the current scene and branch (up to 30 are loaded, then bounded by a history budget). | Keeps the immediate conversation coherent. It is the first thing to age out of the prompt. |
| **Long-term memory** | Typed, evidence-backed records extracted after delivered turns: scene facts, object state, character facts, relationship events, promises, plans, user preferences, corrections, and conflicts. | Recalled later by hybrid retrieval and projected into the current scene state. Each record keeps source turn IDs and exact evidence quotes. |
| **Curated lore** | Operator-approved `.md`/`.txt` documents or public pages added with `/lore`. Text is chunked and indexed for retrieval. | Supplies setting/reference knowledge that is not part of the conversation. Added lore is scoped to its owner/guild unless the operator installs global lore separately. |

A background summarizer also creates **episode summaries** for older stretches
of a scene. Summaries preserve uncertainty and proposals and are indexed like
memories. This is how a long scene can still be recalled after the raw recent
turns have fallen out of the prompt.

Raw turns are subject to bounded retention (90 days by default in this
deployment; `CHAT_RAW_RETENTION_DAYS` can differ). Retention cleanup redacts
finalized turns and is not a substitute for `/memory clear`.

### One worked RAG example

Suppose you say in a scene:

> We hid the cellar key under the cracked blue vase.

Later you ask:

> Where did we leave the key?

The layers can answer in different ways:

1. If the earlier turn is still recent, it may be in the direct conversation
   history.
2. The memory extractor may store a scene fact such as "The cellar key is under
   the cracked blue vase," together with the exact quote and source turn. That
   is **provenance**: you can inspect where the claim came from.
3. If the scene is long, an episode summary may cover the same event.
4. If a lore document describes the cellar and its blue vase, its chunk can be
   retrieved as setting reference.
5. The retriever embeds the question and the records with the local multilingual
   E5 model, asks Qdrant for nearby vectors, also runs MongoDB full-text/lexical
   search, fuses the two ranked lists, and re-checks stored authorization for
   this guild, continuity, scene/audience, and deletion epoch where applicable.
6. The model receives the selected evidence as evidence, not as instructions.
   It should say it does not know if the evidence is absent, rather than invent a
   memory.

"RAG" here means retrieval-augmented generation: retrieve a small set of
relevant, authorized records and place them in the prompt before generating the
answer. It is not a separate cloud search product, and the bot does not treat a
retrieved sentence as a command.

### Embeddings, lexical search, and provenance

- The embedding model is pinned to `Xenova/multilingual-e5-small` at a fixed
  revision. It produces 384-dimensional vectors on CPU by default. Query and
  passage prefixes are applied separately.
- MongoDB provides lexical/full-text search over memories, episodes, and lore
  chunks. Qdrant provides vector similarity. The hybrid retriever fuses the
  lists with reciprocal-rank fusion and adds small recency/salience adjustments.
- Results are re-authorized against stored records before the prompt is built.
  A vector hit alone is not permission to read the record.
- Each memory has `sourceTurnIds` and `evidence` quotes. `/memory show` includes
  evidence IDs; `/memory export` returns the authorized records as JSON.
- If the embedding or Qdrant path fails, the turn can fall back to lexical and
  recent evidence rather than failing roleplay. The failure is recorded as a
  degraded retrieval result.

### Web tools and sources

The tool registry includes local time, dice, memory search, and lore search.
When the operator has configured SearXNG and the safe web fetcher, it can also
use `web_search` and `web_fetch`.

- `web_search` sends a bounded public query to the self-hosted SearXNG service.
- `web_fetch` reads a page returned by search, or a URL explicitly supplied by
  the user. It blocks private/local addresses, credentials in URLs, unsupported
  content types, oversized bodies, and redirect abuse.
- Fresh-information questions (for example weather, prices, scores, schedules,
  officeholders, or "latest" news) can force a web search when external search
  is enabled for the scene.
- `/scene settings offline:true` disables those tools for that scene.
- Only sources actually returned by the tools are rendered. Unknown citation
  markers and unknown URLs are stripped; known sources are listed at the end,
  normally as `<https://...>` so Discord does not create an embed for each one.

If SearXNG is down, current facts cannot be verified. The honest result is a
limitation in the reply, not a fabricated citation and not a cloud fallback.

## Memory and lore commands

### `/memory`

Responses are ephemeral. Command output is bounded to Discord limits.

| Subcommand | Options | Purpose |
| --- | --- | --- |
| `/memory show` | `kind`: all, scene_fact, relationship_event, promise; `limit:1-25` (default 10) | Shows active memory records you are authorized to read, with memory IDs and evidence turn IDs. |
| `/memory forget` | `memory_id` (required) | Forgets one authorized memory and eligible records derived from its source turn. |
| `/memory clear` | `scope`: my_scene, my_continuity, shared_scene (required) | Prepares a confirmed deletion of stored bot content. The `shared_scene` choice requires scene owner/moderator authority. |
| `/memory export` | `scope`: scene, my_data (default `scene`) | Returns an ephemeral JSON attachment of authorized stored turns and memories. Exports over 8 MiB must be narrowed. |
| `/memory optout` | `enabled`: true or false (required) | `enabled:true` **opts out** of durable personal memory extraction. `enabled:false` re-enables it. |

Examples:

```text
/memory show kind:scene_fact limit:10
/memory forget memory_id:1f0c2a8e-...
/memory clear scope:my_scene
/memory export scope:my_data
/memory optout enabled:true
```

What each scope means:

- `my_scene` removes your data in the current scene, including source turns,
  personal memories, and eligible derived records.
- `my_continuity` removes your data across the current continuity.
- `shared_scene` removes the entire active shared scene; only the scene owner,
  a server moderator, or the bot owner can request it.

`/memory clear` is a two-step operation: the command returns a **Confirm**
button tied to the requesting user, current scope, revision, and a short expiry
(about ten minutes). The stored confirmation also records the deletion epoch
captured at preparation time. Confirming raises the continuity deletion epoch,
cancels matching jobs, redacts source and derived records, removes matching
vector points when Qdrant is available, and queues rebuild/reindex work. The
reply reports whether verification is complete. Existing Discord messages are
not deleted, and infrastructure backups are not automatically included. Treat
deletion as asynchronous cleanup, not instant erasure from every copy.

`/memory optout enabled:true` stops durable personal memory extraction from
your messages. It does not prevent the current addressed turn from being
processed and retained for recent context and retention, and it does not delete
records already stored. Use `/memory clear` for deletion. `enabled:false`
re-enables extraction.

### Corrections and forgetting

If you correct a fact in conversation, the extractor can create a correction or
conflict record that targets an eligible earlier memory. A correction is
authorized only for the bot owner, a moderator, the memory's owner, or the player
who is the subject of that record. A correction marks the earlier memory
superseded or retracted; it does not rewrite history or delete the source turn
by itself. Use `/memory forget` for one record, or `/memory clear` for an entire
scope. You cannot rewrite another player's character facts or private memory
unless you have the required scene/owner authority.

The **bot owner** can additionally use:

```text
/remove_channel_context channel:#some-channel
```

This clears the active stored scene and derived memory for that channel. It is
not the same as deleting the Discord messages.

### `/lore`

Lore management is for the bot owner or a server moderator. All output is
bounded.

| Subcommand | Options | Purpose |
| --- | --- | --- |
| `/lore add` | exactly one of `file` or `url`; optional `label` | Queues ingestion of one `.md`/`.txt` attachment up to 1 MiB, or one public HTTP(S) URL without credentials. |
| `/lore remove` | `source_id` (required) | Removes an authorized lore source and blocks it from retrieval. |
| `/lore status` | `limit:1-25` (default 10) | Shows recent lore source keys and lifecycle states. The bot owner sees all; a moderator sees the current guild's restricted lore. |
| `/lore reindex` | optional `source_id` | Queues a reindex without changing access. Omit `source_id` to reindex the eligible corpus. |

Examples:

```text
/lore add file:[attach worldbook.md] label:Rainy Inn setting
/lore add url:https://example.com/public-lore label:Public reference
/lore status limit:10
/lore reindex source_id:<source_key>
/lore remove source_id:<source_key>
```

Replace `<source_key>` with the exact key shown by `/lore status`, including any prefix. The original URL by itself is not necessarily the stored key.

Lore added through the slash command is queued as **restricted lore** for the
adding operator's guild and audience (initially that operator). The command
does not silently publish it to every scene. Global lore is an operator-side
corpus, not a user-facing publish action. Ingestion rejects binary/oversized
files and unsafe URLs; the underlying service also applies fetch and chunking
limits.

## What leaves the bot's machine

This guide does not claim end-to-end encryption or that "everything stays on
your device." The deployed topology can vary. In the current design:

- Chat text, selected images, recent turns, memory records, and lore passages
  are sent to the configured local inference service over the private network
  or loopback. That service may be on another machine.
- MongoDB stores turns, memory, scenes, relationships, lore metadata, and job
  state. Qdrant stores vectors and authorization payloads. Both are operator
  services, not necessarily on the Discord host.
- Public web searches are sent to the operator's SearXNG instance, which queries
  public search engines. `web_fetch` retrieves public pages.
- Media commands upload references to ComfyUI/CelForge and may upload large
  output files to Catbox, an external public file host, when Discord's
  attachment limit is exceeded.
- Discord itself stores channel messages and attachments under Discord's terms.

Do not put secrets, credentials, or sensitive real-world facts into chat or
media prompts. Use `/memory optout enabled:true` to reduce durable extraction,
but use a deletion scope when you need stored data removed. Operators should
review the [operator guide](chat-overhaul/OPERATOR_GUIDE.md) for retention,
allowlists, backups, and deployment controls.

## Roleplay fiction versus facts about you

The memory system is designed to keep these separate:

- **Fictional facts** are things true inside the scene: a character's eye
  color, the inn's locked cellar, a promise between characters, or Elaina's
  fictional relationships.
- **Real-user facts** are things you explicitly state about yourself outside
  the fiction, such as a preference for short answers or a timezone.

The extraction instructions tell the model not to infer real-user details from
roleplay, and player actions, decisions, feelings, and promises require that
player as the explicit source. A proposal remains proposed until the target
accepts it. Saying "my character is a knight" does not mean the bot should store
"the user is a knight" as a real-world fact. Conversely, an explicit real
preference can be stored as a scoped preference and later forgotten.

Roleplay is still processed by real services. Separation of fiction from fact
is a data-model and prompt rule, not a promise that a fictional statement can
never influence a reply.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| The bot ignores an ordinary message. | Mention it or reply to one of its messages. Direct messages, webhooks, and other bots are ignored. |
| The bot stops replying after `/scene end`. | Start a new scene with `/scene new` or resume an authorized scene with `/scene resume`. |
| No chat response at all. | The owner may have set `/chat_config mode:disabled`. Ask them to check `/chat_config mode:Status`. |
| A turn times out. | The local model may be busy, loading, or out of context. Retry after the current generation. There is no cloud fallback. |
| "I could not complete that turn without risking the scene state." | A persistence, lease, or commit check failed. Retry; report repeated failures to the operator. |
| "This control is stale" or "Only the current scene head..." | The scene advanced or the button belongs to an older turn. Use the newest response's controls. |
| "You are not authorized..." | The action needs the scene owner, a moderator, or the configured bot owner. |
| Images are not understood. | Attach them to the addressed message itself, use a supported image type, and check that the loaded model supports vision. Audio/video are not understood. |
| Current facts are not answered. | SearXNG may be unavailable, or the scene may have `/scene settings offline:true`. The bot should state the limitation rather than invent a source. |
| Memory recall seems weaker than usual. | Mongo is required for durable turns. Qdrant/embedding failures can reduce retrieval to lexical/recent evidence; the bot should continue with a degraded result. |
| Buttons report stale after later chat or a changed state. | Controls are resolved from stored state. A changed revision/epoch makes old controls stale; use the latest message or rerun the command. |

There is no speculative "try Gemini" or online-mode fallback. If the configured
local model or required persistence is unavailable, the correct behavior is to
report the limitation or fail the turn.

## Further reading

Primary and deeper references:

- [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)
  — the original RAG paper: retrieve passages, then condition generation on
  them.
- [Text Embeddings by Weakly-Supervised Contrastive Pre-training](https://arxiv.org/abs/2212.03533)
  — the E5 paper; explains the embedding model family used for local vectors.
- [Xenova/multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small)
  — the pinned local embedding artifact.
- [Qdrant concepts](https://qdrant.tech/documentation/concepts/) — collections,
  points, payloads, filtering, and vector search concepts used by the index.
- [SearXNG documentation](https://docs.searxng.org/) — self-hosted search
  configuration and the search API used by the web tool.
- [Chat overhaul operator guide](chat-overhaul/OPERATOR_GUIDE.md) — Mongo/Qdrant
  setup, deletion epochs, reindex lifecycle, allowlists, smoke tests, and
  recovery procedures.
- [Chat overhaul implementation plan](chat-overhaul/IMPLEMENTATION_PLAN.md) —
  the full data model and acceptance requirements.
- [H3 benchmark](h3-benchmark.md) and [media commands](media-commands.md) — the
  video/media side, including its own local model and hosting caveats.
- [High-level architecture overview](ai-how-it-works.md) — a shorter tour of how
  the pieces fit together.
