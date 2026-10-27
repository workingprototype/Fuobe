#!/usr/bin/env bash
# Reproducible CPU-only ComfyUI install used to export + validate Fuobe's workflow library.
# (No GPU and no model weights are needed: validation uses zero-byte placeholder files.)
#
# Usage: scripts/comfy/install-comfyui.sh            # installs into /home/user/ComfyUI
#        COMFYUI_DIR=~/ComfyUI scripts/comfy/install-comfyui.sh
# Re-running is safe (existing clones are kept).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-/home/user/ComfyUI}"
# Versions the committed library was generated/validated with (2026-10-16; round-3 packs 2026-10-17).
COMFYUI_REF="${COMFYUI_REF:-fc04da91b2ab12f99e4716371a7e4f98ac982597}"   # v0.41.0-7
PYTHON_VERSION="${PYTHON_VERSION:-3.13}"

declare -A NODES=(
  [ComfyUI-WanVideoWrapper]="https://github.com/kijai/ComfyUI-WanVideoWrapper 088128b224242e110d3906c6750e9a3a348a659b"
  [ComfyUI-VideoHelperSuite]="https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite 4d907bee61e92c2e65af3bd6383a4e4d356126d1"
  [ComfyUI-KJNodes]="https://github.com/kijai/ComfyUI-KJNodes 17195fcfa8a05f601b766a0f09c9733284f47416"
  [ComfyUI-SeedVR2_VideoUpscaler]="https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler 4490bd1f482e026674543386bb2a4d176da245b9"
  [ComfyUI-Frame-Interpolation]="https://github.com/Fannovel16/ComfyUI-Frame-Interpolation 26545cc2dd95bc3d27f056016300673bdeee78f5"
  [ComfyUI-RMBG]="https://github.com/1038lab/ComfyUI-RMBG 229529e0ea63fb7085848225d74f91f6dc164956"
  [ComfyUI-ReActor]="https://github.com/Gourieff/ComfyUI-ReActor 3be5f356fe5b120a7a274d2509c0ecef5d0a7498"
  [ComfyUI-MMAudio]="https://github.com/kijai/ComfyUI-MMAudio 8eaeb72edc3aaf2059b57f2d96a1f6f689f19ae2"
  # audio / video-depth packs added with the comfyui-oss-2 workflows (2026-10-16)
  [ComfyUI_Fill-ChatterBox]="https://github.com/filliptm/ComfyUI_Fill-ChatterBox f7d7a16187430abcaf91a3039b9c83aa9960816a"
  [ComfyUI-IndexTTS2]="https://github.com/snicolast/ComfyUI-IndexTTS2 5b33e02bc0112b8aaf1fc823d5e5a609ca07fc27"
  [ComfyUI-Video-Depth-Anything]="https://github.com/yuvraj108c/ComfyUI-Video-Depth-Anything a0db08e63d1ea571601c45cde4aaee0acdd0544d"
  # round-3 packs (2026-10-17, docs/research/comfyui-oss-3.md): voice separation, ASR/subtitles, foley
  [ComfyUI-MelBandRoFormer]="https://github.com/kijai/ComfyUI-MelBandRoFormer 92c86854e6654f4aacc97484471af95c98ea16d4"
  [ComfyUI-QwenASR]="https://github.com/1038lab/ComfyUI-QwenASR 3f9a652a617e578e4e3bd090e3dbc75274bf4775"
  [ComfyUI-HunyuanVideo-Foley]="https://github.com/phazei/ComfyUI-HunyuanVideo-Foley afd2960b8ad9036a9f55a15daf514112ff68e010"
  # round 4 (2026-10-22): VTracer image → SVG (the Vectorize app's open route)
  [ComfyUI-ToSVG]="https://github.com/Yanick112/ComfyUI-ToSVG 1022ba05318dccb4fe586ce5bbd09f1f0b3c7909"
)
# Licences are information (Settings → Models & licences has the switches): every pack is installed, the
# non-commercial ComfyUI-Whisper (CC-BY-NC-SA-4.0, used by the captions-whisper-burnin workflow) included.
# NC_PACKS=0 leaves the non-commercial packs out of this install.
if [ "${NC_PACKS:-1}" = "1" ]; then
  NODES[ComfyUI-Whisper]="https://github.com/yuvraj108c/ComfyUI-Whisper 006a709848259ed3d69e2f9fcfd7a75f6c860ddd"
fi

if [ ! -d "$COMFYUI_DIR/.git" ]; then
  git clone https://github.com/comfyanonymous/ComfyUI "$COMFYUI_DIR"
fi
if [ "${PIN:-1}" = "1" ]; then git -C "$COMFYUI_DIR" checkout -q "$COMFYUI_REF" || echo "warn: could not pin ComfyUI to $COMFYUI_REF"; fi

cd "$COMFYUI_DIR"
[ -x .venv/bin/python ] || uv venv --python "$PYTHON_VERSION" .venv
PY="$COMFYUI_DIR/.venv/bin/python"
uv pip install --python "$PY" torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
uv pip install --python "$PY" -r requirements.txt   # pulls comfyui-frontend-package + comfyui-workflow-templates*

