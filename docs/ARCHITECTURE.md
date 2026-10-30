# Architecture

Fuobe is a single Next.js 16 app. The browser talks only to Fuobe's own API; the server talks to providers (fal.ai, Replicate, Higgsfield, ComfyUI, and Claude or a local LLM server for text: Ollama, LM Studio, Unsloth Studio or any OpenAI-compatible one) and stores every input and output locally, so the library never depends on a provider's expiring URLs.

```
            proxy.ts: hostAllowed() (no password set) → crossSite() → sign-in (session cookie or API token)
                                              │
Composer / studio (React) ──POST /api/generations (or a studio route that builds a pipeline)
                                              │
                                         prepare()                src/server/generations.ts
                                              │  withSignatureWords()   palette / look sentences join the prompt
                                              │  applyMentions()        @handles → reference images + legend, or a trained LoRA / Soul ID
                                              │  applySketch()          mask → native inpaint route or red-tinted copy; drawing → instruction image / motion paths
                                              ▼
                                         planGeneration()         src/lib/catalog/plan.ts
                                              │  model + preset + attachments → operation, prompt, params, LoRAs, number of jobs
                                              │  NEEDS / requires / minImages: says which input is missing
                                              ▼
                                         engine mode check        Settings → Engine mode (both / open / cloud)
                                         chooseRoute()            first configured provider for that operation
                                              │                   (Preferred provider sets fal/Replicate order; "llm" for text steps),
                                              │                   else the demo provider (Settings → Demo mode)
                                              ▼
                                         createGenerations() / createPipeline()   one row per job; dependsOn for chained steps
                                              │  SQLite row (queued) → submit() in the background
                                              │  (a row with depends_on waits until every generation it names succeeds,
                                              │   then gets their outputs through its chain slots: see Pipelines)
                                              │  upload inputs to the provider (prepareFile), optional prompt enhancement,
                                              │  adapter.submit() → external job id (generation_runs.submitted_at)
                                              ▼
       runner (started at boot by src/instrumentation.ts; every 1.5 s, plus a 500 ms lane for jobs near the end)
                                              │  adapter.poll() → queued / running (progress) / succeeded / failed
                                              │  timeouts: 45 min running or 4 h queued (generation_runs), cancel at the provider first
                                              │  on success: outputs downloaded → data/files → assets table (text inlined, meta kept)
                                              │  also: poll trainings, launch dependent steps whose inputs are ready
                                              ▼
       SQLite TEMP triggers → src/server/live.ts ──GET /api/generations/stream (SSE)──▶ one stream per browser
                                              ▼
Feed, Library, studios (React Query caches patched by id; polls every 10 s while the stream is connected)
```

## Catalog (`src/lib/catalog/`)

| file | what |
|---|---|
| `types.ts` | `ModelDef`, `ModelRoute`, `FieldMap`, `ModelOptions`, `Pricing`, `Preset`, `GenerationRequest`, `ChainSlot`, `GenInput`, `Generation`, `OutputFile` |
| `cloud-models.generated.ts` | fal / Replicate models. **Generated** by `scripts/gen-cloud-models.py` from the verified API schemas in `docs/research/paid-model-apis.json`, `-2.json` and `-3.json` (key fields merged, per-route options, sliders and controls read from the research, required inputs filled from their documented defaults) — field names, enums, defaults and prices are never typed by hand |
| `higgsfield-models.generated.ts` | Higgsfield-only models (Soul, Genjutsu, Cinema Studio, Marketing Studio, Ads Studio…) and extra Higgsfield routes for models also on fal. **Generated** by `scripts/gen-higgsfield-models.py` from `docs/research/higgsfield-api.json` |
| `higgsfield-presets.generated.ts` | 106 Soul + 33 Soul 2.0 presets (ids, categories, descriptions), the 14 Photodump / Instadump packs and the 6 Fashion Factory templates. **Generated** by `scripts/gen-higgsfield-presets.py` from `higgsfield-image-studios.json`; the fallback for the style picker |
| `models.ts` | Open-source models (ComfyUI workflow ids), fal utility models (Join clips, and the hidden Extract frame, Crop to size, Mix voice and music, Level audio, Forced Alignment), the browser-only models (`local` provider: Color Grade, Ad compositor) + the generated cloud lists (whose hidden chain helpers include Trim video, Add soundtrack, Voice timeline and Extract soundtrack) |
| `llm-models.ts` | `text-llm` (cloud: Claude, else a local model) and `oss-text-llm` (open: a local model only, route endpoint `ollama`), kind `text`, ops `translate` and `write` |
| `elements.ts` | Elements (character / location / prop / style / voice), `@handle` parsing and `applyMentions` |
| `sketch.ts` | `applySketch` (masks and drawings → the right operation and inputs) |
| `storyboard.ts` | Storyboard models per engine, scene splitting and frame prompts |
| `training.ts` | Training targets (Soul ID, fal Z-Image LoRA, AI-Toolkit), `aiToolkitJob` (character or style preset) and `trainingCaption` |
| `apps.ts`, `motions.ts` | 123 apps, 108 camera motions, 255 effects: prompt templates, input slots, option pickers, cloud and open routes. `APP_ALIASES` keeps renamed app ids working |
| `oss-loras.generated.ts` | Higgsfield preset name → researched Wan LoRAs + trigger words (`scripts/gen-oss-loras.py`) |
| `index.ts` | Lookup helpers; attaches LoRAs / Wan Fun Camera poses / ReActor to open routes; registers the LLM models |
| `plan.ts` | Pure planning logic (operation inference, prompt composition, batching, input validation, cost estimate) |
| `payload.ts` | `buildPayload(FieldMap, GenInput)`, `extractMedia(response)`, `extractOutputs(response, op)` (structured outputs) and `noOutputsError` |
| `palettes.ts` | `applySignature` (Color signature / Moodboard picks → native palette, style id, or words) and `withSignatureWords` |
| `cinema.ts`, `canvas.ts`, `shorts.ts`, `shorts-models.ts`, `mixed-media.ts`, `marketing.ts`, `faceless.ts`, `packs.ts` | Each studio's data and pure planner, shared by client and server (see Studios) |

