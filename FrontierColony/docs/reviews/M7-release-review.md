# M7 Final Release Review

- **Reviewer:** Code Reviewer agent (model `claude-opus-5-5`)
- **Reviewed:** commit `7e41bbc` on `claude/frontier-colony`, in a clean `git worktree` in my scratch directory (removed afterwards). A second worktree of `87a094e` (the M5-review commit) produced real v1 saves for the migration check.
- **Date:** 2026-10-12
- **Browser probes:** my own `VITE_E2E=1` build on port 4300 and the plain production `dist/` on port 4301. Chromium 1.56.1 with SwiftShader. I did not touch port 4173.

## Verdict

**Ship after the listed fixes.** The minimal fix list:

1. **MAJ-1:** settlers can be walled in by a placement and starve beside full stores. This is the only blocker.
2. **MIN-1:** a malformed save summary blanks the app on every launch. One line plus an error boundary.
3. **MIN-6:** the docs. This is the M8 release work anyway.

Everything the M5 review routed has been fixed for real, not papered over:

- **Starvation and saves.** The starvation matrix, the wolves save and the strict invariants all hold under adversarial probes. There were zero ledger residuals and zero strict-invariant violations across 8 × 60-day games.
- **Pace.** Normal-difficulty victories now land on days 22–26.
- **Renderer.** It is in good shape:
  - no texture, timer or listener leaks across 10 `setWorld` calls;
  - correct depth order behind trees and hills;
  - exact settler and building picking from zoom 0.3 to 3;
  - an occluder pool that peaked at 323 of 900 in a 29-settler, 30-building colony.

**Counts:** critical 0 · major 1 · minor 7 · nit 9.

## What I ran

- **Clean install and build.** `npm ci` gave 0 vulnerabilities. `npm run build` (tsc and vite) passed in 9.6 s from clean, with no warnings.
- **Unit suite.** `npx vitest run`: 42 files, 456/456 passed, 50 s.
- **Throwaway probes** in `tests/probe/` of the worktree (not committed):
  - **8 × 60-day games:** 4 presets on normal, 3 on harsh, 1 on relaxed, all running a 29-building script. Each game ran:
    - a per-tick resource ledger reconciled against `stats.totalProduced`/`totalConsumed`, `goodsLost`, completed sites and broken tools;
    - `strictViolations` every 50 ticks;
    - a frozen-settler detector;
    - `saveToSlot` every 12 game hours, with a load every 5 days.
  - **A 32-case starvation matrix:** difficulty × farms × start needs.
  - **Targeted scenarios:**
    - dehydration with water only in a well buffer;
    - cancel mid-haul (12 runs) and demolish a farm with a hauler en route (6 runs);
    - save and load at 5 offsets inside a decision window, compared with 600 ticks of a clone;
    - real v1 saves from `87a094e` loaded with the current code and played for 3 days.
  - **A placement-enclosure sweep:** 48 games.
  - **Large-map save sizing.**
- **Playwright scripts** (outside the e2e suite):
  - debug-handle gating;
  - 5 new games and 5 loads, measuring the JS heap, live textures, GL buffers, timers and listeners;
  - Pixi GC behaviour;
  - picking at 5 zoom levels;
  - depth screenshots;
  - occluder pressure and per-phase render cost on a 29-settler save;
  - quota behaviour;
  - junk saves and prefs;
  - the fault path.

## 1. M5 findings: verification

