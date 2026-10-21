# scripts/comfy — Fuobe ComfyUI workflow pipeline

Produces the API-format workflow library in `workflows/comfyui/` (one `<id>.json` per workflow,
`manifest.json`, `object_info.subset.json`) from official ComfyUI templates, custom-node example
workflows and a few hand-built graphs, and validates every workflow against a real ComfyUI server.
No GPU and no model weights are needed (validation uses zero-byte placeholder model files).

Full write-up (what is in the library, validation results, models, quirks for app code):
[`docs/research/comfyui-workflow-library.md`](../../docs/research/comfyui-workflow-library.md).

## Files

| file | purpose |
|---|---|
| `install-comfyui.sh` | reproducible CPU install of ComfyUI + the 14 custom node packs (pinned commits; Chatterbox, IndexTTS2 and Video-Depth-Anything added for the comfyui-oss-2 workflows — IndexTTS2's runtime deps only with `INDEXTTS_RUNTIME=1`; MelBandRoFormer, QwenASR and HunyuanVideo-Foley for comfyui-oss-3). Non-commercial node code is opt-in: `NC_PACKS=1` adds ComfyUI-Whisper (CC-BY-NC-SA-4.0, only for `captions-whisper-burnin`) |
| `install-isolated-worker.sh` | a second ComfyUI with its own code copy, base directory, `HOME` and virtualenv for LatentSync 1.6 and ThinkSound (below) |
| `start-comfyui.sh` / `stop-comfyui.sh` | run ComfyUI in the background on 127.0.0.1:8188 (log: `$COMFYUI_DIR/logs/comfyui.log`) |
| `export-templates.mjs` | Playwright: opens the ComfyUI frontend, `app.loadGraphData(ui)` → `app.graphToPrompt().output`, writes `build/raw/<key>.api.json` + `.meta.json` (embedded model URLs, missing node types) |
| `library.spec.mjs` | the curated list: id, title, capability, source, transforms, bindings, outputs, limits, VRAM, notes |
| `lib/graph.mjs` | API-graph transforms (resolve constant switches, set/delete inputs, insert nodes, prune, lint) |
| `hand-built/*.json` | API-format graphs written by hand from `/object_info` definitions (incl. the 20 comfyui-oss-2 workflows, transcribed from the live-validated graphs in `docs/research/comfyui-oss-2.json`) |
| `build-library.mjs` | spec + raw exports → `workflows/comfyui/<id>.json` + `manifest.json` (models, sizes via Hugging Face, custom-node packs, defaults) |
| `validate-workflows.mjs` | POSTs every workflow (bindings filled with sample values) to `/prompt`, requires HTTP 200 + `prompt_id` + no `node_errors`, then deletes it from the queue before it can run (a KJNodes `Sleep` "blocker" prompt keeps the worker busy meanwhile; final `POST /queue {"clear":true}` + `POST /interrupt`); updates `manifest.json`, `validation-state.json`, writes `object_info.subset.json` |
| `fixtures/` | tiny png / mask / wav / mp4 uploaded during validation |
| `validation-state.json` | sha256 of each validated workflow file → lets `build` keep `validated: true` when a file is unchanged |

## Exact commands used (2026-10-16, Linux, Python 3.13, Node 22, CPU only)

```bash
# 1. ComfyUI (outside the repo)
git clone https://github.com/comfyanonymous/ComfyUI /home/user/ComfyUI        # HEAD fc04da91 = v0.41.0-7
cd /home/user/ComfyUI
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv/bin/python -r requirements.txt   # comfyui-frontend-package 1.55.17, comfyui-workflow-templates 0.11.86

# 2. custom node packs (git clone --depth 1 into custom_nodes/) + their deps — see install-comfyui.sh
#    (the script does all of 1+2 with pinned commits:  bash scripts/comfy/install-comfyui.sh)

# 3. start (background) — equivalent to: cd /home/user/ComfyUI && .venv/bin/python main.py --cpu --listen 127.0.0.1 --port 8188
bash scripts/comfy/start-comfyui.sh
curl -s http://127.0.0.1:8188/object_info | head -c 100

# 4. pipeline
cd scripts/comfy
npm install                      # playwright-core only; uses the preinstalled Chromium in /opt/pw-browsers
npm run export                   # all template/example sources referenced by library.spec.mjs
npm run build                    # needs outbound HTTPS to huggingface.co for model sizes (NODE_USE_ENV_PROXY=1 is set in the script)
npm run validate                 # needs ComfyUI running; never runs a model
# or: npm run all
```

Single items: `node export-templates.mjs video_wan2_2_14B_i2v`, `npm run build -- wan22-i2v-14b`,
`node validate-workflows.mjs wan22-i2v-14b`. `--shared` skips the final global queue clear/interrupt.
`node validate-workflows.mjs --keep-dummies` keeps the
zero-byte model placeholders (by default they are deleted after the run; real model files are never touched,
so the validator is safe to point at a real GPU server via `COMFYUI_URL` + `COMFYUI_DIR`/`COMFYUI_MODELS_DIR`).

Environment variables: `COMFYUI_URL` (default `http://127.0.0.1:8188`), `COMFYUI_DIR` (default `/home/user/ComfyUI`),
`COMFYUI_MODELS_DIR`, `CHROMIUM_PATH` (default: newest `/opt/pw-browsers/chromium-*/chrome-linux/chrome`).

**Always pass ids to `npm run build` in a checkout without `build/raw/`** (a fresh clone has none): entries
whose raw template export is missing are skipped, and the manifest is then rewritten without them. Hand-built
entries need no export. After a build, diff `manifest.json`: untouched ids must be byte-identical.

## Round-3 workflows (comfyui-oss-3, 2026-10-17)

31 entries from `docs/research/comfyui-oss-3.json` (29 researched graphs + `video-mux-audio-replace` +
`captions-burnin`), all hand-built, all `validated: true`:

```bash
npm run build -- <ids>                 # the 29 main-server ids of the "comfyui-oss-3" section of library.spec.mjs
node validate-workflows.mjs <ids>
```

- **Changes from the research graphs**: `captions-qwen3-asr` and `dub-prepare-separate-transcribe` read the speech
  with `LoadAudio` (it decodes the soundtrack of a video upload too, without decoding frames), so they take audio or
  video. Binding names follow Fuobe's canonical inputs (`startTime`, `numLayers`, `sourceLanguage`, `paletteImage`…,
  documented in the header of `library.spec.mjs`). The TRELLIS.2 graph's pass-through `PreviewImage` nodes are linked
  around by the build (they would otherwise write 4096² textures to `temp/` on every run).
