# M1 Foundation — Code Review

- **Reviewer:** Code Reviewer agent (model `claude-opus-5-5`)
- **Reviewed:** commit `403d2bb` on `claude/frontier-colony`. I read the committed tree through `git archive`, not the working tree, because other agents are editing `src/` while this review runs.
- **Date:** 2026-10-11

## Verdict

**Approved with changes.** The foundation is solid:

- The module boundaries are clean.
- The fixed-step loop is correct.
- The RNG is sound and its state lives inside `GameState`.
- The state is plain JSON, and the tests check determinism and save round-trips.

I found **no critical issues**. Five **major** findings need action now:

- Two are robustness gaps in loading and autosave (C7, "corrupt saves never crash the game", does not hold today).
- Three are contract decisions that get expensive once M3 and M4 code and real saves depend on them.

**Counts:** critical 0 · major 5 · minor 14 · nit 9.

### What I ran to verify (on an isolated copy of `403d2bb`)

- `tsc -p tsconfig.app.json` and `tsc -p tsconfig.node.json` both passed.
- `vitest run` passed: 7 files, 42 tests.
- `vite build` (into the scratchpad) succeeded. The main chunk is 509 kB.
- TS 6.0.3, Vite 8.3.4, Vitest 5.0.3, plugin-react 6.1.2 and Pixi 8.22.0 work together. I found no compatibility problems.
- Throwaway probe tests (not committed) confirmed every finding marked **[verified]** below.

I did not run e2e, as instructed.

---

## Major findings

### MAJ-1 — Save validation is shallow, so a corrupt save loads and then crashes every frame [verified]

**Location:** `src/sim/validate.ts:48`, `:52`, `:60`, `:69`, `:81`, `:83` (plus the missing checks listed below), and `src/game/save.ts:109`.

**What is checked today:** `validateGameState` checks container shapes only. Each tile layer is "an array of finite numbers". `needs`, `skills`, `task`, `activity` and `status` are "an object". `weather.current` is "a string". `stats.history` is "an array".

**What is not checked:** values, enums, nested amount tables and cross-references. These are what the engine actually dereferences.

**Failure scenarios** (each one loaded with `ok: true`):

| Corrupt field | Result |
|---|---|
| `world.terrain` has `99` | Within 500 ticks `stepGame` throws `Cannot read properties of undefined (reading 'walkable')` (`TERRAIN_DEFS[99]`), and `canPlaceBuilding` throws `reading 'buildable'`. |
| `stats.history = [{}]` | `buildHudSnapshot` throws `reading 'wood'`, through `getResourceRates` at `queries.ts:119`. |
| `construction.delivered.wood = "abc"` | Cancelling the site sets `colony.stock.wood` to `NaN`. That serializes as `null`, so the next save cannot be loaded. |
| `weather.current = 'meteor'`, `season = 'monsoon'`, `traits = ['wizard']`, `footprint = {w:'x'}`, `priorities.farming = 9`, `stock.food = -50`, `difficulty = 'nightmare'`, and a `world.building` layer that no longer matches the buildings | All accepted. |

Because `frame()` schedules the next `requestAnimationFrame` before it runs ticks (`controller.ts:116`), a throwing tick repeats on every frame. The game freezes and floods the console. This breaks SPEC C7 ("Corrupt or incompatible saves are reported and never crash the game") and the invariants SPEC §4 says the validator checks (`world.building` consistency, non-negative stock, needs within range).

**Fix (Sim Engineer, since `validate.ts` is sim-owned):** make the validator semantic.

- Terrain codes must be in `Terrain`. Elevation must be an integer in `0..MAX_ELEVATION`, and resource must be ≥ 0.
- Every `ResourceAmounts` must pass `isResourceAmounts`, and each amount must be ≥ 0. This covers stock, `construction.required`/`delivered`, `output`, `history[].stock`, and `producedThisHour`/`consumedThisHour`/`total*`.
- Enum checks: weather, season, preset, mapSize, difficulty, traits, `task.kind`, `activity.kind`, building status, log severity.
- Needs must be in `0..100`. Priorities must be in `0..3`. Every id must be a positive integer.
- `footprint` must equal the def's footprint.
- `world.building` must be exactly the union of the building footprints.
- `homeId`, `workplaceId` and `task.*BuildingId` must reference existing buildings.