| M5 finding | Status | Evidence |
|---|---|---|
| CRIT-1: rest-to-death while starving | **Fixed** | `canRegenerate` gates resting, and `foodSource` and `drinkSource` let settlers eat and drink from buffers. Matrix: normal and harsh × 1 or 3 farms × hunger/health 5/35, 3/20, 10/26 and 0/10 gave **0 deaths in 32 cases**. Dehydrated settlers with stock water 0 and a well buffer of 20 recovered, with 0 deaths. |
| MAJ-1: dangling wolves target blocks saves | **Fixed** | `removeSettler` nulls `activeEvents[].targetId` (`stateOps.ts:180`). There were 0 save failures across 8 × 60 days, saving every 12 game hours. The regression tests pass. The lead's "repair before refuse" hardening was not added; it is not needed now. |
| MAJ-2: farming outranks hauling food in a famine | **Fixed** | There is now a famine lock on farm and well work while their buffer holds goods, a shortage urgency on hauling, and `minLoadFor` drops to 1. No normal or relaxed game starved with food in its buffers. The one harsh loss (archipelago `r7`, day 21) is a genuine winter famine: the buffers were empty, and design allows 3/32 harsh losses. |
| MAJ-3: victory too early | **Fixed** | Normal victories came on days 24, 22, 26 and 23. Relaxed came on day 21. Harsh came on days 55 and 49, with one loss. |
| MIN-1: goods destroyed at the cap | **Fixed (residue)** | Wood lost to the cap went from 731–1,197 to ≤ 22 per 60 days, and every loss is now a `goodsLost` event plus a log line. The residue is nit 2: food lost to "storage full" in hauls was 44–223 per 60 days at the cap. |
| MIN-2: demolishing a storage overfills the stock | **Fixed** | The demolish is refused with a clear message, and `assertInvariants` is strict again. There were 0 stock > capacity violations. |
| MIN-3: wood and stone bonus ignores reserved materials | Fixed | `shortageBonus(..., getAvailableStock)` |
| MIN-4: tools stranded in the workshop | Fixed | `toolsOnHand` is used, and tools are hauled one at a time. |
| MIN-5: bedroll ignores walk regions | **Partly fixed** | `campfireSpot` filters by region, but `getWalkRegions` is *terrain-only* (`grid.ts:85`). Buildings are ignored, so it cannot see pockets that buildings close off. See MAJ-1 below. |
| MIN-6: deserter A* every tick | Fixed | Regression test passes. |
| MIN-7: save list takes 90 ms | **Fixed** | Meta keys. Listing 4 large slots took **0.3 ms**. |
| MIN-8: placement ghost goes stale | Fixed | `publishSnapshot` re-syncs the ghost in build mode (`controller.ts:182`). |
| MIN-9: debug handle ships in production | **Fixed** | Production `dist/`: `typeof window.__frontierColony` is `undefined` on `/` and `object` on `/?debug`. The minified bundle tests `URLSearchParams(...).has('debug')` only. |
| MIN-10: indoors decided by label regex | Fixed | `Activity.indoorsBuildingId` is in the v2 schema. The renderer hides only settlers in a bed, and the invariant check verifies it every tick. |
| Nits 1, 2, 5 | Fixed | |
| Nit 3: extra ticks after victory | **Open** | See nit 3 below. |
| Nit 4: lost goods not toasted | **Partly fixed** | Logged as a warning, but there is no toast. See nit 4. |
| Nit 7: moodlet label prototype lookup | **Open** | See nit 1. |

Other probe results:

- **Cancel mid-haul** (6 carriers): Δheld = 0.000 in every run.
- **Demolish a farm** with 20 food buffered and a hauler en route: Δheld = 0 plus `goodsLost` for the refund above the cap.
- **Load mid-decision** (harvest festival, 5 offsets): byte-identical after 600 ticks.
- **v1 → v2:** three real v1 saves from `87a094e` (days 4, 10 and 19, medium map, with a sickness event active) loaded, migrated and played 3 days with 0 strict violations.
- **Simulation cost:** 0.03–0.11 ms per tick with 20–30 settlers.

---

## Major

### MAJ-1: A placement can wall settlers into a pocket, where they starve next to full stores [verified] (Simulation)

**Where:**

- `src/sim/queries.ts:241–289` (`hasAccess`) requires only that the town-center ring stays connected and that every building has a reachable side. It never checks the tiles settlers stand on.
- `src/sim/settlerSim.ts:231–257` (`ejectSettlers`) moves a settler to the nearest passable tile with no reachability check.
- `campfireSpot` (`:192`) and `townRegion` (`:177`) use `getWalkRegions`. That function is terrain-only (`grid.ts:85`), so a pocket closed off by buildings keeps the town's region label.

**Scenario:** relaxed, `riverValley`, seed `r8`, running the probe's build script.

- On day 36 a lumber camp at (39,34) closes the last gap around tiles (41,34) and (42,34). The pocket is bounded by:
  - house (41,32), house (43,33), farm (41,35);
  - the new lumber camp.
