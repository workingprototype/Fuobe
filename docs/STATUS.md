# Fuobe — project status

_Last updated: 2026-10-17. The research behind this is in [`docs/research/`](research/README.md); the Higgsfield inventory it is measured against is [`higgsfield-inventory.md`](research/higgsfield-inventory.md)._

**Legend**

| | meaning |
|---|---|
| ✅ | **Verified**: run end to end here (unit tests, a live ComfyUI, the browser) |
| 🟢 | **Built**: implemented against verified API schemas or validated workflows, and the UI flow checked in demo mode, but not yet run with real paid keys or real GPU weights |
| 🟡 | **Partial**: works, but approximates Higgsfield or misses part of the feature |
| ⬜ | **Not started** |

**What "verified" can't cover on this machine:** there are no paid API keys and no GPU here. Every cloud model call and every open-source output is therefore 🟢 at best: request shapes come from the providers' own schemas and every ComfyUI graph is accepted by a real ComfyUI, but nothing has produced a real image, video or voice yet.

## 1. What has been verified

| check | result |
|---|---|
| `pnpm typecheck`, `pnpm lint` | clean (one pre-existing unused-variable warning in `scripts/comfy/library.spec.mjs`) |
| `pnpm test` (Vitest, 14 files, 88 tests) | pass. Covers payload mapping, operation inference, batching, cost estimates, ComfyUI bindings and LoRA injection, catalog integrity, engine mode, @mentions, masks (PNG codec, white/black/alpha), the Higgsfield adapter, multi-shot and draft mode, audio routing, training jobs, storyboard chaining, open-engine motion paths, and the Assist agent loop |
| `pnpm build` | passes (161 pages) |
| Demo mode, browser (headless Chromium, desktop + 390px mobile) | ✅ every studio queues, shows progress, lands in the feed and opens in the viewer. Also checked this round: @mentions, inpaint + compare, Director and Soul style pickers, color grading with PNG/WebM export, multi-shot editor, draft → finalize, speech / mic voice clone / dialogue / translate, the train dialog, storyboard chaining, and Assist (plan → approve → results, decline, mobile) |
| ComfyUI engine, live server | ✅ `pnpm test:e2e:comfyui` against ComfyUI 0.41 (CPU): upload → bindings → `/prompt` → websocket/`/history` → download → library |
| ComfyUI workflow library | ✅ 73/73 workflows accepted by `POST /prompt` with no `node_errors` against real node definitions. Placeholder weights: graph structure, input names, types and file references are verified, **not output quality** |
| New open models through the app | ✅ every model added this round (Chatterbox ×4, IndexTTS-2, VACE extend/reframe, Wan-Move, Bernini-R, BiRefNet/SAM 3 matte, DA3/VDA depth, Qwen relight/next-scene) went through Fuobe's own submit path into a live ComfyUI and was accepted. Spot checks: Wan-Move tracks (49 points at 832×464), reframe at 480×848, dialogue SPEAKER script, Chatterbox language field |
| AI-Toolkit training | ✅ end to end against a fake AI-Toolkit job API: dataset written, job created and started, progress polled, LoRA copied to the ComfyUI loras folder, element marked trained |
| Assist agent | ✅ loop tested with a scripted model (approval pause/resume, one tool-result message per turn, decline via new message, auto-run, `max_tokens` cut-off, invalid input, refusal, busy guard) and the real Claude request built through the SDK against a stubbed `fetch` (adaptive thinking, effort, server-side fallback beta, strict tools, cached system prompt, base64 images). **No live Claude call yet**: needs an Anthropic key |
| Cloud providers (fal / Replicate / Higgsfield) | 🟢 98 cloud models built from the providers' schemas. **No live paid run yet** |

## 2. Feature matrix vs Higgsfield

### Create

