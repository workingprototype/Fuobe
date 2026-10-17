# Architecture

Fuobe is a single Next.js 16 app. The browser talks only to Fuobe's own API; the server talks to providers (fal.ai, Replicate, Higgsfield, ComfyUI) and stores every input and output locally so the library never depends on a provider's expiring URLs.

```
            proxy.ts (sign-in: session cookie or API token, once a password is set)
                                              │
Composer (React) ──POST /api/generations──▶ applyMentions()       src/lib/catalog/elements.ts
                                              │  @handles → reference images + legend, or a trained LoRA / Soul ID
                                         applySketch()            src/lib/catalog/sketch.ts
                                              │  painted mask → native inpaint route, or a red-tinted copy + instructions
                                              │  drawing → instruction image (edit), annotated first frame or motion paths (video)
                                              ▼
                                         planGeneration()         src/lib/catalog/plan.ts
                                              │  model + preset + attachments
                                              │  → operation (t2v / i2v / flf2v / edit / avatar …)
                                              │  → prompt (preset template, LoRA trigger, Mix of a second preset)
                                              │  → params, LoRAs, number of jobs
                                              ▼
                                         engine mode check        Settings → Engine mode (both / open / cloud)
                                              │  rejects models of a disabled engine
                                         chooseRoute()            src/server/generations.ts
                                              │  first configured provider for that operation
                                              │  (Settings → Preferred provider sets fal/Replicate order),
                                              │  else the demo provider (Settings → Demo mode)
                                              ▼
                                         SQLite row (queued) ─ submit() in the background
                                              │  (a row with depends_on waits until every generation it names
                                              │   succeeds, then gets their outputs as inputs: see Chained jobs)
                                              │  upload inputs to the provider (prepareFile)
                                              │  optional prompt enhancement (src/server/enhance.ts)
                                              │  adapter.submit()  → external job id
                                              ▼
                     runner (every 1.5 s) ── adapter.poll() → queued / running (progress) / succeeded / failed
                                              │  on success: download every output → data/files → assets table
                                              │  also: poll trainings, launch dependent jobs whose input is ready
                                              ▼
Feed (React Query, polls while jobs are active) ◀── GET /api/generations
```

## Catalog (`src/lib/catalog/`)

| file | what |
|---|---|
| `types.ts` | `ModelDef`, `ModelRoute`, `FieldMap`, `Preset`, `GenerationRequest`, `Generation` |
| `cloud-models.generated.ts` | fal / Replicate models. **Generated** by `scripts/gen-cloud-models.py` from the verified API schemas in `docs/research/paid-model-apis.json` and `paid-model-apis-2.json` (key fields merged, per-route options) — field names, enums, defaults and prices are never typed by hand |
| `higgsfield-models.generated.ts` | Higgsfield-only models (Soul, Genjutsu, Cinema Studio, Marketing Studio…) and extra Higgsfield routes for models also on fal. **Generated** by `scripts/gen-higgsfield-models.py` from `docs/research/higgsfield-api.json` |
| `models.ts` | Open-source models (ComfyUI workflow ids), the browser-only Color Grade model (`local` provider) + the generated cloud lists |
| `elements.ts` | Elements (character / location / prop / style / voice), `@handle` parsing and `applyMentions` |
| `sketch.ts` | `applySketch` (masks and drawings → the right operation and inputs) |
| `storyboard.ts` | Storyboard models per engine, scene splitting and frame prompts |
| `training.ts` | Training targets (Soul ID, fal Z-Image LoRA, AI-Toolkit) and the AI-Toolkit job config |
| `apps.ts`, `motions.ts` | 118 apps, 108 camera motions, 255 effects: prompt templates, input slots, option pickers, cloud and open routes |
| `oss-loras.generated.ts` | Higgsfield preset name → researched Wan LoRAs + trigger words (`scripts/gen-oss-loras.py`) |
| `index.ts` | Lookup helpers; attaches LoRAs / Wan Fun Camera poses / ReActor to open routes |
| `plan.ts` | Pure planning logic (operation inference, prompt composition, batching, input validation, cost estimate) |
| `payload.ts` | `buildPayload(FieldMap, GenInput)` and `extractMedia(response)` |

A **model** has one **route** per (operation, provider). A route's `FieldMap` translates Fuobe's canonical input (`prompt`, `images`, `endImage`, `aspectRatio`, `duration`, `voice`, `dialogue`, `shots`, `draft`…) to the provider's field names (`start_image_url`, `tail_image_url`, `"8s"`, `image_size: "landscape_16_9"`, `multi_prompt`…). Dotted keys (`voice_settings.stability`) are written as nested objects. Masks are converted to each API's convention (white = change, black = change, or alpha) by a small PNG codec (`src/server/png.ts`).

