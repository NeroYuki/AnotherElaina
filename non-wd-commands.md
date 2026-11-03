# Elaina Mk. 2 — Non-WD Command Documentation

!!! warning WIP
     This is a work in progress and thus incomplete

This document covers everything the bot can do **other than** the AI image generation commands (the `/wd_...` family). For image generation, see the main [AI Image Documentation](document.md). For video and 3D, see [AI media commands](docs/media-commands.md). For chat, scenes, memory, and lore, see the [AI chat guide](docs/ai-chat.md).

[TOC3]

### Quick Start For Discord Newcomers

- **Slash commands**: Type `/` in the chat box, pick a command from the menu (or keep typing its name), fill in the options, press Enter. Options marked with `*` are required; everything else is optional.
- **Attachments**: Commands that take a file (e.g. `/osu_mai_mod beatmap_file:`) need you to attach the file to the message as usual.
- **Subcommands**: Some commands group multiple actions together (e.g. `/shipgirl_multi start`, `/shipgirl_multi stop`). Just pick the subcommand after the main command.
- **Context menus**: Right-click (or tap-and-hold on mobile) a message containing an image → **Apps** → find extra actions like "Find sauce" and "SD Image Info".
- **Chatting**: Mention the bot (`@Elaina ...`) or reply to one of its messages in a server channel. See the [AI chat guide](docs/ai-chat.md).
- **Cooldowns**: Commands have per-user cooldowns; if the bot tells you to slow down, just wait a bit.

***

### Chatting With The Bot (no slash command needed)

The bot doubles as a local AI chat companion with a persistent scene. To talk to
it, **mention it** or **reply to one of its messages**:

```
@Elaina hello! how are you today?
```

- The first addressed message in a channel creates a scene automatically.
  `/scene new` starts a fresh scene, `/scene status` shows the active scene and
  participants, `/scene character` sets your player character, and `/scene end`
  closes the scene without deleting its records.
- Addressed messages automatically join you as a participant. When participant
  observation is enabled, later messages from participants can be stored as
  passive observations; the bot does not reply to those.
- Attach **images** to the addressed message and the bot can use them (up to
  two). Audio and video attachments are not understood as chat input.
- Chat is **local-only** now. There is no Gemini/online mode, no automatic
  online/local mode selection, and no uncensored switch. `<think>` requests
  thinking for one message; the old `<local>` and `<unsafe>` tokens have no
  effect.
- Delivered replies can have **Continue**, **Regenerate**, and **Scene Status**
  buttons; the **Debug** button is only shown to the bot owner. The old
  **Forget Everything** and user/channel-conversation buttons are gone.
- Use `/memory` to show, forget, delete, export, or opt out of durable personal
  memory, and `/lore` (owner/moderator) to add curated reference text. The bot
  owner configures the local model profile, streaming, and response style with
  `/chat_config`.

Full details, examples, permissions, privacy notes, and troubleshooting:
[AI chat guide](docs/ai-chat.md). For video and 3D commands, see
[AI media commands](docs/media-commands.md).

***

### Slash Commands

#### /ping

The classic health check. Replies `Pong!` and attempts to reconnect to the AI server. Useful to check whether the bot is alive.

#### /trivia

Trivia quiz with questions from a local question bank.

```
/trivia type:Multiple Choices category:3
```

- `type` — `Multiple Choices` (1) or `Short Answer` (2)
- `category` — a number selecting one of the bundled question categories (general, anime, games, science, geography, ...). Leave empty to get a random one

Questions are multiple-choice with A/B/C/D buttons, or free-text answers for short-answer mode.

#### Shipgirl Quizzes (/shipgirl, /shipgirl_mc, /shipgirl_multi, /shipgirl_config)

A family of "guess the ship girl" quizzes using the bundled shipgirl image database (Azur Lane, Kantai Collection, Warship Girls R, Axis Senki, Abyss Horizon, Black Surgenights, Blue Oath, Velvet Code, Victory Belles, Battleship Girl, Battleship Bishoujo Puzzle and more).

