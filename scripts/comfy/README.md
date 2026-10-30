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
| `install-comfyui.sh` | reproducible CPU install of ComfyUI + 18 custom node packs (pinned commits; Chatterbox, IndexTTS2 and Video-Depth-Anything added for the comfyui-oss-2 workflows — IndexTTS2's runtime deps only with `INDEXTTS_RUNTIME=1`; MelBandRoFormer, QwenASR and HunyuanVideo-Foley for comfyui-oss-3; ToSVG (VTracer) in round 4). Licences are information: the non-commercial ComfyUI-Whisper (CC-BY-NC-SA-4.0, only for `captions-whisper-burnin`) is installed too, and `NC_PACKS=0` leaves it out (Settings → Models & licences has a switch per node pack). Round 4 part 4 adds Akatz Labs' GPL-3.0 `h3_character_swap` for Genjutsu's Character swap (`H3_PACK=0` leaves it out; it needs `ffmpeg` and `ffprobe`), and H3 Relay 2.0 with `H3_RELAY=1`. DBS D1 adds ComfyUI-DBS and its 23 MB of weights (`DBS_WEIGHTS=0` skips the weights) |
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
- **`captions-whisper-burnin`** decodes the whole clip (VHS) and needs ComfyUI-Whisper (non-commercial code, installed unless `NC_PACKS=0`); the provider
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

Then set **Settings → Open-source engine · ComfyUI → Isolated worker URL** (or `COMFYUI_ISOLATED_URL`) to
`http://127.0.0.1:8189`: Fuobe sends these two workflows, their uploads and their polls there, and everything else
to the main ComfyUI (the Lipsync studio offers LatentSync 1.6 and Audio → Sound effects offers ThinkSound, marked
"Runs on the isolated ComfyUI worker"; without the setting, or when the worker doesn't answer, the job fails with a
message that names the setting). Build and validate them against that server (placeholder models go into the shared
main `models/` folder the worker reads):

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
  The four VACE graphs and VOID take their window in **seconds** (`startTime`, `duration`): core `Video Slice` decodes
  only the window (at most 81 / 197 frames + half a frame at the clip's fps, read from a 0.1 s probe slice), the graph
  keeps the largest 4n+1 / 8n+5 frames it decoded and trims the sound to exactly those frames; `width` × `height` is a
  work-size budget the graph renders in the clip's own shape (scaled, never cropped, so the VACE paste-back lines up).
  The research graphs decoded the whole clip as float32 before cutting the window (`startFrame` / `frames`) and
  centre-cropped to `width` × `height`. MoGe resizes on the longer edge (the research tested the width only).
- **What the provider has to do** (feature packages): write the crossfade curve (a stereo WAV exactly `crossfade` seconds
  long, left = sin(π/2·t), right = cos(π/2·t), 8 kHz) and upload it as `fadeCurve`; parse the OCR JSON (strip fences,
  `bbox`/`text` or `bbox_2d`/`text_content`, boxes relative 0–1000); run VACE / VOID windows (`startTime` = k × 81 / fps,
  `duration` = 81 / fps; VOID 197; fps from the clip's header, `duration` 0 = the longest window) and join them; map Ken
  Burns and export params; set `meta.format` on the splat (and a content type for `.ksplat`, `.mkv` and `.exr`, which
  `storage.ts` has no extension for: they would be saved as `.bin`); for a silent ad
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
  framemd5, silencedetect or numpy where it matters). Timings are in each entry's notes. The window, sound and work-size
  nodes of the VACE and VOID graphs (taken from the built graphs, the model replaced by the work-size frames scaled back)
  ran on a 9:16 30 fps clip with sound (81 frames and 2.700 s of sound from 1 s, rendered at 464×832 and back, lined up
  with the source frames), a 1 s window (29 frames), a silent clip (no sound track, no error), a 25 fps clip through
  VOID (197 frames, 7.880 s of picture and of sound, 672×376) and a window at 50 s of a 60 s clip (0.6 s instead of
  2.6 s with the whole-clip decode). MoGe's guard ran on 1536×3000, 3000×1536 and 1024×768 stills.

### Round-4 video finishing (r4/video-finish, 2026-10-23)

Five hand-built entries for the Upscale hub's FPS Boost, SDR to HDR and Export modes and for R4-38 (open video
upscaling decoded the whole film: about 38 GB of float frames for 30 s at 480p). No new node pack: core nodes plus
VHS's `VHS_LoadVideo` meta-batch, `VHS_BatchManager`, `VHS_SelectEveryNthImage` and `VHS_VideoCombine`.
`video-sdr-to-hdr` also binds `colorSpace` (HLG, or `HDR PQ` for HDR10), and `video-export-exr` saves a preview clip.

```bash
npm run build -- interpolate-rife-fps upscale-video-esrgan-chunked upscale-video-seedvr2-chunked video-export-pro-chunked video-sdr-to-hdr-exr video-sdr-to-hdr video-export-exr
node validate-workflows.mjs <the same ids> --shared
```

| id | capability | what | ran for real here |
|---|---|---|---|
| `interpolate-rife-fps` | interpolate | FrameInterpolate by m, keep every n-th: source fps × m / n = target × slowdown; output fps computed in the graph | yes: 24 → 60, 25 → 30 at 2× slow, 30 → 24 |
| `upscale-video-esrgan-chunked` | upscale-video | Real-ESRGAN in passes of `framesPerBatch` frames, scaled to `shortSide`, one H.264 encode across passes | yes: 30 s 144p → 1080p, 47 passes, +0.87 GB RSS |
| `upscale-video-seedvr2-chunked` | upscale-video | SeedVR2 3B in passes of 4n+1 frames (no context across passes: a seam is possible) | no (GPU); /prompt only |
| `video-export-pro-chunked` | export-video | ProRes 422 HQ / 4444, H.265 10-bit, FFV1, H.264 in passes, with the sound | yes: ProRes, H.265, FFV1 |
| `video-sdr-to-hdr-exr` | sdr-to-hdr | scene-linear Rec.2020 half-float EXR per frame + an HLG preview | yes: 60 frames + preview |

- **What the provider does** (`src/server/providers/comfyui.ts`, `src/lib/av/fps.ts`, `src/lib/av/video-finish.ts`): m and n
  from the clip's header frame rate (the cheapest exact pair, the nearest one for 29.97-style rates); FrameInterpolate
  linked out when m is 1; slow motion drops the sound link; params.format → VHS format / ProRes profile, CreateVideo's
  colour space, or the EXR graphs; EXR frames zipped one at a time onto the preview clip (`meta.artifacts.exr`);
  `framesPerBatch` sized from the clip so a pass holds about 1.5 GB of frames; each job tags its `VHS_BatchManager`
  (ComfyUI otherwise reuses a cached manager after a failed meta-batch run and silently loses frames: 32 of 48 seen
  here); a silent clip loses the `VHS_LoadVideo` audio link (VHS fails on it); graphs that still decode the whole clip
  (FPS Boost, HDR, EXR) refuse a clip that needs more than half the server's RAM, and the composer checks the same rule
  before Generate (`/api/status` reports the ComfyUI's RAM). They hold 2 frame-sized float copies of the clip (decoding
  stacks the frames; the tone map makes one more; encoders and the EXR writer take a frame at a time), FPS Boost 2 + m
  (`VHS_SelectEveryNthImage` is a view): measured here, SDR to HDR on 10 s of 640×360 at 30 fps peaked 1.57 GB above idle,
  2.04 copies. FPS Boost needs the clip's frame rate (header) and refuses without it rather than guess m and n.
- **Cancel**: VHS re-queues each pass under a new prompt id with a negative queue number (it runs before anything else),
  so cancelling a meta-batch job deletes every pending prompt carrying the job's filename prefix, interrupts the one
  running, and looks again for a few seconds (a pass that was already saving can still queue the next). Checked here on a
  38-pass ProRes 4444 export: cancelled during pass 4, nothing ran after it. VHS keeps that pass's ffmpeg encode open in
  the cached batch manager (a partial `.mov` without its moov atom stays in `output/`) until ComfyUI drops the cache; the
  same happens to any meta-batch run that fails or is interrupted.
- **Real runs**: through Fuobe's API on the dev server (the comfyui provider end to end: upload, bindings, meta-batch
  follow, EXR zip) and directly with a small runner, on the shared CPU server with own prompt ids only, every output
  ffprobe-checked. The model graphs ran with random-weight stand-ins (`vftest_rife_random.safetensors`,
  `vftest_esrgan_x4_random.safetensors`, removed afterwards), so they prove frame counts, sizes, rates, sound and memory,
  not picture quality. Chunked vs whole-clip ESRGAN: 30 s at 256×144 to 1920×1080 held 0.87 GB above idle in 47 passes;
  the whole-clip graph held 3.0 GB for 10 s of the same clip at only 1024×576.
