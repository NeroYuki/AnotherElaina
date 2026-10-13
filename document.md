# Elaina Mk. 2 AI Image Documentation

!!! warning WIP
     This is a work in progress and thus incomplete

[TOC3]

### A Quick Note For People Who Have Never Used a Discord Bot Before

If you already know your way around Discord bots, feel free to skip this section. If not, here is everything you need to know to use this bot:

- **Slash commands**: Almost everything this bot does is triggered by a "slash command". You type `/` in the chat box and a menu of available commands pops up, keep typing the name to filter it (e.g. `/wd_create`) then press Enter. Discord will even show you what each command does before you run it.
- **Command parameters (options)**: Many commands take inputs, shown as "options" when you type the command. For example `/wd_create` asks for a `prompt` (the description of the image you want). Options marked with an asterisk are **required**; the rest are optional and have sensible defaults — you can leave them alone.
- **Uploading images**: Commands that need an image (like `/wd_img2img`, `/wd_inpaint`, `/wd_upscale`) have an `image:` option. Simply attach your image file to the message the same way you would send it normally, then click the attachment slot in the command.
- **Subcommands**: Some commands (like `/shipgirl_config` or `/wd_setting`) contain smaller commands inside them. You'll see them as `/wd_setting set`, `/wd_setting check`, etc. — just pick the subcommand after typing the main command.
- **Context menus**: A few features are not slash commands. Right-click (or tap-and-hold on mobile) any message that contains an image, go to **Apps**, and you will find options like "Find sauce" and "SD Image Info".
- **Chatting with the bot**: You can also just have a conversation with the bot. Mention the bot in discord followed by your message in any channel and the bot will reply as an AI chat companion. See the separate [Non-WD Commands Documentation](non-wd-commands.md) for details.
- **Cooldowns**: Every command has a cooldown to keep the server from melting. Wait a bit and try again if the bot tells you to slow down.

All of the examples in this document use the format `/command option:value`, which is exactly what you type in Discord.

***

### Text to Image (/wd_create, /wd_create_adv)
The beginning of everything. You want to make an image from your description? Start here with /wd_create, just fill the prompt input in the command and let it rip

```
/wd_create prompt:anime girl
```

