#!/usr/bin/env bash
# Shared tool locations. Source this from other scripts: `source "$(dirname "$0")/env.sh"`.
# Override any of these from the environment if your tools live elsewhere.
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export APP_ROOT
export TOOLS_DIR="${TOOLS_DIR:-$APP_ROOT/.tools}"

export GODOT_VERSION="4.5.1"
export BLENDER_BPY_VERSION="4.5.15"   # bpy wheel = Blender 4.5 LTS as a Python module
export PYTHON_VERSION="3.11"          # bpy 4.5 wheels are built for CPython 3.11

# Godot editor/runtime binary. On macOS point GODOT at
# /Applications/Godot.app/Contents/MacOS/Godot.
if [[ -z "${GODOT:-}" ]]; then
  if [[ -x "$TOOLS_DIR/godot/Godot_v${GODOT_VERSION}-stable_linux.x86_64" ]]; then
    GODOT="$TOOLS_DIR/godot/Godot_v${GODOT_VERSION}-stable_linux.x86_64"
  else
    GODOT="$(command -v godot || command -v godot4 || true)"
  fi
fi
export GODOT

# Python interpreter that can `import bpy`. A real Blender binary also works:
# set BLENDER=/path/to/blender and the generate script runs `blender -b --python`.
export BLENDER_PY="${BLENDER_PY:-$TOOLS_DIR/venv/bin/python}"
export BLENDER="${BLENDER:-}"

export GAME_DIR="$APP_ROOT/game"