Grow this together with the contract. A good test is a fuzz test that mutates one random leaf of a valid save and asserts that loading either fails or yields a state that survives 100 ticks and a snapshot.

### MAJ-2 — The loop has no fault isolation, and autosave can overwrite the only good save with an unloadable one [verified]

**Location:** `src/game/controller.ts:116–123`, `:131`, `:142`, `:66`/`:97`, `:306–308`, and `src/game/save.ts:114–118`.

**Scenario 1: NaN in the state.** An M3/M4 sim bug writes `NaN` into a number, for example a division by zero in a path cost or need rate. `saveToSlot` succeeds, because `JSON.stringify` turns `NaN` into `null`. The next `dayStarted` or `pagehide` autosave replaces the previous good autosave with a save that validation rejects. I confirmed this: `pos.x = NaN` saves with `ok: true` and then fails to load.

Worse, `needs.hunger = NaN` saves **and loads** successfully, because needs are not validated (see MAJ-1). The corruption then spreads quietly.

**Scenario 2: an exception in a tick.** If `stepGame` throws partway through, the state is left half-mutated. The loop throws again on every frame, and `pagehide` then autosaves that half-mutated state.

**Fix (lead, `src/game/**`):**

- Wrap `runTick` and the render call in `try/catch`. On error, pause, `console.error` once, show a toast, and set a `faulted` flag that turns autosave off for this state.
- In `saveToSlot`, validate before writing: `validateGameState(JSON.parse(json))`. This costs about 1.6 ms on a fresh large map, which is acceptable at a day boundary. If validation fails, refuse to overwrite.
- Keep a second autosave generation (`autosave.prev`), or write to a temporary key and then swap.
- Add a test-only `assertInvariants(state)` helper that QA calls after every N ticks in the sim tests.

### MAJ-3 — Settler–building relationships are stored on both sides with no invariant, and a dangling reference already occurs [verified]

**Location:** `src/sim/types.ts:369–370` (`homeId`, `workplaceId`), `:477`/`:479` (`workerIds`, `residentIds`), the `buildingId`, `toBuildingId` and `fromBuildingId` fields of `Task` (`:301–317`), and `src/sim/index.ts:571–578`.

The same relationship is stored in up to three places: the building's lists, the settler's ids, and the settler's task. They will drift apart.

**Current bug:** `removeBuilding` only clears tasks that have a `buildingId` key (`'buildingId' in s.task`). A haul to a cancelled site keeps `toBuildingId: 7` pointing at a building that no longer exists. I verified this.

**Coming bugs in M3/M4:** death, desertion and reassignment all have to update both sides. Every miss either leaks a work slot (because `workerIds` stays full) or leaves a bed that is assigned twice. The UI (`BuildingSummary.workerIds`) shows whichever side is wrong.

**Fix (contract decision, lead plus Sim Engineer, before M3):** make the settler side the single source of truth. That means `workplaceId` and `homeId`, plus the task for transient claims such as a builder slot, a tree tile or haul amounts. Then derive `workerIds` and `residentIds` with a query backed by a `WeakMap<GameState, index>` cache, which CLAUDE.md already allows.

If the lists must stay, document the invariant in `types.ts`, check it in `validateGameState`, and route every change through one `assign`/`unassign` helper. Removal must also clear `toBuildingId` and `fromBuildingId`.

It is cheapest to remove the duplicated fields now, while there are no saves in the wild.

### MAJ-4 — Damage and repair reuse `status: 'construction'`, which breaks cancel, completion events, stats and labels [design + contract]

