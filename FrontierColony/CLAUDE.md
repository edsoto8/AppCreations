# CLAUDE.md — Frontier Colony

An isometric colony simulator that runs in the browser. TypeScript, React 19, Vite 8, PixiJS 8,
Zustand 5, Vitest 5, Playwright 1.56. There is no backend: games are saved to localStorage.
Read `SPEC.md` for the product and architecture, `PLAN.md` for milestones and the team, and
`docs/GAME_DESIGN.md` for gameplay numbers.

## Commands (run them in `FrontierColony/`)

| Command | What it does |
|---|---|
| `npm install` | Install the pinned dependencies (`npm ci` for a clean install from the lockfile) |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run build` | `tsc -b` (typecheck) then `vite build` to `dist/` |
| `npm run preview` | Serve `dist/` at http://localhost:4173 |
| `npm run typecheck` | `tsc -b` (app + tests project and node/e2e project) |
| `npm test` | Vitest unit tests, run once (`tests/**/*.test.ts`, node environment) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright (Chromium only). Builds, starts `vite preview` on port 4173, then runs `e2e/` |

Playwright's Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) and matches
`@playwright/test@1.56.1` exactly. Keep that version pinned and **never run `playwright install`**.
All dependency versions are exact pins. Only the lead adds or upgrades dependencies.

## Layout and dependency rules

```
src/
  sim/      pure simulation: types.ts (contract), index.ts (public API), balance.ts (tuning),
            constants.ts (engine constants), rng.ts, queries.ts, validate.ts, names.ts
  shared/   iso.ts (projection math), types.ts (Selection, GameSpeed, OverlayMode, PlacementGhost)
  render/   PixiJS renderer: types.ts (GameRenderer contract), index.ts (createRenderer), renderer.ts
            (IsoRenderer), camera.ts, input.ts (DOM pointer events), layers.ts, depthLayer.ts (one render
            group per iso diagonal), terrain/ (chunked ground), entities/ (settlers, buildings, overlays),
            effects/ (pooled particles, floating text), textures/ (procedural Canvas-2D art baked to atlases)
  store/    Zustand UI store (uiStore.ts) + HUD snapshot builder (snapshot.ts)
  game/     GameController (loop, commands, renderer/store glue), clock.ts, save.ts, React context
  ui/       React components overlaid on the canvas
  styles/   CSS
  main.tsx  creates the controller, provides it to React, installs window.__frontierColony