for name in "${!NODES[@]}"; do
  read -r url ref <<<"${NODES[$name]}"
  dest="$COMFYUI_DIR/custom_nodes/$name"
  if [ ! -d "$dest/.git" ]; then git clone -q "$url" "$dest"; fi
  if [ "${PIN:-1}" = "1" ]; then
    git -C "$dest" fetch -q --depth 1 origin "$ref" 2>/dev/null || true
    git -C "$dest" checkout -q "$ref" 2>/dev/null || echo "warn: could not pin $name to $ref (using $(git -C "$dest" rev-parse --short HEAD))"
  fi
done

# Union of the packs' requirements, minus GPU-only / unbuildable extras
# (onnxruntime-gpu, cupy, groundingdino-py). triton + decord + pycocotools are needed only so
# ComfyUI-RMBG's SAM3 module imports (otherwise the whole RMBG pack fails to load).
uv pip install --python "$PY" \
  opencv-python opencv-python-headless imageio-ffmpeg color-matcher matplotlib mss ftfy \
  "accelerate>=1.2.1" "diffusers>=0.33.1" "peft>=0.17.0" "sentencepiece>=0.2.0" protobuf pyloudnorm "gguf>=0.17.1" scipy \
  "librosa>=0.10.1" "torchdiffeq>=0.2.3" "timm>=1.0.8" "omegaconf>=2.3.0" "open_clip_torch>=2.29.0" \
  "rotary_embedding_torch>=0.5.3" huggingface-hub transparent-background segment-anything onnxruntime hydra-core iopath \
  albumentations onnx ultralytics colour-science kornia insightface triton decord pycocotools \
  resampy s3tokenizer conformer soundfile einops easydict Imath OpenEXR
# ^ last line: ComfyUI_Fill-ChatterBox (Chatterbox TTS/VC) + ComfyUI-Video-Depth-Anything.
# ComfyUI-IndexTTS2 registers its nodes with numpy only (everything else is imported lazily), which is
# all validation needs. Its *runtime* stack (pynini, WeTextProcessing, modelscope, descript-audiotools, ...)
# is heavy and pins old versions; on a GPU server install it in an isolated worker:
#   INDEXTTS_RUNTIME=1 scripts/comfy/install-comfyui.sh   (pynini 2.1.7 has a cp313 wheel; 2.1.6 must be built)
if [ "${INDEXTTS_RUNTIME:-0}" = "1" ]; then
  uv pip install --python "$PY" "pynini>=2.1.6" WeTextProcessing cn2an ffmpeg-python g2p-en jieba json5 munch textstat modelscope \
    "git+https://github.com/descriptinc/audiotools" || echo "warn: IndexTTS2 runtime deps failed to install"
fi
# Chatterbox's Perth watermarker (recommended in production for cloned voices; optional for validation):
#   uv pip install --python "$PY" resemble-perth

# ComfyUI-HunyuanVideo-Foley needs loguru; ComfyUI-Whisper (unless NC_PACKS=0) needs openai-whisper (built from sdist).
# ComfyUI-MelBandRoFormer needs rotary_embedding_torch + einops (installed above).
# ComfyUI-QwenASR: do NOT install its requirements.txt (nagisa/DyNet38 have no cp313 wheels and are unused on the
# Hugging Face path); transformers>=5.13 from ComfyUI's requirements is all it needs.
uv pip install --python "$PY" loguru
# ComfyUI-ToSVG imports vtracer (MIT), potracer and PyMuPDF (AGPL-3.0, used only by its SVG-to-image node) at load time.
uv pip install --python "$PY" "vtracer==0.6.15" "potracer==0.0.4" "PyMuPDF==1.26.5"
if [ "${NC_PACKS:-1}" = "1" ]; then uv pip install --python "$PY" "openai-whisper==20250625"; fi

# Optional isolated worker (never in this install or its venv): LatentSync 1.6 lipsync and ThinkSound SFX change
# process-wide state or pin old packages, so they run on a second ComfyUI with its own code copy, base directory,
# HOME and virtualenv: scripts/comfy/install-isolated-worker.sh (see README.md, "Isolated worker").
# The workflows lipsync-latentsync16 and sfx-thinksound carry "worker": "isolated" in manifest.json.

# ComfyUI-ReActor downloads ~1 GB of face-restore models into models/facerestore_models whenever that
# folder is empty -- even on a plain GET /object_info. On this validation-only (no weights) install keep a
# zero-byte placeholder there. Set REAL_MODELS=1 on a production server to skip this.
if [ "${REAL_MODELS:-0}" != "1" ]; then
  mkdir -p "$COMFYUI_DIR/models/facerestore_models"
  [ -n "$(ls -A "$COMFYUI_DIR/models/facerestore_models")" ] || touch "$COMFYUI_DIR/models/facerestore_models/placeholder_do_not_use.pth"
fi

echo "ComfyUI installed in $COMFYUI_DIR. Start it with: $SCRIPT_DIR/start-comfyui.sh"
