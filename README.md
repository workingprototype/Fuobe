# Fuobe

**An open-source AI image, video and audio studio — a 1:1 alternative to Higgsfield.**
Use the same frontier paid models Higgsfield uses (Nano Banana Pro, Seedance 2.5, Kling 3.0, Veo 3.1, Seedream 5, GPT Image 2.5, FLUX.3, Gemini Omni, MiniMax, ElevenLabs…, and Higgsfield's own Soul and Cinema Studio) with your own fal.ai / Replicate / Higgsfield key, **or** run the equivalent open-weight workflows on your own GPU through **ComfyUI**. Same studio, same apps, same camera motions — flip one switch. Fuobe's own rebuilds of Higgsfield's in-house models, the **Fuobe Originals** (Fuobe Soul and Fuobe DoP so far), run either way and never call Higgsfield.

- **Assist:** describe the whole job in a chat; the agent picks models, shows the plan and its cost, runs it when you approve, checks the results and chains the next step. Free / Smart / Manual modes, 20 built-in **skills** (SKILL.md playbooks, or upload your own), **projects** with instructions and up to 20 sources (links, files and PDFs, elements, notes), and **memory**. Runs on Claude, a local Ollama model, or an offline planner
- **MCP:** other agents (Claude Code, Claude Desktop, any MCP client) can drive the studio through `/api/mcp`, including whole studio jobs that open in their studio (a Layers project, a Shorts session, a dub to review, a Faceless episode, an Ads Studio batch, the Captions editor, a Katana edit; Genjutsu, Remove object, Content Factory, the AI Influencer builder and Layers' Inpaint, Enhancer and Save as element aren't tools yet) and the skills as prompts. `npx skills add workingprototype/Fuobe` installs the skills in other agents
- **Command line:** `fuobe` lists models, prices a run, generates, waits and downloads from a terminal, a script or a coding agent; see [`docs/cli.md`](docs/cli.md). `--engine` also picks an Original's engine, and `--look` a Fuobe Soul look (`fuobe generate --help` lists it; cli.md doesn't yet)
- **Fuobe Originals:** each is one model that runs on both engines, built on open-weight models and public LoRAs: free on your GPU through ComfyUI, or paid on fal or Replicate, with no Higgsfield call
  - **Fuobe Soul**, **Fuobe Soul HD** and **Fuobe Soul Cinema** (Image studio) — a Look picker with 139 looks in two sets named after Higgsfield's versions (Soul 2.0: 33, Soul: 106), with categories, search, drawn covers and a Strength slider. Attach a picture and Fuobe Soul restyles it with the look. Soul HD (Qwen-Image 2512) is for lettering; Soul Cinema has one film look and 21:9. Your browser finishes each result (crop, grade, overlays such as DigitalCam's date stamp) and keeps the raw picture. 87 looks use civitai LoRAs: without a civitai key, a run leaves those out and says so
  - **Fuobe DoP** (Wan 2.2) and **Fuobe DoP · LTX** (LTX-2.3) — the camera motions and effects as recipes: a move's LoRAs, a camera LoRA or (on your GPU) a Fun Camera pose, a colour grade or a relight where it has one, else its words. On the open engine, picking a move in the Video studio switches to the model it runs on (a few run on LTX-2.5). In the cloud, 152 of the 363 motions and effects use DoP's routes and switch the same way; the other 211 only add their words to the model you picked (their own route is Kling 2.5 Turbo). 15 colour-grade effects hand the clip to Color grading with the grade picked, 6 relight effects relight the start frame first, and Mix stacks both presets' LoRAs on either engine
  - Built and checked in demo mode; no look or move has run on a GPU or with a paid key yet, so their quality is unmeasured
