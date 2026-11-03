# AnotherElaina

Elaina is a Discord bot with AI chat, image creation and editing, audiovisual
generation, image-to-3D conversion, and osu! beatmap tools. The Discord commands
coordinate several operator-hosted model backends; the bot itself is not a
single model. Available commands depend on the server's registration,
permissions, installed models, and running services.

## Find the right AI feature

| What you want to do | Start here | Guide |
| --- | --- | --- |
| Chat, roleplay, maintain a scene, or recall earlier events | Mention Elaina or reply to one of her messages; `/scene`, `/memory` | [Chat, scenes, and memory](docs/ai-chat.md) |
| Create an image from a description | `/wd_create`, `/wd_create_adv` | [Image guide](document.md#text-to-image-wd_create-wd_create_adv) |
| Regenerate an image while controlling how much changes | `/wd_img2img`, `/wd_img2img_adv` | [Image-to-image](document.md#image-to-image-wd_img2img-wd_img2img_adv) |
| Edit using one or more reference images | `/wd_ref2img`, `/wd_ref2img_adv` | [Reference editing](document.md#reference-editing-wd_ref2img-wd_ref2img_adv) |
| Replace a masked area, extend a canvas, or upscale | `/wd_inpaint`, img2img extra scripts, `/wd_upscale` | [Image guide](document.md) |
| Plan the positions of subjects and text | `/wd_layout_draft`, saved `<layout:name>` prompts | [Layouts](document.md#layout-drafts-and-forge-coupler) |
| Animate an image or generate video with sound | `/wd_img2vid`, `/wd_txt2vid`, `/wd_ref2vid` | [Video and 3D guide](docs/media-commands.md) |
| Improve an existing video's resolution, frame rate, or colors | `/wd_vid_upscale` | [Media processing](docs/media-commands.md) |
| Turn a single image into a 3D asset and orbit preview | `/wd_img2model` | [Image-to-3D](docs/media-commands.md) |
| Describe an image, remove its background, or inspect generation metadata | `/wd_interrogate`, `/wd_rembg`, `/wd_imginfo`, message context menus | [Image utilities](document.md#utilities) |
| Generate an osu! beatmap from audio | `/osu_mapperinator` | [Beatmap commands](non-wd-commands.md#osu_mapperinator) |

Use the basic image commands first. Advanced variants expose more sampling and
extension controls; they do not automatically produce better results. For
models that support editing, a clear change instruction and a suitable reference
are often more useful than adding many quality tags.

## Learn more

- [How the AI features work](docs/ai-how-it-works.md): an approachable tour of
  diffusion, reference conditioning, prompt enhancement, retrieval, GPU routing,
  and cancellation, with links to the implementation and primary reading.
- [AI image documentation](document.md): prompts, models, editing, upscalers,
  ControlNet, LoRAs, layouts, profiles, and troubleshooting.
- [Chat guide](docs/ai-chat.md): scenes, participant controls, memory, lore,
  local model selection, and web-assisted answers.
- [Media guide](docs/media-commands.md): video examples, audio/reference roles,
  duration limits, processing, 3D output, and operator setup.
- [Other commands](non-wd-commands.md): quizzes, rhythm-game tools, lookup
  commands, and administration.

## For operators and contributors

Start with the [chat operator guide](docs/chat-overhaul/OPERATOR_GUIDE.md),
[media setup](docs/media-commands.md#setup), and
[orchestrator handoff](docs/orchestrator-handoff.md). The bot uses Discord.js
13; backend-specific dependencies and model files belong to their services.
Installing the Node dependencies alone does not install the model backends.

This documentation describes the current source. Historical implementation
reports and benchmarks record particular local checks, rather than a guarantee
that every deployment has those services or the same performance.
