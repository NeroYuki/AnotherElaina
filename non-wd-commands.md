# Elaina Mk. 2 — Non-WD Command Documentation

!!! warning WIP
     This is a work in progress and thus incomplete

This document covers everything the bot can do **other than** the AI image generation commands (the `/wd_...` family). For image generation, see the main [AI Image Documentation](document.md).

[TOC3]

### Quick Start For Discord Newcomers

- **Slash commands**: Type `/` in the chat box, pick a command from the menu (or keep typing its name), fill in the options, press Enter. Options marked with `*` are required; everything else is optional.
- **Attachments**: Commands that take a file (e.g. `/osu_mai_mod beatmap_file:`) need you to attach the file to the message as usual.
- **Subcommands**: Some commands group multiple actions together (e.g. `/shipgirl_multi start`, `/shipgirl_multi stop`). Just pick the subcommand after the main command.
- **Context menus**: Right-click (or tap-and-hold on mobile) a message containing an image → **Apps** → find extra actions like "Find sauce" and "SD Image Info".
- **Chatting**: Mention the bot (`@Elaina ...`) in any server channel to chat with it. More below.
- **Cooldowns**: Commands have per-user cooldowns; if the bot tells you to slow down, just wait a bit.

***

### Chatting With The Bot (no slash command needed)

The bot doubles as an AI chat companion. To talk to it, simply **mention it** in a message:

```
@Elaina hello! how are you today?
```

- The bot keeps a **conversation context** per user (or per channel — toggle with the button below), so it remembers what you talked about.
- You can attach **images** to your message and the bot can "see" them (vision is supported in all modes).
- After each reply, a row of buttons appears under the message:
	- **💣 Forget Everything** — wipe the conversation context
	- **▶️ Continue** — keep going from where the bot stopped
	- **🔁 Regenerate** — throw away the last reply and try again
	- **🔎 Debug** — show debug info about the last response (which model/mode was used, etc.)
	- **👥 User conversation / 🌐 Channel conversation** — toggle between your personal context and a shared channel-wide context
- **Special tokens** you can add to your message to force behavior:
	- `<think>` — enable "thinking" mode for this message (better reasoning, slower)
	- `<local>` — force a local model for this message (no online APIs)
	- `<unsafe>` — force the uncensored local model for this message

The bot runs several different models depending on the server's current **operating mode** (set by the bot owner via `/chat_config`):

| Mode | What runs |
|------|-----------|
| `auto` | Automatically picks the best mode for your message (local vs online, based on availability/rate limits) |
| `auto_local` | Like auto but never uses online APIs |
| `saving` | Small 8B local model hosted on the bot's own machine (slow, but doesn't touch the AI server) |
| `standard` | 35B local model on the AI server (thinking enabled) |
| `uncensored` | 27B local model on the AI server (no thinking, less filtered) |
| `online` / `online_lite` | Google Gemini models via API (subject to rate limits — see `/ratestatus`) |
| `disabled` | Chat is turned off ("Elaina is sleeping") |

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

- **/chat_config** (owner) — switch the chatbot operating mode (see the chat section above) and toggle streamed responses. Owner-only.
- **/remove_channel_context** (owner) — wipe the chat context of a specific channel. Owner-only.
- **/ratestatus** — show the current rate-limit status for the online (Gemini) chat modes: usage this minute/day, remaining, and when the next request will be allowed.
- **/resetratelimits** — reset the online-mode rate limits (all / online / online_lite). Requires **Administrator** permission.
- **/server_stat** — show the bot server's stats: OS info, RAM/CPU usage, and the AI server's VRAM/status.
- **/test_api** — debug command that just replies "Testing API" (ephemeral). Nothing to see here.

***

### Context Menu Commands (right-click a message)

These appear under **Apps** when you right-click a message that contains an image:

- **Find sauce** — reverse-image-search the image with SauceNAO to find its source. Note: if the image is detected as AI-generated (has generation EXIF data), the search is aborted.
- **SD Image Info** — read the image's EXIF metadata and extract the generation info (prompt, negative prompt, sampler, steps, CFG, seed, model, etc.). Works best with images made by sdwebui; ComfyUI images are also partially supported. The same thing can be done with the `/wd_imginfo` slash command (see the main image document).

***

### FAQ

- **Why is the chat "sleeping"?** The bot owner can turn chat off with `/chat_config` (`disabled` mode). Try again later.
- **Do these commands cost anything?** No, everything is free, but every command has a cooldown.
- **Can I contribute questions/data?** The trivia and shipgirl question banks live in the bot's `resources/` folder; ask the bot owner if you want to add more.