A **model** has one **route** per (operation, provider). A route's `FieldMap` translates Fuobe's canonical input (`prompt`, `images`, `image2`, `endImage`, `video`, `videos`, `audio`, `audios`, `aspectRatio`, `duration`, `voice`, `voiceAudio`, `dialogue`, `shots`, `draft`, `startTime` / `endTime`, `fps`, `palette`, `styleId`, `numLayers`, `sourceLanguage`, `targetLanguage`…) to the provider's field names. Dotted keys (`voice_settings.stability`) are written as nested objects; `setPath` ignores `__proto__`, `constructor` and `prototype`. `defaults` are sent unless the request sets them (applied before the canonical fields), `fixed` always wins (applied after). `sourceLanguage` may be `{key, values}`, matched to the API's list. `palette {key, format, background}` converts hex colours to each API's shape (Recraft on fal, Recraft on Higgsfield, Ideogram members with falling weights, plain lists). `tracks` and `timeline` build fal FFmpeg compose timelines. Masks are converted to each API's convention (white = change, black = change, or alpha) by a small PNG codec (`src/server/png.ts`).

`ModelOptions` describe what the composer shows: aspect ratios, resolutions, durations, audio, end frame, multi-shot, draft mode, voices and voice cloning, languages, sliders, enum controls, provider-fetched preset lists, motion paths, and since round 3 `minImages` + `imageLabels` (try-on: "Person photo", "Add garment"), `promptless`, `maxVideos` / `maxAudios` (reference clips), `sourceLanguages` and `requires` ({images?, prompt?, msg}, checked in `planGeneration` before any job is created). `Pricing` gains `byResolution` (a price per `params.resolution`) and `inputSeconds` (per-second prices doubled for edits billed on input + output).

`plan.ts` adds `promptOptional(model, op)` (promptless ops such as trim, mux, captions, layers, image-to-3d, vectorize), NEEDS entries with `oneOf` and `media` (transcribe and separate-audio take audio or video), a server-only check that rejects inputs no route can send (it needs the field maps the slim client catalog strips), and `inferOperation` picking `ref2v` when clips are attached.

A **preset** (app / motion / effect) has a `cloud` and an `open` route, each naming a model and operation, optional fixed params and LoRAs. Apps pin their model; motions and effects add their camera / effect prompt to whichever video model the user picks (LoRAs only apply to the preset's own open model). `PresetChoice.extra` lets an option set model `params.extra`.

## Providers (`src/server/providers/`)

Every adapter implements `isConfigured`, `prepareFile`, `submit` and `poll`, and optionally `cancel` and `test`. `RemoteOutput` carries optional `text` and `meta`.

- **fal** — queue API (`queue.fal.run/<endpoint>`); always uses the `status_url` / `response_url` returned at submit. Files go to fal storage via `@fal-ai/client`.
- **replicate** — predictions API; small files as data URIs, larger via the Files API. Outputs are copied immediately (Replicate deletes them after an hour).
- **higgsfield** — `api.higgsfield.ai` with `Key id:secret` auth: submit with idempotency keys, poll `/requests/<id>/status` (only the documented result fields are read; extra files such as zip or fbx land in `meta.artifacts`), cancel, signed-URL uploads, live style / template lists, and Soul ID training.
- **comfyui** — loads `workflows/comfyui/manifest.json`. `prepareWorkflow()` turns a `GenInput` into the prompt: canonical keys → bindings, uploads it makes itself (including media refs in `params.extra`), LoRA nodes after each diffusion-model loader, width / height from aspect ratio + tier, frame counts as `n·step+1`, the palette as a hex sentence plus a 512×512 swatch rendered on the server, `SLOT_RULES` (repeat, required, hints) per workflow, and graph rewrites for `expand: "captions"` (`expandCaptionWorkflow` in `src/lib/comfy.ts`) and `expand: "timeline"` (`expandTimelineWorkflow` in `src/lib/av/timeline.ts`). A left-out reference in a FLUX.2 ReferenceLatent chain is removed by `bypassReference()`. The second audio track is read from `inputs.audio2` (else `params.extra.audio2`); a mux with no background picks the one-track graph. `prepareFile` records each upload's header facts (`src/lib/media-probe.ts`: MP4 / MOV / M4A with rotation, WAV, FLAC, MP3) so the "auto" shape, trim checks, lip-sync frames, the mux bed length, caption windows and the Whisper RAM guard use them. Progress comes over the websocket (reset when the URL changes), results from `/history`; `collectOutputs()` maps them in manifest order (text with cues and language, `model3d`, stems with `meta.stem`, layers back to front with `meta.z / name / bbox`, roles, VHS meta-batch passes followed by their `fuobe/<generationId>` filename prefix). A 502 or a missing prompt is retried; a prompt fails only after it is missing three polls in a row. The first `isConfigured()` per URL waits for a real probe from a worker thread (`probeComfySync`, at most 1.5 s).
- **llm** — text steps in this process (below).
- **local** — results made in the browser (Color grading's PNG / WebM, Ads Studio composites; `/api/generations/local` records them).
- **mock** — demo outputs for every operation (SVG art, bundled sample clips, a tone, layers with meta, cue lists, two stems, a GLB with a turntable from `scripts/gen-demo-3d.mjs`), so the product works with zero setup.

## Structured outputs

Outputs are not only media. `extractOutputs(response, op)` in `payload.ts` (fal, Replicate, Higgsfield) and `collectOutputs()` (ComfyUI) produce:

| kind / meta | from |
|---|---|
| `text` with `.text`, `meta.cues [{start, end, text, speaker}]`, `meta.language` | transcribe, translate, write; saved as `.srt` when timed, else `.txt` |
| `model3d` (GLB) with `meta.preview`, `meta.formats` | image-to-3d |
| layers with `meta {name, z, bbox, bboxNormalized, description}` | Seedream layers, Qwen-Image-Layered (bbox from alpha) |
| `meta.textBlocks`, `meta.textHtml` on the background | Ideogram text layers |
| `meta.stem` (`voice` / `background`, aliases vocals, accompaniment…) | separate-audio |
| `meta.styleId`, `meta.mask`, `meta.role`, `meta.artifacts` | Recraft styles, Bria cut-outs, ComfyUI roles, Higgsfield extra files |

A media operation that only answers in words fails with "The model replied: …" (`noOutputsError`). `OutputFile.text` is inlined up to `MAX_INLINE_TEXT` (64,000 characters, `meta.truncated` beyond); chained steps read the full text from the file. `outputKind(op, model)` decides a generation's kind (color-match and timeline follow the model's kind). Results without a prompt are titled after the operation ("Transcribe · ElevenLabs Scribe v2").

## Pipelines and chained jobs (`src/server/chains.ts`)

A generation can depend on others (`CreateOptions.dependsOn`, one id or a list). `GenerationRequest.chain` (`ChainSlot[]`) says where each dependency's output goes:

| slot | what it fills |
|---|---|
| `images` (first / last), `endImage`, `video`, `videos`, `audio` | the matching input, from the dependency's first output of that kind (an `audio` slot fed by a clip takes its soundtrack) |
| `voiceAudio` | the voice to clone (tts) or the target voice (voice change) |
| `audio2` | the second track mixed under `inputs.audio` (mux): `inputs.audio2` / `GenInput.audio2` |
| `audios` | a list of clips (the spoken lines a voice timeline places at their start times) |
| `prompt` | the dependency's text: replaces `{text}` in the prompt, or becomes it; a translate step gets the cue list (decided by the step's planned op) |

