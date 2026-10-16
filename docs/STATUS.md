# Fuobe — project status

_Last updated: 2026-10-16. The research behind this is in [`docs/research/`](research/README.md); the Higgsfield inventory it is measured against is [`higgsfield-inventory.md`](research/higgsfield-inventory.md)._

**Legend**

| | meaning |
|---|---|
| ✅ | **Verified** — exercised end to end here (unit tests, a live ComfyUI, the browser) |
| 🟢 | **Built** — implemented against verified API schemas or validated workflows, but not yet run with real paid keys or real GPU weights |
| 🟡 | **Partial** — works, but approximates Higgsfield or misses part of the feature |
| ⬜ | **Not started** |

## 1. What has been verified

| check | result |
|---|---|
| `pnpm typecheck`, `pnpm lint` | clean |
| `pnpm test` (Vitest, 28 tests) | pass — payload mapping, durations/enums, response parsing, operation inference, prompt composition, batching, input validation, cost estimates, ComfyUI bindings, LoRA injection on Wan 2.2 experts, size/frame math, error hints, catalog integrity (every preset → existing model with that operation, every ComfyUI route → a workflow in the manifest, icons exist, defaults valid) |
| `pnpm build` | passes (150 prerendered pages) |
| Demo mode, browser | ✅ image and video generations queue, show live progress, land in the feed, open in the viewer; no console errors (headless Chromium, desktop + 390px mobile, light + dark) |
| ComfyUI engine, live server | ✅ `pnpm test:e2e:comfyui` against ComfyUI 0.41 (CPU): upload → bindings → `/prompt` → websocket/`/history` → download → library, for an image and a video workflow |
| ComfyUI workflow library | ✅ 51/51 workflows accepted by `POST /prompt` with no `node_errors` against real node definitions (placeholder weights — graph structure, input names, types and file references verified, **not output quality**) |
| ComfyUI error UX | ✅ a LoRA motion preset with missing files fails fast with "Missing model X — put it in ComfyUI/models/<folder> (download: URL)" for every missing file |
| Cloud providers (fal / Replicate) | 🟢 adapters and 67 model routes built from fal's per-endpoint OpenAPI schemas (499/517 researched endpoints verified); **no live paid run yet** — needs a key |
| Prompt enhancement | 🟢 Claude (Anthropic SDK) and Ollama paths built; offline rewriter ✅ |

## 2. Feature matrix vs Higgsfield

### Create

