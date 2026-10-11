# M2–M5 Code Review: World, Settlers, Economy, Gameplay

- **Reviewer:** Code Reviewer agent (model `claude-opus-5-5`)
- **Reviewed:** commit `87a094e` on `claude/frontier-colony`. I reviewed an isolated `git worktree` of that commit, because other agents are editing `src/render`, `src/ui`, `src/styles`, `src/store` and `e2e` for M6. The worktree has been removed.
- **Date:** 2026-10-11

## Verdict

**Not release-ready yet. One critical fix and two major fixes are needed. All of them are small, local changes.**

The engine is in good shape:

- I found no resource duplication.
- Save/load stays deterministic with everything in flight.
- I saw no stuck settlers, task thrash or leaked reservations in 60-day runs.
- Pathfinding failures are rare.
- Performance has plenty of headroom: 0.33 ms per tick with 30 settlers on a large map.

There are two problems:

- **Starvation turns into certain death.** A settler whose health drops below 25 while food is out goes to bed and never gets up. Farmers keep farming instead of carrying the food in the farm buffers to the larder. On normal difficulty, a starving colony with 32 food sitting in its farms dies to the last settler.
- **A wolf attack can block all saving for 24 hours.** If the mauled settler dies, autosave, manual save and the save on tab close are all refused for the rest of the event.

The other headline issue is design fidelity: victory arrives around day 14–20, before or during the first winter.

**Counts:** critical 1 · major 3 · minor 11 · nit 7. Test findings are counted in these totals.

### What I ran (on the worktree)

- `npm ci` succeeded. `tsc -b` is clean for the committed code; the only errors came from my uncommitted probe files.
- The committed unit suite passes: 33 files, 364/364 tests, 92 s.
- I wrote throwaway probes in `tests/probe/` (not committed):
  - **60-day runs**: 4 normal and 2 harsh, each with a sensible 29-building script. Every tick they ran a resource ledger, a frozen-settler detector, a task-switch counter and a save validation pass every 300 ticks.
  - **Targeted scenarios**: wolves, cancel mid-haul, cancel at cap, demolish storage, demolish a worked farm, kill a carrier, save/load mid-decision, victory and acknowledge.
  - **Starvation-recovery matrix**: 12 cases.
  - **Start-site sweeps**: 480 and 960 starts.
  - **Measurements**: large-map save size and costs at day 30.

---

## Critical

### CRIT-1: A settler who is starving and below 25 health rests until death, even with food 50 m away [verified]

**Where:**

- `src/sim/settlerSim.ts:986`: `criticalResponse` returns `'rest'` when health < 25.
- `:1151–1153`: rest ends only when health ≥ 50.
- `:1676`: rest is not interruptible.
- `src/sim/needs.ts:232–241`: health only regenerates when hunger ≥ 25 and the settler is not dehydrated.

**Mechanism:** with no food in stock, health cannot regenerate, so the wake condition can never become true. The only thing that breaks the rest is the critical `drink`, which has a 4-hour cooldown and restores 8 hunger. The settler never runs `decide()` again, so it never hauls the food that is sitting in a farm's output buffer. Eating only draws from `colony.stock`.

**Probe 1** (normal difficulty, spring, 1 complete farm with 24 food in its buffer, stock food 0, water 40, all 5 settlers at health 20 and hunger 5): all 5 rest and all 5 die in about 9 h. The farm still holds 24 food at the end.

**Probe 2** (normal difficulty, 1–3 working farms, stock food 0, water 40). Healthy settlers recover. Already-starving ones do not:

| Start (hunger / health) | 1 farm | 2 farms | 3 farms |
|---|---|---|---|
| 30 / 100 | survive | survive | survive |
| 8 / 45 | survive | **5/5 dead**, 32 food in buffers | **5/5 dead**, 36 food in buffers |
| 5 / 35, 3 / 30, 10 / 26 | 5/5 dead | 5/5 dead | 5/5 dead |

**In real games:** both of my harsh runs were wiped this way:

- **Continent seed `r5`:** died on day 9 with 12 food in the farm.
- **Highlands seed `r6`:** died on days 23–24, right after the first winter, with **74 food** in 4 farm buffers (see MAJ-2 for how they got there).

This breaks design pillar 3: "Failure is always explainable". It strikes at the climax of the session arc, the end of the first winter, on any difficulty once the larder hits 0.

**Fix (Simulation Engineer):** do both of these.

