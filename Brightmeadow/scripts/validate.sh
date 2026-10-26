#!/usr/bin/env bash
# Full automated validation. Exit code 0 = everything passed.
#   scripts/validate.sh            # assets + import + all Godot tests
#   scripts/validate.sh --shots    # also render screenshots to tests/output/ (needs xvfb-run)
set -uo pipefail
source "$(dirname "$0")/env.sh"
cd "$APP_ROOT"
mkdir -p tests/output
status=0
step() { echo; echo "=== $* ==="; }

step "Tool versions"
"$GODOT" --version || { echo "Godot not found; run scripts/setup_linux.sh"; exit 2; }

if [[ -f assets/blender/validate_glb.py ]]; then
  step "GLB contract check (assets/blender/validate_glb.py)"
  "$BLENDER_PY" assets/blender/validate_glb.py || status=1
fi

if [[ -f assets/audio/check_audio.py ]]; then
  step "Audio check (assets/audio/check_audio.py)"
  "$BLENDER_PY" assets/audio/check_audio.py || status=1
fi

step "Godot headless import"
"$GODOT" --headless --path game --import > tests/output/import.log 2>&1
if grep -E "SCRIPT ERROR|Parse Error|Failed to (load|import)|Error importing" tests/output/import.log; then
  echo "Import reported errors (see tests/output/import.log)"; status=1
else
  echo "Import clean"
fi

step "Godot tests (unit, feasibility, smoke, autoplay, integrity)"
"$GODOT" --headless --fixed-fps 60 --path game res://tests/run_tests.tscn > tests/output/tests.log 2>&1
test_status=$?
grep -E "▶|✔|✘|·|FAIL|Tests:" tests/output/tests.log
if grep -E "SCRIPT ERROR" tests/output/tests.log; then
  echo "Script errors during tests (see tests/output/tests.log)"; status=1
fi
[[ $test_status -ne 0 ]] && status=1

step "Main scene boot (300 frames, headless)"
"$GODOT" --headless --path game --quit-after 300 > tests/output/boot.log 2>&1
# Exit-time leak reports from the music stream still playing at --quit-after are ignored (known
# Godot OGG shutdown behaviour; see docs/PROGRESS.md). Anything else fails the check.
if grep -E "SCRIPT ERROR|ERROR:" tests/output/boot.log | grep -v "audio\|ALSA\|still in use at exit"; then
  echo "Errors while booting the main scene"; status=1
else
  echo "Main menu booted cleanly"
fi

if [[ "${1:-}" == "--shots" ]]; then
  step "Screenshots"
  scripts/screenshots.sh || status=1
fi

echo
[[ $status -eq 0 ]] && echo "VALIDATION PASSED" || echo "VALIDATION FAILED"
exit $status