| Higgsfield feature | Fuobe | Cloud route | Open-source route | Notes |
|---|---|---|---|---|
| Create Image (multi-model) | 🟢 | 24 image models: Nano Banana Pro/2/2.1/1, Seedream 5 Pro/Lite & 4.5, GPT Image 2.5 Flare/Sunburst/2/1.5, FLUX.3, FLUX.2 Pro, Kontext Max, Ideogram 4.5, Recraft 4.1, Qwen Image 3, Wan 2.7, Z-Image, Imagen 4 | Z-Image Turbo, Qwen-Image 2512 (+Lightning), FLUX.2 dev (+Turbo), FLUX.1 Krea/dev/schnell, HiDream, SDXL | Batch ×1–4, aspect ratios, quality tiers, seeds, negative prompts, reference images |
| Higgsfield Soul / Soul 2.0 / Soul Cinema | ⬜ cloud · 🟡 open | Soul is Higgsfield's own model — only on Higgsfield's API (`api.higgsfield.ai`), no adapter yet | FLUX.1 Krea is the closest open "un-plastic" look | Add a Higgsfield provider adapter to offer Soul itself |
| Soul ID (character training) | 🟡 | Characters = named reference sets on multi-reference models (Nano Banana Pro, Seedream) | Qwen-Image-Edit 2511 / FLUX.2 dev multi-ref | No LoRA training yet (planned: ai-toolkit job for Z-Image / FLUX / Qwen LoRAs) |
| Create Video (multi-model) | 🟢 | 40 video models: Seedance 2.5/2.0/Fast/1.0 Pro, Kling 3.0/Turbo/4K/O3/O1/2.6/2.5 Turbo, Veo 3.1/Fast/Lite, Gemini Omni Flash, Wan 3.0/Prime/2.7/2.6/2.5, MiniMax H3/H3 Max/Hailuo 2.3/02, FLUX.3 Video, LTX 2.5, PixVerse V6, Vidu Q3, Luma Ray 3.2 | Wan 2.2 14B (+Lightning), Wan 2.2 5B, LTX-2.5, LTX-2, HunyuanVideo 1.5, Wan VACE | Text, image, start+end frame, references, native audio toggle, durations, resolutions |
| Start & end frame | 🟢 | Kling, Veo, Seedance, Wan, MiniMax, PixVerse, FLUX.3 | Wan 2.2 FLF2V | |
| Reference-to-video / Elements | 🟡 | Seedance, Kling O3/O1, Veo, Wan, MiniMax, Vidu | Wan VACE | References via "Add ref"; no `@name` element syntax in the prompt yet |
| Camera motions (DoP presets) | 🟢 | 108 presets on any video model (Kling 2.5 Turbo default) | Wan 2.2 + 18 dedicated camera LoRAs, 11 moves via Wan Fun Camera poses, the rest prompt-only | "Mix" (combining two motions) ⬜ |
| Effects / Viral presets | 🟢 | 255 effects | 35 with dedicated effect LoRAs (Remade-AI etc.), rest prompt-only | Most open effect LoRAs target Wan 2.1 I2V; applied to Wan 2.2 — **quality needs GPU validation** |
| Multi-shot generation | ⬜ | Kling 3 `multi_prompt` and Seedance multi-shot exist in the schemas but aren't wired | — | |
| Seedance Draft mode | ⬜ | `draft` field exists on Seedance 2.5 | — | |
| Motion Control | 🟢 | Kling 3.0 Motion Control | Wan Animate 2, Wan 2.2 Fun Control | `/motion-control` |
| Edit Video | 🟢 | Kling O3/O1 edit, Gemini Omni edit, Wan 2.7 edit, Luma Ray 3.2 | Wan 2.2 Fun Control (approximation) | `/video-edit` |
| Extend video, Reframe, Relight/Recolor video | ⬜ | Endpoints exist (MiniMax extend, Luma reframe, PixVerse extend, LTX extend) | — | |
| Draw to Video, Cinema Studio, Genjutsu, Shorts Studio | ⬜ | | | Higgsfield-specific multi-step products |

### Edit & apps

| Higgsfield feature | Fuobe | Notes |
|---|---|---|
| Edit image (instruction edit) | 🟢 | Any edit model, up to 14 references (cloud) / 3 (open) |
| Inpaint / Draw to Edit | 🟡 | FLUX Fill inpaint workflow exists (open); **no mask-drawing canvas yet** |
| Expand (outpaint) | 🟢 | Expand Image app; open route = FLUX Fill outpaint |
| Upscale image / video | 🟢 | Topaz, SeedVR2, Recraft Crisp (cloud); ESRGAN, SeedVR2 (open) |
| Relight, Angles, Skin Enhancer, Color Grading, Headshots, Try-On, Packshot, Product Placement, Face/Character Swap… | 🟢 | 118 apps total: 116 have both engines, 2 are open-only (Recast, Video Face Swap). Most are instruction edits on Nano Banana Pro / Qwen-Image-Edit, exactly how Higgsfield builds them. Face Swap's open route uses ReActor |
| Approximated apps | 🟡 | 17 apps carry an explicit `parity` note (shown on the app page), e.g. Virality Predictor, Click to Ad (needs a product photo instead of a URL), multi-cut templates done in one pass |
| Layers, Photodump, Popcorn storyboards, Moodboards, Soul HEX | ⬜ | |

### Characters, lipsync, audio