An audio slot can carry `stem` to take the output whose `meta.stem` matches ("voice" also matches vocals / speech / target; "background" also accompaniment / instrumental / residual / no_vocals). `pickOutput()` in `generations.ts` does the choosing; a missing stem fails the step with a clear message.

**`createPipeline(steps, opts)`** creates any DAG of steps `{key, request, after?, chain?}`. Before a single row exists it checks duplicate or unknown keys, self-waits, loops (Kahn sort), chain-slot counts, that a step others depend on makes one job, and previews every step with placeholders; a mix of demo and real steps is refused (`assertOneMode`). Rows are created in topological order with `dependsOn`, labelled "Step n of N", and it returns `{batchId, items, byKey}`; if creation fails partway, what it started is canceled. Its TSDoc example is a whole dub. Layers, Shorts, Mixed Media, the palette lock, Photodump / Fashion / Character Sheet, Marketing Studio / Click to Ad / Ad Multiplier, dub, Katana and the Assist studio tools build their jobs this way; Cinema, Canvas, Faceless / Explainer, Ads Studio and moodboards call `createGenerations` (with `dependsOn` for chained steps) directly; Cinema, Canvas and Faceless preview every step first.

At launch the runner fills the slots (`slotsFor` pads short chains, `chainValue` reads text files when the text isn't inline) and checks the mode again (`chainMode`: a real step after demo steps runs as a demo, or fails with what to connect when demo mode is off). Built on that:

- **Join clips** (`joinClips`): fal's FFmpeg `merge-videos` on the cloud, ComfyUI's `video-concat-{2,3,4}` on the open engine (folded four at a time). `oss-join-sound1/2` are joins that keep one clip's own sound at 25 fps (marketing films).
- **Open multi-shot** (`createShotFilm`), **storyboard film** (`createStoryboardFilm`), **last-frame extend** (`createExtendChain`: extract frame → the model's image-to-video → join; `oss-extract-frame` on the open engine).

## LLM provider (`src/server/providers/llm.ts`)

Text steps (`translate`, `write`) run inside the server and are polled like any job; cancel aborts the call and a restart fails the job as "Interrupted" (retryable). `llmBackends(route)` lists the backends in order: Claude (claude-opus-5-5, low effort, server-side fallback) when an Anthropic key is set and AI helper is Claude, or Automatic on an install that isn't open-only; then the local model (`local`, see below) when a local server is ready, unless AI helper is pinned to Claude; for an open translation with none, ComfyUI's Qwen3.5 4B. Claude errors fall back to the next backend; endpoint `ollama` (`oss-text-llm`: the id predates the other servers and means "local only") never uses Claude; AI helper → Offline rewriter (`none`) turns text steps off. The job keeps the local server it started on (`payload.local`), polls as "Writing with LM Studio", and a text step on a local model costs 0. The provider's label is a getter, `Claude or <server>` (`llmLabel()`), so chain errors and `/api/status` name the server in use. `llmMissing()` adds the server's own reason (a key, no model loaded). `probeOllama` is kept as an alias of `probeLocal`.

`translateCues()` translates JSON cue lists, SRT and WebVTT (`src/lib/cues.ts`) in numbered batches of 30 (multi-line cues kept together); a batch that comes back merged or short is redone in pieces of 10, then cue by cue through a pool (1 request in flight on a local model, 4 on Claude). The output keeps `meta.cues`. `write` uses `params.extra.system` when given. Studios that need free text (brand research, the AI Director, storyboard splitting, ad copy, Click to Ad scripts) call `llmText(system, user, { json?, timeoutMs? })` in `src/server/enhance.ts`, with offline fallbacks (60 s, or 3 minutes while the local model still has to load). Faceless and Explainer names, topics and scripts go through the llm provider itself (`askLlm()` in `src/server/faceless.ts` submits and polls a `text-llm` / `oss-text-llm` job, `extra.json` carrying the schema), so they follow the episode's engine. The callers that want JSON pass a JSON Schema next to their prompt (brand kit, manual kit and product facts in `brand.ts`, ad copy with exactly `count` ads and the brand chat in `ads.ts`, the Director's answer with its slug enums, Faceless topics, scripts and pictures in `lib/catalog/faceless.ts`, and a root array of exactly n frames for storyboards). Claude ignores it; the parsers stay tolerant of prose and fences either way.

## Local LLM servers (`src/server/llm/`)

One layer for every local model: `ollama` (its own `/api/chat`), `lmstudio`, `unsloth` and `custom` (any OpenAI-compatible server: llama.cpp's llama-server, vLLM, Jan…), the last three on `POST {base}/chat/completions`. Text steps, `llmText()` and the Assist agent all call `chatLocal(ready, request)`; nothing streams.

| file | what |
|---|---|
| `servers.ts` | Settings → `LocalServer`s: `localServers()` is the pinned one (`llmProvider`) or, in Automatic, Ollama, LM Studio, Unsloth Studio and the custom URL when set, in that order. URLs lose a pasted `/v1`; a custom URL is an OpenAI base URL (a bare host gets `/v1`). `aiHelper()` reads the old `enhanceProvider` value `ollama` as `local`. LM Studio's token also comes from `LM_API_TOKEN`, Unsloth's key from `UNSLOTH_STUDIO_AUTH_TOKEN` |
| `probe.ts` | Each server is asked with GETs sent at once (1.5 s): Ollama `/api/tags`; LM Studio `/api/v1/models` (loaded copies, context, `trained_for_tool_use`, reasoning) and `/v1/models` for versions before 0.4; Unsloth `/api/liveness` (its `service` must be "Unsloth UI Backend": Jupyter also likes :8888) and `/v1/models` (rows with a `task` are speech or image models); custom `{base}/models`. Answers are cached 15 s per kind, URL and key hash; `interpret()` turns them into a `LocalStatus` (up, auth, chat models without embeddings, the model a call uses, `loaded`, `context`, `problem` in the user's words, `warning`) with the current Settings, so a new model name needs no new probe. The blocking first look (`refreshSync`) runs every GET in one worker thread and reads the answers with `receiveMessageOnPort` |
| `index.ts` | `probeLocal()`, `activeLocal()` (async) and `localReady()` (sync, for routing: the first look at a server waits, later looks refresh in the background) return the first ready server. `chatLocal()` loads an LM Studio model that isn't loaded yet with `llmContext` (`POST /api/v1/models/load`, shared by concurrent calls; the chat endpoint can't set the context and LM Studio's default is 4k–8k), sends the call with the request's signal and timeout, asks again without `response_format` when a server rejects structured output, and reads tool calls written as text. `reloadLmStudio()` unloads and reloads with the context; `testLocal()` times a tiny call; `localSummary()` feeds `/api/status` |
| `wire.ts` | Pure request builders and parsers. Ollama: `think:false` for one-shot text, `format` (a schema, or `"json"`), `options.num_ctx`. OpenAI: string tool arguments, `tool_call_id` results, `response_format` json_schema (LM Studio without `strict`; `json_object` for "any object" except on LM Studio), Unsloth's `enable_tools:false` on every call and `enable_thinking:false` for one-shot text, and no `model` for Unsloth unless one is picked (its loaded model answers). Answers lose `<think>` blocks (also a lone closing tag, or a thought cut off); `reasoning_content` / `reasoning` only mark `thought`. Tool calls get Fuobe's own nine-character ids |
| `messages.ts` | `toChatMessages()`: Assist's stored history for a local model. One system message first; for the OpenAI kinds a mid-chat context update joins the user's turn ("Context update from Fuobe (not the user):"), user turns in a row merge, and tool ids become nine letters and digits (a stable hash), as strict templates (Gemma, Mistral, some Qwen ones) need; Ollama keeps its old shape. `healToolCalls()` reads `<tool_call>{…}</tool_call>`, LM Studio's `[TOOL_REQUEST]{…}[END_TOOL_REQUEST]` and a reply that is only the call's JSON, for the offered tools only |
| `errors.ts` | Failed calls in words that say what to do: start the server (the command for each), add or check the key (where each server makes them), download or load a model, reload with more context, or free GPU memory. `emptyReply()` says when a model spent its whole reply thinking |

`GET /api/llm` (`?refresh=1` asks again) lists every server's status for Settings → AI helper, without keys; `POST /api/llm` runs `{action: "test", kind?}` or `{action: "load", model?}` (LM Studio reload). `GET /api/status` adds an `llm` block: the helper, whether Claude takes text steps, the pinned server, the local server in use (kind, label, URL, model, loaded, context, warning), the reason when none can run, and what each candidate answered. `fuobe status` prints it as "Local LLM: LM Studio at … · model".

## Live updates (`src/server/live.ts`, `src/lib/api.ts`)

Server: `watchGenerations(db)` installs TEMP SQLite triggers on `generations` that call a JS function (`fuobe_generation_changed`); changed ids are batched per event-loop turn (`setImmediate`) on an HMR-safe emitter (`globalThis.__fuobeLive`). The resolver in `generations.ts` turns each id into a `generation` event (the row through `toGeneration()`, the same JSON the list returns) or `deleted` (gone or trashed; trash and restore touch `updated_at`, so they fire too). `GET /api/generations/stream` (`generationEventStream`) sends `retry: 2000`, the events and `: ping` every 15 s, with `no-cache, no-transform` and `X-Accel-Buffering: no`; the listener is removed on abort.

Client: one stream per browser. Tabs elect a leader with `navigator.locks` (`fuobe-generation-stream`); only the leader reads the stream and re-broadcasts events and its connected state on a `BroadcastChannel` (`fuobe-generations`, messages event | state | hello). The next tab takes over when the leader closes; a tab hidden for 30 s lets go, and every reconnect after the first invalidates the caches. Without Web Locks each tab reads its own stream. State lives on `globalThis.__fuobeClientStream`; the decision logic (`streamResponse`, `needsCatchUp`, `toChannelMessage`) and the cache reducers are pure, in `src/lib/generation-stream.ts`. `applyEvent()` patches `["generations", filter]`, `["library", filter]`, `["assist", id]` and `["canvases", id]` (`applyToCanvasView`) by id, with id-based structural sharing (`shareById`). Other views subscribe with `useGenerationEvents(cb)` (Cinema, Layers, Shorts, Mixed Media, Marketing, Faceless, dub, Katana) instead of opening an EventSource. Polling slows to 10 s while connected (1.5 s otherwise); a 404 means no stream, retried every 5 minutes.

## Library: Trash, folders, bulk, zip (`src/server/library.ts`)

- **Trash** is the `generation_trash` table (soft delete). Every reader (`listGenerations`, `getGeneration(id, {includeDeleted})`, and through them Assist, MCP, storyboards, studios) leaves trashed rows out; `toGeneration` fills `deletedAt` / `folderId` even for rows read without the join. `trashGenerations` cancels queued and running jobs; `restoreGenerations` brings rows back (to the root when their folder is gone). `deleteForever` / `emptyTrash` call `deleteGeneration`, which removes the row, its trash and folder entries and every output file that `assetInUse()` doesn't find in a table listed in `ASSET_REFS` (generations, elements, trainings, Assist threads, Cinema, Canvas, Layers, Shorts, marketing, image studios, Faceless). When a table starts storing file URLs, add it there. `ensureTrashPurge()` empties what has been in the Trash for 30 days, at startup and then daily.
- **Folders**: `folders` + `folder_items`, one folder per generation, flat; deleting a folder sends its items back to the root.
- **Lists** take `kinds`, `models`, `statuses`, `since` / `until`, `folder`, `trash`, `q` (also the request prompt) and a compound cursor `before=<ts>:<id>` (ordered by ts DESC, id DESC; `deletedAt` in the Trash), so rows sharing a timestamp are never skipped. `libraryFacets()` gives the tab counts.
- **Bulk**: `POST /api/generations/bulk` (trash | restore | delete | favorite | unfavorite | move), sent in batches of 500.
- **Zip**: `GET /api/generations/zip?ids=` streams a stored zip (`zipStream` / `zipSize` in `src/server/zip.ts`: a CRC pass first, flat memory, refused over 4 GB).
- Client: pure helpers in `src/lib/library.ts` (filters, date sections, batch stacks, `cursorAfter`), `outputActions()` in `src/lib/output-actions.ts` (one action list for tiles, viewer and Library), `ForeverConfirmProvider` in `src/components/studio/result-actions.tsx`. `GenerationRequest.title` / `.batchTitle` (server-set) name results and Library stacks.

## Security (`src/proxy.ts`, `src/server/auth.ts`, `src/server/remote-fetch.ts`)

- **Sign-in** is off until a password is set in Settings → Security or `FUOBE_PASSWORD`. State lives in `data/auth.json` (not SQLite) so the proxy can check requests with `fs` and `crypto` alone: a scrypt password hash, an HMAC secret for 30-day session cookies (replaced when the password changes), and API tokens stored as SHA-256 hashes. The proxy lets `/login` and `/api/auth/login` through, answers other API calls with 401 and redirects pages to `/login?next=…` (`safeNext()` in `src/lib/safe-redirect.ts` keeps it on the same origin). Its matcher leaves out only build assets, `samples/` and root SVGs.
- **Host allowlist** (`hostAllowed`), for every method when no password is set, before anything else: IP literals, localhost and `*.localhost`, single-label names, `.local` / `.lan` / `.home.arpa` / `.internal` / `.localdomain`, this machine's hostname, and `FUOBE_ALLOWED_ORIGINS` (`*` allows any). This stops DNS rebinding. `X-Forwarded-Host` is not trusted here.
- **Cross-site writes** (`crossSite`): non-GET/HEAD/OPTIONS requests get 403 when `Origin` matches neither Host, `X-Forwarded-Host` nor `FUOBE_ALLOWED_ORIGINS`, when it is `null`, or when `Sec-Fetch-Site` is cross-site — with or without a password.
- **Login throttle** (`LoginGuard`): 5 misses per client and 20 a minute overall, bounded map, `Retry-After`. Route handlers can't see the socket address, so the client key is the last `X-Forwarded-For` hop only with `FUOBE_TRUST_PROXY=1` (then a 60 s lock per client); otherwise everyone shares a key that is slowed to one attempt every 4 s and never locked.
- **Remote fetch** (`fetchRemote`): every caller-supplied URL (references, brand research, product links, YouTube oEmbed, Assist sources) is fetched only from public addresses. The check runs inside the socket lookup (DNS can't change after it) and again on each of at most 5 redirects; it blocks loopback, RFC 1918, link-local / metadata, CGNAT, multicast, ULA and mapped / NAT64 / 6to4 IPv4. 60 s deadline, 200 MB cap. `FUOBE_ALLOW_PRIVATE_URLS=1` turns it off for LAN installs.
- Uploads up to 200 MB pass the proxy (`experimental.proxyClientMaxBodySize: "210mb"` in `next.config.ts`, room for the multipart overhead). `/api/files` sends `nosniff` and a UTF-8 charset for text. The MCP endpoint refuses a foreign `Origin`. Unknown `/apps/<id>` is rewritten to a real 404.

## Studios

Each studio keeps its data and pure planner in `src/lib/`, its server module in `src/server/`, routes under `src/app/api/`, the page under `src/app/(studio)/` and the UI in `src/components/<studio>/`. Every job is ordinary generations (so results survive restarts, show in the Library and run on either engine); the studio tables only remember what made them.

| studio | pure logic | server | routes | UI |
|---|---|---|---|---|
| **Cinema Studio** (`/cinema`, `/cinema/[id]`) | `catalog/cinema.ts`: research data (genres, eras, 33 camera moves, 50 palettes, 7 lighting presets, Emotion Wheel, 17 Soul Cast fields, grids), `compileDirector` (native Cinema Studio 4.0 fields or prose), `planCinema` (steps with `after`, notes, blocker, cost), `takesClips` (feature-detected from the FieldMap) | `cinema.ts` (projects, nested scenes, `cinema_items` with per-take meta: take, tiles, cost, req, removed; spend in SQL), `cinema-generate.ts` (`generateInProject`: previews every step, checks the cost cap), `cinema-director.ts` (AI Director via `llmText`, offline fallback, never generates), `cinema-schemas.ts` | `/api/cinema/projects[/id[/folders[/folderId] \| /items[/genId/retry \| /tiles] \| /generate \| /director]]` | `components/cinema/*`: workspace, folder sidebar, feed, prompt bar, Director's Panel, palette editor (`color-math.ts`), grid crops (`grid-math.ts`), Soul builders, autosave |
| **Canvas** (`/canvas`, `/canvas/[id]`) | `catalog/canvas.ts`: node types and typed ports, `connectionError`, `topoOrder`, `describeNode` (a GenerationRequest validated with `planGeneration` on placeholders), `planCanvas` (run vs reuse by signature, pins), `convertEngine`, the 5 templates (cloud and open) | `canvas.ts`: zod graph, CRUD, `canvasView`, `runCanvas` (one generation per step with `dependsOn`; runs kept in `runs_json`), `graphProblem` | `/api/canvases[/id[/duplicate \| /run]]` | `components/canvas/*` on @xyflow/react: editor store (`canvas-context.tsx`, `useSyncExternalStore`, `DescribeCache`), nodes, palette, phone node list |
| **Layers** (`/layers`, `/layers/[id]`) | `lib/layers.ts`: LayerDoc / LayerNode geometry, export scale, zip naming `layer-z{z}-{slug}.png`, stored zip, Copy JSON, `historyReducer` (same-key edits within 1.2 s are one undo), `layersModelFor`, `MAX_NODES = 200`, `MAX_REVISIONS = 50` | `layers.ts`: projects and versions (autosave into the head, 409 from a stale tab), tool jobs built by `jobSteps` (a cut-out step after edits on transparent layers), "decomposed" derived from applied jobs | `/api/layers[/id[/versions \| /jobs[/jobId]]]`, `/api/layers/renders` (PNG-only "derived" assets) | `components/layers/*`: results measured in the browser (`measure.ts`) and laid out by `applyMeasured` (`apply.ts`), zips and composites rendered with canvas (`render.ts`), WebGL grade |
| **Shorts Studio** (`/shorts`, `/shorts/[id]`) | `catalog/shorts.ts`: 44 presets, `planCloudSegments` (equal ≤10 s), `planOpenSegments` (4n+1 frames ≤81 at 16 fps), `planTake`, `planStitch`, `planShorts`, `chainState`; `catalog/shorts-models.ts` (what each restyle model takes, read from its v2v routes); `lib/trim-range.ts` | `shorts.ts` (sessions, segments with takes and the primary take, stitches; `probeSource` reads MP4 then WebM via `webm-probe.ts`), `shorts-schemas.ts` (`once(scope, requestId, fn)`: one paid submit per click, 10 min) | `/api/shorts/{probe,estimate,sessions[/id[/segments/i[/primary] \| /stitch]],presets[/id]}` | `components/shorts/*`, the shared `components/studio/video-trimmer.tsx` |
| **Mixed Media** (`/mixed-media`) | `catalog/mixed-media.ts`: 33 presets with settings, frames = floor(s × fps), open render (one `oss-mixed-media` job) and cloud plan (trim → restyle → original sound), preview plan | `mixed-media.ts`: estimate, render, preview, `retryMixed`; no table (History is the feed: features `mixed-media`, `mixed-media-step`, `mixed-media-preview`) | `/api/mixed-media[/preview \| /estimate \| /retry]` | `components/mixed-media/*` |
| **Image studios** (Color signature, Moodboards, Photodump, Fashion Factory, Character Sheet) | `catalog/palettes.ts` (`applySignature`, `SignatureRecord` in `request.signature`), `catalog/packs.ts` (photo-run planners with `PlanCaps`) | `palettes.ts` (seeded 50 palettes, lock chains), `moodboards.ts` (status derived from the cover job, Recraft style id, style LoRA), `photodump.ts` (runs as one `createPipeline` batch; `retryPhoto`) | `/api/palettes[/id \| /lock]`, `/api/moodboards[/id[/retry \| /train]]`, `/api/photodump[/packs[/id] \| /character \| /fashion \| /retry]` | `components/{palettes,moodboards,photodump,fashion}/*`; k-means in `palettes/extract.worker.ts`; the chips load through `useSignature` in the composer |
| **Marketing** (Marketing Studio, Click to Ad, Ads Studio, Ad Multiplier) | `catalog/marketing.ts`: 84 templates, 11 formats, 9 hooks, 14 settings, 10 ad styles, angles, word budgets, `formatModels`, `UGC_MODELS`, `OPEN_SOUND_JOIN` | `brand.ts` (website scrape, research job, `kitForSite`), `marketing.ts` (`planMarketing`, `planClickToAd`, `planMultiplier` with `referenceFacts` → RunPlan → `createPipeline`; `marketing_runs` keeps the input for Run again and the browser composite), `ads.ts` (batches, creatives, concepts, chat, proposals) | `/api/brands/**`, `/api/products/**`, `/api/marketing/**`, `/api/ads/**` | `components/{marketing,ads,brand}/*`; ad layout math (`ads/layout.ts`) → canvas render with Google fonts (`ads/render.ts`) → stored zip (`ads/zip.ts`); @mention helpers (`ads/mention.ts`) |
| **Faceless Studio / Explainer** (`/faceless`, `/explainer`) | `catalog/faceless.ts`: genres, 22 styles (12 for Faceless), block planning, `buildEpisodeGraph` (steps keyed still / clip / join / narration / music / mix / words / captions), `planRerun`, `planRetry`, `estimateGraph`, `spokenTimes`, `sceneTiming`, `musicLength`, `styleRefLimit` | `faceless.ts`: channels (avatar job), episodes, scripts written in the background by the llm provider (`askLlm`), `launch()` (stage one: stills, narration, word timings) and `advance()` (scenes cut to the spoken times, then clips, joins, music, mix, subtitles), `settle()`, `ensureFacelessRunner()` (2 s sweep, started at boot) | `/api/faceless/**`, `/api/explainer[/link]` | `components/{faceless,explainer}/*` |
| **Translate & dub, Captions, Trim, Katana, Image to 3D, Virality** | `lib/av/*.ts` as plain data: `dub.ts` (one-shot and step plans, takes, timeline), `captions.ts` (burner capabilities), `cue-edit.ts`, `katana.ts` (cuts, `stepsToRedo`), `model3d.ts`, `frames.ts`, `timeline.ts`, `virality.ts`, `languages.ts` | `dub.ts` and `katana.ts` keep generation ids per step in `dub_sessions` / `katana_jobs` (`retryKatana`, `rerunKatana`); deleting stops unfinished steps | `/api/dub[/id[/voice]]` (`?preview=1` prices), `/api/katana[/id[/retry]]` | `components/{dub,captions,katana,model3d,virality,av}/*`. Hub tool modes: `ModeSwitchStudio` has a `TOOLS` map (`audio/translate`, `video-tools/captions`, `video-tools/trim`) |
| **Assist** (`/assist`, `/assist/skills`, `/assist/memory`, `/assist/projects/[id]`) | `lib/assist.ts`: SKILL.md parsing (`parseSkillMd`, `toSkillMd`), slash helpers, modes, `planRunnable` | `server/skills.ts` (built-ins from `skills/` or `FUOBE_SKILLS_DIR`, user skills and toggles in SQLite, `.md` / `.zip` / `.skill` import via `assist/unzip.ts`), `assist/projects.ts` (sources fetched safely; PDFs read by `assist/pdf.ts` with unpdf), `assist/memory.ts`, `assist/context.ts`, `assist/studio-tools.ts` | `/api/assist/**` | `components/assist/*`, `assist-view.tsx` |

## ComfyUI workflow library (`workflows/comfyui/`, `scripts/comfy/`)

`manifest.json` lists 115 workflows, all `validated: true`, each with its **bindings** (canonical key → node id + input), outputs (with `stem` and `role`), defaults, limits, required model files with download URLs and sizes, custom node packs, VRAM, licence, notes, `autoDownloads`, and since round 3 `expand` (`captions` or `timeline`: the provider rewrites the graph per request) and `worker: "isolated"`. The pipeline in `scripts/comfy/` exports the official templates through the real ComfyUI frontend (`app.graphToPrompt()`), applies documented transforms (`library.spec.mjs`, `lib/graph.mjs`), builds hand-written API graphs from `hand-built/*.json`, and validates every graph with `POST /prompt` against a live ComfyUI using zero-byte placeholder models.

Round 3 added 42 workflows (73 → 115), all hand-built: the 29 graphs of `comfyui-oss-3` (layers, style references, palette, segments and restyle, Mixed Media, SFX, dub preparation, ASR captions, translation, lip re-sync, 3D, try-on, grids, Soul Cast) plus Fuobe's own `video-mux-audio-replace`, `captions-burnin` (chunked, constant memory) and `selftest-meta-batch`; then `frame-extract`, `v2a-hunyuan-foley`, `product-shot-qwen-edit-2509`, `audio-timeline` and `video-concat-sound{1,2}-{2,3,4}`. `lipsync-latentsync16` and `sfx-thinksound` are **isolated-worker** workflows: their packs change process-wide state or pin old packages, so `scripts/comfy/install-isolated-worker.sh` sets up a second ComfyUI with its own code copy, base directory, `HOME` and virtualenv, sharing the main install's models read-only through `extra_model_paths.yaml` (port 8189). `install-comfyui.sh` installs 14 packs at pinned commits; `NC_PACKS=1` adds the non-commercial ComfyUI-Whisper.

## Training (`src/server/training.ts`)

A `trainings` row per job, polled by the same runner. Higgsfield Soul ID returns a reference id stored on the element; fal's Z-Image trainer gets a zipped dataset with captions and returns a LoRA URL; AI-Toolkit gets a dataset folder and a job through its UI's job API, and the finished LoRA is copied into `COMFYUI_LORAS_DIR`. A style element (moodboards) uses the style preset (`aiToolkitJob({ kind: "style" })`, captions "<trigger> style", 1500 steps). Failed fal jobs (4xx, `FAILED`), a missing AI-Toolkit job, 8 h without a result and uploads cut off by a restart fail the training and settle the element back to ready.

## Assist agent (`src/server/assist/`)

A manual tool-use loop over Claude (adaptive thinking with `block_binding` drop-block, betas `thinking-binding-controls-2026-08-01` and `server-side-fallback-2026-07-01` (not for Haiku), top-level `cache_control` and two cached system blocks, streamed with `client.beta.messages.stream(...).finalMessage()`, `max_tokens` 32k or 64k at Extra / Max effort). Modes: **Free** (a local model, or the offline planner), **Smart** (Claude, needs a key), **Manual** (pick claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5 or claude-fable-5-1 and the effort, or one of the local server's models). `resolveAgent()` picks one per chat. The agent ids are `claude`, `local` and `offline`; chats and browsers that saved the old `ollama` read as `local` (`normalizeAgent()`, the `ModeChoice` schema).

- **Context.** Each chat's context (date, engine, approval mode, project, sources, memory, skills index, active skills) is built once and frozen in `assist_thread_state`; later changes arrive as role `system` "Context update" messages, saved only after a reply succeeds, so preserved thinking stays valid.
- **Tools** (`tools.ts`, `context-tools.ts`, `studio-tools.ts`): `search_models` (kinds image, video, audio, text, model3d), `list_elements`, `list_recent`, `check_generations` (text inline, meta, images attached), `generate` (with `after`: the call becomes one `createPipeline`; not `strict`, zod-validated), `create_storyboard` (the only `strict` tool), `list_skills`, `load_skill`, `remember` (asks first), `read_source`, the studio tools `split_layers`, `restyle_footage`, `dub_video`, `faceless_episode`, `create_ads`, `add_captions`, and `katana`. Gated calls stop the loop with an approval card priced by `previewGeneration`; `PlannedJob.atomic` marks a pipeline's steps and `planRunnable()` keeps Run off while any step has an error. `answerApproval` claims the thread before its first await.
- **Studio tools** resolve through `STUDIO_ROUTES`, a registry a studio module can fill; while an entry is empty (all of them today) the tool builds the same job as a `createPipeline` of catalog models on either engine.
- History is stored append-only exactly as the API returned it; local images are kept as URLs and converted to base64 per request. The same loop runs on a local model's tool calling (`local` in `agent.ts`: the history through `toChatMessages()`, the answer back as `tool_use` blocks; a picked model the server doesn't list gives way to its default), or with no LLM on a rule-based planner (still → animate, N-shot films, N portraits, translations, skill hints, "remember that…").

## MCP server (`src/server/mcp.ts`, `/api/mcp`)

Fuobe's MCP server (version 1.1.0; protocol revisions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05) over streamable HTTP, stateless with JSON responses: `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list` (empty), `prompts/list`, `prompts/get`. The tools are Assist's (shared `executeTool`) with read-only hints, plus `estimate_cost` (a generate call priced with `previewGeneration`) and `estimate_job` (a studio tool's plan). The prompts are the enabled skills. Requests from a foreign `Origin` are refused; the proxy applies the same sign-in rules as the REST API.

## Storage (`src/server/db.ts`, `storage.ts`, `settings.ts`)

SQLite (WAL). Migrations are an append-only list in `db.ts`, applied once each and recorded in `_migrations`:

| # | adds |
|---|---|
| 0 | `generations`, `assets`, `settings`, `characters` |
| 1 | elements: `characters.kind`, `handle`, `loras_json` |
| 2 | `trainings` |
| 3 | `generations.depends_on` (chained jobs) |
| 4 | `assist_threads` |
| 5 | `generation_runs` (submitted_at, started_at: the provider timeouts) |
| 6 | `generation_trash`, `folders`, `folder_items` |
| 7 | `cinema_projects`, `cinema_folders`, `cinema_items` |
| 8 | `canvases` (`graph_json`, `runs_json`) |
| 9 | `layer_projects`, `layer_versions` |
| 10 | `shorts_sessions`, `shorts_presets` |
| 11 | `brand_kits`, `products`, `ad_batches`, `ad_creatives`, `marketing_runs` |
| 12 | `palettes`, `moodboards`, `photodump_packs` |
| 13 | `faceless_channels`, `faceless_episodes` |
| 14 | `dub_sessions`, `katana_jobs` |
| 15 | `skills`, `skill_toggles`, `assist_projects`, `assist_project_sources`, `assist_memory`, `assist_thread_state` |

Settings (`src/server/settings.ts`) are typed and validated against allowed values; environment variables give the defaults, and a value saved in Settings wins over them (the password is the exception: `FUOBE_PASSWORD` can't be changed from Settings). Secrets are masked before reaching the browser. `engineMode` is enforced server-side; the client reads it from `/api/status`. Files live in `data/files/{uploads,outputs}/<date>/<id>.<ext>` (content types include .txt / .srt / .vtt / .json / .glb / .aac) and are served by `/api/files/...` with HTTP range support. `FUOBE_DATA_DIR` moves everything.

## UI (`src/components/`, `src/app/(studio)/`)

Liner-inspired shell (pale frame, rounded inset sheet, 13px sidebar rows, serif headlines, pill composer). The sidebar (`app-sidebar.tsx`) remembers its rail and groups without making the layout dynamic (`SIDEBAR_STATE_SCRIPT` in `src/lib/nav.ts` runs before paint). Branded not-found and error pages, and `loading.tsx` skeletons on studio and gallery routes.

- **Studio pages** render `<Studio config>` (`src/components/studio/studio.tsx`), a server component that passes `studioCatalog(config)` from `src/lib/studio-catalog.ts`: the studio's models without provider field maps. Inside, `CatalogProvider` / `useCatalog()` resolve models; `loadFullCatalog()` imports `@/lib/catalog` lazily for motions, effects, `?preset=` and unknown ids. Client components under `studio/` must not import `@/lib/catalog` or `@/lib/studios`. `StudioPage` renders the same tree in the static shell and after hydration; hand-off params merge into the draft with `mergeHandoff`. `StudioConfig` (`studio-context.tsx`) gained `pickerOps`, `anyOf`, `signature` and `extraModels`.
- **Hubs** (Audio, Video tools, Upscale) have one prerendered path per mode (`src/lib/hubs.ts`, `ModeSwitchStudio` in `mode-switch-studio.tsx`, `[mode]/page.tsx`); old `?mode=` links redirect in `next.config.ts`.
- **Composer** pieces: pure logic in `src/lib/composer.ts` (summary, blockers, `onImageChange`, `fitAttachments`, `firstMissingSlot`), `attachments.ts` (`useAttach`, `useUploadReaper`), `settings-panel.tsx`, `model-picker.tsx` (cmdk), `attach-menu.tsx`, `preset-chips.tsx` (lazy), `radio-keys.ts`.
- **Galleries** get slim cards (`src/lib/preset-cards.ts`, built on the server by `toPresetCard()` in `preset-card-data.ts`). A preset with rendered media carries only its hash (from `src/lib/catalog/preview-media.generated.json`, which only `preset-card-data.ts` reads so that client chunks don't carry it; file names in `src/lib/preview-media.ts`): `preview-media.tsx` shows the AVIF/WebP poster and mounts the muted loop only while it plays. The others, and any card whose files don't load, get procedural previews (`preset-preview.tsx`, `move-glyphs.ts`). `preview-playback.ts` plays one at a time: hover after a short rest, on phones the centred card once scrolling stops (not with Save-Data or on 2G).
- Stand-alone views: color grading (`color-grade-view.tsx`, `src/lib/grade.ts`), storyboard, elements + train dialog, library (`library-view.tsx` + `components/library/*`), Assist, and the studios above.

## Generators (`scripts/`)

`pnpm gen:catalog` runs `gen-cloud-models.py`, `gen-higgsfield-models.py`, `gen-higgsfield-presets.py`, `gen-oss-loras.py` and the icon map. Each reads a research JSON in `docs/research/` and writes a `*.generated.ts` file; the catalog integrity tests catch broken references. `gen-preview-scenes.mjs` draws the gallery preview stills (`public/samples/previews/`), `gen-demo-3d.mjs` the demo GLB and turntable (needs ffmpeg). `build-previews.mjs --masters <dir>` turns rendered masters (kept outside the repo) into the preset cards' posters and loops in `public/previews/` plus their manifest (needs ffmpeg; unchanged masters are skipped).