**Location:** `src/sim/types.ts:454–485`, GAME_DESIGN §6.6 step 6, `src/sim/index.ts:552–562` (cancel rule), and `:477–482` (completion path).

GAME_DESIGN represents a damaged building as `status: 'construction'` with `required` all zero. With the current contract and command rules, that causes four problems:

- `cancelBuilding` is allowed for any `construction` status. The player can "cancel" a storm-damaged house: it is removed with zero refund, and the demolish rule is bypassed.
- On repair, the completion path emits `buildingCompleted` again ("House completed." toast), increments `stats.buildingsCompleted`, and can re-run "on completion" logic: bed assignment, objective 4's count of completed buildings, and unlocks.
- The renderer and UI cannot tell "Repairing {name}" (GAME_DESIGN §5.7) apart from a new blueprint.
- Damaged residents "keep their `homeId` but sleep by the campfire". Every housing query then has to special-case this hidden state.

**Fix:** add `kind: 'new' | 'repair'` to `ConstructionState`, or a `damaged: boolean` field on `Building`. Allow `cancelBuilding` only for `'new'`. Emit a `buildingRepaired` event instead of `buildingCompleted`, and a `buildingDamaged` event at damage time. This is cheap now and needs a migration later.

### MAJ-5 — Persisted state the design needs is missing from the contract

Each item below becomes a `SAVE_SCHEMA_VERSION` bump plus a migration once real saves exist. Today they are free. I recommend one contract pull request from the lead that lands them all before the M3 and M4 sim work commits to workarounds.

| Missing | Why it is needed | Where |
|---|---|---|
| `ActiveRandomEvent.targetId: EntityId \| null` (and possibly `tile`) | `cropBlight` affects "one random farm" for 48 h (GAME_DESIGN line 767). There is no field to record which farm. | `types.ts:159–167` |
| Per-hour `produced` and `consumed` in `StatsSample` | `producedThisHour` and `consumedThisHour` are reset at each sample (`index.ts:422–423`) without being stored, so the production/consumption split is lost (SPEC §4, R3). `getResourceRates` (`queries.ts:111–121`) then measures the net stock delta. That shows 0 while stock sits at the cap and counts a building's placement cost as "consumption". | `types.ts:499–505` |
| A record of names used, or a graveyard (`{id, name, diedDay, cause}`) | GAME_DESIGN §3.1 requires names to be unique among living **and dead** settlers. Dead settlers leave `settlers[]`, and `eventLog` is capped at 200. The victory and statistics screen also wants a death list. | `ColonyState` / `ProgressState` |
| Per-settler episode flags: `criticalNeeds` / `needCritical` sent, `sleptOutdoorsLastNight` | `needCritical` fires "once per episode" (GAME_DESIGN §5.5). Sickness odds go up "if anyone slept outdoors last night" (§10, item 8). | `SettlerStatus` (`types.ts:336–348`) |
| Who owns warnings | GAME_DESIGN §12 says warnings "toast once when they first appear". Neither the state nor `HudSnapshot` holds warnings or their "already shown" memory. | Decide: a pure `getWarnings(state)` query plus diffing in the controller, with no persisted state |

---

## Minor findings

### MIN-1 — `ConstructionState.required` has an ambiguous meaning

**Location:** `src/sim/types.ts:461`.

The doc comment says "Materials **still owed** to the site (**copy of def.cost** at placement)". Those two meanings conflict.

GAME_DESIGN §6.6 computes `required − delivered − inTransit`, which assumes `required` is constant. If one engineer decreases `required` on each delivery while another subtracts `delivered`, the shortfall is counted twice, `deliveredFraction` is wrong, and builders stall.

**Fix:** "Total materials needed (constant; copy of `def.cost`)."

### MIN-2 — Victory semantics disagree between the contract and the design

**Location:** `types.ts:522–526`, `:555`, GAME_DESIGN line 801, and `controller.ts:301`.

