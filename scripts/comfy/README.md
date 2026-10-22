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

## Round-4 workflows (comfyui-oss-4, 2026-10-22)

17 hand-built entries from `docs/research/comfyui-oss-4.json` (the 14 researched graphs and the critic's 3), in the
"comfyui-oss-4" section of `library.spec.mjs`, all `validated: true` (132/132 in the manifest). No new node pack and no
worker: core nodes plus KJNodes' `GrowMaskWithBlur` and VHS's audio loader / `VHS_VideoCombine` / `VHS_LoadVideo`.
`capability` is the round-4 operation each one serves.

```bash
npm run build -- <the 17 ids>          # hand-built: no export needed
node export-templates.mjs video_wan_vace_14B_ref2v && npm run build -- wan21-vace-14b-ref2v
node validate-workflows.mjs <ids> wan21-vace-14b-ref2v --shared
```

| id | capability | what | ran for real here |
|---|---|---|---|
| `ocr-lines-qwen35` | ocr | text lines + boxes (OvisOCR3 0.8B, core `TextGenerate`) | research only (161-194 s per poster on CPU) |
| `video-inpaint-wan-vace` | remove-object | SAM 3.1 tracks `maskPrompt`, Wan 2.1 VACE 14B + lightx2v fills, pasted into the original frames | window + sound sub-path only |
| `video-inpaint-wan-vace-painted` | remove-object | same, the object painted on the first frame (`mask`) | no (GPU) |
| `video-erase-void` | remove-object | Netflix VOID, removes the object's shadows / reflections too (CogVideoX licence) | no (GPU) |
| `video-swap-wan-vace` | video-swap | tracked object replaced by a reference `image` | no (GPU) |
| `video-insert-wan-vace` | video-insert | reference `image` placed in a painted region (`mask`) | no (GPU) |
| `kenburns-still` | still-motion | pan + zoom over a still, core loops, chunk-encoded | yes: 2 s 320x180 25 fps in 7.6-11.2 s |
| `audio-loop-crossfade` | audio-loop | loop a bed to `duration` with equal-power seams | yes: 3 s → 10 s FLAC in 1.1-2.5 s, seams click-free |
| `audio-join-crossfade` | audio-join | two clips, `crossfade` seconds of overlap | yes: 3 s + 2 s → 4.5 s in 0.2-2.1 s |
| `video-export-pro` | export-video | ProRes HQ / 4444, H.265 10-bit, FFV1, H.264 (VHS) | yes: all five formats, ffprobe-checked |
| `video-sdr-to-hdr` | sdr-to-hdr | core `ImageSDRToHDR` → BT.2020 HLG 10-bit H.264 | yes: High 10, arib-std-b67 |
| `video-export-exr` | export-video | half-float scene-linear EXR per frame | yes: 16 frames → 16 `.exr` |
| `still-to-clip` | still-motion | a still held N s with a silent track | yes: 50 frames + AAC silence |
| `video-append-endcard` | concat | ad + end card, ad picture stream-copied, ad sound kept | yes: bit-identical ad frames, silence from 2.00 s; foreign H.264 fails (known limit) |
| `scene-mesh-moge` | scene-3d | whole-scene textured GLB + depth PNG (MoGe 2) | research only (42 s on CPU) |
| `image-to-splat-triposplat` | splat | subject Gaussian splat (`.spz`) + orbit MP4 (TripoSplat) | no |
| `reference-brief-gemma4` | write | reference clip's frames + sound → JSON style brief (Gemma 4 E4B) | no |

- **Changes from the research graphs** (each also in the entry's notes): the painted / insert masks are read from the
  **red channel** (white = erase / the region, Fuobe's mask convention since `flux1-fill-inpaint`), not alpha; Ken Burns
  gained `easeInOut` (1 = the research's ease in-out, 0 = linear) for `params.easing`; both audio graphs name the
  crossfade curve upload `fadeCurve` (the research used `audio2` / `audio3`, which the provider fills with user audio);
  the brief binds `frames` / `startFrame` (canonical keys) and `frameWidth` (a canonical `width` would be resized by the
  provider) plus `seed`; TripoSplat's `seed` drives both the sampler and the decoder; outputs use kind `model3d`.
- **What the provider has to do** (feature packages): write the crossfade curve (a stereo WAV exactly `crossfade` seconds
  long, left = sin(π/2·t), right = cos(π/2·t), 8 kHz) and upload it as `fadeCurve`; parse the OCR JSON (strip fences,
  `bbox`/`text` or `bbox_2d`/`text_content`, boxes relative 0–1000); run VACE / VOID windows of ≤ 81 / ≤ 197 source frames
  (`startFrame`, `frames` counted at the clip's own fps) and join them; map Ken Burns and export params; for a silent ad
  drop nodes 2, 12 and 13 of the end card and node 14's `complete_audio` (`LoadAudio` stops on a clip with no sound),
  and fall back to `still-to-clip` + `video-concat-sound1-2` for clips other encoders made.
- **Build**: `OpticalFlowLoader` (folder `optical_flow`) and `LoadMoGeModel` (`geometry_estimation`) are known loaders;
  `KNOWN_MODELS` has the OvisOCR3, VACE, VOID, MoGe and TripoSplat files and the alternative checkpoints (Qwen3.5 0.8B / 2B,
  VACE 1.3B, MoGe 3). OvisOCR3 (`model.safetensors`) and Qwen3.5 0.8B (`model.safetensors-00001-of-00001.safetensors`) are
  single files upstream: save them under the manifest names. VOID's `t5xxl_fp16` and TripoSplat's `flux2-vae` are
  byte-identical to the library's FLUX files (same sha256). New output roles: `lines`, `frame`, `frames`, `scene`, `depth`, `splat`, `brief` (typed in `src/lib/comfy.ts`).
- **Licence fix (R4-15)**: `wan21-vace-14b-ref2v` shipped the template's CausVid LoRA, which is CC-BY-NC-4.0. Its spec
  entry now swaps it (transforms on nodes 115 / 108 / 110) for the Apache-2.0 `lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64`
  at 1.0 with the round-4 VACE settings (4 steps, cfg 1, euler, shift 5; clip strength 0) and binds `loraStrength`
  (0 + steps 20 + cfg 6 = full quality). Re-validated; the pairing is inferred, not GPU-tested.
- **Real runs** used the fixtures plus tiny generated tones / noise, on the shared CPU server (own prompt ids only; the
  test inputs and outputs were deleted afterwards), in two sessions; every output was checked with ffprobe (and
  framemd5, silencedetect or numpy where it matters). Timings are in each entry's notes. The VACE graphs' window-and-sound
  part (`ImageFromBatch` + `TrimAudioDuration` at the clip's fps → `CreateVideo`, nodes taken from the built graph) ran on
  a clip with sound (the window's 0.84 s kept) and a silent one (no sound track, no error).

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
