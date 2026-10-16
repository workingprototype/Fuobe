# ComfyUI workflow library (Fuobe open-source engine)

_Generated 2026-10-16 by the `scripts/comfy` pipeline. Machine-readable source of truth: `workflows/comfyui/manifest.json`._

## 1. Summary

* **51 API-format workflows** in `workflows/comfyui/<id>.json`, all **validated** (`POST /prompt` accepted with no `node_errors`) against a real ComfyUI server: **51/51 validated**.
* Built against **ComfyUI 0.41.0 (commit `fc04da91b2ab12f99e4716371a7e4f98ac982597`, v0.41.0-7)**, frontend **1.55.17**, **comfyui-workflow-templates 0.11.86** (json 0.1.112, media-video 0.3.101, media-image 0.3.160, media-other 0.3.229).
* 45 come from **official templates** (converted to API format by the real frontend: `app.loadGraphData()` → `app.graphToPrompt()`), 2 from **custom-node example workflows**, 4 are **hand-built** from `/object_info` definitions. Modifications are listed in each entry's `notes` and flagged `(modified, see notes)` in `source`.
* Everything except 5 workflows runs on **core ComfyUI nodes only** — in 2026 core ComfyUI natively covers InfiniteTalk, SeedVR2, BiRefNet, RIFE/FILM, Wan Animate 2, LTX-2.x, so custom packs are only needed for: ReActor face swap, RMBG, MMAudio, the WanVideoWrapper InfiniteTalk variant, and the RIFE-VFI variant (plus VHS/KJNodes helpers).
* 86 distinct model files, **740 GB** if you download everything. A sensible starter set (Z-Image Turbo, Qwen-Image-Edit 2509, Wan 2.2 5B, Wan 2.2 14B I2V lightx2v, BiRefNet, RealESRGAN, RIFE, ACE-Step) is ≈ 112 GB.
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

The manifest `outputs[]` lists the node ids to read (other nodes produce nothing: preview/compare outputs of the templates were removed). Progress: open `ws://<host>/ws?clientId=<client_id>` (same `client_id` as in `/prompt`) for `progress`, `executing`, `executed`, `execution_success`, `execution_error` messages. Cancel: `POST /interrupt {"prompt_id": …}`, `POST /queue {"delete": [prompt_id]}`. Model presence: `GET /models/<folder>` (folders used by the library: `diffusion_models`, `checkpoints`, `text_encoders`, `vae`, `loras`, `clip_vision`, `upscale_models`, `audio_encoders`, `model_patches`, `latent_upscale_models`, `background_removal`, `frame_interpolation`, `mmaudio`, `insightface`, `facerestore_models`).

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
| [kijai/ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) | `17195fc` | ok | infinitetalk-wanwrapper |
| [numz/ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) | `4490bd1` | **import fails on CPU** (device combo) — not used; core SeedVR2 used instead | — |
| [Fannovel16/ComfyUI-Frame-Interpolation](https://github.com/Fannovel16/ComfyUI-Frame-Interpolation) | `26545cc` | ok (no cupy) | interpolate-rife-vfi |
| [1038lab/ComfyUI-RMBG](https://github.com/1038lab/ComfyUI-RMBG) | `229529e` | ok (after installing triton, decord, pycocotools) | bg-remove-rmbg |
| [Gourieff/ComfyUI-ReActor](https://github.com/Gourieff/ComfyUI-ReActor) | `3be5f35` | ok (insightface 2.1 wheel) | face-swap-reactor |
| [kijai/ComfyUI-MMAudio](https://github.com/kijai/ComfyUI-MMAudio) | `8eaeb72` | ok | v2a-mmaudio |

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
* `npm run validate` creates zero-byte placeholder models (deleted afterwards), uploads fixtures, fills every binding with sample values and `POST /prompt` (ComfyUI validates synchronously inside that request). To guarantee nothing executes, a "blocker" prompt (chain of 1-second KJNodes `Sleep` nodes) first occupies ComfyUI's single worker, so each validation prompt is merely *pending* and is removed right away with `POST /queue {"delete":[id]}`; at the end the blocker is interrupted and `POST /queue {"clear":true}` + `POST /interrupt` are sent (`--shared` skips these global calls). This matters because several nodes download weights as soon as they execute (RMBG, RIFE VFI, wav2vec, ReActor). It updates `manifest.json` and writes `object_info.subset.json` (147 node classes). It can be pointed at a real GPU server (`COMFYUI_URL`, `COMFYUI_DIR`) — it never overwrites real model files.
* To upgrade templates: bump `comfyui-workflow-templates` (ComfyUI `requirements.txt`), re-run; the build fails loudly if a bound node/input disappeared.
