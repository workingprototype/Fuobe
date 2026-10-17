# Fuobe

**An open-source AI image, video and audio studio — a 1:1 alternative to Higgsfield.**
Use the same frontier paid models Higgsfield uses (Nano Banana Pro, Seedance 2.5, Kling 3.0, Veo 3.1, Seedream 5, GPT Image 2.5, FLUX.3, MiniMax, ElevenLabs…, and Higgsfield's own Soul and Cinema Studio) with your own fal.ai / Replicate / Higgsfield key, **or** run the equivalent open-weight workflows on your own GPU through **ComfyUI**. Same studio, same apps, same camera motions — flip one switch.

- **Assist:** describe the whole job in a chat; the agent picks models, shows the plan and its cost, runs it when you approve, checks the results and chains the next step. Runs on Claude or a local Ollama model
- **MCP:** other agents (Claude Code, Claude Desktop, any MCP client) can drive the studio through `/api/mcp`
- **Studios:** Image · Video (text, image, start/end frame, references, multi-shot, draft mode) · Edit · Inpaint & Draw to Edit · Color grading · Camera motions · Effects · Storyboard (and turn it into a film) · Apps · Lipsync & avatars · Motion control · Edit / Extend / Reframe video · Video tools (matte, relight, depth, join clips, match colors) · Audio (speech with voice picker and cloning, dialogue, voice change, translate, SFX, music, sound for video) · Library
- **Elements:** save characters, locations, props, styles and voices once, then `@mention` them in any prompt; train a character (Soul ID, a fal LoRA, or AI-Toolkit on your GPU) for a consistent face
- **Catalog:** 100 cloud models + 49 open-source models, 121 apps, 108 camera motions (mix any two), 255 effects
- **Open-source engine:** 73 API-format ComfyUI workflows exported from the official templates or community packs and validated against real ComfyUI node definitions, plus 170 researched LoRAs (camera moves, VFX) wired into the presets
- **No keys? No GPU?** Demo mode lets you click through everything with clearly-labelled placeholder outputs.

> Project status, what works, what's verified and what's left: **[docs/STATUS.md](docs/STATUS.md)** (also in-app at `/status`).

## Quick start

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Open **Settings** and pick an **Engine mode**:

| Engine mode | What the install offers | Needs |
|---|---|---|
| **Open source + paid APIs** (default) | A Cloud / Open source switch in every studio | A paid-API key and/or a ComfyUI server |
| **Open source only** | Only open-weight models on your ComfyUI; paid models are hidden and rejected by the server, and prompt enhancement never calls a paid API on its own | A ComfyUI server |
| **Paid APIs only** | Only hosted frontier models; open-source models are hidden and rejected | A fal.ai or Replicate key |

The mode can also be set with `FUOBE_ENGINE_MODE=both|open|cloud`. Then connect what you have:

| You have | What to set | You get |
|---|---|---|
| A [fal.ai](https://fal.ai/dashboard/keys) key | `fal.ai API key` (or `FAL_KEY`) | Every cloud model and cloud app |
| A Replicate token | `Replicate API token` (or `REPLICATE_API_TOKEN`) | Fallback route for models Replicate hosts; **Preferred provider** (or `FUOBE_CLOUD_PROVIDER`: `auto`, `fal`, `replicate` or `higgsfield`) picks which one goes first |
| A [Higgsfield API](https://console.higgsfield.ai) key | `Higgsfield API key` as `KEY_ID:KEY_SECRET` (or `HIGGSFIELD_API_KEY`, `HF_KEY`, or `HF_API_KEY` + `HF_API_SECRET`) | Soul 2.0 / Soul Cinema / Soul v1, Soul ID training, Genjutsu, Cinema Studio 4.0, Marketing Studio, plus extra routes for Seedance, Kling, Wan, MiniMax… |
| A GPU running ComfyUI | `ComfyUI server URL` (or `COMFYUI_URL`, default `http://127.0.0.1:8188`) | Every open-source model, app, motion and effect |
| An Anthropic key | `Anthropic API key` (or `ANTHROPIC_API_KEY`) | The full **Assist** agent, prompt **Enhance** and storyboard splitting with Claude |
| Ollama | `Prompt enhancement` → Ollama (`OLLAMA_URL`, `OLLAMA_MODEL`, default `qwen3:8b`) | Local prompt enhancement, storyboard splitting and the Assist agent (tool calling) |
| AI-Toolkit (ostris) on your GPU | `AI_TOOLKIT_URL` (+ `AI_TOOLKIT_AUTH`, `AI_TOOLKIT_DATASET_DIR`) and `COMFYUI_LORAS_DIR` | Train character LoRAs from an element's photos; the result is copied into ComfyUI and used whenever you @mention the character |

Keys are stored in a local SQLite database (`data/fuobe.db`) and never sent to the browser. Generated media is saved under `data/files/`. Fuobe is single-user. Before you open it to a network, set a password (**Settings → Security**, or `FUOBE_PASSWORD`): every page and API call then needs a sign-in or an API token (`Authorization: Bearer fuobe_…`), which you create on the same page for scripts and MCP clients:

```bash
claude mcp add --transport http fuobe http://localhost:3000/api/mcp --header "Authorization: Bearer fuobe_…"
```

### Setting up the open-source engine

1. Install ComfyUI on a machine with a GPU (24 GB VRAM covers almost every workflow; Z-Image Turbo, Wan 2.2 5B and SDXL run in 8–16 GB).
2. Open **ComfyUI workflows** in Fuobe. Each workflow lists the model files it needs, which are already installed (✓) and a **Copy install commands** button that produces the exact `wget` / `git clone` lines.
3. Switch the engine toggle (top-right of every studio) to **Open source**.

To check a ComfyUI connection end to end without downloading any models:

```bash
pnpm dev &
pnpm test:e2e:comfyui http://localhost:3000   # runs two weight-free workflows through the full pipeline
```

## Development

```bash
pnpm typecheck && pnpm lint && pnpm test   # TypeScript, ESLint, Vitest
pnpm build                                  # production build
pnpm gen:catalog                            # regenerate cloud models, Higgsfield models, LoRA map and icon map from docs/research/*.json
pnpm dev:clean                              # clear the Turbopack cache if the dev server gets stuck reloading
```

- `docs/ARCHITECTURE.md` — how requests flow from the composer to providers and back
- `docs/research/` — the research this is built on (Higgsfield inventory and API, paid model APIs, ComfyUI equivalents, workflow library, Liner UI language)
- `scripts/comfy/` — the pipeline that exports and validates the ComfyUI workflow library

## Tech

Next.js 16 (App Router, Cache Components) · React 19 · Tailwind CSS v4 · shadcn/ui (Radix) · TanStack Query · SQLite (better-sqlite3) · fal.ai queue API · Replicate predictions API · Higgsfield API · ComfyUI HTTP + WebSocket API · Anthropic SDK (Claude) · WebGL · Vitest · Playwright.

## License notes

Fuobe's code is open source. Model weights have their own licenses: several open models used here are **non-commercial** (FLUX.1/FLUX.2 [dev], inswapper, MMAudio weights, some LoRAs) — the Workflows page and `docs/research/comfyui-oss.md` list each license. Cloud models are billed by your provider.
