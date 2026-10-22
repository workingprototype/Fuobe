# ComfyUI workflow library (Fuobe open-source engine)

_Generated 2026-10-16 by the `scripts/comfy` pipeline. Machine-readable source of truth: `workflows/comfyui/manifest.json`._

## 1. Summary

* **51 API-format workflows** in `workflows/comfyui/<id>.json`, all **validated** (`POST /prompt` accepted with no `node_errors`) against a real ComfyUI server: **51/51 validated**.
* Built against **ComfyUI 0.41.0 (commit `fc04da91b2ab12f99e4716371a7e4f98ac982597`, v0.41.0-7)**, frontend **1.55.17**, **comfyui-workflow-templates 0.11.86** (json 0.1.112, media-video 0.3.101, media-image 0.3.160, media-other 0.3.229).
* 45 come from **official templates** (converted to API format by the real frontend: `app.loadGraphData()` → `app.graphToPrompt()`), 2 from **custom-node example workflows**, 4 are **hand-built** from `/object_info` definitions. Modifications are listed in each entry's `notes` and flagged `(modified, see notes)` in `source`.
* Everything except 5 workflows runs on **core ComfyUI nodes only** — in 2026 core ComfyUI natively covers InfiniteTalk, SeedVR2, BiRefNet, RIFE/FILM, Wan Animate 2, LTX-2.x, so custom packs are only needed for: ReActor face swap, RMBG, MMAudio, the WanVideoWrapper InfiniteTalk variant, and the RIFE-VFI variant (plus VHS/KJNodes helpers).
* 86 distinct model files, **740 GB** if you download everything. A sensible starter set (Z-Image Turbo, Qwen-Image-Edit 2509, Wan 2.2 5B, Wan 2.2 14B I2V lightx2v, BiRefNet, RealESRGAN, RIFE, ACE-Step) is ≈ 112 GB.
* **2026-10-16 update: +20 workflows** from [`comfyui-oss-2.md`](comfyui-oss-2.md) (TTS / dialogue / voice change, video extend / reframe / relight, draw-to-video, multi-shot concat, storyboard, video alpha + depth, palette lock): **all 20 validated** on the same ComfyUI commit with three more packs. The manifest now has 73 entries (incl. the 2 self-test graphs), **73/73 validated**. Details, new binding keys and new capability values: [section 10](#10-comfyui-oss-2-additions-2026-10-16).
* **2026-10-22 update (round 4): +17 workflows** from [`comfyui-oss-4.md`](comfyui-oss-4.md) (OCR lines for Layers, object removal / swap / insert on Wan 2.1 VACE and VOID, Ken Burns, audio loop and join, pro codecs, SDR to HDR, EXR, still to clip, logo end card, whole-scene mesh, subject splat, reference-video brief), all hand-built and **17/17 validated**; the eight model-free ones also ran for real on CPU. With round 3's 42 the manifest has **132 entries, 132/132 validated**. `wan21-vace-14b-ref2v` no longer uses the non-commercial CausVid LoRA. Details: [section 11](#11-comfyui-oss-4-additions-2026-10-22).
* Validation used zero-byte placeholder model files and tiny uploaded fixtures; **no model was executed** (CPU-only box, no weights). Validation proves graph structure, node/input names, types, ranges, combo values and file references — not output quality.

## 2. The library

`source`: _template_ = official ComfyUI template name; _example_ = custom-node pack example workflow; _(mod)_ = modified (see `notes`). `outputs` = `node:kind`. Sizes are total download size of the workflow's `models`. VRAM = recommended GPU memory (ComfyUI offloads to system RAM below that, slower).

| id | capability | source | validated | bindings | outputs | models GB | VRAM |
|---|---|---|---|---|---|---|---|
| `flux1-dev-t2i` | t2i | template `flux_dev_full_text_to_image` (mod) | **yes** | prompt, width, height, seed, steps, guidance | 9:image | 34.2 | 24 |
| `flux1-krea-dev-t2i` | t2i | template `flux1_krea_dev` (mod) | **yes** | prompt, width, height, seed, steps, guidance | 9:image | 22.3 | 16 |
| `flux1-schnell-t2i` | t2i | template `flux_schnell_full_text_to_image` | **yes** | prompt, width, height, seed, steps | 9:image | 34.2 | 24 |
| `flux2-dev-t2i` | t2i | template `image_flux2_text_to_image` | **yes** | prompt, width, height, seed, steps, guidance | 9:image | 71.3 | 32 |
| `flux2-dev-t2i-turbo` | t2i | template `image_flux2_text_to_image` | **yes** | prompt, width, height, seed, steps, guidance | 9:image | 74.0 | 32 |
| `flux2-dev-edit` | edit | template `image_flux2` | **yes** | prompt, image, seed, steps, guidance | 9:image | 71.3 | 32 |
| `flux2-dev-multiref` | edit | template `image_flux2` (mod) | **yes** | prompt, image, image2, image3, seed, steps, guidance | 9:image | 71.3 | 32 |
| `qwen-image-2512-t2i` | t2i | template `image_qwen_Image_2512` | **yes** | prompt, negativePrompt, width, height, seed, steps, cfg, shift | 60:image | 30.1 | 24 |
| `qwen-image-2512-t2i-lightning` | t2i | template `image_qwen_Image_2512` | **yes** | prompt, negativePrompt, width, height, seed, steps, cfg, shift | 60:image | 31.8 | 24 |
| `z-image-turbo-t2i` | t2i | template `image_z_image_turbo` | **yes** | prompt, width, height, seed, steps, shift | 9:image | 20.7 | 12 |
| `hidream-i1-dev-t2i` | t2i | template `hidream_i1_dev` | **yes** | prompt, negativePrompt, width, height, seed, steps, cfg, shift | 9:image | 33.3 | 24 |
| `sdxl-t2i` | t2i | template `image_sdxl_simple` (mod) | **yes** | prompt, negativePrompt, width, height, seed, steps, cfg | 7:image | 6.9 | 8 |
| `qwen-image-edit-2509` | edit | template `image_qwen_image_edit_2509` | **yes** | prompt, negativePrompt, image, seed, steps, cfg | 469:image | 30.9 | 24 |
| `qwen-image-edit-2511` | edit | template `image_qwen_image_edit_2511` (mod) | **yes** | prompt, negativePrompt, image, seed, steps, cfg | 9:image | 30.2 | 24 |
| `qwen-image-edit-2511-multi` | edit | template `image_qwen_image_edit_2511` (mod) | **yes** | prompt, negativePrompt, image, image2, image3, seed, steps, cfg | 9:image | 30.2 | 24 |
| `flux1-kontext-dev-edit` | edit | template `flux_kontext_dev_basic` | **yes** | prompt, image, seed, steps, guidance | 136:image | 17.7 | 16 |
| `flux1-fill-inpaint` | inpaint | template `flux_fill_inpaint_example` (mod) | **yes** | prompt, image, mask, seed, steps, guidance | 9:image | 34.2 | 24 |
| `flux1-fill-outpaint` | outpaint | template `flux_fill_outpaint_example` | **yes** | prompt, image, padLeft, padTop, padRight, padBottom, seed, steps, guidance | 9:image | 34.2 | 24 |
| `upscale-image-esrgan` | upscale-image | hand-built | **yes** | image, upscaleModel, scale | 5:image | 0.1 | 4 |
| `upscale-image-seedvr2` | upscale-image | template `utility_seedvr2_7b_int8_upscale_image` | **yes** | image, scale, seed | 9:image | 8.8 | 16 |
| `bg-remove-birefnet` | bg-remove | template `utility_birefnet_remove_background` (mod) | **yes** | image | 1401:image | 0.4 | 4 |
| `bg-remove-rmbg` | bg-remove | hand-built +RMBG | **yes** | image | 3:image | 0.0 | 4 |
| `face-swap-reactor` | face-swap | hand-built +ReActor | **yes** | image, image2 | 4:image | 0.9 | 4 |
| `wan22-t2v-14b` | t2v | template `video_wan2_2_14B_t2v` (mod) | **yes** | prompt, negativePrompt, width, height, frames, fps, seed, steps, cfg, shift | 80:video | 35.6 | 24 |
| `wan22-t2v-14b-lightx2v` | t2v | template `video_wan2_2_14B_t2v` (mod) | **yes** | prompt, negativePrompt, width, height, frames, fps, seed, steps, cfg, shift | 80:video | 38.0 | 24 |
| `wan22-i2v-14b` | i2v | template `video_wan2_2_14B_i2v` (mod) | **yes** | prompt, negativePrompt, image, width, height, frames, fps, seed, steps, cfg, shift | 108:video | 35.6 | 24 |
| `wan22-i2v-14b-lightx2v` | i2v | template `video_wan2_2_14B_i2v` (mod) | **yes** | prompt, negativePrompt, image, width, height, frames, fps, seed, steps, cfg, shift | 108:video | 38.0 | 24 |
| `wan22-i2v-14b-lora` | vfx | template `video_wan2_2_14B_i2v` (mod) | **yes** | prompt, negativePrompt, image, width, height, frames, fps, seed, steps, cfg, shift, loraHigh, loraLow, loraStrength | 108:video | 35.6 | 24 |
| `wan22-ti2v-5b` | t2v | template `video_wan2_2_5B_ti2v` | **yes** | prompt, negativePrompt, width, height, frames, fps, seed, steps, cfg, shift | 58:video | 18.2 | 12 |
| `wan22-ti2v-5b-i2v` | i2v | template `video_wan2_2_5B_ti2v` (mod) | **yes** | prompt, negativePrompt, image, width, height, frames, fps, seed, steps, cfg, shift | 58:video | 18.2 | 12 |
| `wan22-flf2v-14b` | flf2v | template `video_wan2_2_14B_flf2v` | **yes** | prompt, negativePrompt, image, endImage, width, height, frames, fps, seed, steps, cfg, shift | 83:video | 35.6 | 24 |
| `wan22-fun-camera-14b` | camera-motion | template `video_wan2_2_14B_fun_camera` (mod) | **yes** | prompt, negativePrompt, image, cameraMotion, width, height, frames, fps, seed, steps, cfg, shift | 106:video | 37.6 | 24 |
| `wan22-fun-control-14b` | motion-transfer | template `video_wan2_2_14B_fun_control` (mod) | **yes** | prompt, negativePrompt, image, video, width, height, frames, fps, seed, steps, cfg, shift | 98:video | 35.6 | 24 |
| `wan21-vace-14b-ref2v` | ref2v | template `video_wan_vace_14B_ref2v` | **yes** | prompt, negativePrompt, image, width, height, frames, fps, seed, steps, cfg, shift | 69:video | 46.6 | 32 |
| `wan22-s2v-14b` | lipsync | template `video_wan2_2_14B_s2v` | **yes** | prompt, negativePrompt, image, audio, width, height, seed, steps, cfg | 113:video | 25.2 | 24 |
| `wan-animate2` | motion-transfer | template `video_wan_animate2` (mod) | **yes** | prompt, negativePrompt, image, video, width, height, seed, steps | 246:video | 25.6 | 24 |
| `hunyuan15-t2v-720p` | t2v | template `video_hunyuan_video_1.5_720p_t2v` | **yes** | prompt, negativePrompt, width, height, frames, fps, seed, steps, cfg, shift | 102:video | 29.0 | 24 |
| `hunyuan15-i2v-720p` | i2v | template `video_hunyuan_video_1.5_720p_i2v` | **yes** | prompt, negativePrompt, image, width, height, frames, fps, seed, steps, cfg, shift | 102:video | 29.8 | 24 |
| `ltx2-t2v` | t2v | template `video_ltx2_t2v` | **yes** | prompt, negativePrompt, width, height, frames, fps, seed, steps, cfg | 75:video | 45.2 | 32 |
| `ltx2-i2v` | i2v | template `video_ltx2_i2v` | **yes** | prompt, negativePrompt, image, width, height, frames, fps, seed, steps, cfg | 75:video | 45.2 | 32 |
| `ltx25-t2v` | t2v | template `video_ltx2_5_t2v` (mod) | **yes** | prompt, negativePrompt, width, height, frames, fps, seed | 75:video | 39.7 | 24 |
| `ltx25-i2v` | i2v | template `video_ltx2_5_i2v` (mod) | **yes** | prompt, negativePrompt, image, width, height, frames, fps, seed | 75:video | 39.7 | 24 |
| `infinitetalk-native` | lipsync | template `video_wan2_1_infinitetalk` (mod) | **yes** | prompt, image, audio, width, height, seed, steps | 141:video | 29.7 | 24 |
| `infinitetalk-wanwrapper` | lipsync | example `ComfyUI-WanVideoWrapper` (mod) +KJNodes/VideoHelperSuite/WanVideoWrapper | **yes** | prompt, negativePrompt, image, audio, width, height, frames, seed, steps | 131:video | 34.4 | 16 |
| `upscale-video-seedvr2` | upscale-video | template `utility_seedvr2_3b_int8_upscale_video` | **yes** | video, scale, seed | 76:video | 4.0 | 16 |
| `upscale-video-esrgan` | upscale-video | template `utility-gan_upscaler` | **yes** | video, upscaleModel | 12:video | 0.1 | 4 |
| `interpolate-film` | interpolate | template `utility_video_frame_interpolation` | **yes** | video, multiplier | 7:video | 0.1 | 4 |
| `interpolate-rife` | interpolate | template `utility_video_frame_interpolation` (mod) | **yes** | video, multiplier | 7:video | 0.0 | 2 |
| `interpolate-rife-vfi` | interpolate | hand-built +Frame-Interpolation/VideoHelperSuite | **yes** | video, multiplier | 6:video | 0.0 | 2 |
| `music-ace-step-15` | music | template `audio_ace_step_1_5_checkpoint` (mod) | **yes** | tags, lyrics, duration, bpm, seed, steps | 106:audio | 10.0 | 8 |
| `v2a-mmaudio` | v2a | example `ComfyUI-MMAudio` (mod) +MMAudio/VideoHelperSuite | **yes** | video, prompt, negativePrompt, seed, steps, cfg | 97:video, 1701:audio | 5.1 | 8 |

### Variants and why they exist

* **Lightning / lightx2v / Turbo variants** (`*-lightx2v`, `*-lightning`, `flux2-dev-t2i-turbo`) are the official templates' own "Enable 4-step LoRA" switch paths, exported with the switch forced on. Base variants have the switch forced off, so they do not reference the LoRA files at all.
* `wan22-i2v-14b-lora` = official Wan 2.2 14B I2V with `LoraLoaderModelOnly` inserted after **both** the high-noise (node `1001`) and low-noise (node `1002`) `UNETLoader` (bindings `loraHigh`, `loraLow`, `loraStrength`). Default LoRA names are placeholders; the app must pass real file names from `models/loras`.
* `qwen-image-edit-2511` is single-image (template's 2nd reference removed); `qwen-image-edit-2511-multi` takes 3 images. `flux2-dev-edit` = 1 reference; `flux2-dev-multiref` = 3 chained `ReferenceLatent`s. All images bound in a workflow are required.
* `infinitetalk-native` (core nodes, ≈6 s max) vs `infinitetalk-wanwrapper` (kijai WanVideoWrapper, generates until the audio ends, up to `frames` = 500 @25 fps).
* `interpolate-rife` / `interpolate-film` (core `FrameInterpolate`) vs `interpolate-rife-vfi` (Fannovel16 pack).
* `bg-remove-birefnet` (core, MIT model) vs `bg-remove-rmbg` (1038lab pack, BEN2 default; RMBG-2.0 option is CC BY-NC).

## 3. Bindings — how app code drives a workflow

Each manifest entry has `bindings: { key: [{node, input}, ...] }`. To run a workflow: load `<file>`, write the value of every key you use into **every** listed `node.inputs[input]`, `POST /prompt {prompt, client_id}`. All targets are literal widget inputs (the build fails if a binding points at a link). Keys you do not set keep the workflow's value (`defaults` holds the numeric ones).

| key | value | notes |
|---|---|---|
| `prompt`, `negativePrompt` | string | some workflows list 2+ text nodes (e.g. FLUX schnell CLIP-L + T5, InfiniteTalk's two passes) — write all of them |
| `image`, `image2`, `image3`, `image4`, `endImage`, `mask` | uploaded file name | `POST /upload/image` (multipart field `image`, `overwrite=true`) → use `name`, or `subfolder/name` when `subfolder` is non-empty. `face-swap-reactor`: `image` = target, `image2` = source face. `mask` (`flux1-fill-inpaint`): separate PNG, same size as `image`, **white = repaint** (read from the red channel) |
| `video` | uploaded file name | same upload endpoint (it accepts any file type); used by `LoadVideo` (`file`) and `VHS_LoadVideo` (`video`) |
| `audio` | uploaded file name | `LoadAudio`; wav/mp3/flac/m4a ok |
| `width`, `height` | int | respect `limits.dimensionMultiple` (16 for Wan/Hunyuan/FLUX, 32 Wan 5B, **64 for LTX** because LTX renders at half size then 2x-upscales) |
| `frames` | int | must be `defaults.frameStep * n + 1` (Wan/Hunyuan 4n+1, LTX 8n+1); ≤ `limits.maxFrames`. For `infinitetalk-wanwrapper` it is a max cap (output length follows the audio) |
| `fps` | number | playback/encode fps (Wan 14B is trained at 16, Wan 5B/Hunyuan/LTX at 24-25). LTX lists all places that need it |
| `seed` | int | every sampler is listed; use 0..2^53-1 (JS safe) |
| `steps`, `cfg`, `guidance`, `shift`, `denoise` | number | usually point at a `PrimitiveInt/Float` feeding several samplers |
| `loraHigh`, `loraLow`, `lora`, `loraStrength` | file name / float | LoRA files must exist in `models/loras` |
| `upscaleModel` | file name | any spandrel model in `models/upscale_models` |
| `scale` | number | ESRGAN: resize factor applied **after** the model (net = model × scale); SeedVR2: output multiplier |
| `duration`, `tags`, `lyrics` | seconds / string | ACE-Step (`duration` is written to both the text encoder and the latent) |
| `filenamePrefix` | string | (library extension) every output node's `filename_prefix`; default `fuobe/<id>` → files land in `output/fuobe/`. Set e.g. `fuobe/<jobId>` for per-job files |
| `padLeft`, `padTop`, `padRight`, `padBottom` | int px, multiple of 8 | (extension) `flux1-fill-outpaint` |
| `cameraMotion` | enum | (extension) `wan22-fun-camera-14b`: `Static`, `Pan Up`, `Pan Down`, `Pan Left`, `Pan Right`, `Zoom In`, `Zoom Out`, `Anti Clockwise (ACW)`, `ClockWise (CW)` |
| `multiplier` | int 2-16 | (extension) frame interpolation factor; output fps = source fps × multiplier |
| `bpm` | int | (extension) ACE-Step tempo |
| `audio2` | uploaded file name | (extension, oss-2) second `LoadAudio`: dialogue speaker B, voice-change target voice |
| `video2`, `video3`, `video4` | uploaded file name | (extension, oss-2) shots 2..4 of `video-concat-*` |
| `language` | enum string | (extension, oss-2) Chatterbox Multilingual, `"Name (code)"`, e.g. `"German (de)"` (23 values, see section 10) |
| `exaggeration`, `temperature` | float | (extension, oss-2) Chatterbox emotion exaggeration (0.25-2, 0.5) / sampling temperature (0.05-2, 0.8) |
| `contextFrames` | int, multiple of 4 | (extension, oss-2) `video-extend-wan22-fun-vace`: source tail frames used as context (16) |
| `tracks` | JSON string | (extension, oss-2) `draw-to-video-wan-move` motion paths: `[[{"x":px,"y":px}, …one per output frame], …]` |
| `motionStrength` | float | (extension, oss-2) Wan-Move track conditioning strength (1.0) |
| `strength` | float 0-10 | (extension, oss-2) `ColorTransfer` strength (0.8) |

Other manifest fields: `defaults` (numeric widget values of the bound inputs + `frameStep`), `limits` (`maxWidth`, `maxHeight`, `maxFrames`, `dimensionMultiple`, `maxDurationSec`, `padMultiple`, `maxMultiplier`), `models[]` (`file`, `folder` under `models/`, `url`, `sizeGb`, optional `gated: true` = Hugging Face licence click-through, download needs an HF token), `customNodes[]`, `autoDownloads[]` (weights the node fetches itself on first run), `validationError` (only when validation failed), `buildWarnings` (only if the build found problems; none currently). Top level also carries `comfyuiVersion`, `workflowTemplatesVersion`, `frontendVersion`.

## 4. Reading results (verified on this server)

`GET /history/<prompt_id>` → `{[prompt_id]: {outputs: {[nodeId]: ...}, status: {status_str, completed}}}`. Download each file with `GET /view?filename=<filename>&subfolder=<subfolder>&type=<type>`. **Always use the returned `filename`** — naming differs per node:

| output node class | key in `outputs[node]` | example entry |
|---|---|---|
| `SaveImage` | `images[]` | `{"filename":"flux1-dev-t2i_00001_.png","subfolder":"fuobe","type":"output"}` (note the trailing `_`) |
| `SaveImageAdvanced` (qwen-image-edit-2509) | `images[]` | `{"filename":"qwen-image-edit-2509_00001.png","subfolder":"fuobe","type":"output"}` (no trailing `_`) |
| `SaveVideo` (all native video workflows) | `images[]` **plus** `animated: [true]` | `{"filename":"wan22-i2v-14b_00001_.mp4","subfolder":"fuobe","type":"output","metadata":{"kind":"video","width":…,"fps":…,"frame_count":…}}` |
| `VHS_VideoCombine` (`infinitetalk-wanwrapper`, `interpolate-rife-vfi`, `v2a-mmaudio`) | **`gifs[]`** | `{"filename":"v2a-mmaudio_00001-audio.mp4","subfolder":"fuobe","type":"output","format":"video/h264-mp4","frame_rate":…,"fullpath":…}` — with audio the file name ends in `-audio.mp4`; VHS also writes a silent `.mp4` and a `.png` metadata frame next to it |
| `SaveAudio` / `SaveAudioAdvanced` | `audio[]` | `{"filename":"music-ace-step-15_00001.mp3","subfolder":"fuobe","type":"output"}` |
| `SaveAudioMP3` (TTS / dialogue / voice change) | `audio[]` | `.mp3` (V0) |
| `SaveWEBM` (`video-bg-remove-*`) | **`images[]`** plus `animated: [true]` | `.webm` (VP9 with alpha) — the key says *images*; classify by the `.webm` extension or the manifest `outputs[].kind` (`video`) |

The manifest `outputs[]` lists the node ids to read (other nodes produce nothing: preview/compare outputs of the templates were removed). Progress: open `ws://<host>/ws?clientId=<client_id>` (same `client_id` as in `/prompt`) for `progress`, `executing`, `executed`, `execution_success`, `execution_error` messages. Cancel: `POST /interrupt {"prompt_id": …}`, `POST /queue {"delete": [prompt_id]}`. Model presence: `GET /models/<folder>` (folders used by the library: `diffusion_models`, `checkpoints`, `text_encoders`, `vae`, `loras`, `clip_vision`, `upscale_models`, `audio_encoders`, `model_patches`, `latent_upscale_models`, `background_removal`, `frame_interpolation`, `mmaudio`, `insightface`, `facerestore_models`, `geometry_estimation`).

## 5. Per-workflow quirks worth knowing

* **Wan 2.2 14B (t2v/i2v/flf2v/camera/control)**: two experts; the high→low switch step is fixed (10 of 20, or 2 of 4 for lightx2v) and not bound — keep `steps` near the default or adjust the split primitive in the JSON. The template computed `length = duration*fps+1`; we expose `frames` directly. Negative prompts are the official Chinese ones (they work better than English for Wan).
* **Wan 2.2 Fun Control** gets a native `Canny` node (1601) so a raw driving video works; feed ≈16 fps clips. **Fun Camera** default pose changed from `Static` to `Zoom In`.
* **Wan 2.2 S2V** is fixed-length (3 × 77 frames @16 fps ≈ 14 s, via 2 "extend" subgraphs). **InfiniteTalk native** is ≈ 6 s (2 × 81 frames @25 fps). Trim audio accordingly, or use `infinitetalk-wanwrapper`.
* **Wan Animate 2**: whole driving video is processed in 81-frame fragments with native loop nodes; output keeps the driving video's fps and audio. `width/height` = processing size (portrait 482×854 default).
* **LTX-2 / LTX-2.5** generate audio together with video (the mp4 has sound). `width/height` are the final size (multiples of 64), `frames` 8n+1. LTX-2.5 weights are in the **gated** `Lightricks/LTX-2.5` repo (accept licence + HF token); the template's optional Gemma prompt-enhancer is disabled.
* **FLUX.1 dev/Krea**: a `FluxGuidance` node (1001) was inserted so `guidance` is bindable; no negative prompt (cfg 1). **FLUX.2 dev** needs ~64 GB system RAM to offload its 35 GB text encoder on a 24 GB card.
* **Qwen-Image-Edit 2509** keeps the template default Lightning LoRA ON (4 steps); **2511** keeps it OFF (40 steps).
* **ACE-Step 1.5**: output changed to MP3 V0; defaults changed to 60 s / 120 bpm. `tags` = style, `lyrics` with `[verse]`/`[chorus]` markers (`[Instrumental]` for none).
* **MMAudio**: two outputs — the source video muxed with the generated track (`gifs[]`) and the FLAC (`audio[]`); duration follows the video.
* **ReActor**: needs `insightface` (pip wheel 2.1 installs on Python 3.13); first run downloads `buffalo_l` + `retinaface_resnet50`; NSFW filter on by default; inswapper is non-commercial.
* Default `image`/`video`/`audio` values inside the JSON files are the templates' example asset names — they do not exist on a fresh server, so the app must always bind every media key (the build enforces that every Load* node is bound).

## 6. Models

| file | folder | GB | used by |
|---|---|---|---|
| [`wav2vec2-chinese-base_fp16.safetensors`](https://huggingface.co/Kijai/wav2vec2_safetensors/resolve/main/wav2vec2-chinese-base_fp16.safetensors) | audio_encoders | 0.19 | infinitetalk-native |
| [`wav2vec2_large_english_fp16.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/audio_encoders/wav2vec2_large_english_fp16.safetensors) | audio_encoders | 0.63 | wan22-s2v-14b |
| [`birefnet.safetensors`](https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors) | background_removal | 0.44 | bg-remove-birefnet |
| [`ace_step_1.5_turbo_aio.safetensors`](https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/checkpoints/ace_step_1.5_turbo_aio.safetensors) | checkpoints | 10.03 | music-ace-step-15 |
| [`ltx-2-19b-dev-fp8.safetensors`](https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-dev-fp8.safetensors) | checkpoints | 27.08 | ltx2-t2v, ltx2-i2v |
| [`sd_xl_base_1.0.safetensors`](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors?download=true) | checkpoints | 6.94 | sdxl-t2i |
| [`clip_vision_h.safetensors`](https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/clip_vision/clip_vision_h.safetensors) | clip_vision | 1.26 | wan-animate2, infinitetalk-wanwrapper |
| [`sigclip_vision_patch14_384.safetensors`](https://huggingface.co/Comfy-Org/sigclip_vision_384/resolve/main/sigclip_vision_patch14_384.safetensors) | clip_vision | 0.86 | hunyuan15-i2v-720p |
| [`flux1-dev-kontext_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/flux1-kontext-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors) | diffusion_models | 11.9 | flux1-kontext-dev-edit |
| [`flux1-dev.safetensors`](https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev.safetensors) | diffusion_models | 23.8 | flux1-dev-t2i |
| [`flux1-fill-dev.safetensors`](https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/split_files/diffusion_models/flux1-fill-dev.safetensors) | diffusion_models | 23.8 | flux1-fill-inpaint, flux1-fill-outpaint |
| [`flux1-krea-dev_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/FLUX.1-Krea-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-krea-dev_fp8_scaled.safetensors) | diffusion_models | 11.9 | flux1-krea-dev-t2i |
| [`flux1-schnell.safetensors`](https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell.safetensors) | diffusion_models | 23.78 | flux1-schnell-t2i |
| [`flux2_dev_fp8mixed.safetensors`](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/diffusion_models/flux2_dev_fp8mixed.safetensors) | diffusion_models | 35.46 | flux2-dev-t2i, flux2-dev-t2i-turbo, flux2-dev-edit (+1) |
| [`hidream_i1_dev_fp8.safetensors`](https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/diffusion_models/hidream_i1_dev_fp8.safetensors) | diffusion_models | 17.11 | hidream-i1-dev-t2i |
| [`hunyuanvideo1.5_720p_i2v_fp16.safetensors`](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/hunyuanvideo1.5_720p_i2v_fp16.safetensors) | diffusion_models | 16.65 | hunyuan15-i2v-720p |
| [`hunyuanvideo1.5_720p_t2v_fp16.safetensors`](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/hunyuanvideo1.5_720p_t2v_fp16.safetensors) | diffusion_models | 16.65 | hunyuan15-t2v-720p |
| [`ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors) (gated) | diffusion_models | 21.5 | ltx25-t2v, ltx25-i2v |
| [`qwen_image_2512_fp8_e4m3fn.safetensors`](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors) | diffusion_models | 20.43 | qwen-image-2512-t2i, qwen-image-2512-t2i-lightning |
| [`qwen_image_edit_2509_fp8_e4m3fn.safetensors`](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors) | diffusion_models | 20.43 | qwen-image-edit-2509 |
| [`qwen_image_edit_2511_fp8mixed.safetensors`](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors) | diffusion_models | 20.53 | qwen-image-edit-2511, qwen-image-edit-2511-multi |
| [`seedvr2_3b_int8_convrot.safetensors`](https://huggingface.co/Comfy-Org/SeedVR2/resolve/main/diffusion_models/seedvr2_3b_int8_convrot.safetensors) | diffusion_models | 3.46 | upscale-video-seedvr2 |
| [`seedvr2_7b_int8_convrot.safetensors`](https://huggingface.co/Comfy-Org/SeedVR2/resolve/main/diffusion_models/seedvr2_7b_int8_convrot.safetensors) | diffusion_models | 8.33 | upscale-image-seedvr2 |
| [`wan2.1-i2v-14b-480p-Q8_0.gguf`](https://huggingface.co/city96/Wan2.1-I2V-14B-480P-gguf/resolve/main/wan2.1-i2v-14b-480p-Q8_0.gguf) | diffusion_models | 18.14 | infinitetalk-wanwrapper |
| [`wan2.1_vace_14B_fp16.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_vace_14B_fp16.safetensors) | diffusion_models | 34.68 | wan21-vace-14b-ref2v |
| [`wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors) | diffusion_models | 15.3 | wan22-fun-camera-14b |
| [`wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors) | diffusion_models | 15.3 | wan22-fun-camera-14b |
| [`wan2.2_fun_control_high_noise_14B_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_control_high_noise_14B_fp8_scaled.safetensors) | diffusion_models | 14.3 | wan22-fun-control-14b |
| [`wan2.2_fun_control_low_noise_14B_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_control_low_noise_14B_fp8_scaled.safetensors) | diffusion_models | 14.3 | wan22-fun-control-14b |
| [`wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors) | diffusion_models | 14.29 | wan22-i2v-14b, wan22-i2v-14b-lightx2v, wan22-i2v-14b-lora (+1) |
| [`wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors) | diffusion_models | 14.29 | wan22-i2v-14b, wan22-i2v-14b-lightx2v, wan22-i2v-14b-lora (+1) |
| [`wan2.2_s2v_14B_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_s2v_14B_fp8_scaled.safetensors) | diffusion_models | 16.39 | wan22-s2v-14b |
| [`wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors) | diffusion_models | 14.29 | wan22-t2v-14b, wan22-t2v-14b-lightx2v |
| [`wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors) | diffusion_models | 14.29 | wan22-t2v-14b, wan22-t2v-14b-lightx2v |
| [`wan2.2_ti2v_5B_fp16.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors) | diffusion_models | 10 | wan22-ti2v-5b, wan22-ti2v-5b-i2v |
| [`Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors`](https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/I2V/Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors) | diffusion_models | 16.64 | infinitetalk-native |
| [`Wan2_1-InfiniteTalk_Single_Q8.gguf`](https://huggingface.co/Kijai/WanVideo_comfy_GGUF/resolve/main/InfiniteTalk/Wan2_1-InfiniteTalk_Single_Q8.gguf) | diffusion_models | 2.65 | infinitetalk-wanwrapper |
| [`wan_animate_2_int8_convrot.safetensors`](https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/diffusion_models/wan_animate_2_int8_convrot.safetensors) | diffusion_models | 16.65 | wan-animate2 |
| [`z_image_turbo_bf16.safetensors`](https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors) | diffusion_models | 12.31 | z-image-turbo-t2i |
| [`GFPGANv1.4.pth`](https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/facerestore_models/GFPGANv1.4.pth) | facerestore_models | 0.35 | face-swap-reactor |
| [`film_net_fp16.safetensors`](https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/film_net_fp16.safetensors) | frame_interpolation | 0.07 | interpolate-film |
| [`rife_v4.26.safetensors`](https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/rife_v4.26.safetensors) | frame_interpolation | 0.02 | interpolate-rife |
| [`inswapper_128.onnx`](https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/inswapper_128.onnx) | insightface | 0.55 | face-swap-reactor |
| [`ltx-2-spatial-upscaler-x2-1.0.safetensors`](https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-spatial-upscaler-x2-1.0.safetensors) | latent_upscale_models | 1 | ltx2-t2v, ltx2-i2v |
| [`ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors`](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors) (gated) | latent_upscale_models | 1 | ltx25-t2v, ltx25-i2v |
| [`Flux_2-Turbo-LoRA_comfyui.safetensors`](https://huggingface.co/ByteZSzn/Flux.2-Turbo-ComfyUI/resolve/main/Flux_2-Turbo-LoRA_comfyui.safetensors) | loras | 2.76 | flux2-dev-t2i-turbo |
| [`lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors`](https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors) | loras | 0.74 | wan-animate2, infinitetalk-native, infinitetalk-wanwrapper |
| [`ltx-2-19b-distilled-lora-384.safetensors`](https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-distilled-lora-384.safetensors) | loras | 7.67 | ltx2-t2v, ltx2-i2v |
| [`Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors`](https://huggingface.co/lightx2v/Qwen-Image-2512-Lightning/resolve/main/Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors) | loras | 1.7 | qwen-image-2512-t2i-lightning |
| [`Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors`](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors) | loras | 0.85 | qwen-image-edit-2509 |
| [`wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors) | loras | 1.23 | wan22-i2v-14b-lightx2v |
| [`wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors) | loras | 1.23 | wan22-i2v-14b-lightx2v |
| [`wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors) | loras | 1.23 | wan22-t2v-14b-lightx2v, wan22-s2v-14b |
| [`wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors) | loras | 1.23 | wan22-t2v-14b-lightx2v |
| [`Wan21_CausVid_14B_T2V_lora_rank32.safetensors`](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan21_CausVid_14B_T2V_lora_rank32.safetensors) | loras | 0.32 | wan21-vace-14b-ref2v |
| [`apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors`](https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors) | mmaudio | 1.97 | v2a-mmaudio |
| [`mmaudio_large_44k_v2_fp16.safetensors`](https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_large_44k_v2_fp16.safetensors) | mmaudio | 2.06 | v2a-mmaudio |
| [`mmaudio_synchformer_fp16.safetensors`](https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_synchformer_fp16.safetensors) | mmaudio | 0.47 | v2a-mmaudio |
| [`mmaudio_vae_44k_fp16.safetensors`](https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_vae_44k_fp16.safetensors) | mmaudio | 0.61 | v2a-mmaudio |
| [`wan2.1_infiniteTalk_single_fp16.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/model_patches/wan2.1_infiniteTalk_single_fp16.safetensors) | model_patches | 5.13 | infinitetalk-native |
| [`byt5_small_glyphxl_fp16.safetensors`](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/byt5_small_glyphxl_fp16.safetensors) | text_encoders | 0.44 | hunyuan15-t2v-720p, hunyuan15-i2v-720p |
| [`clip_g_hidream.safetensors`](https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/text_encoders/clip_g_hidream.safetensors) | text_encoders | 1.39 | hidream-i1-dev-t2i |
| [`clip_l.safetensors`](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors) | text_encoders | 0.25 | flux1-dev-t2i, flux1-krea-dev-t2i, flux1-schnell-t2i (+3) |
| [`clip_l_hidream.safetensors`](https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/text_encoders/clip_l_hidream.safetensors) | text_encoders | 0.25 | hidream-i1-dev-t2i |
| [`gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors) (gated) | text_encoders | 15.37 | ltx25-t2v, ltx25-i2v |
| [`gemma_3_12B_it_fp4_mixed.safetensors`](https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors) | text_encoders | 9.45 | ltx2-t2v, ltx2-i2v |
| [`llama_3.1_8b_instruct_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/text_encoders/llama_3.1_8b_instruct_fp8_scaled.safetensors) | text_encoders | 9.08 | hidream-i1-dev-t2i |
| [`mistral_3_small_flux2_bf16.safetensors`](https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_bf16.safetensors) | text_encoders | 35.58 | flux2-dev-t2i, flux2-dev-t2i-turbo, flux2-dev-edit (+1) |
| [`qwen_2.5_vl_7b_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | text_encoders | 9.38 | qwen-image-2512-t2i, qwen-image-2512-t2i-lightning, qwen-image-edit-2509 (+4) |
| [`qwen_3_4b.safetensors`](https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors) | text_encoders | 8.04 | z-image-turbo-t2i |
| [`t5xxl_fp16.safetensors`](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors) | text_encoders | 9.79 | flux1-dev-t2i, flux1-krea-dev-t2i, flux1-schnell-t2i (+2) |
| [`t5xxl_fp8_e4m3fn_scaled.safetensors`](https://huggingface.co/Comfy-Org/HiDream-I1_ComfyUI/resolve/main/split_files/text_encoders/t5xxl_fp8_e4m3fn_scaled.safetensors) | text_encoders | 5.16 | hidream-i1-dev-t2i, flux1-kontext-dev-edit |
| [`umt5-xxl-enc-bf16.safetensors`](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/umt5-xxl-enc-bf16.safetensors) | text_encoders | 11.36 | infinitetalk-wanwrapper |
| [`umt5_xxl_fp16.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp16.safetensors) | text_encoders | 11.37 | wan21-vace-14b-ref2v |
| [`umt5_xxl_fp8_e4m3fn_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | text_encoders | 6.74 | wan22-t2v-14b, wan22-t2v-14b-lightx2v, wan22-i2v-14b (+10) |
| [`RealESRGAN_x4plus.safetensors`](https://huggingface.co/Comfy-Org/Real-ESRGAN_repackaged/resolve/main/RealESRGAN_x4plus.safetensors) | upscale_models | 0.07 | upscale-image-esrgan, upscale-video-esrgan |
| [`ae.safetensors`](https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors) | vae | 0.34 | flux1-dev-t2i, flux1-krea-dev-t2i, flux1-schnell-t2i (+5) |
| [`full_encoder_small_decoder.safetensors`](https://huggingface.co/black-forest-labs/FLUX.2-small-decoder/resolve/main/full_encoder_small_decoder.safetensors) | vae | 0.25 | flux2-dev-t2i, flux2-dev-t2i-turbo, flux2-dev-edit (+1) |
| [`hunyuanvideo15_vae_fp16.safetensors`](https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/vae/hunyuanvideo15_vae_fp16.safetensors) | vae | 2.52 | hunyuan15-t2v-720p, hunyuan15-i2v-720p |
| [`ltx-2.5-audio-vae-bf16.safetensors`](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-audio-vae-bf16.safetensors) (gated) | vae | 0.36 | ltx25-t2v, ltx25-i2v |
| [`ltx-2.5-video-vae-bf16.safetensors`](https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-video-vae-bf16.safetensors) (gated) | vae | 1.47 | ltx25-t2v, ltx25-i2v |
| [`qwen_image_vae.safetensors`](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | vae | 0.25 | qwen-image-2512-t2i, qwen-image-2512-t2i-lightning, qwen-image-edit-2509 (+2) |
| [`seedvr2_ema_vae_fp16.safetensors`](https://huggingface.co/Comfy-Org/SeedVR2/resolve/main/vae/seedvr2_ema_vae_fp16.safetensors) | vae | 0.5 | upscale-image-seedvr2, upscale-video-seedvr2 |
| [`wan2.2_vae.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors) | vae | 1.41 | wan22-ti2v-5b, wan22-ti2v-5b-i2v |
| [`Wan2_1_VAE_bf16.safetensors`](https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/vae/Wan2_1_VAE_bf16.safetensors) | vae | 0.25 | wan-animate2, infinitetalk-native, infinitetalk-wanwrapper |
| [`wan_2.1_vae.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | vae | 0.25 | wan22-t2v-14b, wan22-t2v-14b-lightx2v, wan22-i2v-14b (+7) |
| **total (86 files)** | | **740** | |

Gated (needs HF token + licence acceptance): the five `Lightricks/LTX-2.5` files. Licences to keep in mind (from `docs/research/comfyui-oss.md`): FLUX.1/FLUX.2 [dev], Kontext, Krea-dev → non-commercial; MMAudio, inswapper, RMBG-2.0 → non-commercial; LTX-2.x revenue-gated; Wan, Qwen-Image, Z-Image, SeedVR2, BiRefNet, ACE-Step, FLUX.1 schnell → Apache/MIT.

Runtime self-downloads (not in `models`): ComfyUI-RMBG model (BEN2 by default → `models/RMBG/`), RIFE VFI `rife49.pth`, `TencentGameMate/chinese-wav2vec2-base` (WanVideoWrapper `DownloadAndLoadWav2VecModel`), ReActor `buffalo_l`/`retinaface_resnet50`.

## 7. Custom node packs

| pack | commit | status on this server | used by |
|---|---|---|---|
| [kijai/ComfyUI-WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper) | `088128b` | ok | infinitetalk-wanwrapper |
| [Kosinkadink/ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | `4d907be` | ok | infinitetalk-wanwrapper, interpolate-rife-vfi, v2a-mmaudio |
| [kijai/ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) | `17195fc` | ok | infinitetalk-wanwrapper, video-extend-wan22-fun-vace, video-reframe-wan22-fun-vace |
| [numz/ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) | `4490bd1` | **import fails on CPU** (device combo) — not used; core SeedVR2 used instead | — |
| [Fannovel16/ComfyUI-Frame-Interpolation](https://github.com/Fannovel16/ComfyUI-Frame-Interpolation) | `26545cc` | ok (no cupy) | interpolate-rife-vfi |
| [1038lab/ComfyUI-RMBG](https://github.com/1038lab/ComfyUI-RMBG) | `229529e` | ok (after installing triton, decord, pycocotools) | bg-remove-rmbg |
| [Gourieff/ComfyUI-ReActor](https://github.com/Gourieff/ComfyUI-ReActor) | `3be5f35` | ok (insightface 2.1 wheel) | face-swap-reactor |
| [kijai/ComfyUI-MMAudio](https://github.com/kijai/ComfyUI-MMAudio) | `8eaeb72` | ok | v2a-mmaudio |
| [filliptm/ComfyUI_Fill-ChatterBox](https://github.com/filliptm/ComfyUI_Fill-ChatterBox) | `f7d7a16` | ok (resampy, s3tokenizer, conformer, soundfile) | tts-chatterbox-multilingual, tts-dialogue-chatterbox, voice-change-chatterbox |
| [snicolast/ComfyUI-IndexTTS2](https://github.com/snicolast/ComfyUI-IndexTTS2) | `5b33e02` | ok — registers with numpy only; runtime deps **not** installed (`INDEXTTS_RUNTIME=1`) | tts-indextts2 |
| [yuvraj108c/ComfyUI-Video-Depth-Anything](https://github.com/yuvraj108c/ComfyUI-Video-Depth-Anything) | `a0db08e` | ok (einops, easydict, Imath, OpenEXR) | video-depth-vda-small |

## 8. What failed / was skipped, and why

* **numz/ComfyUI-SeedVR2_VideoUpscaler — import fails on CPU-only hosts** (`Error while calling comfy_entrypoint … list index out of range`): its loader nodes build the `device` combo from CUDA/MPS devices and index `[0]`. It would load on a GPU server, but its workflows would need a `cuda:0` device value we cannot validate here. Not needed: core ComfyUI ships native SeedVR2 nodes and official templates, which the library uses (`upscale-image-seedvr2`, `upscale-video-seedvr2`).
* **ComfyUI-RMBG initially failed to import** because its SAM3 module needs `triton`, `decord`, `pycocotools` (and its error handler crashes with `NameError: module_name`, taking the whole pack down). Installing those three packages fixed it (they are in `install-comfyui.sh`).
* **WanVideoWrapper InfiniteTalk example** uses `MelBandRoFormer*` vocal-separation nodes from a pack not on the install list (kijai/ComfyUI-MelBandRoFormer). They were removed and the audio is fed straight to wav2vec; Windows-style sub-paths in model names were flattened and `attention_mode` changed from `sageattn` to `sdpa` (sageattention is not installed by default).
* **No official template exists** for: Wan 2.2 Animate v1 (core now ships *Wan Animate 2*, used instead), a dedicated Wan 2.2 VACE template (Wan 2.1 VACE 14B ref2v used; Wan 2.2 Fun Control used for control video), an image ESRGAN upscale (hand-built from the official *video* GAN-upscaler template's nodes), RMBG / ReActor / RIFE-VFI (hand-built). MMAudio has no official template (pack example used).
* ComfyUI-Frame-Interpolation: cupy not installed (CPU box) — RIFE does not need it.
* ComfyUI-ReActor fetched `GFPGANv1.3.pth` (348 MB) on its own during the first `/object_info` call (it downloads face-restore models whenever `models/facerestore_models` is empty), and a first, naive validator version let ComfyUI-RMBG start downloading BEN2 (1.1 GB) before the interrupt landed. Both files were deleted; the install script now leaves a zero-byte placeholder in `facerestore_models` and the validator uses the blocker approach, so no weights are downloaded any more.
* Nothing in the library failed validation.

## 9. Re-running the pipeline

```bash
bash scripts/comfy/install-comfyui.sh          # once: ComfyUI + packs (pinned), CPU torch, deps
bash scripts/comfy/start-comfyui.sh            # = cd /home/user/ComfyUI && .venv/bin/python main.py --cpu --listen 127.0.0.1 --port 8188 (background)
cd scripts/comfy && npm install && npm run all # export (Playwright) → build (manifest, HF sizes) → validate
```

* `npm run export` drives headless Chromium (`/opt/pw-browsers/chromium-*/chrome-linux/chrome`) against the running ComfyUI and writes `scripts/comfy/build/raw/*.api.json`.
* `npm run build` applies `library.spec.mjs` (transforms, bindings, notes) and resolves model URLs (template `properties.models` metadata, else `KNOWN_MODELS`) and sizes (Hugging Face `x-linked-size`, tree API for gated repos). Output is deterministic; `validated` is carried over from `scripts/comfy/validation-state.json` when a workflow file's sha256 is unchanged.
* `npm run validate` creates zero-byte placeholder models (deleted afterwards), uploads fixtures, fills every binding with sample values and `POST /prompt` (ComfyUI validates synchronously inside that request). To guarantee nothing executes, a "blocker" prompt (chain of 1-second KJNodes `Sleep` nodes) first occupies ComfyUI's single worker, so each validation prompt is merely *pending* and is removed right away with `POST /queue {"delete":[id]}`; at the end the blocker is interrupted and `POST /queue {"clear":true}` + `POST /interrupt` are sent (`--shared` skips these global calls). This matters because several nodes download weights as soon as they execute (RMBG, RIFE VFI, wav2vec, ReActor). It updates `manifest.json` and writes `object_info.subset.json` (174 node classes after the oss-2 additions). It can be pointed at a real GPU server (`COMFYUI_URL`, `COMFYUI_DIR`) — it never overwrites real model files.
* To upgrade templates: bump `comfyui-workflow-templates` (ComfyUI `requirements.txt`), re-run; the build fails loudly if a bound node/input disappeared.

## 10. comfyui-oss-2 additions (2026-10-16)

Twenty workflows that close the gaps found in [`comfyui-oss-2.md`](comfyui-oss-2.md) / [`comfyui-oss-2.json`](comfyui-oss-2.json). They are **hand-built** API graphs (`scripts/comfy/hand-built/<id>.json`, transcribed from the research graphs that had already passed live `/prompt`, or derived from the library's `qwen-image-edit-2509.json`), declared in `library.spec.mjs` and built/validated by the normal pipeline (`npm run build -- <ids>`, `node validate-workflows.mjs <ids>`).

**Validation:** ComfyUI `fc04da91` (v0.41.0-7, CPU) with all library packs plus `ComfyUI_Fill-ChatterBox`, `ComfyUI-IndexTTS2` and `ComfyUI-Video-Depth-Anything` at the commits in section 7 (all in `install-comfyui.sh`). **20/20 accepted** (HTTP 200, `prompt_id`, no `node_errors`) with zero-byte placeholder weights and uploaded fixtures; nothing was executed except two model-free sanity runs: the `ComfyMathExpression` nodes used by `video-extend` (65 + 16 → 81, `0 - 16` → −16, seed `2^47+5 % 2^32` → 5) and `ImageResizeKJv2` pad mode used by `video-reframe` (64×64 into 128×64: mask 255 on the 32 px side bars, 0 on the image; bars filled with 127 gray). Negative tests (a bad `language` value, a CONDITIONING wired into the math node) were rejected. A second pass with **seed = 2^47 + 12345** (what `randomSeed()` in the app can produce) passed for all **73** workflows.

### 10.1 Workflows

| id | capability | what it does | validated | bindings | output | models GB (new) | VRAM | license |
|---|---|---|---|---|---|---|---|---|
| `tts-chatterbox-multilingual` | tts | text → speech in a cloned voice, 23 languages | **yes** | prompt, audio, language, seed, exaggeration, cfg, temperature | 3: `.mp3` | auto 3.2 | 6 | MIT weights |
| `tts-indextts2` | tts | text → speech, cloned voice, most expressive | **yes** (graph); runtime deps not installed | prompt, audio | 3: `.mp3` | auto ≈ 6 | 8 | bilibili IndexTTS licence: commercial OK below 100M MAU / RMB 1B revenue, no training other models |
| `tts-dialogue-chatterbox` | **dialogue** (new) | 2-speaker script → mixed dialogue | **yes** | prompt, audio, audio2, seed, exaggeration, cfg, temperature | 4: `.mp3` | auto 3.2 | 6 | MIT weights |
| `voice-change-chatterbox` | **voice-change** (new) | speech → same performance in another voice | **yes** | audio, audio2, seed | 4: `.mp3` | auto 1.1 | 3 | MIT weights |
| `video-extend-wan22-fun-vace` | extend | continue a clip (context frames + new frames, overlap blend) | **yes** | video, prompt, negativePrompt, width, height, frames, contextFrames, fps, seed, steps, cfg, shift | 28: `.mp4` | 44.2 (34.7) | 24 | Apache-2.0 |
| `video-reframe-wan22-fun-vace` | reframe | new aspect ratio, AI-filled borders | **yes** | video, prompt, negativePrompt, width, height, frames, fps, seed, steps, cfg, shift | 24: `.mp4` | 44.2 (shared with extend) | 24 | Apache-2.0 |
| `relight-qwen-edit-2509` | edit | relight a photo from a text description | **yes** | prompt, negativePrompt, image, seed, steps, cfg, loraStrength | 469: `.png` | 31.2 (0.24) | 24 | Apache-2.0 |
| `relight-qwen-edit-2509-reference` | edit | relight `image` with the light of `image2` | **yes** | prompt, negativePrompt, image, image2, seed, steps, cfg, loraStrength | 469: `.png` | 31.2 (0.24) | 24 | Apache-2.0 |
| `video-relight-bernini-r` | v2v | prompt-driven video relight / restyle | **yes** | video, prompt, negativePrompt, width, height, frames, seed, steps, cfg | 20: `.mp4` | 38.8 (31.8) | 24 | Apache-2.0 |
| `draw-to-video-wan-move` | **draw-to-video** (new) | start frame + drawn motion paths → video | **yes** | image, tracks, prompt, negativePrompt, width, height, frames, motionStrength, fps, seed, steps, cfg, shift | 18: `.mp4` | 25.4 (16.4) | 24 | Apache-2.0 |
| `video-concat-2` / `-3` / `-4` | **concat** (new) | join 2/3/4 shots (multi-shot assembly) | **yes** | video, video2[, video3[, video4]], width, height, fps | 22: `.mp4` | 0 | 0 (CPU) | no model |
| `storyboard-qwen-edit-2509-next-scene` | edit | next storyboard panel from previous panel + character reference | **yes** | prompt, negativePrompt, image, image2, seed, steps, cfg, loraStrength | 469: `.png` | 31.2 (0.3) | 24 | Apache-2.0 + MIT LoRA |
| `video-bg-remove-birefnet` | **bg-remove-video** (new) | transparent-background video | **yes** | video | 7: `.webm` (VP9 alpha), 10: matte `.mp4` | 0.44 (shared) | 4 | MIT |
| `video-bg-remove-sam3` | **bg-remove-video** (new) | keep only the object named in `prompt` | **yes** | video, prompt | 9: `.webm` (VP9 alpha) | 1.75 (1.75) | 6 | Meta SAM License (commercial OK) |
| `video-depth-da3` | **depth-video** (new) | depth-map video (per frame) | **yes** | video | 7: `.mp4` | 1.34 (1.34) | 4 | Apache-2.0 (mono-large only) |
| `video-depth-vda-small` | **depth-video** (new) | temporally stable depth-map video | **yes** | video | 7: `.mp4` | auto 0.12 | 4 | Apache-2.0 (Small only; Base/Large are **CC-BY-NC**) |
| `palette-transfer-image` | grade | lock an image to a HEX palette swatch | **yes** | image, image2, strength | 4: `.png` | 0 | 0 (CPU) | no model |
| `palette-transfer-video` | v2v | same for a clip, flicker-free (`uniform` stats) | **yes** | video, image, strength | 6: `.mp4` (keeps audio) | 0 | 0 (CPU) | no model |

"auto" = the node pack downloads its weights on first run (listed in the entry's `autoDownloads`; pre-seed them on production servers). New weights for all 20: **≈ 86.7 GB** of manifest models (Fun VACE 34.7, Bernini-R 31.1, Wan-Move 16.4, SAM 3.1 1.75, DA3 1.34, LoRAs 1.4) + ≈ 7.6 GB auto-downloaded TTS / depth weights. UMT5, Wan VAE, CLIP-vision H, the lightx2v LoRAs and all Qwen-Image-Edit 2509 files are shared with existing workflows.

None of the 20 uses a non-commercial model. Watch-outs: IndexTTS-2's licence has scale thresholds; Video Depth Anything Base/Large and DA3 Large/Giant are CC-BY-NC (do not swap them in); the Chatterbox pack repo ships no LICENSE file (weights are MIT).

### 10.2 New `capability` values (= op)

Existing values were reused where the input/output shape matches (`tts`, `extend`, `reframe`, `edit`, `v2v`, `grade`). New ones, needed because their inputs or output kind differ from every existing op:

| capability | input → output | suggested `OPERATION_OUTPUT` |
|---|---|---|
| `dialogue` | script + 2 voice clips → audio | audio |
| `voice-change` | audio + target-voice audio → audio | audio |
| `draw-to-video` | image + `tracks` JSON → video | video |
| `concat` | 2-4 videos → video | video |
| `bg-remove-video` | video → video with alpha (`.webm`) | video (the existing `bg-remove` is image-only) |
| `depth-video` | video → depth video | video |

`palette-transfer-image` uses `grade` (image output) and `palette-transfer-video` / `video-relight-bernini-r` use `v2v`.

### 10.3 New binding keys

All are passed through `ProviderInput.extra` until `BindingKey` lists them (`audio2` / `video2-4` need upload slots like `audio` / `video`):

| key | type | meaning | default |
|---|---|---|---|
| `audio2` | uploaded file name | second audio: dialogue speaker B (`tts-dialogue-chatterbox`), target voice (`voice-change-chatterbox`) | — |
| `video2`, `video3`, `video4` | uploaded file name | shots 2-4 (`video-concat-*`) | — |
| `language` | string enum | Chatterbox Multilingual language: Arabic (ar), Danish (da), German (de), Greek (el), English (en), Spanish (es), Finnish (fi), French (fr), Hebrew (he), Hindi (hi), Italian (it), Japanese (ja), Korean (ko), Malay (ms), Dutch (nl), Norwegian (no), Polish (pl), Portuguese (pt), Russian (ru), Swedish (sv), Swahili (sw), Turkish (tr), Chinese (zh) — the value is the whole string, e.g. `"French (fr)"` | `"English (en)"` |
| `exaggeration` | float 0.25-2 | Chatterbox emotion intensity | 0.5 |
| `temperature` | float 0.05-2 | Chatterbox sampling temperature | 0.8 |
| `contextFrames` | int, multiple of 4 | `video-extend`: how many source tail frames condition the continuation (and are cross-faded) | 16 |
| `tracks` | JSON string | `draw-to-video-wan-move`: `[[{"x":px,"y":px}, …], …]`, one point per output frame per track, all tracks equally long, pixel space of `width`×`height` | sample in the JSON |
| `motionStrength` | float 0-100 | Wan-Move track conditioning strength | 1.0 |
| `strength` | float 0-10 | `ColorTransfer` strength | 0.8 |

Reused keys with workflow-specific meaning: `prompt` = text to speak / dialogue script (`SPEAKER A:` / `SPEAKER B:` lines) / object to keep (SAM 3.1); `audio` = voice reference (TTS) / speaker A / the performance to convert (voice change); `cfg` = Chatterbox `cfg_weight` (**0-1**, default 0.5, not a diffusion CFG); `image2` = lighting reference / character reference / palette swatch; `image` in `palette-transfer-video` = the swatch; `frames` in `video-extend` = **new** frames (4n+1), not the window.

New optional manifest field: **`license`** (string) on these 20 entries.

### 10.4 Models

| file | folder | GB | new? | used by |
|---|---|---|---|---|
| [`wan2.2_fun_vace_high_noise_14B_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_vace_high_noise_14B_fp8_scaled.safetensors) | diffusion_models | 17.35 | new | video-extend, video-reframe |
| [`wan2.2_fun_vace_low_noise_14B_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_vace_low_noise_14B_fp8_scaled.safetensors) | diffusion_models | 17.35 | new | video-extend, video-reframe |
| [`wan2.2_bernini_r_high_noise_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Bernini-R/resolve/main/diffusion_models/wan2.2_bernini_r_high_noise_fp8_scaled.safetensors) | diffusion_models | 15.57 | new | video-relight-bernini-r |
| [`wan2.2_bernini_r_low_noise_fp8_scaled.safetensors`](https://huggingface.co/Comfy-Org/Bernini-R/resolve/main/diffusion_models/wan2.2_bernini_r_low_noise_fp8_scaled.safetensors) | diffusion_models | 15.57 | new | video-relight-bernini-r |
| [`Wan21-WanMove_fp8_scaled_e4m3fn_KJ.safetensors`](https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/WanMove/Wan21-WanMove_fp8_scaled_e4m3fn_KJ.safetensors) | diffusion_models | 16.4 | new | draw-to-video-wan-move |
| [`sam3.1_multiplex_fp16.safetensors`](https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors) | checkpoints | 1.75 | new | video-bg-remove-sam3 |
| [`depth_anything_3_mono_large.safetensors`](https://huggingface.co/Comfy-Org/Depth-Anything-3/resolve/main/geometry_estimation/depth_anything_3_mono_large.safetensors) | geometry_estimation | 1.34 | new | video-depth-da3 |
| [`Qwen-Image-Edit-2509-Relight.safetensors`](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Relight.safetensors) | loras | 0.24 | new | relight-qwen-edit-2509 |
| [`Qwen-Image-Edit-2509-Light-Migration.safetensors`](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Light-Migration.safetensors) | loras | 0.24 | new | relight-qwen-edit-2509-reference |
| [`next-scene_lora-v2-3000.safetensors`](https://huggingface.co/lovis93/next-scene-qwen-image-lora-2509/resolve/main/next-scene_lora-v2-3000.safetensors) | loras | 0.3 | new | storyboard-qwen-edit-2509-next-scene |
| [`lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors`](https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors) | loras | 0.63 | new | video-relight-bernini-r |
| `wan2.2_t2v_lightx2v_4steps_lora_v1.1_{high,low}_noise.safetensors` | loras | 2 × 1.23 | shared | video-extend, video-reframe (+ wan22-t2v-14b-lightx2v) |
| `lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors`, `clip_vision_h.safetensors` | loras / clip_vision | 0.74 / 1.26 | shared | draw-to-video-wan-move |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, `wan_2.1_vae.safetensors` | text_encoders / vae | 6.74 / 0.25 | shared | all Wan-based additions |
| `qwen_image_edit_2509_fp8_e4m3fn`, `qwen_2.5_vl_7b_fp8_scaled`, `qwen_image_vae`, `Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16` | … | 30.9 | shared | relight ×2, storyboard |
| `birefnet.safetensors` | background_removal | 0.44 | shared | video-bg-remove-birefnet |
| ResembleAI/chatterbox (multilingual `t3_mtl23ls_v2` 2.14 + `s3gen.pt` 1.06; English `t3_cfg` 2.13 + `s3gen` 1.06; VC `s3gen.pt`) | `models/chatterbox/…` (auto) | ≈ 6.4 | auto | Chatterbox ×3 |
| IndexTeam/IndexTTS-2 (`gpt.pth` 3.48, `s2mel.pth` 1.2, `qwen0.6bemo4-merge` 1.19, + w2v-bert / MaskGCT / CAMPPlus / BigVGAN) | `custom_nodes/ComfyUI-IndexTTS2/checkpoints` | ≈ 6+ | manual + auto | tts-indextts2 |
| depth-anything/Video-Depth-Anything-Small `video_depth_anything_vits.pth` | `models/videodepthanything` (auto) | 0.12 | auto | video-depth-vda-small |

### 10.5 Quirks the app must handle

* **Seeds.** The Chatterbox nodes cap `seed` at 2^32−1 while the app's `randomSeed()` goes to 2^48. The three Chatterbox graphs bind `seed` to a `PrimitiveInt` (node 10) and fold it with `ComfyMathExpression "a % 4294967296"` (node 11) — no app change needed. IndexTTS-2 has no seed.
* **TTS / dialogue / VC** need every bound `audio`/`audio2` upload (the build enforces that every `Load*` is bound): 5-15 s of clean speech per reference. Dialogue lines must start with `SPEAKER A:` / `SPEAKER B:`. Output is MP3 V0 under `audio[]`. Install `resemble-perth` so Chatterbox output carries the Perth watermark, and gate cloning behind a consent step.
* **IndexTTS-2** registers without its runtime stack; executing it needs `INDEXTTS_RUNTIME=1 scripts/comfy/install-comfyui.sh` (pynini 2.1.7 has a cp313 wheel; the pack pins 2.1.6, which must be compiled) and the `IndexTeam/IndexTTS-2` checkpoint folder. Run it on a separate worker.
* **video-extend:** `frames` = new frames (4n+1, from `duration × fps`), `contextFrames` multiple of 4; window = frames + contextFrames ≤ 121 (so `limits.maxFrames` = 105). Output = the whole source (scaled + center-cropped to width×height) + the continuation, cross-faded over `contextFrames`; loop the job to go longer. Resample sources to 16 fps. Audio is dropped.
* **video-reframe:** `width`/`height` are the **target** size (from `aspectRatio`); the source is fitted inside and padded automatically (`ImageResizeKJv2` pad mode → mask). `frames` ≤ source frame count. Do not call it when the aspect ratio is unchanged (no padding → a 64×64 placeholder mask → the whole clip is regenerated). This replaces the research graph's `sourceWidth`/`sourceHeight` + pad keys, so no new keys are needed.
* **video-relight-bernini-r:** keep the source aspect ratio for `width`/`height` and set `frames` to the source frame count (4n+1); output fps follows the source (linked), no audio.
* **draw-to-video-wan-move:** `tracks` length per track must equal `frames`; coordinates are in the resized (`width`×`height`, center-cropped) frame. Add parallel tracks per object and static tracks to pin the background. 480p model: long side ≤ 832.
* **video-concat-N:** hard cuts; all clips are scaled/center-cropped to `width`×`height` and concatenated at `fps` (no retiming), audio dropped. Assemble multi-shot as storyboard → per-shot `wan22-i2v-14b-lightx2v` / `wan22-flf2v-14b` → concat → `v2a-mmaudio`/music. LTX-2.5 native multishot (shot-list prompt through `ltx25-t2v`/`ltx25-i2v`) needs no new graph.
* **video-bg-remove-*:** `SaveWEBM` files are reported under `images[]` (with `animated: true`); `collectFiles` should rely on the declared kind / `.webm` extension. Browsers play VP9-alpha WebM (Chrome/Firefox/Edge); Safari needs HEVC-alpha or the matte MP4 (`video-bg-remove-birefnet` node 10).
* **relight / storyboard** prepend their LoRA trigger in node 1002 (`重新照明,` / the light-migration instruction / `Next Scene:`); bind only the user text to `prompt`.

### 10.6 Considered but not added

| option | why not |
|---|---|
| VibeVoice 1.5B/7B dialogue | Microsoft's card restricts use to research; needs `gguf` (missing from its requirements). Graph validated in the research JSON if wanted later. |
| Seed-VC voice conversion | GPL-3.0 code and weights; AIFSH pack stale since 2024-11 and not installable on the CPU box. |
| Wan 2.1 ATI trajectory | Older (Wan 2.1, 121-point tracks); Wan-Move covers draw-to-video. |
| SVI 2.0 Pro / Wan I2V multi-frame extend | Proper SVI chaining passes the sampler *latent* between chunks, which a file-in/file-out job cannot; the I2V multi-frame trick has the weakest continuity. |
| Wan 2.1 VACE 14B reframe | 34.7 GB fp16 DiT for the same job; Fun VACE is shared with extend. |
| LTX-2.x extend / outpaint IC-LoRA | Revenue-gated licence and extra packs (LTXVideo, VHS, ComfyMath). |
| Core `TrainLoraNode` character LoRA | Does not fit the manifest model: `SaveLoRA` reports no UI output (nothing to fetch from `/history`), the result is a `.safetensors` (not image/video/audio), the dataset must be a folder in ComfyUI's `input/` (not an upload), and a run holds the GPU for 20-90 min. Use the ai-toolkit worker from comfyui-oss-2 §8 instead. |
| HoloCine multi-shot | CC-BY-NC-SA, no ComfyUI node. |

## 11. comfyui-oss-4 additions (2026-10-22)

Seventeen workflows from [`comfyui-oss-4.md`](comfyui-oss-4.md) / [`comfyui-oss-4.json`](comfyui-oss-4.json): the 14 researched graphs and the critic's 3 (§i). Round 3 (42 hand-built workflows, 73 → 115) is documented in `scripts/comfy/README.md` and [`comfyui-oss-3.md`](comfyui-oss-3.md); this section takes the manifest from 115 to **132 entries**. All 17 are **hand-built** (`scripts/comfy/hand-built/<id>.json`, the researcher's validated API graphs with the changes listed below), declared in the "comfyui-oss-4" section of `library.spec.mjs`, built and validated by the normal pipeline.

**Validation:** the same ComfyUI `fc04da91` (v0.41.0-7, CPU, 14 packs), shared with other agents, so always with `--shared`. **17/17 accepted** (HTTP 200, `prompt_id`, no `node_errors`) with zero-byte placeholder weights and the fixtures; the switches `skipPass2` and `cutout` were fed their non-default value. A sample of 10 older workflows (FLUX.1 [dev], Wan 2.2 I2V lightx2v, RIFE, a sound-keeping join, Qwen3.5 / Gemma 4 `TextGenerate`, Fun VACE restyle, TRELLIS.2, FLUX.2 [klein] style reference, caption burn-in) re-validated unchanged: **132/132 validated**. No new node pack and no isolated worker: core nodes, KJNodes' `GrowMaskWithBlur` and VHS's `VHS_LoadAudioUpload` / `VHS_VideoCombine` / `VHS_LoadVideo`.

**Real CPU runs (no weights needed):** the eight model-free graphs ran on tiny inputs, in two sessions, every output checked with ffprobe (plus framemd5, silencedetect or numpy where it matters). Timings are in each entry's `notes`. The model graphs (OCR, VACE, VOID, MoGe, TripoSplat, Gemma 4 brief) are `/prompt`-validated only here; the research ran OCR and MoGe on CPU with real weights.

### 11.1 Workflows

| id | capability (round-4 op) | what it does | bindings | outputs | models GB (new) | VRAM | ran here |
|---|---|---|---|---|---|---|---|
| `ocr-lines-qwen35` | ocr | text lines + boxes for Layers (OvisOCR3 0.8B through core `TextGenerate`) | image, maxSize, checkpoint, instruction, maxTokens | 5: text `lines` (.json), 8: text `frame` | 1.71 (1.71) | 3 | research only (161–194 s per poster) |
| `video-inpaint-wan-vace` | remove-object | SAM 3.1 tracks `maskPrompt`, Wan 2.1 VACE 14B + lightx2v regenerates it, pasted into the original frames | video, startFrame, frames, width, height, maskPrompt, maskGrow, prompt, negativePrompt, checkpoint, loraStrength, shift, seed, steps, cfg | 38: video | 44.05 (0) | 24 | window + sound part only |
| `video-inpaint-wan-vace-painted` | remove-object | same, the object painted on the window's first frame | as above with `mask` instead of `maskPrompt` | 38: video | 44.05 (0) | 24 | no |
| `video-erase-void` | remove-object | Netflix VOID: removes the object and what it causes (shadows, reflections), 2 passes | video, startFrame, frames, width, height, maskPrompt, maskGrow, prompt, negativePrompt, cfg, steps, seed, skipPass2 | 52: video | 34.27 (22.73) | 40 (unverified) | no |
| `video-swap-wan-vace` | video-swap | the tracked object replaced by a reference `image` | the inpaint keys + image | 38: video | 44.05 (0) | 24 | no |
| `video-insert-wan-vace` | video-insert | a reference `image` placed in a painted region held for the window | the painted keys + image | 38: video | 42.30 (0) | 24 | no |
| `kenburns-still` | still-motion | pan + zoom over a still, core loops, chunk-encoded | image, supersample, width, height, duration, fps, zoomStart, zoomEnd, panStartX, panStartY, panEndX, panEndY, easeInOut, chunkFrames | 32: video | 0 | 0 (CPU) | yes |
| `audio-loop-crossfade` | audio-loop | a bed of any length: loop with equal-power seams, fade-out | audio, fadeCurve, crossfade, duration, headroomDb | 29: audio (FLAC) | 0 | 0 (CPU) | yes |
| `audio-join-crossfade` | audio-join | two clips overlapped by `crossfade` seconds | audio, audio2, fadeCurve, crossfade | 17: audio (FLAC) | 0 | 0 (CPU) | yes |
| `video-export-pro` | export-video | ProRes 422 HQ / 4444, H.265 10-bit, FFV1, H.264 (VHS) | video, format, profile | 3: video | 0 | 0 (CPU) | yes, all five formats |
| `video-sdr-to-hdr` | sdr-to-hdr | core `ImageSDRToHDR` → BT.2020 HLG 10-bit H.264 | video, peakNits | 5: video | 0 | 0 (CPU) | yes |
| `video-export-exr` | export-video | half-float scene-linear EXR per frame | video | 3: image `frames` | 0 | 0 (CPU) | yes |
| `still-to-clip` | still-motion | a still held N s with a silent stereo track | image, width, height, duration, fps | 9: video | 0 | 0 (CPU) | yes |
| `video-append-endcard` | concat | ad + end card; the ad's picture stream-copied and its sound kept | video, image, width, height, fps, duration | 15: video | 0 | 0 (CPU) | yes |
| `scene-mesh-moge` | scene-3d | textured GLB of the whole scene + a depth PNG (MoGe 2) | image, checkpoint, resolutionLevel, fovX, decimation | 9: model3d `scene`, 11: image `depth` | 0.66 (0.66) | 4 | research only (42 s) |
| `image-to-splat-triposplat` | splat | Gaussian splat of the subject (`.spz`) + a 3 s orbit | image, cutout, numGaussians, steps, cfg, seed, splatFormat, orbitFrames | 51: model3d `splat`, 42: video `turntable` | 3.78 (3.00) | 8 (unverified) | no |
| `reference-brief-gemma4` | write | a reference clip's frames and sound → JSON style brief (Gemma 4 E4B) | video, frames, startFrame, frameWidth, checkpoint, instruction, seed, maxTokens | 4: text `brief` | 9.06 (0) | 12 | no |

Every entry also binds `filenamePrefix`. "new" = files no older workflow uses: **28.1 GB** in all (VOID 22.73, TripoSplat 3.00, OvisOCR3 1.71, MoGe 2 0.66). The VACE graphs reuse the library's Wan 2.1 VACE 14B, SAM 3.1, umT5, Wan VAE and lightx2v files; VOID's `t5xxl_fp16` and TripoSplat's `flux2-vae` are byte-identical to the FLUX files already listed (same sha256), so their download URLs differ but one file serves both.

**Licences.** Apache-2.0 for OvisOCR3 / Qwen3.5, Wan 2.1 VACE and the lightx2v LoRA, Gemma 4; MIT for MoGe and TripoSplat. Three need a notice in the app:
* **VOID** weights are Apache-2.0 but fine-tuned from CogVideoX-Fun-V1.5-5b-InP, whose transformer is under the **CogVideoX License**: commercial use only after registering for its basic commercial licence, and at most 1 million service visits a month without a further licence.
* **TripoSplat** uses the DINOv3 ViT-H encoder under the **DINOv3 License** (royalty-free, commercial use allowed, trade-control limits): show "Built with DINOv3".
* **KJNodes** (`GrowMaskWithBlur` in the four VACE graphs) and VideoHelperSuite are GPL-3.0 code; SAM 3.1 is under Meta's SAM License.

### 11.2 Capability values

The 17 use the round-4 operations of the shared contract (`src/lib/catalog/types.ts`, owned by the catalog-4 package): `ocr`, `remove-object`, `video-swap`, `video-insert`, `still-motion`, `audio-loop`, `audio-join`, `export-video`, `sdr-to-hdr`, `scene-3d`, `splat`. Two reuse older ones: `video-append-endcard` is a `concat`, and `reference-brief-gemma4` a `write`. `export-video` has two graphs: `video-export-pro` for every codec and `video-export-exr` for `params.format` `exr`. `still-motion` has two: `kenburns-still` for a camera move and `still-to-clip` for a held still. FPS boost stays on the existing `interpolate-rife` (`interpolate`); the research's target-fps table (multiplier m, keep every n-th frame) is not built.

### 11.3 New binding keys

Keys marked * are filled by the provider from the canonical request (`params.*`); the rest are sliders or controls (`params.extra[key]`). All are in `BINDING_KEYS` (`build-library.mjs`).

| key | type | meaning | default |
|---|---|---|---|
| `maskPrompt`* | string | SAM 3.1 text prompt: what to remove / replace | — |
| `maskGrow` | int px | the tracked mask grows by this much (edges, contact shadows) | 16 (VOID 8) |
| `skipPass2` | bool | VOID pass 1 only (half the time) | false |
| `zoomStart`*, `zoomEnd`* | float | Ken Burns zoom (`params.zoomFrom` / `zoomTo`), 1 = the widest crop in the output's shape | 1, 1.25 |
| `panStartX`*, `panStartY`*, `panEndX`*, `panEndY`* | float 0–1 | the crop centre (`params.panFrom` / `panTo` {x, y}), clamped inside the still | 0.5, 0.5, 0.6, 0.45 |
| `easeInOut`* | 0 / 1 | `params.easing`: 1 = ease-in-out, 0 = linear | 1 |
| `supersample`, `chunkFrames` | float, int | the still upscaled once before cropping; frames per encoded chunk | 2, 30 |
| `crossfade`* | float s | seconds at each seam (`params.crossfade`) | 1 |
| `fadeCurve`* | upload | the crossfade curve WAV the provider writes (11.5) | — |
| `headroomDb` | int dB | taken off before the loop's seams are summed | −3 |
| `format`*, `profile`* | string | VHS format and ProRes profile, from `params.format` | `video/ProRes`, `hq` |
| `peakNits` | float | SDR to HDR target peak white (0 = the calibrated curve) | 650 |
| `resolutionLevel`, `fovX`, `decimation` | int, float, int | MoGe detail 0–9; horizontal field of view in degrees (0 = estimate); mesh decimation | 9, 0, 1 |
| `cutout`, `numGaussians`, `splatFormat`, `orbitFrames` | bool, int, string, int | TripoSplat: BiRefNet cut-out (false = the image's alpha); Gaussians (≤ 1,048,576); `spz` / `ply` / `ksplat`; orbit length | true, 262144, `spz`, 75 |
| `frameWidth` | int px | the brief's frame width (a canonical `width` would be resized by the provider) | 384 |

Reused keys with a workflow-specific meaning: in the VACE / VOID graphs `startFrame` and `frames` count **source** frames (the graphs run at the clip's own fps), `width` × `height` is the work size and `prompt` describes the scene without the object (remove) or the result (swap / insert); `image` is the reference (swap / insert), the end card, the still or the subject; `mask` is a first-frame PNG read from its **red** channel, white = erase / the region; in the brief `frames` / `startFrame` count frames at the fixed 24 fps; `checkpoint` picks OvisOCR3 or a Qwen3.5 fallback, VACE 14B or 1.3B, MoGe 2 or 3; `instruction` defaults to the graph's own prompt (`defaults.instruction`).

The research named some keys differently; the library uses canonical keys instead: the brief's `frameCap` / `skipFrames` / `width` are `frames` / `startFrame` / `frameWidth`, and the audio graphs' curve upload is `fadeCurve` rather than `audio2` / `audio3` (which the provider fills with user audio). New manifest output roles: `lines`, `frame`, `frames`, `scene`, `depth`, `splat`, `brief` (typed in `src/lib/comfy.ts`; `turntable` already existed).

### 11.4 Models

| file | folder | GB | new? | used by |
|---|---|---|---|---|
| [`ovisocr3_0.8b_bf16.safetensors`](https://huggingface.co/ATH-MaaS/OvisOCR3/resolve/main/model.safetensors) (upstream `model.safetensors`, save it under this name) | text_encoders | 1.71 | new | ocr-lines-qwen35 |
| `qwen3.5_0.8b_bf16` / `qwen3.5_2b_bf16` / `qwen3.5_4b_bf16` (optional `checkpoint`) | text_encoders | 1.75 / 4.55 / 9.32 | optional (4B shared) | ocr-lines-qwen35 |
| `wan2.1_vace_14B_fp16`, `umt5_xxl_fp8_e4m3fn_scaled`, `wan_2.1_vae`, `lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16`, `sam3.1_multiplex_fp16` | … | 34.68 / 6.74 / 0.25 / 0.63 / 1.75 | shared | the four VACE graphs (SAM not in insert) |
| `wan2.1_vace_1.3B_fp16` (optional `checkpoint`, 8 GB cards) | diffusion_models | 4.31 | optional | VACE graphs |
| [`void_pass1` / `void_pass2`](https://huggingface.co/Comfy-Org/void-model) | diffusion_models | 2 × 11.14 | new | video-erase-void |
| `cogvideox_vae`, `raft_large_C_T_SKHT_V2-ff5fadd5` | vae / optical_flow | 0.43 / 0.02 | new | video-erase-void |
| `t5xxl_fp16` | text_encoders | 9.79 | shared (FLUX) | video-erase-void |
| [`moge_2_vitl_normal_fp16`](https://huggingface.co/Comfy-Org/MoGe) (`moge_3_vitl_fp16` 0.74, `moge_3_vitg_fp16` 2.50 optional) | geometry_estimation | 0.66 | new | scene-mesh-moge |
| [`triposplat_fp16`, `triposplat_vae_decoder_fp16`, `dino_v3_vit_h`](https://huggingface.co/VAST-AI/TripoSplat) | diffusion_models / vae / clip_vision | 0.74 / 0.58 / 1.68 | new | image-to-splat-triposplat |
| `flux2-vae`, `birefnet` | vae / background_removal | 0.34 / 0.44 | shared | image-to-splat-triposplat |
| `gemma4_e4b_it_fp8_scaled` | text_encoders | 9.06 | shared | reference-brief-gemma4 |

`build-library.mjs` knows two more loaders: `OpticalFlowLoader` (`optical_flow`) and `LoadMoGeModel` (`geometry_estimation`).

### 11.5 Quirks the app must handle

* **OCR output.** Role `lines` is a JSON array in reading order, `[{"bbox":[x0,y0,x1,y1],"text":…}]`, corners as integers **relative 0–1000** (checked against rendered ground truth in the research). Strip Markdown code fences, accept `bbox`/`text` and `bbox_2d`/`text_content` (the Qwen3.5 fallbacks answer that way), divide by 1000 and fill `OutputFile.meta.lines [{text, bbox:[x, y, w, h]}]` (normalised) and `OutputFile.text` (the lines joined by newlines). Role `frame` is `{"width","height","coords":"relative-1000"}`, the size the model saw. Greedy decoding: no seed.
* **VACE / VOID windows.** One window per job: `frames` (VACE 4n+1 ≤ 81; VOID rounds down to 8n+5, ≤ 197) from `startFrame`, both in source frames, computed with the fps of the clip's header (the provider's 16 fps default is wrong here). Longer clips: one job per window, joined with `video-concat-N` (seams untested). Give `width` × `height` the clip's shape: the window is centre-cropped to it and scaled back uncropped. The VACE result is pasted into the **original** frames through a 6 px soft mask, so nothing outside the mask changes; VOID re-renders the whole frame at its work size (672×384 by default). The window's sound is kept and a silent clip works (both checked on CPU with the VACE graph's own window nodes).
* **Painted masks** (`-painted`, insert): a PNG of the window's first frame in the clip's shape, read from the red channel (white = erase / the region). For a later window, paint on (or track to) that window's first frame. Insert holds the region for every frame, so it suits a static or slow camera.
* **Crossfade curve.** Core has no gain-ramp node, so the provider writes `fadeCurve`: a stereo 16-bit WAV exactly `crossfade` seconds long at 8 kHz, left = sin(π/2·t) (fade-in), right = cos(π/2·t) (fade-out), t = 0…1. 8 kHz makes `AudioMerge` upsample the curve, never resample the music. Equal power bumps a pure tone by ~3 dB at the seam (+2.1 dB RMS over the seam measured here); a linear curve avoids it for near-identical material. The loop needs a clip longer than 2 × `crossfade`; each loop pass stays cached (memory O(repeats² × clip)), so prefer clips ≥ 60 s. More than two clips: fold `audio-join-crossfade`.
* **Ken Burns.** ≤ 10 s per job (RAM grows by about one output frame per frame until ComfyUI's RAM-pressure cache evicts chunks); split longer scenes. Crops are whole pixels: keep `supersample` 2 and stills larger than the output.
* **Exports.** `params.format` → `video-export-pro` `format` + `profile`: `prores_422_hq` = `video/ProRes` + `hq`, `prores_4444` = + `4444`, `h265_10bit` = `video/h265-mp4`, `ffv1` = `video/ffv1-mkv`, `h264` = `video/h264-mp4`; `exr` → `video-export-exr`. VHS lists only `<prefix>_00001-audio.<ext>` (under `gifs`) when the clip has sound, and leaves a silent copy and a first-frame PNG next to it. The EXR output is one image per frame (role `frames`): zip it. All three decode the whole clip.
* **End card.** Only for clips the open engine made: a clip from another encoder fails in v0.41 with "Video chunk 1 could not be encoded compatibly: extradata … color space" (reproduced here). For those, use `still-to-clip` + `video-concat-sound1-2`. For a silent ad, drop nodes 2, 12 and 13 and node 14's `complete_audio` (`LoadAudio` stops with "No audio stream found in the file"). `width`, `height` and `fps` must be the clip's own.
* **Splat output.** `SaveGLB` writes the splat under its format's extension (`.spz` by default); set `meta.format` from it. `seed` drives the sampler and the decoder.
* **Brief.** `VHS_LoadVideo` forces 24 fps because Gemma 4 keeps every 24th frame (1 fps, ≤ 70 soft tokens each); 720 frames = the first 30 s. Strip fences before parsing. Whether E4B takes 30 s of audio in one call is unverified.

### 11.6 R4-15: CausVid licence fix

`wan21-vace-14b-ref2v` shipped the official template's `Wan21_CausVid_14B_T2V_lora_rank32` at 0.3, which is **CC-BY-NC-4.0** (tianweiy/CausVid). Its spec entry now swaps it (transforms on nodes 115, 108, 110) for the Apache-2.0 `lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16` at 1.0 (clip strength 0) with the round-4 VACE settings: 4 steps, cfg 1, `euler` (was `uni_pc`), shift 5 (was 8). It binds `loraStrength` (0 + steps 20 + cfg 6 = the slow full-quality path) and carries a `license`. Rebuilt and re-validated; the lightx2v + VACE 14B pairing is inferred, not GPU-tested.

### 11.7 Considered but not added

| option | why not |
|---|---|
| Florence-2 `OCR_WITH_REGION` | needs a pack (kijai/ComfyUI-Florence2), weaker on stylised text (inferred) |
| PaddleOCR-VL, DeepSeek-OCR, GOT-OCR 2.0 | custom packs only; document-oriented, 4× larger, or no line detection |
| MiniMax-Remover | CC-BY-NC-4.0 |
| DiffuEraser | relies on ProPainter priors (S-Lab licence, non-commercial, unverified) and SD 1.5 |
| MiniMax H3 Person-Remover / Character-Swap LoRAs | a 40–66 GB base + a 51.5 GB encoder; persons only; need a core change after v0.42 |
| SCAIL-2 Character Replacement | template exported by the research, not built (94 nodes); the recommended next step for whole-person swaps |
| A painted-mask or point-prompted swap | not researched; `video-swap-wan-vace` tracks a text prompt only |
| GIMM-VFI | slower than RIFE, licence unconfirmed ("other") |
| FPS boost to exact targets (`VHS_SelectEveryNthImage` after `FrameInterpolate`) | researched as a table, not built or timed |
| LTX-2.5 SDR-To-HDR / Alpha-Gen IC-LoRAs | revenue-gated LTX licence; a later round |