- The contract says the status stays `'won'` after `acknowledgeVictory`, and `victoryAcknowledged` records the acknowledgement.
- GAME_DESIGN §11 says "Keep playing" **returns `status` to `playing`**.

A UI that shows the victory screen whenever `status === 'won'` gets stuck under the first reading. A sim that checks victory every hour re-triggers under the second unless it reads the flag.

**Fix:** pick one rule and write it into `types.ts` and SPEC S8.

### MIN-3 — `applyCommand` can throw, and its `in` checks accept prototype keys [verified]

**Location:** `src/sim/index.ts:492–524`, `:504`, `:511`, `:540`.

This breaks the CLAUDE.md promise "never throws on bad input". It is reachable through `window.__frontierColony.dispatch`, e2e scripts, and any future save or replay import. I verified four cases:

| Input | Result |
|---|---|
| `{type:'placeBuilding', buildingType:'constructor'}` | Passes `type in BUILDING_DEFS`, then throws `Cannot destructure property 'w'`. |
| `{type:'setPriority', category:'constructor', level:1}` | Returns `ok`, and adds a junk `constructor` key to `colony.priorities`, which is then persisted. |
| `{type:'renameColony', name:5}` | Throws `trim is not a function`. |
| An unknown `type` | Returns `undefined`. `controller.dispatch` then throws on `result.ok`. |

**Fix:** use `Object.hasOwn` for the key checks, `typeof` guards, integer checks on `x` and `y`, and a `default:` branch that returns `invalidArgument`.

### MIN-4 — `createGame` does not check `NewGameOptions` [verified]

**Location:** `src/sim/index.ts:98–116`.

- The colony name is trimmed but not length-capped. A 100,000-character name was accepted in my probe. `renameColony` caps at 40, but this path does not.
- `seed` is unbounded too, and is stored in `meta` and in every save summary.
- An invalid `mapSize` gives `new Array(NaN)`, which throws `RangeError`. An invalid `difficulty` gives stock with no fields.

The new-game screen arrives in M5, and saves are rendered in the slot list.

**Fix:** clamp the name and seed (for example to 40 and 64 characters), and fall back to the defaults for unknown enum values.

### MIN-5 — The `isoDepth` guidance ("pass the footprint's far corner") hides settlers that stand in front of buildings

**Location:** `src/shared/iso.ts:82–89`.

Take a settler at `(ox+3.5, oy+0.5)`, just in front of the +x face of a 3×3 building at `(ox, oy)`:

- Its depth is `ox+oy+4`.
- The building's far-corner depth is `ox+oy+6`.

So the building is drawn last. The settler's feet are at screen `(96, 64)` relative to the origin, 16 px below the front-right edge, so its 20–30 px sprite overlaps the wall and the roof covers its head. Today's stub does not show this, because settlers are drawn on their own layer above buildings. It will show as soon as the Graphics Engineer follows the documented convention to interleave them.

**Fix:** for comparing a point against a footprint, use the footprint's centre sum, `ox + oy + (w + h)/2`. That orders every non-overlapping point–rectangle case I tested correctly. Alternatively, use the explicit rule: in front if `x ≥ ox+w || y ≥ oy+h`. Update the doc comment before M3 rendering starts.

### MIN-6 — `pickTile` returns hidden tiles when you click a cliff wall, and `mapScreenBounds` ignores elevation

**Location:** `src/shared/iso.ts:69–80`, `:91–99`.

I traced the top-face picking and it is correct: a lower tile in front can never overlap a higher tile behind it, because the planes are offset by 0.375 tiles per level.

However, a click on the visible side wall of a raised tile drawn by the stub falls through to a lower plane. That returns the tile **behind** the wall, which is occluded. The plane-0 fallback can also return a tile whose elevation is not 0.

`mapScreenBounds.minY` uses elevation 0, so camera limits will clip raised tiles along the top edge of the map.

**Fix:** if no plane matches, return the front-most raised tile whose wall quad contains the point, or null. Subtract `MAX_ELEVATION * ELEVATION_STEP` from `minY`.