Common options across all shipgirl commands:

- `category` — which series to draw from (or `MULTIPLE` to mix several)
- `max_rating` — maximum risque rating of shipgirls included: `general`, `sensitive`, `questionable`, `explicit`
- `hardmode` — image processing modes that make the quiz harder: silhouette, blur (extreme), crop (1/9 or 1/25, center/random), or crop specific body parts (head, face, breast, eyes)
- `easymode` — hint modes: name hint, progressive name hint, nation hint, hull type hint, category hint, description hint (description hint requires hardmode). Not available in `/shipgirl_mc`
- `base_only` — only use base outfits/forms, no alternative skins
- `nation` / `hull_type` — restrict the quiz to a specific nation or ship class (available in `/shipgirl`)

The variants differ in format:

- **/shipgirl** — one-off quiz, type the answer in chat (uses fuzzy matching, `best_effort_mode` makes name matching more lenient for long/difficult names)
- **/shipgirl_mc** — one-off **multiple choice** quiz answered with buttons; `question_type` lets you pick what is being asked (who is this / which game / hull type / nation / birthday / real-life height / real-life weight / random)
- **/shipgirl_multi** — multi-round quiz with a scoreboard:
	- Subcommands: `start`, `stop`, `pause`, `resume`
	- `round` — number of rounds (default 10), or number of lives in Survival mode (default 3)
	- `scoring_mode` — `Classic` (points per correct answer), `Speed` (faster answers score more) or `Survival` (lose a life on wrong answer)
	- `time_multiplier` — scales the time limit per question (0.1–5.0, default 1.0)
- **/shipgirl_config** — save your preferred quiz settings so you don't have to retype them: subcommands `set`, `check`, `reset`. `question_type` here also supports the multiple-choice question style

#### /kansenindex

Search the **KansenIndex** database (Azur Lane CG archive) and browse results with buttons.

```
/kansenindex search keyword:new jersey sort_by:date_new
```

Options:

- `keyword` + `keyword_mode` (`all`, `char_name`, `modifier`, `description`) — search by character/alias/filename; `strict` toggles exact match
- `franchise`, `nation`, `ship_type` — filter by series/country/ship class; pick `MULTIPLE` to select several via a follow-up menu
- `outfit_type` — base / oath / retrofit / damage / outfit / alt-only / censored
- `rating` — general / sensitive / questionable / explicit (NSFW results are only shown in NSFW channels)
- `has_voice` — only entries with voice lines
- `illustrator` — search by artist
- `sort_by` — date (new/old), character name (A-Z / Z-A), file size (large/small), or `random`

After the search you can flip through the results with **◀ Prev / Next ▶** buttons, and if the entry has voice lines, a **🔊 Voice Lines** button will play them.

#### /malody

!!! error Disabled
	All Malody subcommands (`profile`, `chart`, `recent`) are currently **disabled** ("This command is disabled due to the web scraper being broken"). There is no ETA for when they return.

#### /osu_mapperinator

Auto-generate a playable osu! beatmap from an audio file using the osu!Mapperatorinator AI.

```
/osu_mapperinator audio_file:[.mp3] difficulty:5 model:v32
```

