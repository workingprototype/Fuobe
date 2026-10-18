// Curated definition of every workflow Fuobe ships for its open-source (ComfyUI) engine.
//
// Each entry starts from either
//   export:    a source exported to API format by export-templates.mjs (official template
//              name, or a custom-node example workflow path relative to COMFYUI_DIR), or
//   handBuilt: an API-format JSON in scripts/comfy/hand-built/
// then applies `transforms` (see lib/graph.mjs), and declares bindings/outputs/etc.
//
// build-library.mjs turns this into workflows/comfyui/<id>.json + manifest.json.
// Node ids in bindings refer to the FINAL workflow (after transforms). Ids like "129:98"
// are subgraph-instance ids produced by the frontend's graphToPrompt (subgraph 129, inner node 98).
//
// Binding vocabulary (manifest "bindings" keys):
//   prompt, negativePrompt, image, image2, image3, image4, mask, endImage, video, audio,
//   width, height, frames, fps, seed, steps, cfg, guidance, denoise, shift,
//   loraHigh, loraLow, lora, loraStrength, upscaleModel, scale, duration, lyrics, tags
// Extra keys introduced by this library (documented in docs/research/comfyui-workflow-library.md):
//   padLeft, padTop, padRight, padBottom  (outpaint padding, px, multiples of 8)
//   cameraMotion                          (Wan Fun Camera preset name)
//   multiplier                            (frame-interpolation factor, int)
//   bpm                                   (ACE-Step tempo)
//   filenamePrefix                        (every output node's filename_prefix; optional)
// Keys added with the comfyui-oss-2 workflows (docs/research/comfyui-oss-2.md):
//   audio2                                (second audio upload: dialogue speaker B / voice-change target voice)
//   video2, video3, video4                (further video uploads: shots 2..4 of video-concat-*)
//   language                              (Chatterbox Multilingual language, combo string e.g. "German (de)")
//   exaggeration, temperature             (Chatterbox emotion exaggeration 0.25-2 / sampling temperature 0.05-2)
//   contextFrames                         (video-extend: known tail frames of the source fed as context, multiple of 4)
//   tracks                                (Wan-Move motion paths: JSON string [[{"x":px,"y":px}, ... one per frame], ...])
//   motionStrength                        (Wan-Move track conditioning strength, float, default 1)
//   strength                              (ColorTransfer strength 0-10, default 0.8)
// Keys added with the comfyui-oss-3 workflows (docs/research/comfyui-oss-3.md). The provider fills the ones marked *
// from Fuobe's canonical request; every other key is a model slider/control (params.extra[key]):
//   startTime*                            (trim start, seconds: params.startTime)
//   startFrame*                           (frames to skip after resampling: round(params.startTime * fps))
//   numLayers*                            (Qwen-Image-Layered: how many RGBA layers, params.numLayers)
//   maxSize                               (longest side the input is scaled to, px)
//   paletteText*, paletteImage*           (Soul HEX: "Color palette: #..." and the swatch PNG rendered from params.palette)
//   method                                (ColorTransfer method: mkl_lab | reinhard_lab | histogram)
//   controlStrength                       (ControlNet / VACE control strength)
//   framesPerBatch                        (VHS meta-batch size: frames per re-queued pass)
//   checkpoint                            (checkpoint file name, e.g. Stable Audio 3 small vs medium)
//   description                           (ThinkSound chain-of-thought sound description)
//   instruction*                          (LLM instruction; "{language}" is replaced with params.targetLanguage)
//   maxTokens                             (TextGenerate max_length)
//   sourceLanguage*                       (ASR language combo, e.g. "English"; params.sourceLanguage, "auto" = detect)
//   asrModel, hints, maxChars             (Qwen3-ASR model id, context hotwords, max characters per caption cue)
//   backgroundVolumeDb                    (mux: background stem gain in dB)
//   startStep, audioScale                 (InfiniteTalk V2V: first re-denoised step, audio conditioning scale)
//   lengthMode, lipsExpression            (LatentSync VideoLengthAdjuster mode, lips expression strength)
//   whisperModel                          (ComfyUI-Whisper model name)
//   fontSize, fontColor, captionPosition  (caption style: % of the frame height / Whisper px, colour, top | bottom)
//   textureSize, turntableFps             (TRELLIS.2 baked texture size, turntable video fps)
//   octreeResolution                      (Hunyuan3D 2.1 mesh resolution)
//   columns, rows                         (ImageGridtoBatch: how the sheet is cut into tiles)
//   gridPrompt, sheetPrompt               (contact-sheet / turnaround framing text placed before the prompt)
// Output fields beyond {node, kind}: stem ("voice" | "background"), role ("cues" | "transcript" | "language" |
// "sheet" | "tiles" | "layers" | "first-frame" | "turntable"). Entry fields: worker "isolated" (needs its own ComfyUI,
// see README), expand "captions" (the provider writes one segment per caption cue before submitting).

const b = (node, input) => ({ node, input });

export const CUSTOM_NODE_REPOS = {
  'ComfyUI-WanVideoWrapper': 'https://github.com/kijai/ComfyUI-WanVideoWrapper',
  'ComfyUI-VideoHelperSuite': 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite',
  'ComfyUI-KJNodes': 'https://github.com/kijai/ComfyUI-KJNodes',
  'ComfyUI-SeedVR2_VideoUpscaler': 'https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler',
  'ComfyUI-Frame-Interpolation': 'https://github.com/Fannovel16/ComfyUI-Frame-Interpolation',
  'ComfyUI-RMBG': 'https://github.com/1038lab/ComfyUI-RMBG',
  'ComfyUI-ReActor': 'https://github.com/Gourieff/ComfyUI-ReActor',
  'ComfyUI-MMAudio': 'https://github.com/kijai/ComfyUI-MMAudio',
  'ComfyUI_Fill-ChatterBox': 'https://github.com/filliptm/ComfyUI_Fill-ChatterBox',
  'ComfyUI-IndexTTS2': 'https://github.com/snicolast/ComfyUI-IndexTTS2',
  'ComfyUI-Video-Depth-Anything': 'https://github.com/yuvraj108c/ComfyUI-Video-Depth-Anything',
  // comfyui-oss-3 packs (pinned in install-comfyui.sh)
  'ComfyUI-MelBandRoFormer': 'https://github.com/kijai/ComfyUI-MelBandRoFormer',
  'ComfyUI-QwenASR': 'https://github.com/1038lab/ComfyUI-QwenASR',
  'ComfyUI-HunyuanVideo-Foley': 'https://github.com/phazei/ComfyUI-HunyuanVideo-Foley',
  'ComfyUI-Whisper': 'https://github.com/yuvraj108c/ComfyUI-Whisper',
  // isolated worker only (process-wide side effects / old pins), see scripts/comfy/README.md
  'ComfyUI-LatentSyncWrapper': 'https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper',
  'ComfyUI-ThinkSound_Wrapper': 'https://github.com/ShmuelRonen/ComfyUI-ThinkSound_Wrapper',
};