### MIN-7 — The sim uses `Math.hypot`, which can differ between browser engines (possible)

**Location:** `src/sim/index.ts:211` (world generation), `:449` (movement).

ECMAScript allows `Math.hypot` (and also `sin`, `cos`, `exp`, `pow`, `log`) to be "implementation-approximated", so V8, SpiderMonkey and JavaScriptCore can differ by 1 ulp. The world generator compares `d < 0.7` and `d <= 1`, so a shared seed *may* produce a slightly different map in Firefox than in Chrome. A save moved between engines would then diverge. This weakens W1 ("same seed always gives an identical map") across browsers. I could not test other engines here.

**Fix (cheap rule for M2 noise and terrain work):** in `src/sim`, use only `+ - * /`, `Math.sqrt` (correctly rounded), `floor`, `ceil`, `round`, `abs`, `min`, `max` and `imul`. Use integer-hash value noise, not `Math.sin`-based noise. Add the rule to CLAUDE.md under Simulation rules.

### MIN-8 — `BuildingDef` cannot express values the design needs

**Location:** `src/sim/types.ts:423–452`, `balance.ts:85–230`.

These are code-only shapes, so they need no migration, but they are contract-owned. Values the design needs that the shape cannot express:

- The output buffer cap (30, or 10 for the workshop).
- Work radius. Today `requiresNearby.radius` doubles as the work radius. The town center's forage radius of 8 has no home.
- `maxBuilders` (2, 3 or 4).
- A drinking point. Wells can be drunk from but not eaten at, and there is only `eatingPoint`.
- The town center's two forage slots (wood and stone). The town center has `maxWorkers: 0` and `jobCategory: null`, so the snapshot's `maxWorkers` will be wrong.

**Fix:** add `outputCap`, `workRadius`, `maxBuilders`, `drinkingPoint`, and a `slots: {category, count}[]` field (or a forage spec).

### MIN-9 — e2e may run against a stale server, and concurrent runs share `dist/` (possible)

**Location:** `playwright.config.ts:34–36`.

`reuseExistingServer: !process.env.CI` means that a local `npm run test:e2e` skips `npm run build` whenever anything already listens on port 4173. With several agents in one checkout, and CLAUDE.md telling them about `npm run preview`, a stale build from another agent can produce a false green. Concurrent `npm run build` runs also write to the same `dist/`.

**Fix:** set `reuseExistingServer: false`. Let agents pass the port through an environment variable, or serialize e2e through the lead.

### MIN-10 — Save listing parses every slot in full, and there are two copies of the schema version [verified]

**Location:** `src/game/save.ts:144–158`, `:88–95`, `src/sim/validate.ts:38`.

**Listing cost:** `listSaveSlots` runs `JSON.parse` plus full validation on all four slots just to read their summaries. That is about 1.6 ms per slot for a fresh large map today, and grows with play (SPEC estimates about 0.5 MB per save). Called during a render, it costs tens of milliseconds.

**Version duplication:** the envelope's `schemaVersion` and `state.meta.schemaVersion` must be migrated together. A save with envelope version 1 and `meta.schemaVersion` 2 reports "Save data is invalid: unsupported schemaVersion 2" instead of "made by a newer version".

**Fix:**

- Store the summary under its own key, or cache it by slot and string length.
- Make `migrateEnvelope` the only place that reads versions: it compares and rewrites `state.meta.schemaVersion`, and `validate` stops rejecting on the version.

### MIN-11 — Autosave triggers and failures

**Location:** `controller.ts:66`, `:97`, `:306–308`.

- Autosave runs only on `pagehide` and `dayStarted`. Add `visibilitychange` to the hidden state, which is more reliable when a tab is discarded or a mobile browser is backgrounded.
- An autosave that fails (for example on quota) is ignored silently, so the player believes they are protected. Show a toast once per session when autosave fails.