Optionally, you can also:
- Add a `neg_prompt` (things you don't want in the image)
- Pick a `checkpoint` (generation model, see the model rundown below)
- Use `bulk_size` to generate several images at once (up to 6, Forge backend only)
- Use a saved `profile` to reuse a previously saved generation setup (see "Saving generation profile" below)
- Control resolution with `width` / `height` and reproducibility with `seed`

#### Prompting
Your first generation might look a bit odd, let's start with how prompting work shall we? To start, there are 2 major styles of prompting: Natural language style and Booru-tag style. Natural language should be self-explanatory. Booru-tag use a combination of tag from [danbooru image aggregation site](https://danbooru.donmai.us/wiki_pages/tag_groups) to describe the image. Example of their difference below

``` 
Natural language prompt
A girl with big breast sitting on a chair, drinking tea from a teacup while her eyes looking at the viewer
```

```
Booru-tag prompt
1girl, large breast, drinking, holding cup, teacup, sitting, on chair, looking at viewer
```

To know which model can use which prompting style, consult the model list below

You notice that the chair is missing? her breast is too big? You can emphasize or de-emphasize each word's importance with `( word )` and `[ word ]` respectively, each word have a default weight of 1 (100%), each pair of `()` increase this weight by 10%. For example ((chair)) will make the chair 21% more important (1.1×1.1=1.21). Vice versa, each pair of `[]` reduce this weight by 10%. You can also set the weight to an arbitrary number as well. For example `[[big breast]]` is equal to `(big breast:0.81)` From personal experience anything lower than 0.4 won't have any effect on the picture and on the contrary anything higher than 1.8 will mess up the composition badly

!!! note Prompt Order, BREAK keyword
	Simply speaking, the longer the prompt, the less impactful later words in prompt will be on the generated image. If you are seeing it happen, you can use the keyword BREAK to break the prompt into multiple chunk that the bot can handle, for example "ganyu, genshin impact BREAK office lady outfit"

!!! note Booru-tag prompt derivitive
	While booru-tag is generally easily understandable, some models do train on specific special tags/tag ordering. Most importantly is SDXL-based AnimagineXL and Illustrious linage of model. As they are trained to recognized anime characters. To get said character out of the model, it's recommended to follow `1girl/1boy (if applicable), character name, franchise (which contain the character), everything else` tag structure. It would be kinda unwieldy to list them all here so feel free to consult these models' CivitAI page

You will notice that there is also `neg_prompt`, stands for negative prompt, this is where you put in stuff that you DO NOT want to have in the generated image. In general except "Quality" tags, it is not recommend to add anything to neg_prompt unless need to, tag ordering and emphasize should affect its effectiveness as well

!!! note Booru "Quality" tags
	A common feature all of the fine-tune on booru dataset share is the existence of "Quality" tag that is used to caption image with high rating on booru. In theory adding this to prompt and adding the "Bad Quality" tags to negative prompt should improve the quality of the image. Example of these tags are `masterpiece`, `best quality`, `good quality`, `bad quality`, `worst quality`. PonyDiffusion is quirky and use `score_9_up`, `score_8`, `score_7`, ... instead

!!! warning Negative prompt on Flux
	Negative prompt does not work with Flux due to it being a distilled model which require CFG Scaling to be 1 at all time, causing negative prompt to have no effect

`width` and `height` should be self-explainatory. However due to how these model are pretrained on certain resolution. It is best to generate image at those resolutions or close to them. Resolution too low it will be a blurry mess, too hight and it will introduce distortion, especially on human body (overly long body, double belly, long neck, etc.). You can probably get away with +25% on each side for SDXL and Flux models and upto +50% for SD1.x. Different aspect ratio should be fine as long as you don't go too crazy on it and the area (height×width) is similar to the base square resolution area below are some base resolution supported by 3 major models

SD1.x | SDXL / Anima | Flux / Other Families 
--------------|---------------------|------------------
512×512 | 1024×1024 | 1408×1408
768×768 | 768×1152 | 1728×1152
768×512 | 864×1152 | 1664×1216
916×512 | 1360×768 | 1920×1080

`seed` is the seed for the initial noise pattern of the generation. Simply put, Same prompt + same seed = same result. Slightly different prompt + same seed = slightly different result. You can use it to your advantage

#### Hi-res Fix (Latent Upscale)

!!! info Technical stuff, tf is latent?
    Well to start you need to differentiate the latent space and the pixel space when generating image. Pixel space is what you are familiar with if you use paint or any image manipulating software. Image is represented by pixels of color (and transparency). However using this as an output of an AI network is wayyyy too inefficient due to how many pixel there are (512×512~250k pixels jesus). That's why these images are created in a compressed representation of an image called a latent space first. Using a VAE (Variable Auto-Encoder) to decode it back to pixel space when generation is finish. How they are encoded/decoded is above my paygrade so feel free to google

So you have a picture in latent space, about to be finalized to a complete image. But what if you want to make the picture bigger? Well It's time to copy and paste those latent space to a bigger canvas and... DO IT AGAIN. That is the idea behind hi-res fix (or latent upscaling). You only need to provide `upscale_multiplier` with anything higher than 1 and `upscaler_mode` or `upscaler` in advanced version to use Latent upscale. Keep in mind that this option is VERY SLOW. If you just want to have a quick and clean upscale, use /wd_upscale instead.

#### Advanced Parameter

!!! info Understand how the image is "actually" made
    This is quite important if you want to understand how any of the parameters in the next part mean.

Okay, a common misconception with AI image generation is that they simply bash photos together to "generate" an image. This is incorrect. A more appropriate analogy would be a scupltor trying to make a statue starting from a solid block of marble. While they know what to do (with the prompt). They will first just randomly smash on the block to shave off the bulk of the material, only when the general shape has been defined then it will start sculpting on finer detail, until the statue is finished

In reality, this technology has its root in solving denoising problem. i.e. You have a damage/incomplete image, how do you reconstruct the image from the clue around that incomplete part. At one point, these denoising algorithms got so good, you can have the entire image being noise and it would still *try* to reconstruct the image, as long as they are guided by... something, which is where the CLIP-encoded prompt you typed steps in. The latent image go through a number of "sampling step" trying to "solve" the noise from the initial seed, using a certain sampler and scheduler combination. What each sampler and scheduler do you can find on google

***

If you use /wd_create_adv. You will be exposed to some extra parameter to the generation. ~~I will try to make it brief~~ Who am I kidding let's just cut to the chase:
- `cfg_scale`: Decide how "creative" the image can be, high value make it adhere more to the prompt too high value cause the image to have a "burnt in" effect. low value make it more creative but more loose on prompt adherence, too low value make the image a mess. Normal value is 7 for SD1.x, 5.5 for SDXL, 3.5 (distilled, don't worry about this) for Flux
- `sampler`: Specify sampler (how to "solve" the noise)
- `scheduler`: Specify scheduler (how fast you want to solve the noise)
- `sampling_step`: Specify number of sampling step (how long you want to solve the noise)
- `clip_skip`: In simplified term, CLIP (the thing that turn your prompt to number to feed into the network) has a bunch of layer, with the final layer being the most abstracted, using clip skip > 1 will "skip" this layer, in theory clip skip 1 give better natural language understanding, while 2 give user more control by unshackle separate words with their surrounding context. This however really only work with SD1.x based model
- `keep_metadata`: upload the image to catbox instead of discord CDN

### Image to Image (/wd_img2img, /wd_img2img_adv)

Say you want to "anime-fy" your photo? or generating an image with your prompt but loosely follow an image? This is the place to go to. This is a very versatile tool but this document will show some use cases of this command, be creative i guess.

#### Noisy Upscale 

This is somewhat of a compromise between GAN-based upscaling (/wd_upscale) and hi-res fix (/wd_create). It works by encode the input image into latent space, add some noise, divide the image into "tiles" and make them run through another denoising process, hoping to "enhance" the feature in the picture to a higher resolution and/or introducing novel feature that make the high resolution output more aethestically pleasing

You need to first use /wd_script_upscale to specify the setting and then with /wd_img2img specify `extra_script` to use "Img2Img Upscale"

!!! note extra_script availability
	The `Img2Img Upscale` and `Outpainting` scripts are currently only offered in the simple `/wd_img2img` command. The advanced `/wd_img2img_adv` only offers the Flux-based extra scripts (see below).

Example

```
/wd_img2img image: [attachment] prompt: 1girl, fu xuan denoising_strength: 0.5 sampler: DPM++ 2M scheduler: Automatic sampling_step: 35 default_neg_prompt: n_nsfw profile: test_upscale extra_script: Img2Img Upscale
```

-> ![img2img upscale output](https://i.ibb.co/p6tczPZW/Screenshot-2025-02-01-111135.jpg) <-

#### Outpainting

Consider this the "expand this picture" option, it work by literally generate a new area around the original picture with just noise, it also introduce some noise at the border to ensure consistency and once again run with the denoising process. With the result (hopefully) being a new and expanded picture

You need to first use /wd_script_outpaint to specify the setting and then with /wd_img2img specify `extra_script` to use "Outpainting"

It's recommended to use inpaint model to outpaint a picture

Example 

```
/wd_script_outpaint set size: 128 direction: LRUD
```

```
/wd_img2img image: [attachment] prompt: a woman in a red dress standing in a city street with buildings in the background and a bird flying overhead, Ayako Rokkaku, official art, a detailed painting, orphism denoising_strength: 0.91 sampler: Euler a scheduler: Automatic cfg_scale: 6 sampling_step: 25 default_neg_prompt: Quality - SFW extra_script: Outpainting
```

-> ![outpaint input](https://i.ibb.co/h1D1yJDJ/Screenshot-2025-02-01-110825.jpg) <-
-> ![outpaint output](https://i.ibb.co/5tBh1tY/Screenshot-2025-02-01-110834.jpg) <-

#### Flux Outpaint / Flux Kontext (extra scripts)

Two extra scripts are also available (in both `/wd_img2img` and `/wd_img2img_adv`) when you want to outpaint an image using a Flux-based model:
- **Flux Outpaint** — outpaint the image using the Flux Fill model. Select `extra_script: Flux Outpaint` (the script automatically uses sensible sampler/scheduler/CFG settings for the Fill model).
- **Flux Kontext** — outpaint/expand the image using the Flux Kontext model (text-in-context based generation). Select `extra_script: Flux Kontext`.

Both of these run on the ComfyUI backend (see the "Generation Model Quick Rundown" for the required Flux Fill / Flux Kontext checkpoints).

### Inpainting (/wd_inpaint)

This is pretty much "redraw a specific area of an image". It can be used for multitude of purposes: Fixing generation output like bad hands or face, change certain feature / subject in the picture, object removal, !>nudify the subject   . The bot provide 2 way to define that inpaint area. Manually via mask or Automatically via SegmentAnything + GroundingDINO

#### Automatic area detection

To start we have the following command

```
/wd_inpaint image: [attachment] prompt: 1girl, red bunnygirl latex outfit, knee-high stocking, <lora:sdxl_mafuyu:1.0>, beautiful color, best quality, [breast], cleavage neg_prompt: worst quality, bad quality, jpeg artifact, bad anatomy, 2girls, cropped, more than 2 legs denoising_strength: 1 mask_blur: 4 mask_content: fill segment_anything_prompt: bunnygirl latex outfit
```

Image being this

-> ![initial image](https://i.ibb.co/27Z8Gmsm/img-1.png) <-

since i specified `segment_anything_prompt` with "bunnygirl latex outfit", GroundingDINO will find the object specified in the prompt and output the following
-> ![groundingdino output](https://i.ibb.co/8g42pwRF/Screenshot-2025-02-01-102910.jpg) <-

You select 1 because 0 box is the whole image, we don't want that. After that SegmentAnything will try to find the exact shape of the object and output the following

-> ![segmentanything output](https://i.ibb.co/zWx7WpQB/Screenshot-2025-02-01-102950.jpg) <-

green overlay on the image is the detection, select one that cover the part you want to redraw. In this case 1, it will output a mask image so that you can reuse it as manual mask in future inpaint as well. But more importantly, it will start running the inpainting process on that part of the image, which produce the final result

-> ![inpaint output](https://i.ibb.co/GfqD7bzY/Screenshot-2025-02-01-103007.jpg) <-

#### Manual area masking

If you use the mask from automatic mode, set `mask_color` to "raw"

### Video Generation (/wd_txt2vid, /wd_img2vid, /wd_vid_upscale)

!!! error OUT OF ORDER - video commands are completely broken
	All video-related functionality is currently **completely broken** due to a broken back-end (the video generation stack could not be reimplemented and is awaiting a new WAN2GP-based workflow). Despite what the command definitions might suggest, these commands do **NOT** work right now:

- **/wd_txt2vid** (text to video): replies with a maintenance notice and does nothing. Waiting for reimplementation with the new WAN2GP workflow.
- **/wd_img2vid** (image to video): replies with a maintenance notice and does nothing. Also waiting for WAN2GP.
- **/wd_vid_upscale** (video post-processing: color correction, upscaling, frame interpolation): the back-end it depends on is down, so it cannot process anything either.

If you see these commands in your command list, please do not attempt to use them — they will just waste your time (and a cooldown). There is no ETA for when video generation will return.

### Image to 3D Model (/wd_img2model)

!!!error Currently broken
	wd_img2model will be down due to me update (non)comfy dependency and trellis extension being the most hacky installation completely gone up in flame, it will require kaolin to be updated to cuda 12.6 and pytorch 2.7+ or I switch to another backend (maybe hunyuan3d + mv_adapter) but current time for it to return is TBA

Powered by TRELLIS, it can convert an image into a 3d model and output a video of it spinning in 3d space. I'm stilling planning to allow downloading the output as actual 3d model file (.glb file) but for now it's for funsie. It's highly recommend to use image with transparent background to increase accuracy, while the command allow you to remove background, it shouldn't be relied on (In fact you should just use /wd_rembg to control the background-removed image

### Image Generation Basic Resource

#### Generation Model Quick Rundown

!!!warning How to actually change the generation model
	I do wish that I have unlimited RAM but alas, I only have 128GB of it. And considering how heavy each model is (2-32GB), keeping it all in RAM for quick model switch is not exactly possible, that's why i employ a cache system where the most recent 3 models are stored in RAM and you can quickly use it in /wd_create and /wd_img2img via `checkpoint` parameter (/wd_inpaint is a bit more complex in the sense that it will try to load inpaint models first no matter what). To add a new checkpoint to the cache, you can use /wd_modelchange, do note that doing so will push the oldest model in the cache out of it and this command have a 30-minute cooldown. /wd_modelchange also has an `experimental_checkpoint` option for the newest (and potentially unstable) additions — those are not part of the regular `checkpoint` list until they prove themselves

!!!note Legend
	🏆 = Recommended, 🪦 = Legacy (You can still access these models via /wd_modelchange but they are not recommended for any usage unless you really know what you are doing). The rest have their specific use cases

**SDXL family**: 1024x1024 to 1280x1280 resolution is recommended, mediocre language understanding, mediocre anatomy, at least it can putting out higher res pic without finnicky upscaling work
- **AnimagineXL v4**: 🏆 latest major version release (or full re-trained on booru dataset) of AnimagineXL model, focus on learning way too much anime character and artist for its own good, the former de facto anime model in SDXL family. use booru prompting style
- **AnimagineXL v3.1**: fine tuned from v3 to fix some character/artist recognition issue, in exchange seems like it messed up anatomy in some cases. use booru prompting style
- **ChimeraXL v2**: merge of multiple pony-based model and sdxl-based model promising the best of both world, aesthetically im okay with it, doesnt seem much different from SDXL-based fine tune though
- **StableYogis Realism v4**: 🏆 fine tune of ponydiffusion for photorealism purpose, its a bit better i guess
- **AnimagineXL v3**: 🪦 the (former) latest major version release (or full re-trained on a part of booru dataset) of AnimagineXL model. Maintain good compatibility with SDXL-based LoRA. use booru prompting style
- **NekorayXL v0.6**: 🪦 early SDXL finetune on anime style, aesthetically pleasing with minimal prompting, can in fact used with natural language prompt, style can be pretty repetitive though
- **Dreamshaper XL Lightning**: 🪦 general use fine tune of SDXL, pretty much just better looking than base SDXL, use natural language to prompt, this is a "Lightning" model which require certain specific setting but can run with as low as 4 steps (around 5 seconds) per pic
- **Juggernaut XL**: 🪦 photorealism focus model (turbo variant), better than dreamshaper at this area, but sometimes it did clothing pretty badly and nsfw is kinda 💀 
- **RealvisXL v5**: 🪦 photorealism focus model,  prompt adherance, realism and nsfw capability is subjective compared to Juggernaut
- **Kohaku XL Zeta**: 🪦 earliest SDXL fine-tune effort on booru dataset, use booru prompt, but its kinda shit (even until now at basically version 6). use booru prompting style
- **ArtiWaifu v2**: 🪦 Another booru retrain effort but focus on acquiring better quality images from the start to allow good generation with minimal prompting. use booru prompting style

**Illustrious family:** 1024x1024 to 1280x1280 resolution is recommended, mediocre language understanding, decent anatomy, focus on learning anime character/style in general. Illustrious is the base for some of the best SDXL anime focus model right now. All model below use booru prompting style (with limited natural language understanding)
- **NoobAIXL v1.1 (Eps-pred)**: 🏆further fine tune of Illustrious using similar approach to NovelAI, pretty much the upgraded version of AnimagineXL, too bad AnimagineXL LoRA compatibility is rather spotty
- **NoobAIXL v1 (V-pred)**: (if you know what setting to use for a v-pred model) use a more novel prediction method, supposedly provide better contrast and lighting
- **Chenkin NoobAI v0.5**: a newer finetune model from NoobAI Eps v1.1 with more up-to-date character knowledge (Jan 2026) (v0.3 Rectified Flow is an alternative rectified-flow variant of it)
- **NoobAIXL MDNT V-pred v1.0**: a smaller scale finetune on top of NoobAI V-pred to increase anatomical precision, compositional coherence, and versatile style integration.
- **Seele NoobAIXL V-pred v2.0**: a NoobAI V-pred merge focused on consistency in higher resolution (up to 2MP)
- **IllumiyumeXL V-pred v3.1**: 🏆 a merge of NoobAI (eps-pred, despite the name), have a more consistent aesthetic look, supposedly have a more up-to-date dataset (up to Feb 2025) — this is the curated/recommended version
- **IllumiyumeXL V-pred v3.2**: 🪦 the newer iteration but have severely limited style, currently relegated to legacy
- **WAI-NSFW-IllustriousXL v12 🏆 / v16**: The premier Illustrious merge, have good compatibility with both Illustrious and SDXL LoRA as well as NSFW capability. CivitAI darling due to how lax their license is !> and also porn (v12 is part of the curated selection, v16 is the newest)
- **SilverMoonMix3 v2**: Illustrious merge that focus on generating image with lots of "dynamism" (lots of splash color, stylized composition and design)
- **ZukiCuteIL v5 / newIL v1**: The actual replacement for HimawariMix in term of creating "cutesy" anime image. good result with minimal prompting
- **SilenceMix v3**: Illustrious merge (and fine-tuned) to provide very detailed (almost noise-like) anime-style image. However it also leans toward 2.5D look (which can be mitigate by putting 2D in prompt and 3D in neg prompt)
- **IllusionBreed v3**: 🪦 Illustrious merge that I intended to replace HimawariMix in term of creating "cutesy" anime image. However it leans a bit too much toward 2.5D look
- **ColorPalette v1**: a NoobAI-based finetune focused on color/lighting control
- **PVC Model Style v1.1**: a model aimed at mimicking "PVC figure" style renders
- **Mugen - Aesthetic**: an aesthetic-focused merge in the NoobAI lineage
- **Illustrious v2.0**: Improve on natural language capability on top of Illustrious v1.0, still pretty hard to use though
- **SilenceMix v1**: 🪦 older SilenceMix release
- **Illustrious v1.0 / v1.1**: 🪦 The first official release of the Illustrious model, the launch is a bit controversial but It's here, with the ability to handle up to 1536x1536 resolution. Although it's still recommend to use any of the recommended model mix for ease of use
- **Rouwei V-pred v0.8**: 🪦 a NoobAI V-pred finetune for more up-to-date character knowledge (May 2025), undertrained though

**PonyDiffusionXL family**: 1024x1024 to 1280x1280 resolution is recommended. Supposedly a fine-tuned of SDXL, but the fine tune is so large scale, it basically reset the knowledge of the base SDXL model and thus creating its own ecosystem with LoRA and fine-tune. All use booru prompting style
!!! warning LoRA compatibility 
    PDXL nuked the entire SDXL text encoder during training, therefore it has a notorious bad compatibility with SDXL based LoRA but due to how good it is at making porn, there exists an entire LoRA ecosystem for it which I do not installed, feel free to nag me on that
- **PonyDiffusionXL v6**: 🪦 the OG, regard as having the best anatomy understanding and NSFW ability in the whole class of SDXL models, prompt weird as shit though, even though it also use booru dataset
- **PolyRealism v2.2**: 🪦 fine tune of ponydiffusion for photorealism purpose, its alright i guess
- **PrefectPony v5.0**: 🪦 Newer fine-tuned of Pony, intended to merge extra LoRA and finetune to improve output quality toward anime style while not compromise on Pony prompt adherence
- **AutismMix PonyXL**: 🪦 The premier Pony merge to mitigate borderline schizo prompting requirement in pony while keeping the prompt adherence and LoRA compatibility with Pony ecosystem

**Flux family:** 1280x1280 to 1408x1408 resolution is recommended, pretty much the state-of-the-art for open source model right now, have superior natural language understanding due to new text encoder design and possessing better prompt adherence and anatomy (also do oddly well with text on picture prompt), unfortunately fine tuning on this model is notoriously difficult due to being a distilled model and thus finetune selection here is very limited
!!! warning Flux is slow
    While possessing state-of-the-art prompt understanding, running the full Flux model takes 24GB of VRAM, therefore you can only use at max the Q8 compressed version here and running this will always be significantly slower than SDXL based model
- **Flux.dev Q8**: 🏆  8-bit quant of the model, bigger, slower, but it is pretty much indiscernable from the full fp16 weight (which btw require you to load it all in a 24GB-GPU at minimum)
- **Flux Krea.dev Q8**: 🏆 a variant of Flux.dev trained with additional data from Krea, similar characteristics to the base dev model
- **Krea2 Raw Int8 ConvRot**: Currently the state-of-the-art for open-weight image generation. Use natural language prompt
- **Krea2 Turbo NVFP4**: 🏆 Faster variant of Krea2, basically the recommended model for anyone who is new to image generation. Use natural language prompt
- **Pixelwave Flux v3 Q8**: First major finetune effort of Flux, quality is subjective
- **Flux Fill.dev Q6_K**: the Flux Fill model, made for (re)painting and outpainting — this is the model used by the `Flux Outpaint` extra script
- **Flux Kontext.dev Q6_K**: an experimental Flux variant that takes the surrounding "context" into account when generating — this is the model used by the `Flux Kontext` extra script
- **Flux.dev Q6_K**: 🪦 6-bit quant of the model. slightly worse than Q8 version but was recommended to use if one is generating Flux image with resolution above 2 megapixels or if one is using controlnets

**Other families** (accessible via /wd_modelchange `experimental_checkpoint`, may be unstable):
- **Chroma1 HD Flash Q8 / Chroma1 HD Q8 / Chroma Detail v0.94 Q8**: Chroma linage of models, finedtuned from Flux1 Klein with a significantly modfied architecture to slim down the model size and improve the model knowledge, use natural language or booru prompt style
- **Flux2 Klein 9B FP8 / Flux2 Klein 4B**: next-generation Flux "Klein" models (9B and 4B parameter sizes), use natural language proompt
- **Anima Preview / Anima Base v1 / WAI Anima v1**: anime-focused experimental models, use booru prompt style with limited natural language understanding
- **Z Image Turbo**: Z Image Turbo general-purpose model with highly refined result but not really creative, use natural language prompt
- **Qwen Image Nunchaku FP4 / Qwen Image Edit (8 Steps / 2509)**: Qwen-based image generation models (FP4 quantized), including "Edit" variants optimized for image editing tasks
- **Neta Lumina v1 / NetaYume Lumina v3**: Lumina-lineage models (NetaYume being the v3 iteration)

**SD1.x (1.5) family:** 512x512 to 768x768 resolution is recommended, poor language understanding, mediocre anatomy, its fast though (pretty much all of the derivitive model below use booru prompt style due to how poor the language understanding is)
!!! warning SD1.x is old and dumb
     While you can create good stuff with SD1.x based models, It's recommended to stick to SDXL or Flux based models to have a better experience 
- **Pastel Mix v2.1:** 🏆  highly stylized anime illustration model, wild stroke that is aesthetically pleasing despite the inherit flaw from SD 1.x
- **MeinaMix v11:** 🪦 mainstream SD1.x anime model, high contrast, bold stroke but sometimes leaning toward that 2.5D plastically feely, somewhat iron out SD1.x flaw in anatomy
- **HimawariMix v8:** well-known model for cute anime girl
- **Anything v5:** 🪦 The OG generation model when the bot is first published (it's actually v3.5 at the time but who care). Generate decent enough anime style image with natural language prompt but is pretty much outdated by everything else here
- **Counterfeit v2.5:** 🪦 well known for pleasing anime aesthetic result and for some reason, really good background, still have the flaw of SD1.x
- **CetusMix (Coda v2):** 🪦 derivative merge from MeinaMix, have a more refined style but more rigid than Meina
- **RichyRichMix v2:** 🪦 a fairly new SD1.x merge that have okay styling that can mitigate SD1.x inherent problems
- **CuteYukiMix:** 🪦 obscure cute anime girl model suggested by someone i knew
- **IrisMix v5b:** 🪦 pretty much a mix of Counterfeit and CuteYukiMix

#### Textual Embedding Resource List

!!! warning should not be abused
	In all the additional basic resource, textual embedding is the easiest to use, but you probably should not use too many of them at the same time as they are quite inflexible and can lead to botched generation

Basically speaking, textual embedding manipulate the prompt to produce better image by including said embedding's keyword. Currently there is only embedding for SD1.x and SDXL. The list isn't long so here they are

Embedding name | Put it in neg prompt? | Compatible version
-----------------|-------------------------|------------------------
smooth_qual | no | SDXL
smooth_neg | yes | SDXL
aisistxl_v2 | yes | SDXL
xl_negative_v2 | yes | SDXL
neg_hands_pony | yes | Pony
neg_hands_xl | yes | SDXL
unaestheticXLv31 | yes | SDXL
unaestheticXL_Alb2 | yes | SDXL
verybadimagenegative_v1.3 | yes | SDXL
bad_artist_neg | yes | SDXL
aidxlv05_neg | yes | SDXL
charturnerv2 | no | SD1.x
badhandv4 | yes | SD1.x
bad_prompt_version2 | yes | SD1.x
easynegative | yes | SD1.x

#### LoRA Resource List

!!! note She is in another castle!
    Due to how long this page is, It has been moved to here [LoRA Resource List](https://rentry.co/elainaresource)

#### Dynamic Prompt (Wildcard) Setup

!!! note She is also in another castle!
	Due to how long this page is, It has been moved to here [Wildcard Resource List](https://rentry.co/elainaresourcewildcard)

!!! note User-defined wildcards
	Besides the prebuilt wildcard resource, you can reference your own saved generation profiles as a wildcard: wrap the profile name in `%%` (e.g. `%%my_style%%`) and the bot will substitute the prompt stored in that profile. If you don't have a profile of that name, it will fall back to other users' profiles with the same name.

#### Model Knowledge-base

**NoobAIXL Linage:** 
- The model is trained on the full danbooru dataset in addition to E621 dataset (furry-focused, don't ask me why) With a knowledge cut off date somewhere in Oct 2024.
	- Knowledge base table: https://docs.google.com/spreadsheets/d/14_pLjke3LxnLTNyD7PoMdb6hQUWPpBdiLbjoFM3WVvA/preview?usp=sharing

**AnimagineXL Linage:** 
- As of V4, the model is trained on the full danbooru dataset in addition to some other undisclosed source with a knowledge cut off date on Jan 7 2025. 
- As of V3.1, the model is trained on a pruned danbooru dataset around 20% the size of the full dataset with the knowledge cut off date somewhere in Feb 2024
	- AnimagineXL v3 Character list: https://huggingface.co/spaces/cagliostrolab/animagine-xl-3.1/raw/main/wildcard/characterfull.txt
	- AnimagineXL v3.1 Character list (as addition to v3): https://huggingface.co/spaces/cagliostrolab/animagine-xl-3.1/raw/main/wildcard/character31.txt

**Other Linage:**
- PonyDiffusionXL v6 is also trained on full danbooru dataset + multiple other sources (however all artist name has been obfuscated) with a knowledge cut off date somewhere in Dec 2023
	- Character knowledge base page: https://ponychar.com/
	- PonyXL Style reversed engineer effort: https://rentry.org/ponyxl_loras_n_stuff#reverse-engineered-hashed-tokens
- SDXL Recognize some real life celebrities and characters due to prominence in the pre-trained dataset (LAION), it also recognize some artistic style which people are still finding. Their result can be found at https://sdxl.parrotzone.art/

- For Flux, someone tried to check if the model recognize common character. Here is their result: https://rentry.co/fluxcharknowledge

### Image Generation Advanced Resource

#### ControlNet Setup

ControlNet allow user to control the generation based on multiple special feature that can be detected from another image (pose, depth map, lineart, etc.)

Use /wd_controlnet to setup configuration of controlnet on your side (you can chain up to 3 controlnet at the same time, the 2nd and 3rd use the `_2` / `_3` versions of each option):
- `controlnet_model` — which ControlNet / T2I-Adapter / IPAdapter model to use (Canny, Depth, SoftEdge, Lineart Anime, OpenPose, Segmentation, Tile, IPAdapter (CLIP H / CLIP G), Color, Sketch, Threshold, Shuffle, Blur, Fill, InstantID Keypoint / IPAdapter, ControlNet Union, ControlNet Inpaint, ...)
- `controlnet_preprocessor` — the preprocessor used to extract the feature from the input image (e.g. OpenPose, HED, LERes / MiDaS depth, lineart, ...)
- `controlnet_weight` — how strongly the control is enforced (default 1)
- `controlnet_resolution` — the resolution the preprocessor works at (default 512)
- `controlnet_mode` — `Balanced` / `My prompt is more important` / `ControlNet is more important`
- `controlnet_threshold_a` / `controlnet_threshold_b` — preprocessor thresholds (default 100 / 200)
- `do_preview_annotation` — also send the extracted annotation image (handy for debugging)

When use /wd_create_adv, /wd_img2img_adv or /wd_inpaint, specify `controlnet_input` (plus `controlnet_input_2` / `controlnet_input_3` for the 2nd/3rd controlnet) with the input image, and your saved config is applied automatically. You can also pass `controlnet_config` directly to override it for a single generation.

!!! note Forge backend only
	ControlNet runs on the SD / SDXL (Forge) backend — it is not applied when generating with Flux-based models.

Temporary link to read more on what each controlnet type do: https://huggingface.co/docs/diffusers/en/using-diffusers/controlnet (I'll try to write something easier to understand but this is a quite complicated)

#### ADetailer Setup

When generating an image of a person, some parts of the human body (face, hand) can be generated rather poorly and can be very noticable, ADetailer aim to detect these object and try to repaint it using the same method as image to image with low-ish denoising strength to make these feature less fucked

Use /wd_adetailer to setup configuration of adetailer on your side (you can chain up to 3 detailers at the same time, the 2nd and 3rd use the `_2` / `_3` versions of each option):
- `adetailer_model` — the detection model used to find the object to repaint:
	- YOLO detectors: Face v8s, Hand v8n, Eyes (Segment), Breast (Segment), Head+Hair (Segment), Face (Segment), Person v8s (Segment), Watermark, YOLO World v8x
	- Open-vocabulary detectors: GroundingDINO (Tiny/Base) and Florence2 (Base/Large, with or without fine-tuning)
- `object_to_detect` — which object(s) the detector should look for (only for YOLO World / GroundingDINO / Florence2, e.g. "person" or "eyes. hair.")
- `adetailer_prompt` — override the prompt used when inpainting the detected area; you can use [SEP] to separate prompt used on different detection (i.e. 2 different faces). Leave empty to reuse the main prompt
- `adetailer_neg_prompt` — same as above but for the negative prompt
- `adetailer_detection_threshold` — confidence threshold for detection (default 0.3)
- `adetailer_mask_blur` — blur radius applied to the mask edge (default 4)
- `adetailer_mask_padding` — how much the detected area is expanded (default 32)
- `adetailer_denoise_strength` — how strongly the area is repainted (default 0.4)

When use /wd_create_adv or /wd_img2img_adv, set `do_adetailer` to true to activate adetailer (your saved config is applied automatically, or you can pass `adetailer_config` directly). Keep in mind that enabling adetailer increases the generation time by roughly 50%.

#### Forge Coupler Setup

Generating image with multiple subjects can be a pain in the ass due to a concept call "bleeding" when the AI can't figure out which subject should inherit which feature from the prompt. Forge Coupler attempt to resolve this by allow user to split the canvas into multiple area that goes through different denoising route. Each with their own prompt. There are 2 usage mode for forge coupler, below is the example of basic mode
```
2girls, august von parseval \(azur lane\), azur lane, artist: eufoniuz, serious face <=> 2girls, ceres fauna, hololive, artist: eufoniuz, happy face
```
separated by <=> for each subject in the picture, so you will have 2 girls in this picture

-> ![forge coupler demo](https://i.ibb.co/KxsFTKS1/img.png) <-

note: you can add another subject at the beginning or the end and if you add [GLOBAL] to it the prompt will be applied to all other subject. You can also control how strongly the global prompt is weighted with `[GLOBAL:<value>]` (e.g. `[GLOBAL:0.8]`, default is 0.5)

```
[GLOBAL] 2girls, artist: eufoniuz, __kw/lighting*__, (masterpiece:1.2), best quality <=> 2girls, august von parseval \(azur lane\), azur lane, artist: eufoniuz, serious face <=> 2girls, ceres fauna, hololive, artist: eufoniuz, happy face
```

!!! note Subject count
	You may be confused on why i still use "2girls" for the "local" part of the image, shouldn't it be 1girl if we just want each girl in their own section of the image? Well, you will be correct, the reason why i use "2girls" here is because I don't want both subject to be completely separate from each other. You gotta have that interaction eh? 

use \|\| instead of <=> to stack subject vertically instead of horizontally, the canvas will be divided equally

```
[GLOBAL] 2girls, artist: eufoniuz, __kw/lighting*__, (masterpiece:1.2), best quality || 2girls, august von parseval \(azur lane\), azur lane, artist: eufoniuz, serious face || 2girls, ceres fauna, hololive, artist: eufoniuz, happy face
```

But what if you DO NOT want to divide it equally? Then time to bust out the advance mode. With each "component" (separated by <=> or \|\|) you can set the component to occupy an arbitrary rectangular region on the canvas. Simply add `|<x_start_fraction>:<x_end_fraction>,<y_start_fraction>:<y:end_fraction>,<w>|` to each component's text, for example `|0:0.5,0:1,1|` will add a region on the left half of the canvas 

```
[GLOBAL] 2girls, artist: eufoniuz, __kw/lighting*__, (masterpiece:1.2), best quality <=> |0:0.5,0:1,1| 2girls, august von parseval \(azur lane\), azur lane, artist: eufoniuz, serious face <=> |0.5:1,0:1,1| 2girls, ceres fauna, hololive, artist: eufoniuz, happy face
```

If advance mode is detected, an additional image will be sent to indicate all the region you have defined

-> ![forge coupler region preview](https://i.ibb.co/3DbV1GZ/Screenshot-2025-02-01-101653.jpg) <-

#### Detail Daemon Setup

By adding some noise in a very controlled way during generation, one can deliberately crank up the amount of "detail" (or making the picture more "busy") and vice versa when generating an image

To use add the following syntax to the prompt `|dd: <amount>|`, for example `|dd: 0.2|`. By default detail daemon will add more noise in the middle steps to add more "detail" to the image

-> ![dd demo amount](https://i.ibb.co/jP3yN2wh/Screenshot-2025-02-01-104427.jpg) <-

In case you want to add bigger detail, you should specify detail daemon to add more noise in earlier steps of the generation, you can achieve this by using the syntax `|dd: <amount>, <start>-<end>, <bias>|` or `|dd: <amount>, <start>-<end>|` or `|dd: <amount>, <bias>|` for example `|dd: 0.2, 0.1-0.4, 0|` with `start` and `end` being the process of the step in generation process (0 at the start to 1 at the finish) and `bias` indicate how much noise should be dump in the earlier or later step of the daemon (-1 to fully dump it at the start and 1 to fully dump it at the end, by default, it is 0) 

-> ![dd demo timestep](https://i.ibb.co/BV8k4wxM/Screenshot-2025-02-01-104439.jpg) <-

#### Vectorscope Setup

This allow user to introduce bias during **latent** denoising process to manipulate the output's brightness, contrast and color balance

Use /wd_colorbalance to setup configuration of colorbalance on your side, subsequent generation from you will use said config until reset

The parsed settings are:
- `brightness` / `contrast` — overall brightness / contrast adjustment (-5 to 5, default 0)
- `saturation` — color intensity (0.25 to 1.75, default 1)
- `red` / `green` / `blue` — per-channel color cast (-4 to 4, default 0; e.g. red:3 warms the image up, blue:-3 pushes it toward yellow)
- `alt_mode` — if enabled, interferes deeper into the denoising process, potentially increasing the effect of all the settings above but at the cost of potential instability and artifact in the output

#### Prompt Enhancer Setup

Writing prompt is hard, maybe leave it to the AI as well? This allow user to input a simpler prompt and allow an large language model to "expand" it into a more elaborated prompt to make the output more interesting

Use /wd_boorugen to setup the configuration of the prompt expansion (DanTagGen-based), it will persist until reset:
- `gen_length` — how long the generated prompt should be (very short / short / long / very long)
- `ban_tags` — tags that must not appear in the generated prompt
- `format` — the output format of the generated prompt
- `random_seed`, `temperature`, `top_p`, `top_k` — sampling parameters of the tag generator
- `tipo_mode` — TIPO style mixing between booru tags and natural language (NL only / tag first / NL first / + generated NL / custom)
- `tipo_tag_gen_length` / `tipo_nl_gen_length` — lengths of the generated tag part and natural-language part

You can also trigger the enhancer from within the prompt itself:
- `[BOORU]` — run the booru tag generation on your prompt
- `[FOOCUS]` — run the FOOCUS expansion
- `[TIPO]<your raw prompt>===<your tag prompt>===<your nl prompt>` — use TIPO to convert / combine your booru-tag prompt and natural-language prompt into a mixed prompt

#### FreeU, Mahiro Guidance, Perturbed-Attention Guidance and Dynamic Threshold Setup

**FreeU** allow manipulate 4 value in the first and second block of the VAE decoder process, which can improve the image in certain way

To use add the following syntax to the prompt `|freeu: <b1>, <b2>, <s1>, <s2>|`, for example `|freeu: 1.05, 1.2, 0.99, 0.95|`

**Pertubed-Attention Guidance** is a more novel way to guide the denoising process that should prevent "locked in" of subject in earlier steps of generation, which help improve prompt adherence for SD1.5 and SDXL models

To use add the following syntax to the prompt `|pag: <pag scale>|` (or `|pag: <pag scale>, <adaptive scale>|` to enable the adaptive variant), for example `|pag: 3|` or `|pag: 3, 0.5|`

**Dynamic Threshold** help to resolve the issue of "burnt-in" output of generated image on high CFG scale (in theory high CFG should be better at prompt adherence and especially negative prompt avoidance) by scaling the CFG scale back in later step of the generation

To use add the following syntax to the prompt `|dt: <mimic_scale>, <mimic percentile>|`, for example `|dt: 7, 0.95|`

**Mahiro Guidance:** (arxiv 2024-1208.1) Introduce a novel method to improve guidance in diffusion models by avoiding the inverse of the negative conditioning when possible and using the plain positive conditioning. (to put it more simple, more power to prompt, less power to negative prompt)

To use add the following syntax to the prompt `|mahiro|`

**Modulation Guidance** — alternative guidance variant to the denoising process. To use add the following syntax to the prompt `|modulation|`

#### Latent Modifier Setup

!!! error even I don't understand this
    This is some advanced shit, unless you are ready for some utter chaos, DO NOT TRY TO MESS WITH THIS

This provide numerous paramter to directly mess with the latent space during generation. `simple_mode` reduces the config to just the rescale cfg option; otherwise the full list of parsed settings (each numeric setting has a method/type selector where applicable) is:

- `sharpness_multiplier` + `sharpness_method` (Anisotropic / Joint Anisotropic / Gaussian / CAS)
- `tonemap_multiplier` + `tonemap_method` (Reinhard / Reinhard per Channel / Arctangent / Quantile / Gated / CFG Mimic / Spatial Norm) + `tonemap_percentile`
- `contrast_multiplier` + `contrast_method` (Subtract / Subtract Channels / Subtract Median / Sharpen)
- `combat_cfg_drift` — counteract the CFG drift effect
- `rescale_cfg_phi` — the setting that actually matters, when increased by just a little bit it will add some more noise to the image
- `extra_noise_type` (Gaussian / Uniform / Perlin / Pink / Green / Pyramid) + `extra_noise_method` (Add / Add Scaled / Speckle / CADs...) + `extra_noise_multiplier` + `extra_noise_lowpass`
- `divisive_norm_size` + `divisive_norm_multiplier`
- `spectral_mod_mode` (Hard Clamp / Soft Clamp) + `spectral_mod_percentile` + `spectral_mod_multiplier`
- `affect_uncond` (None / Sharpness) — whether the modifiers also apply to the uncond latent
- `dyncfg_augment` (None / Half-cosine / Half-cosine Mimic)

Use /wd_latentmod to setup configuration of latentmod on your side

#### TeaCache / First-block Cache Setup

TeaCache / First-block Cache offer the ability to cache some calculation in earlier layer to apply to later steps, potentially skipping sampling step without compromising quality. It's recommended to start at low value first (0.2, value can range from 0 to 1) and work your way up or down to balance speed improvement and quality

To use TeaCache add the following syntax to the prompt `(>> <value>)` (or explicitly `(>> tc <value>)`) , for example `(>> 0.2)` (work with image generation on SD, Flux and text to video on Hunyuan)

To use First-block Cache add the following syntax to the prompt `(>> fbc <value>)` , for example `(>> fbc 0.2)` (only work with image generation on SD)

!!! warning unpredictable output
	While using these 2 caching method result in better generation speed, the result can be rather unpredictable (especially on SD-based model). Therefore this "optimization" is an opt-in

#### Personal Generation Settings (/wd_setting)

Your personal generation settings, persisted across generations until you change them (per-user, per-server):

- Use `/wd_setting set` to configure, `/wd_setting check` to review, `/wd_setting reset` to clear
- `do_preview` — show a live preview while generating (default false, slightly slower when on)
- `hires_checkpoint` / `hires_sampler` / `hires_scheduler` — force a specific cached checkpoint / sampler / scheduler to be used for the hi-res fix pass (rather than reusing the base generation settings)
- `hires_positive` / `hires_negative` — extra prompt text appended only during the hi-res fix pass
- `hires_cfg` / `hires_shift` — CFG scale / distilled shift override for the hi-res pass
- `seedvr2_model` — apply a SeedVR2 upscaler to every txt2img/img2img result automatically; `seedvr2_resolution` sets the target resolution of the shortest side (default 1600). Set the model to `Disable` to turn this off

!!! info SeedVR2 — quality over speed
	SeedVR2 is a diffusion-based upscaler, which makes it **much more compute-intensive** than the classic upscalers in /wd_upscale (R-ESRGAN etc.), but also a much better upscaler: instead of just sharpening pixels, it actively reconstructs fine detail. Use it when **quality is the priority** (e.g. for your final image), not when you want a quick upscale. There are 4 model options, from smallest to biggest:

	| Option | Size | Quantization | Purpose |
	|--------|------|--------------|---------|
	| 3B Q8 | small | high | denoising |
	| 7B Sharp Q4_K_M | big | low | sharpening |
	| 7B Q8 | big | high | denoising |
	| 7B Sharp Q8 | big | high | sharpening |

	The "Sharp" variants are optimized for sharpening, the plain ones for denoising. It works well with both realistic images and illustrations.

### Utilities Function

#### Image simple upscale (/wd_upscale)

Allow you to quickly upscale an image using various AI model designed to do so. Much quicker than using hi-res fix in /wd_create or /wd_img2img. But this method does not have the ability to create new detail from nothing, consider this less than CSI's "enhance" but more like anti-aliasing. It also support using CodeFormer and GFPGAN to try to fix human face, but this only really work with photo and is already pretty old tech. `upscale_multiplier` should be less than 4. Feel free to test out each model but R-ESRGAN 4x+ and R-ESRGAN 4x+ Anime6B is recommended for anime picture and NMKD-Siax 4x is recommended for photorealism

-> ![wd_upscale demo](https://i.ibb.co/0RG5vvk3/Screenshot-2025-01-31-080700.jpg) <-

#### Image background removal (/wd_rembg)

Allow you to remove background using various AI model designed to do so. It also allow you to do some post processing with the background-removed image
- For background removal model it is recommended to use birefnet-general (birefnet-massive should only be used if not enough background is removed as it has a tendency to remove too much of the image), isnet-general (and -anime appropriately) can also be used
- You can add an outline (edge), shadow to the processed image as well as define a background color instead of full transparency
- brightness, saturation and contrast too why not lol

-> ![wd_rembg demo](https://i.ibb.co/HfBD0bCM/Screenshot-2025-01-31-080050.jpg) <-

#### Saving generation profile (/wd_profile)

You can save your generation setup (prompt, height, width, etc.) as a profile to be used as a shorthand in later generation

- Profile management is split into 4 separate commands:
	- `/wd_profile_add name:<name>` — save (or update, if the name already exists) a profile with the given settings
	- `/wd_profile_list` — list all of your (or another `user`'s) profiles, with pagination
	- `/wd_profile_detail name:<name>` — show the full settings of a profile
	- `/wd_profile_remove name:<name>` — delete a profile
- Generation profile support following setting (all are optional)
	- prompt (<prompt pre>...<prompt>)
	- negative prompt (<neg prompt pre>...<neg prompt>)
	- width
	- height
	- sampler
	- scheduler
	- cfg sclale
	- sampling step
	- seed
	- upscale_multiplier
	- upscaler
	- upscale_denoise_strength
	- upscale_step
	- clip skip
	- checkpoint (still susceptable to checkpoint caching rule)
	- adetailer config
	- controlnet config
	- colorbalance config
	- boorugen config
	- script outpaint config
	- script upscale config
	- latentmod config

- To use it simply put the name of the profile to `profile` parameter. It will search to see if you have a profile of said name or not, if not found it will search for profile of said name from all user and if found apply the setting from this profile (same logic applied if you use /wd_profile_detail, unless you specify `user` pararameter)

!!! info Parameter priority
	Parameters value are applied according to this order until a non-empty value is found:  command-specific value > force sampler, scheduler, sampling step and cfg scale value for /wd_create and /wd_img2img > profile-specific value > user-specific value > default value

#### Describe an Image (/wd_interrogate)

Very straight forward, you put an image in, you get a description of it.

!!! info Florence 2 only
	CLIP and DeepBooru have been removed. The default (and only) engine family now is **Florence 2**, which is much more accurate and more versatile than the old CLIP/DeepBooru engines:
	- `engine: Florence 2` (default) — natural language description (use "Florence 2 Finetuned" for a better caption model)
	- `engine: Florence 2 PromptGen` + `florence_task: Caption (Booru Tags)` — booru-tag style description (replaces the old DeepBooru)

	You can also pick a `florence_task` for different behaviors: basic/detailed/mixed captioning, region captioning, OCR, "Find Object" (with a `florence_prompt` telling it what to find), and document question-answering.

-> ![wd_interrogate demo](https://i.ibb.co/zhPDZpzW/Screenshot-2025-01-31-074528.jpg) <-

#### Find Image source and Image Generation Info

Also pretty straight forward, you only need to access the message context menu (tip: tap and hold the message in mobile to make the context menu appear, there will be 2 option to find the "sauce" and find the generation info

-> ![context menu](https://i.ibb.co/Z6k8k0Qk/Screenshot-2025-01-31-074910.jpg) <-
- Find sauce use SauceNAO to find anime image, it works maybe half of the time but it's better than nothing xd

-> ![find sauce demo](https://i.ibb.co/nqvYFzqr/Screenshot-2025-01-31-075008.jpg) <-
- SD Image Info attempt to read the image's EXIF data (which can be stripped by the uploader) to parse relevant info of generation like prompt, parameters and stuff, works better with image made from sdwebui than comfyui (if you don't know the difference, don't mind it), alternatively you can also use /wd_imginfo and attach an image to do the same thing as well

-> ![imginfo demo](https://i.ibb.co/fzSNckJ1/Screenshot-2025-01-31-075023.jpg) <-

### Unrelated FAQ

- **Why /wd_...?** At the very beginning the generation command use the WaifuDiffusion model (which is the earliest major anime focused fine-tuning effort for Stable Diffusion). However the NovelAI model leak happen pretty much right after. The name stick though
- **Is there any fee?** ~~My electricity bill~~ Feel free to use this at no charge, there will be a cooldown for each of the command though. Afterall I don't have an RTX 5090 or anything *wink wink*
- **Can the bot do anything besides generating images?** Yes! See the [Non-WD Commands Documentation](https://rentry.org/elainaresourcenonai) for everything else: chatting with the bot, quizzes (shipgirl, trivia), osu!/osu!droid/Malody stuff, Spotify genre lookups, and more
- **Video generation is broken?** Unfortunately yes — all video commands (/wd_txt2vid, /wd_img2vid, /wd_vid_upscale) are out of order until the video back-end is rebuilt with the new WAN2GP workflow. Please don't try to use them for now
- **Where can I see what the bot is doing?** `/ping` pokes the AI server connection, `/server_stat` shows server resource stats, and `/ratestatus` shows the current chat rate limit status (see the non-wd document)