- **`captions-burnin`** is Fuobe's own caption burn-in, core nodes only, built so memory does not grow with the
  clip: gaps between captions go to `Concatenate Video` as `Trim Video` windows (never decoded); captioned stretches
  are cut into chunks of at most ~384 MB of frames, and each chunk is decoded, gets a `Draw Text Overlay` and is
  encoded at once (`Create Video`, codec h264), so ComfyUI can drop its raw frames. `Concatenate Video` joins
  everything with the clip's own soundtrack (`LoadAudio`, dropped for silent clips). The library file holds a
  one-chunk + one-gap example; the provider rewrites it per request (`expand: "captions"`, `expandCaptionWorkflow()`
  in `src/lib/comfy.ts`) from what the upload's MP4 header says (duration, fps, size, audio). Every window holds at
  least 3 frames (`Concatenate Video` rejects a 2-frame clip followed by another one). Under RAM pressure
  (`--cache-ram 11` on the CPU box) a 20 s 640x360 30 fps clip with 18 s of captions peaks at +0.50 GB RSS and a 40 s
  one at +0.45 GB — the earlier one-batch graph needed +5.16 GB for the 20 s clip and grew with the length. Without
  pressure ComfyUI's RAM cache simply keeps the finished chunks (+2.64 GB for 20 s) until memory runs low.
- **`video-mux-audio` / `-replace`** put the new soundtrack on with `Concatenate Video` (`complete_audio`): the video
  stream is copied packet by packet (bit-identical, no decode), only the AAC soundtrack is encoded. The two-track
  graph mixes voice and background over `EmptyAudio` of the video's length (`AudioMerge` cuts its second track to
  the first one's length). A 900-frame clip muxes in ~5 s at +0.02 GB RSS.
- **`captions-whisper-burnin`** decodes the whole clip (VHS) and needs ComfyUI-Whisper (`NC_PACKS=1`); the provider
  refuses clips that would need more than half the server's RAM and points to the chunked route.
- **New entry fields**: `worker: "isolated"` (below), `expand`, and on outputs `stem` (`voice` | `background`) and
  `role` (`cues`, `transcript`, `language`, `sheet`, `tiles`, `layers`, `first-frame`, `turntable`).

### Isolated worker (LatentSync 1.6, ThinkSound)