| Higgsfield feature | Fuobe | Cloud route | Open-source route | Notes |
|---|---|---|---|---|
| Create Image (multi-model) | 🟢 | 49 image models incl. Nano Banana Pro/2, Seedream 5, GPT Image 2.5, FLUX.3, FLUX.2 Pro, Kontext, Ideogram 4.5, Recraft 4.1, Qwen Image 3, Wan 2.7, Z-Image, Imagen 4 | Z-Image Turbo, Qwen-Image 2512, FLUX.2 dev, FLUX.1 Krea/dev/schnell, HiDream, SDXL | Batch ×1–4, aspect ratios, quality tiers, seeds, negative prompts, references |
| Higgsfield Soul 2.0 / Soul Cinema / Soul v1 | 🟢 cloud · 🟡 open | Higgsfield's own API (`higgsfield` provider) with the Soul style picker | FLUX.1 Krea / Z-Image as the closest open look | Needs a Higgsfield API key |
| Soul ID (character training) | 🟢 | Higgsfield Soul ID (Soul 2.0, Soul Cinema) → `custom_reference_id`; fal Z-Image Turbo LoRA trainer | AI-Toolkit job on your GPU → Z-Image Turbo LoRA copied into ComfyUI | Train from an element's photos. A trained element is used automatically when @mentioned on its model. Training kit download and "attach a LoRA trained elsewhere" also work |
| Elements (@characters, locations, props, styles) | ✅ | Reference images with a legend; video switches to reference-to-video | Same, plus LoRA + trigger word for trained elements | `/elements`; @ menu with highlighting in every composer and in shots |
| Create Video (multi-model) | 🟢 | 79 video models: Seedance 2.5/2.0, Kling 3.0/O3/2.6, Veo 3.1, Wan 3.0/2.7/2.6, MiniMax H3, Hailuo, FLUX.3 Video, LTX 2.5, PixVerse V6, Vidu Q3, Luma Ray 3.2, Higgsfield Cinema Studio 4.0, Genjutsu, Grok Imagine Video, Happy Horse… | Wan 2.2 14B (+Lightning), Wan 2.2 5B, LTX-2.5/2, HunyuanVideo 1.5, Wan VACE | Text, image, start+end frame, references, native audio, durations, resolutions |
| Start & end frame | 🟢 | Kling, Veo, Seedance, Wan, MiniMax, PixVerse, FLUX.3 | Wan 2.2 FLF2V | |
| Camera motions (DoP presets) | 🟢 | 108 presets on any video model | Wan 2.2 + 18 camera LoRAs, 11 moves via Wan Fun Camera, the rest prompt-only | Motion "Mix" ⬜ |
| Effects / viral presets | 🟢 | 255 effects | 35 with dedicated LoRAs, the rest prompt-only | Most open effect LoRAs target Wan 2.1 I2V; **quality needs a GPU check** |
| Multi-shot | 🟢 cloud · ⬜ open | Kling 3.0/O3 native `multi_prompt`; Seedance, Wan 2.6, Cinema Studio get the shots written into the prompt | 2/3/4-shot concat workflows are in the library and validated but **not wired to a model yet** | Off / Auto / Custom shot editor |
| Seedance draft mode | 🟢 | Seedance 2.5 480p draft → "Render 1080p" (finalize) | — | |
| Cinema Studio 4.0 / Director controls | 🟡 | Higgsfield Cinema Studio 4.0 model with genre, era, light, lens, aperture, camera move and grade controls | — | The model and its controls work; Higgsfield's separate Cinema Studio **workspace** (scene list, timeline) ⬜ |
| Genjutsu, Marketing & Ads Studio | 🟡 | Higgsfield models with their look/template pickers | — | Single-generation UI; no dedicated multi-step studio pages |
| Motion Control | 🟢 | Kling 3.0 Motion Control | Wan Animate 2, Wan 2.2 Fun Control | `/motion-control` |
| Edit Video | 🟢 | Kling O3/O1, Gemini Omni, Wan 2.7, Luma Ray 3.2 | Wan 2.2 Fun Control (approximation) | `/video-edit` |
| Extend video | 🟢 | Seedance 2.5 extension, MiniMax H3 Max, PixVerse V6, FLUX.3, Veo 3.1 | Wan 2.2 Fun VACE extend | `/extend`, "Extend" tile action. Kling extend not wired |
| Reframe video | 🟢 | Luma Ray 3.2, LTX, hosted Wan VACE | Wan 2.2 Fun VACE reframe | `/reframe` |
| Draw to Video | 🟢 | Annotated first frame + instructions on any i2v model | Wan-Move: brush strokes become motion paths | Paint tools in the Video studio |
| Video tools: remove background, relight, depth | 🟢 | BiRefNet video, Bria, Video Depth Anything, LightX relight | BiRefNet / SAM 3 matte, Bernini-R relight, Depth Anything 3 / VDA | `/video-tools` |
| Storyboards (Popcorn) | 🟢 | Nano Banana Pro, each frame made from the previous one | Z-Image / Qwen-Image-Edit, then Qwen-Image-Edit + next-scene LoRA | `/storyboard`: up to 8 frames, scene by scene or split from one idea, character/look references; per-frame Animate / Edit |
| Shorts Studio, keyframes-to-video from a storyboard | ⬜ | | | |