- Two homeless settlers are asleep on those tiles: they are their campfire bedroll spots, within 3 tiles of the town center. The placement passes every check.
- **Calvin Redford and Cora Barlow stay "Idle"** at hunger 0. Every path attempt fails, and they wait out the 0.25 h cooldown and try again. Calvin dies on day 38 at 09:52 and Cora at 19:07, both of starvation.
- **At death the stock holds 508 food and 508 water.** The farm they are standing next to has food in its buffer, but `foodSource` only falls back to buffers when the stock has less than 1 food.

**Frequency:** I swept 4 presets × 12 seeds × 40 days, flood-filling from the town ring after every placement.

- **11 of 48 games** trapped at least one settler. The worst case trapped 4.
- **9 trapped settlers starved.** The others survived because the probe ended at day 40 or because they were not hungry yet.
- Real players build just as densely around the town center, and the bedrolls sit exactly where they build.

**Why major:** these are unexplained deaths with full stores, which breaks design pillar 3 ("failure is always explainable"). The player sees "Idle" and gets no warning, and the only remedy (demolishing a neighbour) is not discoverable.

**Fix (Simulation):**

1. **In `hasAccess`, after the flood fill:**
   - fail when any settler's current tile (`floor(pos)`) is not `seen` and is not inside a building footprint;
   - fail likewise for the bedroll tiles `campfireSpot` can hand out;
   - message: "Settlers would be walled in here".
2. **In `ejectSettlers`:** pick the nearest tile that the town-ring flood fill reaches, not any passable tile.
3. **Safety net:** when a settler's path to food fails N times in a row, move it to the nearest tile reachable from the town ring.
4. **Optionally:** let critical hunger use an adjacent farm buffer even when the stock has food.

Add the `r8` day-36 placement as a regression test.

---

## Minor

### MIN-1: A save with a malformed `summary` blanks the whole app at every launch [verified] (Lead, with UI)

**Where:**

- `src/game/save.ts:163` returns the *unvalidated* `envelope.summary`.
- `:232–235`: `listSaveSlots` uses it whenever the meta key is missing or stale. Saves made before meta keys existed have no meta key, so they always take this path.
- `src/ui/menu/MainMenu.tsx:102` and `SaveLoadView.tsx:98` render it.
- There is no React error boundary anywhere in `src/ui`.

**Probe** (production build):

- **Trigger:** slot1 holds a valid state with `summary.colonyName = {evil: 1}` and has no meta key.
- **Result:** the page is blank, React reports error #31 and `#root` is empty. Because `MainMenu` lists saves on mount, **every launch crashes** until the user clears site data.
- **Limits:** it needs a crafted or corrupted save, so it is not remotely exploitable.
- **Safe paths:**
  - junk prefs (`uiScale: "__proto__"` and others) fall back to defaults;
  - a junk meta with `<img onerror>` as the name renders as inert text;
  - a 100k-character colony name is rejected by the validator.

**It also contradicts the README:** "a corrupt save shows an error instead of crashing".

**Fix:**

- In `deserializeGame`, build the summary from the validated state: `summary: summarize(validation.state)`.
- Add one top-level error boundary in `App` with a "Reset saved data" button (UI).

### MIN-2: Near the storage quota, autosave fails because it writes the backup first; the backup is never readable [verified] (Lead)

**Where:** `src/game/save.ts:178–181`. Autosave first writes `frontierColony.v1.save.autosave.prev` (a full copy), then the save, then the meta record.