- **Caveat**: VHS's ProRes `hq` profile leaves the pixel format to `prores_ks`, which picks `yuv444p10le` for RGB frames, so
  "ProRes 422 HQ" is the HQ tag (`apch`) carrying 4:4:4 samples (FFmpeg reads it). A strict 4:2:2 file needs a VHS format
  with `-pix_fmt yuv422p10le`, a change to the node pack (not made). Core ComfyUI has no H.265 encoder, so the open HDR
  is H.264 High 10 (HLG or PQ); HDR10 in H.265 comes from Topaz on the cloud.
- **FILM**: oss-rife's Model control can pick `film_net_fp16.safetensors`; the spec lists it under `optionalModels`, so
  the manifest carries it with `optional: true` (named with its download when it's missing, not counted as missing on
  the Workflows page). Its URL is the repo's current name, `Comfy-Org/Frame-Interpolation` (the old lowercase one redirects).

### Round-4 Image to 3D extras (r4/3d-plus, 2026-10-25)

One hand-built entry for Image to 3D's "From several images" on the open engine, from the official template
`3d_pixal3d_multi_views` (2026-09-09; core nodes only):

```bash
node export-templates.mjs 3d_pixal3d_multi_views          # build/raw/, then the hand-built graph was made from it
npm run build -- image-to-3d-trellis2-multiview image-to-3d-trellis2
node validate-workflows.mjs image-to-3d-trellis2-multiview image-to-3d-trellis2 --shared
```