### Edit & apps

| Higgsfield feature | Fuobe | Notes |
|---|---|---|
| Edit image (instruction edit) | 🟢 | Any edit model, up to 14 references (cloud) / 3 (open) |
| Inpaint / Draw to Edit | 🟢 | `/inpaint` and paint tools in Edit: masks go to native inpaint routes (GPT Image, Ideogram, FLUX Fill, Z-Image) in each API's mask convention; models without a mask input get a red-tinted copy and instructions; drawings and notes become instruction images. Before/after compare slider in the viewer (C) |
| Color Grading | ✅ | `/color-grade`: free, runs in the browser (WebGL). Higgsfield's Natural / Split Tone / Soft Skin / Old Lens / 16mm looks plus seven film looks, full manual controls, hold to compare, PNG/WebM export into the library |
| Expand (outpaint), Upscale image/video | 🟢 | Topaz, SeedVR2, Recraft Crisp (cloud); FLUX Fill outpaint, ESRGAN, SeedVR2 (open) |
| Relight, Angles, Skin Enhancer, Headshots, Try-On, Packshot, Face/Character Swap… | 🟢 | 118 apps: 116 on both engines, 2 open-only. Relight now uses the Relight LoRA on the open engine |
| Approximated apps | 🟡 | 17 apps carry an explicit `parity` note shown on the app page (e.g. Virality Predictor, Click to Ad) |
| Layers, Photodump, Moodboards, Soul HEX | ⬜ | |

### Characters, lipsync, audio

| Higgsfield feature | Fuobe | Notes |
|---|---|---|
| Lipsync Studio / talking avatars | 🟢 | Kling Avatar 2.0/1, OmniHuman 2/1.5, InfiniteTalk, Sync Lipsync (cloud); InfiniteTalk, Wan 2.2 S2V (open) |
| Text to speech + voice picker | 🟢 | ElevenLabs v3 / v4 / v4 Turbo / Multilingual v2 with the 21 premade voices and stability/similarity/style/speed sliders; open Chatterbox Multilingual (23 languages) and IndexTTS-2 |
| Voice cloning | 🟢 | Zero-shot from a recording (in-browser mic → WAV) or upload: Chatterbox, IndexTTS-2. Voices can be saved as Voice elements |
| Dialogue (two or more speakers) | 🟢 | ElevenLabs Dialogue with a per-line script; open Chatterbox Dialogue with two cloned speakers |
| Voice change | 🟢 | ElevenLabs Voice Changer, Chatterbox VC |
| Translate & dub | 🟢 cloud · ⬜ open | HeyGen (lip-synced), ElevenLabs Dubbing. No open dubbing pipeline |
| Sound effects, music, sound for video | 🟢 | ElevenLabs SFX/Music, MMAudio (cloud); ACE-Step 1.5, MMAudio (open). No open SFX model |
| AI Influencer persona generator | ⬜ | Elements cover the saved-character part |

### Platform