### MIN-12 — React re-render traps in the snapshot design

**Location:** `src/store/snapshot.ts:107–169`, `src/ui/TopBar.tsx:16`.

Each snapshot rebuilds every `SettlerSummary` and `BuildingSummary`, so every object has a new identity every 150 ms. `TopBar` subscribes to the whole `snapshot`. It is cheap today (about 0.05 ms to build), but in M3 the settler list, inspector and build menu would all re-render at about 7 Hz even when nothing changed. `useShallow` cannot help with arrays of fresh objects.

**Fix (UI Engineer):**

- Select primitive fields: `s.snapshot?.day`, and so on.
- Look up settlers and buildings by id inside memoised rows.
- Optionally, reuse the previous summary object when its serialized fields are unchanged (structural sharing in `buildHudSnapshot`).

### MIN-13 — The stub renderer redraws all terrain on any tile change (guidance for the Graphics Engineer)

**Location:** `src/render/index.ts:134–137`, `:262–290`.

Any bump of `world.revision` rebuilds one `Graphics` holding up to about 16k diamonds plus walls on a 128² map. In M4 the revision bumps on every placement and every depleted forest tile, so each one causes a frame hitch. The contract already suggests patching from `tileChanged`. Use chunked containers (for example 16×16 tiles each) and rebuild only the dirty chunk.

Also:

- The settler click test (`:235–238`) and the selection ring (`:370`) use `pos`, not the interpolated position.
- `drawBuildings` builds a key string on every frame (`:293–295`).

### MIN-14 — The placement ghost goes stale while the cursor is still

**Location:** `src/game/controller.ts:166–183`.

`canPlaceBuilding` runs again only when the hover tile, selection, build mode or overlay changes, or after a successful dispatch. If wood arrives, a tile changes, or a site completes while the cursor rests, the ghost keeps its old red or green colour until the mouse moves.

**Fix:** also refresh the ghost in `publishSnapshot` while `buildMode` is set (every 150 ms, about 0.02 ms per check).

---

## Nits

1. **`timeOfDay` drifts from float accumulation** (`index.ts:398`). After 60 days it is `5.99999999996` instead of `6` [verified], so hour boundaries fire one tick late. It is deterministic and harmless, but derive it from the tick instead: `(START_HOUR + tick * GAME_HOURS_PER_TICK) % 24`, or keep an integer tick-of-day.
2. **`MAX_STEPS_PER_FRAME = 40` can never be reached** (`clock.ts:11`), because `MAX_FRAME_MS × 4 / TICK_MS` is at most 10. SPEC §3.1 says "at most 40". Align the doc, or derive the cap.
3. **Stub founders do not follow the design.** 20 of 250 founders across 50 seeds have mutually exclusive traits [verified] (`index.ts:255`; P1 says "from exclusive pairs"). `names.ts` does not match the pools in GAME_DESIGN §3.1. Initial needs are fixed, not `80 ± 10` / `90 ± 10`. These are stubs, but the Sim Engineer should not keep them.
4. **`window.__frontierColony` ships in the production bundle** [verified, present in `dist`] (`main.tsx:21`). The impact is low: there is no backend and no secrets, but it gives full mutable state to extensions and cheats. Expose a narrow facade (`getState`, `advanceTicks`, `dispatch`), and gate it behind a `VITE_E2E` build flag or `?debug`. e2e runs against the production build, so a plain `import.meta.env.DEV` check would break it.
5. **The public sim API exports internals.** `pushLog` and `facingFor` are exported from `src/sim/index.ts`, which invites mutation from outside the sim.
6. **`SaveResult.bytes` is `json.length`** (`save.ts:118`), which counts UTF-16 code units, not bytes. Rename it to `chars`.
7. **`haul.fromBuildingId: EntityId | null`** (`types.ts:309`) is ambiguous for pooled stock: a hauler still walks to a physical store. Make it non-null.
8. **`BUILDING_COLORS: Record<string, number>`** (`render/index.ts:36`) loses the exhaustiveness check. Use `Record<BuildingType, number>`.
9. **`PendingDecision.payload` is flat** (`types.ts:541`). The trader's "30 wood + 10 stone → 4 tools" offer needs ad hoc keys. Consider typed `give: ResourceCost; get: ResourceCost`.

