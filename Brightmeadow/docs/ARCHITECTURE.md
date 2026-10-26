# Architecture

```
Brightmeadow/
├── game/                     Godot 4.5 project (open game/project.godot)
│   ├── scripts/core/         Pure logic, no scene dependencies: MovementConfig, MovementModel,
│   │                         JumpAssist, GameSession, InputSetup, Fx
│   ├── scripts/autoload/     Game (session, scene changes, fades), Audio (SFX pool, music)
│   ├── scripts/player/       Player (physics), PlayerVisual (presentation), PlayerInput
│   ├── scripts/enemies/      Bramblebug (patrol), Buzzpuff (two-point flyer)
│   ├── scripts/pickups/      Coin, Checkpoint, Goal
│   ├── scripts/level/        LevelData (JSON → data), LevelBuilder (data → nodes), Level (flow),
│   │                         ModelLib (GLB loading by contract name)
│   ├── scripts/camera/       FollowCamera
│   ├── scripts/ui/           Hud, Menus (pause/controls/game over/complete), main menu, UiKit
│   ├── scenes/               Thin .tscn wrappers for the above
│   ├── levels/level_01.json  The handcrafted level layout
│   ├── resources/            movement_default.tres (all movement tuning)
│   ├── assets/models|audio|fonts   Generated GLBs, generated audio, OFL font
│   └── tests/                Headless test runner, tests, autoplay bot, screenshot capture
├── assets/blender/           Blender Python generators (+ .blend sources, preview renders)
├── assets/audio/             Audio synthesiser + checker
├── scripts/                  setup_linux, generate_models, generate_audio, validate,
│                             screenshots, export
├── tests/output/             Logs and screenshots from validation runs (git-ignored)
└── docs/                     This file, contract, controls, pipelines, progress
```

## Key decisions

- **Gameplay on the z = 0 plane.** The player and enemies are 3D bodies locked to z = 0
  (`axis_lock_linear_z` + clamping). Depth is only for presentation: decor sits behind (−z) or in
  front (+z) of the play plane, background hills at z ≈ −30…−60.
- **All movement numbers in one Resource** (`MovementConfig`, `resources/movement_default.tres`).
  The controller, the unit tests, the level-feasibility test and the autoplay bot all read it, so a
  tuning change is re-verified against the level automatically.
- **Movement math is pure** (`MovementModel`). `Player` calls it every physics step; tests and the
  feasibility checker call the same functions to simulate jumps. A test asserts the real physics
  jump height matches the model within 0.15 m.
- **Physics vs visuals.** `Player` owns the capsule and velocity. `PlayerVisual` (pivot at the
  feet) only reads the body: it picks animations, turns the model, squashes/stretches and blinks.
  Collision is never scaled. Visual transforms change on physics ticks so physics interpolation
  keeps them smooth on high-refresh displays.
- **One-way platforms.** Godot 3D has no one-way collision shapes, so floating platforms are
  normal boxes in group `oneway` and the player adds/removes a collision exception per platform
  depending on whether its feet are above the platform's top.
- **Level as data.** `levels/level_01.json` is the handcrafted layout (surfaces, coins, enemies,
  checkpoints, goal, signs, decor). `LevelBuilder` tiles modular terrain pieces, creates box
  colliders, and places everything. The only randomness is a fixed-seed scatter of small props and
  background, so every build is identical.
- **State in a pure session.** `GameSession` (coins, health, lives, checkpoint, timer, state machine
  READY → PLAYING ⇄ PAUSED, RESPAWNING, GAME_OVER, COMPLETE) has no nodes and is unit-tested. The
  `Game` autoload holds the instance; `Level` runs the respawn/finish flow; the HUD listens to its
  signals.
- **Assets by contract.** `docs/ASSET_CONTRACT.md` fixes every model's name, pivot, size, node names
  and animation names. `ModelLib` loads by name and draws a magenta box (and logs an error) for
  anything missing; the integrity test fails if any placeholder is drawn.
- **Input in code** (`InputSetup`), physical keys, plus gamepad.

## Physics layers

| Layer | Bit | Used by |
|---|---|---|
| world | 1 | terrain colliders, level bounds |
| player | 2 | player body (coins/checkpoints/goal detect this) |
| enemies | 4 | enemy hitbox Areas (the player's EnemySensor detects these) |
| triggers | 8 | coin/checkpoint/goal Areas |

Enemy bodies are on no layer (they only collide with the world), so the player passes through
them physically and contact is resolved by the sensor: stomp if the feet were above the enemy's
stomp line on the way down, otherwise damage.