| Higgsfield feature | Fuobe | Notes |
|---|---|---|
| Supercomputer / Assist agent | 🟢 | `/assist`: describe the whole job; Claude looks up models, writes prompts, shows a plan card with the estimated cost, runs it when you approve ("Ask first", or auto-run), waits for results, looks at them and chains steps (image → animate, storyboards, @elements, your earlier outputs). Without an Anthropic key an offline rule-based planner drives the same flow. Ollama tool calling ⬜ |
| Assets library, favorites, search, reuse, hand-offs, download | ✅ | |
| Live progress, cancel, retry, failure messages | ✅ | |
| Engine choice (open only, paid only, both) | ✅ | Settings → Engine mode, or `FUOBE_ENGINE_MODE` |
| Credits / pricing | 🟡 | Bring your own key: live cost estimates per run (and per Assist plan); "Free" for open source; no billing |
| Accounts, teams, sharing, community feed, contests | ⬜ | Single-user and self-hosted today |
| Canvas (node workflows), MCP, plugins | 🟡 / ⬜ | ComfyUI itself is the node canvas for the open engine; no in-app canvas or MCP server |
| Public API | 🟡 | The REST API works but is **unauthenticated**. Don't expose Fuobe to the internet without an auth layer in front |

## 3. Known issues and caveats

- **Paid providers are untested with real keys.** Field names come from the providers' schemas (fal OpenAPI, Replicate, Higgsfield's API docs), but the first live runs may surface model-specific quirks. The picker marks models whose provider isn't connected as "demo".
- **Open-source quality is unverified.** Every workflow is structurally validated, none has run with real weights. Expect to tune steps/CFG per model on a GPU. The same goes for AI-Toolkit training (verified against a fake job API, not a real training run).
- **The Assist agent hasn't talked to the live API.** The request and the loop are tested with a stub; the first real conversations may need prompt tuning. Claude is used only when an Anthropic key is set, and on "open source only" installs only when Prompt enhancement is explicitly set to Claude.
- **Higgsfield controls/templates:** the Soul style, Genjutsu look and Marketing Studio template lists are fetched live from Higgsfield. Without a key the pickers stay empty and ask for one; Genjutsu Restyle, which requires a look, can't run until then.
- **Unauthenticated, file-writing settings.** `comfyLorasDir` and `aiToolkitDatasetDir` make the server write files to the paths you set; together with the open API, that is another reason to keep Fuobe off the public internet.
- **Wan 2.1 LoRAs on Wan 2.2:** most viral-effect LoRAs were trained for Wan 2.1 I2V; some may need a lower strength or only the low-noise expert.
- **Licenses:** FLUX.1/FLUX.2 [dev], inswapper (ReActor), MMAudio weights and some LoRAs are non-commercial. See `research/comfyui-oss.md` and `research/comfyui-oss-2.md`.
- **Sunsets:** Sora 2's API was retired (2026-09-24) so it isn't offered; Veo 3.1 on fal ends 2026-11-17 (Replicate route present).
- **Dev server:** after adding routes the Turbopack cache can get stuck in a reload loop. `pnpm dev:clean` clears `.next` and restarts.
- **Headless Chromium has no H.264**, so video checks here used WebM; MP4 playback is unaffected in normal browsers.

## 4. What's next (prioritized)

1. **Live-key smoke test** of the top cloud models (Nano Banana Pro, Seedream 5, Kling 3.0, Seedance 2.5, Veo 3.1, Soul 2.0, ElevenLabs) and a first real Assist conversation; fix any schema surprises.
2. **GPU run** of the starter open set (Z-Image Turbo, Qwen-Image-Edit 2511, Wan 2.2 Lightning, InfiniteTalk, Chatterbox) and a real AI-Toolkit training; tune defaults and record timings/VRAM.
3. Wire the workflows that are validated but unused: open multi-shot (2/3/4-shot concat), palette transfer, relight with a reference image.
4. Cinema Studio workspace (scene list + timeline), storyboard → keyframes-to-video, Kling extend, motion "Mix".
5. Auth + multi-user, shareable links, community feed; then an MCP server so other agents can drive Fuobe.
6. Ollama tool calling for a fully local Assist agent.
7. Real preview media for apps/motions/effects (currently gradient cards).

## 5. How to reproduce the checks

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
# open-source engine against a live ComfyUI (no model weights needed):
bash scripts/comfy/start-comfyui.sh            # or point COMFYUI_URL at your own server
pnpm dev & pnpm test:e2e:comfyui http://localhost:3000
# re-export + re-validate the workflow library:
cd scripts/comfy && npm install && npm run all
```
