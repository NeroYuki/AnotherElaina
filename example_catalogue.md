`@Elaina Mk.2#7213` Model run down
SD1.x (1.5) family: 512x512 to 768x768 resolution is recommended, poor language understanding, mediocre anatomy, its fast though (pretty much all of the derivitive model below use booru prompt style due to how poor the language understanding is)
- **Pastel Mix v2.1:** :trophy:  highly stylized anime illustration model, wild stroke that is aesthetically pleasing despite the inherit flaw from SD 1.x
- **Counterfeit v2.5:** well known for pleasing anime aesthetic result and for some reason, really good background, still have the flaw of SD1.x
- **MeinaMix v11:** mainstream SD1.x anime model, high contrast, bold stroke but sometimes leaning toward that 2.5D plastically feely, somewhat iron out SD1.x flaw in anatomy
- **HimawariMix v8:** well-known model for cute anime girl
- **CetusMix (Coda v2):** derivative merge from MeinaMix, have a more refined style but more rigid than Meina
- **CuteYukiMix:** obscure cute anime girl model suggested by someone i knew
- **IrisMix v5b:** pretty much a mix of Counterfeit and CuteYukiMix
SDXL family: 1024x1024 to 1280x1280 resolution is recommended, mediocre language understanding, mediocre anatomy, at least it can putting out higher res pic without finnicky upscaling work
- **NekorayXL v0.6**: early SDXL finetune on anime style, aesthetically pleasing with minimal prompting, can in fact used with natural language prompt, style can be pretty repetitive though
- **Dreamshaper XL Lightning**: general use fine tune of SDXL, pretty much just better looking than base SDXL, use natural language to prompt, this is a "Lightning" model which require certain specific setting but can run with as low as 4 steps (around 5 seconds) per pic
- **Juggernaut XL v9**: photorealism focus model, better than dreamshaper at this area, but sometimes it did clothing pretty badly and nsfw is kinda :skull: 
- **RealvisXL v5**: photorealism focus model,  prompt adherance, realism and nsfw capability is subjective compared to Juggernaut
- **Kohaku XL Zeta**: earliest SDXL fine-tune effort on booru dataset, use booru prompt, but its kinda shit (even until now at basically version 6)
- **AnimagineXL v3**: latest major version release (or full re-trained on booru dataset) of AnimagineXL model, focus on learning way too much anime character and artist for its own good, the former de facto anime model in SDXL family
- **AnimagineXL v3.1**: fine tuned from v3 to fix some character/artist recognition issue, in exchange seems like it messed up anatomy in some cases
- **NoobAIXL v1.1 (Eps-pred)**: :trophy:  further fine tune of Illustrious using similar approach to NovelAI, pretty much the upgraded version of AnimagineXL, too bad AnimagineXL LoRA compatibility is rather spotty
- **NoobAIXL v1 (V-pred)**: :trophy:  use a more novel prediction method, supposedly provide better contrast and lighting
PonyDiffusionXL family: supposedly a fine-tuned of SDXL, but the fine tune is so large scale, it basically reset the knowledge of the base SDXL model and thus creating its own ecosystem with LoRA and fine-tune
- **PonyDiffusionXL v6**: the OG, regard as having the best anatomy understanding and NSFW ability in the whole class of SDXL models, prompt weird as shit though, even though it also use booru dataset
- **PolyRealism v2.2**: fine tune of ponydiffusion for photorealism purpose, its alright i guess
- **ChimeraXL v2**: :merge of multiple pony-based model and sdxl-based model promising the best of both world, aesthetically im okay with it, doesnt seem much different from SDXL-based fine tune though
Flux family: 1024x1024 resolution is recommended, pretty much the state-of-the-art for open source model right now, have superior natural language understanding due to new text encoder design and possessing better prompt adherence and anatomy (also do oddly well with text on picture prompt), unfortunately fine tuning on this model is notoriously difficult due to being a distilled model and thus finetune selection here is very limited
- **Flux.dev Q4_K_S**: 4-bit quant of the model, smaller, faster but have worse of everything
- **Flux.dev Q8**: :trophy:  8-bit quant of the model, bigger, slower, but it is pretty much indiscernable from the full fp16 weight (which btw require you to load it all in a 24GB-GPU at minimum)
- **Pixelwave Flux v3 Q8**: First major finetune effort of Flux, quality is subjective