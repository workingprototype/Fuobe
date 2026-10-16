# Fuobe

**An open-source AI image & video studio — a 1:1 alternative to Higgsfield.**
Use the same frontier paid models Higgsfield uses (Nano Banana Pro, Seedance 2.5, Kling 3.0, Veo 3.1, Seedream 5, GPT Image 2.5, FLUX.3, MiniMax, Wan…) with your own fal.ai / Replicate key, **or** run the equivalent open-weight workflows on your own GPU through **ComfyUI**. Same studio, same apps, same camera motions — flip one switch.

- **Studios:** Image · Video (text, image, start/end frame, references) · Edit · Camera motions · Effects · Apps · Lipsync & avatars · Motion control · Edit video · Characters · Upscale · Audio (voice, SFX, music, sound-for-video) · Library
- **Catalog:** 67 cloud models + 34 open-source models, 118 apps, 108 camera motions, 255 effects
- **Open-source engine:** 53 API-format ComfyUI workflows exported from the official templates and validated against real ComfyUI node definitions, plus 170 researched LoRAs (camera moves, VFX) wired into the presets
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
| A Replicate token | `Replicate API token` (or `REPLICATE_API_TOKEN`) | Fallback route for models Replicate hosts; **Preferred provider** (or `FUOBE_CLOUD_PROVIDER`: `auto`, `fal` or `replicate`) picks which one goes first |
| A GPU running ComfyUI | `ComfyUI server URL` (or `COMFYUI_URL`, default `http://127.0.0.1:8188`) | Every open-source model, app, motion and effect |
| An Anthropic key or Ollama | `Prompt enhancement` | The **Enhance** toggle rewrites prompts with Claude or a local LLM (offline rewriter otherwise) |

Keys are stored in a local SQLite database (`data/fuobe.db`) and never sent to the browser. Generated media is saved under `data/files/`.

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
pnpm gen:catalog                            # regenerate cloud models, LoRA map and icon map from docs/research/*.json
```

- `docs/ARCHITECTURE.md` — how requests flow from the composer to providers and back
- `docs/research/` — the research this is built on (Higgsfield inventory, paid model APIs, ComfyUI equivalents, workflow library, Liner UI language)
- `scripts/comfy/` — the pipeline that exports and validates the ComfyUI workflow library

## Tech

Next.js 16 (App Router, Cache Components) · React 19 · Tailwind CSS v4 · shadcn/ui (Radix) · TanStack Query · SQLite (better-sqlite3) · fal.ai queue API · Replicate predictions API · ComfyUI HTTP + WebSocket API · Vitest · Playwright.

## License notes

Fuobe's code is open source. Model weights have their own licenses: several open models used here are **non-commercial** (FLUX.1/FLUX.2 [dev], inswapper, MMAudio weights, some LoRAs) — the Workflows page and `docs/research/comfyui-oss.md` list each license. Cloud models are billed by your provider.