| id | capability | what | ran for real here |
|---|---|---|---|
| `image-to-3d-trellis2-multiview` | image-to-3d | One upload per side (image = front, image2 = left, image3 = back, image4 = right) → BiRefNet cut-out and crop per side → `Pixal3DMultiViewConditioning` (a fixed orbit rig; its field of view measured on the front crop by MoGe 2) → TRELLIS.2 stages on `pixal3d_multiview_int8_convrot` (5.58 GB, MIT) → PBR GLB + the single-view graph's 36-view turntable | no (GPU); /prompt only (every side, and front + back / front + right pruned); the MoGe FOV subgraph ran on CPU |

- **What the provider does**: `SLOT_RULES` gives the workflow its sides; each photo goes to the side
  `params.extra.views` names (in order when unnamed), and a side with no photo is cut out of the graph
  (`dropBranch` in `src/lib/comfy.ts`: its loader, cut-out and crop go, and the rig loses that input). The front is needed.
- **Field of view**: the official multi-view template keeps the rig's 20° (right for rendered turnaround sheets). Photos are
  wider as framed, so the graph measures it as the single-view Pixal3D template does: `MoGeInference` on the front crop →
  `MoGeGeometryToFOV` (horizontal, degrees) → the rig's `fov` (+0.66 GB, `moge_2_vitl_normal_fp16`). `fovX` fixes MoGe's lens
  instead (0 = estimate; 20 for a generated sheet). On the CPU server two runs of the subgraph (resolution level 9, one estimating,
  one given 20°) took 137 s in all, model load included: 40.0° estimated on a test image, 20° passed through.
- **Sides**: the rig's left is the object's own left (camera at +90° azimuth): facing the front, walk to your right to photograph it.
- **Licences**: the TRELLIS.2 graphs (single and multi-view) encode with DINOv3 ViT-L (`dino_v3_L_naf`), so their
  licence now names the DINOv3 License and its "Built with DINOv3" notice, like TripoSplat's.
- **Not open**: rigging. UniRig (MIT) has no ComfyUI pack verified against v0.41, so Rig & animate is Meshy on fal only.
  SAM 3D Objects has no open route either (the core SAM 3D nodes are body only).

### Genjutsu Character swap (o/genjutsu-original, 2026-10-27)

Two hand-built entries for Genjutsu's Character swap on MiniMax H3, and one for Remove object's person removal on the same
model (docs/research/openjutsu-6.md):