- **(a) End or skip rest when it cannot help.** Do not start `rest`, and end an ongoing rest, when regeneration is impossible: `hunger < HEALTH.regenMinHunger`, or dehydrated with water 0. The settler then goes back to `decide()`.
- **(b) Let critical hunger feed from buffers.** Make critical hunger able to eat straight from the nearest output buffer that holds food. Either the farm becomes an emergency eating point, or the critical response becomes "haul ≥ 1 food from the nearest buffer, then eat".

Option (b) also removes the dependence on haulers during a famine. Add probe 1 and the second probe's table as regression tests. GAME_DESIGN §5.5 should be amended for (a) (Game Designer).

---

## Major

### MAJ-1: A wolves victim who dies or deserts makes every save fail for up to 24 h [verified]

**Where:**

- `src/sim/events.ts:437`: stores the victim as `ActiveRandomEvent.targetId`.
- `src/sim/stateOps.ts:127–141`: `removeSettler` never clears `activeEvents`, unlike `clearBuildingReferences` at `:158`.
- `src/sim/validate.ts:440–442`: rejects a `targetId` that does not reference a living entity.

**Scenario** (verified): a settler at 30 health is the farthest from the town center when wolves strike. The attack deals 35 damage and the settler dies that tick. `validateGameState` then fails with `activeEvents[0].targetId does not reference an entity`. `saveToSlot` returns `Save refused: the game state is invalid (…)`.

**Consequences, for the remaining ~24 h of the event:**

- The day-change autosave fails with a warning toast.
- Manual saves fail.
- The **`pagehide` save on tab close fails**, so closing the tab loses everything since the last autosave.

A desertion during the event does the same. Wolves are a common event (p 0.06/day from day 4), and a mauled settler is the one most likely to die.

**Fix (Simulation Engineer):**

- In `removeSettler`, null `targetId` on events that point at the removed settler. This is better than dropping the event, because the wolves slowdown should continue.
- Alternatively, have the validator accept dangling event targets.
- Add a test: wolves kill the victim, then `saveToSlot` succeeds.

**Hardening (Lead):** a single dangling reference should not block saving. `saveToSlot` could run a "repair" pass that clears dangling references before refusing.

### MAJ-2: During a food shortage, farming outranks moving food to the larder [verified]

**Where:**

- `src/sim/settlerSim.ts:717–742`: farm work gets `shortageBonus('food')` of up to +25, plus +15 commitment, and stays available until the buffer reaches its cap of 30.
- `:812–839`: emptying a buffer only gets `25 × fill`, with no shortage term.
- `src/sim/balance.ts:642`: `minLoad: 6`.

**Highlands seed `r6`, harsh, days 21–22:**

- Stock food was 0 and all 8 settlers held farm slots on 4 farms.
- At hunger 0–15, all 8 were **farming**, and the buffers grew to 18 + 24 + 16 + 4 = 62 food.
- Nobody hauled. Farming scored about 95 or more (55 + 25 shortage + skill + 15 commitment); hauling scored about 72.
- Health fell below 25 and CRIT-1 finished the colony.

GAME_DESIGN §5.3/§5.4 has the same gap: the food shortage pulls labor to farming, never to delivery.

**Fix (Simulation Engineer, values with the Game Designer):**

- When the stock of a resource is short, give "empty a buffer" for food and water the same shortage bonus as producing it, and drop `minLoad` to 1 for those resources.
- Alternatively, make farm work unavailable while `stock.food < pop` and the farm buffer holds at least `minLoad`.

### MAJ-3 (design fidelity): Victory comes before or during the first winter, not in "year 2 spring" [verified]

**Where:** `src/sim/events.ts:153–172` (growth) and `:360–368` (wanderers join without asking when beds are free), `src/sim/balance.ts:727–739`.

