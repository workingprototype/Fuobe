# Architecture

Fuobe is a single Next.js 16 app. The browser talks only to Fuobe's own API; the server talks to providers (fal.ai, Replicate, ComfyUI) and stores every input and output locally so the library never depends on a provider's expiring URLs.

```
Composer (React) ──POST /api/generations──▶ planGeneration()      src/lib/catalog/plan.ts
                                              │  model + preset + attachments
                                              │  → operation (t2v / i2v / flf2v / edit / avatar …)
                                              │  → prompt (preset template, LoRA trigger)
                                              │  → params, LoRAs, number of jobs
                                              ▼
                                         chooseRoute()            src/server/generations.ts
                                              │  first configured provider for that operation,
                                              │  else the demo provider (Settings → Demo mode)
                                              ▼
                                         SQLite row (queued) ─ submit() in the background:
                                              │  upload inputs to the provider (prepareFile)
                                              │  optional prompt enhancement (src/server/enhance.ts)
                                              │  adapter.submit()  → external job id
                                              ▼
                     poller (every 1.5 s) ── adapter.poll() → queued / running (progress) / succeeded / failed
                                              │  on success: download every output → data/files → assets table
                                              ▼
Feed (React Query, polls while jobs are active) ◀── GET /api/generations
```

## Catalog (`src/lib/catalog/`)

| file | what |
|---|---|
| `types.ts` | `ModelDef`, `ModelRoute`, `FieldMap`, `Preset`, `GenerationRequest`, `Generation` |
| `cloud-models.generated.ts` | 67 cloud models. **Generated** by `scripts/gen-cloud-models.py` from the verified API schemas in `docs/research/paid-model-apis.json` — field names, enums, defaults and prices are never typed by hand |
| `models.ts` | Open-source models (ComfyUI workflow ids) + the generated cloud list |
| `apps.ts`, `motions.ts` | 118 apps, 108 camera motions, 255 effects: prompt templates, input slots, option pickers, cloud and open routes |
| `oss-loras.generated.ts` | Higgsfield preset name → researched Wan LoRAs + trigger words (`scripts/gen-oss-loras.py`) |
| `index.ts` | Lookup helpers; attaches LoRAs / Wan Fun Camera poses / ReActor to open routes |
| `plan.ts` | Pure planning logic (operation inference, prompt composition, batching, input validation, cost estimate) |
| `payload.ts` | `buildPayload(FieldMap, GenInput)` and `extractMedia(response)` |

A **model** has one **route** per (operation, provider). A route's `FieldMap` translates Fuobe's canonical input (`prompt`, `images`, `endImage`, `aspectRatio`, `duration`…) to the provider's field names (`start_image_url`, `tail_image_url`, `"8s"`, `image_size: "landscape_16_9"`…).

A **preset** (app / motion / effect) has a `cloud` and an `open` route, each naming a model and operation, optional fixed params and LoRAs. Apps pin their model; motions and effects add their camera/effect prompt to whichever video model the user picks (LoRAs only apply to the preset's own open model).

## Providers (`src/server/providers/`)

All adapters implement `prepareFile`, `submit`, `poll`, `cancel`, `test`.

- **fal** — queue API (`queue.fal.run/<endpoint>`); always uses the `status_url` / `response_url` returned at submit (nested endpoint ids poll under the app root). Files go to fal storage via `@fal-ai/client`.
- **replicate** — predictions API; small files as data URIs, larger via the Files API. Outputs are copied immediately (Replicate deletes them after an hour).
- **comfyui** — loads `workflows/comfyui/manifest.json`, writes values into bound node inputs (`src/lib/comfy.ts`), injects `LoraLoaderModelOnly` nodes after each diffusion-model loader (per Wan 2.2 expert), computes width/height from aspect ratio + resolution tier within the workflow's limits, frame counts as `n·step+1`, uploads inputs with `/upload/image`, submits to `/prompt`, tracks progress over the websocket and reads results from `/history`. Validation errors are turned into "missing model X → put it in models/<folder> (download URL)" messages.
- **mock** — demo outputs (SVG art, bundled sample clips, a tone) so the product works with zero setup.

## ComfyUI workflow library (`workflows/comfyui/`, `scripts/comfy/`)

`manifest.json` lists each workflow with its **bindings** (canonical key → node id + input), outputs, defaults (`width`, `height`, `fps`, `frameStep`…), limits (`dimensionMultiple`, `maxFrames`…), required model files with download URLs and sizes, custom node packs, VRAM and a `validated` flag. The pipeline in `scripts/comfy/` exports the official templates through the real ComfyUI frontend (`app.graphToPrompt()`), applies documented transforms, and validates every graph with `POST /prompt` against a live ComfyUI using zero-byte placeholder models.

## Storage (`src/server/db.ts`, `storage.ts`, `settings.ts`)

SQLite (WAL) with tables `generations`, `assets`, `settings`, `characters`. Files live in `data/files/{uploads,outputs}/<date>/<id>.<ext>` and are served by `/api/files/...` with HTTP range support for video. `FUOBE_DATA_DIR` moves everything.

## UI (`src/components/`, `src/app/(studio)/`)

Liner-inspired shell (pale frame, rounded inset sheet, 13px sidebar rows, serif headlines, pill composer). Every creation page is a `StudioPage` driven by a `StudioConfig` (`src/lib/studios.ts`): hero → composer when empty, prompt-echo groups + docked composer once there are results. The composer holds attachments (click, drop, paste, pick from library), model picker (Cloud/Open switch), aspect ratio, quality, duration, count, audio, enhance, advanced (seed, negative prompt), live cost estimate and Generate (↵).
