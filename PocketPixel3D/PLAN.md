# Pocket Pixel 3D: Implementation Plan

An interactive 3D handheld console modelled on the proportions and layout of the classic 1989 grey-brick
handheld. It is built procedurally in Three.js and plays three original games on a working 160×144,
4-shade LCD.

Branding on the device is original ("POCKET PIXEL"). No third-party logos, firmware, ROMs, music or game
art are used.

## Environment

- Node 22, npm 10, TypeScript 7, Vite 8, Vitest 5, Three.js r187.
- Chromium and Playwright are preinstalled in the cloud session. `@playwright/test` is pinned to the
  installed browser build (1.63.0).
- No backend. Settings and high scores live in `localStorage`, with every access guarded.

## Architecture

```
src/
  app/          main.ts (composition root), Settings (localStorage), DebugApi (test hook)
  animation/    Tween / Animator: deterministic, interruptible value animations
  scene/        SceneManager (renderer, loop, resize, dispose), CameraController, LightingManager
  models/       GameBoyModel (shell, controls, prints), CartridgeModel, InternalComponents,
                Materials (PBR + procedural textures), geometry helpers
  interaction/  InputManager (keyboard → buttons), InteractionController (raycast, hover, drag, focus)
  hardware/     ConsoleSystem (state machine), PowerSystem, ButtonSystem, VolumeControl,
                ContrastControl, CartridgeSlot, BatteryCover
  display/      LCDRenderer (palette, contrast, ghosting, grid → RGBA), ScreenTexture (Three texture),
                BootSequence (original boot animation drawn into the framebuffer)
  games/        GameInterface, common/ (FrameBuffer, font, music notation, auto-repeat, RNG),
                PixelBlocks, PixelSnake, RetroRacer, registry
  audio/        AudioManager (Web Audio: speaker bus + mechanical bus, sfx synth, music sequencer),
                SystemSounds
  ui/           Toolbar, InfoPanel, CartridgeLibrary, LightingPanel, HelpDialog, ScreenOverlay, Toast
```

Dependency rules:

- `games/` imports nothing outside `games/`. Pure logic, deterministic, tick-driven.
- `hardware/` and `display/BootSequence` are pure TypeScript with no Three.js or DOM, and are unit tested.
- `models/` and `scene/` are the only places that import Three.js. `display/ScreenTexture` bridges the
  LCD canvas to a Three texture.
- `ui/` talks to the console only through `ConsoleSystem`'s API and events.
- `main.ts` wires everything together. Data flows one way: input → ConsoleSystem → framebuffer/audio
  events → renderers.

Shared framebuffer: the game draws into one `FrameBuffer`. `LCDRenderer` turns it into a 160×144 RGBA
canvas. Both the 3D screen texture and the enlarged 2D display read from that canvas.

## Milestones

1. **Console model.** Proportions of 90 × 148 × 32 mm, hollow front and back shells, recessed lens, D-pad,
   A/B, Start/Select, speaker slots, power slider, both wheels, ports, battery cover, cartridge bay,
   original prints. Add PBR materials with procedural noise, studio lighting and orbit camera.
2. **Hardware interaction.** Raycast picking, button travel, power switch, wheels (drag or scroll),
   power LED, mechanical sounds.
3. **LCD.** 160×144 green palette, ghosting, contrast, pixel grid, glass reflection, original boot
   sequence and chime, fade on power-off.
4. **Pixel Blocks.** Playable with the keyboard and the 3D buttons, which feed the same `ButtonSystem`.
5. **Cartridges.** Removable cartridge with an animated insert and eject. The library UI swaps
   cartridges and requires power off. Pixel Snake and Retro Racer.
6. **Advanced.** Exploded view with slow-motion assembly, internals (PCBs, membranes, chips, LCD module,
   speaker, batteries), transparent shell, battery door, inspection focus, handheld idle motion,
   enlarged 2D display, lighting presets.
7. **QA.** Vitest units, Playwright e2e covering boot, play, cartridge swap and console errors.
   Screenshots, performance pass and a review agent.

## Delegation

- Game-development agent (parallel): font, music notation, the three games and their tests, built
  against `GameInterface.ts`.
- Lead (me): 3D model, rendering, hardware, audio, UI, integration, e2e.
- Review agent at the end: an independent read of architecture, types, performance and security.

## Risks and decisions

- Headless Chromium uses SwiftShader. FPS is checked on real GPUs only. In CI we check functional
  behaviour and that there are no console errors.
- Audio starts only after the first user gesture, so autoplay policy is respected.
- Holding Shift for Select can trigger OS sticky keys. Right Shift is also accepted.
