#!/usr/bin/env bash
# Regenerate every GLB in game/assets/models (+ manifest.json) from assets/blender, then
# validate them. Idempotent and deterministic.
#
#   scripts/generate_models.sh            # build + validate
#   scripts/generate_models.sh --render   # also preview renders (needs xvfb-run on Linux)
#
# Uses $BLENDER (a real Blender 4.5 binary: `blender -b --python`) when set, otherwise the
# bpy-module Python $BLENDER_PY from scripts/env.sh.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$APP_ROOT"

RENDER=0
for arg in "$@"; do
  case "$arg" in
    --render) RENDER=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

run_py() {  # run_py <script> [args...]
  local script="$1"; shift
  if [[ -n "$BLENDER" ]]; then
    "$BLENDER" -b --factory-startup --python "$script" -- "$@"
  else
    "$BLENDER_PY" "$script" "$@"
  fi
}

start=$(date +%s)
run_py assets/blender/build_all.py
python3 assets/blender/validate_glb.py || { echo "validation FAILED" >&2; exit 1; }

if [[ $RENDER == 1 ]]; then
  if [[ -n "$BLENDER" ]]; then
    "$BLENDER" -b --factory-startup --python assets/blender/render_previews.py
  elif [[ "$(uname)" == "Linux" ]] && command -v xvfb-run >/dev/null; then
    xvfb-run -a "$BLENDER_PY" assets/blender/render_previews.py
  else
    "$BLENDER_PY" assets/blender/render_previews.py
  fi
fi
echo "generate_models: done in $(( $(date +%s) - start ))s"