tests/      Vitest unit tests mirroring src/ (tests/sim, tests/shared, tests/game, tests/store)
e2e/        Playwright specs
```

| Module | May import | Must NOT import |
|---|---|---|
| `sim` | only `sim` | anything else: React, Pixi, DOM, `window`, `localStorage`, `shared`, `store` |
| `shared` | `sim` (types and pure helpers) | React, Pixi, `store`, `render`, `game`, `ui` |
| `render` | `sim`, `shared`, `pixi.js` | React, `store`, `game`, `ui` |
| `store` | `sim`, `shared`, `zustand` | Pixi, `render`, `game`, `ui` |
| `game` | `sim`, `shared`, `render`, `store`, React (context only) | `ui` |
| `ui` | `sim` (types, queries, BUILDING_DEFS), `shared`, `store`, `game` (context, types, save types) | `pixi.js`, `render` internals |

Outside `src/sim` always import the sim through `src/sim/index.ts` (`from '../sim'`), never from its
internal files. Tests may import internal sim files directly.

## File ownership (from PLAN.md)

Parallel agents never write to the same directory.

| Owner | Writes |
|---|---|
| Lead coordinator (Systems Architect in M1) | `package.json`, lockfile, `vite.config.ts`, `tsconfig*.json`, `playwright.config.ts`, `index.html`, `src/main.tsx`, `src/game/**`, `src/shared/**`, `CLAUDE.md`, `SPEC.md`, `PLAN.md`, `PROGRESS.md` |
| Simulation Engineer | `src/sim/**`. Changes to `src/sim/types.ts`, or to the signatures in `src/sim/index.ts`, are contract changes and need the lead's sign-off |
| Game Designer | `docs/GAME_DESIGN.md`, and the values in `src/sim/balance.ts` (the shapes are contract) |
| Graphics Engineer | `src/render/**` (except `render/types.ts`, which is contract: ask the lead) |
| UI/UX Engineer | `src/ui/**`, `src/styles/**`, `src/store/**` |
| QA Engineer | `tests/**`, `e2e/**` |
| Code Reviewer | read-only; reports go to `docs/reviews/` |

If you need a dependency, a contract change, or an edit to a file you do not own, ask for it in your report.
Do not make the edit yourself.

## Simulation rules (src/sim)

- **Determinism.** The same `NewGameOptions` and the same sequence of `(tick, PlayerCommand)` give the
  same `GameState`. All randomness comes from `state.rng` through `rng.ts`, or from a stream made with
  `deriveRng(seed, name)` (world generation uses `deriveRng(seed, 'worldgen')`). Never use
  `Math.random`, `Date`, `performance.now`, timers or the iteration order of a `Map`/`Set` holding object keys.
  Unit tests check determinism by deep-equality after N ticks.
- **Engine-independent math.** Only IEEE-exact operations may influence sim state: `+ - * /`, `Math.sqrt`,
  `Math.floor/ceil/round/trunc`, `Math.abs`, `Math.min/max`, `Math.sign`, `Math.fround`, `Math.imul`.
  `Math.sin/cos/tan/atan2/exp/log/pow/hypot/cbrt` can return different results in different browsers, so
  they are banned in `src/sim` (a unit test enforces this). The renderer may use them freely.
- **Fixed timestep.** `stepGame(state)` advances exactly one tick: `TICK_SECONDS` (0.1) sim seconds
  and `GAME_HOURS_PER_TICK` game hours. It takes no `dt`. The loop in `src/game` runs 0..n ticks per
  frame according to speed. At 1x, sim seconds equal real seconds.
- **State is plain JSON.** `GameState` contains only objects, arrays, strings, finite numbers,
  booleans and `null`: no `undefined`, classes, `Map`/`Set`, typed arrays, functions or `NaN`/`Infinity`.
  `JSON.parse(JSON.stringify(state))` must deep-equal `state`. Optional fields are `T | null`, never `?:`.
  Derived or cached data (path caches, spatial indexes) may live in module-level `WeakMap<GameState, …>`
  caches that can be rebuilt from the state. They must never be needed for correctness after a load.
- **Mutation.** `stepGame` and `applyCommand` mutate the state in place and return transient
  `SimEvent[]`. Everything outside the sim treats the state as read-only.
- **Ids.** Entity ids are positive integers from `state.nextId`. Settlers and buildings share the counter.
  Ids are never reused. `0` means "none" in tile arrays.
- **Tiles.** These are flat row-major `number[]` arrays: `index = y * width + x` (use `tileIndex`). They
  are `terrain` (`Terrain` codes), `elevation` (0..`MAX_ELEVATION`), `resource` (units left) and
  `building` (occupying id or 0). Emit `tileChanged` whenever a tile changes after creation. Bump
  `world.revision` only for structural changes (terrain, elevation, building footprint) — not for `resource`
  depletion, which happens every few ticks. The renderer redraws trees and rocks from `tileChanged` events
  and rebuilds everything on `setWorld` (new or loaded game).
- **Tuning numbers live in `src/sim/balance.ts`**, and their values come from `docs/GAME_DESIGN.md`.
  Engine constants (tick rate, schema version, map sizes, limits) live in `src/sim/constants.ts`.
  Do not hard-code gameplay numbers anywhere else.
- **Needs** are 0..100, and **100 is best** for all four (hunger 100 means well fed).
- `applyCommand` never throws on bad input. It returns `{ ok: false, error, message }` and leaves the state unchanged.
- Functions marked `// M1 stub — replaced by …` are placeholders that work. Replace them, but keep
  their signatures.

## Renderer rules (src/render)

- Implement `GameRenderer` (`render/types.ts`). `createRenderer(host, callbacks)` must `await app.init`
  (PixiJS v8) and append `app.canvas` to `host` with `data-testid="game-canvas"`.
- The renderer is driven by `GameController`: `setWorld(state)` on new or loaded games, then
  `render(state, frame)` once per animation frame. Pixi's own ticker is stopped, and `render` calls `app.render()`.
- Read the state and never mutate it. Interpolate settlers with `prevPos + (pos - prevPos) * frame.alpha`.
- Animate settlers from `settler.activity.kind`, never from `settler.task` (that one is internal to the sim).
- Use `frame.events` for one-shot effects such as particles. Ignore event types you do not know.
- Structural tile changes (`world.revision`) trigger a full terrain diff; resource-only changes arrive as
  `tileChanged` events and dirty only the affected chunk. Never rescan the whole map per frame.
- Settler colours and hair/hat rules in `render/entities/palettes.ts` mirror `ui` avatar rules: change both together.
- All iso math goes through `src/shared/iso.ts`. For one click, report exactly one of settler, building
  or tile, in that priority order. A drag pans the camera and is never a click.

## UI and store rules (src/ui, src/store)

- Never put `GameState` (or references into it) in React state or the store. React reads the
  `HudSnapshot` that the controller publishes about every 150 ms (`SNAPSHOT_INTERVAL_MS`).
- Select narrowly: `useUiStore((s) => s.speed)`. For object or array selectors, use `useShallow`
  from `zustand/react/shallow`. A selector that returns a new object on every call makes Zustand 5 loop forever.
- The store holds UI intent (speed, paused, selection, buildMode, overlay, panels). The controller
  subscribes to it and applies it. Commands, saving and loading go through `useGameController()`.
- Give elements that tests need a stable `data-testid`.

## Save format

`localStorage["frontierColony.v1.save.<slot>"]` holds `{ format: 'frontier-colony-save', schemaVersion, savedAt,
summary, state }`. The slots are `autosave`, `slot1`, `slot2` and `slot3`. Autosave runs at each new day and on `pagehide`.
Any breaking change to `GameState` bumps `SAVE_SCHEMA_VERSION` (`src/sim/constants.ts`), adds a
migration step in `src/game/save.ts` (`migrateEnvelope`), and updates `validateGameState`.

## Conventions

- TypeScript is `strict`, with `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
  `noImplicitReturns`, `noImplicitOverride`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. In practice this means:
  - `import type` for type-only imports
  - no `enum`: use const objects, like `Terrain`
  - no constructor parameter properties
  - no `namespace`

  `noUncheckedIndexedAccess` is deliberately off because the tile arrays are indexed heavily. Guard indexes with `inBounds`.
- Use discriminated unions with a `type` or `kind` field. A `switch` over a union must be exhaustive.
- Use the names given in the code (`BuildingType` values such as `lumberCamp`, `ResourceType` values such as `wood`).
- Unit tests live in `tests/<module>/<name>.test.ts`. They run in node, and DOM-free code needs no jsdom.
- `window.__frontierColony` (the `GameController`) is a debug and e2e handle. You can call `getState()`,
  `advanceTicks(n)` and `dispatch(cmd)` on it.
- Before you report done, run `npm run typecheck && npm test && npm run build`. If you touched anything visible, also run `npm run test:e2e`.