**Probe** (Chromium, origin storage filled with junk until full, then about half a save's worth freed):

- A raw in-place `setItem` of the autosave succeeds.
- `saveGame('autosave')` returns "Not enough browser storage to save.", so every daily autosave fails with a toast and the `pagehide` save fails silently.
- The old autosave stays intact, which is good.

**Impact:**

- The quota is about 5 M chars per origin. One large-map day-46 save is 245k chars, and all 6 keys total **1.23 M chars**, so the game alone never gets near it.
- It does matter on shared origins: every project page on `user.github.io` shares one localStorage.
- The `.prev` key doubles autosave storage, yet nothing restores from it. It appears in no UI, no `CLAUDE.md` and no `SPEC.md`.

**Fix:**

- Write the main slot first.
- Treat the backup as best-effort: `try { setItem(backup) } catch { removeItem(backup) }`.
- On a quota error, retry once after dropping the backup.
- Either expose "Restore previous autosave" in Save/Load or drop the backup.
- Separately, a meta write that hits the quota after the save succeeded reports failure even though the save landed. Return ok and let the list fall back to parsing.

### MIN-3: A faulted game looks like it is running once the toast fades [verified] (Lead, with UI)

**Where:**

- `src/game/controller.ts:125`: `paused` ORs in `faulted`.
- `:140–148`: `fault` only toasts. The store's `paused` flag can be cleared again by the play button or Space.

**Probe** (null a settler's `needs`):

- The sim halts at tick 9 and the toast appears.
- Pressing play sets the store to unpaused, and the HUD shows **1x active and no PAUSED badge**.
- The clock stays frozen for good, and nothing on screen explains it after the 9 s toast fades.
- Manual save is correctly refused when the state is invalid.

**Fix:**

- Expose `faulted` in the store.
- Show a persistent banner ("Simulation stopped after an error. Load a save.") with a Load button.
- Disable the speed controls while faulted.

### MIN-4: Baked chunk meshes leak GL buffers until Pixi's GC runs; a Pixi warning on every new game or load [verified] (Graphics)

**Where:**

- `src/render/terrain/chunkBuilder.ts:116` and `terrainRenderer.ts:294`: `MeshSimple.destroy()`. Pixi 8.22's `Mesh.destroy` does **not** destroy its geometry or its 3 buffers.
- `chunkBuilder.ts:117` destroys the RenderTexture while a bind group still holds it.

**Probe** (large map):

- **GL buffers:** `renderer.buffer._managedBuffers` live entries went from 197 at start to 862 after 5 new games, and to 1705 after 5 loads plus zoom sweeps.
- **Reclaimed by GC:** after 100 s idle they fell from 284 to 130, because Pixi's `GCSystem` unloads buffers unused for 60 s. So the leak is bounded, not unbounded.
- **Other resources are flat:**
  - live textures stayed at 23–62;
  - render-texture memory stayed at 32–140 MB, varying with zoom;
  - JS heap stayed at 33–57 MB;
  - timers ended at 0 and window/document listeners stayed at 24.
- **Console noise:** the production console logs `PixiJS Warning: [BindGroup] a 'textureSource' was destroyed while still bound to a shader` once per new game or load, and occasionally on chunk eviction. This is the only console output in a normal session.

**Fix:**

- Destroy the geometry when re-baking or evicting a chunk: `mesh.geometry.destroy()` before `mesh.destroy()`, or `mesh.destroy({ children: true })` plus `geometry.destroy()`.
- Defer `rt.destroy(true)` until after the next `app.render()`, or unbind it first, so the warning goes away.

### MIN-5 (possible, performance): Per-frame garbage and re-skin hitches (Graphics)

**Probe** (29 settlers, 30 buildings, 1280×720, per-phase heap deltas with `--enable-precise-memory-info`):

- **Steady paused frame:** about **280 KB allocated per `render()`**, about 17 MB/s at 60 fps. The breakdown:
  - entities 78 KB;
  - occluder collection and pooling 66 KB;
  - Pixi `app.render` 84 KB;
  - atmosphere 43 KB;
  - effects 23 KB.
- **Allocation sources:**
  - `buildingView.ts:114` builds an array key and joins it per building per frame;
  - `renderer.ts:151` calls `seasonLook()` per frame, which allocates objects and a joined key string;
  - `renderer.ts:156` allocates `wanted` and a closure;
  - `renderer.ts:159` builds an options object for `atmosphere.update`.
- **Season transitions:** across the first in-game day of each season, the look key steps through about 12 quantised values. Every step re-skins every visible chunk at 1–4 chunks per frame. One `rebuild` measured **4–6 ms of CPU and about 1.4 MB allocated**. On a mid-range laptop that is a visible hitch during each 5-minute transition.

**Fix:**

- Cache the building key and compare numbers instead of strings.
- Compute `seasonLook` only when its quantised inputs change.
- Reuse the `wanted` array and pass a persistent options object.
- Spread look re-skins to at most one chunk every few frames, or skip changes below a visible threshold.

**Limits:** SwiftShader timings are not representative of a GPU, so this is marked "possible". **V11 (60 fps on a mid-range laptop, large map, 30 settlers) is still unmeasured**, and SPEC's M7 acceptance requires it. Run it once on real hardware before release.

### MIN-6: Docs drift from the code [verified] (Lead)

**README.md:**

- `:88` links `BENCHMARK.md`, which does not exist. PLAN schedules it for M8.
- "A corrupt or incompatible save shows an error instead of crashing" is false today (MIN-1).
- It tells users to run `npx playwright install chromium`, while `CLAUDE.md` says never to run it. Say "on a fresh machine outside this environment" and pin `@1.56.1`.

**CLAUDE.md:**

- The *Save format* section omits:
  - the meta keys `frontierColony.v1.meta.<slot>`;
  - the `…autosave.prev` backup;
  - that autosave honours the Settings pref.
- The layout block omits `render/atmosphere/`, `render/util/` and `depthKeys.ts`. The tests list omits `tests/qa`, `tests/render` and `tests/ui`.

**SPEC.md (stale points):**

1. The header still reads "Version 1.0 (M1 Foundation)".
2. P5 says the activity "label also determines the animation". The renderer animates from `activity.kind` and hides indoor settlers via `indoorsBuildingId` (CLAUDE.md, V3).
3. §4 `world` says "`revision` changes whenever any tile changes". It changes only on structural changes; resource depletion arrives as `tileChanged`.
4. §4 `settlers[].activity` omits `indoorsBuildingId`.
5. §4 transient events omit `goodsLost`, `buildingDamaged` and `buildingRepaired`, and list `settlerBorn` without saying it is never emitted.
6. S4 says settlers are "born or arrive". The design has no births.
7. §5.3 `UiState` omits `prefs`, `tourStep`, `gameStarted`, `gameMenuOpen`, `menuView` and `eventsSeenId`.
8. §5.4 controller API omits `getCamera`, `isFaulted` and `centerOn`'s `{ animate }` option.
9. §6:
   - says "a large map saves to about 0.5 MB" (measured: 224–245k chars at days 30–46);
   - omits schema v2 and the v1→v2 migration;
   - omits the meta keys and the autosave backup;
   - omits the autosave preference.
10. §3.1 step 1 says the accumulator stops when the game is "over". Only `lost` stops it; `won` pauses through the store.
11. §8 "no warnings beyond the chunk-size notice": the notice is now silenced by `chunkSizeWarningLimit: 1500`, so the sentence is moot.

### MIN-7 (possible): The renderer's keyboard pan ignores UI focus (Graphics)

**Where:** `src/render/input.ts:225–232`. The window `keydown` handler skips only text inputs.

**Effect:**

- In the Priorities panel, the level radiogroup moves focus with the arrow keys (`PrioritiesPanel.tsx:24–32`), and the camera pans at the same time.
- Arrow keys cannot scroll a focused, scrollable panel either.

**Fix:** return early when `e.defaultPrevented`, or when `e.target` is inside `.ui-layer`.

---

## Nits

1. **M5 nit 7, still open.** `moodletLabel` (`src/ui/lib/settlerInfo.ts:138`) indexes a plain object with save-controlled ids, and `hasMoodletLabel` (`:133`) uses `in`.
   - **Effect:** the id `constructor` returns a function, which React drops with a warning. `toString` is "known".
   - **Fix:** use `Object.hasOwn`. (UI)
2. **MIN-1 residue.** The haul amount is `min(carry, avail)` (`src/sim/settlerSim.ts:929`) and is never capped to the free room in the stockpile.
   - **Effect:** at the cap the leftover is lost whenever the source buffer has refilled. That was 44–223 food per 60-day game, which is announced but avoidable.
   - **Fix:** cap the amount to `capacity − stock − inbound`. (Simulation)
3. **M5 nit 3, still open.** `controller.ts:129` keeps running the frame's remaining ticks after a `gameOver` (won) event, up to 39 at 4x. (Lead)
4. **M5 nit 4, partly open.** `goodsLost` only reaches the log: `toastFor` has no case for it. (Lead or UI)
5. **Repair materials vanish on demolish.** Demolishing a building under repair refunds `floor(cost × 0.5)` (`src/sim/index.ts:419`). Materials already delivered to the repair vanish without a `goodsLost` report. (Simulation)
6. **ObjectivesTracker re-renders every snapshot.** `ObjectivesTracker.tsx:48–49` also selects the raw `snapshot.buildings` and `settlers` arrays, which are new objects every 150 ms. That defeats the `sig` memo two lines above, and `rows` and its effect recompute every snapshot. `DecisionHost.tsx:11–12` does the same. Cheap at 6.7 Hz, but select derived values instead. (UI)
7. **Meta trusted when the save body is junk.** `listSaveSlots` trusts the meta record whenever the save text contains a matching `"savedAt"`.
   - **Effect:** a junk save body whose `savedAt` matches shows as "Continue" with the meta's numbers, then fails to load with a toast.
   - **Fix:** also check `json.length` or a hash stored in the meta. (Lead)
8. **Bundle.** One 963 kB chunk (300 kB gzip), with the size warning silenced at 1500 kB.
   - Code splitting buys little, because the main menu already renders the Pixi world.
   - A `manualChunks` vendor split (pixi, react) would help long-term caching.
   - Consider `base: './'` so the build also works under a sub-path such as GitHub Pages. (Lead)
9. **Minimap DOM query.** The minimap runs `document.querySelector('[data-testid="game-canvas"]')` 20 times a second (`Minimap.tsx:93`). Cache the element. (UI)

---

## Areas checked and found sound

- **Renderer lifecycle:**
  - `bakeTimer` is cleared in `destroy` and guarded by `destroyed`;
  - input listeners are removed;
  - occluders are rebuilt on `setWorld`;
  - live textures do not grow across 10 world swaps;
  - no timers outlive the renderer;
  - StrictMode's double mount destroys the late renderer.
- **Render textures:** they are not GC-unloaded, because `TextureSource.autoGarbageCollect` defaults to false, so hidden baked chunks keep their content.
- **Depth:** a settler behind a forest tile and a settler behind a 2-level hill face are correctly occluded by the redrawn baked objects. A settler behind the town-center roof is hidden.
- **Picking** (real mouse clicks, wrapped callbacks; zooms 0.3, 0.6, 1, 2 and 3):
  - 100% of visible settlers and buildings resolve correctly;
  - tile clicks that land on the town center or on a raised tile or peak in front resolve to that occluder, which matches what is drawn;
  - the only settler "miss" is one asleep indoors, which is correctly unpickable.
- **Zoom limits** (0.3 and 3): no seams, holes or culling pops in screenshots. At 0.3, 58 chunks are built (over the 40-chunk cap, because all are visible), using 46 MB of render textures at the 0.6 bake resolution.
- **UI and store:**
  - selectors use `useShallow` or primitives;
  - every `setTimeout`, `setInterval` and listener in `src/ui` is cleaned up;
  - the minimap rebuilds its base image only on a revision change;
  - prefs parsing is robust to junk;
  - there is a focus trap in panels, `:focus-visible` styles, `prefers-reduced-motion`, and an `aria-live` toast host.
- **Integration:**
  - v1→v2 migration verified with real v1 saves;
  - meta keys make listing fast;
  - autosave honours `prefs.autosave` on both `dayStarted` and `pagehide`;
  - the fault path stops ticks and autosave, and a load clears it.
- **Security:**
  - all save and log strings render as React text, with no `innerHTML` sinks;
  - Pixi `Text` shows only numeric float labels;
  - the validator caps string lengths;
  - quota errors are caught and reported.
- **Hygiene:**
  - `.gitignore` covers `dist`, `dist-e2e`, `test-results` and `playwright-report`;
  - a fresh `npm ci && npm run build` succeeds;
  - the production console is silent except for MIN-4's Pixi warning.

## Fix list by owner

| Owner | Must fix before ship | Should fix (cheap) | Backlog |
|---|---|---|---|
| Simulation | MAJ-1, with a regression test | | Nits 2 and 5 |
| Lead | MIN-1 (summary from the state), MIN-6 (docs) | MIN-2, MIN-3 | Nits 3, 4, 7 and 8 |
| UI | MIN-1 (error boundary) | MIN-3 (banner) | Nits 1, 6 and 9 |
| Graphics | | MIN-4, MIN-7 | MIN-5. Measure V11 on real hardware. |
