# Fuobe

**An open-source AI image, video and audio studio — a 1:1 alternative to Higgsfield.**
Use the same frontier paid models Higgsfield uses (Nano Banana Pro, Seedance 2.5, Kling 3.0, Veo 3.1, Seedream 5, GPT Image 2.5, FLUX.3, Gemini Omni, MiniMax, ElevenLabs…, and Higgsfield's own Soul and Cinema Studio) with your own fal.ai / Replicate / Higgsfield key, **or** run the equivalent open-weight workflows on your own GPU through **ComfyUI**. Same studio, same apps, same camera motions — flip one switch.

- **Assist:** describe the whole job in a chat; the agent picks models, shows the plan and its cost, runs it when you approve, checks the results and chains the next step. Free / Smart / Manual modes, 20 built-in **skills** (SKILL.md playbooks, or upload your own), **projects** with instructions and up to 20 sources (links, files and PDFs, elements, notes), and **memory**. Runs on Claude, a local model (Ollama, LM Studio, Unsloth Studio or another OpenAI-compatible server), or an offline planner
- **MCP:** other agents (Claude Code, Claude Desktop, any MCP client) can drive the studio through `/api/mcp`, including whole studio jobs (layers, restyle, dub, faceless episode, ads, captions, Katana; they run as plain pipelines and don't open a studio session yet) and the skills as prompts
- **Create:** Image · Video (text, image, start/end frame, reference images and clips, multi-shot, draft mode) · Edit · **Layers** (split a flat image into editable layers, edit text, regional edits, cropped or positioned zips) · Inpaint & Draw to Edit · Color grading · Camera motions · Effects · Storyboard (and turn it into a film) · **Canvas** (wire prompts, files and models into node workflows; every template in a cloud and an open-source version) · Apps
- **Studios:**
  - **Cinema Studio** — projects and scenes, Director's Panel (camera, lens, 50 palettes, lighting rig, Emotion Wheel), 33 camera moves (# in the prompt bar), AI Director, image grids, Soul Cast and Soul Location
  - **Shorts Studio** — restyle up to 2 minutes of your own footage with 44 looks (or your own references), in segments you can regenerate, stitched back under your sound; **Mixed Media** — 33 looks for 1–10 s clips with per-preset settings and a preview frame
  - **Marketing Studio** (84 templates), **Click to Ad**, **Ads Studio** (brand kit from your website, up to 20 ads per product in 1:1 / 4:5 / 9:16) and **Ad Multiplier**
  - **Moodboards**, **Color signature** (Soul HEX palettes), **Photodump / Instadump**, **Fashion Factory**, **Character Sheet**
  - **Faceless Studio** and **Explainer** — channels, scripts, narrated and subtitled episodes with a timeline editor
  - **Translate & dub** (your voice, lip-synced, over the original background on the open engine), **Captions** (transcribe, edit, burn in), **Trim**, **Katana** (recreate a reference edit with your subject), **Image to 3D**, Lipsync & avatars, Motion control, Edit / Extend / Reframe video, Video tools (matte, relight, depth, join clips, match colors), Upscale, Audio (speech with voice picker and cloning, dialogue, voice change, sound effects, music, sound for video), and a Virality predictor (a labelled heuristic)
- **Library:** all your results (images, videos, audio, text, 3D) with layouts, filters, folders, bulk zip download and a Trash with 30-day restore; results arrive live
- **Elements:** save characters, locations, props, styles and voices once, then `@mention` them in any prompt; train a character (Soul ID, a fal LoRA, or AI-Toolkit on your GPU) for a consistent face
- **Catalog:** 157 cloud models + 73 open-source models (plus 32 hidden ones: chain steps, self-tests, browser tools, and four open models no studio offers yet), 123 apps, 108 camera motions (mix any two), 255 effects
- **Open-source engine:** 115 API-format ComfyUI workflows (official templates, community packs and hand-built graphs) validated against real ComfyUI node definitions, plus 43 researched LoRAs (camera moves, VFX) attached to 55 motion, effect and app presets
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
| A Replicate token | `Replicate API token` (or `REPLICATE_API_TOKEN`) | Fallback route for models Replicate hosts; **Preferred provider** (or `FUOBE_CLOUD_PROVIDER`: `auto`, `fal`, `replicate` or `higgsfield`) picks which one goes first |
| A [Higgsfield API](https://console.higgsfield.ai) key | `Higgsfield API key` as `KEY_ID:KEY_SECRET` (or `HIGGSFIELD_API_KEY`, `HF_KEY`, or `HF_API_KEY` + `HF_API_SECRET`) | Soul 2.0 / Soul Cinema / Soul v1 with live presets, Soul ID training, Genjutsu, Cinema Studio 4.0, Marketing Studio, Ads Studio, plus extra routes for Seedance, Kling, Wan, MiniMax… |
| A GPU running ComfyUI | `ComfyUI server URL` (or `COMFYUI_URL`, default `http://127.0.0.1:8188`; `COMFYUI_TOKEN` if it sits behind a proxy) | Every open-source model, app, motion, effect and studio route |
| An Anthropic key | `Anthropic API key` (or `ANTHROPIC_API_KEY`) | The full **Assist** agent (Smart and Manual modes), text steps (translate, write, scripts, ad copy, brand research), prompt **Enhance** and storyboard splitting with Claude |
| [Ollama](https://ollama.com) | **AI helper** → Local model server → Ollama or Automatic (`OLLAMA_URL`, `OLLAMA_MODEL`, default `qwen3:8b`) | The same text steps and the Assist agent on a local model (tool calling) |
| [LM Studio](https://lmstudio.ai) 0.4 or later | **AI helper** → LM Studio or Automatic (`LMSTUDIO_URL`, default `http://127.0.0.1:1234`; `LMSTUDIO_MODEL`, empty for the loaded model; `LMSTUDIO_API_TOKEN` only when its Require Authentication is on). In LM Studio, start the server (Developer → Start server, or `lms server start`) and download a model (`lms get qwen/qwen3-8b`) | The same on LM Studio. A model that isn't loaded yet is loaded with 16k context (`FUOBE_LLM_CONTEXT`), which Assist's tools need |
| [Unsloth Studio](https://unsloth.ai/docs/new/studio/install) | **AI helper** → Unsloth Studio or Automatic (`UNSLOTH_URL`, default `http://127.0.0.1:8888`; `UNSLOTH_API_KEY`: an `sk-unsloth-…` key from avatar → Settings → API; `UNSLOTH_MODEL`, empty for the loaded model). Load a model on its Chat page | The same on the model loaded in Unsloth Studio. Its server-side tools (Python, terminal, web search) are always off for Fuobe's calls |
| Another OpenAI-compatible server (llama.cpp's llama-server, vLLM, Jan…) | **AI helper** → Other (`FUOBE_LLM_URL`, the base URL such as `http://127.0.0.1:8080/v1`; `FUOBE_LLM_MODEL`; `FUOBE_LLM_API_KEY`) | The same on that server |
| AI-Toolkit (ostris) on your GPU | `AI_TOOLKIT_URL` (+ `AI_TOOLKIT_AUTH`, `AI_TOOLKIT_DATASET_DIR`) and `COMFYUI_LORAS_DIR` | Train character and style LoRAs from an element's photos or a moodboard; the result is copied into ComfyUI and used whenever you @mention it |

**AI helper** picks who writes: Automatic (Claude when a key is set, else a local model, else the offline rewriter), Claude, a local model only, or offline (`FUOBE_ENHANCE_PROVIDER=auto|anthropic|local|none`; the old value `ollama` means `local`). Its local model server is Automatic by default (`FUOBE_LLM_PROVIDER=auto`): the first one that answers with a model, in the order Ollama, LM Studio, Unsloth Studio, then the Other URL. `FUOBE_LLM_PROVIDER=ollama|lmstudio|unsloth|custom` pins one. Settings → AI helper shows what each server answers (its models, whether one is loaded, what's missing) and has a **Test connection** button. The local model shares the GPU with ComfyUI, so a 4–8B model leaves room for generations.

Keys are stored in a local SQLite database (`data/fuobe.db`) and never sent to the browser. Generated media is saved under `data/files/`. Fuobe is single-user.

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
| `FUOBE_ENGINE_MODE`, `FUOBE_CLOUD_PROVIDER`, `FUOBE_ENHANCE_PROVIDER`, `FUOBE_LLM_PROVIDER` | The Settings choices above |
| `FUOBE_LLM_CONTEXT` | Tokens of context for the local model (default `16384`): Ollama's `num_ctx`, and the context LM Studio loads a model with. `0` leaves it to the server |
| `OPENAI_API_KEY`, `GEMINI_API_KEY` | Read into Settings; no feature uses them yet |

Uploads up to 200 MB work with sign-in on. Inputs given as URLs are fetched only from public addresses unless `FUOBE_ALLOW_PRIVATE_URLS=1`.

### Upgrading from an earlier version

- **Your data upgrades on its own.** The database migrations run once each at start-up, in order, and an existing `data/` folder (or `FUOBE_DATA_DIR`) keeps everything it holds. The list is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#storage-srcserverdbts-storagets-settingsts).
- **If you ran one of the round-3 package branches** (`r3/*`, `r3b/*`) before they were merged, start with a fresh data folder. Those branches numbered their migrations differently, so tables can be missing. Move the old folder aside rather than deleting it if it holds results you want.
- **Install the new dependencies:** `pnpm install` (round 3 adds `@xyflow/react`, `@google/model-viewer`, `three` and `unpdf`), then `npx next typegen` before `pnpm typecheck`.
- **Password-less installs reached by a domain name** (a reverse proxy, a tunnel, a Tailscale name) now get 403. Set a password, or add the name to `FUOBE_ALLOWED_ORIGINS`.
- **Inputs from LAN addresses** (an image URL on your NAS, say) are refused unless `FUOBE_ALLOW_PRIVATE_URLS=1`.
- **ComfyUI:** re-run `scripts/comfy/install-comfyui.sh` for the three node packs round 3 adds (ComfyUI-MelBandRoFormer, ComfyUI-QwenASR, ComfyUI-HunyuanVideo-Foley) at their pinned commits.

### Setting up the open-source engine

1. Install ComfyUI on a machine with a GPU (24 GB VRAM covers almost every workflow; Z-Image Turbo, Wan 2.2 5B and SDXL run in 8–16 GB). `scripts/comfy/install-comfyui.sh` installs ComfyUI and the 14 custom node packs at the commits Fuobe was validated with (`NC_PACKS=1` adds the non-commercial ComfyUI-Whisper).
2. Open **ComfyUI workflows** in Fuobe. Each workflow lists the model files it needs, which are already installed (✓) and a **Copy install commands** button that produces the exact `wget` / `git clone` lines.
3. Switch the engine toggle (top-right of every studio) to **Open source**.

LatentSync 1.6 and ThinkSound are optional and run on a separate, isolated ComfyUI (`scripts/comfy/install-isolated-worker.sh`, port 8189); see [`scripts/comfy/README.md`](scripts/comfy/README.md). Their workflows are validated, but they are hidden models that no studio offers yet (the API takes them by `modelId`). Open dubbing, Faceless and UGC narration clone a voice with Chatterbox, so they need a voice sample (record or upload one).

To check a ComfyUI connection end to end without downloading any models:

```bash
pnpm dev &
pnpm test:e2e:comfyui http://localhost:3000   # runs the weight-free workflows through the full pipeline (mux, trim, segment, captions, meta-batch), checked with ffprobe when installed
```

## To do

- [ ] **Chunked uploads, so files over 100 MB work on fuobe.com.** Cloudflare (Free and Pro plans) refuses a request body over 100 MB, but Fuobe accepts 200 MB, so a 100–200 MB upload fails there. Send files over about 90 MB as 50 MB chunks and join them on the server before `saveFile()`: add a chunk endpoint next to `src/app/api/uploads/route.ts` and one client helper for its three callers (`src/components/studio/media-slot.tsx`, `src/lib/api.ts`, and `src/components/shorts/use-source-clip.ts`, which keeps its progress bar). Smaller files upload in one request, as now. See [docs/deploy.md](docs/deploy.md#cloudflare-limits).

## Development

```bash
pnpm typecheck && pnpm lint && pnpm test   # TypeScript, ESLint, Vitest (79 files, 1128 tests)
pnpm build                                  # production build
pnpm gen:catalog                            # regenerate cloud models, Higgsfield models and presets, LoRA map and icon map from docs/research/*.json
pnpm dev:clean                              # clear the Turbopack cache if the dev server gets stuck reloading or serves stale CSS
node scripts/gen-demo-3d.mjs                # regenerate the demo GLB and turntable (needs ffmpeg)
node scripts/model3d/finish-glb.mjs --in raw.glb --out web.glb          # the server's GLB finish, by hand
node scripts/model3d/render-turntable.mjs --glb web.glb --out spin.mp4  # the server's CPU turntable (needs ffmpeg and a Playwright Chromium: npx playwright-core install chromium-headless-shell)
```

Browser checks (the app must be running; demo mode is fine; Playwright and Chromium are picked up from the repo, a global install or `$CHROMIUM_PATH`):

```bash
pnpm test:e2e:mobile [url] [--light|--dark]    # no route may scroll sideways at 390 px (every route, hub mode and sample id)
pnpm test:e2e:shell [url]                      # sidebar drawer, collapsed groups, settings deep links, keyboard Show more
pnpm test:e2e:comfyui [url]                    # the open engine against a live ComfyUI
node tests/e2e/composer-flows.mjs [url]        # first paint, typing before hydration, paste, upload cancel, phone toolbar
node tests/e2e/layers.mjs [url]                # Layers regressions
node tests/e2e/canvas-smoke.mjs [url] --perf=60  # Canvas save, rename, trash → re-run, keystroke timing
node tests/e2e/cinema-shortcuts.mjs [url]      # Ctrl/Cmd+Enter only from Cinema's prompt bar
node tests/e2e/assist-flows.mjs [url]          # skills, memory, projects, skill upload, modes, phone sheet
```

- `docs/ARCHITECTURE.md` — how requests flow from the composer to providers and back, pipelines, live updates, security, each studio's modules
- `docs/research/` — the research this is built on (Higgsfield inventory, studios, image studios, marketing and agents, API; paid model APIs parts 1–3; ComfyUI equivalents parts 1–3; workflow library; Liner UI language)
- `docs/workers/tribe-v2.md` — the optional, non-commercial TRIBE v2 worker contract for the Virality predictor
- `docs/deploy.md` — how fuobe.com is hosted and auto-deployed from `main` (server files in `deploy/fuobe.com/`)
- `scripts/comfy/` — the pipeline that exports and validates the ComfyUI workflow library
- `skills/` — Assist's built-in skills (`<name>/SKILL.md` with frontmatter: name, title, description, when_to_use, icon, studio, tags, offline hints)

## Tech

Next.js 16 (App Router, Cache Components) · React 19 · Tailwind CSS v4 · shadcn/ui (Radix) · TanStack Query · SQLite (better-sqlite3) · zod · fal.ai queue API · Replicate predictions API · Higgsfield API · ComfyUI HTTP + WebSocket API · Anthropic SDK (Claude) · Ollama, LM Studio, Unsloth Studio and OpenAI-compatible chat APIs · @xyflow/react (Canvas) · @google/model-viewer + three (3D) · unpdf (PDF text) · cmdk · WebGL · server-sent events · Vitest · Playwright.

## License notes

Fuobe's code is open source. Model weights have their own licenses: several open models used here are **non-commercial** (FLUX.1/FLUX.2 [dev], inswapper, MMAudio weights, USO's FLUX.1 base, some LoRAs, ComfyUI-Whisper's node code, TRIBE v2), HunyuanVideo-Foley and Hunyuan3D 2.1 exclude the EU, UK and South Korea, and Stable Audio 3 is free under US$1M revenue (Stability Community licence). The Workflows page and `docs/research/comfyui-oss*.md` list each license. Cloud models are billed by your provider.