// Model download locations for files that the source workflow does not annotate
// (UI templates usually carry node.properties.models; custom-node examples do not).
export const KNOWN_MODELS = {
  'RealESRGAN_x4plus.safetensors': { folder: 'upscale_models', url: 'https://huggingface.co/Comfy-Org/Real-ESRGAN_repackaged/resolve/main/RealESRGAN_x4plus.safetensors' },
  'birefnet.safetensors': { folder: 'background_removal', url: 'https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors' },
  'film_net_fp16.safetensors': { folder: 'frame_interpolation', url: 'https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/film_net_fp16.safetensors' },
  'rife_v4.26.safetensors': { folder: 'frame_interpolation', url: 'https://huggingface.co/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/rife_v4.26.safetensors' },
  'inswapper_128.onnx': { folder: 'insightface', url: 'https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/inswapper_128.onnx' },
  'GFPGANv1.4.pth': { folder: 'facerestore_models', url: 'https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/facerestore_models/GFPGANv1.4.pth' },
  'mmaudio_large_44k_v2_fp16.safetensors': { folder: 'mmaudio', url: 'https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_large_44k_v2_fp16.safetensors' },
  'mmaudio_vae_44k_fp16.safetensors': { folder: 'mmaudio', url: 'https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_vae_44k_fp16.safetensors' },
  'mmaudio_synchformer_fp16.safetensors': { folder: 'mmaudio', url: 'https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_synchformer_fp16.safetensors' },
  'apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors': { folder: 'mmaudio', url: 'https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors' },
  'wan2.1-i2v-14b-480p-Q8_0.gguf': { folder: 'diffusion_models', url: 'https://huggingface.co/city96/Wan2.1-I2V-14B-480P-gguf/resolve/main/wan2.1-i2v-14b-480p-Q8_0.gguf' },
  'Wan2_1-InfiniteTalk_Single_Q8.gguf': { folder: 'diffusion_models', url: 'https://huggingface.co/Kijai/WanVideo_comfy_GGUF/resolve/main/InfiniteTalk/Wan2_1-InfiniteTalk_Single_Q8.gguf' },
  'lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors': { folder: 'loras', url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors' },
  'Wan2_1_VAE_bf16.safetensors': { folder: 'vae', url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_VAE_bf16.safetensors' },
  'umt5-xxl-enc-bf16.safetensors': { folder: 'text_encoders', url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/umt5-xxl-enc-bf16.safetensors' },
  'wan2.1_infiniteTalk_single_fp16.safetensors': { folder: 'model_patches', url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/model_patches/wan2.1_infiniteTalk_single_fp16.safetensors' },
  'clip_vision_h.safetensors': { folder: 'clip_vision', url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors' },
  // comfyui-oss-2 additions (hand-built graphs carry no template model metadata)
  'umt5_xxl_fp8_e4m3fn_scaled.safetensors': { folder: 'text_encoders', url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors' },
  'wan_2.1_vae.safetensors': { folder: 'vae', url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors' },
  'wan2.2_fun_vace_high_noise_14B_fp8_scaled.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_vace_high_noise_14B_fp8_scaled.safetensors' },
  'wan2.2_fun_vace_low_noise_14B_fp8_scaled.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_vace_low_noise_14B_fp8_scaled.safetensors' },
  'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors': { folder: 'loras', url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors' },
  'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors': { folder: 'loras', url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors' },
  'qwen_image_edit_2509_fp8_e4m3fn.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors' },
  'qwen_2.5_vl_7b_fp8_scaled.safetensors': { folder: 'text_encoders', url: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors' },
  'qwen_image_vae.safetensors': { folder: 'vae', url: 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors' },
  'Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors': { folder: 'loras', url: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors' },
  'Qwen-Image-Edit-2509-Relight.safetensors': { folder: 'loras', url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Relight.safetensors' },
  'Qwen-Image-Edit-2509-Light-Migration.safetensors': { folder: 'loras', url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Image-Edit-2509-Light-Migration.safetensors' },
  'next-scene_lora-v2-3000.safetensors': { folder: 'loras', url: 'https://huggingface.co/lovis93/next-scene-qwen-image-lora-2509/resolve/main/next-scene_lora-v2-3000.safetensors' },
  'wan2.2_bernini_r_high_noise_fp8_scaled.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Comfy-Org/Bernini-R/resolve/main/diffusion_models/wan2.2_bernini_r_high_noise_fp8_scaled.safetensors' },
  'wan2.2_bernini_r_low_noise_fp8_scaled.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Comfy-Org/Bernini-R/resolve/main/diffusion_models/wan2.2_bernini_r_low_noise_fp8_scaled.safetensors' },
  'lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors': { folder: 'loras', url: 'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors' },
  'Wan21-WanMove_fp8_scaled_e4m3fn_KJ.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/WanMove/Wan21-WanMove_fp8_scaled_e4m3fn_KJ.safetensors' },
  'sam3.1_multiplex_fp16.safetensors': { folder: 'checkpoints', url: 'https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors' },
  'depth_anything_3_mono_large.safetensors': { folder: 'geometry_estimation', url: 'https://huggingface.co/Comfy-Org/Depth-Anything-3/resolve/main/geometry_estimation/depth_anything_3_mono_large.safetensors' },
  // comfyui-oss-3 additions (docs/research/comfyui-oss-3.json, sizes from the Hugging Face tree API)
  'z_image_turbo_bf16.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors' },
  'qwen_3_4b.safetensors': { folder: 'text_encoders', url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors' },
  'ae.safetensors': { folder: 'vae', url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors' },
  'Z-Image-Turbo-Fun-Controlnet-Union.safetensors': { folder: 'model_patches', url: 'https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union/resolve/main/Z-Image-Turbo-Fun-Controlnet-Union.safetensors' },
  'qwen_image_layered_fp8mixed.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Layered_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_layered_fp8mixed.safetensors' },
  'qwen_image_layered_control_bf16.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/DiffSynth-Studio/Qwen-Image-Layered-Control/resolve/main/qwen_image_layered_control_bf16.safetensors' },
  'qwen_image_layered_vae.safetensors': { folder: 'vae', url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Layered_ComfyUI/resolve/main/split_files/vae/qwen_image_layered_vae.safetensors' },
  'qwen_image_edit_2511_fp8mixed.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors' },
  'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors': { folder: 'loras', url: 'https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors' },
  'flux-2-klein-4b-fp8.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/resolve/main/flux-2-klein-4b-fp8.safetensors' },
  'flux2-vae.safetensors': { folder: 'vae', url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors' },
  'tryon-klein-4b.safetensors': { folder: 'loras', url: 'https://huggingface.co/xocialize/tryon-FLUX.2-klein-4B-lora/resolve/main/tryon-klein-4b.safetensors' },
  'krea2_turbo_int8_convrot.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_int8_convrot.safetensors' },
  'qwen3vl_4b_fp8_scaled.safetensors': { folder: 'text_encoders', url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors' },
  'krea2_style_reference.safetensors': { folder: 'loras', url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/krea2_style_reference.safetensors' },
  'flux1-dev-fp8.safetensors': { folder: 'checkpoints', url: 'https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors' },
  'uso-flux1-dit-lora-v1.safetensors': { folder: 'loras', url: 'https://huggingface.co/Comfy-Org/USO_1.0_Repackaged/resolve/main/split_files/loras/uso-flux1-dit-lora-v1.safetensors' },
  'uso-flux1-projector-v1.safetensors': { folder: 'model_patches', url: 'https://huggingface.co/Comfy-Org/USO_1.0_Repackaged/resolve/main/split_files/model_patches/uso-flux1-projector-v1.safetensors' },
  'sigclip_vision_patch14_384.safetensors': { folder: 'clip_vision', url: 'https://huggingface.co/Comfy-Org/sigclip_vision_384/resolve/main/sigclip_vision_patch14_384.safetensors' },
  'stable_audio_3_small_sfx.safetensors': { folder: 'checkpoints', url: 'https://huggingface.co/Comfy-Org/stable-audio-3/resolve/main/checkpoints/stable_audio_3_small_sfx.safetensors' },
  't5gemma_b_b_ul2.safetensors': { folder: 'text_encoders', url: 'https://huggingface.co/Comfy-Org/stable-audio-3/resolve/main/text_encoders/t5gemma_b_b_ul2.safetensors' },
  'stable-audio-open-1.0.safetensors': { folder: 'checkpoints', url: 'https://huggingface.co/Comfy-Org/stable-audio-open-1.0_repackaged/resolve/main/stable-audio-open-1.0.safetensors' },
  't5-base.safetensors': { folder: 'text_encoders', url: 'https://huggingface.co/ComfyUI-Wiki/t5-base/resolve/main/t5-base.safetensors' },
  'hunyuanvideo_foley_xl_fp8_e4m3fn.safetensors': { folder: 'foley', url: 'https://huggingface.co/phazei/HunyuanVideo-Foley/resolve/main/hunyuanvideo_foley_xl_fp8_e4m3fn.safetensors' },
  'vae_128d_48k_fp16.safetensors': { folder: 'foley', url: 'https://huggingface.co/phazei/HunyuanVideo-Foley/resolve/main/vae_128d_48k_fp16.safetensors' },
  'synchformer_state_dict_fp16.safetensors': { folder: 'foley', url: 'https://huggingface.co/phazei/HunyuanVideo-Foley/resolve/main/synchformer_state_dict_fp16.safetensors' },
  'thinksound_light.ckpt': { folder: 'thinksound', url: 'https://huggingface.co/FunAudioLLM/ThinkSound/resolve/main/thinksound_light.ckpt' },
  'vae.ckpt': { folder: 'thinksound', url: 'https://huggingface.co/FunAudioLLM/ThinkSound/resolve/main/vae.ckpt' },
  'synchformer_state_dict.pth': { folder: 'thinksound', url: 'https://huggingface.co/FunAudioLLM/ThinkSound/resolve/main/synchformer_state_dict.pth' },
  'MelBandRoformer_fp16.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Kijai/MelBandRoFormer_comfy/resolve/main/MelBandRoformer_fp16.safetensors' },
  'qwen3.5_4b_bf16.safetensors': { folder: 'text_encoders', url: 'https://huggingface.co/Comfy-Org/Qwen3.5/resolve/main/text_encoders/qwen3.5_4b_bf16.safetensors' },
  'gemma4_e4b_it_fp8_scaled.safetensors': { folder: 'text_encoders', url: 'https://huggingface.co/Comfy-Org/gemma-4/resolve/main/text_encoders/gemma4_e4b_it_fp8_scaled.safetensors' },
  'trellis_2_int8_convrot.safetensors': { folder: 'diffusion_models', url: 'https://huggingface.co/Comfy-Org/TRELLIS.2/resolve/main/diffusion_models/trellis_2_int8_convrot.safetensors' },
  'trellis_2_shape_vae_bf16.safetensors': { folder: 'vae', url: 'https://huggingface.co/Comfy-Org/Pixal3D/resolve/main/vae/trellis_2_shape_vae_bf16.safetensors' },
  'trellis_2_texture_vae_bf16.safetensors': { folder: 'vae', url: 'https://huggingface.co/Comfy-Org/Pixal3D/resolve/main/vae/trellis_2_texture_vae_bf16.safetensors' },
  'dino_v3_L_naf_fp32.safetensors': { folder: 'clip_vision', url: 'https://huggingface.co/Comfy-Org/Pixal3D/resolve/main/clip_vision/dino_v3_L_naf_fp32.safetensors' },
  'hunyuan_3d_v2.1.safetensors': { folder: 'checkpoints', url: 'https://huggingface.co/Comfy-Org/hunyuan3D_2.1_repackaged/resolve/main/hunyuan_3d_v2.1.safetensors' },
};

const WAN_NEG_EN =
  'bright colors, overexposed, static, blurry details, subtitles, style, artwork, painting, still image, overall gray, worst quality, low quality, JPEG artifacts, ugly, deformed, extra fingers, poorly drawn hands, poorly drawn face, malformed, disfigured, fused fingers, motionless, cluttered background, three legs, crowded background, walking backwards';

// ---------------------------------------------------------------------------
// Wan 2.2 14B text/image-to-video: base + official lightx2v 4-step variant
// ---------------------------------------------------------------------------
function wanT2V(lightx2v) {
  return {
    id: lightx2v ? 'wan22-t2v-14b-lightx2v' : 'wan22-t2v-14b',
    title: lightx2v ? 'Wan 2.2 14B Text to Video (lightx2v 4-step)' : 'Wan 2.2 14B Text to Video',
    capability: 't2v',
    export: 'video_wan2_2_14B_t2v',
    transforms: [
      { op: 'resolveSwitches', booleans: { '128:129': lightx2v } },
      // frames = floor(duration*fps)+1 in the template; we expose frames directly.
      { op: 'set', node: '128:74', input: 'length', value: 81 },
    ],
    bindings: {
      prompt: [b('128:89', 'text')],
      negativePrompt: [b('128:72', 'text')],
      width: [b('128:74', 'width')],
      height: [b('128:74', 'height')],
      frames: [b('128:74', 'length')],
      fps: [b('128:125', 'value')],
      seed: [b('128:81', 'noise_seed'), b('128:78', 'noise_seed')],
      steps: [b(lightx2v ? '128:117' : '128:114', 'value')],
      cfg: [b(lightx2v ? '128:119' : '128:116', 'value')],
      shift: [b('128:82', 'shift'), b('128:86', 'shift')],
    },
    outputs: [{ node: '80', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 24,
    notes:
      'Two-expert MoE: high-noise model runs the first half of the steps, low-noise model the rest. ' +
      `The high/low split step is a separate primitive (${lightx2v ? '2 of 4' : '10 of 20'}); if you change steps, keep it roughly at steps/2 (not exposed as a binding). ` +
      'Default 640x640, 81 frames @16 fps (5 s); 1280x720 works on 24 GB+ with offloading. ' +
      (lightx2v ? 'Uses the official Wan2.2 lightx2v 4-step LoRAs (cfg 1): ~5x faster, less motion.' : 'Template default 20 steps, cfg 3.5.'),
  };
}

function wanI2V(variant) {
  const light = variant === 'lightx2v';
  const lora = variant === 'lora';
  const id = light ? 'wan22-i2v-14b-lightx2v' : lora ? 'wan22-i2v-14b-lora' : 'wan22-i2v-14b';
  const transforms = [
    { op: 'resolveSwitches', booleans: { '129:131': light } },
    { op: 'set', node: '129:98', input: 'length', value: 81 },
  ];
  if (lora) {
    transforms.push(
      { op: 'prune' },
      {
        op: 'insertAfter',
        source: ['129:95', 0], // high-noise UNETLoader
        id: '1001',
        node: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'wan22_i2v_effect_high_noise.safetensors', strength_model: 1.0 }, _meta: { title: 'LoRA (high noise)' } },
        input: 'model',
      },
      {
        op: 'insertAfter',
        source: ['129:96', 0], // low-noise UNETLoader
        id: '1002',
        node: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'wan22_i2v_effect_low_noise.safetensors', strength_model: 1.0 }, _meta: { title: 'LoRA (low noise)' } },
        input: 'model',
      },
    );
  }
  const bindings = {
    prompt: [b('129:93', 'text')],
    negativePrompt: [b('129:89', 'text')],
    image: [b('97', 'image')],
    width: [b('129:98', 'width')],
    height: [b('129:98', 'height')],
    frames: [b('129:98', 'length')],
    fps: [b('129:162', 'value')],
    seed: [b('129:86', 'noise_seed'), b('129:85', 'noise_seed')],
    steps: [b(light ? '129:118' : '129:128', 'value')],
    cfg: [b(light ? '129:122' : '129:126', 'value')],
    shift: [b('129:104', 'shift'), b('129:103', 'shift')],
  };
  if (lora) {
    bindings.loraHigh = [b('1001', 'lora_name')];
    bindings.loraLow = [b('1002', 'lora_name')];
    bindings.loraStrength = [b('1001', 'strength_model'), b('1002', 'strength_model')];
  }
  return {
    id,
    title: light ? 'Wan 2.2 14B Image to Video (lightx2v 4-step)' : lora ? 'Wan 2.2 14B Image to Video + LoRA (camera/VFX)' : 'Wan 2.2 14B Image to Video',
    capability: lora ? 'vfx' : 'i2v',
    export: 'video_wan2_2_14B_i2v',
    transforms,
    bindings,
    outputs: [{ node: '108', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 24,
    notes:
      (lora
        ? 'Derived from the official template: LoraLoaderModelOnly inserted after BOTH the high-noise (node 1001) and low-noise (node 1002) UNETLoader. ' +
          'Wan 2.2 effect/camera LoRAs ship as high/low pairs; loraHigh and loraLow must both name files present in models/loras (the default names are placeholders, not downloadable). ' +
          'For a LoRA that only has one file, pass the same file for both (or use wan22-i2v-14b if no LoRA is wanted); loraStrength applies to both. '
        : '') +
      `High/low split step fixed at ${light ? '2 of 4' : '10 of 20'} (not a binding). Default 640x640, 81 frames @16 fps. ` +
      (light ? 'Official lightx2v 4-step LoRAs, cfg 1.' : 'Template default 20 steps, cfg 3.5.'),
  };
}

export const SPEC = [
  // =========================================================================
  // IMAGE
  // =========================================================================
  {
    id: 'flux1-dev-t2i',
    title: 'FLUX.1 [dev] Text to Image',
    capability: 't2i',
    export: 'flux_dev_full_text_to_image',
    transforms: [
      // Expose guidance: the template relies on the model default (3.5); add an explicit FluxGuidance.
      { op: 'insertAfter', source: ['194:49', 0], id: '1001', node: { class_type: 'FluxGuidance', inputs: { guidance: 3.5 }, _meta: { title: 'FluxGuidance' } }, input: 'conditioning', only: ['194:50'] },
    ],
    bindings: {
      prompt: [b('194:49', 'text')],
      width: [b('194:48', 'width')],
      height: [b('194:48', 'height')],
      seed: [b('194:50', 'seed')],
      steps: [b('194:50', 'steps')],
      guidance: [b('1001', 'guidance')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 24,
    notes: 'No negative prompt (cfg 1, distilled guidance). FluxGuidance node 1001 added so guidance is bindable (template implicit default is also 3.5). fp16 weights (23.8 GB) — ComfyUI offloads on 16-24 GB cards; set weight_dtype fp8 in node 194:46 for lower VRAM.',
  },
  {
    id: 'flux1-krea-dev-t2i',
    title: 'FLUX.1 Krea [dev] Text to Image',
    capability: 't2i',
    export: 'flux1_krea_dev',
    transforms: [
      { op: 'insertAfter', source: ['200:195', 0], id: '1001', node: { class_type: 'FluxGuidance', inputs: { guidance: 3.5 }, _meta: { title: 'FluxGuidance' } }, input: 'conditioning', only: ['200:197'] },
    ],
    bindings: {
      prompt: [b('200:195', 'text')],
      width: [b('200:196', 'width')],
      height: [b('200:196', 'height')],
      seed: [b('200:197', 'seed')],
      steps: [b('200:197', 'steps')],
      guidance: [b('1001', 'guidance')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 16,
    notes: 'Photorealistic "opinionated" FLUX.1 dev fine-tune by Krea (fp8 scaled weights). Shares text encoders + ae.safetensors with flux1-dev-t2i.',
  },
  {
    id: 'flux1-schnell-t2i',
    title: 'FLUX.1 [schnell] Text to Image',
    capability: 't2i',
    export: 'flux_schnell_full_text_to_image',
    bindings: {
      prompt: [b('41', 'clip_l'), b('41', 't5xxl')],
      width: [b('27', 'width')],
      height: [b('27', 'height')],
      seed: [b('31', 'seed')],
      steps: [b('31', 'steps')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 24,
    notes: '4-step distilled, Apache-2.0 licence (commercial OK). Prompt goes to both CLIP-L and T5 fields of CLIPTextEncodeFlux. Guidance is ignored by schnell.',
  },
  {
    id: 'flux2-dev-t2i',
    title: 'FLUX.2 [dev] Text to Image',
    capability: 't2i',
    export: 'image_flux2_text_to_image',
    transforms: [{ op: 'resolveSwitches', booleans: { '98:104': false } }],
    bindings: {
      prompt: [b('98:6', 'text')],
      width: [b('98:47', 'width'), b('98:48', 'width')],
      height: [b('98:47', 'height'), b('98:48', 'height')],
      seed: [b('98:25', 'noise_seed')],
      steps: [b('98:100', 'value')],
      guidance: [b('98:26', 'guidance')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 32,
    notes: 'Mistral-Small text encoder (18 GB bf16) + 32B fp8mixed transformer; needs ~64 GB system RAM for offloading on 24 GB cards. Width/height must be set on BOTH the latent and the Flux2Scheduler (both listed).',
  },
  {
    id: 'flux2-dev-t2i-turbo',
    title: 'FLUX.2 [dev] Text to Image (Turbo LoRA, 8-step)',
    capability: 't2i',
    export: 'image_flux2_text_to_image',
    transforms: [{ op: 'resolveSwitches', booleans: { '98:104': true } }],
    bindings: {
      prompt: [b('98:6', 'text')],
      width: [b('98:47', 'width'), b('98:48', 'width')],
      height: [b('98:47', 'height'), b('98:48', 'height')],
      seed: [b('98:25', 'noise_seed')],
      steps: [b('98:99', 'value')],
      guidance: [b('98:26', 'guidance')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 32,
    notes: 'Same as flux2-dev-t2i with the official template\'s "Enable Turbo LoRA" path (Flux_2-Turbo-LoRA, 8 steps).',
  },
  {
    id: 'flux2-dev-edit',
    title: 'FLUX.2 [dev] Image Edit (1 reference)',
    capability: 'edit',
    export: 'image_flux2',
    transforms: [{ op: 'resolveSwitches', booleans: { '68:94': false } }],
    bindings: {
      prompt: [b('68:6', 'text')],
      image: [b('46', 'image')],
      seed: [b('68:25', 'noise_seed')],
      steps: [b('68:91', 'value')],
      guidance: [b('68:26', 'guidance')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 32,
    notes: 'Output size follows the input image rescaled to ~1 megapixel (ImageScaleToTotalPixels node 45, megapixels=1).',
  },
  {
    id: 'flux2-dev-multiref',
    title: 'FLUX.2 [dev] Multi-Reference Edit (3 images)',
    capability: 'edit',
    export: 'image_flux2',
    transforms: [
      { op: 'resolveSwitches', booleans: { '68:94': false } },
      {
        op: 'addNodes',
        nodes: {
          1101: { class_type: 'LoadImage', inputs: { image: 'reference2.png' }, _meta: { title: 'Load Image (reference 2)' } },
          1102: { class_type: 'ImageScaleToTotalPixels', inputs: { image: ['1101', 0], upscale_method: 'lanczos', megapixels: 1, resolution_steps: 1 }, _meta: { title: 'Scale reference 2' } },
          1103: { class_type: 'VAEEncode', inputs: { pixels: ['1102', 0], vae: ['68:10', 0] }, _meta: { title: 'VAE Encode (reference 2)' } },
          1111: { class_type: 'LoadImage', inputs: { image: 'reference3.png' }, _meta: { title: 'Load Image (reference 3)' } },
          1112: { class_type: 'ImageScaleToTotalPixels', inputs: { image: ['1111', 0], upscale_method: 'lanczos', megapixels: 1, resolution_steps: 1 }, _meta: { title: 'Scale reference 3' } },
          1113: { class_type: 'VAEEncode', inputs: { pixels: ['1112', 0], vae: ['68:10', 0] }, _meta: { title: 'VAE Encode (reference 3)' } },
        },
      },
      { op: 'insertAfter', source: ['68:43', 0], id: '1104', node: { class_type: 'ReferenceLatent', inputs: { latent: ['1103', 0] }, _meta: { title: 'Set Reference Latent (2)' } }, input: 'conditioning' },
      { op: 'insertAfter', source: ['1104', 0], id: '1114', node: { class_type: 'ReferenceLatent', inputs: { latent: ['1113', 0] }, _meta: { title: 'Set Reference Latent (3)' } }, input: 'conditioning' },
    ],
    bindings: {
      prompt: [b('68:6', 'text')],
      image: [b('46', 'image')],
      image2: [b('1101', 'image')],
      image3: [b('1111', 'image')],
      seed: [b('68:25', 'noise_seed')],
      steps: [b('68:91', 'value')],
      guidance: [b('68:26', 'guidance')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 32,
    notes: 'Official FLUX.2 edit template extended with two more chained ReferenceLatent inputs (FLUX.2 supports up to ~10). All three images are required; refer to them in the prompt as "image 1/2/3". Output size follows image 1 (~1 MP).',
  },
  {
    id: 'qwen-image-2512-t2i',
    title: 'Qwen-Image 2512 Text to Image',
    capability: 't2i',
    export: 'image_qwen_Image_2512',
    transforms: [{ op: 'resolveSwitches', booleans: { '238:229': false } }],
    bindings: {
      prompt: [b('238:227', 'text')],
      negativePrompt: [b('238:228', 'text')],
      width: [b('238:232', 'width')],
      height: [b('238:232', 'height')],
      seed: [b('238:230', 'seed')],
      steps: [b('238:224', 'value')],
      cfg: [b('238:223', 'value')],
      shift: [b('238:222', 'shift')],
    },
    outputs: [{ node: '60', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 24,
    notes: 'Best open model for in-image text rendering (EN/ZH). Native 1328x1328; recommended sizes 1664x928 (16:9), 928x1664 (9:16), 1472x1104 (4:3). 50 steps cfg 4 by default.',
  },
  {
    id: 'qwen-image-2512-t2i-lightning',
    title: 'Qwen-Image 2512 Text to Image (Lightning 4-step)',
    capability: 't2i',
    export: 'image_qwen_Image_2512',
    transforms: [{ op: 'resolveSwitches', booleans: { '238:229': true } }],
    bindings: {
      prompt: [b('238:227', 'text')],
      negativePrompt: [b('238:228', 'text')],
      width: [b('238:232', 'width')],
      height: [b('238:232', 'height')],
      seed: [b('238:230', 'seed')],
      steps: [b('238:225', 'value')],
      cfg: [b('238:218', 'value')],
      shift: [b('238:222', 'shift')],
    },
    outputs: [{ node: '60', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 24,
    notes: 'Official template with "Enable 4 Steps LoRA" on (Qwen-Image-2512-Lightning-4steps, cfg 1). ~10x faster than qwen-image-2512-t2i.',
  },
  {
    id: 'z-image-turbo-t2i',
    title: 'Z-Image Turbo Text to Image',
    capability: 't2i',
    export: 'image_z_image_turbo',
    bindings: {
      prompt: [b('57:27', 'text')],
      width: [b('57:13', 'width')],
      height: [b('57:13', 'height')],
      seed: [b('57:3', 'seed')],
      steps: [b('57:3', 'steps')],
      shift: [b('57:11', 'shift')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 12,
    notes: '6B distilled model, 8 steps, cfg 1 (no negative prompt). Fastest high-quality option; fits 12-16 GB GPUs.',
  },
  {
    id: 'hidream-i1-dev-t2i',
    title: 'HiDream-I1 Dev Text to Image',
    capability: 't2i',
    export: 'hidream_i1_dev',
    bindings: {
      prompt: [b('16', 'text')],
      negativePrompt: [b('40', 'text')],
      width: [b('53', 'width')],
      height: [b('53', 'height')],
      seed: [b('3', 'seed')],
      steps: [b('3', 'steps')],
      cfg: [b('3', 'cfg')],
      shift: [b('70', 'shift')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 24,
    notes: '17B MoE (fp8). Four text encoders incl. Llama-3.1-8B (fp8). Dev variant: 28 steps, cfg 1, lcm sampler; negative prompt has little effect at cfg 1.',
  },
  {
    id: 'sdxl-t2i',
    title: 'SDXL 1.0 Text to Image',
    capability: 't2i',
    export: 'image_sdxl_simple',
    transforms: [{ op: 'set', node: '11', input: 'text', value: 'lowres, blurry, out of focus, deformed, bad anatomy, watermark, text, signature' }],
    bindings: {
      prompt: [b('10', 'text')],
      negativePrompt: [b('11', 'text')],
      width: [b('13', 'width')],
      height: [b('13', 'height')],
      seed: [b('12', 'seed')],
      steps: [b('12', 'steps')],
      cfg: [b('12', 'cfg')],
    },
    outputs: [{ node: '7', kind: 'image' }],
    limits: { maxWidth: 1536, maxHeight: 1536, dimensionMultiple: 8 },
    vramGb: 8,
    notes: 'Lightweight baseline (single 6.9 GB checkpoint). Native 1024x1024 class resolutions. Default negative prompt replaced with a generic one.',
  },
  {
    id: 'qwen-image-edit-2509',
    title: 'Qwen-Image-Edit 2509 (Lightning 4-step)',
    capability: 'edit',
    export: 'image_qwen_image_edit_2509',
    transforms: [{ op: 'resolveSwitches' }],
    bindings: {
      prompt: [b('433:111', 'prompt')],
      negativePrompt: [b('433:110', 'prompt')],
      image: [b('78', 'image')],
      seed: [b('433:3', 'seed')],
      steps: [b('433:436', 'value')],
      cfg: [b('433:437', 'value')],
    },
    outputs: [{ node: '469', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 24,
    notes: 'Official template default keeps "Enable Lightning LoRA" ON (4 steps, cfg 1). Input is rescaled to ~1 MP (FluxKontextImageScale); output size follows the input.',
  },
  {
    id: 'qwen-image-edit-2511',
    title: 'Qwen-Image-Edit 2511',
    capability: 'edit',
    export: 'image_qwen_image_edit_2511',
    transforms: [
      { op: 'resolveSwitches', booleans: { '170:168': false } },
      // Single-image edit: drop the template's second (material) reference.
      { op: 'delete', node: '170:149', input: 'image2' },
      { op: 'delete', node: '170:151', input: 'image2' },
    ],
    bindings: {
      prompt: [b('170:151', 'prompt')],
      negativePrompt: [b('170:149', 'prompt')],
      image: [b('41', 'image')],
      seed: [b('170:169', 'seed')],
      steps: [b('170:166', 'value')],
      cfg: [b('170:154', 'value')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 24,
    notes: 'Derived from the official 2511 "material replacement" template with the 2nd reference removed. 40 steps, cfg 4 (Lightning LoRA path disabled). Better identity/consistency than 2509.',
  },
  {
    id: 'qwen-image-edit-2511-multi',
    title: 'Qwen-Image-Edit 2511 Multi-Image (3 images)',
    capability: 'edit',
    export: 'image_qwen_image_edit_2511',
    transforms: [
      { op: 'resolveSwitches', booleans: { '170:168': false } },
      { op: 'addNodes', nodes: { 1201: { class_type: 'LoadImage', inputs: { image: 'reference3.png' }, _meta: { title: 'Load Image (image 3)' } } } },
      { op: 'set', node: '170:149', input: 'image3', value: ['1201', 0] },
      { op: 'set', node: '170:151', input: 'image3', value: ['1201', 0] },
    ],
    bindings: {
      prompt: [b('170:151', 'prompt')],
      negativePrompt: [b('170:149', 'prompt')],
      image: [b('41', 'image')],
      image2: [b('83', 'image')],
      image3: [b('1201', 'image')],
      seed: [b('170:169', 'seed')],
      steps: [b('170:166', 'value')],
      cfg: [b('170:154', 'value')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 24,
    notes: 'TextEncodeQwenImageEditPlus takes up to 3 images; refer to them as "image 1/2/3" in the prompt. All three are required. Output size follows image 1.',
  },
  {
    id: 'flux1-kontext-dev-edit',
    title: 'FLUX.1 Kontext [dev] Image Edit',
    capability: 'edit',
    export: 'flux_kontext_dev_basic',
    bindings: {
      prompt: [b('192:6', 'text')],
      image: [b('190', 'image')],
      seed: [b('192:31', 'seed')],
      steps: [b('192:31', 'steps')],
      guidance: [b('192:35', 'guidance')],
    },
    outputs: [{ node: '136', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 16,
    notes: 'Instruction edit ("change the background to ..."). Output follows the input aspect at ~1 MP (FluxKontextImageScale).',
  },
  {
    id: 'flux1-fill-inpaint',
    title: 'FLUX.1 Fill [dev] Inpaint',
    capability: 'inpaint',
    export: 'flux_fill_inpaint_example',
    transforms: [
      // Separate mask upload (white = repaint) instead of the template's image alpha channel.
      { op: 'addNodes', nodes: { 1301: { class_type: 'LoadImageMask', inputs: { image: 'mask.png', channel: 'red' }, _meta: { title: 'Load Mask (white = inpaint)' } } } },
      { op: 'set', node: '47:38', input: 'mask', value: ['1301', 0] },
    ],
    bindings: {
      prompt: [b('47:23', 'text')],
      image: [b('17', 'image')],
      mask: [b('1301', 'image')],
      seed: [b('47:3', 'seed')],
      steps: [b('47:3', 'steps')],
      guidance: [b('47:26', 'guidance')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 24,
    notes: 'mask = separate uploaded PNG, same size as image, read from the RED channel: white (255) = area to regenerate, black = keep. Guidance 30 is correct for Fill.',
  },
  {
    id: 'flux1-fill-outpaint',
    title: 'FLUX.1 Fill [dev] Outpaint',
    capability: 'outpaint',
    export: 'flux_fill_outpaint_example',
    bindings: {
      prompt: [b('23', 'text')],
      image: [b('17', 'image')],
      padLeft: [b('44', 'left')],
      padTop: [b('44', 'top')],
      padRight: [b('44', 'right')],
      padBottom: [b('44', 'bottom')],
      seed: [b('3', 'seed')],
      steps: [b('3', 'steps')],
      guidance: [b('26', 'guidance')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, padMultiple: 8 },
    vramGb: 24,
    notes: 'Extends the canvas by padLeft/padTop/padRight/padBottom pixels (multiples of 8) and fills it. Keep final size <= ~2 MP.',
  },
  {
    id: 'upscale-image-esrgan',
    title: 'Image Upscale (Real-ESRGAN 4x)',
    capability: 'upscale-image',
    handBuilt: 'hand-built/upscale-image-esrgan.json',
    bindings: {
      image: [b('1', 'image')],
      upscaleModel: [b('2', 'model_name')],
      scale: [b('4', 'scale_by')],
    },
    outputs: [{ node: '5', kind: 'image' }],
    limits: { maxWidth: 8192, maxHeight: 8192 },
    vramGb: 4,
    notes: 'Hand-built: UpscaleModelLoader -> ImageUpscaleWithModel -> ImageScaleBy. The model fixes the factor (x4 for RealESRGAN_x4plus); `scale` resizes AFTER the model (0.5 => net 2x). Any spandrel-supported model in models/upscale_models works as upscaleModel.',
  },
  {
    id: 'upscale-image-seedvr2',
    title: 'Image Upscale / Restore (SeedVR2 7B int8)',
    capability: 'upscale-image',
    export: 'utility_seedvr2_7b_int8_upscale_image',
    transforms: [{ op: 'removeOutputs', ids: ['65'] }],
    bindings: {
      image: [b('1', 'image')],
      scale: [b('66:57', 'resize_type.multiplier')],
      seed: [b('66:54', 'seed')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 4096, maxHeight: 4096 },
    vramGb: 16,
    notes: 'Native SeedVR2 nodes (core ComfyUI >= 0.28), one-step diffusion restoration. scale = output multiplier (template 4). The numz/ComfyUI-SeedVR2_VideoUpscaler pack is NOT used (it cannot register on CPU-only hosts and is superseded by core nodes).',
  },
  {
    id: 'bg-remove-birefnet',
    title: 'Remove Background (BiRefNet, native)',
    capability: 'bg-remove',
    export: 'utility_birefnet_remove_background',
    transforms: [
      { op: 'removeOutputs', ids: ['18', '20'] },
      { op: 'addNodes', nodes: { 1401: { class_type: 'SaveImage', inputs: { images: ['19:16', 0], filename_prefix: 'ComfyUI' }, _meta: { title: 'Save Image (RGBA)' } } } },
    ],
    bindings: { image: [b('17', 'image')] },
    outputs: [{ node: '1401', kind: 'image' }],
    limits: { maxWidth: 4096, maxHeight: 4096 },
    vramGb: 4,
    notes: 'Native core nodes (LoadBackgroundRemovalModel/RemoveBackground). Output is an RGBA PNG (transparent background). Template preview nodes replaced with SaveImage. MIT-licensed model.',
  },
  {
    id: 'bg-remove-rmbg',
    title: 'Remove Background (ComfyUI-RMBG, BEN2)',
    capability: 'bg-remove',
    handBuilt: 'hand-built/bg-remove-rmbg.json',
    bindings: { image: [b('1', 'image')] },
    outputs: [{ node: '3', kind: 'image' }],
    limits: { maxWidth: 4096, maxHeight: 4096 },
    vramGb: 4,
    autoDownloads: ['ComfyUI-RMBG downloads the selected model (BEN2 -> models/RMBG/BEN2) from Hugging Face on first run'],
    notes: 'Custom pack alternative to bg-remove-birefnet. Model choices on node 2: RMBG-2.0 (best, but CC BY-NC 4.0 non-commercial), INSPYRENET, BEN, BEN2 (default). Output RGBA PNG.',
  },
  {
    id: 'face-swap-reactor',
    title: 'Face Swap (ReActor)',
    capability: 'face-swap',
    handBuilt: 'hand-built/face-swap-reactor.json',
    bindings: {
      image: [b('1', 'image')],
      image2: [b('2', 'image')],
    },
    outputs: [{ node: '4', kind: 'image' }],
    limits: { maxWidth: 4096, maxHeight: 4096 },
    vramGb: 4,
    autoDownloads: [
      'insightface buffalo_l face analysis models -> models/insightface/models/buffalo_l (downloaded by ReActor on first run)',
      'retinaface_resnet50 detector -> models/facedetection (downloaded on first run)',
    ],
    notes: 'image = target photo (faces get replaced), image2 = source face. inswapper_128 is research/non-commercial licensed; ReActor applies an NSFW detector by default. Requires the insightface Python package (pip wheel insightface 2.1 installs fine on Python 3.13).',
  },

  // =========================================================================
  // VIDEO
  // =========================================================================
  wanT2V(false),
  wanT2V(true),
  wanI2V('base'),
  wanI2V('lightx2v'),
  wanI2V('lora'),
  {
    id: 'wan22-ti2v-5b',
    title: 'Wan 2.2 5B Text to Video (720p)',
    capability: 't2v',
    export: 'video_wan2_2_5B_ti2v',
    bindings: {
      prompt: [b('6', 'text')],
      negativePrompt: [b('7', 'text')],
      width: [b('55', 'width')],
      height: [b('55', 'height')],
      frames: [b('55', 'length')],
      fps: [b('57', 'fps')],
      seed: [b('3', 'seed')],
      steps: [b('3', 'steps')],
      cfg: [b('3', 'cfg')],
      shift: [b('48', 'shift')],
    },
    outputs: [{ node: '58', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 32, frameStep: 4 },
    vramGb: 12,
    notes: 'Dense 5B model with the high-compression Wan2.2 VAE: 1280x704 @24 fps, 121 frames (5 s). Fits 12 GB with offloading. Best consumer-GPU video option.',
  },
  {
    id: 'wan22-ti2v-5b-i2v',
    title: 'Wan 2.2 5B Image to Video (720p)',
    capability: 'i2v',
    export: 'video_wan2_2_5B_ti2v',
    transforms: [
      { op: 'addNodes', nodes: { 1501: { class_type: 'LoadImage', inputs: { image: 'start.png' }, _meta: { title: 'Load Image (start frame)' } } } },
      { op: 'set', node: '55', input: 'start_image', value: ['1501', 0] },
    ],
    bindings: {
      prompt: [b('6', 'text')],
      negativePrompt: [b('7', 'text')],
      image: [b('1501', 'image')],
      width: [b('55', 'width')],
      height: [b('55', 'height')],
      frames: [b('55', 'length')],
      fps: [b('57', 'fps')],
      seed: [b('3', 'seed')],
      steps: [b('3', 'steps')],
      cfg: [b('3', 'cfg')],
      shift: [b('48', 'shift')],
    },
    outputs: [{ node: '58', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 32, frameStep: 4 },
    vramGb: 12,
    notes: 'Same as wan22-ti2v-5b with the optional start_image input of Wan22ImageToVideoLatent wired to a LoadImage (the official template documents this as the I2V mode). Image is used at the given width/height; pre-crop to the target aspect.',
  },
  {
    id: 'wan22-flf2v-14b',
    title: 'Wan 2.2 14B First-Last Frame to Video',
    capability: 'flf2v',
    export: 'video_wan2_2_14B_flf2v',
    bindings: {
      prompt: [b('90', 'text')],
      negativePrompt: [b('78', 'text')],
      image: [b('80', 'image')],
      endImage: [b('89', 'image')],
      width: [b('81', 'width')],
      height: [b('81', 'height')],
      frames: [b('81', 'length')],
      fps: [b('86', 'fps')],
      seed: [b('84', 'noise_seed'), b('87', 'noise_seed')],
      steps: [b('84', 'steps'), b('87', 'steps')],
      cfg: [b('84', 'cfg'), b('87', 'cfg')],
      shift: [b('73', 'shift'), b('74', 'shift')],
    },
    outputs: [{ node: '83', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 24,
    notes: 'Uses the Wan 2.2 I2V high/low experts. High->low switch at step 10 (end_at_step of node 84 / start_at_step of node 87, not a binding). Start and end images should share the output aspect ratio.',
  },
  {
    id: 'wan22-fun-camera-14b',
    title: 'Wan 2.2 14B Fun Camera Control (image to video)',
    capability: 'camera-motion',
    export: 'video_wan2_2_14B_fun_camera',
    transforms: [{ op: 'set', node: '108', input: 'camera_pose', value: 'Zoom In' }],
    bindings: {
      prompt: [b('107', 'text')],
      negativePrompt: [b('99', 'text')],
      image: [b('97', 'image')],
      cameraMotion: [b('108', 'camera_pose')],
      width: [b('108', 'width')],
      height: [b('108', 'height')],
      frames: [b('108', 'length')],
      fps: [b('105', 'fps')],
      seed: [b('102', 'noise_seed'), b('103', 'noise_seed')],
      steps: [b('102', 'steps'), b('103', 'steps')],
      cfg: [b('102', 'cfg'), b('103', 'cfg')],
      shift: [b('100', 'shift'), b('101', 'shift')],
    },
    outputs: [{ node: '106', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 24,
    notes: 'cameraMotion is one of: Static, Pan Up, Pan Down, Pan Left, Pan Right, Zoom In, Zoom Out, Anti Clockwise (ACW), ClockWise (CW). width/height/frames live on WanCameraEmbedding (node 108) which feeds WanCameraImageToVideo. Default changed from "Static" to "Zoom In".',
  },
  {
    id: 'wan22-fun-control-14b',
    title: 'Wan 2.2 14B Fun Control (reference image + control video)',
    capability: 'motion-transfer',
    export: 'video_wan2_2_14B_fun_control',
    transforms: [
      // The template feeds a pre-processed control video; we preprocess in-graph with native Canny
      // (same thresholds the template uses in its bypassed 4-step variant) so a raw video works.
      { op: 'addNodes', nodes: { 1601: { class_type: 'Canny', inputs: { image: ['156', 0], low_threshold: 0.1, high_threshold: 0.6 }, _meta: { title: 'Canny (control preprocessing)' } } } },
      { op: 'set', node: '160', input: 'control_video', value: ['1601', 0] },
    ],
    bindings: {
      prompt: [b('99', 'text')],
      negativePrompt: [b('91', 'text')],
      image: [b('145', 'image')],
      video: [b('158', 'file')],
      width: [b('160', 'width')],
      height: [b('160', 'height')],
      frames: [b('160', 'length')],
      fps: [b('100', 'fps')],
      seed: [b('96', 'noise_seed'), b('95', 'noise_seed')],
      steps: [b('96', 'steps'), b('95', 'steps')],
      cfg: [b('96', 'cfg'), b('95', 'cfg')],
      shift: [b('93', 'shift'), b('94', 'shift')],
    },
    outputs: [{ node: '98', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 24,
    notes: 'image = reference/first frame (style + identity), video = driving clip; structure/motion is transferred via Canny edges computed in-graph (node 1601). Only the first `frames` frames of the video are used; feed a ~16 fps clip so motion speed is preserved. Swap node 1601 for depth/pose preprocessors if you install comfyui_controlnet_aux.',
  },
  {
    id: 'wan21-vace-14b-ref2v',
    title: 'Wan 2.1 VACE 14B Reference to Video',
    capability: 'ref2v',
    export: 'video_wan_vace_14B_ref2v',
    bindings: {
      prompt: [b('105', 'text')],
      negativePrompt: [b('107', 'text')],
      image: [b('73', 'image')],
      width: [b('109', 'width')],
      height: [b('109', 'height')],
      frames: [b('109', 'length')],
      fps: [b('68', 'fps')],
      seed: [b('108', 'seed')],
      steps: [b('108', 'steps')],
      cfg: [b('108', 'cfg')],
      shift: [b('110', 'shift')],
    },
    outputs: [{ node: '69', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 32,
    notes: 'Subject/character reference (not a first frame): the reference appears in a newly composed scene. fp16 14B weights (34.7 GB) + CausVid LoRA at 0.3 for 4-step sampling. 24 GB cards need weight_dtype fp8_e4m3fn on node 113.',
  },
  {
    id: 'wan22-s2v-14b',
    title: 'Wan 2.2 S2V 14B Talking Video (image + audio)',
    capability: 'lipsync',
    export: 'video_wan2_2_14B_s2v',
    bindings: {
      prompt: [b('6', 'text')],
      negativePrompt: [b('7', 'text')],
      image: [b('52', 'image')],
      audio: [b('58', 'audio')],
      width: [b('93', 'width')],
      height: [b('93', 'height')],
      seed: [b('3', 'seed'), b('79:77', 'seed'), b('85:183', 'seed')],
      steps: [b('103', 'value')],
      cfg: [b('105', 'value')],
    },
    outputs: [{ node: '113', kind: 'video' }],
    limits: { maxWidth: 1024, maxHeight: 1024, dimensionMultiple: 16, maxDurationSec: 14 },
    vramGb: 24,
    notes: 'Audio-driven speaking/singing video with body motion. Fixed length: 1 base chunk + 2 extend subgraphs of 77 frames @16 fps (~14 s); shorter audio is padded, longer audio is cut. Output muxes the input audio. Uses the lightx2v 4-step LoRA by default (steps 4, cfg 1; without it use 20 / 6.0).',
  },
  {
    id: 'wan-animate2',
    title: 'Wan Animate 2 Motion Transfer (character + driving video)',
    capability: 'motion-transfer',
    export: 'video_wan_animate2',
    transforms: [
      { op: 'removeOutputs', ids: ['292'] },
      { op: 'resolveSwitches' },
      { op: 'set', node: '672:585', input: 'text', value: 'The character performs exactly the same movements as the person in the driving video, background stationary' },
    ],
    bindings: {
      prompt: [b('672:582', 'text')],
      negativePrompt: [b('672:581', 'text')],
      image: [b('189', 'image')],
      video: [b('240', 'file')],
      width: [b('672:600', 'resize_type.width')],
      height: [b('672:600', 'resize_type.height')],
      seed: [b('672:597', 'noise_seed')],
      steps: [b('672:591', 'steps')],
    },
    outputs: [{ node: '246', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, dimensionMultiple: 16 },
    vramGb: 24,
    notes: 'image = character reference, video = driving video (raw frames; no pose extraction needed). Processes the whole driving video in 81-frame fragments via native loop nodes; output keeps the driving video fps + audio. prompt = character/background description (node 672:582); the separate pose prompt (672:585) is set to a generic motion description. The side-by-side comparison output of the template was removed.',
  },
  {
    id: 'hunyuan15-t2v-720p',
    title: 'HunyuanVideo 1.5 Text to Video (720p)',
    capability: 't2v',
    export: 'video_hunyuan_video_1.5_720p_t2v',
    bindings: {
      prompt: [b('44', 'text')],
      negativePrompt: [b('93', 'text')],
      width: [b('124', 'width')],
      height: [b('124', 'height')],
      frames: [b('124', 'length')],
      fps: [b('101', 'fps')],
      seed: [b('129', 'noise_seed')],
      steps: [b('128', 'steps')],
      cfg: [b('131', 'cfg')],
      shift: [b('132', 'shift')],
    },
    outputs: [{ node: '102', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 24,
    notes: '8.3B model, 1280x720, 121 frames @24 fps (5 s), 20 steps cfg 6. The template\'s optional 1080p super-resolution stage is bypassed (not exported).',
  },
  {
    id: 'hunyuan15-i2v-720p',
    title: 'HunyuanVideo 1.5 Image to Video (720p)',
    capability: 'i2v',
    export: 'video_hunyuan_video_1.5_720p_i2v',
    bindings: {
      prompt: [b('44', 'text')],
      negativePrompt: [b('93', 'text')],
      image: [b('80', 'image')],
      width: [b('78', 'width')],
      height: [b('78', 'height')],
      frames: [b('78', 'length')],
      fps: [b('101', 'fps')],
      seed: [b('127', 'noise_seed')],
      steps: [b('126', 'steps')],
      cfg: [b('129', 'cfg')],
      shift: [b('130', 'shift')],
    },
    outputs: [{ node: '102', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 24,
    notes: 'Uses SigCLIP vision conditioning + first frame. 1280x720, 121 frames @24 fps.',
  },
  {
    id: 'ltx2-t2v',
    title: 'LTX-2 Text to Video + Audio',
    capability: 't2v',
    export: 'video_ltx2_t2v',
    bindings: {
      prompt: [b('92:3', 'text')],
      negativePrompt: [b('92:4', 'text')],
      width: [b('92:89', 'width')],
      height: [b('92:89', 'height')],
      frames: [b('92:62', 'value')],
      fps: [b('92:102', 'value'), b('92:103', 'value')],
      seed: [b('92:11', 'noise_seed'), b('92:67', 'noise_seed')],
      steps: [b('92:9', 'steps')],
      cfg: [b('92:47', 'cfg')],
    },
    outputs: [{ node: '75', kind: 'video' }],
    limits: { maxWidth: 1920, maxHeight: 1920, maxFrames: 257, dimensionMultiple: 64, frameStep: 8 },
    vramGb: 32,
    notes: 'Generates synchronized audio (speech/SFX/music) together with video. Two-stage: base pass at width/2 x height/2, then 2x latent upscale + 3-step distilled refine, so width/height are the FINAL size (multiples of 64). frames must be 8n+1 (121 = 5 s @24 fps). fps is set on both the float and int primitives.',
  },
  {
    id: 'ltx2-i2v',
    title: 'LTX-2 Image to Video + Audio',
    capability: 'i2v',
    export: 'video_ltx2_i2v',
    bindings: {
      prompt: [b('92:3', 'text')],
      negativePrompt: [b('92:4', 'text')],
      image: [b('98', 'image')],
      width: [b('102', 'resize_type.width')],
      height: [b('102', 'resize_type.height')],
      frames: [b('92:62', 'value')],
      fps: [b('92:22', 'frame_rate'), b('92:51', 'frame_rate'), b('92:97', 'fps')],
      seed: [b('92:11', 'noise_seed'), b('92:67', 'noise_seed')],
      steps: [b('92:9', 'steps')],
      cfg: [b('92:47', 'cfg')],
    },
    outputs: [{ node: '75', kind: 'video' }],
    limits: { maxWidth: 1920, maxHeight: 1920, maxFrames: 257, dimensionMultiple: 64, frameStep: 8 },
    vramGb: 32,
    notes: 'Input image is center-cropped/resized to width x height (node 102). Same two-stage pipeline as ltx2-t2v; produces audio. fps (25 by default) must be set in three places (all listed).',
  },
  {
    id: 'ltx25-t2v',
    title: 'LTX-2.5 Text to Video + Audio (distilled)',
    capability: 't2v',
    export: 'video_ltx2_5_t2v',
    transforms: [
      { op: 'removeOutputs', ids: ['405:381'] },
      { op: 'resolveSwitches', booleans: { '405:383': false } },
      // Replace the ResolutionSelector-driven size and duration*fps math with plain values.
      { op: 'set', node: '405:372', input: 'value', value: 1280 },
      { op: 'set', node: '405:360', input: 'value', value: 704 },
      { op: 'set', node: '405:356', input: 'length', value: 121 },
      { op: 'set', node: '405:366', input: 'frames_number', value: 121 },
    ],
    bindings: {
      prompt: [b('405:376', 'value')],
      negativePrompt: [b('405:373', 'text')],
      width: [b('405:372', 'value')],
      height: [b('405:360', 'value')],
      frames: [b('405:356', 'length'), b('405:366', 'frames_number')],
      fps: [b('405:361', 'value')],
      seed: [b('405:339', 'noise_seed'), b('405:338', 'noise_seed')],
    },
    outputs: [{ node: '75', kind: 'video' }],
    limits: { maxWidth: 1920, maxHeight: 1920, maxFrames: 241, dimensionMultiple: 64, frameStep: 8 },
    vramGb: 24,
    notes: 'Newest LTX (22B distilled, int8). Fixed manual sigma schedules (no steps/cfg). width/height are FINAL size (base pass at half size, then 2x latent upscale) -> multiples of 64. frames = seconds*fps+1 (template default 5 s @24 fps = 121). The template\'s optional Gemma prompt-enhancer branch is disabled.',
  },
  {
    id: 'ltx25-i2v',
    title: 'LTX-2.5 Image to Video + Audio (distilled)',
    capability: 'i2v',
    export: 'video_ltx2_5_i2v',
    transforms: [
      { op: 'removeOutputs', ids: ['398:381'] },
      { op: 'resolveSwitches', booleans: { '398:383': false } },
      { op: 'set', node: '398:372', input: 'value', value: 1280 },
      { op: 'set', node: '398:360', input: 'value', value: 704 },
      { op: 'set', node: '398:356', input: 'length', value: 121 },
      { op: 'set', node: '398:366', input: 'frames_number', value: 121 },
    ],
    bindings: {
      prompt: [b('398:376', 'value')],
      negativePrompt: [b('398:373', 'text')],
      image: [b('395', 'image')],
      width: [b('398:372', 'value')],
      height: [b('398:360', 'value')],
      frames: [b('398:356', 'length'), b('398:366', 'frames_number')],
      fps: [b('398:361', 'value')],
      seed: [b('398:339', 'noise_seed'), b('398:338', 'noise_seed')],
    },
    outputs: [{ node: '75', kind: 'video' }],
    limits: { maxWidth: 1920, maxHeight: 1920, maxFrames: 241, dimensionMultiple: 64, frameStep: 8 },
    vramGb: 24,
    notes: 'First-frame conditioning (strength 0.7 base pass, 1.0 refine). Same size/frames rules as ltx25-t2v. Image is resized to longer side 1536 before conditioning; give it the output aspect ratio.',
  },
  {
    id: 'infinitetalk-native',
    title: 'InfiniteTalk Lip-sync (native, single speaker, ~6 s)',
    capability: 'lipsync',
    export: 'video_wan2_1_infinitetalk',
    transforms: [
      { op: 'removeOutputs', ids: ['162'] },
      { op: 'set', node: '188:129', input: 'mode', value: 'single_speaker' },
      { op: 'set', node: '324:311', input: 'mode', value: 'single_speaker' },
      { op: 'delete', node: '188:129', input: 'mode.audio_encoder_output_2' },
      { op: 'delete', node: '188:129', input: 'mode.mask_1' },
      { op: 'delete', node: '188:129', input: 'mode.mask_2' },
      { op: 'delete', node: '324:311', input: 'mode.audio_encoder_output_2' },
      { op: 'delete', node: '324:311', input: 'mode.mask_1' },
      { op: 'delete', node: '324:311', input: 'mode.mask_2' },
      { op: 'set', node: '140', input: 'audio', value: ['24', 0] },
      // single-speaker InfiniteTalk weights instead of the two-speaker "multi" patch
      { op: 'rename', map: { 'wan2.1_infiniteTalk_multi_fp16.safetensors': 'wan2.1_infiniteTalk_single_fp16.safetensors' } },
      { op: 'set', node: '188:14', input: 'text', value: 'A person is talking to the camera.' },
      { op: 'set', node: '324:312', input: 'text', value: 'A person is talking to the camera.' },
    ],
    bindings: {
      prompt: [b('188:14', 'text'), b('324:312', 'text')],
      image: [b('32', 'image')],
      audio: [b('24', 'audio')],
      width: [b('149', 'value')],
      height: [b('150', 'value')],
      seed: [b('188:193', 'noise_seed'), b('324:321', 'noise_seed')],
      steps: [b('188:192', 'steps'), b('324:320', 'steps')],
    },
    outputs: [{ node: '141', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, dimensionMultiple: 16, maxDurationSec: 6 },
    vramGb: 24,
    notes: 'Official native InfiniteTalk template converted from two-speaker to single-speaker (single-speaker InfiniteTalk patch, masks/2nd audio/first-pass preview output removed). Two 81-frame windows @25 fps => ~6 s; audio beyond that is not animated (trim audio to <= 6 s). For long clips use infinitetalk-wanwrapper.',
  },
  {
    id: 'infinitetalk-wanwrapper',
    title: 'InfiniteTalk Lip-sync (WanVideoWrapper, long audio)',
    capability: 'lipsync',
    export: 'custom_nodes/ComfyUI-WanVideoWrapper/example_workflows/wanvideo_2_1_14B_I2V_InfiniteTalk_example_03.json',
    transforms: [
      // MelBandRoFormer vocal separation needs another custom pack (ComfyUI-MelBandRoFormer); feed audio directly.
      { op: 'removeNodes', ids: ['301', '302'] },
      { op: 'set', node: '194', input: 'audio_1', value: ['125', 0] },
      { op: 'removeOutputs', ids: ['293'] },
      { op: 'set', node: '131', input: 'save_output', value: true },
      { op: 'set', node: '122', input: 'attention_mode', value: 'sdpa' },
      { op: 'set', node: '241', input: 'positive_prompt', value: 'A person is talking to the camera.' },
      {
        op: 'rename',
        map: {
          'WanVideo\\InfiniteTalk\\Wan2_1-InfiniteTalk_Single_Q8.gguf': 'Wan2_1-InfiniteTalk_Single_Q8.gguf',
          'WanVideo\\wan2.1-i2v-14b-480p-Q8_0.gguf': 'wan2.1-i2v-14b-480p-Q8_0.gguf',
          'wanvideo\\Wan2_1_VAE_bf16.safetensors': 'Wan2_1_VAE_bf16.safetensors',
          'WanVideo\\Lightx2v\\lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors': 'lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors',
        },
      },
    ],
    bindings: {
      prompt: [b('241', 'positive_prompt')],
      negativePrompt: [b('241', 'negative_prompt')],
      image: [b('284', 'image')],
      audio: [b('125', 'audio')],
      width: [b('245', 'value')],
      height: [b('246', 'value')],
      frames: [b('270', 'value')],
      seed: [b('128', 'seed')],
      steps: [b('128', 'steps')],
    },
    outputs: [{ node: '131', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, dimensionMultiple: 16, maxFrames: 1000 },
    vramGb: 16,
    autoDownloads: ['DownloadAndLoadWav2VecModel downloads TencentGameMate/chinese-wav2vec2-base into models/transformers on first run'],
    notes: 'kijai WanVideoWrapper example 03 (GGUF Q8 Wan2.1-I2V-480p + InfiniteTalk single, lightx2v LoRA, 6 steps). Generates in 81-frame windows until the audio ends; `frames` is a MAX frame cap @25 fps (default 500 = 20 s). Changes vs example: MelBandRoFormer vocal separation removed (use clean speech audio), attention sdpa instead of sageattn, save_output=true, Windows sub-paths flattened. Output is a VHS_VideoCombine node: look in history outputs[node].gifs[], not .images[].',
  },
  {
    id: 'upscale-video-seedvr2',
    title: 'Video Upscale / Restore (SeedVR2 3B int8)',
    capability: 'upscale-video',
    export: 'utility_seedvr2_3b_int8_upscale_video',
    transforms: [{ op: 'resolveSwitches' }],
    bindings: {
      video: [b('73', 'file')],
      scale: [b('66:57', 'resize_type.multiplier')],
      seed: [b('66:54', 'seed')],
    },
    outputs: [{ node: '76', kind: 'video' }],
    limits: { maxWidth: 3840, maxHeight: 3840, maxDurationSec: 20 },
    vramGb: 16,
    notes: 'Native SeedVR2 (one-step diffusion restoration, temporally consistent). scale = output multiplier (template 2). Keeps source fps + audio. Temporal latent chunking is off (template default); long or 1080p+ clips need more VRAM.',
  },
  {
    id: 'upscale-video-esrgan',
    title: 'Video Upscale (Real-ESRGAN 4x)',
    capability: 'upscale-video',
    export: 'utility-gan_upscaler',
    bindings: {
      video: [b('9', 'file')],
      upscaleModel: [b('1', 'model_name')],
    },
    outputs: [{ node: '12', kind: 'video' }],
    limits: { maxWidth: 3840, maxHeight: 3840 },
    vramGb: 4,
    notes: 'Fast GAN upscale frame by frame (no new detail). Output factor = model factor (x4). Keeps fps + audio.',
  },
  {
    id: 'interpolate-film',
    title: 'Frame Interpolation (FILM, native)',
    capability: 'interpolate',
    export: 'utility_video_frame_interpolation',
    transforms: [{ op: 'resolveSwitches' }],
    bindings: {
      video: [b('4', 'file')],
      multiplier: [b('16:9', 'value')],
    },
    outputs: [{ node: '7', kind: 'video' }],
    limits: { maxMultiplier: 16 },
    vramGb: 4,
    notes: 'Native FrameInterpolate node. Output fps = source fps x multiplier (same duration, smoother motion). Audio passthrough.',
  },
  {
    id: 'interpolate-rife',
    title: 'Frame Interpolation (RIFE 4.26, native)',
    capability: 'interpolate',
    export: 'utility_video_frame_interpolation',
    transforms: [
      { op: 'resolveSwitches' },
      { op: 'set', node: '16:1', input: 'model_name', value: 'rife_v4.26.safetensors' },
    ],
    bindings: {
      video: [b('4', 'file')],
      multiplier: [b('16:9', 'value')],
    },
    outputs: [{ node: '7', kind: 'video' }],
    limits: { maxMultiplier: 16 },
    vramGb: 2,
    notes: 'Same official template with the RIFE v4.26 checkpoint (template lists rife_v4.25/4.26 variants in Comfy-Org/frame_interpolation). Faster than FILM.',
  },
  {
    id: 'interpolate-rife-vfi',
    title: 'Frame Interpolation (RIFE VFI custom pack)',
    capability: 'interpolate',
    handBuilt: 'hand-built/interpolate-rife-vfi.json',
    bindings: {
      video: [b('1', 'video')],
      multiplier: [b('2', 'value')],
    },
    outputs: [{ node: '6', kind: 'video' }],
    limits: { maxMultiplier: 8 },
    vramGb: 2,
    autoDownloads: ['RIFE VFI downloads rife49.pth into custom_nodes/ComfyUI-Frame-Interpolation/ckpts/rife on first run'],
    notes: 'Fannovel16/ComfyUI-Frame-Interpolation + VideoHelperSuite alternative to interpolate-rife. Output fps = source fps x multiplier (VHS_VideoInfo + ComfyMathExpression). Output is VHS_VideoCombine (history .gifs[]).',
  },

  // =========================================================================
  // AUDIO
  // =========================================================================
  {
    id: 'music-ace-step-15',
    title: 'ACE-Step 1.5 Music (tags + lyrics)',
    capability: 'music',
    export: 'audio_ace_step_1_5_checkpoint',
    transforms: [
      { op: 'set', node: '106', input: 'format', value: 'mp3' },
      { op: 'set', node: '106', input: 'format.quality', value: 'V0' },
      { op: 'set', node: '94', input: 'bpm', value: 120 },
      { op: 'set', node: '94', input: 'duration', value: 60 },
      { op: 'set', node: '98', input: 'seconds', value: 60 },
    ],
    bindings: {
      tags: [b('94', 'tags')],
      lyrics: [b('94', 'lyrics')],
      duration: [b('94', 'duration'), b('98', 'seconds')],
      bpm: [b('94', 'bpm')],
      seed: [b('3', 'seed'), b('94', 'seed')],
      steps: [b('3', 'steps')],
    },
    outputs: [{ node: '106', kind: 'audio' }],
    limits: { maxDurationSec: 240 },
    vramGb: 8,
    notes: 'Turbo AIO checkpoint (8 steps). tags = style description, lyrics with [Verse]/[Chorus] markers ("[Instrumental]" or empty for instrumental). Output MP3 V0 (changed from FLAC). Defaults changed to 60 s / 120 bpm. Language/keyscale/timesignature stay at template values (en, E minor, 4).',
  },
  {
    id: 'v2a-mmaudio',
    title: 'Video to Audio / Foley (MMAudio)',
    capability: 'v2a',
    export: 'custom_nodes/ComfyUI-MMAudio/example_workflows/mmaudio_test.json',
    transforms: [
      { op: 'removeOutputs', ids: ['98'] },
      { op: 'addNodes', nodes: { 1701: { class_type: 'SaveAudio', inputs: { audio: ['92', 0], filename_prefix: 'ComfyUI' }, _meta: { title: 'Save Audio (FLAC)' } } } },
      { op: 'set', node: '97', input: 'save_output', value: true },
    ],
    bindings: {
      video: [b('91', 'video')],
      prompt: [b('92', 'prompt')],
      negativePrompt: [b('92', 'negative_prompt')],
      seed: [b('92', 'seed')],
      steps: [b('92', 'steps')],
      cfg: [b('92', 'cfg')],
    },
    outputs: [
      { node: '97', kind: 'video' },
      { node: '1701', kind: 'audio' },
    ],
    limits: { maxDurationSec: 30 },
    vramGb: 8,
    notes: 'kijai ComfyUI-MMAudio example. Audio duration = loaded video duration (VHS_VideoInfo). Two outputs: the input video muxed with generated audio (VHS_VideoCombine -> history .gifs[]) and the FLAC track (SaveAudio -> history .audio[]). MMAudio is trained on 8 s clips; quality drops on long inputs.',
  },
  // =========================================================================
  // comfyui-oss-2 additions (docs/research/comfyui-oss-2.md, 2026-10-16)
  // Hand-built from the research graphs (scripts/comfy/hand-built/*.json).
  // =========================================================================
  // ---- speech / voice -----------------------------------------------------
  {
    id: 'tts-chatterbox-multilingual',
    title: 'Chatterbox Multilingual TTS (voice clone, 23 languages)',
    capability: 'tts',
    handBuilt: 'hand-built/tts-chatterbox-multilingual.json',
    bindings: {
      prompt: [b('2', 'text')],
      audio: [b('1', 'audio')],
      language: [b('2', 'language')],
      seed: [b('10', 'value')],
      exaggeration: [b('2', 'exaggeration')],
      cfg: [b('2', 'cfg_weight')],
      temperature: [b('2', 'temperature')],
    },
    outputs: [{ node: '3', kind: 'audio' }],
    defaults: { language: 'English (en)' },
    limits: { maxDurationSec: 300 },
    vramGb: 6,
    license: 'Chatterbox weights MIT (ResembleAI); pack repo has no LICENSE file',
    autoDownloads: [
      'FL_ChatterboxMultilingualTTS downloads ResembleAI/chatterbox (t3_mtl23ls_v2.safetensors 2.14 GB, s3gen.pt 1.06 GB, ve.pt, conds.pt, grapheme_mtl_merged_expanded_v1.json, Cangjie5_TC.json) into models/chatterbox/chatterbox_multilingual on first run',
    ],
    notes:
      'Template audio-chatterbox_tts_multilingual. prompt = text to speak; audio = 5-15 s clean reference of the voice to clone (required in this graph). ' +
      'language is a combo of "Name (code)" strings: Arabic (ar), Danish (da), German (de), Greek (el), English (en), Spanish (es), Finnish (fi), French (fr), Hebrew (he), Hindi (hi), Italian (it), Japanese (ja), Korean (ko), Malay (ms), Dutch (nl), Norwegian (no), Polish (pl), Portuguese (pt), Russian (ru), Swedish (sv), Swahili (sw), Turkish (tr), Chinese (zh). ' +
      'cfg = cfg_weight (0-1, default 0.5; lower = slower, more deliberate pacing), exaggeration 0-2 (0.5 neutral), temperature 0.05-2 (0.8). Long text is chunked by the node. seed is folded to 32 bits in the graph (node 11, the FL nodes cap seed at 2^32-1). Output MP3 V0. ' +
      'Install resemble-perth so outputs carry the Perth watermark (the pack treats it as optional). Get consent for cloned voices.',
  },
  {
    id: 'tts-indextts2',
    title: 'IndexTTS-2 TTS (voice clone, expressive)',
    capability: 'tts',
    handBuilt: 'hand-built/tts-indextts2.json',
    bindings: {
      prompt: [b('2', 'text')],
      audio: [b('1', 'audio')],
    },
    outputs: [{ node: '3', kind: 'audio' }],
    limits: { maxDurationSec: 300 },
    vramGb: 8,
    license: 'bilibili IndexTTS-2 Model Use License: commercial use allowed below 100M MAU / RMB 1B annual revenue; may not be used to improve other AI models. Pack code: no LICENSE file',
    autoDownloads: [
      'IndexTeam/IndexTTS-2 must be in custom_nodes/ComfyUI-IndexTTS2/checkpoints (gpt.pth 3.48 GB, s2mel.pth 1.2 GB, qwen0.6bemo4-merge 1.19 GB, config.yaml, bpe.model, ...); w2v-bert-2.0, MaskGCT semantic codec, CAMPPlus and BigVGAN are fetched from Hugging Face on first run',
    ],
    notes:
      'IndexTTS2Simple(audio = speaker reference, text, emotion_control_weight 1.0, use_fp16 true). No seed input. Best for emotion/timing control (dubbing). ' +
      'Validated with the pack registered (it imports only numpy at load time); its runtime stack (pynini, WeTextProcessing, modelscope, descript-audiotools, ...) is NOT installed by default - ' +
      'run install-comfyui.sh with INDEXTTS_RUNTIME=1, ideally in a separate worker. Emotion from a second clip or a vector (IndexTTS2EmotionVector / IndexTTS2EmotionFromText) is not wired.',
  },
  {
    id: 'tts-dialogue-chatterbox',
    title: 'Chatterbox Dialogue (2 speakers, voice clone)',
    capability: 'dialogue',
    handBuilt: 'hand-built/tts-dialogue-chatterbox.json',
    bindings: {
      prompt: [b('3', 'dialog_text')],
      audio: [b('1', 'audio')],
      audio2: [b('2', 'audio')],
      seed: [b('10', 'value')],
      exaggeration: [b('3', 'exaggeration')],
      cfg: [b('3', 'cfg_weight')],
      temperature: [b('3', 'temperature')],
    },
    outputs: [{ node: '4', kind: 'audio' }],
    limits: { maxDurationSec: 300 },
    vramGb: 6,
    license: 'Chatterbox weights MIT (ResembleAI); pack repo has no LICENSE file',
    autoDownloads: [
      'FL_ChatterboxDialogTTS downloads ResembleAI/chatterbox English model (t3_cfg.safetensors 2.13 GB, s3gen.safetensors 1.06 GB, ve.safetensors, tokenizer.json, conds.pt) into models/chatterbox/chatterbox on first run',
    ],
    notes:
      'Template audio-chatterbox_tts_dialog. prompt = script, one line per turn starting with "SPEAKER A:" or "SPEAKER B:" (parsed with startswith). audio = speaker A reference, audio2 = speaker B reference. ' +
      'English model only. The node also outputs per-speaker stems (outputs 1-4, not saved here) that suit multi-person lipsync; speakers C/D need optional inputs speaker_C_Audio/speaker_D_Audio (not wired). ' +
      'cfg = cfg_weight (0.2-1), exaggeration 0.25-2, temperature 0.05-5. seed is folded to 32 bits in the graph (node 11). Output MP3 V0 of the mixed dialogue.',
  },
  {
    id: 'voice-change-chatterbox',
    title: 'Chatterbox Voice Changer (speech to speech)',
    capability: 'voice-change',
    handBuilt: 'hand-built/voice-change-chatterbox.json',
    bindings: {
      audio: [b('1', 'audio')],
      audio2: [b('2', 'audio')],
      seed: [b('10', 'value')],
    },
    outputs: [{ node: '4', kind: 'audio' }],
    limits: { maxDurationSec: 300 },
    vramGb: 3,
    license: 'Chatterbox weights MIT (ResembleAI); pack repo has no LICENSE file',
    autoDownloads: ['FL_ChatterboxVC downloads ResembleAI/chatterbox s3gen.pt (1.06 GB) + conds.pt into models/chatterbox/chatterbox_vc on first run'],
    notes:
      'Template audio-chatterbox_vc. audio = performance to convert (timing and prosody are kept), audio2 = 5-15 s of the target voice. Zero-shot, no training. seed is folded to 32 bits in the graph (node 11). ' +
      'To re-voice a video: extract its audio client-side (or GetVideoComponents.audio -> FL_ChatterboxVC -> CreateVideo(audio=...)) and remux.',
  },

  // ---- video: extend / reframe / relight / draw-to-video ------------------
  {
    id: 'video-extend-wan22-fun-vace',
    title: 'Wan 2.2 Fun VACE Video Extend (lightx2v 4-step)',
    capability: 'extend',
    handBuilt: 'hand-built/video-extend-wan22-fun-vace.json',
    bindings: {
      video: [b('1', 'file')],
      prompt: [b('12', 'text')],
      negativePrompt: [b('13', 'text')],
      width: [b('3', 'width'), b('5', 'width'), b('7', 'width'), b('8', 'width'), b('15', 'width')],
      height: [b('3', 'height'), b('5', 'height'), b('7', 'height'), b('8', 'height'), b('15', 'height')],
      frames: [b('30', 'value')],
      contextFrames: [b('31', 'value')],
      fps: [b('27', 'fps')],
      seed: [b('22', 'noise_seed'), b('23', 'noise_seed')],
      steps: [b('22', 'steps'), b('23', 'steps')],
      cfg: [b('22', 'cfg'), b('23', 'cfg')],
      shift: [b('20', 'shift'), b('21', 'shift')],
    },
    outputs: [{ node: '28', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 105, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 24,
    license: 'Apache-2.0 (Wan 2.2 Fun VACE, Wan 2.2 lightx2v LoRAs)',
    notes:
      'Continues a clip. frames = NEW frames to generate (4n+1, from duration*fps); contextFrames = how many of the source\'s last frames are fed back as known context (multiple of 4, default 16). ' +
      'The graph computes window = frames + contextFrames (ComfyMathExpression, must stay <= 121) and the negative tail index itself. WanVaceToVideo control: last contextFrames frames (mask 0 = keep) + gray frames (mask 1 = generate). ' +
      'Output = whole source clip resized/center-cropped to width x height + the new frames, overlap linear-blended (KJNodes ImageBatchExtendWithOverlap), at fps (16 = Wan native; resample the source to 16 fps first). ' +
      'Run repeatedly on the result to extend further. Source audio is dropped. 4 steps split 2/2 high/low (split not bound), cfg 1, shift 5. ' +
      'Fun VACE + T2V lightx2v LoRA pairing is inferred from the shared A14B T2V base (not GPU-tested).',
  },
  {
    id: 'video-reframe-wan22-fun-vace',
    title: 'Wan 2.2 Fun VACE Video Reframe / Outpaint',
    capability: 'reframe',
    handBuilt: 'hand-built/video-reframe-wan22-fun-vace.json',
    bindings: {
      video: [b('1', 'file')],
      prompt: [b('9', 'text')],
      negativePrompt: [b('10', 'text')],
      width: [b('3', 'width'), b('12', 'width')],
      height: [b('3', 'height'), b('12', 'height')],
      frames: [b('12', 'length')],
      fps: [b('23', 'fps')],
      seed: [b('19', 'noise_seed'), b('20', 'noise_seed')],
      steps: [b('19', 'steps'), b('20', 'steps')],
      cfg: [b('19', 'cfg'), b('20', 'cfg')],
      shift: [b('17', 'shift'), b('18', 'shift')],
    },
    outputs: [{ node: '24', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 24,
    license: 'Apache-2.0 (Wan 2.2 Fun VACE, Wan 2.2 lightx2v LoRAs)',
    notes:
      'Changes the aspect ratio of a clip and fills the new area. width/height = TARGET size (from aspectRatio); KJNodes ImageResizeKJv2 (keep_proportion=pad, center, divisible_by 16) fits the source inside it, ' +
      'pads with 0.5 gray and outputs mask 1 on the padding, 0 on the source (per frame) -> WanVaceToVideo control_video/control_masks (pattern of template video_wan_vace_outpainting, re-targeted to Wan 2.2 Fun VACE). ' +
      'frames must be <= the source frame count (4n+1): WanVaceToVideo trims the control video to frames, and pads a shorter one with gray + mask 1 (= invents frames). ' +
      'Only call it when the aspect ratio actually changes (no padding -> ImageResizeKJv2 returns a 64x64 placeholder mask and the whole clip would be regenerated). ' +
      'Clips longer than ~5-7 s: run windows and reuse the previous window\'s last frames (see video-extend). Source audio is dropped. 4 steps split 2/2, cfg 1, shift 5.',
  },
  {
    id: 'relight-qwen-edit-2509',
    title: 'Qwen-Image-Edit 2509 Relight (prompted lighting)',
    capability: 'edit',
    handBuilt: 'hand-built/relight-qwen-edit-2509.json',
    bindings: {
      prompt: [b('1002', 'string_b')],
      negativePrompt: [b('433:110', 'prompt')],
      image: [b('78', 'image')],
      seed: [b('433:3', 'seed')],
      steps: [b('433:436', 'value')],
      cfg: [b('433:437', 'value')],
      loraStrength: [b('1001', 'strength_model')],
    },
    outputs: [{ node: '469', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 24,
    license: 'Apache-2.0 (Qwen-Image-Edit-2509, Relight LoRA, Lightning LoRA)',
    notes:
      'Official template image_qwen_image_edit_2509_relight = library qwen-image-edit-2509 + node 1001 (Relight LoRA after the Lightning LoRA) + node 1002 (StringConcatenate prefixing the LoRA trigger "重新照明," = "relight,"). ' +
      'prompt = the light to apply, e.g. "relight with neon magenta and cyan rim lights" (Chinese prompts follow the LoRA captions best). Output size follows the input (~1 MP). 4 steps, cfg 1.',
  },
  {
    id: 'relight-qwen-edit-2509-reference',
    title: 'Qwen-Image-Edit 2509 Relight from Reference (light migration)',
    capability: 'edit',
    handBuilt: 'hand-built/relight-qwen-edit-2509-reference.json',
    bindings: {
      prompt: [b('1002', 'string_b')],
      negativePrompt: [b('433:110', 'prompt')],
      image: [b('78', 'image')],
      image2: [b('1003', 'image')],
      seed: [b('433:3', 'seed')],
      steps: [b('433:436', 'value')],
      cfg: [b('433:437', 'value')],
      loraStrength: [b('1001', 'strength_model')],
    },
    outputs: [{ node: '469', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 24,
    license: 'Apache-2.0 (Qwen-Image-Edit-2509, Light-Migration LoRA, Lightning LoRA)',
    notes:
      'Template templates-portrait_light_migration: image = subject, image2 = lighting reference (wired as image2 of both TextEncodeQwenImageEditPlus). Node 1002 prefixes the template instruction ' +
      '("参考色调，移除图1原有的光照并参考图2的光照和色调对图1重新照明" = remove image 1\'s lighting and relight it with image 2\'s light and tone); prompt may stay empty or add constraints. 4 steps, cfg 1.',
  },
  {
    id: 'video-relight-bernini-r',
    title: 'Bernini-R Video Relight / Restyle (lightx2v 6-step)',
    capability: 'v2v',
    handBuilt: 'hand-built/video-relight-bernini-r.json',
    bindings: {
      video: [b('1', 'file')],
      prompt: [b('5', 'string_b')],
      negativePrompt: [b('7', 'text')],
      width: [b('8', 'width')],
      height: [b('8', 'height')],
      frames: [b('8', 'length')],
      seed: [b('16', 'noise_seed')],
      steps: [b('13', 'steps')],
      cfg: [b('16', 'cfg'), b('17', 'cfg')],
    },
    outputs: [{ node: '20', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, maxFrames: 121, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 24,
    license: 'Apache-2.0 (ByteDance Bernini-R, lightx2v)',
    notes:
      'Official template video_bernini_r_video_editing, subgraph flattened with its turbo switch ON: lightx2v T2V v2 rank64 LoRA at 3.0 (high) / 1.5 (low), 6 steps split at 3 (SplitSigmas, not bound), cfg 1, res_multistep. ' +
      'Node 5 prepends the template system prompt for style/lighting/colour edits; prompt = the edit, e.g. "Relight the scene as golden hour, warm low sun from the left; keep subject, motion and framing unchanged". ' +
      'BerniniConditioning resizes/center-crops the source to width x height and trims it to frames (use the source aspect ratio and frame count, 4n+1). Output fps = source fps (linked), no audio. ' +
      'Also works as general prompt-driven video restyle. Turbo off (template): 40 steps split 20, cfg 5, no LoRA. Very new weights (2026-06): GPU smoke-test before exposing.',
  },
  {
    id: 'draw-to-video-wan-move',
    title: 'Wan-Move Draw-to-Video (motion paths, lightx2v)',
    capability: 'draw-to-video',
    handBuilt: 'hand-built/draw-to-video-wan-move.json',
    bindings: {
      image: [b('1', 'image')],
      tracks: [b('3', 'value')],
      prompt: [b('6', 'text')],
      negativePrompt: [b('7', 'text')],
      width: [b('2', 'width'), b('11', 'width')],
      height: [b('2', 'height'), b('11', 'height')],
      frames: [b('11', 'length')],
      motionStrength: [b('11', 'strength')],
      fps: [b('17', 'fps')],
      seed: [b('15', 'seed')],
      steps: [b('15', 'steps')],
      cfg: [b('15', 'cfg')],
      shift: [b('14', 'shift')],
    },
    outputs: [{ node: '18', kind: 'video' }],
    limits: { maxWidth: 832, maxHeight: 832, maxFrames: 81, dimensionMultiple: 16, frameStep: 4 },
    vramGb: 24,
    license: 'Apache-2.0 (Ruihang/Wan-Move-14B-480P, lightx2v)',
    notes:
      'Official template video_wanmove_480p (turbo path). image = start frame (resized/center-cropped to width x height). tracks = JSON string: a list of tracks, each a list of {"x": px, "y": px} with exactly ONE point per output frame ' +
      '(frames points), in width x height pixel space; all tracks the same length (nodes_wanmove.py uses len(tracks[0])). Client: resample each drawn stroke to frames points by arc length, add a few parallel tracks per object, ' +
      'and constant-position tracks to pin the background. motionStrength = track conditioning strength (1.0). 480p model: keep the long side <= 832. 6 steps, cfg 1, er_sde, shift 8 (without the LoRA: 20 steps, cfg 6).',
  },

  // ---- multi-shot: join per-shot clips ------------------------------------
  ...[2, 3, 4].map((n) => ({
    id: `video-concat-${n}`,
    title: `Join ${n} Shots (multi-shot concat)`,
    capability: 'concat',
    handBuilt: `hand-built/video-concat-${n}.json`,
    bindings: {
      ...Object.fromEntries(Array.from({ length: n }, (_, i) => [i === 0 ? 'video' : `video${i + 1}`, [b(String(1 + 3 * i), 'file')]])),
      width: Array.from({ length: n }, (_, i) => b(String(3 + 3 * i), 'width')),
      height: Array.from({ length: n }, (_, i) => b(String(3 + 3 * i), 'height')),
      fps: [b('21', 'fps')],
    },
    outputs: [{ node: '22', kind: 'video' }],
    limits: { maxWidth: 1920, maxHeight: 1920, dimensionMultiple: 16 },
    vramGb: 0,
    license: 'no model (ComfyUI core nodes)',
    notes:
      `Hard-cut concatenation of ${n} clips (video${n > 1 ? ', video2' : ''}${n > 2 ? ', video3' : ''}${n > 3 ? ', video4' : ''}) in order: LoadVideo -> ImageScale (lanczos, center crop to width x height) -> BatchImagesNode -> CreateVideo (fps linked from the first clip's GetVideoComponents; bind fps to override). ` +
      'Multi-shot recipe: storyboard panels (storyboard-qwen-edit-2509-next-scene) -> one wan22-i2v-14b-lightx2v job per shot (or wan22-flf2v-14b between panels N and N+1 for match cuts) -> this graph; add sound afterwards (v2a-mmaudio / music). ' +
      'All clips should share one fps (frames are concatenated, not retimed); audio tracks are dropped. Runs on CPU; RAM grows with total frame count. LTX-2.5 native multishot (ltx25-t2v/i2v with a shot-list prompt) is the one-pass alternative.',
  })),

  // ---- storyboard ----------------------------------------------------------
  {
    id: 'storyboard-qwen-edit-2509-next-scene',
    title: 'Storyboard Next Scene (Qwen-Image-Edit 2509 + next-scene LoRA)',
    capability: 'edit',
    handBuilt: 'hand-built/storyboard-qwen-edit-2509-next-scene.json',
    bindings: {
      prompt: [b('1002', 'string_b')],
      negativePrompt: [b('433:110', 'prompt')],
      image: [b('78', 'image')],
      image2: [b('1003', 'image')],
      seed: [b('433:3', 'seed')],
      steps: [b('433:436', 'value')],
      cfg: [b('433:437', 'value')],
      loraStrength: [b('1001', 'strength_model')],
    },
    outputs: [{ node: '469', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 24,
    license: 'Apache-2.0 (Qwen-Image-Edit-2509, Lightning LoRA); next-scene LoRA MIT (lovis93)',
    notes:
      'Run once per panel: image = previous panel (panel 1 from z-image-turbo-t2i, optionally with the user\'s character LoRA), image2 = character/product reference re-injected every panel to limit identity drift, ' +
      'prompt = camera move + story beat ("The camera pulls back to a wide shot ..."). Node 1002 prefixes "Next Scene:". loraStrength default 0.75 (model card: 0.7-0.8). 4 steps, cfg 1. ' +
      'Drift still accumulates over many chained panels (inferred); qwen-image-edit-2511-multi (independent panels from the same references) is the no-drift alternative.',
  },

  // ---- video matting / depth ----------------------------------------------
  {
    id: 'video-bg-remove-birefnet',
    title: 'Video Background Removal (BiRefNet, transparent WebM)',
    capability: 'bg-remove-video',
    handBuilt: 'hand-built/video-bg-remove-birefnet.json',
    bindings: { video: [b('1', 'file')] },
    outputs: [
      { node: '7', kind: 'video' },
      { node: '10', kind: 'video' },
    ],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 4,
    license: 'MIT (BiRefNet)',
    notes:
      'Core RemoveBackground on every frame -> InvertMask -> JoinImageWithAlpha (it stores 1-mask as alpha, like bg-remove-birefnet) -> SaveWEBM (vp9, crf 24, fps = source fps): an RGBA .webm with real transparency (yuva420p). ' +
      'Second output (node 10) = black/white matte .mp4 for compositing. SaveWEBM reports its file under history outputs "images" (animated: true), not "videos": classify by the .webm extension / the declared kind. ' +
      'Per-frame model, so hair edges may flicker (inferred). Source audio is dropped. For "keep only X" use video-bg-remove-sam3.',
  },
  {
    id: 'video-bg-remove-sam3',
    title: 'Video Cutout by Text (SAM 3.1 tracking, transparent WebM)',
    capability: 'bg-remove-video',
    handBuilt: 'hand-built/video-bg-remove-sam3.json',
    bindings: {
      video: [b('1', 'file')],
      prompt: [b('4', 'text')],
    },
    outputs: [{ node: '9', kind: 'video' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 6,
    license: 'Meta SAM License (royalty-free, commercial use allowed; attribution + acceptable-use terms)',
    notes:
      'prompt = what to KEEP ("person", "red car"). SAM3_VideoTrack (detection_threshold 0.5, max_objects 4, detect_interval 1) -> SAM3_TrackToMask (object_indices "" = all tracked objects) -> InvertMask -> JoinImageWithAlpha -> SaveWEBM (vp9, fps = source). ' +
      'Masks are hard-edged; multiply with the BiRefNet matte for hair. Output under history "images" (animated .webm). Template utility_video_segment_sam3 runs SAM3_Detect per frame instead.',
  },
  {
    id: 'video-depth-da3',
    title: 'Video Depth Map (Depth Anything 3 Mono)',
    capability: 'depth-video',
    handBuilt: 'hand-built/video-depth-da3.json',
    bindings: { video: [b('1', 'file')] },
    outputs: [{ node: '7', kind: 'video' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 4,
    license: 'Apache-2.0 (DA3MONO-LARGE; DA3-LARGE / GIANT are CC-BY-NC, do not swap them in)',
    notes:
      'Template utility_depth_anything3_video_depth_estimation: LoadDA3Model -> DA3Inference (resolution 504, step 14; mode "mono") -> DA3Render (output "depth", output.normalization v2_style) -> CreateVideo (source fps + audio). ' +
      'Grayscale depth video (near = bright). Per-frame model (some flicker possible); video-depth-vda-small is the temporally stable alternative. DynamicCombo inputs are dotted keys in API format.',
  },
  {
    id: 'video-depth-vda-small',
    title: 'Video Depth Map (Video Depth Anything Small, temporally stable)',
    capability: 'depth-video',
    handBuilt: 'hand-built/video-depth-vda-small.json',
    bindings: { video: [b('1', 'file')] },
    outputs: [{ node: '7', kind: 'video' }],
    limits: { maxWidth: 2048, maxHeight: 2048 },
    vramGb: 4,
    license: 'Apache-2.0 (Video-Depth-Anything-Small); Base/Large and metric variants are CC-BY-NC-4.0 (non-commercial) - keep the vits model',
    autoDownloads: ['LoadVideoDepthAnythingModel downloads depth-anything/Video-Depth-Anything-Small video_depth_anything_vits.pth (0.12 GB) into models/videodepthanything on first run'],
    notes:
      'yuvraj108c/ComfyUI-Video-Depth-Anything: LoadVideoDepthAnythingModel(model video_depth_anything_vits.pth - pass it explicitly, the declared default ".safetensors" is not in its own option list) -> ' +
      'VideoDepthAnythingProcess(input_size 518, max_res 1280, fp16) -> VideoDepthAnythingOutput(gray) -> CreateVideo (source fps). Designed for long videos with consistent depth across frames. Audio dropped.',
  },

  // ---- palette / colour lock ----------------------------------------------
  {
    id: 'palette-transfer-image',
    title: 'Palette Lock (ColorTransfer to a swatch)',
    capability: 'grade',
    handBuilt: 'hand-built/palette-transfer-image.json',
    bindings: {
      image: [b('1', 'image')],
      image2: [b('2', 'image')],
      strength: [b('3', 'strength')],
    },
    outputs: [{ node: '4', kind: 'image' }],
    limits: { maxWidth: 8192, maxHeight: 8192 },
    vramGb: 0,
    license: 'no model (ComfyUI core ColorTransfer)',
    notes:
      'Soul HEX parity: image = picture to recolor, image2 = palette swatch PNG the app renders from the HEX list (e.g. 512x512 bands sized by intended coverage). ColorTransfer method mkl_lab (alternatives reinhard_lab, histogram; not bound), ' +
      'strength 0-10 (0.8 default; > 1 exaggerates). Pair with hex codes in the generation prompt (FLUX.2 understands "#E4572E") for semantic placement. Histogram matching shifts skin tones: keep strength <= 0.8. Runs on CPU.',
  },
  {
    id: 'palette-transfer-video',
    title: 'Palette Lock for Video (ColorTransfer, flicker-free)',
    capability: 'v2v',
    handBuilt: 'hand-built/palette-transfer-video.json',
    bindings: {
      video: [b('1', 'file')],
      image: [b('3', 'image')],
      strength: [b('4', 'strength')],
    },
    outputs: [{ node: '6', kind: 'video' }],
    limits: { maxWidth: 4096, maxHeight: 4096 },
    vramGb: 0,
    license: 'no model (ComfyUI core ColorTransfer)',
    notes:
      'video = clip to recolor, image = palette swatch PNG. ColorTransfer(source_stats "uniform") pools colour statistics over all frames, so the grade does not flicker; mkl_lab, strength 0.8. ' +
      'Output keeps the source fps and audio. Runs on CPU.',
  },

  {
    id: 'selftest-image',
    title: 'Self-test: invert image',
    capability: 'edit',
    handBuilt: 'hand-built/selftest-image.json',
    bindings: { image: [b('1', 'image')], filenamePrefix: [b('3', 'filename_prefix')] },
    outputs: [{ node: '3', kind: 'image' }],
    vramGb: 0,
    notes: 'Runs on any ComfyUI (CPU is fine), needs no model files. Used by the Fuobe end-to-end self-test (tests/e2e/comfyui-selftest.mjs).',
  },
  {
    id: 'selftest-video',
    title: 'Self-test: image to flicker video',
    capability: 'i2v',
    handBuilt: 'hand-built/selftest-video.json',
    bindings: { image: [b('1', 'image')], filenamePrefix: [b('6', 'filename_prefix')] },
    outputs: [{ node: '6', kind: 'video' }],
    vramGb: 0,
    notes: 'Runs on any ComfyUI (CPU is fine), needs no model files. Exercises the SaveVideo output path.',
  },
  {
    id: 'selftest-meta-batch',
    title: 'Self-test: invert a clip 8 frames at a time (VHS meta-batch)',
    capability: 'v2v',
    handBuilt: 'hand-built/selftest-meta-batch.json',
    bindings: { video: [b('1', 'video')], filenamePrefix: [b('4', 'filename_prefix')] },
    outputs: [{ node: '4', kind: 'video' }],
    vramGb: 0,
    license: 'n/a (no model)',
    notes:
      'Runs on any ComfyUI (CPU is fine), needs no model files. VHS_BatchManager re-queues the prompt every 8 frames (new prompt ids, ui "unfinished_batch" until the last pass); ' +
      'exercises the provider\'s meta-batch follow-up that mixed-media-zimage-frames relies on. Keeps the source fps and audio.',
  },

  // =========================================================================
  // comfyui-oss-3 (round 3): docs/research/comfyui-oss-3.json. Graphs are the researcher's validated API graphs;
  // changes are listed in each entry's notes.
  // =========================================================================

  // ---- Layers ---------------------------------------------------------------
  {
    id: 'layers-qwen-image-layered',
    title: 'Layers: split an image into RGBA layers (Qwen-Image-Layered)',
    capability: 'layers',
    handBuilt: 'hand-built/layers-qwen-image-layered.json',
    bindings: {
      image: [b('74', 'image')], prompt: [b('116', 'value')], numLayers: [b('83:118', 'layers')], maxSize: [b('82', 'largest_size')],
      seed: [b('83:3', 'seed')], steps: [b('83:3', 'steps')], cfg: [b('83:3', 'cfg')],
    },
    outputs: [{ node: '60', kind: 'image', role: 'layers' }],
    limits: { maxLayers: 10 },
    vramGb: 24,
    license: 'Apache-2.0 (Qwen-Image-Layered weights and the Comfy-Org repack)',
    notes:
      'Template image_qwen_image_layered with the fp8mixed weights (bf16 is 40.9 GB). The input is scaled so its longest side = maxSize (640 is the trained bucket; 1024 works, slower). ' +
      'numLayers = how many RGBA layers come out (1-10, default 4 like the model card; the latent holds numLayers+1 slices and slice 0, the reconstructed composite, is cut off by LatentCut). prompt = optional caption of the whole image. ' +
      'SaveImage writes one full-canvas RGBA PNG per layer, back to front: the provider reports them in that order with meta {name, z, bbox} (bbox from the alpha channel). "Separate layer" = run again on one layer.',
  },
  {
    id: 'layers-qwen-image-layered-control',
    title: 'Layers: pull out a named element (Qwen-Image-Layered-Control)',
    capability: 'layers',
    handBuilt: 'hand-built/layers-qwen-image-layered-control.json',
    bindings: {
      image: [b('74', 'image')], prompt: [b('83:6', 'text')], numLayers: [b('83:123', 'layers')], maxSize: [b('82', 'largest_size')],
      seed: [b('83:3', 'seed')], steps: [b('83:3', 'steps')], cfg: [b('83:3', 'cfg')],
    },
    outputs: [{ node: '60', kind: 'image', role: 'layers' }],
    limits: { maxLayers: 10 },
    vramGb: 24,
    license: 'Apache-2.0 (DiffSynth-Studio Qwen-Image-Layered-Control)',
    notes:
      'Template image_qwen_image_layered_control. prompt names the element(s) to separate ("guitar", "the headline text"); numLayers 2 gives [rest, element] back to front. ' +
      'Higgsfield Layers "Separate layer" / click-to-extract. 40.9 GB bf16 download, cast to fp8_e4m3fn at load.',
  },

  // ---- Moodboards: style reference -----------------------------------------
  {
    id: 'style-ref-qwen-edit-2511',
    title: 'Style reference: Qwen-Image-Edit-2511 + Lightning, new image in the look of 1-2 board collages',
    capability: 'style-reference',
    handBuilt: 'hand-built/style-ref-qwen-edit-2511.json',
    bindings: {
      image: [b('1', 'image')], image2: [b('2', 'image')], prompt: [b('20', 'string_b')], width: [b('26', 'width')], height: [b('26', 'height')],
      seed: [b('27', 'seed')], steps: [b('27', 'steps')], cfg: [b('27', 'cfg')], loraStrength: [b('11', 'strength_model')],
    },
    outputs: [{ node: '29', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 24,
    license: 'Apache-2.0 (Qwen-Image-Edit-2511, Lightning LoRA)',
    notes:
      'The app builds 1-2 collages from the board (4-20 images as a contact sheet, ~1 MP each) and uploads them as image / image2 (one collage is passed twice). ' +
      'The instruction asks for the look, not the content: same palette, light, contrast, grain, lens and mood. Output size = the empty latent (any aspect ratio). ' +
      'Lightning 4 steps at cfg 1 (loraStrength 0, steps 40, cfg 4 for the slow full-quality path). Zero-shot; a persistent moodboard is a style LoRA trained like a character.',
  },
  {
    id: 'style-ref-flux2-klein-4b',
    title: 'Style reference: FLUX.2 [klein] 4B, four references (4 steps)',
    capability: 'style-reference',
    handBuilt: 'hand-built/style-ref-flux2-klein-4b.json',
    bindings: {
      image: [b('76', 'image')], image2: [b('81', 'image')], image3: [b('77', 'image')], image4: [b('78', 'image')], prompt: [b('75:74', 'text')],
      width: [b('75:66', 'width'), b('75:62', 'width')], height: [b('75:66', 'height'), b('75:62', 'height')], seed: [b('75:73', 'noise_seed')], steps: [b('75:62', 'steps')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 10,
    license: 'Apache-2.0 (FLUX.2 [klein] 4B)',
    notes:
      'Template image_flux2_klein_image_edit_4b_distilled with two extra ReferenceLatent references and an explicit output size. 1-4 references: ' +
      'the provider bypasses the ReferenceLatent pair of each reference not given (bypassReference). Fast (4 steps, 8-10 GB). Weaker than Qwen-Image-Edit-2511 on complex prompts.',
  },
  {
    id: 'style-ref-krea2',
    title: 'Style reference: Krea 2 Turbo + style_reference LoRA, two references',
    capability: 'style-reference',
    handBuilt: 'hand-built/style-ref-krea2.json',
    bindings: {
      image: [b('69', 'image')], image2: [b('70', 'image')], prompt: [b('30:19', 'value')],
      width: [b('30:61', 'width'), b('30:64', 'width')], height: [b('30:61', 'height'), b('30:64', 'height')], seed: [b('30:63', 'noise_seed')], steps: [b('30:60', 'steps')],
      loraStrength: [b('30:15', 'strength_model')],
    },
    outputs: [{ node: '29', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 20,
    license: 'Krea 2 Community License (free for individuals and small teams; enterprise terms above the thresholds); LoRA by Ostris under the same licence',
    notes:
      'The only open model here trained for style reference (1-2 references). The template ResolutionSelector is replaced by explicit width/height (multiple of 16); its TextGenerate prompt expansion is removed (Fuobe enhances prompts itself).',
  },
  {
    id: 'style-ref-uso-flux1',
    title: 'Style reference: USO on FLUX.1 [dev], two stacked style images (non-commercial base)',
    capability: 'style-reference',
    handBuilt: 'hand-built/style-ref-uso-flux1.json',
    bindings: {
      image: [b('1', 'image')], image2: [b('2', 'image')], prompt: [b('20', 'text')], width: [b('23', 'width')], height: [b('23', 'height')],
      seed: [b('24', 'seed')], steps: [b('24', 'steps')], guidance: [b('21', 'guidance')],
    },
    outputs: [{ node: '26', kind: 'image' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 20,
    license: 'USO LoRA/projector Apache-2.0, but the FLUX.1 [dev] base is NON-COMMERCIAL (outputs may be used commercially per the BFL licence; running it as a paid service is not)',
    notes: 'ByteDance USO style-only reference: each USOStyleReference stacks one more style image (CLIPVisionEncode + USOStyleReference pairs). 20 steps, guidance 3.5, cfg 1.',
  },

  // ---- Soul HEX: palette-conditioned generation -------------------------------
  {
    id: 'palette-zimage-hex',
    title: 'Soul HEX: Z-Image Turbo with the hex palette in the prompt + ColorTransfer lock to a swatch',
    capability: 'palette',
    handBuilt: 'hand-built/palette-zimage-hex.json',
    bindings: {
      paletteImage: [b('1', 'image')], prompt: [b('20', 'string_a')], paletteText: [b('20', 'string_b')], width: [b('23', 'width')], height: [b('23', 'height')],
      seed: [b('24', 'seed')], steps: [b('24', 'steps')], strength: [b('26', 'strength')], method: [b('26', 'method')],
    },
    outputs: [{ node: '27', kind: 'image' }],
    defaults: { method: 'mkl_lab', paletteText: 'Color palette: #0F0C0B, #65370D, #916D4C, #C6BE94, #F2F1C4.' },
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 12,
    license: 'Apache-2.0 (Z-Image Turbo); ColorTransfer has no model',
    notes:
      'One job = generate + lock. The provider writes paletteText from params.palette ("Color palette: #.., #..") and renders paletteImage, a swatch PNG with one band per colour, server-side. ' +
      'strength 0 = prompt only; 0.5-0.8 = lock; 1.0 = full statistics transfer (shifts skin tones). method mkl_lab (default, keeps contrast), reinhard_lab (softer), histogram (strongest). ' +
      'palette-transfer-image / -video do the same lock as a post-step for any model (cloud outputs too).',
  },

  // ---- Shorts Studio / Mixed Media: trim, segment, restyle ------------------------
  {
    id: 'video-trim',
    title: 'Trim a clip by seconds (core Trim Video, keeps fps and audio)',
    capability: 'trim',
    handBuilt: 'hand-built/video-trim.json',
    bindings: { video: [b('1', 'file')], startTime: [b('2', 'start_time')], duration: [b('2', 'duration')] },
    outputs: [{ node: '3', kind: 'video' }],
    vramGb: 0,
    license: 'n/a (no model)',
    notes:
      'startTime = params.startTime, duration = params.endTime - params.startTime (0 = to the end). Keeps the source fps, size and audio. ' +
      'Shorts Studio segmenting: one job per <=5 s window. Runs on CPU (verified end to end through Fuobe).',
  },
  {
    id: 'video-segment-resample',
    title: 'Cut a segment at a target fps and size, plus its first frame (VHS loader)',
    capability: 'trim',
    handBuilt: 'hand-built/video-segment-resample.json',
    bindings: {
      video: [b('1', 'video')], fps: [b('1', 'force_rate'), b('3', 'fps')], startFrame: [b('1', 'skip_first_frames')], frames: [b('1', 'frame_load_cap')],
      width: [b('2', 'width')], height: [b('2', 'height')],
    },
    outputs: [{ node: '4', kind: 'video' }, { node: '7', kind: 'image', role: 'first-frame' }],
    limits: { maxWidth: 1920, maxHeight: 1920, dimensionMultiple: 16, maxFrames: 241, frameStep: 4 },
    vramGb: 0,
    license: 'n/a (no model)',
    notes:
      'VHS_LoadVideo resamples to fps (force_rate) first, then skips startFrame frames (= params.startTime * fps) and keeps frames (= (endTime - startTime) * fps, 4n+1 for Wan); ImageScale crops to width x height (aspect ratio + resolution). ' +
      '81 frames @16 fps = 5.06 s, the Wan 2.2 window. Second output = the segment\'s first frame (restyle it, then video-restyle-wan22-fun-vace). Also the Mixed Media frame sampler (fps 4-24). Runs on CPU.',
  },
  {
    id: 'video-restyle-wan22-fun-vace',
    title: 'Restyle a <=5 s segment: Wan 2.2 Fun VACE with depth control + a restyled first frame',
    capability: 'v2v',
    handBuilt: 'hand-built/video-restyle-wan22-fun-vace.json',
    bindings: {
      video: [b('1', 'file')], image: [b('4', 'image')], prompt: [b('12', 'text')], negativePrompt: [b('13', 'text')],
      width: [b('3', 'width'), b('5', 'width'), b('9', 'width'), b('34', 'width'), b('35', 'width'), b('15', 'width')],
      height: [b('3', 'height'), b('5', 'height'), b('9', 'height'), b('34', 'height'), b('35', 'height'), b('15', 'height')],
      frames: [b('30', 'value')], fps: [b('26', 'fps')], seed: [b('22', 'noise_seed'), b('23', 'noise_seed')], steps: [b('22', 'steps'), b('23', 'steps')],
      cfg: [b('22', 'cfg'), b('23', 'cfg')], shift: [b('20', 'shift'), b('21', 'shift')], controlStrength: [b('15', 'strength')],
    },
    outputs: [{ node: '27', kind: 'video' }],
    limits: { maxWidth: 1280, maxHeight: 1280, dimensionMultiple: 16, maxFrames: 81, frameStep: 4 },
    vramGb: 24,
    license: 'Apache-2.0 (Wan 2.2 Fun VACE, lightx2v, Depth Anything 3 mono-large)',
    notes:
      'Shorts Studio chain: video-segment-resample (<=81 frames @16 fps + first frame) -> qwen-image-edit-2511 restyles the first frame with the preset prompt -> this graph -> video-concat-N. ' +
      'Control: frame 0 = the restyled frame (image, kept), frames 1..N-1 = Depth Anything 3 depth maps (generated); the restyled frame is also the VACE reference. Lightx2v 4 steps. frames must be 4n+1 and <= the segment length.',
  },
  {
    id: 'mixed-media-zimage-frames',
    title: 'Mixed Media: per-frame stylisation at 4-24 fps (Z-Image Turbo img2img + Fun Union ControlNet canny)',
    capability: 'v2v',
    handBuilt: 'hand-built/mixed-media-zimage-frames.json',
    bindings: {
      video: [b('1', 'video')], fps: [b('1', 'force_rate'), b('22', 'frame_rate')], frames: [b('1', 'frame_load_cap')], startFrame: [b('1', 'skip_first_frames')],
      width: [b('3', 'width')], height: [b('3', 'height')], prompt: [b('16', 'text')], seed: [b('20', 'seed')], steps: [b('20', 'steps')],
      denoise: [b('20', 'denoise')], controlStrength: [b('14', 'strength')], framesPerBatch: [b('2', 'frames_per_batch')],
    },
    outputs: [{ node: '22', kind: 'video' }],
    limits: { maxWidth: 1536, maxHeight: 1536, dimensionMultiple: 16, maxFrames: 240, frameStep: 1 },
    vramGb: 16,
    license: 'Apache-2.0 (Z-Image Turbo, Z-Image-Turbo-Fun-Controlnet-Union)',
    notes:
      'Higgsfield Mixed Media: frames sampled at 4/8/10/12/24 fps (force_rate), each frame restyled with the preset prompt, re-assembled at the same fps with the source audio. ' +
      'VHS_BatchManager re-queues the prompt every framesPerBatch frames so VRAM stays flat: the provider follows the re-queued prompts (same filename prefix) and collects the final video. ' +
      'Fixed batch noise = less flicker. denoise 0.55-0.8 trades fidelity for style; canny keeps outlines.',
  },

  // ---- Sound effects ------------------------------------------------------------
  {
    id: 'sfx-stable-audio-3-small',
    title: 'Sound effects: Stable Audio 3.0 Small SFX (native, 8 steps)',
    capability: 'sfx',
    handBuilt: 'hand-built/sfx-stable-audio-3-small.json',
    bindings: {
      prompt: [b('52:31', 'value')], negativePrompt: [b('52:7', 'text')], duration: [b('52:36', 'value')], seed: [b('52:3', 'seed')], steps: [b('52:3', 'steps')],
      cfg: [b('52:3', 'cfg')], checkpoint: [b('52:25', 'ckpt_name')],
    },
    outputs: [{ node: '57', kind: 'audio' }],
    defaults: { checkpoint: 'stable_audio_3_small_sfx.safetensors' },
    vramGb: 6,
    license: 'Stability AI Community License (free below US$1M annual revenue)',
    notes:
      'Template audio_stable_audio_3_medium with the Qwen3.5 prompt-expansion branch removed and the checkpoint switched to small_sfx (Fuobe enhances prompts itself). Distilled: lcm, 8 steps, cfg 1. ' +
      'checkpoint can be stable_audio_3_medium.safetensors (9.2 GB, music + SFX, longer) with the same graph. Stereo, duration in seconds (2-20 s for SFX).',
  },
  {
    id: 'sfx-stable-audio-open',
    title: 'Sound effects: Stable Audio Open 1.0 (native, up to 47 s)',
    capability: 'sfx',
    handBuilt: 'hand-built/sfx-stable-audio-open.json',
    bindings: {
      prompt: [b('6', 'text')], negativePrompt: [b('7', 'text')], duration: [b('11', 'seconds')], seed: [b('3', 'seed')], steps: [b('3', 'steps')], cfg: [b('3', 'cfg')],
    },
    outputs: [{ node: '20', kind: 'audio' }],
    vramGb: 6,
    license: 'Stability AI Community License (free below US$1M annual revenue; enterprise licence above)',
    notes: 'Template audio_stable_audio_example; SaveAudioAdvanced switched from flac to mp3 V0. 44.1 kHz stereo, max 47.6 s. dpmpp_3m_sde_gpu / exponential, 50 steps, cfg ~5.',
  },
  {
    id: 'sfx-hunyuan-foley',
    title: 'Sound effects: HunyuanVideo-Foley XL, text to audio (territory-restricted licence)',
    capability: 'sfx',
    handBuilt: 'hand-built/sfx-hunyuan-foley.json',
    bindings: {
      prompt: [b('3', 'prompt')], negativePrompt: [b('3', 'negative_prompt')], duration: [b('3', 'duration')], seed: [b('3', 'seed')], steps: [b('3', 'steps')], cfg: [b('3', 'cfg_scale')],
    },
    outputs: [{ node: '4', kind: 'audio' }],
    vramGb: 12,
    license: 'Tencent Hunyuan Community License (territory EXCLUDES the EU, UK and South Korea)',
    autoDownloads: ['HunyuanDependenciesLoader fetches the SigLIP2 and CLAP text encoders into the Hugging Face cache on first run'],
    notes: 'HunyuanFoleySampler.image is optional, so the same graph is text-to-audio (connect frames for video-synced foley). 48 kHz. Needs loguru (install-comfyui.sh).',
  },
  {
    id: 'sfx-mmaudio-t2a',
    title: 'Sound effects: MMAudio large 44k v2, text only (non-commercial weights)',
    capability: 'sfx',
    handBuilt: 'hand-built/sfx-mmaudio-t2a.json',
    bindings: {
      prompt: [b('3', 'prompt')], negativePrompt: [b('3', 'negative_prompt')], duration: [b('3', 'duration')], seed: [b('3', 'seed')], steps: [b('3', 'steps')], cfg: [b('3', 'cfg')],
    },
    outputs: [{ node: '4', kind: 'audio' }],
    vramGb: 8,
    license: 'CC-BY-NC-4.0 (MMAudio weights: NON-COMMERCIAL)',
    notes: 'Same files as v2a-mmaudio (no new download). MMAudioSampler.images is optional: without it MMAudio runs text-to-audio. Trained on 8 s clips (longer durations degrade).',
  },
  {
    id: 'sfx-thinksound',
    title: 'Sound effects: ThinkSound light, text to audio with a sound description (isolated worker)',
    capability: 'sfx',
    handBuilt: 'hand-built/sfx-thinksound.json',
    bindings: {
      prompt: [b('3', 'caption')], description: [b('3', 'cot_description')], duration: [b('3', 'duration')], seed: [b('3', 'seed')], steps: [b('3', 'steps')], cfg: [b('3', 'cfg_scale')],
    },
    outputs: [{ node: '4', kind: 'audio' }],
    vramGb: 12,
    worker: 'isolated',
    license: 'Apache-2.0 (ThinkSound weights, FunAudioLLM); wrapper code has no LICENSE file',
    autoDownloads: ['ThinkSoundFeatureUtilsLoader fetches google/t5-v1_1-xl and facebook/metaclip-h14 into the Hugging Face cache on first run'],
    notes:
      'The only permissive SFX model found. prompt = short caption, description = the chain-of-thought sound description ThinkSound was trained with (the provider uses the prompt when none is given). Max 30 s. ' +
      'ISOLATED WORKER: the wrapper is stale and its requirements pin old versions that would downgrade the shared venv; run it on a separate ComfyUI (scripts/comfy/README.md).',
  },

  // ---- Dubbing / transcription / captions ---------------------------------------
  {
    id: 'dub-prepare-separate-transcribe',
    title: 'Separate voice and background (MelBand RoFormer) and transcribe the voice with timestamps (Qwen3-ASR 1.7B)',
    capability: 'separate-audio',
    handBuilt: 'hand-built/dub-prepare-separate-transcribe.json',
    bindings: {
      audio: [b('1', 'audio')], sourceLanguage: [b('7', 'language')], asrModel: [b('7', 'model')], hints: [b('7', 'hints')], maxChars: [b('7', 'max_chars')],
    },
    outputs: [
      { node: '5', kind: 'audio', stem: 'voice' },
      { node: '6', kind: 'audio', stem: 'background' },
      { node: '8', kind: 'text', role: 'cues' },
      { node: '9', kind: 'text', role: 'transcript' },
      { node: '10', kind: 'text', role: 'language' },
    ],
    defaults: { sourceLanguage: 'auto', asrModel: 'Qwen/Qwen3-ASR-1.7B-hf' },
    vramGb: 8,
    license: 'MelBand RoFormer weights MIT (KimberleyJSN); Qwen3-ASR / ForcedAligner Apache-2.0; ComfyUI-QwenASR code GPL-3.0 (same as ComfyUI)',
    autoDownloads: [
      'AILab_Qwen3ASRSubtitle downloads Qwen/Qwen3-ASR-1.7B-hf (4.08 GB; 0.6B: 1.56 GB) and Qwen/Qwen3-ForcedAligner-0.6B-hf (1.84 GB) into models/Qwen3-ASR on first run',
    ],
    notes:
      'Dubbing step 1. Changed from the research graph: LoadAudio replaces LoadVideo + GetVideoComponents (LoadAudio decodes the soundtrack of a video upload too, without decoding frames), so it takes audio or video. ' +
      'Outputs in order: voice stem, background stem (music + effects), cue lines ("start-end: text", seconds), plain transcript, detected language (PreviewAny, folded into the text outputs\' meta). ' +
      'ASR runs on the separated vocals. 52 languages auto-detected (30 selectable).',
  },
  {
    id: 'captions-qwen3-asr',
    title: 'Transcribe speech into timed caption cues (Qwen3-ASR 0.6B + ForcedAligner)',
    capability: 'transcribe',
    handBuilt: 'hand-built/captions-qwen3-asr.json',
    bindings: {
      audio: [b('1', 'audio')], sourceLanguage: [b('3', 'language')], asrModel: [b('3', 'model')], maxChars: [b('3', 'max_chars')], hints: [b('3', 'hints')],
    },
    outputs: [{ node: '4', kind: 'text', role: 'cues' }, { node: '5', kind: 'text', role: 'language' }],
    defaults: { sourceLanguage: 'auto', asrModel: 'Qwen/Qwen3-ASR-0.6B-hf' },
    vramGb: 4,
    license: 'Qwen3-ASR / ForcedAligner Apache-2.0; ComfyUI-QwenASR code GPL-3.0',
    autoDownloads: ['AILab_Qwen3ASRSubtitle downloads Qwen/Qwen3-ASR-0.6B-hf (1.56 GB) and Qwen/Qwen3-ForcedAligner-0.6B-hf (1.84 GB) into models/Qwen3-ASR on first run'],
    notes:
      'Default caption source for Faceless / Shorts. Changed from the research graph: LoadAudio instead of LoadVideo + GetVideoComponents (audio or video input). ' +
      'maxChars 32 + split_by_punctuation_or_pause_or_length gives short vertical-video lines. The text output is one "start-end: text" line per cue; the provider parses it into meta.cues. ' +
      'output_format none: the node writes no file of its own (concurrent jobs would race on one captions.srt); SaveText returns the cues. ' +
      'Burn the cues in with captions-burnin (chain: transcript text -> prompt).',
  },
  {
    id: 'captions-burnin',
    title: 'Burn captions into a video (core Draw Text Overlay, chunk by chunk)',
    capability: 'captions',
    handBuilt: 'hand-built/captions-burnin.json',
    bindings: {
      video: [b('1', 'file'), b('3', 'audio')], fontSize: [b('12', 'font_size')], fontColor: [b('12', 'color')], captionPosition: [b('12', 'position')],
    },
    outputs: [{ node: '92', kind: 'video' }],
    defaults: { fontColor: '#ffffff', captionPosition: 'bottom' },
    expand: 'captions',
    vramGb: 0,
    license: 'no model (ComfyUI core TextOverlay, GPL-3.0 like ComfyUI; Pillow\'s bundled Aileron font, OFL)',
    notes:
      'Fuobe\'s open caption burn-in, all inside ComfyUI with core nodes. The provider rewrites the graph per request (expandCaptionWorkflow): the cues (prompt lines "start-end: text" or SRT, e.g. from captions-qwen3-asr) ' +
      'cut the clip into Trim Video windows. Gaps go straight to Concatenate Video (never decoded). A cue window is cut into chunks of at most ~384 MB of frames (about 0.5 s of 1080x1920 at 30 fps, 5 s at 360p); ' +
      'each chunk is decoded (GetVideoComponents), gets a TextOverlay in the style of node 12 (fontSize = % of the frame height, fontColor, captionPosition top | bottom, outlined) and is encoded at once (CreateVideo codec h264), ' +
      'so ComfyUI only needs one chunk of raw frames at a time and can evict finished chunks under memory pressure. Concatenate Video joins chunks and gaps in order and lays the clip\'s own soundtrack (LoadAudio, node 3) ' +
      'under the result; for a silent clip node 3 is dropped. The provider reads the upload\'s MP4 header for duration, fps, size and audio: window edges sit between frames, cues past the end are dropped and the rest of the clip after the last cue stays uncaptioned. ' +
      'Windows hold at least 3 frames (Concatenate Video rejects a 2-frame clip followed by another): a shorter pause between cues gets no gap, a shorter caption is held for 3 frames. ' +
      'Measured on the CPU server under RAM pressure (--cache-ram 11): a 20 s 640x360 30 fps clip with 18 s of captions peaks at +0.50 GB RSS and a 40 s one at +0.45 GB (the old one-batch graph: +5.16 GB for the 20 s clip); ' +
      'without pressure ComfyUI\'s RAM cache keeps finished chunks (+2.64 GB for 20 s) until memory runs low. Runs on CPU (verified end to end through Fuobe).',
  },
  {
    id: 'captions-whisper-burnin',
    title: 'Captions in one job: Whisper large-v3-turbo word timestamps burned into the frames (non-commercial code)',
    capability: 'captions',
    handBuilt: 'hand-built/captions-whisper-burnin.json',
    bindings: {
      video: [b('1', 'video')], sourceLanguage: [b('3', 'language')], whisperModel: [b('3', 'model')], fontSize: [b('4', 'font_size')], fontColor: [b('4', 'font_color')],
    },
    outputs: [{ node: '5', kind: 'video' }, { node: '7', kind: 'text', role: 'transcript' }],
    defaults: { sourceLanguage: 'auto', whisperModel: 'large-v3-turbo', fontColor: 'white' },
    vramGb: 6,
    license: 'Whisper weights MIT (OpenAI); ComfyUI-Whisper code CC-BY-NC-SA-4.0 (NON-COMMERCIAL: the author asks to be contacted for commercial use)',
    autoDownloads: ['Apply Whisper downloads large-v3-turbo.pt (1.62 GB) into models/stt/whisper on first run'],
    notes:
      'All-ComfyUI alternative that transcribes and burns in one job (word-by-word captions from words_alignment). One style per run (font, size, colour, border, centred). ' +
      'Because of the NC code licence the default open route is captions-qwen3-asr + captions-burnin, and install-comfyui.sh only installs ComfyUI-Whisper with NC_PACKS=1. Save SRT (not an output node) is dropped; the transcript text is kept. ' +
      'VHS_LoadVideo decodes the whole clip and Add Subtitles To Frames copies it (about 2.5 copies of the frames in RAM): the provider refuses clips that would need more than half of the ComfyUI server\'s RAM and points to the chunked route. ' +
      'sourceLanguage takes Whisper\'s own names (the provider maps ISO codes: tl/fil -> Tagalog, he -> Hebrew).',
  },
  {
    id: 'translate-qwen35-textgen',
    title: 'Translate text or timed caption lines with Qwen3.5 4B (core TextGenerate)',
    capability: 'translate',
    handBuilt: 'hand-built/translate-qwen35-textgen.json',
    bindings: {
      instruction: [b('2', 'string_a')], prompt: [b('2', 'string_b')], seed: [b('3', 'sampling_mode.seed')], maxTokens: [b('3', 'max_length')],
    },
    outputs: [{ node: '4', kind: 'text' }],
    defaults: {
      instruction:
        'Translate the text below into {language}. If it has "start-end:" timestamps, keep every line and keep the timestamps exactly as they are, translate only the text after the colon and keep it about as long as the original so it can be spoken in the same time. Output only the translation.\n\n',
    },
    vramGb: 10,
    license: 'Apache-2.0 (Qwen3.5)',
    notes:
      'Dubbing step 2 fully inside ComfyUI (Fuobe\'s LLM provider is the default; this keeps an all-open route). prompt = the text (e.g. the cue lines of dub-prepare-separate-transcribe), ' +
      'instruction = defaults.instruction with {language} = params.targetLanguage. Temperature 0.3 for faithful output. Changed from the research graph: the text binding is named prompt.',
  },
  {
    id: 'speech-translate-gemma4',
    title: 'Speech to translated text in one step: Gemma 4 E4B audio input (core TextGenerate)',
    capability: 'translate',
    handBuilt: 'hand-built/speech-translate-gemma4.json',
    bindings: { audio: [b('5', 'audio')], instruction: [b('1', 'prompt')], seed: [b('1', 'sampling_mode.seed')], maxTokens: [b('1', 'max_length')] },
    outputs: [{ node: '8', kind: 'text' }],
    defaults: { instruction: 'Transcribe the speech in this audio, then translate it into {language}. Output only the {language} translation.' },
    vramGb: 12,
    license: 'Apache-2.0 (Gemma 4)',
    notes:
      'Gemma 4 E2B/E4B take audio natively. No timestamps: use it for voice-over style dubs (whole-script TTS) or as a cross-check; use dub-prepare-separate-transcribe when the dub must follow cue timings. ' +
      'Keep clips under a few minutes (context). Changed from the research graph: the prompt binding is named instruction ({language} = params.targetLanguage).',
  },
  {
    id: 'lipsync-v2v-infinitetalk',
    title: 'Lip re-sync real footage to a new voice: InfiniteTalk video-to-video (WanVideoWrapper)',
    capability: 'lipsync',
    handBuilt: 'hand-built/lipsync-v2v-infinitetalk.json',
    bindings: {
      video: [b('228', 'video')], audio: [b('125', 'audio')], prompt: [b('241', 'positive_prompt')], negativePrompt: [b('241', 'negative_prompt')],
      width: [b('245', 'value')], height: [b('246', 'value')], frames: [b('270', 'value'), b('228', 'frame_load_cap')], seed: [b('128', 'seed')], steps: [b('128', 'steps')],
      startStep: [b('128', 'start_step')], audioScale: [b('194', 'audio_scale')],
    },
    outputs: [{ node: '131', kind: 'video' }],
    defaults: { fps: 25 },
    limits: { maxWidth: 1280, maxHeight: 1280, dimensionMultiple: 16, maxFrames: 1000 },
    vramGb: 24,
    license: 'Apache-2.0 (Wan 2.1, InfiniteTalk, lightx2v)',
    autoDownloads: ['DownloadAndLoadWav2VecModel fetches TencentGameMate/chinese-wav2vec2-base (0.38 GB) on first run'],
    notes:
      'Same model files as infinitetalk-wanwrapper (no new download). The source frames are VAE-encoded and only the last steps are re-denoised (steps 4, startStep 2), so camera, background and body stay; ' +
      'mouth, head and upper body follow the new audio. 81-frame windows until the audio ends. Changed from the research graph: VHS_LoadVideo gets only custom_width (height 0 keeps the source\'s proportions, no squashing) ' +
      'and ImageResizeKJv2 crops to width x height, which the provider takes from the source\'s own shape (aspect ratio "auto", read from the MP4 header) at the chosen resolution; ' +
      'frames (num_frames and VHS frame_load_cap) = the voice\'s length at 25 fps, at most 1000 (40 s): the provider refuses a longer voice instead of cutting it. Pass the clean dubbed voice, then mux the background with video-mux-audio.',
  },
  {
    id: 'lipsync-latentsync16',
    title: 'Lip re-sync, mouth only: LatentSync 1.6 (isolated worker)',
    capability: 'lipsync',
    handBuilt: 'hand-built/lipsync-latentsync16.json',
    bindings: {
      video: [b('1', 'video')], audio: [b('2', 'audio')], lengthMode: [b('3', 'mode')], seed: [b('4', 'seed')], lipsExpression: [b('4', 'lips_expression')], steps: [b('4', 'inference_steps')],
    },
    outputs: [{ node: '5', kind: 'video' }],
    defaults: { lengthMode: 'loop_to_audio' },
    vramGb: 20,
    worker: 'isolated',
    license: 'LatentSync 1.6 weights CreativeML OpenRAIL++-M (commercial use with use-based restrictions); wrapper code has no LICENSE file',
    autoDownloads: ['LatentSyncNode snapshot_downloads ByteDance/LatentSync-1.6 (latentsync_unet.pt 5.07 GB, whisper/tiny.pt 0.08 GB), stabilityai/sd-vae-ft-mse (0.33 GB) and the s3fd face detector (0.09 GB) on first run'],
    notes:
      'Re-renders only the mouth (512x512 face crop): identity, background and camera are untouched. VideoLengthAdjuster: normal (pad audio, trim video), pingpong / loop_to_audio (extend the picture when the dub is longer). 25 fps; needs a visible, mostly frontal face. ' +
      'ISOLATED WORKER: at import the wrapper overrides TMPDIR and folder_paths temp handling for the whole process, rmtree()s a temp folder next to ComfyUI and pip-installs packages at node init, so run it on a separate ComfyUI (scripts/comfy/README.md).',
  },
  {
    id: 'video-mux-audio',
    title: 'Add a soundtrack: new voice + background stem mixed onto a video (picture stream-copied)',
    capability: 'mux',
    handBuilt: 'hand-built/video-mux-audio.json',
    bindings: {
      video: [b('1', 'file')], audio: [b('3', 'audio')], audio2: [b('4', 'audio')], backgroundVolumeDb: [b('5', 'volume')], duration: [b('9', 'duration')],
    },
    outputs: [{ node: '8', kind: 'video' }],
    vramGb: 0,
    license: 'n/a (no model)',
    notes:
      'audio = the new voice (Chatterbox dub, narration), audio2 = the background stem of dub-prepare-separate-transcribe or a music bed (backgroundVolumeDb, e.g. -12 under narration). ' +
      'Both are mixed over EmptyAudio of the video\'s length (duration: the provider reads it from the MP4 header), because AudioMerge cuts audio2 to audio1\'s length. ' +
      'Concatenate Video with complete_audio copies the video stream packet by packet (no decode, no re-encode: lossless, constant memory) and encodes only the new AAC soundtrack. ' +
      'Video length is unchanged. Without audio2 the provider uses video-mux-audio-replace. Runs on CPU (verified end to end through Fuobe; +0.02 GB RAM for a 900-frame clip).',
  },
  {
    id: 'video-mux-audio-replace',
    title: 'Replace a video\'s soundtrack with one audio track',
    capability: 'mux',
    handBuilt: 'hand-built/video-mux-audio-replace.json',
    bindings: { video: [b('1', 'file')], audio: [b('3', 'audio')] },
    outputs: [{ node: '8', kind: 'video' }],
    vramGb: 0,
    license: 'n/a (no model)',
    notes:
      'LoadVideo + LoadAudio -> Concatenate Video (complete_audio) -> SaveVideo: the picture is stream-copied, only the new soundtrack is encoded. The single-track variant of video-mux-audio (voice-over, narration, music). ' +
      'A soundtrack longer than the video is cut at the video\'s end. Runs on CPU (verified end to end through Fuobe).',
  },

  // ---- Product 3D, try-on --------------------------------------------------------
  {
    id: 'image-to-3d-trellis2',
    title: 'Image to textured 3D (TRELLIS.2, PBR GLB) + a 36-view turntable video',
    capability: 'image-to-3d',
    handBuilt: 'hand-built/image-to-3d-trellis2.json',
    bindings: {
      image: [b('122', 'image')], seed: [b('3', 'seed'), b('12', 'seed'), b('18', 'seed'), b('23', 'seed')], textureSize: [b('288', 'value')], turntableFps: [b('701', 'fps')],
    },
    outputs: [{ node: '322', kind: 'model3d' }, { node: '702', kind: 'video', role: 'turntable' }],
    vramGb: 16,
    license: 'MIT (TRELLIS.2 weights, DINOv3-NAF / TRELLIS VAEs as repackaged by Comfy-Org, BiRefNet)',
    notes:
      'Template 3d_pixal3d_trellis2_image_to_model: BiRefNet cut-out -> crop to mask -> TRELLIS.2 structure (12 steps) -> shape (20) -> upsample to 1536 (12) -> texture (12) -> remesh -> UV unwrap -> ' +
      'baked base colour / metallic / roughness / AO / normal at textureSize -> GLB (Save3DAdvanced, history ui "3d"). The graph adds a 36-view turntable (RotateMesh + RenderMesh, core) saved as MP4 at turntableFps.',
  },
  {
    id: 'image-to-3d-hunyuan3d-21',
    title: 'Image to 3D shape: Hunyuan3D 2.1 (native, untextured GLB; territory-restricted licence)',
    capability: 'image-to-3d',
    handBuilt: 'hand-built/image-to-3d-hunyuan3d-21.json',
    bindings: { image: [b('2', 'image')], seed: [b('7', 'seed')], steps: [b('7', 'steps')], cfg: [b('7', 'cfg')], octreeResolution: [b('8', 'octree_resolution')] },
    outputs: [{ node: '10', kind: 'model3d' }],
    vramGb: 10,
    license: 'Tencent Hunyuan 3D 2.1 Community License (territory EXCLUDES the EU, UK and South Korea)',
    notes: 'Template 3d_hunyuan3d-v2.1. Shape only (no Hunyuan3D-Paint in the native nodes): clay previews or a separate texture step. Feed a background-removed image (bg-remove-birefnet).',
  },
  {
    id: 'tryon-flux2-klein-4b',
    title: 'Virtual try-on: FLUX.2 [klein] 4B + try-on LoRA (person + top + bottom)',
    capability: 'try-on',
    handBuilt: 'hand-built/tryon-flux2-klein-4b.json',
    bindings: {
      image: [b('76', 'image')], image2: [b('81', 'image')], image3: [b('77', 'image')], prompt: [b('75:74', 'text')], seed: [b('75:73', 'noise_seed')],
      steps: [b('75:62', 'steps')], loraStrength: [b('75:400', 'strength_model')],
    },
    outputs: [{ node: '9', kind: 'image' }],
    defaults: { promptPrefix: 'TRYON' },
    vramGb: 10,
    license: 'Apache-2.0 (FLUX.2 [klein] 4B, try-on LoRA by xocialize); segformer_b2_clothes MIT; ComfyUI-RMBG code GPL-3.0',
    autoDownloads: ['ClothesSegment (ComfyUI-RMBG) downloads segformer_b2_clothes (0.11 GB) into models/RMBG/segformer_clothes on first run'],
    notes:
      'Reference order is load-bearing (LoRA card): image = person, image2 = top (or a dress / whole outfit), image3 = bottom. image2 is required; without image3 the provider bypasses the bottom\'s ReferenceLatent pair ' +
      '(one garment reference) instead of passing the top as the bottom. The LoRA was trained on clothing-agnostic inputs, ' +
      'so ClothesSegment greys the old outfit out first. Trigger word TRYON (defaults.promptPrefix: the provider puts it at the start of the prompt). Output size = the person image (~1 MP).',
  },

  // ---- Cinema Studio grid and Soul Cast -------------------------------------------
  {
    id: 'grid-zimage-contact-sheet',
    title: 'Image grid: one Z-Image Turbo contact sheet (2x2 / 3x3 / 4x4) + its tiles',
    capability: 'image-grid',
    handBuilt: 'hand-built/grid-zimage-contact-sheet.json',
    bindings: {
      gridPrompt: [b('20', 'string_a')], prompt: [b('20', 'string_b')], width: [b('23', 'width')], height: [b('23', 'height')], columns: [b('27', 'columns')], rows: [b('27', 'rows')],
      seed: [b('24', 'seed')], steps: [b('24', 'steps')],
    },
    outputs: [{ node: '26', kind: 'image', role: 'sheet' }, { node: '28', kind: 'image', role: 'tiles' }],
    defaults: {
      gridPrompt:
        'A {columns}x{rows} grid contact sheet of {count} film stills from the same scene, edge to edge with thin black gutters, consistent characters, wardrobe, lighting and colour grade in every panel, varied shot sizes and angles:',
    },
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 14,
    license: 'Apache-2.0 (Z-Image Turbo)',
    notes:
      'gridPrompt defaults to a contact-sheet sentence for the chosen columns x rows ({columns}, {rows}, {count} are filled by the provider). ' +
      'Higgsfield "full grid from a single prompt": one generation, then KJNodes ImageGridtoBatch cuts the sheet into columns x rows tiles (row-major). gridPrompt is chosen by the app per size/type ' +
      '(freeform, zooms, shots); next/prev shots continue from a tile with storyboard-qwen-edit-2509-next-scene. Outputs: the sheet first, then the tiles.',
  },
  {
    id: 'soul-cast-sheet-zimage',
    title: 'Soul Cast: Z-Image Turbo character turnaround sheet (front, three-quarter, profile, back)',
    capability: 'character-sheet',
    handBuilt: 'hand-built/soul-cast-sheet-zimage.json',
    bindings: {
      sheetPrompt: [b('20', 'string_a')], prompt: [b('20', 'string_b')], width: [b('23', 'width')], height: [b('23', 'height')], columns: [b('27', 'columns')], rows: [b('27', 'rows')],
      seed: [b('24', 'seed')], steps: [b('24', 'steps')],
    },
    outputs: [{ node: '26', kind: 'image', role: 'sheet' }, { node: '28', kind: 'image', role: 'tiles' }],
    limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
    vramGb: 14,
    license: 'Apache-2.0 (Z-Image Turbo)',
    notes:
      'The app compiles the Soul Cast fields (genre, era, archetype, age, build, hair, outfit...) into prompt; a batch of casts = several seeds. The sheet is cut into the 4 views; ' +
      '"Save as character" turns one into an element (optionally an AI-Toolkit LoRA from the views).',
  },
];
