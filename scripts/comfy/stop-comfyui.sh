#!/usr/bin/env bash
set -euo pipefail
COMFYUI_DIR="${COMFYUI_DIR:-/home/user/ComfyUI}"
PIDFILE="$COMFYUI_DIR/logs/comfyui.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  kill "$(cat "$PIDFILE")"; sleep 2; echo "stopped"
else
  echo "no running ComfyUI pid found"
fi
rm -f "$PIDFILE"
