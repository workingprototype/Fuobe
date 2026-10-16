#!/usr/bin/env bash
# Start a local CPU-only ComfyUI server used to export/validate Fuobe workflows.
# Usage: scripts/comfy/start-comfyui.sh   (env COMFYUI_DIR, COMFYUI_PORT override defaults)
set -euo pipefail
COMFYUI_DIR="${COMFYUI_DIR:-/home/user/ComfyUI}"
PORT="${COMFYUI_PORT:-8188}"
mkdir -p "$COMFYUI_DIR/logs"
if curl -s -o /dev/null "http://127.0.0.1:$PORT/system_stats"; then
  echo "ComfyUI already running on port $PORT"; exit 0
fi
cd "$COMFYUI_DIR"
nohup "$COMFYUI_DIR/.venv/bin/python" main.py --cpu --listen 127.0.0.1 --port "$PORT" \
  > "$COMFYUI_DIR/logs/comfyui.log" 2>&1 &
echo $! > "$COMFYUI_DIR/logs/comfyui.pid"
for _ in $(seq 1 150); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/system_stats"; then
    echo "ComfyUI up on http://127.0.0.1:$PORT (pid $(cat "$COMFYUI_DIR/logs/comfyui.pid"))"; exit 0
  fi
  sleep 2
done
echo "ComfyUI did not come up; see $COMFYUI_DIR/logs/comfyui.log" >&2
exit 1