- **Create:** Image · Video (text, image, start/end frame, **Frames**: up to 10 stills on a timeline, reference images and clips, multi-shot, draft mode) · Edit · **Layers** (split a flat image into editable layers, edit text with the lines found for you on either engine, Inpaint a painted area, an Enhancer (skin, soft glow, sharpen, detail), regional edits, save a layer as an element, cropped or positioned zips) · Inpaint & Draw to Edit · Color grading · Camera motions and Effects (on Fuobe DoP) · Storyboard (and turn it into a film) · **Canvas** (wire prompts, files and models into node workflows; every template in a cloud and an open-source version; up to 20 pages per board, groups you can run as one, comment pins with replies, and drawing, shapes and text from a toolbar with keys; a Table node runs the node it feeds once per row; Change voice, Clone voice, Translate (text, or a dub of a video) and Video concatenator (cut, mute and join up to 50 clips) nodes) · Apps
- **Studios:**
  - **Cinema Studio** — projects and scenes, Director's Panel (camera, lens, 50 palettes, lighting rig, Emotion Wheel), 33 camera moves (# in the prompt bar), AI Director, image grids, Soul Cast and Soul Location, and **3D scenes**: turn a still into a scene you fly through, set the lens and frame, and Capture a re-rendered take from that view
  - **Shorts Studio** — restyle up to 2 minutes of your own footage with 44 looks (or your own references), in segments you can regenerate, stitched back under your sound; **Mixed Media** — 33 looks for 1–10 s clips with per-preset settings and a preview frame; on the cloud the clip's frames are sampled at the rate you pick (4–24 FPS) and each one is redrawn by default (Nano Banana 2 or Seedream 5.0 Flash, priced per frame), and **Fast** restyles in one video-to-video pass
  - **Genjutsu** — keep a 4–30 s clip's motion, camera and framing and change what is in it: motion transfer, object swap, restyle or insert, with reference images, priced before it runs
  - **Marketing Studio** (84 templates), **Click to Ad** (with a logo end card), **Ads Studio** (brand kit from your website, up to 20 ads per product in 1:1 / 4:5 / 9:16) and **Ad Multiplier**
  - **Moodboards** (the curated looks open on Fuobe Soul), **Color signature** (Soul HEX palettes; with a Fuobe Soul model on the open engine, the colours are locked after generating by default), **Photodump / Instadump**, **Fashion Factory**, **Character Sheet**
  - **AI Influencer** builder — build a character game-style: a character type (Average, Bold or Extreme human, or a creature: insect, frog, cat, dog, rodent or bird) and traits in 18 categories, with Shuffle, then save the sheet as a character
  - **Faceless Studio** and **Explainer** — channels, scripts, narrated and subtitled episodes with a timeline editor; "Frame by frame" moves the camera slowly over each still (a Ken Burns move), the music loops to cover long films, and Explainer reads PDF and Word sources
  - **Content Factory** — a faceless series in the style of a clip you like: upload it, paste a TikTok, Instagram or web-page link, or pick one of 8 preset styles. Fuobe reads it into a style brief you can edit, prices the whole series, then makes 1–10 Faceless episodes of 30 s to 5 min here, or gives you a prompt for Claude Code to make them through Fuobe's MCP server
  - **Translate & dub** (your voice, lip-synced, over the original music and effects on both engines), **Captions** (transcribe, edit, burn in), **Trim**, **Katana** (recreate a reference edit with your subject), **Image to 3D** (from one photo, several photos of one object, words or an object picked in a photo, or one photo as a Gaussian splat to open in a splat viewer such as SuperSplat; Rig & animate a finished model; Pick an object and Rig & animate run on the cloud only), Lipsync & avatars, Motion control, Edit / Extend / Reframe video, Video tools (**Remove object**: type it, paint it or, on the cloud, click it, and it's erased from the clip; matte, relight, depth, join clips, match colors), Upscale (images and video, **FPS Boost** and slow motion, **SDR to HDR**, and **Export** to ProRes, H.265 10-bit, FFV1 or EXR frames on the open engine), Audio (speech with voice picker and cloning, dialogue, voice change, sound effects, music, sound for video, transcribe, **loop / extend** and **join**), and a Virality predictor (a labelled heuristic)
- **Library:** all your results (images, videos, audio, text, 3D) with layouts, filters, nested folders, pins, a review status (In progress, Needs review, Approved, Rejected), Select all, bulk zip download and a Trash with 30-day restore. Helper steps stay hidden until you ask (Show steps), and an upload is deleted only when nothing uses it. Results arrive live, and a browser notification can tell you when a job finishes while Fuobe is in the background
- **Getting around:** a **Get started** card on Home and Settings (use paid models, use your GPU, or just try the demo); a **⌘K / Ctrl+K palette** that searches pages, settings, apps, motions, effects, models and recent creations; Start on Home runs the job and says first what it costs; **Settings → About & licences** lists every open model's licence
- **Elements:** save characters, locations, props, styles and voices once, then `@mention` them in any prompt; train a character (Soul ID, a fal LoRA, or AI-Toolkit on your GPU) for a consistent face; save one straight from a Layers layer or an AI Influencer sheet
- **LoRAs:** small add-on files that give an open model a look, a camera move or an effect. **Settings → LoRAs** lists a library of 114 researched LoRAs (67 looks, 23 motions, 24 effects) with each one's licence and source, and downloads them. On the open engine, a LoRA ComfyUI doesn't have is downloaded into your LoRA folder before the run and checked against its SHA-256 fingerprint. On the cloud, seven hosted open-weight models take LoRAs: Z-Image Turbo (hosted, on fal and Replicate), Qwen-Image 2512, Qwen-Image-Edit 2511, FLUX.2 [klein] 4B, Wan 2.2 A14B image and video, and LTX-2.3 22B. The Fuobe Originals' cloud routes send their looks' and moves' LoRAs too, and a LoRA a run can't carry is left out with a warning. Fuobe Soul's looks take their LoRAs from the library, and a motion's or effect's LoRA that is in the library uses its pinned download and licence
- **Catalog:** 200 cloud models + 88 open-source models + 5 Fuobe Originals that run on both (plus 48 hidden ones: chain steps and studio helpers, self-tests, browser tools, and Gemma 4 speech translate, which no studio uses yet), 124 apps, 108 camera motions (mix any two), 255 effects
- **Open-source engine:** 145 API-format ComfyUI workflows (official templates, community packs and hand-built graphs) validated against real ComfyUI node definitions, plus 84 researched LoRAs (camera moves, VFX) that 122 motion, effect and app presets use today (43 of them are also in the Settings → LoRAs library, and 36 come from civitai)
- **Evaluation harness (for developers):** `pnpm eval:run` (or `fuobe eval`) runs a suite of cases for each Fuobe Original, built or planned (Fuobe's own open-weight versions of Higgsfield's in-house models, such as Soul and DoP) on the demo, open or cloud engine, scores the results with pinned open models, runs a blind A/B review and says whether a recipe may become a default. Fuobe Soul and Fuobe DoP are in the app now, and their suites run the shipped models too (with new `soul-cinema`, `soul-hex` and `dop-mix` suites and a palette metric); the other Originals' suites measure their recipes on models already in the catalog, and cases that need the Original itself are skipped. Cloud runs are priced first and capped (default $5), and nothing goes through Higgsfield. Nothing has been measured on a GPU or the cloud yet; see [`scripts/eval/README.md`](scripts/eval/README.md)
- **No keys? No GPU?** Demo mode lets you click through everything with clearly-labelled placeholder outputs.

> Project status, what works, what's verified and what's left: **[docs/STATUS.md](docs/STATUS.md)** (also in-app at `/status`).

## Quick start

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

On Windows, double-click `start.bat` instead: it installs pnpm and dependencies when they're missing, rebuilds when the source changed, starts the production server and opens the browser (`start.bat dev` runs the dev server; set `PORT` for another port; if it's taken, the next free one is used).

