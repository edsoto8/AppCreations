# Progress Log

Each phase records what changed, commands run, evidence, open issues and next steps.

## Phase 1 — Bootstrap and architecture (done)

**Environment found:** Ubuntu 24.04.5 x86_64, 4 vCPU, 15 GB RAM, no GPU. No Godot or Blender
preinstalled. Outbound HTTPS via an egress proxy: github.com release downloads allowed,
download.blender.org **blocked (403)**, PyPI and npm allowed.

**Decisions / workarounds**
- Godot **4.5.1-stable** from the official GitHub release, verified against the official
  `SHA512-SUMS.txt`. Export templates (same source, verified) installed for exports.
- Blender: official site blocked, so the official **`bpy` 4.5.15 LTS wheel from PyPI** (Blender
  as a Python module, built by the Blender Foundation) in a Python 3.11 venv. Same Python API as
  Blender 4.5 LTS; generator scripts also run under a real `blender -b --python` on macOS.
- Offscreen rendering: Xvfb + Mesa llvmpipe (OpenGL) and lavapipe (Vulkan) — Godot Forward+ and
  Blender EEVEE both render in software (slow but real).
- UI font: Fredoka (SIL OFL 1.1) from the `@fontsource/fredoka` npm package; licence in
  `game/assets/fonts/OFL.txt`.

**Commands:** `scripts/setup_linux.sh` (idempotent; `--templates` adds export templates).

## Phase 2 — Core playable mechanics (done)

- Pure, testable core: `MovementConfig` (all tuning, `resources/movement_default.tres`),
  `MovementModel` (motion math + jump simulation), `JumpAssist` (coyote/buffer), `GameSession`
  (coins/health/lives/checkpoints/state machine).
- Player `CharacterBody3D` on the z=0 plane with variable jump, coyote time, jump buffering,
  one-way (jump-through) floating platforms, stomp/damage/knockback/invulnerability, fall death.
  Visual layer (`PlayerVisual`) separate from physics: animation selection, squash & stretch,
  facing, blinking, dust.
- Enemies: Bramblebug (ground patrol, turns at walls/ledges/range) and Buzzpuff (glides between
  two points). Coins, checkpoints, goal, side-follow camera, HUD, pause/game-over/complete
  screens, main menu diorama, audio autoload, input map in code.
- Level 01 "Brightmeadow Trail" (414 m, 7 sections, 168 coins, 20 enemies, 3 checkpoints) as a
  handcrafted JSON layout, built at runtime by `LevelBuilder`.

**Evidence (actual runs):** `godot --headless --fixed-fps 60 --path game res://tests/run_tests.tscn`
→ 51 tests, 0 failures, including:
- measured physics jump 2.31 m vs model 2.30 m; tap hop 0.89 m; walk reach 4.20 m, run 6.65 m;
- feasibility: 45/45 surfaces reachable, goal reachable from every surface, the opening (to the
  run tutorial at x=79) beatable without running;
- smoke tests on the real scene: coin pickup, checkpoint + respawn, side damage +
  invulnerability, stomp bounce (both enemies), jump-through platform, health→life loss, game
  over, goal → results, pause/resume;
- autoplay bot completed the whole level through real physics: 55.7 s sim time, 31 jumps,
  0 falls.

**Bug found and fixed:** the controller skipped gravity on the take-off frame, so real jumps
were 0.23 m higher than the numbers the level was designed against. The take-off step now
matches `MovementModel.simulate_jump`.

**Open:** models still placeholders (magenta boxes) until the Blender pipeline lands.

## Phase 3 — Procedural art pipeline (done)

Delegated to an asset subagent against `docs/ASSET_CONTRACT.md`, then integrated and reviewed.
- 29 GLBs + `manifest.json` from Blender 4.5 Python (`assets/blender/`, shared `lib/` for
  palette materials, shape helpers, rigid-skin rigging, export, render, GLB reading). Editable
  sources in `assets/blender/source/*.blend`. Deterministic: two builds give byte-identical GLBs.
- Explorer "Juni": 14.6k triangles, 24-bone armature, 8 animations (idle, walk, run, jump, fall,
  land, celebrate, hurt) with squash/stretch and hair/scarf/pack follow-through. Bramblebug
  (walk, idle) and Buzzpuff (fly) rigged and animated. Terrain pieces tile seamlessly (checked
  numerically on the exported files).
- `assets/blender/validate_glb.py`: **252 passed, 0 failed** (budgets, sizes, pivots, bones,
  animation names/frames, contract child nodes, tiling cross-sections, walk surface at y=0).
- Preview renders reviewed by eye: `docs/images/lineup.jpg`, `docs/images/explorer_poses.jpg`.
- Commands: `scripts/generate_models.sh` (~10 s), `--render` adds previews (~6.5 min, EEVEE in
  software).

## Phase 4 — Complete level and presentation (done)

- Real models replace every placeholder (integrity test: 0 placeholders, all animations/nodes
  present). Audio: 11 SFX + 2 looping tracks wired through the `Audio` autoload.
- Screenshots rendered with the real Forward+ renderer (lavapipe under Xvfb) and inspected.
  Changes made from what they showed: camera moved closer (15.5 → 12.5 m) because Juni was ~12%
  of screen height; stronger depth fog to separate background hills from the play path; sign
  labels lowered; menu camera reframed so Juni isn't behind the buttons and signs are hidden in
  the menu diorama.

## Phase 5 — QA and refinement (done)

- Independent QA review of the gameplay code (subagent, read-only) found 7 issues; all fixed
  with regression tests where testable:
  - **major:** pausing during the death delay skipped the life loss (unlimited lives) →
    timers no longer run while paused, pause refused while defeated;
  - **major:** camera swept across the level after respawning (interpolated transform lags one
    frame after a teleport) → snap uses the real position (test fails if the fix is reverted);
  - minor: fades fighting each other, music staying ducked after Play Again, idle-mode tweens on
    interpolated nodes (judder at 120 Hz), results panel pivot, pause test not really pausing.
- Shutdown log: "2 resources still in use at exit" comes from the Ogg music stream playing when
  `--quit-after` ends the process. Stopping/clearing streams in `_exit_tree` didn't remove it; it
  is exit-only, harmless, and filtered (only that message) in `validate.sh`.
- Exports: `scripts/export.sh` → macOS universal `.app` zip (ad-hoc signed, not notarized) and
  Linux x86_64. The exported Linux build boots without script errors or missing models.

**Final evidence (actual run of `scripts/validate.sh`):** GLB check 252/252, audio checks all
passed, import clean, **61/61 Godot tests**, main scene boot clean → `VALIDATION PASSED`. The
autoplay bot finishes the level through real physics (55.7 s sim time, 31 jumps, 0 falls).

**Not verified here:** running on macOS (no Mac available), real-time frame rate on GPU hardware,
audio playback quality (no audio device; files were checked numerically), and how the game feels
to a human. Software rendering ran at a few FPS, so screenshots show composition, not
smoothness.