```bash
npm run build -- video-character-swap-h3 video-character-swap-h3-relay video-person-remove-h3-relay
node validate-workflows.mjs video-character-swap-h3 video-character-swap-h3-relay video-person-remove-h3-relay --shared
```

| id | capability | what | validated here |
|---|---|---|---|
| `video-character-swap-h3` | video-character-swap | Openjutsu's `swap.api.json` (Akatz Labs' H3 Character Swap graph at `0670e4f` with a `Video Slice` in front): the part (start + length, 5–15 s, longer continues window by window), quality as the unpatched pack's string (`"480"` / `"768"`), H3 reference tags in the prompt, who to swap (SAM 3.1 words, largest / leftmost / rightmost / index, or clicks as JSON points on H3's canvas), the anchor first frame as `image2` (absent: its loader and fit are deleted and the shot's `use_anchor` is off), the swap LoRA release (V1.5, V1, or none: the Turbo LoRA alone) | no: `missing_node_type` (the `h3_character_swap` nodes are not on this server; its 22 core nodes are in `object_info.subset.json`) |
| `video-character-swap-h3-relay` | video-character-swap | H3 Relay 2.0's character-swap example (akatz-ai/h3-relay at `e2a7665b`) with a `Video Slice`: the same part, quality, words, seed and who; no anchor | no: `missing_node_type` (`H3RelayAppendWindow`) |
| `video-person-remove-h3-relay` | remove-object | H3 Relay 2.0's Person Removal example with Akatz Labs' Person Remover V1 LoRA (`akatz-ai/MiniMax-H3-Person-Remover-LoRA` at `fe136b3`): SAM 3.1 marks the person you name in green, H3 rebuilds the background in 22-frame windows from a clean first frame (`image`, fitted to the video's size by an added `ImageScale`). Remove object's "H3 Person Removal" eraser fits the part to 24 fps on the 32-pixel grid, makes the clean frame with Qwen-Image-Edit and puts the sound back | no: `missing_node_type` (`H3RelayAppendWindow`) |

- **Node packs**: `h3_character_swap` (GPL-3.0) is copied out of `akatz-labs/h3-character-swap-tool` at
  `0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b` by `install-comfyui.sh` (`H3_PACK=0` skips it; it needs FFmpeg and FFprobe on
  PATH). H3 Relay (GPL-3.0) registers HTTP routes and patches H3's layout in memory when it loads, so it is opt-in:
  `H3_RELAY=1` clones it at `e2a7665b6eb8ea37a88c0de2c9c6b69a8f7c9220`. Neither pack is installed on the CPU server
  these graphs were built on, so both entries are recorded with `validated: false` and the missing node named.
- **Weights** (46.33 GB, pinned to Hugging Face revisions in `library.spec.mjs`): H3 Ref2VA int8, its video and audio VAEs and
  the NVFP4 Qwen3-VL text encoder (Comfy-Org/MiniMax-H3), lightx2v's FL2V Turbo 8-step LoRA, SAM 3.1, and Akatz Labs'
  Character Swap LoRA V1.5 (V1 optional). The provider downloads the two LoRAs before a run (`graphLoras`).
- **Licences, as information**: MiniMax H3 Community License (territory excludes the US, the EU, the UK and South Korea;
  over US$20M yearly revenue needs MiniMax's written authorization; show "MiniMax H3"), Meta's SAM License, Apache-2.0
  (Turbo LoRA), GPL-3.0 (both packs). The admin decides what runs (Settings → Models & licences).
- **Clicks**: the provider moves them into the frame the pack prepares (its `canvas_dimensions`: a 0.5 / 1.0 MP budget
  on the 32-pixel grid, the clip scaled to cover and the middle cropped) and sets SelectSubject to `index` 0, since
  `SAM3_Detect` returns the clicked mask first and the "person" detections after it. Person numbers (`index`) are SAM's
  detections in order of confidence, not left to right. A window and history the pack's `validate_settings` would
  refuse (history ≥ window) is brought below the window.
- **GPU**: tested by their authors on a 96 GB RTX PRO 6000 and on a 24 GB RTX 4090 with 128 GB RAM and offloading.
- **Comfy Developer Platform** (what Openjutsu deploys to): a deployment is not a plain ComfyUI server — it is driven by
  the v2 API (`@comfyorg/sdk`: upload, job, poll), not `/prompt` and `/history` — so Fuobe does not add a provider for it.
  Point `COMFYUI_URL` at a ComfyUI that has the packs installed instead.

## DBS soundtrack separation (DBS D1)

One hand-built graph splits a soundtrack into dialogue, music and effects (docs/research/dbs-separation-7.md §4.4, graph A):

```bash
npm run build -- separate-soundtrack-dbs
COMFYUI_URL=http://127.0.0.1:<port> COMFYUI_MODELS_DIR=<that ComfyUI>/models node validate-workflows.mjs separate-soundtrack-dbs --shared
```

| id | capability | what | validated here |
|---|---|---|---|
| `separate-soundtrack-dbs` | separate-audio | `LoadAudio` (audio, or a video's soundtrack) → `DBSLoader` (`separationModel`: DBS-BSRNN-DnR or DBS-TIGER-DnR) → `DBSSeparate` (`channels`: mono or each channel, `output_sample_rate` input) → stems `voice`, `music`, `effects` and `background` (the original minus the speech, `AudioMerge` subtract) as FLAC, plus the pack's JSON report | yes, on an isolated CPU worker with ComfyUI-DBS and the weights (the shared server does not have the pack); real CPU runs of 6–20 s clips there |

- **Node pack**: ComfyUI-DBS (MIT; vendored DBS code Apache-2.0 with MIT notices) pinned at
  `f656e53434b5485c148a2866fbd6ddc6b6152ed6` in `install-comfyui.sh`. The Comfy Registry flags its only version (0.1.0) with no
  public reason; the code was read at this commit. It needs only einops and safetensors, already installed.
- **Weights** (23 MB): `install-comfyui.sh` downloads `config.json` and `model.safetensors` of JusperLee/DBS-BSRNN-DnR and
  JusperLee/DBS-TIGER-DnR at pinned revisions into `models/dbs/<model>/` and checks them with `sha256sum -c` (`DBS_WEIGHTS=0`
  skips it). The manifest lists all four by their path under the folder (`requiredModels`: a CUDA host runs DBS-TIGER, so
  the Workflows page's install commands fetch both models), which is what `GET /models/dbs` answers, so the Workflows page
  knows when they are there.
- **Host pick**: the provider uses DBS-TIGER when `GET /system_stats` says the first device is `cuda` and DBS-BSRNN otherwise
  (about 3x faster on a CPU: 0.27x real time against 0.09x on a 4-CPU host), unless the run picks one; the other model when
  `GET /models/dbs` shows the pick isn't on disk, and a model asked for that isn't there is refused in words before the
  job is queued. `each channel` for stereo stems. ComfyUI saves audio as mono or stereo only (a 5.1 waveform is written as
  scrambled stereo three times as long), so a file with more than 2 channels is split in `mono` and its background is the
  music and effects stems added up (the provider rewires node 4 to `AudioMerge` add).

## Fly path (N7-5)

One hand-built graph films a still along a camera path keyframed in Cinema's 3D scene, on core nodes only
(docs/research/new-models-7.md §3.6):

```bash
npm run build -- wan21-i2v-uni3c-path
node validate-workflows.mjs wan21-i2v-uni3c-path --shared
```

| id | capability | what | validated here |
|---|---|---|---|
| `wan21-i2v-uni3c-path` | camera-path | `UNETLoader` (Wan 2.1 I2V 14B 720P fp8; `checkpoint` swaps in the 480P fp8 file) → `ModelSamplingSD3` (`shift`) → `ModelPatchLoader` (Uni3C) + `WanUni3CControlnetApply` (`strength`, 0–1) on the browser's render of the path (`video`: `LoadVideo` → `GetVideoComponents`; the node pads or cuts it to the latent's frames and centre-crops it to the size) → umt5 / CLIP vision H / Wan VAE → `WanImageToVideo` (the still as `image`, 81 frames) → `KSampler` (`steps` 30, `cfg` 5, uni_pc; a guess to tune on a GPU) → `VAEDecode` → `CreateVideo` (16 fps) → `SaveVideo` | `/prompt` only (no GPU here); a model-free `LoadVideo` run read the browser's render as 81 frames |

- **Weights**, pinned in `library.spec.mjs`: Kijai/WanVideo_comfy `Wan21_Uni3C_controlnet_fp16.safetensors` @ `8260d429`
  (1,997,314,376 B, in `models/model_patches`) and Comfy-Org/Wan-2.1 `wan2.1_i2v_720p_14B_fp8_scaled.safetensors` @
  `123acf1c` (16,401,356,938 B); optional: Kijai/WanVideo_comfy_fp8_scaled's 480P fp8 file @ `4d02bd37` (16,643,349,018 B).
  The 480P Q8 GGUF Fuobe pins for InfiniteTalk can't load here: core `UNETLoader` reads no GGUF (that needs city96's
  ComfyUI-GGUF pack). Loading Kijai's file through core `ModelPatchLoader` is inferred from its header keys, not run.
- **The render** comes from the browser (`src/components/cinema/scene-engine.ts` `recordPath`): 81 frames at 16 fps, black
  where nothing was seen, VP8 in WebM at exact frame times. Its hole mask is made only when asked for (core's Uni3C node
  has no mask input; WorldCast, N7-9, will ask).
- **Licences, as information**: Apache-2.0 (Wan 2.1; Uni3C, whose Kijai repack carries no licence field).
- **GPU**: Uni3C's own figures are 46–51 GB with offload; Fuobe's older 24 GB note is unverified.

## MOSS-Image (N7-1)

One hand-built graph on core nodes (MOSS-Image is native in the pinned ComfyUI; docs/research/new-models-7.md §4.6):

```bash
npm run build -- moss-image-t2i
node validate-workflows.mjs moss-image-t2i --shared
```

| id | capability | what | validated here |
|---|---|---|---|
| `moss-image-t2i` | t2i | `UNETLoader` (SFT int8; `unet`) → `CLIPLoader` qwen3.5-9b w4a8, type `moss_image` → `VAELoader` FLUX.2 small → `CLIPTextEncode` ×2 (the prompt: plain words or a compiled layout, verbatim) → `EmptyFlux2LatentImage` (`width` / `height`: the layout's canvas) → `SkipLayerGuidanceDiTSimple` (layer 22, first half) → `KSampler` (`steps`, `cfg`, `sampler`, `scheduler`) → `VAEDecode` → `SaveImage` | `/prompt` only (CPU, zero-byte model stand-ins): no render here |

- **Weights** (13 GB): Comfy-Org/MOSS-Image at `530a4c94f92c35ef6818b1b035a983fe9dcf5f54` (diffusion model 5.41 GB, text encoder
  7.34 GB, small VAE 0.25 GB), and, for the Fast setting only, Spectrallic's SFT with the 8-step DMD LoRA merged in (5.41 GB,
  `optionalModels`). All Apache-2.0. The Workflows page's install commands fetch them; nothing is downloaded at build time.
- **Settings**: Standard is the Comfy template's (25 steps, CFG 2.5, er_sde / simple), Best OpenMOSS's guide (50, 3, euler),
  Fast the DMD file at 8 steps and CFG 1 (`ModelOptions.controls[].sets` on `oss-moss-image` writes them).
- **Canvas**: a size the request names (`params.extra.width` / `height`, a layout's canvas) is fitted to the 16-pixel grid
  and 2048 px a side with its shape kept (`fitCanvas` in `src/lib/comfy.ts`), as fal's `image_size` is, so both engines
  render one size (2560 × 1000 becomes 2048 × 800 on both).
- **Licences, as information**: all Apache-2.0, the optional Fast file's too; the small decoder is byte-identical to BFL's
  Apache-2.0 FLUX.2-small-decoder (the manifest's `license` says so, and Settings → Models & licences shows it).
- **Not installed on purpose**: LinXce's Comfyui-Moss-LayoutPrompt (its `MOSSImageLayoutPrompt` id collides with core's) and
  OpenMOSS's loader pack (core's native path is what its own README recommends). Fuobe compiles layouts itself
  (`src/lib/layout-prompt.ts`).
- **GPU**: no official VRAM figure (16 GB is a guess with ComfyUI's offloading). comfy-kitchen's int8 / w4a8 kernels need a
  PyTorch built for CUDA 13 (cu130); otherwise `comfy/quant_ops.py` turns them off with a warning.

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