---

## Things verified as correct

- **Spiral of death is bounded.** Frames are clamped to 250 ms, so at 4x a frame runs at most 10 ticks. If ticks become slow, the game falls behind real time but never compounds the delay.
- **Hidden tab:** `requestAnimationFrame` stops. On return the frame is clamped, so the loop resumes without a long catch-up.
- **Pause** keeps `alpha` stable, so there is no jitter.
- **Speed changes** keep the accumulator.
- **Commands** run between ticks.
- **Interpolation:** `prevPos` is reset at the start of each tick, and the renderer lerps with the remaining accumulator, which is correct.
- **RNG:** sfc32 matches the reference C ordering (post-increment counter), seeded through splitmix32. It never produces an all-zero state. `deriveRng` keeps world generation and simulation streams independent.
- **No `Math.random`, `Date`, timers or `Map`/`Set` iteration in `src/sim`.** The `Set` in `createGame` is only used for membership tests.
- **XSS:** no `innerHTML`, `dangerouslySetInnerHTML`, `HTMLText` or `document.title` writes anywhere in `src/` (grep). Colony names and log text are rendered as React text nodes. Keep it that way: if Pixi text is added for names, use `Text` or `BitmapText`, never `HTMLText`.
- **No global prototype pollution path.** `JSON.parse` turns a `"__proto__"` key into an ordinary own property. The only place loaded data is passed to `Object.assign` (`index.ts:565`) changes the prototype of the local `refund` object only, and `Object.prototype` stays clean [verified]. Do not add generic deep-merge helpers to migrations.
- **Threat model:** today a tampered `localStorage` only hurts its owner. If save import or export (file or URL) is ever added, MAJ-1 becomes a real security boundary.
- **Save size:** a fresh large map is 138 kB. Serializing takes about 1.3 ms and deserializing plus validating about 1.6 ms. Four slots fit easily within quota.
- **StrictMode double mount** is handled by `mountToken`.
- **Quota errors** are mapped to a friendly message, and DOMException quota names match `/quota/i`.

---

## Priority fixes for the lead (before or while M2–M4 proceed)

1. **MAJ-2:** lead, in `src/game`. Wrap ticks and rendering in `try/catch` and pause on error. Validate before writing a save, and keep `autosave.prev`.
2. **MAJ-1:** Sim Engineer, in `validate.ts`, with QA adding fuzz tests. Write the semantic validator, and grow it with every contract addition.
3. **MAJ-3:** lead's decision, before M3 assigns workers. Make the settler side the single source of truth for home, workplace and claims. Remove or derive `workerIds` and `residentIds`.
4. **MAJ-4 and MIN-1:** contract. Add a repair marker (`ConstructionState.kind`) and fix the doc of `required`.
5. **MAJ-5 and MIN-8:** one contract pull request while no saves exist, so `SAVE_SCHEMA_VERSION` can stay 1. It adds: event target, per-hour production and consumption, the used-names record or graveyard, episode flags, and the `BuildingDef` fields (`outputCap`, `workRadius`, `maxBuilders`, `drinkingPoint`, slots).
6. **MIN-5:** fix the `isoDepth` guidance before the Graphics Engineer builds depth sorting.
7. **MIN-7:** add a CLAUDE.md rule limiting which `Math` functions the sim may use, before M2 noise lands.
8. **MIN-3 and MIN-4:** harden `applyCommand` and `createGame` inputs (`Object.hasOwn`, `typeof` guards, a `default` branch, length clamps).
9. **MIN-2:** settle the victory status semantics.
10. **MIN-9:** set `reuseExistingServer: false` in `playwright.config.ts`.
