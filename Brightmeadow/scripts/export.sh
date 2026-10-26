#!/usr/bin/env bash
# Exports release builds into build/. Needs export templates: scripts/setup_linux.sh --templates
# (on macOS: Godot editor > Editor > Manage Export Templates).
#   scripts/export.sh            # macOS universal .app (zip) + Linux x86_64
#   scripts/export.sh macos      # just one preset (macos | linux)
# The macOS app is ad-hoc signed only (not notarized). See README "macOS" for first-launch steps.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$APP_ROOT"
which="${1:-all}"
"$GODOT" --headless --path game --import > /dev/null 2>&1 || true
if [[ $which == all || $which == macos ]]; then
  mkdir -p build/macos
  "$GODOT" --headless --path game --export-release "macOS" ../build/macos/Brightmeadow.zip
  echo "macOS: build/macos/Brightmeadow.zip"
fi
if [[ $which == all || $which == linux ]]; then
  mkdir -p build/linux
  "$GODOT" --headless --path game --export-release "Linux" ../build/linux/Brightmeadow.x86_64
  echo "Linux: build/linux/Brightmeadow.x86_64"
fi
