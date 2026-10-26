#!/usr/bin/env bash
# Regenerate every Brightmeadow sound effect and music loop (original procedural synthesis),
# then verify them. Deterministic and idempotent: re-running overwrites the outputs with
# byte-identical files.
#   Outputs: game/assets/audio/*.wav, game/assets/audio/*.ogg
#   Needs:   a python3 with numpy, and ffmpeg (with libvorbis) + ffprobe on PATH.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

has_numpy() { [[ -n "$1" ]] && "$1" -c "import numpy" >/dev/null 2>&1; }

PY=""
for cand in "${AUDIO_PY:-}" "${BLENDER_PY:-}" "$(command -v python3 || true)"; do
  if has_numpy "$cand"; then PY="$cand"; break; fi
done
if [[ -z "$PY" ]]; then
  echo "error: no python with numpy found (set AUDIO_PY, or run scripts/setup_linux.sh)" >&2
  exit 1
fi
for tool in ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "error: $tool not found on PATH" >&2; exit 1; }
done

echo "Generating audio with $PY"
"$PY" "$APP_ROOT/assets/audio/synth_audio.py" --out "$GAME_DIR/assets/audio"
"$PY" "$APP_ROOT/assets/audio/check_audio.py" --dir "$GAME_DIR/assets/audio"
