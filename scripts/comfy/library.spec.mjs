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
];