Open **Settings** and pick an **Engine mode**:

| Engine mode | What the install offers | Needs |
|---|---|---|
| **Open source + paid APIs** (default) | A Cloud / Open source switch in every studio | A paid-API key and/or a ComfyUI server |
| **Open source only** | Only open-weight models on your ComfyUI; paid models are hidden and rejected by the server, and text steps never call a paid API on their own | A ComfyUI server |
| **Paid APIs only** | Only hosted frontier models; open-source models are hidden and rejected | A fal.ai or Replicate key |

The mode can also be set with `FUOBE_ENGINE_MODE=both|open|cloud`. Then connect what you have:

| You have | What to set | You get |
|---|---|---|
| A [fal.ai](https://fal.ai/dashboard/keys) key | `fal.ai API key` (or `FAL_KEY`) | Every cloud model and cloud app |
| A Replicate token | `Replicate API token` (or `REPLICATE_API_TOKEN`) | Fallback route for models Replicate hosts; **Preferred provider** (or `FUOBE_CLOUD_PROVIDER`: `auto`, `fal`, `replicate` or `higgsfield`) picks which one goes first, unless only the other can carry the run's LoRAs or make the clip length asked |
| A [Higgsfield API](https://console.higgsfield.ai) key | `Higgsfield API key` as `KEY_ID:KEY_SECRET` (or `HIGGSFIELD_API_KEY`, `HF_KEY`, or `HF_API_KEY` + `HF_API_SECRET`) | Soul 2.0 / Soul Cinema / Soul v1 with live presets, Soul ID training, Genjutsu and Genjutsu Lite, Cinema Studio 4.0, Marketing Studio, Ads Studio, plus extra routes for Seedance, Kling, Wan, MiniMax… |
| A GPU running ComfyUI | `ComfyUI server URL` (or `COMFYUI_URL`, default `http://127.0.0.1:8188`; `COMFYUI_TOKEN` if it sits behind a proxy) | Every open-source model, app, motion, effect and studio route |
| An Anthropic key | `Anthropic API key` (or `ANTHROPIC_API_KEY`) | The full **Assist** agent (Smart and Manual modes), text steps (translate, write, scripts, ad copy, brand research), prompt **Enhance** and storyboard splitting with Claude |
| Ollama | `Prompt enhancement` → Ollama (`OLLAMA_URL`, `OLLAMA_MODEL`, default `qwen3:8b`; `FUOBE_ENHANCE_PROVIDER`) | The same text steps and the Assist agent on a local model (tool calling) |
| A LoRA folder (and a civitai account) | **Settings → LoRAs**: `LoRA folder`, ComfyUI's `models/loras` (or `COMFYUI_LORAS_DIR`), and `civitai API key` (or `CIVITAI_API_KEY`) | Fuobe downloads a LoRA ComfyUI doesn't have before the run and checks its fingerprint. 72 of the 114 library LoRAs are on civitai and need the key, which is never sent to fal or Replicate. 87 of Fuobe Soul's looks use one, and 36 of the motions' and effects' LoRA files are among them |
| AI-Toolkit (ostris) on your GPU | `AI_TOOLKIT_URL` (+ `AI_TOOLKIT_AUTH`, `AI_TOOLKIT_DATASET_DIR`) and `COMFYUI_LORAS_DIR` | Train character and style LoRAs from an element's photos or a moodboard; the result is copied into ComfyUI and used whenever you @mention it |

Each connection field in Settings has **Save & test**: what you typed is tested before it is saved, and a failure says why. Until something is connected (or you hide it), Home and Settings show a **Get started** card with the three ways in.

Keys are stored in a local SQLite database (`data/fuobe.db`) and never sent to the browser. Generated media is saved under `data/files/`, and LoRAs downloaded only to copy them to fal or Replicate under `data/loras/`. Fuobe is single-user.

### Self-hosting and security

Before you open Fuobe to a network, set a password (**Settings → Security**, or `FUOBE_PASSWORD`): every page and API call then needs a sign-in or an API token (`Authorization: Bearer fuobe_…`), which you create on the same page for scripts and MCP clients:

```bash
claude mcp add --transport http fuobe http://localhost:3000/api/mcp --header "Authorization: Bearer fuobe_…"
```

| Variable | What it does |
|---|---|
| `FUOBE_PASSWORD` | Turns sign-in on; a password set this way can't be changed from Settings |
| `FUOBE_ALLOWED_ORIGINS` | Extra hosts Fuobe is reached at, comma-separated. Without a password, Fuobe answers only on IP addresses, localhost, single-label and LAN names (`.local`, `.lan`, `.home.arpa`, `.internal`) and the machine's hostname; add any other domain (a reverse proxy, a tunnel, a Tailscale name), or `*` to turn the check off. Also counts as "same site" for the cross-site write check behind a proxy that forwards neither Host nor X-Forwarded-Host |
| `FUOBE_TRUST_PROXY=1` | Behind a reverse proxy: trust the last `X-Forwarded-For` hop, so wrong passwords lock out only that visitor (60 s). Without it, everyone shares one limit: slowed to one attempt every 4 s, never locked |
| `FUOBE_ALLOW_PRIVATE_URLS=1` | Let inputs, product links and project sources be fetched from private / LAN addresses (they are refused by default) |
| `FUOBE_DATA_DIR` | Where the database, files and `auth.json` live (default `./data`) |
| `FUOBE_DEMO_MODE` | `auto` (default: demo outputs only when a model's provider isn't connected), `on` or `off` |
| `FUOBE_SKILLS_DIR` | Where Assist's built-in skills are read from (default `./skills`) |
| `FUOBE_ENGINE_MODE`, `FUOBE_CLOUD_PROVIDER`, `FUOBE_ENHANCE_PROVIDER` | The Settings choices above |
| `OPENAI_API_KEY`, `GEMINI_API_KEY` | Read into Settings; no feature uses them yet |

Uploads up to 200 MB work with sign-in on. Inputs given as URLs are fetched only from public addresses unless `FUOBE_ALLOW_PRIVATE_URLS=1`.

### Upgrading from an earlier version

- **Get the new code and rebuild.** Pull `main`. On Windows, run `start.bat` as usual: it installs packages on every start and rebuilds because the code changed. On Mac or Linux, run `pnpm install`, then `pnpm build` (or just `pnpm dev`). Round 4 adds only one dependency, `@types/three` (for development; PR #9 and PR #10 add none); round 3 added `@xyflow/react`, `@google/model-viewer`, `three` and `unpdf`. In a checkout without `.next`, run `pnpm exec next typegen` (or a dev or build run) before `pnpm typecheck`.
- **Your data upgrades on its own.** The database migrations run once each at start-up, in order, and an existing `data/` folder (or `FUOBE_DATA_DIR`) keeps everything it holds. Round 4 adds three migrations: one for the Library's nested folders, pins and review status (PR #6), and two new tables in PR #9, `lora_mirrors` (each LoRA copy Fuobe makes) and `content_series` (Content Factory), added at the first start. PR #7 and PR #10 add none. The list is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#storage-srcserverdbts-storagets-settingsts).
- **Canvases are saved in a new form (PR #10).** A board is rewritten with pages the next time it is saved, and older Fuobe builds can't read it after that. Back up the data folder if you might go back to an earlier version. Scripts that read a canvas through the API: `GET /api/canvases/:id` now returns `canvas.pages` (each page with its graph), not `canvas.graph`.
- **If you ran one of the round-3 package branches** (`r3/*`, `r3b/*`) before they were merged, start with a fresh data folder. Those branches numbered their migrations differently, so tables can be missing. Move the old folder aside rather than deleting it if it holds results you want. The same goes for a folder used by the `r4/content-factory` branch on its own: there Content Factory's table took the Library migration's number, so the Library's folders, pins and review status would never be added.
- **Start on Home now runs the job** in Image, Video or Edit instead of only opening the studio. With a saved key for the default model this is a paid run; the line under the box says first what will run and what it costs. **⌘K / Ctrl+K** opens the search palette instead of going Home.
- **Topaz Video is priced by size:** $0.01/s at 720p, $0.02/s at 1080p and $0.06/s above, doubled at 60 fps (it was a flat $0.02/s at 2×). The default target is 1080p, and a size that wouldn't enlarge the clip moves up, so a 1080p clip now goes to 1440p at $0.06/s. Open-source video upscaling (SeedVR2, Real-ESRGAN) also asks for a size now, 720p to 2160p, instead of 2× or 4×.
- **Cloud Mixed Media costs more by default.** It now redraws each sampled frame (**Per frame**): about $6 for 10 s at 1K, where the video-to-video pass was one call. Pick **Fast** under Restyle to keep the old behaviour. API calls with no `modelId` and no `mode` now get Per frame; a model sent for the wrong mode gets a 422.
- **Click to Ad ends on a logo card by default** when the product kit has a logo: 2.5 s longer, included in the price. Switch **End card** off to keep the old ads. API calls without `endCard` are unchanged.
- **Motion and effect links open on the move's model (PR #10).** Picking a camera motion or effect in the Video studio, or arriving from Motions or Effects, now switches to the model its move runs on: Fuobe DoP or Fuobe DoP · LTX, a few on LTX-2.5. In the cloud, 152 presets change model and price; the other 211 keep Kling 2.5 Turbo as their route and leave the model you picked alone. Moodboards' curated looks open on Fuobe Soul. Per-megapixel cloud prices (Z-Image Turbo, Qwen-Image 2512, FLUX.1 Fill [pro]…) now count every picture, so n pictures quote about n× the old estimate. On a Canvas board, dragging the empty board now draws a selection box; scroll, Space-drag, the middle button or H pans.
- **Open-engine motions and effects no longer all run on Wan 2.2 (PR #10).** 17 open on Fuobe DoP · LTX (FPV Drone, Wind to Face, Earth Zoom Out, Flying Cam Transition and 13 transitions) and need the LTX-2.3 checkpoint (29.53 GB, plus the 9.45 GB Gemma 3 text encoder if LTX-2 isn't set up) and a 32 GB GPU. On 24 GB, pick Fuobe DoP: it runs their words. Slow Motion, Car Drive and Wild Ride open on LTX-2.5. Relight effects first run the existing Qwen-Image-Edit 2509 Relight workflow (about 31 GB of model files).
- **Cloud keys for the Originals (PR #10).** The presets that moved to Fuobe DoP, Fuobe Soul HD, the relight step and Focus Change need a fal key; Fuobe DoP (start frame only) and Fuobe Soul's text to image also run on Replicate. None runs on Higgsfield: with only a Higgsfield key, motion links and curated looks open on a model that can't run. Pick Kling 2.5 Turbo or another model, or add a fal key.
- **LoRAs on the open engine:** set the **LoRA folder** in Settings → LoRAs, plus a civitai key for 72 of the 114 library LoRAs. Fuobe writes the files itself, so the folder must be one the Fuobe machine can write to (ComfyUI on the same PC, or its `models/loras` shared); otherwise place the files by hand, as you must for the two gated Hugging Face LoRAs. With no folder set, a run that needs a LoRA ComfyUI doesn't have stops and says what to do. A LoRA sent to a workflow with no model loader to attach it to now fails the run instead of being dropped silently. Since PR #10 the presets use many more LoRAs on the open engine: 84 files (was 43), 36 of them from civitai (was none). Without the civitai key, a motion, an effect or one of six Cinema Studio moves (Handheld, POV, Robot Arm, Snorricam, Tracking and Side Tracking) that needs a civitai file ComfyUI doesn't have stops before the job; Fuobe Soul leaves those LoRAs out and says so.
- **Cloud runs with LoRAs:** when a model runs on both fal and Replicate, Fuobe picks the one that can take every LoRA and the clip length asked, even over **Preferred provider**. LoRAs a run can't take are left out with a warning.
- **Password-less installs reached by a domain name** (a reverse proxy, a tunnel, a Tailscale name) get 403 since round 3. Set a password, or add the name to `FUOBE_ALLOWED_ORIGINS`.
- **Inputs from LAN addresses** (an image URL on your NAS, say) are refused unless `FUOBE_ALLOW_PRIVATE_URLS=1` (also since round 3).
- **ComfyUI node packs:** re-run `scripts/comfy/install-comfyui.sh` (it keeps what's installed and pins each pack to the commit Fuobe was validated with). Round 3 added ComfyUI-MelBandRoFormer, ComfyUI-QwenASR and ComfyUI-HunyuanVideo-Foley; round 4 adds ComfyUI-ToSVG for the open Vectorize app (PR #9 and PR #10 add none). Open-source video upscaling and FPS Boost now also need ComfyUI-VideoHelperSuite (before, core ComfyUI was enough), which the script installs too. If you set up ComfyUI another way (ComfyUI Desktop, for example), install these packs yourself. ComfyUI itself needs no upgrade: the library still targets 0.41.0.
- **Models for the new tools.** Round 4 adds about 28 GB of model files to the library in PR #6 (PR #7 adds none): VOID with its CogVideoX VAE (22.73 GB, Remove object's "Shadows and reflections too"), MoGe 2 (0.66 GB, 3D scenes, and since PR #10 multi-view 3D too), OvisOCR3 (1.71 GB, Layers' text detection since PR #9) and TripoSplat (Image to 3D's Splat mode since PR #10). PR #10 adds about 35 GB more, both optional: the LTX-2.3 22B distilled checkpoint (29.53 GB, plus the Gemma 3 text encoder, 9.45 GB, if LTX-2 isn't set up) for Fuobe DoP · LTX, and Pixal3D multi-view (5.58 GB, plus MoGe 2 if the 3D scene isn't set up) for TRELLIS.2 Multi-view. Fuobe Soul's image to image and the Canvas Video concatenator need no new files. The new tools also use files the library already listed, which you may not have downloaded: Wan 2.1 VACE 14B (34.68 GB) and SAM 3.1 (Remove object; Genjutsu's swap and insert), Wan Animate 2 (Genjutsu's motion transfer), Qwen-Image-Edit 2511 with the Multiple-Angles LoRA (3D scenes) and RIFE 4.26 (FPS Boost). PR #9 adds no files to the library, but its tools use these: OvisOCR3 for Layers' text detection; Gemma 4 E4B (9.06 GB) plus ComfyUI-VideoHelperSuite for Content Factory's reading of a reference clip; FLUX.1 Fill [dev] (23.8 GB) for Layers' Inpaint. The **Workflows** page lists them with their install commands. GPU memory, from the manifest and not measured: Wan VACE 24 GB, VOID 24–40 GB, SeedVR2 in passes 16 GB, Gemma 4 E4B 12 GB, OvisOCR3 3 GB; since PR #10, LTX-2.3 22B 32 GB, TRELLIS.2 Multi-view 16 GB, Z-Image Turbo image to image 12 GB.
- **`pnpm test` also runs the evaluation harness's Python metric tests**, in the harness's own venv or through uv (which may download numpy, Pillow and pytest once); with neither, they are skipped. Nothing is removed in PR #9 or PR #10: no route, setting, environment variable, workflow or provider. PR #10 adds no setting or environment variable either, and `pnpm gen:catalog` now also writes Fuobe Soul's looks.

### Setting up the open-source engine

1. Install ComfyUI on a machine with a GPU (24 GB VRAM covers almost every workflow; Z-Image Turbo, Wan 2.2 5B and SDXL run in 8–16 GB; VOID, Remove object's "Shadows and reflections too", may need up to 40 GB, and Fuobe DoP · LTX's LTX-2.3 graphs 32 GB). `scripts/comfy/install-comfyui.sh` installs ComfyUI and the 16 custom node packs at the commits Fuobe was validated with, the non-commercial ComfyUI-Whisper included (`NC_PACKS=0` leaves it out; Settings → Models & licences switches packs and models off per install).
2. Open **ComfyUI workflows** in Fuobe. Each workflow lists the model files it needs, which are already installed (✓) and a **Copy install commands** button that produces the exact `wget` / `git clone` lines.
3. Switch the engine toggle (top-right of every studio) to **Open source**.
4. For LoRAs (Fuobe Soul's looks, camera motions, effects, trained characters), set **Settings → LoRAs → LoRA folder** to ComfyUI's `models/loras`, and add a civitai key for civitai files. Fuobe then downloads a LoRA ComfyUI doesn't have before the run.

LatentSync 1.6 and ThinkSound are optional and run on a separate, isolated ComfyUI (`scripts/comfy/install-isolated-worker.sh`, port 8189); see [`scripts/comfy/README.md`](scripts/comfy/README.md). Lipsync offers LatentSync 1.6 and Sound effects offers ThinkSound, marked in the model picker as running on the isolated worker. Set its address as **Isolated worker URL** in Settings (or `COMFYUI_ISOLATED_URL`); without it, those jobs fail with a message naming the setting. Their workflows are validated, but not run with real weights. Open dubbing, Faceless and UGC narration clone a voice with Chatterbox, so they need a voice sample (record or upload one). Open-source translation uses Ollama when it's running, and Qwen3.5 4B on your ComfyUI when it isn't.

To check a ComfyUI connection end to end without downloading any models:

```bash
pnpm dev &
pnpm test:e2e:comfyui http://localhost:3000   # runs the weight-free workflows through the full pipeline (mux, trim, segment, captions, meta-batch), checked with ffprobe when installed
node tests/e2e/comfyui-faceless-plus.mjs http://localhost:3000   # Ken Burns, the packet-copy join, a crossfaded audio loop and join; needs ffmpeg and ffprobe and demo mode off; on Linux it also samples ComfyUI's memory (found with pgrep, or set COMFYUI_PID)
node tests/e2e/comfyui-canvas-concat.mjs http://localhost:3000   # the Canvas Video concatenator: three test clips are cut, framed to 9:16 at 30 fps and joined, then the film is probed; model-free, needs ffmpeg and ffprobe
```

## Development

```bash
pnpm typecheck && pnpm lint && pnpm test   # TypeScript, ESLint, Vitest (141 files, 2256 tests; with uv, also the harness's Python metric tests)
pnpm build                                  # production build
pnpm gen:catalog                            # regenerate cloud models, Higgsfield models and presets, LoRA map, LoRA library, AI Influencer options, Fuobe Soul's looks and icon map from docs/research/*.json
pnpm dev:clean                              # clear the Turbopack cache if the dev server gets stuck reloading or serves stale CSS
node scripts/gen-demo-3d.mjs                # regenerate the demo GLB and turntable (needs ffmpeg)
```

Browser checks (the app must be running; demo mode is fine; Playwright and Chromium are picked up from the repo, a global install or `$CHROMIUM_PATH`):

```bash
pnpm test:e2e:mobile [url] [--light|--dark]    # no route may scroll sideways at 390 px (every route, hub mode and sample id)
pnpm test:e2e:shell [url]                      # skip link and landmarks, ⌘K palette, phone drawer and Search, full-screen studios, settings deep links, keyboard Show more
pnpm test:e2e:library [url]                    # helper steps, pins, review status, nested folders, zips, upload delete, phone layout (cleans up after itself; --keep leaves its data)
pnpm test:e2e:comfyui [url]                    # the open engine against a live ComfyUI
node tests/e2e/composer-flows.mjs [url]        # first paint, typing before hydration, paste, upload cancel, phone toolbar and blocker line
node tests/e2e/notifications.mjs [url]         # job notifications and the running count in the tab title
node tests/e2e/clipboard.mjs [url]             # Copy buttons on a plain-http LAN address (no Clipboard API)
node tests/e2e/layers.mjs [url]                # Layers regressions
node tests/e2e/cinema-scene.mjs [url]          # 3D scene: ask first, point cloud, fly, Capture → re-render, 390 px
node tests/e2e/canvas-smoke.mjs [url] --perf=60  # Canvas save, rename, trash → re-run, keystroke timing
node tests/e2e/canvas-board.mjs [url]          # Canvas drawing, shapes, text, comments, groups and Run group, pages, Undo across pages
node tests/e2e/canvas-open-dub.mjs [url]       # Translate (video) on an open-source-only install (sets Engine mode for the run, then puts it back)
node tests/e2e/dop-flows.mjs [url]             # Fuobe DoP in the Video studio: prices, engine switch, grade hand-off, 390 px (any string as the fal key adds the cloud prices; nothing is sent)
node tests/e2e/cinema-shortcuts.mjs [url]      # Ctrl/Cmd+Enter only from Cinema's prompt bar; new project names, phone Director chip
node tests/e2e/assist-flows.mjs [url]          # skills, memory, projects, skill upload, modes, phone sheet
```

`layers.mjs` and `cinema-scene.mjs` expect their open-engine step to run in demo mode: with a reachable ComfyUI they fail (demo stills are SVG placeholders ComfyUI can't read, and Layers needs the Qwen-Image-Layered weights).

The Fuobe Originals evaluation harness (see [`scripts/eval/README.md`](scripts/eval/README.md); `fuobe eval <command>` does the same from a checkout). `eval:run` needs a running Fuobe:

```bash
pnpm eval:validate                             # check every case file, and that the generated suites match the research
pnpm eval:run --suite selftest --engine demo   # about 30 s, free: submit, wait, download, score, report
pnpm eval:setup                                # the metrics venv (needs uv; CPU torch by default)
pnpm eval:review latest                        # rate a run's pairs blind, with the keyboard
pnpm eval:compare latest~1 latest              # wins, losses and mean gain per metric; exits 1 when a guarded metric regresses
pnpm eval:promote latest                       # does the recipe win? A person changes the default, in a reviewed commit
node tests/e2e/eval-review.mjs                 # the report and blind review pages at 1440 and 390 px, light and dark (no app needed)
```

- `docs/ARCHITECTURE.md` — how requests flow from the composer to providers and back, pipelines, live updates, security, each studio's modules
- `docs/cli.md` — the `fuobe` command line: install, sign in, every command (`fuobe eval` included), MCP and skills for other agents
- `docs/research/` — the research this is built on (Higgsfield inventory, studios, image studios, marketing and agents, API, round-4 changes, in-house products; paid model APIs parts 1–4; ComfyUI equivalents parts 1–4; workflow library; the round-4 UX and speed audit; open recipes for Fuobe Originals; Liner UI language); [`docs/research/README.md`](docs/research/README.md) says what each file covers
- `docs/workers/tribe-v2.md` — the optional, non-commercial TRIBE v2 worker contract for the Virality predictor
- `scripts/comfy/` — the pipeline that exports and validates the ComfyUI workflow library
- `scripts/eval/` — the Fuobe Originals evaluation harness: suites, metrics, blind review and the promote rule
- `skills/` — Assist's built-in skills (`<name>/SKILL.md` in the Agent Skills format: name, description and compatibility, with Fuobe's own fields under `metadata`: title, when_to_use, icon, studio, tags, offline hints); `.agents/skills/fuobe/` teaches another agent to drive Fuobe through MCP or the CLI

## Tech

Next.js 16 (App Router, Cache Components) · React 19 · Tailwind CSS v4 · shadcn/ui (Radix) · TanStack Query · SQLite (better-sqlite3) · zod · fal.ai queue API · Replicate predictions API · Higgsfield API · ComfyUI HTTP + WebSocket API · Anthropic SDK (Claude) · Ollama · @xyflow/react (Canvas) · @google/model-viewer + three (3D) · unpdf (PDF text) · cmdk · WebGL · server-sent events · Vitest · Playwright · Python with uv (the evaluation harness's metrics).

## License notes

Fuobe's code is open source. Model weights have their own licenses: several open models used here are **non-commercial** (FLUX.1/FLUX.2 [dev], inswapper, MMAudio weights, USO's FLUX.1 base, some LoRAs, ComfyUI-Whisper's node code, TRIBE v2), HunyuanVideo-Foley and Hunyuan3D 2.1 exclude the EU, UK and South Korea, Stable Audio 3 is free under US$1M revenue (Stability Community licence), and VOID (Remove object's "Shadows and reflections too" on the open engine) is built on CogVideoX-5B, whose licence asks you to register before commercial use. Fuobe DoP · LTX on your GPU uses LTX-2.3 under the LTX-2 Community License (free below US$10M annual revenue) and the Gemma terms, and TRELLIS.2 and TripoSplat encode with DINOv3 (the DINOv3 License; their results show "Built with DINOv3"). The Workflows page, **Settings → About & licences** and `docs/research/comfyui-oss*.md` list each license. LoRAs have their own too: **Settings → LoRAs** shows each one's (commercial or not, your GPU only or also the cloud), and a LoRA licensed for your GPU only is never sent to fal or Replicate. Cloud models are billed by your provider.
