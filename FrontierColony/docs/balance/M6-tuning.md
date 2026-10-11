# M6 Tuning: Starvation Recovery, Famine Hauling, Growth Pacing

- **Owner:** Game Designer (model `claude-opus-5-5`)
- **Answers:** `docs/reviews/M5-review.md`, findings CRIT-1, MAJ-2 and MAJ-3
- **Design source:** `docs/GAME_DESIGN.md`, amended in §4.1, §4.3, §5.2, §5.3, §5.4, §5.5, §8, §10, §11 and §14, and the §16 appendix. Every amendment is tagged "M6".
- **Who applies it:** the Simulation Engineer, in `src/sim`. Nothing in `src/` was edited by the Game Designer.

## 1. Constant changes in `src/sim/balance.ts`

| Constant | Old | New | Why |
|---|---|---|---|
| `GROWTH.baseChance` | 0.5 | **0.4** | MAJ-3: growth was about 1.0–1.4 settlers/day |
| `GROWTH.pairChance` | 0.3 | **0.2** | MAJ-3 |
| `GROWTH.pausedInWinter` | (new) | **true** | MAJ-3: no growth check in winter (rule R6) |
| `EVENTS.wanderer.p` | 0.07 | **0.06** | MAJ-3 |
| `EVENTS.wanderer.pairChance` | 0.4 | **0.3** | MAJ-3 |
| `EVENTS.wanderer.notWinter` | (new) | **true** | MAJ-3: the wanderer event is not eligible in winter (rule R6) |
| `VICTORY.requiresObjective` | (new) | **`'winter'`** | MAJ-3: no victory before day 21 (rule R7) |
| `DIFFICULTY.harsh.growthMult` | 0.8 | **1.0** | Harsh growth is already throttled by its food and water gates. With 0.8, only 17/32 harsh games won by day 50. |
| `AI.haul.shortageMult` | (new) | **1.0** | MAJ-2: urgency for food and water buffers (rule R4) |
| `AI.haul.lowStockDays` | (new) | **1** | MAJ-2: below 1 day of supply, the minimum load drops (rule R5) |
| `AI.haul.lowStockMinLoad` | (new) | **1** | MAJ-2 (rule R5) |
| `AI.haul.toolsMinLoad` | (new) | **1** | MIN-4: tools are hauled one at a time |
| `AI.famine.stockDays` | (new) | **0.5** | MAJ-2: the famine rule (rule R3) |
| `OBJECTIVES[thriving].description` | "Reach 20 settlers with an average happiness of at least 50." | **"Survive your first winter, then reach 20 settlers with an average happiness of at least 50."** | R7 |

Unchanged on purpose:

- `GROWTH.perExtraBed` 0.1
- `GROWTH.maxExtraBeds` 3
- `GROWTH.minFoodDays` and `GROWTH.minWaterDays` 2
- `GROWTH.minAvgHappiness` 50
- `AI.haul.minLoad` 6
- `AI.critical.*`
- `HEALTH.*`

The growth chance per daily check becomes `(0.40 + 0.10 × min(freeBeds − 1, 3)) × growthMult`, which is 0.40–0.70 on normal.

## 2. Rule changes to code

Your working tree (the uncommitted `src/sim` diff, read on 2026-10-11) already does much of this. The "Delta" lines say what is left.

### CRIT-1: starvation recovery

**R1: rest only while it can heal** (§4.3, §5.5)

- Define `canRegenerate(s)` = `s.needs.hunger ≥ HEALTH.regenMinHunger` **and** not (`s.status.dehydrated` with no drinkable water).
- "No drinkable water" means `stock.water < 1` and no completed well has `output.water ≥ 1`.
- `criticalResponse` returns `'rest'` only when `health < AI.critical.healthRestBelow && canRegenerate(s)`.
- An ongoing `rest` ends (`wakeUp`, then a normal decision) when `health ≥ HEALTH.restUntil` **or** `!canRegenerate(s)`.
- Sickness does **not** block rest.
- **Delta:** your `canRegenerate` must also count well buffers as drinkable water.

**R2: emergency meals and drinks** (§4.1, §5.2)

