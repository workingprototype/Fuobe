# Research

Everything Fuobe's catalog is built from. JSON files are machine-readable and feed the generators in `scripts/`.

| file | what it covers | used by |
|---|---|---|
| [`higgsfield-inventory.md`](higgsfield-inventory.md) / [`.json`](higgsfield-inventory.json) | Higgsfield as of 2026-10: navigation, 67 features with UX flows, 32 image + 43 video models, 94 apps, 113 camera motions, 274 effects, pricing, API | Preset catalog (`src/lib/catalog/apps.ts`, `motions.ts`), STATUS feature matrix |
| [`paid-model-apis.md`](paid-model-apis.md) / [`.json`](paid-model-apis.json) | 517 fal.ai / Replicate / vendor endpoints with exact input fields, enums, defaults, outputs and prices (499 verified from fal's OpenAPI files); fal and Replicate protocol notes; sunsets | `scripts/gen-cloud-models.py` → `cloud-models.generated.ts` |
| [`comfyui-oss.md`](comfyui-oss.md) / [`.json`](comfyui-oss.json) | Best open-weight model per capability (23 capabilities, 122 ranked options) with files, URLs, settings, VRAM, licenses; 170 LoRAs (camera, VFX, style, speed) with triggers; ComfyUI API notes | Open model choices, `scripts/gen-oss-loras.py` → `oss-loras.generated.ts` |
| [`comfyui-workflow-library.md`](comfyui-workflow-library.md) | The 53-workflow ComfyUI library: sources, validation results, bindings, models and sizes, custom nodes, quirks | `workflows/comfyui/manifest.json`, the ComfyUI provider |
| [`liner-ui.md`](liner-ui.md) | Liner's (liner.com — liner.app itself is a parked domain) design language: tokens, layout, composer, microcopy; the Fuobe theme derived from it | `src/app/globals.css`, studio components |

To refresh: re-run the research, then `pnpm gen:catalog` and `pnpm test` (catalog integrity tests catch broken references).