`lipsync-latentsync16` and `sfx-thinksound` are optional and never defaults. Their packs change process-wide state
(LatentSync overrides `TMPDIR` and `folder_paths` temp handling at import, `rmtree()`s a `temp` folder next to the
ComfyUI directory and pip-installs packages into whatever interpreter runs it when its node is created) or pin old
packages (ThinkSound's `requirements.txt` downgrades einops, PyWavelets, k-diffusion; LatentSync's runtime needs
mediapipe, which pins `protobuf<5`). So the worker gets **its own code copy, base directory, `HOME` and
virtualenv** — nothing is installed into the main ComfyUI's venv:

```bash
ISO_DIR=/srv/comfyui-isolated scripts/comfy/install-isolated-worker.sh
#  - copies ComfyUI's *code* only (tar with models/, input/, output/, user/, custom_nodes/ and .venv excluded —
#    never `cp -r` the whole install, models/ can be hundreds of GB)
#  - creates $ISO_DIR/.venv (Python 3.11: ThinkSound pins PyWavelets 1.4.1, which has no newer wheels), installs torch
#    (TORCH_INDEX=https://download.pytorch.org/whl/cu128 on a GPU server), ComfyUI's requirements, the two packs and
#    VHS + KJNodes at the pinned commits, ThinkSound's requirements and LatentSync's runtime deps — into that venv
#  - writes extra_model_paths.yaml so the worker reads the main install's model folders (shared, not copied)
cd /srv/comfyui-isolated/ComfyUI && HOME=/srv/comfyui-isolated/home /srv/comfyui-isolated/.venv/bin/python main.py --listen 127.0.0.1 --port 8189
```

Point a second Fuobe install (or Settings → ComfyUI URL while you use those models) at port 8189. Build and
validate them against that server (placeholder models go into the shared main `models/` folder the worker reads):

```bash
COMFYUI_URL=http://127.0.0.1:8189 npm run build -- lipsync-latentsync16 sfx-thinksound
COMFYUI_URL=http://127.0.0.1:8189 COMFYUI_MODELS_DIR=/home/user/ComfyUI/models node validate-workflows.mjs lipsync-latentsync16 sfx-thinksound --shared
node validate-workflows.mjs video-trim     # then once on the main server, so object_info.subset.json comes from it
```

`validate-workflows.mjs` keeps the subset definitions of classes the current server lacks, so validating on either
server never drops the other's classes.

## Adding a workflow

1. Find the template name in `$COMFYUI_DIR/.venv/lib/python3.*/site-packages/comfyui_workflow_templates_json/templates/index.json`
   (or a custom-node `example_workflows/*.json`), run `node export-templates.mjs <name-or-path>`.
2. Inspect `build/raw/<key>.api.json` (node ids like `129:98` = subgraph instance 129, inner node 98).
3. Add an entry to `library.spec.mjs` (bindings must target literal widget inputs, not links — the build fails otherwise).
4. `npm run build -- <id> && node validate-workflows.mjs <id>`.

## Known environment issues

- `ComfyUI-SeedVR2_VideoUpscaler` (numz) does not register on CPU-only hosts: its loaders build the device
  combo from CUDA/MPS devices and crash with `list index out of range`. The library uses the **native**
  SeedVR2 nodes of core ComfyUI instead (official templates `utility_seedvr2_*`).
- `ComfyUI-RMBG` imports its SAM3 module eagerly; without `triton`, `decord` and `pycocotools` the whole
  pack fails to load (its error handler itself raises `NameError: module_name`). They are installed by `install-comfyui.sh`.
- `ComfyUI-Frame-Interpolation`: cupy is not installed (CPU); RIFE works without it.
- `ComfyUI-ReActor` downloads ~1 GB of face-restore weights into `models/facerestore_models` whenever that
  folder is empty, even on `GET /object_info`; `install-comfyui.sh` drops a zero-byte placeholder there (skip with `REAL_MODELS=1`).
  It also logs a harmless `KeyError: 'ultralytics_bbox'` for its unused `ReActorMaskHelper` node on `/object_info`.
- Some nodes download weights the moment they *execute* (ComfyUI-RMBG, RIFE VFI, WanVideoWrapper wav2vec, ReActor
  detectors). The validator therefore never lets a validation prompt reach the worker (see the blocker above). An
  earlier naive version (POST, then interrupt) let ComfyUI-RMBG start fetching BEN2; that file was deleted.
- Node's built-in `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` (set in `npm run build`).
