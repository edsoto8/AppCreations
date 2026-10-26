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
→ 52 tests, 0 failures, including:
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