| Higgsfield feature | Fuobe | Notes |
|---|---|---|
| Lipsync Studio / talking avatars | 🟢 | Kling Avatar 2.0/1, OmniHuman 2/1.5, InfiniteTalk, Sync Lipsync 3/2 Pro (cloud); InfiniteTalk native (~6 s) and long (WanVideoWrapper), Wan 2.2 S2V (open) |
| AI Influencer / characters | 🟡 | Characters page (reference sets); no persona generator |
| Text to speech | 🟡 | ElevenLabs v3 with a fixed voice — **voice picker ⬜**; open TTS (Chatterbox/IndexTTS2) ⬜ (needs custom nodes) |
| Sound effects, music | 🟢 | ElevenLabs SFX/Music (cloud), ACE-Step 1.5 (open) |
| Sound for video (foley) | 🟢 | MMAudio cloud + open |
| Voice cloning, voice change, dubbing/translate | ⬜ | |

### Platform

| Higgsfield feature | Fuobe | Notes |
|---|---|---|
| Assets library, favorites, search, reuse/remix, "animate this image" hand-offs, download | ✅ | Library page, tile actions (Animate, Edit, Upscale, Use as reference, Lipsync, Add sound), viewer with keyboard shortcuts |
| Live progress, cancel, retry, failure messages | ✅ | Shimmer status, percent, elapsed time, cancel; retries re-submit the same request |
| Credits / pricing | 🟡 | Bring-your-own-key: live cost estimate per run from provider prices; "Free" for open source; no billing |
| Accounts, teams, sharing, community feed, contests | ⬜ | Single-user, self-hosted today |
| Supercomputer / Assist agent, MCP, plugins | ⬜ | |
| Canvas (node workflows) | 🟡 | ComfyUI itself is the node canvas for the open engine; no in-app canvas |
| Public API | 🟡 | The app's REST API (`/api/generations`, `/api/uploads`…) works but is unauthenticated — **don't expose Fuobe to the internet without a reverse-proxy auth layer** |

## 3. Known issues and caveats

- **Paid providers are untested with real keys.** Field names come from fal's OpenAPI files, so they should be right, but the first live runs may surface model-specific quirks (e.g. size enums, safety flags). The model picker marks models whose provider isn't connected as "demo".
- **Open-source quality is unverified.** Workflows are structurally validated, not run with real weights (this machine has no GPU). Expect to tune steps/CFG per model once run on a GPU.
- **Wan 2.1 LoRAs on Wan 2.2:** most viral-effect LoRAs were trained for Wan 2.1 I2V 480p; they are injected on both Wan 2.2 experts. Some may need a lower strength or only the low-noise expert.
- **Licenses:** FLUX.1/FLUX.2 [dev], inswapper (ReActor), MMAudio weights and some LoRAs are non-commercial; MiniMax H3 open weights exclude some regions. See `research/comfyui-oss.md`.
- **Sunsets:** Sora 2's API was retired (2026-09-24) so it is not offered; Veo 3.1 on fal ends 2026-11-17 (Replicate route already present); Luma Ray 2 is replaced by Ray 3.2.
- **Dev-mode hot reload:** background polling survives hot reloads; after editing provider code, already-queued jobs use the new code.

## 4. What's next (prioritized)

1. **Live-key smoke test** of the top cloud models (Nano Banana Pro, Seedream 5, Kling 3.0, Seedance 2.5, Veo 3.1) and fix any schema surprises.
2. **GPU run** of the starter open set (Z-Image Turbo, Qwen-Image-Edit 2511, Wan 2.2 Lightning I2V, InfiniteTalk, ESRGAN), tune defaults, record real timings/VRAM in the manifest.
3. **Mask canvas** for inpaint / Draw to Edit, and **voice picker** + open TTS for audio.
4. **Character LoRA training** (Soul ID parity) via an ai-toolkit job, then use the LoRA in open image workflows.
5. **Higgsfield provider adapter** (Soul, Soul ID, DoP) for users who want Higgsfield's own models.
6. Multi-shot, draft mode, extend/reframe video, motion "Mix".
7. Auth + multi-user, shareable links, community feed.
8. Real preview media for apps/motions/effects (currently gradient cards).

## 5. How to reproduce the checks

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
# open-source engine against a live ComfyUI (no model weights needed):
bash scripts/comfy/start-comfyui.sh            # or point COMFYUI_URL at your own server
pnpm dev & pnpm test:e2e:comfyui http://localhost:3000
# re-export + re-validate the workflow library:
cd scripts/comfy && npm install && npm run all
```
