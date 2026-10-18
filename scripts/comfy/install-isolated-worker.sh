#!/usr/bin/env bash
# A second, isolated ComfyUI for the packs that must not share a process or a Python environment with the main
# server: LatentSync 1.6 (lipsync-latentsync16) and ThinkSound (sfx-thinksound). See README.md ("Isolated worker").
#
# It gets its OWN code copy, base directory, HOME and virtualenv, so nothing these packs do can reach the main
# install: LatentSync overrides TMPDIR / temp handling at import, rmtree()s a temp folder next to ComfyUI and
# pip-installs into whatever interpreter runs it; its runtime deps (mediapipe pins protobuf<5) and ThinkSound's
# requirements (old einops, PyWavelets, k-diffusion) would downgrade the main venv. Model files are shared
# read-only through extra_model_paths.yaml instead of being copied.
#
# Usage: scripts/comfy/install-isolated-worker.sh
#   ISO_DIR=/srv/comfyui-isolated     where the worker lives (default)
#   COMFYUI_DIR=/home/user/ComfyUI    the main install: its code is copied (models/, input/, output/, venv excluded)
#   TORCH_INDEX=https://download.pytorch.org/whl/cu128   torch build (default: CPU wheels)
#   PYTHON_VERSION=3.11               ThinkSound pins PyWavelets 1.4.1 (wheels up to 3.11; it no longer builds on 3.12+)
# Then start it (its own HOME; add --cpu without a GPU):
#   cd "$ISO_DIR/ComfyUI" && HOME="$ISO_DIR/home" "$ISO_DIR/.venv/bin/python" main.py --listen 127.0.0.1 --port 8189
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-/home/user/ComfyUI}"
ISO_DIR="${ISO_DIR:-/srv/comfyui-isolated}"
PYTHON_VERSION="${PYTHON_VERSION:-3.11}"
TORCH_INDEX="${TORCH_INDEX:-https://download.pytorch.org/whl/cpu}"

# Packs, at the commits the library was validated with (the same VHS / KJNodes commits as install-comfyui.sh).
declare -A NODES=(
  [ComfyUI-LatentSyncWrapper]="https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper 360d5283d7276aee68b4237b1387e594e4ce640e"
  [ComfyUI-ThinkSound_Wrapper]="https://github.com/ShmuelRonen/ComfyUI-ThinkSound_Wrapper 9a2fb40ae30cabbdb55fb6f6fe02b01c23ab1a3b"
  [ComfyUI-VideoHelperSuite]="https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite 4d907bee61e92c2e65af3bd6383a4e4d356126d1"
  [ComfyUI-KJNodes]="https://github.com/kijai/ComfyUI-KJNodes 17195fcfa8a05f601b766a0f09c9733284f47416"
)

[ -f "$COMFYUI_DIR/main.py" ] || { echo "No ComfyUI at $COMFYUI_DIR (run install-comfyui.sh first)" >&2; exit 1; }
mkdir -p "$ISO_DIR/home" "$ISO_DIR/ComfyUI"

# 1. Code only: the main install's models, inputs, outputs, users, node packs and venv stay where they are
#    (never `cp -r` the whole ComfyUI: models/ can be hundreds of GB).
tar -C "$COMFYUI_DIR" -cf - \
  --exclude ./models --exclude ./input --exclude ./output --exclude ./temp --exclude ./user \
  --exclude ./custom_nodes --exclude ./.venv --exclude ./logs --exclude '__pycache__' . | tar -C "$ISO_DIR/ComfyUI" -xf -
mkdir -p "$ISO_DIR/ComfyUI/custom_nodes" "$ISO_DIR/ComfyUI/models" "$ISO_DIR/ComfyUI/input" "$ISO_DIR/ComfyUI/output"

# 2. Its own virtualenv.
[ -x "$ISO_DIR/.venv/bin/python" ] || uv venv --python "$PYTHON_VERSION" "$ISO_DIR/.venv"
PY="$ISO_DIR/.venv/bin/python"
uv pip install --python "$PY" torch torchvision torchaudio --index-url "$TORCH_INDEX"
uv pip install --python "$PY" -r "$ISO_DIR/ComfyUI/requirements.txt"

# 3. The packs, pinned, with their requirements in THIS venv only.
for name in "${!NODES[@]}"; do
  read -r url ref <<<"${NODES[$name]}"
  dest="$ISO_DIR/ComfyUI/custom_nodes/$name"
  [ -d "$dest/.git" ] || git clone -q "$url" "$dest"
  git -C "$dest" fetch -q --depth 1 origin "$ref" 2>/dev/null || true
  git -C "$dest" checkout -q "$ref" 2>/dev/null || echo "warn: could not pin $name to $ref"
done
uv pip install --python "$PY" -r "$ISO_DIR/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite/requirements.txt"
uv pip install --python "$PY" -r "$ISO_DIR/ComfyUI/custom_nodes/ComfyUI-KJNodes/requirements.txt"
uv pip install --python "$PY" -r "$ISO_DIR/ComfyUI/custom_nodes/ComfyUI-ThinkSound_Wrapper/requirements.txt"
# LatentSync's requirements and runtime (mediapipe pins protobuf<5: fine here, it never touches the main venv).
uv pip install --python "$PY" -r "$ISO_DIR/ComfyUI/custom_nodes/ComfyUI-LatentSyncWrapper/requirements.txt"
uv pip install --python "$PY" "mediapipe>=0.10.8" face-alignment DeepCache ffmpeg-python pytorch_lightning

# 4. Share the main install's model folders read-only instead of copying them.
cat > "$ISO_DIR/ComfyUI/extra_model_paths.yaml" <<YAML
# Written by scripts/comfy/install-isolated-worker.sh: the main ComfyUI's models, shared (nothing is copied).
main_comfyui:
  base_path: $COMFYUI_DIR/models
  checkpoints: checkpoints
  diffusion_models: diffusion_models
  text_encoders: text_encoders
  vae: vae
  loras: loras
  clip_vision: clip_vision
  audio_encoders: audio_encoders
  thinksound: thinksound
YAML

echo "Isolated worker ready in $ISO_DIR. Start it with:"
echo "  cd $ISO_DIR/ComfyUI && HOME=$ISO_DIR/home $PY main.py --listen 127.0.0.1 --port 8189   # add --cpu without a GPU"
echo "Validate its workflows: COMFYUI_URL=http://127.0.0.1:8189 COMFYUI_MODELS_DIR=$COMFYUI_DIR/models node $SCRIPT_DIR/validate-workflows.mjs lipsync-latentsync16 sfx-thinksound --shared"