- `audio_file` — the song to map (required, Discord's upload limit applies)
- `model` — mapperinator model: `v30` (default), `v31`, `v32-mini`, `v32`
- `difficulty` — target star rating (0–30, default 5)
- `sv_tick_rate` — slider velocity (and optional tick rate), e.g. `1.4[:1]`
- `cs` / `od` / `ar` / `hp` — circle size / overall difficulty / approach rate / health drain (defaults 4 / 8 / 9 / 5)
- `seed` — generation seed for reproducibility
- `mapper_id` — specify a mapper ID to imitate

Generating a map takes a while (the bot will queue your request); you get the finished `.osz` when it's done.

#### /osu_mai_mod

Run **MaiMod** and **MapsetVerifier** analysis on a beatmap to get a full quality report (aim/flow/balance/tap skill ratings, suggestions, and issues).

```
/osu_mai_mod beatmap_file:[.osu or .osz] audio_file:[.mp3]
```

- `beatmap_file` — the `.osu`/`.osz` file to analyze (required)
- `audio_file` — the audio used by the beatmap (required if you passed a raw `.osu` file)
- `show_raw_value` — show numeric skill values next to the icons
- `ignore_suggestion` / `ignore_issue` — hide suggestions / hide everything but major issues
- `only_maimod` / `only_mv` — run only one of the two analyzers

After the analysis you pick which difficulty to review via a menu. This one also runs on a queue, so be patient if the server is busy.

#### /register

Register your **osu!droid** account using an existing ElainaDB bind. The bot looks up your bound account, fetches your profile from the osu!droid API and registers it. The reply is ephemeral (only you can see it).

#### /spotify_genre

Fetch a random genre from the Spotify genre database, or look up a specific one.

```
/spotify_genre genre:jpop
```

- `genre` — optional; leave empty for a completely random genre

#### /ffmpeg

Run an arbitrary ffmpeg command on a video file, with placeholders `{input}` and `{output}`:

```
/ffmpeg command:-i {input} -vf "scale=640:-1" {output} video:[attachment]
```

- `command` — the ffmpeg arguments (must contain `{input}` and `{output}`; an accidental leading `ffmpeg` is stripped for you)
- `video` — the video to process (max 100 MB), **or**
- `url` — a direct URL to a video instead of an attachment
- `output_format` — mp4 (default), webm, mov, gif, avi, mkv

Videos over 10 MB are uploaded to Catbox and the link is returned.

***

### Admin / Owner Commands (operating)

These are mostly for the bot owner or server admins:

- **/chat_config** (owner) — configure the current local chat subsystem: local model profile, streamed responses, and response style. `mode:Status` reports the live model, context, style, streaming, and service states. Owner-only. See the [AI chat guide](docs/ai-chat.md).
- **/remove_channel_context** (owner) — clear the active stored chat scene and derived memory for a channel. Existing Discord messages are not deleted. Owner-only.
- **/ratestatus** — legacy telemetry for the retired online chat modes: it still reports stored online/online-lite rate-limit counters and legacy mode recommendations. It is not used by the current local chat.
- **/resetratelimits** — legacy administrator utility that clears those stored online-mode counters. It does not affect current local chat.
- **/server_stat** — show the bot server's stats: OS info, RAM/CPU usage, and the AI server's VRAM/status.
- **/test_api** — debug command that just replies "Testing API" (ephemeral). Nothing to see here.

***

### Context Menu Commands (right-click a message)

These appear under **Apps** when you right-click a message that contains an image:

- **Find sauce** — reverse-image-search the image with SauceNAO to find its source. Note: if the image is detected as AI-generated (has generation EXIF data), the search is aborted.
- **SD Image Info** — read the image's EXIF metadata and extract the generation info (prompt, negative prompt, sampler, steps, CFG, seed, model, etc.). Works best with images made by sdwebui; ComfyUI images are also partially supported. The same thing can be done with the `/wd_imginfo` slash command (see the main image document).

***

### FAQ

- **Why is the chat "sleeping"?** The bot owner can turn chat off with `/chat_config mode:disabled`. Try again later, or ask them to run `/chat_config mode:Status`.
- **Why did the bot ignore my message?** Mention it or reply to one of its messages. Direct messages, webhooks, and other bots are ignored. After `/scene end`, start a new scene with `/scene new` or resume one with `/scene resume`.
- **Does chat use Gemini or another cloud model?** No. The current chat path is local-only and has no online fallback. The rate-limit commands above are retained legacy utilities, not an online chat mode.
- **Do these commands cost anything?** No, everything is free, but every command has a cooldown.
- **Can I contribute questions/data?** The trivia and shipgirl question banks live in the bot's `resources/` folder; ask the bot owner if you want to add more.
