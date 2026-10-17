# Research

Everything Fuobe's catalog is built from. JSON files are machine-readable and feed the generators in `scripts/`.

| file | what it covers | used by |
|---|---|---|
| [`higgsfield-inventory.md`](higgsfield-inventory.md) / [`.json`](higgsfield-inventory.json) | Higgsfield as of 2026-10: navigation, 67 features with UX flows, 32 image + 43 video models, 94 apps, 113 camera motions, 274 effects, pricing, API | Preset catalog (`src/lib/catalog/apps.ts`, `motions.ts`), STATUS feature matrix |
| [`paid-model-apis.md`](paid-model-apis.md) / [`.json`](paid-model-apis.json) | 517 fal.ai / Replicate / vendor endpoints with exact input fields, enums, defaults, outputs and prices (499 verified from fal's OpenAPI files); fal and Replicate protocol notes; sunsets | `scripts/gen-cloud-models.py` → `cloud-models.generated.ts` |
| [`higgsfield-api.md`](higgsfield-api.md) / [`.json`](higgsfield-api.json) | Higgsfield's public API: auth, the request lifecycle, uploads, 101 endpoint records (Soul, Soul ID, Genjutsu, Cinema Studio, Marketing Studio, DoP and the hosted third-party models) with full inputs and prices; documentation-derived, no live call | `src/server/providers/higgsfield.ts`, `scripts/gen-higgsfield-models.py` → `higgsfield-models.generated.ts` |
| [`paid-model-apis-2.md`](paid-model-apis-2.md) / [`.json`](paid-model-apis-2.json) | Part 2: 202 fal / Replicate endpoints for multi-shot, draft mode, extend, reframe, relight, inpaint, voices, dialogue, voice change, dubbing, LoRA training, draw-to-video and storyboards; the ElevenLabs premade voices | `scripts/gen-cloud-models.py` (merged with part 1), training targets |
| [`comfyui-oss.md`](comfyui-oss.md) / [`.json`](comfyui-oss.json) | Best open-weight model per capability (23 capabilities, 122 ranked options) with files, URLs, settings, VRAM, licenses; 170 LoRAs (camera, VFX, style, speed) with triggers; ComfyUI API notes | Open model choices, `scripts/gen-oss-loras.py` → `oss-loras.generated.ts` |
| [`comfyui-oss-2.md`](comfyui-oss-2.md) / [`.json`](comfyui-oss-2.json) | Open-weight answers to the remaining gaps: Chatterbox / IndexTTS-2 voice cloning and dialogue, voice conversion, VACE extend/reframe, Wan-Move, relight, video matte and depth, multi-shot concat, next-scene storyboards, AI-Toolkit character LoRAs; full graphs validated against a live ComfyUI with pinned node packs | The 20 added workflows (`scripts/comfy/library.spec.mjs`), open models, `aiToolkitJob` |
| [`comfyui-workflow-library.md`](comfyui-workflow-library.md) | The ComfyUI library (73 workflows): sources, validation results, bindings, models and sizes, custom nodes, quirks | `workflows/comfyui/manifest.json`, the ComfyUI provider |
| [`liner-ui.md`](liner-ui.md) | Liner's (liner.com — liner.app itself is a parked domain) design language: tokens, layout, composer, microcopy; the Fuobe theme derived from it | `src/app/globals.css`, studio components |

To refresh: re-run the research, then `pnpm gen:catalog` and `pnpm test` (catalog integrity tests catch broken references).