**Probe** (normal difficulty, the soak's own MONTH build order for days 1–22):

| Map, seed | Population (day 10 / day 15 / day 20) | Victory day |
|---|---|---|
| Continent `r1` | 9 / 14 / 21 | **19** |
| Archipelago `r2` | 11 / 18 / 25 | **15** |
| River valley `r4` | 12 / 20 / 24 | **14** |
| Continent `soak-b` | 10 / 15 / 19 | **20** |

**Design (§1, §8):** population 12–16 by the end of winter (day 20), and victory around day 22–30 in year-2 spring. Today in 3 of these 4 games, victory comes before winter starts (day 16) or in its first days. The "Survive the Winter" stakes are skipped, and the player sees the victory screen around 45 minutes into a 90-minute arc.

**Cause:** growth runs about 1.0–1.4 newcomers per day against the design's 0.75. Contributing factors:

- Growth continues through winter.
- Wanderers arrive in pairs.
- A cheap house buys 4 beds.

**Fix (Game Designer, then Simulation Engineer):** retune the growth numbers. Options:

- Lower the base growth chance.
- Stop growth in winter.
- Require `winter` among `objectivesDone` before `thriving` can complete.

The soak should assert a lower bound on the victory day (see TEST-4).

---

## Minor

### MIN-1: Goods are silently destroyed at the storage cap [verified]

**Where:**

- `src/sim/settlerSim.ts:1395–1406`: gather drop. The rest is lost when the camp buffer is full, and always when foraging at the town center.
- `:1298–1303`: haul leftovers.
- `src/sim/stateOps.ts:113–121`: `abortSettlerTask` clamps returned goods.
- `src/sim/index.ts:409–412`: `removeBuilding` refunds after the building has left the capacity sum.

**Measured, over 60 days:**

- 4 normal games destroyed 731–1,197 wood plus 50–200 food and stone, all at the cap. That is roughly 400–600 worker-hours of wasted labor.
- Cancelling a house at the wood cap lost its 30 delivered wood with no message.

**Design §6.1:** deliveries over the cap are *refused* and buffers fill up.

**Fix (Simulation Engineer):**

- Keep a gathering loop going only while its own buffer has room (`hasRoomFor` should not count the stock when the drop target is a stockpile at cap).
- Put leftovers back into the source buffer before giving up.
- Log a "lost: storage full" line for refunds.

### MIN-2: Demolishing a storage leaves stock above capacity, and the invariant check was loosened to hide it [verified]

**Where:** `src/sim/index.ts:400–413`, `src/sim/testSupport.ts:42` (`v > cap + 1e-6 && v > 1000`).

**Scenario:** stock 250 wood and 250 food with a cap of 270. Demolish the storage: the cap drops to 150 and the stock stays at 250. It is still 250/150 after 300 ticks, and the HUD shows over-full bars.

**Fix (Simulation Engineer):** clamp the stock to the new capacity on demolish. Per §6.1 the excess is lost, so log it. Then restore the strict `v ≤ cap` assertion.

### MIN-3 (design fidelity): The wood and stone shortage bonus ignores reserved materials

**Where:** `src/sim/settlerSim.ts:364–380`. The code uses `stock.wood` and `stock.stone`. GAME_DESIGN §5.3 uses `woodAvailable = stock − reserved` "so queued buildings pull labor toward wood and stone".

**Effect:** queue three houses (90 wood reserved) with 90 wood in stock and the woodcutting bonus stays at 0.

**Fix (Simulation Engineer):** use `getAvailableStock` for the wood and stone terms. It is already computed elsewhere in the decision.

### MIN-4: Tools can get stranded in the workshop buffer (possible)

**Where:** `src/sim/settlerSim.ts:729–737` and `src/sim/balance.ts:642`.

**Mechanism:**

- Crafting stops when `stock.tools ≥ toolTarget`, which counts the stock only.
- Each cycle makes 1 tool, and hauling needs `minLoad` 6.
- So up to 5 finished tools can sit in the buffer, invisible to settlers, until the stock drops and a sixth tool is crafted.

**Fix (Simulation Engineer):** count buffered tools toward the target, and use `minLoad` 1 for tools.

### MIN-5: The bedroll spot ignores walk regions (possible)

**Where:** `src/sim/settlerSim.ts:173–186`. `campfireSpot` picks any passable tile within 3 tiles of the town center.

**Risk:** on river or lake starts, a homeless settler can be assigned a tile across water.

**Effect:** the sleep path fails, a 0.25 h cooldown follows, the settler tries again, and so on until it collapses outdoors.

**Fix (Simulation Engineer):** filter the spots by the region of the town center ring.

### MIN-6: A deserter retries A* every tick when its edge path fails (possible)

**Where:** `src/sim/settlerSim.ts:1714–1725`. The desertion check runs before the cooldown check. After `failTask`, the next tick starts `depart` again, with up to 20,000 A* iterations.

**Fix (Simulation Engineer):** skip the check while `task.kind === 'idle' && task.progress > 0`.

### MIN-7: Opening the save list takes about 90 ms on large maps (still open from M1 MIN-10)

**Where:** `src/game/save.ts:158–172`, called from `SaveLoadView` and `MainMenu`. Under StrictMode the `useState` initializer runs twice.

**Measured:** 91 ms per call with 4 full slots (large map, day 30). The work is a full parse and validation of each slot.

**Fix (Lead):** store the summary under its own key, or at least skip `validateGameState` when listing.

### MIN-8: The placement ghost goes stale while the cursor is still (still open from M1 MIN-14)

**Where:** `src/game/controller.ts:185–202`. The ghost is only recomputed when the store changes. `PlacementBar` now re-checks every tick, so the bar and the ghost can disagree once stock arrives or a settler walks off a tile.

**Fix (Lead):** refresh the ghost in `publishSnapshot` while `buildMode` is set.

### MIN-9: The debug handle ships in production builds

**Where:** `src/main.tsx:21`. `window.__frontierColony` exposes the live controller unconditionally, including `getState()` with the mutable state, `dispatch` and `loadGame`.

**Risk:** this is a single-player client, so it is low. But it is an easy cheat surface, and any injected script can corrupt the state.

**Fix (Lead):** install it only when `import.meta.env.DEV`, behind `?debug`, or under a build flag that the e2e build sets.

### MIN-10: The renderer decides "indoors" by regex on the label text

**Where:** `src/render/entities/entityLayer.ts:26` and `:205`. The `INDOOR_LABEL = /^(Sleeping|Resting) in /`.

**Effects:**

- The sim's rest label is "Resting (hurt|sick)", so a settler **resting in bed is drawn lying outdoors** at the doorstep.
- Any label change breaks the check.

**Fix (Graphics, with a contract tweak by the Lead):** add `indoors: boolean` (or reuse `targetTile` = bed) to `Activity` instead of parsing UI text.

### MIN-11: See TEST-3 and TEST-5 below (test findings, counted as minor)

---

## Nits

1. **Hard-coded tuning numbers in `src/sim`,** contrary to CLAUDE.md:
   - `needs.ts:142–144`, `:204–218` (trait multipliers 1.25, 0.85, 1.15, 0.9, 0.7, 1.3, +8 and +4).
   - `:216`, cold snap 1.3, where `EVENTS.coldSnap.energyDecayMult` exists and is unused.
   - `settlerSim.ts:1214` (sociable 12), and `:1642` and `:1654` (72 h and 48 h, which duplicate `MOODLETS`).
2. **`arrivalTile` takes the "home" region from the town center's corner tile** (`events.ts:118`). If that tile were ever unwalkable, label −1 would match every water edge tile. It is 0 of 960 starts today, but it is latent; use the ring that `hasAccess` uses.
3. **Extra ticks after victory.** `controller.ts:128–129` keeps running the rest of the frame's tick batch (up to 39 ticks) after `gameOver` has paused the game.
4. **Lost trade and cache goods are not toasted.** They are logged as `warning` (`events.ts:241`, `:415`), but GAME_DESIGN §6.1 asks for a toast.
5. **`stats.births` and the `settlerBorn` event are never produced.** The design has no births, so this is dead contract.
6. **Save size.** A large map at day 30 is 235 KB per slot, and 58% of that is the four tile layers. All five keys together are 1.17 M chars, comfortably under the about 5 M-char quota. Autosave costs 14.5 ms, which is a one-frame hitch at each new day. Consider RLE or base64 for the tile layers if maps grow.
7. **`MOODLET_LABELS[id]`** (`src/ui/lib/settlerInfo.ts:133`, `:138`) indexes a plain object with save-controlled ids. An id like `constructor` resolves to a function. Use `Object.hasOwn`.

---

## Tests

### TEST-1 (major, counted in MAJ-1 and CRIT-1): No regression coverage for the two big bugs

No test covers starvation recovery when food is sitting in buffers. No test saves the game after a fatal wolf attack.

**Fix (QA):** add the probes described in CRIT-1 and MAJ-1.

### TEST-2 (part of MIN-2): `assertInvariants` was weakened instead of fixing the cause

It only fails when stock is above the cap **and** above 1000.

### TEST-3 (minor): Invariants assert too little

Missing checks:

- Workers per building ≤ `maxWorkers`.
- Builders ≤ `maxBuilders`.
- No two gatherers on the same tile.
- `delivered ≤ required`.
- A resource conservation ledger (my probe found no duplication, so it would pass today and catch regressions).

### TEST-4 (minor): The soak only bounds outcomes from below

It asserts survival, pop ≥ 8 and the objectives. It does not bound the pace: no victory-day floor, and no deaths ≤ N for harsh.

### TEST-5 (minor): e2e covers M1–M3 flows only

There is nothing for:

- decision cards (accept or decline, countdown);
- objective and unlock toasts;
- the victory and game-over overlays, including "Keep playing";
- cancel and demolish from the inspector;
- the warnings strip.

---

## Things verified as correct

- **The resource ledger** (stock + buffers + delivered + carried + held tools) over 6 × 60-day runs, checked every tick:
  - It shows **no duplication**. The only unrecorded inflows are intended: supply cache, trader, demolish refunds.
  - Losses are the cap losses in MIN-1, plus tool breakage and the `toolsBreak` event.
- **Cancelling mid-haul conserves materials**, and killing a carrier conserves its load (both diffs exactly 0).
- **No frozen settlers** (other than CRIT-1) and **no thrash:** at most 6–12 task starts per settler-hour. Path failures: 0–5 per 60-day game. Idle share is 1.1–2.0%.
- **Save/load is deterministic** with a pending trader decision, a pending festival decision, sites and hauls in flight: two runs over 3 days are byte-identical. No determinism hazards in `src/sim`: no `Math.random` or `Date`, `damageLog` keys are string-ordered, and the WeakMap caches rebuild correctly.
- **Victory, acknowledge and sandbox** work. Lose triggers on pop 0. A demolished workplace releases its worker, who moves on.
- **Start sites:** 480 starts (4 presets × small and large × 60 seeds) can all place a farm, house, well and lumber camp. In 960 starts the town center corner tile is always walkable.
- **Performance:** 0.33 ms per tick at 30 settlers on a large map, 0.9 ms per HUD snapshot, `canPlaceBuilding` around 0.2 ms.
- **Renderer lifecycle:**
  - Input listeners are removed on destroy.
  - Particle and float-text pools are fixed-size.
  - Chunks are destroyed on `setWorld`, and eviction is bounded.
  - The texture set is destroyed after the app.
  - Click picking goes settler, then building, then tile.
- **No HTML injection sinks.** Names and log text render as React text. Save strings are length-capped by the validator.
- **M1 findings fixed:** MAJ-1 through MAJ-5 (semantic validator, fault isolation, settler-side assignments, the repair kind, the contract additions) and MIN-1 through MIN-4. MIN-10 and MIN-14 are still open (MIN-7 and MIN-8 above).

---

## Prioritized fix list

### Simulation Engineer (`src/sim`)

1. **CRIT-1:** end or skip rest when regeneration is impossible; let critical hunger eat from food buffers. Add regression tests.
2. **MAJ-1:** clear `activeEvents[].targetId` in `removeSettler`. Add the wolves-death save test.
3. **MAJ-2:** add a food and water shortage bonus to emptying buffers, and lower `minLoad` for food and water during a shortage.
4. **MAJ-3:** apply the growth retune from the Game Designer (base chance, winter pause, or a `winter` gate on `thriving`).
5. **MIN-1 and MIN-2:** refuse instead of destroying goods at the cap; clamp on storage demolish; restore the strict invariant.
6. **MIN-3, MIN-4, MIN-5, MIN-6.**
7. **Nits 1, 2, 4 and 5.**

### Game Designer (`docs/GAME_DESIGN.md`, `balance.ts` values)

1. Amend the §5.5 rest rule and the §5.4 haul rule (CRIT-1, MAJ-2).
2. Retune §8 growth to hit population 12–16 at day 20 and victory at day 22–30 (MAJ-3).

### Graphics Engineer (`src/render`)

1. **MIN-10:** drive indoor drawing from a structured `Activity` field instead of the label text. This needs a contract change from the Lead.

### UI/UX Engineer (`src/ui`, `src/store`)

1. **Nit 7:** use `Object.hasOwn` in `MOODLET_LABELS`.
2. A toast for goods lost to a full storage, if the sim emits an event for it (nit 4).

### Lead (`src/game`, configs, contract)

1. **MAJ-1 hardening:** make `saveToSlot` repair dangling references instead of refusing.
2. **MIN-9:** gate the debug handle.
3. **MIN-8:** ghost refresh. **MIN-7:** cheap save listing.
4. **MIN-10:** the contract field. **Nit 3.**

### QA Engineer (`tests`, `e2e`)

1. **TEST-1:** CRIT-1 and MAJ-1 regressions.
2. **TEST-3:** stronger invariants and a ledger.
3. **TEST-4:** pace bounds in the soak.
4. **TEST-5:** e2e for decisions, victory and game over, cancel and demolish.

**Release readiness:** block on CRIT-1, MAJ-1 and MAJ-2. These are small, local sim changes plus tests. MAJ-3 is a balance pass and should land before M8.