- **Meals:** while `stock.food < 1`, a completed building with `output.food ≥ 1` is an eating point. This applies to the normal `eat` candidate and to the critical one. The meal takes 1 food from that buffer and 1 water from the stock, if the stock has any.
- **Drinks:** while `stock.water < 1`, a completed well with `output.water ≥ 1` serves `drink` from its buffer.
- **Reservations:** the unit is reserved when the target is chosen. Count `eat`/`drink` tasks aimed at the building in `claimedFromOutput`, so a hauler cannot empty the last unit out from under the eater.
- **Delta:** `foodSource` and the meal-from-buffer step are done. Still to do:
  - drinks from well buffers;
  - the reservation of the eater's unit;
  - `drink` availability uses "no edible food anywhere" instead of `stock.food == 0`.

### MAJ-2: getting famine food to the larder

**R3: famine rule** (§5.3)

- For `r` ∈ {food, water}, while `stock[r] < pop × 2 × AI.famine.stockDays` (= `pop`), production work at a building whose `output[r] ≥ 1` is unavailable.
- A worker already there stops quietly at its next tick.
- **Delta:** your `stock < pop` check is the same threshold. Read it from the constant.

**R4: haul urgency** (§5.4)

- For food and water buffers: `taskBonus = 25 × fill + (fill ≥ 1 ? 15 : 0) + AI.haul.shortageMult × shortageBonus(r)`.
- **Delta:** you use ×1 already. Read it from the constant.

**R5: minimum haul load** (§5.4)

- The rule:
  - `minLoad(r)` = `AI.haul.lowStockMinLoad` (1) for food and water while `stock[r] < pop × 2 × AI.haul.lowStockDays` (under 1 day of supply).
  - `minLoad(r)` = `AI.haul.toolsMinLoad` (1) for tools.
  - `minLoad(r)` = `AI.haul.minLoad` (6) otherwise.
- **Delta:** your `minLoadFor` drops to 1 whenever `shortageBonus > 0`. With the autumn target of 8 days, that means 1-unit trips all autumn, because the urgency bonus is added regardless of load size. Change it to the 1-day threshold.

### MAJ-3: pacing

**R6: winter pause** (§8, §10)

- `populationCheck` returns early when `season === 'winter'` and `GROWTH.pausedInWinter` is set.
- `wanderer` is not eligible in winter when `EVENTS.wanderer.notWinter` is set.
- Wanderer auto-join (free beds, no decision) stays as it is outside winter.

**R7: victory gate** (§11)

- The `thriving` condition also requires `state.progress.objectivesDone.includes(VICTORY.requiresObjective)`.
- Objectives are checked in display order and `winter` comes before `thriving`, so victory can fire on the same hourly check that completes `winter` (day 21, 00:00–01:00).

### UI note (optional, UI/UX Engineer)

In winter, show an info chip in the warnings strip: "Winter: no newcomers until spring."

## 3. Acceptance targets

### Regression probes (QA, from the review)

1. **CRIT-1, probe 1.**
   - Setup: normal, spring, 1 complete farm with 24 food in its buffer; stock food 0, water 40; all 5 settlers at health 20 and hunger 5.
   - Pass: **5/5 alive after 48 game hours**.
   - Pass: at no hourly sample is a settler in `rest` while `canRegenerate` is false.
2. **CRIT-1, probe 2 matrix.**
   - Setup: normal; 1, 2 and 3 working farms; stock food 0, water 40; the five start states from the review (30/100, 8/45, 5/35, 3/30, 10/26).
   - Pass: **every cell 5/5 alive after 72 h**.
3. **Thirst variant.**
   - Setup: stock water 0, one well with 8 water in its buffer, 5 dehydrated settlers with food in stock.
   - Pass: every settler drinks within 3 h, and no thirst deaths in 48 h.
4. **MAJ-2.**
   - Setup: normal; stock food 0; 2 farms with buffers of 18 and 12; 6 settlers at hunger 30; default priorities.
   - Pass: within 6 game hours, `stock.food + food eaten ≥ 20`.
   - Pass: at every hourly sample, no settler has a `work` task at a farm with `output.food ≥ 1` while `stock.food < pop`.
5. **No 1-unit thrash.**
   - Setup: a 30-day normal soak.
   - Pass: haul trips that carry fewer than 6 food or water happen only while that resource's stock is under `pop × 2`.

### Pacing (soak)

**Setup:**

- 4 presets × seeds `s1`…`s8`, small map (`DEFAULT_NEW_GAME_OPTIONS`).
- Build order: the soak's `MONTH` list plus `{day: 24, farm}` and `{day: 26, house}`, placed with `placeNearTown` every 100 ticks.
- Run until victory or day 50.

