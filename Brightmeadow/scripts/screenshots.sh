#!/usr/bin/env bash
# Renders gameplay and menu screenshots with the real Forward+ renderer into tests/output/shots.
# On Linux without a display this uses Xvfb + Mesa (software Vulkan); it is slow (~1 min/shot).
#   scripts/screenshots.sh [comma-separated x positions]
set -euo pipefail
source "$(dirname "$0")/env.sh"
OUT="$APP_ROOT/tests/output/shots"
SHOTS="${1:-4,40,98,126,150,186,232,300,340,392}"
mkdir -p "$OUT"
cmd=("$GODOT" --path "$GAME_DIR" res://tests/capture.tscn -- --out="$OUT" --shots="$SHOTS" --menu)
if [[ -z "${DISPLAY:-}" ]] && command -v xvfb-run >/dev/null; then
  xvfb-run -a -s "-screen 0 1600x900x24" "${cmd[@]}"
else
  "${cmd[@]}"
fi
ls "$OUT"