`ModelOptions` describe what the composer shows: aspect ratios, resolutions, durations, audio, end frame, multi-shot (`native` per-shot prompts or `prompt`-written shots), draft mode, voices and voice cloning, languages, sliders, extra enum controls (Cinema Studio's Director), provider-fetched preset lists (Soul styles, Genjutsu looks) and motion paths (Wan-Move).

A **preset** (app / motion / effect) has a `cloud` and an `open` route, each naming a model and operation, optional fixed params and LoRAs. Apps pin their model; motions and effects add their camera/effect prompt to whichever video model the user picks (LoRAs only apply to the preset's own open model).

## Providers (`src/server/providers/`)

All adapters implement `prepareFile`, `submit`, `poll`, `cancel`, `test`.

- **fal** — queue API (`queue.fal.run/<endpoint>`); always uses the `status_url` / `response_url` returned at submit (nested endpoint ids poll under the app root). Files go to fal storage via `@fal-ai/client`.
- **replicate** — predictions API; small files as data URIs, larger via the Files API. Outputs are copied immediately (Replicate deletes them after an hour).
- **comfyui** — loads `workflows/comfyui/manifest.json`, writes values into bound node inputs (`src/lib/comfy.ts`), injects `LoraLoaderModelOnly` nodes after each diffusion-model loader (per Wan 2.2 expert), computes width/height from aspect ratio + resolution tier within the workflow's limits, frame counts as `n·step+1`, uploads inputs with `/upload/image`, submits to `/prompt`, tracks progress over the websocket and reads results from `/history`. Validation errors are turned into "missing model X → put it in models/<folder> (download URL)" messages.
- **higgsfield** — `api.higgsfield.ai` with `Key id:secret` auth: submit with idempotency keys, poll `/requests/<id>/status`, cancel, signed-URL uploads, live style/template lists, and Soul ID training (custom references).
- **local** — results made in the browser (Color grading renders with WebGL and uploads the PNG/WebM; `/api/generations/local` records it).
- **mock** — demo outputs (SVG art, bundled sample clips, a tone) so the product works with zero setup.

## ComfyUI workflow library (`workflows/comfyui/`, `scripts/comfy/`)

`manifest.json` lists each workflow with its **bindings** (canonical key → node id + input), outputs, defaults (`width`, `height`, `fps`, `frameStep`…), limits (`dimensionMultiple`, `maxFrames`…), required model files with download URLs and sizes, custom node packs, VRAM and a `validated` flag. The pipeline in `scripts/comfy/` exports the official templates through the real ComfyUI frontend (`app.graphToPrompt()`), applies documented transforms, and validates every graph with `POST /prompt` against a live ComfyUI using zero-byte placeholder models.

## Chained jobs (`src/server/chains.ts`)

A generation can depend on others (`CreateOptions.dependsOn`, one id or a list). `GenerationRequest.chain` says where each dependency's first output goes (`images` first/last, `endImage`, `video`, `videos`, `audio`); the old single-image `chainFrom` still works. The request is validated with placeholder inputs when it's created, and the runner launches it once every dependency has succeeded (or fails it when one didn't). Built on that:

- **Join clips** (`joinClips`): fal's FFmpeg `merge-videos` on the cloud, ComfyUI's `video-concat-{2,3,4}` on the open engine (the provider picks the graph by clip count; the graph plays at the first clip's frame rate). More than four clips on ComfyUI are folded four at a time.
- **Open multi-shot** (`createShotFilm`): models with `multiShot.mode: "concat"` render one clip per shot (the first gets the start image, the last the end frame), then join them.
- **Storyboard film** (`createStoryboardFilm` in `storyboard.ts`): each frame is animated toward the next (start + end frame when the model can), then joined.
- **Last-frame extend** (`createExtendChain`): for models whose extend route is `LAST_FRAME_CHAIN` (Kling): fal FFmpeg `extract-frame` → the model's image-to-video → join with the original.

## Training (`src/server/training.ts`)

A `trainings` row per job, polled by the same runner. Higgsfield Soul ID returns a reference id stored on the element; fal's Z-Image trainer gets a zipped dataset with captions and returns a LoRA URL (hosted Z-Image switches to its `/lora` endpoint); AI-Toolkit gets a dataset folder and a job through its UI's job API, and the finished LoRA is copied into `COMFYUI_LORAS_DIR`. Elements keep a list of trained identities (`loras_json`), and `applyMentions` uses the one that matches the chosen model.

## Assist agent (`src/server/assist/`)

A manual tool-use loop over Claude (`claude-opus-5-5`, adaptive thinking, server-side fallback). Tools: `search_models`, `list_elements`, `list_recent`, `check_generations` (can wait, and can attach finished images so the model sees them), `generate` and `create_storyboard`. The last two are **gated**: when the model calls them the loop stops, the thread is saved as `waiting` with an approval card priced by `previewGeneration`, and the user's answer resumes the loop with the results of every call in that turn in one message. A new message instead of an answer declines the plan with the message as feedback. History is stored append-only exactly as the API returned it (thinking blocks included); local images are kept as URLs and converted to base64 per request. The same loop runs on a local model through Ollama's tool calling (the history is converted to Ollama chat messages and back), or, with no LLM at all, on a rule-based planner that returns the same message shapes. `resolveAgent()` picks one for each new chat.

## MCP server (`src/server/mcp.ts`, `/api/mcp`)

Model Context Protocol over streamable HTTP, stateless with JSON responses: `initialize` (version negotiation), `ping`, `tools/list`, `tools/call`. The tools are Assist's (shared `executeTool`), plus `estimate_cost`, which prices a generate call with `previewGeneration`. Requests from a foreign `Origin` are refused (DNS rebinding); the proxy applies the same sign-in rules as the REST API.

## Access protection (`src/server/auth.ts`, `src/proxy.ts`)

Off until a password is set in Settings → Security or `FUOBE_PASSWORD`. State lives in `data/auth.json` (not SQLite) so the proxy can check requests with `fs` and `crypto` alone: a scrypt password hash, an HMAC secret for 30-day session cookies (replaced when the password changes, which signs everyone out), and API tokens stored as SHA-256 hashes. The proxy lets `/login` and `/api/auth/login` through, answers other API calls with 401 and redirects pages to `/login?next=…`. Tokens and the password can only be managed from a signed-in browser. The run starts synchronously after the POST (so polls never see a stale "running" thread) and is kept alive with `after()`; the UI polls `GET /api/assist/<id>`.

## Storage (`src/server/db.ts`, `storage.ts`, `settings.ts`)

SQLite (WAL) with tables `generations` (with `depends_on`: one id or a JSON list, for chained jobs), `assets`, `settings`, `characters` (elements), `trainings` and `assist_threads`. Migrations are an append-only list in `db.ts`. Settings (`src/server/settings.ts`) are typed, validated against allowed values, overridable by environment variables, and secrets are masked before reaching the browser. `engineMode` is enforced server-side; the client reads it from `/api/status` (`useEngineMode`) to lock the engine switch and filter what it shows. Files live in `data/files/{uploads,outputs}/<date>/<id>.<ext>` and are served by `/api/files/...` with HTTP range support for video. `FUOBE_DATA_DIR` moves everything.

## UI (`src/components/`, `src/app/(studio)/`)

Liner-inspired shell (pale frame, rounded inset sheet, 13px sidebar rows, serif headlines, pill composer). Every creation page is a `StudioPage` driven by a `StudioConfig` (`src/lib/studios.ts`): hero → composer when empty, prompt-echo groups + docked composer once there are results. Single-purpose studios (Extend, Reframe, Video tools…) pin their operation; the Audio hub switches between studios with tabs. The composer holds attachments (click, drop, paste, pick from library), an `@` element menu with highlighted mentions, the sketch editor (mask / draw), model picker (Cloud/Open switch), aspect ratio, quality, duration, count, audio, multi-shot, draft, voice picker / recorder, dialogue editor, Director controls, provider style picker, enhance, advanced (seed, negative prompt), live cost estimate and Generate (↵).

Stand-alone views: `color-grade-view.tsx` (WebGL grader, `src/lib/grade.ts`), `storyboard-view.tsx`, `elements-view.tsx` + `train-dialog.tsx`, and `assist-view.tsx` (chat transcript with plan cards and inline generation tiles).

## Generators (`scripts/`)

`pnpm gen:catalog` runs `gen-cloud-models.py`, `gen-higgsfield-models.py`, `gen-oss-loras.py` and the icon map. Each reads a research JSON in `docs/research/` and writes a `*.generated.ts` file; the catalog integrity tests catch broken references.
