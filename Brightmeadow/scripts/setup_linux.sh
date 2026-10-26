#!/usr/bin/env bash
# Idempotent Linux (x86_64) bootstrap: Godot 4.5.1, Python 3.11 venv with bpy (Blender 4.5 LTS)
# and numpy, plus Xvfb/Mesa for offscreen screenshots. Re-running skips anything already present.
#
#   scripts/setup_linux.sh            # tools only
#   scripts/setup_linux.sh --templates  # also download Godot export templates (~1 GB) for exports
set -euo pipefail
source "$(dirname "$0")/env.sh"

WANT_TEMPLATES=0
[[ "${1:-}" == "--templates" ]] && WANT_TEMPLATES=1

GODOT_BASE="https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable"
GODOT_ZIP="Godot_v${GODOT_VERSION}-stable_linux.x86_64.zip"
TPL_FILE="Godot_v${GODOT_VERSION}-stable_export_templates.tpz"

mkdir -p "$TOOLS_DIR/godot"
cd "$TOOLS_DIR/godot"

fetch_sums() {
  [[ -f SHA512-SUMS.txt ]] || curl -fsSL -o SHA512-SUMS.txt "$GODOT_BASE/SHA512-SUMS.txt"
}

verify() {  # verify <file> against the official SHA512-SUMS.txt
  local expected actual
  expected="$(grep " $1\$" SHA512-SUMS.txt | cut -d' ' -f1)"
  actual="$(sha512sum "$1" | cut -d' ' -f1)"
  if [[ -z "$expected" || "$expected" != "$actual" ]]; then
    echo "Checksum mismatch for $1" >&2; rm -f "$1"; exit 1
  fi
}

# 1. Godot -------------------------------------------------------------------------------
if [[ ! -x "Godot_v${GODOT_VERSION}-stable_linux.x86_64" ]]; then
  echo "==> Downloading Godot ${GODOT_VERSION}"
  fetch_sums
  curl -fsSL -o "$GODOT_ZIP" "$GODOT_BASE/$GODOT_ZIP"
  verify "$GODOT_ZIP"
  unzip -o -q "$GODOT_ZIP" && rm -f "$GODOT_ZIP"
fi
echo "Godot: $("./Godot_v${GODOT_VERSION}-stable_linux.x86_64" --version)"

# 2. Export templates (optional, needed for scripts/export.sh) ----------------------------
TPL_DIR="$HOME/.local/share/godot/export_templates/${GODOT_VERSION}.stable"
if [[ $WANT_TEMPLATES == 1 && ! -f "$TPL_DIR/macos.zip" ]]; then
  echo "==> Downloading export templates (~1 GB)"
  fetch_sums
  curl -fsSL -o "$TPL_FILE" "$GODOT_BASE/$TPL_FILE"
  verify "$TPL_FILE"
  mkdir -p "$TPL_DIR"
  unzip -o -q "$TPL_FILE" -d "$TOOLS_DIR/godot/tpl" && cp -r "$TOOLS_DIR/godot/tpl/templates/." "$TPL_DIR/"
  rm -rf "$TOOLS_DIR/godot/tpl" "$TPL_FILE"
fi

# 3. Python 3.11 venv with bpy + numpy ------------------------------------------------------
if [[ ! -x "$TOOLS_DIR/venv/bin/python" ]]; then
  echo "==> Creating Python ${PYTHON_VERSION} venv"
  if command -v uv >/dev/null; then
    uv python install "$PYTHON_VERSION"
    uv venv --python "$PYTHON_VERSION" "$TOOLS_DIR/venv"
  else
    "python${PYTHON_VERSION}" -m venv "$TOOLS_DIR/venv"
  fi
fi
if ! "$TOOLS_DIR/venv/bin/python" -c "import bpy, numpy" 2>/dev/null; then
  echo "==> Installing bpy ${BLENDER_BPY_VERSION} and numpy (bpy is ~370 MB)"
  if command -v uv >/dev/null; then
    uv pip install --python "$TOOLS_DIR/venv/bin/python" "bpy==${BLENDER_BPY_VERSION}" "numpy==1.26.4"
  else
    "$TOOLS_DIR/venv/bin/python" -m pip install "bpy==${BLENDER_BPY_VERSION}" "numpy==1.26.4"
  fi
fi
echo "bpy: $("$TOOLS_DIR/venv/bin/python" -c 'import bpy; print(bpy.app.version_string)' 2>/dev/null | tail -1)"

# 4. Offscreen rendering + audio encoding (Debian/Ubuntu; skipped when not root) -------------
if command -v apt-get >/dev/null && [[ $EUID -eq 0 ]]; then
  missing=()
  for pkg in xvfb libgl1-mesa-dri mesa-vulkan-drivers ffmpeg; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  if (( ${#missing[@]} )); then
    echo "==> apt-get install ${missing[*]}"
    apt-get update -qq && apt-get install -y --no-install-recommends "${missing[@]}"
  fi
fi

echo "Setup complete. Tools in $TOOLS_DIR"