| Check | Target | Measured (M6 numbers + your working-tree fixes) |
|---|---|---|
| normal: earliest victory | ≥ day 21 in every game (hard floor, R7) | 21.0 (min) |
| normal: median victory day | 24–29 | 26.3 |
| normal: won by day 32 | ≥ 28/32 | 30/32 (latest 41.3) |
| normal: median pop on day 20 | 13–17 | 15 (p10 12, p90 19) |
| normal: losses | 0/32 | 0/32 |
| harsh: losses by day 50 | ≤ 5/32 | 3/32 |
| harsh: won by day 50 | ≥ 20/32 | 25/32 (median day 42.3) |
| relaxed: median victory day | 21–25 | 22.3 |

The existing 30-day soak (`seed soak-b`) should add `expect(victoryDay ?? Infinity).toBeGreaterThanOrEqual(21)` (TEST-4).

## 4. Method and data

**Method:**

- I snapshotted `src/sim` twice into a scratch directory, compiled each with `tsc` to CommonJS, and ran it headless with the soak player logic:
  - committed HEAD `c1d527e`, for the baselines;
  - the engineer's uncommitted working tree, which has the CRIT-1 and MAJ-2 fixes.
- Each candidate tuning was applied by mutating the exported balance objects at runtime:
  - `baseChance`, `perExtraBed`, `pairChance` and wanderer `p` were set to 0 in winter;
  - `VICTORY.population` was held at 999 until the `winter` objective was done.
- Each configuration ran 32 games.

**Results.** Pop and victory columns are p10/p25/median/p75/p90. "C" is the shipped tuning; A and B are the rejected alternatives.

| Configuration | Difficulty | Pop d10 | Pop d15 | Pop d20 | Victory day | Won / lost |
|---|---|---|---|---|---|---|
| Baseline (HEAD) | normal | 10/11/12/12/13 | 15/15/17/18/19 | 18/20/23/24/25 | 15.3/16.3/17.3/19.3/21.3 | 32 / 0 |
| Baseline (HEAD) | harsh | 5/5/6/7/8 | 5/5/7/8/10 | 6/7/10/12/13 | 25.3/30.3/31.3/35.3/36.3 | 16 / 13 |
| Baseline + fixes | harsh | 5/5/6/7/8 | 5/6/7/9/9 | 6/7/9/10/12 | 28.3/31.3/36.3/38.3/44.3 | 27 / 3 |
| A: base 0.45, winter pause, gate | normal | 9/10/11/12/13 | 14/14/16/17/18 | 14/15/17/18/19 | 21.3/22.3/24.3/26.3/28.3 | 32 / 0 |
| B: base 0.40, maxExtraBeds 2 | normal | 9/9/10/11/12 | 11/13/14/16/16 | 11/13/15/16/17 | 24.3/26.3/28.3/30.3/31.3 | 32 / 0 |
| **C (shipped) + fixes** | normal | 8/9/10/11/12 | 11/13/14/16/17 | 12/13/15/17/19 | 22.3/23.3/26.3/28.3/30.3 | 32 / 0 |
| C + fixes, harsh growthMult 0.8 | harsh | 5/5/6/7/7 | 5/6/7/8/9 | 5/6/7/8/9 | 35.3/42.3/45.3/46.3/48.3 | 17 / 3 |
| **C + fixes, harsh growthMult 1.0 (shipped)** | harsh | 5/5/6/7/8 | 5/6/7/8/9 | 5/6/7/9/9 | 32.3/35.3/42.3/45.3/47.3 | 25 / 3 |
| C + fixes, harsh 1.0 | relaxed | 10/11/12/13/13 | 15/16/16/18/19 | 16/16/18/19/21 | 21/21.3/22.3/24.3/25.3 | 32 / 0 |

**Harsh diagnosis:**

- I sampled 6 games at 08:00 outside winter. The failing growth gate was mostly **water** (water < pop × 4), then food, then happiness (average around 50). Beds rarely blocked growth.
- So harsh pace depends on the player building wells and farms, not on the growth constants.
- Giving the bot two extra wells and a farm did not change the outcome much (10/32 won by day 50 at growthMult 0.8).
- I'm leaving harsh at about 40 days to victory as the intended "hard" experience.
- If the lead wants harsh around day 32–36, the lever is `GROWTH.minWaterDays` / `minFoodDays` for harsh only, not the base chance.

**Caveat:** the runs used the working tree's current `minLoadFor` (1 whenever there is any shortage), not R5's 1-day threshold. R5 only reduces small hauls, so I expect no pacing change. QA's pacing soak confirms it.
