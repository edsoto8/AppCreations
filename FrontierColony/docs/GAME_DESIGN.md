# Frontier Colony — Game Design

Owner: Game Designer. Status: M1 baseline. Every number in this document is collected in the
[Balance constants appendix](#16-balance-constants-appendix). The Simulation Engineer transcribes that block into
`src/sim/balance.ts`. When text and appendix disagree, the appendix wins and the text is a bug.

Conventions used throughout:

- Ids in `code` are the contract ids from `src/sim/types.ts`. Where this design needs an id or field the contract
  does not have yet, it is marked **[contract +]** and listed in [Appendix B](#appendix-b-contract-additions-requested).
- "Hour" means in-game hour. All rates are per in-game hour unless stated. The sim applies a rate per tick as
  `rate × GAME_HOURS_PER_TICK`.
- "wh" = worker-hour: one settler working on-site for one in-game hour at multiplier 1.0.
- `clamp01(x)` = `min(1, max(0, x))`. `pop` = living settlers currently in the colony.
- Difficulty ids are the contract's `relaxed` / `normal` / `harsh`, shown to the player as Easy / Normal / Hard.
- All randomness uses the sim RNG (`GameState.rng`), so a seed plus the same commands reproduces a game exactly.

---

## 1. Pillars and player fantasy

**Fantasy:** you are the unseen founder of a frontier settlement. You decide *what* gets built and *where*, and
what matters most this season. Five named settlers with quirks decide *how*: they wake at dawn, walk to the fields,
chat by the campfire at dusk, and grumble through storms. You watch a diorama come alive and steer it through
its first winter.

Pillars:

1. **A living diorama.** Every settler is always visibly doing one legible thing with a text label ("Chopping
   wood", "Walking to Farm", "Sleeping by the campfire"). The day/night rhythm and the seasons are readable at a
   glance. It is pleasant to watch at 1x with no input.
2. **Steer, don't micromanage.** The player places buildings and sets seven job priorities. There is no direct
   unit control. Good placement (short walks) and good priorities are the skill.
3. **Pressure you can read before it hurts.** Shortages, winter and homelessness are forecast with numbers
   ("Food: 3.2 days left") and warnings well before anyone dies. Failure is always explainable.
4. **Small stories.** Names, traits, moods, deaths and a handful of events give each colony a story worth retelling.

### Session arc (at 1x; a day is 3 real minutes, a season 15 minutes, a year 60 minutes)

| Real time | In-game | What the player experiences |
|---|---|---|
| 0–10 min | Days 1–3, spring | Places a farm, a well, a house (one founder sleeps by the campfire until it is up) and a lumber camp. Watches the first builds, the first night and the first meals. Completes objectives 1–4 and unlocks storage. |
| 10–30 min | Days 4–10, late spring and summer | Starting tools wear out (around day 5), so production visibly slows. Builds a mine and a workshop, then the first storage. First newcomers arrive and the first events fire (trader, wolves, drought). Population 7–10. |
| 30–60 min | Days 11–20, autumn and winter | The "Winter is coming" forecast appears. Food target rises to 8 days of stock, so settlers lean into farming. A harvest festival decision comes up. Then winter: fields go fallow, snow, cold snaps. Homeless settlers suffer. The colony either has its larder full or starts losing people. Population 12–16 by the end of winter. |
| 60–90 min | Year 2 spring | Expansion toward 20 settlers and the "Thriving Frontier" victory. The game continues as a sandbox after victory. |

---

## 2. Time model

| Item | Value |
|---|---|
| Sim tick | Fixed, `TICKS_PER_SECOND = 10` at 1x (architect constant). Speeds 1x / 2x / 4x run 10 / 20 / 40 ticks per real second. |
| Real seconds per in-game day at 1x | **180** (3 minutes). One hour = 7.5 s. |
| In-game hours per tick | `24 × 0.1 / 180 = 0.013333…` (0.8 game minutes). |
| Start | Day 1, 06:00, spring, weather `clear` (12 h). |
| Season length | 5 days. Spring = days 1–5, summer 6–10, autumn 11–15, winter 16–20, then spring again (day 21 = year 2). |

`season = SEASONS[floor((day − 1) / 5) mod 4]`.

### Day phases

| Phase | Hours | Outdoor work light multiplier | Notes |
|---|---|---|---|
| dawn | 05:00–07:00 | 0.85 | Settlers wake at 05:00. |
| day | 07:00–18:00 | 1.00 | |
| dusk | 18:00–20:00 | 0.85 | Socializing peaks (dusk bonus). |
| night | 20:00–05:00 | 0.60 | Everyone sleeps unless a need or a trait says otherwise. Walk speed ×0.9. |

"Outdoor work" means the job categories `farming`, `woodcutting`, `mining`, `water` and `building`.
`crafting` is indoor and ignores light and weather. `hauling` has no work rate; only walk speed applies to it.

Each settler has a **personal night window** used by the sleep score and the wake rule: 20:00–05:00 by default,
00:00–08:00 for `nightOwl`, 19:00–04:00 for `earlyBird`.

### Seasons

| Season | Farm growth | Energy decay | Tree regrowth | Weather table |
|---|---|---|---|---|
| spring | ×1.00 | ×1.0 | on | warm |
| summer | ×1.25 | ×1.0 | on | warm (drought possible) |
| autumn | ×1.00 | ×1.0 | on | warm |
| winter | ×0 (fields fallow, farm jobs unavailable) | ×1.1 | off | winter |

### Scheduled daily checks (in this order when they share an hour)

- 00:00: tree regrowth; daily counters reset.
- 08:00: population growth check, then the daily random event roll.
- 14:00: wildfire roll, only while a drought is active.

---

## 3. Settlers

### 3.1 Founders and spawning

- **5 founders** spawn on walkable tiles adjacent to the town center.
- Initial needs: hunger `80 ± 10`, energy `90 ± 10` (uniform integer offsets), happiness 65, health 100.
- No gender field. UI text uses the settler's name or "they".
- Appearance: random palette indices (architect's `Appearance`).

**Name generation.** `firstName + " " + lastName`. Pick a first name not used by any living or dead settler of
this colony while one is available, otherwise any. Re-roll the surname until the full name is unique.
These pools replace the placeholders in `src/sim/constants.ts`:

First names (40): Abel, Ada, Amos, Annie, August, Beau, Bessie, Calvin, Clara, Cody, Cora, Dakota, Della, Eli,
Etta, Ezra, Flora, Gus, Hattie, Hank, Hazel, Ira, Jesse, June, Levi, Lottie, Mae, Mattie, Ned, Nell, Oren, Opal,
Pearl, Reuben, Rosa, Silas, Tess, Wade, Willa, Wyatt.

Surnames (30): Abernathy, Barlow, Blackwood, Bramble, Calloway, Cartwright, Colter, Crane, Dawson, Eastwood,
Fairbanks, Garrett, Hale, Hollister, Ingram, Jessup, Keller, Langley, McCrae, Merritt, Noble, Pickett, Redford,
Sawyer, Shelby, Tanner, Thornton, Walker, Whitlock, Yates.

### 3.2 Skills

Skills (contract `SkillType`): `farming`, `woodcutting`, `mining`, `construction`, `hauling`, `crafting`.
Levels are integers 0–10 (`SKILL_MAX`).

| Activity | Skill used |
|---|---|
| farm (and the optional fishing dock) | farming |
| gather wood | woodcutting |
| mine stone | mining |
| build, repair, supply construction | construction (build/repair); hauling (supply) |
| haul | hauling |
| fetch water (well) | hauling (hauling buckets) |
| craft tools | crafting |

**Speed:** `skillMult(level) = 0.75 + 0.05 × level`, so level 0 gives 0.75, level 5 gives 1.00 and level 10 gives
1.25.
**Carry capacity:** `10 + haulingLevel` units (10–20).

**Spawn rolls** (founders and newcomers):
1. Every skill rolls a uniform integer 1–4.
2. One random skill is the *specialty*. It is set to a uniform integer in the difficulty's specialty range
   (normal 5–7, relaxed 6–8, harsh 4–6).
3. A different random skill is the *secondary*. It is set to `max(current, uniform 3–5)`.
4. Founder guarantee: founder #1's specialty is `farming`, #2's is `construction`, #3's is `woodcutting`.
   #4 and #5 are random.
5. Newcomers get `+1` to their specialty per full 5 days elapsed, up to `+3`, capped at 10.

An average non-specialty skill is 2.5, which gives a multiplier of **0.875**. The balance proof uses this value.

**Growth from practice:** each hour of on-site work grants 1 XP in the skill used (scaled by the per-tick amount).
Reaching level `L+1` takes `10 × (L + 1)` XP, so level 2→3 takes 30 h (about 3 working days) and 5→6 takes 60 h.
XP carries over on level-up. No skill decay. **[contract +]** `Settler.xp: Record<SkillType, number>`.

### 3.3 Personality traits

Each settler rolls **1 trait (60%) or 2 traits (40%)**. Traits come in exclusive pairs and a settler never has
both traits of a pair. Pairs: hardworking/lazy, cheerful/gloomy, glutton/frugal, tough/frail, nightOwl/earlyBird,
sociable/loner, nimble/clumsy. Among the 5 founders there is at most one `lazy` and at most one `gloomy`
(re-roll if violated).

| Id | Name | Mechanical effect | Tooltip |
|---|---|---|---|
| `hardworking` | Hardworking | Work speed ×1.15; energy decay ×1.10; all work scores +5 | "Puts in an honest day and then some. Works 15% faster but tires sooner." |
| `lazy` | Lazy | Work speed ×0.85; energy decay ×0.90; all work scores −5; wander score +15 | "Never met a hammock they didn't like. Works 15% slower." |
| `cheerful` | Cheerful | Happiness baseline +8 | "Sees the bright side of mud. Happiness +8." |
| `gloomy` | Gloomy | Happiness baseline −8 | "Expects the worst and is rarely disappointed. Happiness −8." |
| `glutton` | Glutton | Hunger decay ×1.25; "Well fed" moodlet +4 while hunger ≥ 70 | "Eats a quarter more, and loves a full belly." |
| `frugal` | Frugal | Hunger decay ×0.85 | "Gets by on little. Eats 15% less." |
| `tough` | Tough | Health damage taken ×0.7; sickness lasts half as long; ignores weather mood penalties | "Frontier-hardened. Shrugs off cold, rain and fever." |
| `frail` | Frail | Health damage taken ×1.3; health regeneration ×0.75; counts double when picking who catches sickness | "Catches every cold going. Takes 30% more damage." |
| `nightOwl` | Night Owl | Personal night window 00:00–08:00; no light penalty at dawn, dusk or night | "Comes alive after dark. Works at night without penalty." |
| `earlyBird` | Early Bird | Personal night window 19:00–04:00; no light penalty at dawn | "Up before the rooster. Works the dawn at full speed." |
| `sociable` | Sociable | Socialize score +15; Socialized moodlet +12 instead of +6; "Lonely" −5 if not Socialized in the last 24 h | "Needs company. Gets twice the joy from a chat." |
| `loner` | Loner | Happiness baseline +4; socialize score −20; never gets Socialized or Lonely | "Happiest left alone." |
| `nimble` | Nimble | Walk speed ×1.20 | "Light on their feet. Walks 20% faster." |
| `clumsy` | Clumsy | Walk speed ×0.90; construction and crafting speed ×0.85 | "All thumbs. Builds and crafts 15% slower." |

These descriptions replace the placeholder `TRAIT_DEFS` text.

---

## 4. Needs model

All needs are 0–100 with **100 = best** (contract `Needs`). Decay rates below are for `normal`. Hunger and energy
decay are multiplied by the difficulty `needDecayMult` and by traits. Health damage is multiplied by
`healthDamageMult` and by traits.

### 4.1 Hunger, food and water

- **Decay:** 4.0 per hour at all times (including asleep), which is 96 per day.
- **Meal (`eat`):** at an eating point (town center or any completed storage). Takes 0.5 h. When it ends it
  consumes **1 food** (+48 hunger) and **1 water** if `water ≥ 1`. If there was no water, the settler becomes
  **dehydrated**. Eating is only available when hunger < 50, so a meal never overflows (50 + 48 < 100).
- **Daily consumption per settler:** 96 / 48 = **2.0 food and 2.0 water per day** (glutton 2.5, frugal 1.7).
- **Drink (`drink`):** at an eating point or a completed well. Takes 0.15 h and consumes 1 water. It clears
  dehydrated. If `food == 0`, it also gives +8 hunger, with a 4 h cooldown on that use (the starvation fallback
  slows hunger loss from 4/h to a net 2/h).
- **Dehydrated** status: health −1.5/h, moodlet −8. Cleared by any drink or by a meal that included water.
  **[contract +]** `Settler.status.dehydrated: boolean`.
- **Rain barrels:** while the weather is `rain` or `storm`, the town center adds +0.5 water/h to the stock.

### 4.2 Energy and sleep

- **Decay while awake:** 4.0/h while working (including walking to work and hauling). 3.0/h while eating,
  drinking, socializing or wandering. Multiplied by season (winter ×1.1), weather (storm ×1.15, snow ×1.2),
  `coldSnap` ×1.3 and traits.
- **Sleep restore:** +9/h in a bed (house or town center bed). +6/h outdoors ("bedroll by the campfire", a free
  walkable tile within 3 tiles of the town center).
- **Wake rule:** sleep ends when `energy ≥ 100` and the time is outside the settler's night window. A nap (sleep
  that started in the day phase) ends when `energy ≥ 90`. Critical hunger (< 15) wakes a sleeper.
- **Collapse:** energy < 5 makes the settler sleep on the spot immediately (counts as outdoors).
- **Typical day:** awake 05:00–20:00 (15 h × 4 = −60), asleep 20:00–05:00 in a bed (9 h × 9 = +81, capped at
  100). Energy cycles between about 40 and 100. A homeless settler needs 10 h outdoors and wakes around 06:00.

### 4.3 Health

| Effect | Rate | Condition |
|---|---|---|
| Regeneration | +1/h | hunger ≥ 25, energy ≥ 20, not dehydrated, not sick |
| Regeneration in bed | +3/h (replaces +1) | asleep in a bed; hunger ≥ 25, not dehydrated, not sick |
| Starving | −2.5/h | hunger < 10 |
| Dehydrated | −1.5/h | status |
| Exhausted | −1/h | energy ≤ 0 |
| Sick | −1/h | status (event), no regeneration |
| Cold night | −1/h (−2/h during `coldSnap`) | sleeping outdoors in winter |
| Wolf attack | −35 instant | event |

`frail` regeneration is ×0.75. Damage is multiplied by `healthDamageMult × traitMult` (tough 0.7, frail 1.3).

- **Health < 50:** work speed ×0.8 and moodlet "Hurt" −10.
- **Health < 25 (critical):** the settler rests in their bed (or by the campfire) until health ≥ 50. This is
  activity `resting`, which counts as sleep for restore rates.
- **Death:** health ≤ 0. The cause is the largest damage source over the last 6 h: "starvation", "thirst",
  "sickness", "exhaustion", "cold" or "wolves". **[contract +]** `Settler.status.damageLog` (rolling per-cause
  totals for that 6 h window).

**Starvation timeline:** food runs out with average hunger around 60. With water available, the drink fallback
gives a net −2/h, so hunger reaches 10 after 25 h. Then −2.5/h takes a healthy settler to 0 in 40 h. **First death
is about 65 h (2.7 days) after food hits 0** (sooner without water, because dehydration damage stacks). That is the warning window the UI must
make obvious.

### 4.4 Happiness and mood

Happiness drifts toward a target at **4 points per hour** in either direction. It starts at 65.

`target = clamp(50 + traitBaseline + Σ active moodlets, 0, 100)`

**[contract +]** `Settler.moodlets: {id, value, hoursLeft | null}[]` (null = state moodlet, re-evaluated hourly).

| Moodlet id | Value | Duration | Trigger |
|---|---|---|---|
| `sleptInHouse` | +6 | 18 h | Woke from bed sleep |
| `sleptOutdoors` | −10 | 18 h | Woke from outdoor sleep (replaces `sleptInHouse`) |
| `sleptOutdoorsCold` | −15 | 18 h | Same, in winter (replaces `sleptOutdoors`) |
| `hungry` | −8 | state | hunger < 25 |
| `starving` | −20 | state | hunger < 10 (replaces `hungry`) |
| `dehydrated` | −8 | state | dehydrated status |
| `tired` | −6 | state | energy < 20 |
| `hurt` | −10 | state | health < 50 |
| `sick` | −8 | state | sick status |
| `fineWeather` | +3 | state | weather `clear` and phase is not night |
| `rain` / `storm` / `snow` | −3 / −8 / −3 | state | current weather (not applied to `tough`) |
| `socialized` | +6 (sociable +12) | 12 h | Finished socializing with another settler present |
| `lonely` | −5 | state | sociable only, no `socialized` in the last 24 h |
| `overworked` | −6 | state | ≥ 12 h worked since last waking |
| `colonistDied` | −12 | 72 h | Any settler died (stacks up to 3) |
| `colonistLeft` | −5 | 48 h | A settler deserted (stacks up to 2) |
| `newcomer` | +4 | 24 h | A newcomer joined (stacks up to 2) |
| `fullLarder` | +5 | state | food ≥ pop × 10 (5 days) and water ≥ pop × 6 (3 days) |
| `emptyLarder` | −8 | state | food == 0 |
| `wellFed` | +4 | state | glutton only, hunger ≥ 70 |
| `festival` | +15 | 48 h | Harvest festival accepted |
| `wolves` | −5 | state | `wolves` event active |

Trait baselines: cheerful +8, gloomy −8, loner +4.

Typical target: a housed settler on a clear day with a full larder sits at 50 + 6 + 3 + 5 = **64**, or **70**
after chatting at dusk. A homeless settler sits at 50 − 10 + 3 + 5 = **48** (Unhappy). Housing is the main
happiness lever, and growth needs average happiness ≥ 50.

**Mood bands:**

| Band | Happiness | Work speed | Other |
|---|---|---|---|
| Inspired | ≥ 80 | ×1.10 | |
| Content | 50–79 | ×1.00 | |
| Unhappy | 30–49 | ×0.90 | |
| Miserable | 15–29 | ×0.75 | Work scores ×0.85. Each hour, a 5% chance to sulk: wander for 2 h, which cannot be interrupted except by a critical need. |
| Breaking | < 15 | n/a | Refuses all work (work candidates unavailable). After **48 continuous hours** in this band (`desertionHours` by difficulty) the settler leaves the colony: walks to the nearest map edge and is removed. Log: "{name} has given up on the frontier and left." **[contract +]** `Settler.status.breakingHours`. |

---

## 5. Autonomous behavior (utility AI)

### 5.1 Decision loop

Each tick, for each settler:

1. Update needs, statuses and moodlets.
2. **Critical interrupt check** (see 5.5). If it fires and the current activity is not already the response,
   abort the current activity (release reservations and drop carried goods back into the nearest stock or
   building output; materials for a construction site go back to stock) and run `decide()`.
3. If the current activity completed or became invalid (target gone, buffer full, tree felled with no other tree
   in radius, site finished), run `decide()`.
4. Otherwise, if the activity is interruptible and `hoursSinceDecision ≥ reevalInterval` (work 1.0 h, wander
   0.25 h), run `decide()` with the commitment bonus.

Stagger: a settler's first decision happens on tick `id mod 10`, so re-evaluations spread across ticks.

`decide()`:
1. Build all candidates (activity + target) whose availability conditions hold. Use one target per activity
   type: the best-scoring one (for work, consider every building or site with a free slot and keep the best).
2. `score = rawScore + jitter`, with jitter uniform in [0, 4) from the sim RNG.
3. The candidate equal to the current activity and target gets **+15 commitment bonus**.
4. Pick the maximum. Ties go to the earlier entry in the candidate order below.
5. Reserve the target (work slot, tree tile, haul amount, bed) and path to it.

Interruptibility: work, haul, wander and socialize are interruptible at re-evaluation points. Eat, drink and
sleep (including resting) run to completion and can only be broken by a critical interrupt. A haul in progress
is never re-evaluated while carrying (it finishes the delivery first).

### 5.2 Candidate activities and scores

`dist` = octile distance in tiles from the settler to the target. Pathing uses A*; scoring uses the cheap estimate.

| # | Candidate | Available when | Raw score |
|---|---|---|---|
| 1 | `eat` | food ≥ 1, an eating point is reachable, hunger < 50 | `40 + 2.2 × (50 − hunger) − 0.3 × min(dist, 40)` |
| 2 | `drink` | water ≥ 1 and (dehydrated, or (food == 0 and hunger < 40 and drink cooldown elapsed)) | dehydrated: `75`; else same as eat |
| 3 | `sleep` | energy < 90 (or resting, see 5.5) | `1.2 × (90 − energy) + nightBonus − 0.2 × min(dist, 40)`; `nightBonus` = 60 inside the personal night window, else 0 |
| 4 | `socialize` | happiness < 90 and at least one other settler is awake and not working; not `loner` | `20 + 0.5 × max(0, 75 − happiness) + (dusk ? 40 : 0) + (sociable ? 15 : 0) − (socialized active ? 40 : 0)` |
| 5 | work: `farm`, `gatherWood`, `mineStone`, `fetchWater`, `craftTools`, `build` | see 5.3 | `workScore` (5.3) |
| 6 | `haul` | see 5.4 | `workScore` with the `hauling` priority (5.4) |
| 7 | `wander` | always | `12 + (lazy ? 15 : 0)` |

Social activity: walk to the town center and stay 1 h. On completion, if another settler finished or was still
socializing within 4 tiles during the last 0.5 h, grant `socialized`.

### 5.3 Work score

For a work candidate of job category `c` with player priority `p = priorities[c]` (contract `JobCategory`:
`building`, `farming`, `woodcutting`, `mining`, `hauling`, `water`, `crafting`):

```
if p == 0 or mood band is Breaking: unavailable
workScore = PRIORITY_BASE[p]            // 1 → 40, 2 → 55, 3 → 70
          + 2 × skillLevel(c)           // 0..20
          + shortageBonus(c, target)    // 0..25
          + taskBonus(target)           // building sites, 0..30
          + traitWorkBonus              // hardworking +5, lazy −5
          − 0.4 × min(dist, 50)         // 0..−20
          − storageFullPenalty          // −30 if the produced resource is at its stock cap
if mood band is Miserable: workScore ×= 0.85
```

**Shortage bonus** (colony-wide, recomputed once per in-game hour):

| Produces | Formula |
|---|---|
| food (`farm`) | `25 × clamp01(1 − daysFood / foodTargetDays)`, with `daysFood = food / (pop × 2)`. `foodTargetDays` = 3, or **8 in autumn** (winter preparation). |
| water (`fetchWater`) | `25 × clamp01(1 − daysWater / 3)`, with `daysWater = water / (pop × 2)` |
| wood (`gatherWood`) | `15 × clamp01(1 − woodAvailable / 50)` |
| stone (`mineStone`) | `15 × clamp01(1 − stoneAvailable / 30)` |
| tools (`craftTools`) | `20 × clamp01(1 − toolsInStock / toolTarget)`, `toolTarget = max(3, ceil(pop × 0.6))` |

`woodAvailable` / `stoneAvailable` = stock minus materials reserved by construction sites (see 6.6), so
queued buildings pull labor toward wood and stone.

**Task bonus** (building only): +10 for any site; +10 more if it is a house and someone is homeless; +10 more if
it is a farm or well and the matching food or water shortage bonus is > 12.

**Availability of work candidates:**

| Activity | Target | Available when |
|---|---|---|
| `farm` | completed farm with a free worker slot | not winter; output buffer < cap |
| `gatherWood` | lumber camp with a free slot, or the town center forage slot | a forest tile with resource > 0 within the work radius; output buffer < cap |
| `mineStone` | mine with a free slot, or the town center forage slot | a hills/mountain tile with resource > 0 within the radius, standable via a walkable neighbour; buffer < cap |
| `fetchWater` | completed well with a free slot | buffer < cap |
| `craftTools` | completed workshop with a free slot | `toolsInStock < toolTarget` and stock has 3 wood and 2 stone (unreserved) |
| `build` | construction site with fewer builders than `maxBuilders` | `workDone / buildHours < deliveredFraction` (6.6) |

### 5.4 Hauling

Haul candidates (category `hauling`):

- **Empty a building:** a building output with ≥ 6 units of one resource, and stock below cap for that resource.
  `taskBonus = 25 × fill + (fill ≥ 1 ? 15 : 0)`, where `fill = output / outputCap`.
- **Supply a site:** a construction site whose materials are not yet fully delivered (counting goods already being
  carried to it). `taskBonus = +15`.

The hauler reserves `min(carryCapacity, available)`, walks to the source, picks up (0.1 h), walks to the
destination and drops (0.1 h). The destination is the nearest eating point/storage with room, or the site.
One resource type per trip. XP goes to `hauling`.

Production workers whose own building output is full lose their work candidate and naturally pick haul or other
work. Gatherers of wood and stone carry their own output (6.3) and do not need haulers unless they drop at their
camp.

### 5.5 Critical interrupts

| Condition | Response |
|---|---|
| hunger < 15 | `eat` (or `drink` if food == 0) gets +200 and interrupts anything, including sleep |
| energy < 5 | Collapse: sleep on the spot immediately |
| health < 25 | `sleep` as `resting` gets +200 and continues until health ≥ 50 (wake rule suspended) |

Critical interrupts emit `needCritical` (contract `SimEvent`) once per episode for the UI.

### 5.6 Worked example

A settler at 11:00 has hunger 38, energy 70 and farming level 3, and is currently farming (priority 2) on a farm
10 tiles from the town center. Food is 2 days of supply in spring.

- farm: 55 + 6 + 25 × (1 − 2/3) − 0.4 × 0 (already there) + 15 (commitment) = 84.3
- eat: 40 + 2.2 × 12 − 0.3 × 10 = 63.4
- sleep: 1.2 × 20 = 24

The settler keeps farming. Each hour hunger drops by 4. At hunger 28 the eat score is 40 + 48.4 − 3 = 85.4 > 84.3,
so the settler walks to eat at about hunger 28 and comes back around 76. At 20:00 with energy around 40, sleep
scores 1.2 × 50 + 60 = 120, so the settler goes to bed.

### 5.7 Activity labels (UI) and contract `ActivityKind`

| Situation | `ActivityKind` | Label |
|---|---|---|
| Moving toward any target | `walking` | "Walking to {Building name}" / "Walking to the forest" |
| Carrying goods | `carrying` | "Hauling {n} {resource}" / "Supplying {Building name}" |
| eat / drink | `eating` | "Eating" / "Drinking" |
| sleep | `sleeping` | "Sleeping at home" / "Sleeping by the campfire" |
| resting | `resting` | "Resting (hurt)" / "Resting (sick)" |
| socialize | `socializing` | "Chatting at the campfire" |
| wander / sulk | `wandering` | "Wandering" / "Sulking" |
| farm | `farming` | "Tending crops" |
| gatherWood | `chopping` | "Chopping wood" |
| mineStone | `mining` | "Quarrying stone" |
| fetchWater | `fetchingWater` | "Drawing water" |
| craftTools | `crafting` | "Crafting tools" |
| build | `building` | "Building {name}" / "Repairing {name}" |
| nothing valid (should be rare) | `idle` | "Idle" |

---

## 6. Resources and economy

### 6.1 Stock and storage

- Stock is **pooled colony-wide** (`ColonyState.stock`). Goods physically go to the nearest eating point or
  storage, but count toward one shared total.
- **Capacity is per resource** (contract `BuildingDef.storage`): town center **150** per resource, each
  completed storage **+120** per resource. Tools held by settlers do not count.
- Deliveries that would exceed the cap are refused: the haul candidate is unavailable while the stock is at cap,
  and production buffers fill up. Event rewards (trader, cache) that exceed the cap are lost, and a toast says so.
- Building output buffer cap: **30** per building (workshop 10).

### 6.2 Starting stockpile

| Difficulty | wood | stone | food | water | tools |
|---|---|---|---|---|---|
| relaxed | 110 | 40 | 90 | 50 | 8 |
| normal | 80 | 30 | 60 | 40 | 5 |
| harsh | 50 | 15 | 35 | 25 | 2 |

Normal opening: farm (20) + well (10/15) + house (30/10) + lumber camp (20) = exactly 80 wood and 25 stone. The
starting stock pays for the four essential buildings. Everything after that must be gathered.

### 6.3 Production rates

Base rate per worker-hour at skill multiplier 1.0 without tools:

| Activity | Base rate | Where | Mechanics |
|---|---|---|---|
| Farm | **1.0 food/wh** (recipe 4 food per 4 wh) | farm (2 workers) | Into farm output. × season × weather farm-growth. |
| Fetch water | **2.0 water/wh** (recipe 4 water per 2 wh) | well (1 worker) | ×1.5 if any shallow or deep water tile is within 4 tiles of the well. Snow ×0.8. |
| Gather wood | **2.0 wood/wh** | lumber camp (2 workers), radius 6 | Worker walks to the nearest forest tile with resource > 0 in the radius, chops into their own carry until full, then drops at the nearest of {own camp's output, town center, storage}. Each unit taken lowers the tile's `resource`. |
| Mine stone | **1.25 stone/wh** | mine (2 workers), radius 4 | Same carry-and-drop loop on hills or mountain tiles (standing on a walkable neighbour for mountain). |
| Town center forage | wood or stone at **×0.5** | town center: 1 wood slot + 1 stone slot, radius 8 | Bootstrap only, so the colony can never soft-lock on wood. |
| Craft tools | **1 tool per 3 wh**; inputs 3 wood + 2 stone taken from stock at cycle start | workshop (1 worker) | Indoor; no light or weather effect. Output buffer → hauled. |
| Build | **1 build-hour per wh** | sites (`maxBuilders` 1x1: 2, 2x2: 3, 3x3: 4) | See 6.6. |
| Fish (optional, 7.2) | 0.8 food/wh (recipe 4 per 5 wh) | fishing dock (1 worker) | Winter ×0.6; unavailable in storm. |

**Full effective rate:**

```
rate = base × skillMult × toolMult × traitMult × moodMult × healthMult
     × lightMult(outdoor) × weatherWorkMult(outdoor) × difficulty.productionMult
     × buildingMult (season/weather farm growth, well water bonus, forage 0.5, event modifiers)
```

`healthMult` = 0.7 if sick, else 0.8 if health < 50, else 1.

### 6.4 Tools

- A settler starting a work session in `farming`, `woodcutting`, `mining`, `water` or `building` takes 1 tool
  from stock if they hold none and `tools ≥ 1`. The pickup is abstract (no walk). The held tool leaves the stock.
- **Tool multiplier ×1.4** while held. **Durability 48 worker-hours** of tool-using work. When it reaches 0 the
  tool breaks and is discarded (log line: "{name}'s tools broke.").
- On death or desertion a held tool returns to stock.
- The UI shows "Tools: {stock} in store, {held} in use". **[contract +]** `Settler.toolDurability: number | null`.
- Consumption: each tool-using worker wears out about 9/48 = **0.19 tools/day**. The 5 starting tools last about
  5 days, which is the moment the player first feels the workshop matters.
- **No building costs tools.** This rules out a soft-lock where tools are needed to build the workshop that makes them.
- ROI: one tool costs 3 wood + 2 stone + 3 crafting-wh, about 7 wh of colony labor, and yields +0.4 × 48 = +19 wh
  of output. That is a net gain of about 12 wh per tool.

### 6.5 Natural resources

- Forest tile wood: **40** at world creation, regrows **+2/day** (at 00:00, not in winter) up to 40. Per the
  contract, a forest tile at 0 becomes Grass.
- Forest spread: each day (not in winter), every Grass tile with no building and at least 3 Forest tiles among its
  8 neighbours becomes Forest with resource 8, with probability **3%**.
- Hills tile stone: **60**. Mountain tile stone: **120**. They do not regrow. At 0 the tile keeps its terrain and is
  no longer minable. A mine with no stone left in its radius shows "Exhausted". A typical mine with about 10
  hills/mountain tiles in its radius holds 600–1,200 stone, enough for the first year.
- **Tree choice:** a woodcutter targets the forest tile in the work radius that maximizes `resource − 2 × dist`
  (resource ≥ 1; ties go to the nearest), which spreads cutting so groves regrow. Miners target the nearest
  minable tile.
- **No food spoilage.**

### 6.6 Construction flow

1. **Place:** valid terrain, unlocked type, and `available(r) ≥ cost(r)` for each resource, where
   `available(r) = stock(r) − Σ over sites (required(r) − delivered(r) − inTransit(r))`. `inTransit` is computed
   from settlers whose haul task targets that site, so no extra state is needed. The site appears as a blueprint.
2. **Supply:** haulers carry materials from stock to the site (haul candidate "supply", +15).
3. **Build:** builders add work. Work can only be applied while
   `workDone / buildHours < deliveredFraction`, where `deliveredFraction = Σ delivered / Σ required`
   (1 when nothing is required). So scaffolding rises as materials arrive.
4. **Complete:** emits `buildingCompleted`. Houses assign beds to homeless settlers (lowest id first).
5. **Cancel:** refunds delivered materials (contract). **Demolish** a completed building: 50% of its cost
   (rounded down) back to stock, instantly (contract `DEMOLISH_REFUND`). The town center cannot be demolished.
6. **Damage** (storm, wildfire): the building goes back to `construction` status with `workDone = 0.7 ×
   buildHours`, `required` all zero ("Repairing"). It does not function until repaired. Residents keep their
   `homeId` but sleep by the campfire until it is complete. The town center and storage buildings are never
   damaged.

### 6.7 Balance proof (normal difficulty, 5 settlers)

**Labor assumption.** A settler is awake 05:00–20:00 (15 h). Two meals with an average round trip of 10 tiles
cost 2 × (0.5 h + 1.1 h walking) = 3.2 h. Another 1 h goes to walking between tasks and 0.5 h to socializing.
That leaves about 10.3 h on site. Dawn/dusk light (×0.95 averaged) and warm-season weather (×0.96, from the
Markov table's stationary mix) bring it to about 9.4 effective h. **The proof budgets 9.0 effective wh per settler
per day.** Skill multiplier 0.875 (average non-specialist). Tools are excluded unless stated (pessimistic).

**Demand:** 5 settlers × 2 = **10 food/day and 10 water/day**.

**Supply per worker per day (9 wh × 0.875):**

| Job | No tools | With tools (×1.4) |
|---|---|---|
| Farmer, spring/autumn | 1.0 × 7.875 = **7.88 food** | 11.03 |
| Farmer, summer (×1.25) | **9.84** | 13.78 |
| Farmer, winter | **0** | 0 |
| Well worker | 2.0 × 7.875 = **15.75 water** (23.6 near water) | 22.1 (33.1) |
| Woodcutter | **15.75 wood** | 22.1 |
| Miner | **9.84 stone** | 13.8 |
| Crafter | **2.63 tools** | n/a |

**Water** is easy: one well worker at about 5.7 wh/day (10 / 1.75) covers 10 water/day. One well covers up to
7 settlers (11 near water). Neglect case: 40 water lasts 4 days. Then every meal leaves the eater dehydrated
(−1.5 health/h), so the first deaths come about 2.8 days later, **around day 7–8 (~22 min)**. Rain barrels add
only about 2.3 water/day (19% rain/storm share × 24 h × 0.5) and cannot save the colony.

**Food**, end-of-day stock, starting from 60, day 1 producing half a day (computed day by day):

| Day (season) | A: 1 farm, 2 farmers, no tools | A′: same, starting tools for 5 days | B: 1 farmer, no tools | C: no farm |
|---|---|---|---|---|
| 1 (spring) | 57.9 | 61.0 | 53.9 | 50 |
| 5 (spring) | 80.9 | 109.2 | 45.4 | 10 |
| 10 (summer) | 129.3 | 150 (cap) | 44.7 | 0 since day 6 |
| 15 (autumn) | 150 (cap) | 150 (cap) | 34.0 | n/a |
| 16 (winter) | 140 | 140 | 24.0 | n/a |
| 18 (winter) | 120 | 120 | 4.0 | n/a |
| 20 (winter) | 100 | 100 | **out on day 19** | n/a |

(A and A′ hit the town center's 150 food cap. That surplus is exactly what a storage building is for, and what
pays for newcomers. Uncapped, A would end winter at 108 and A′ at 136.)

- **Sensible play (A):** 2 farmers on 1 farm net +5.75 food/day in spring, +9.7 in summer and +5.75 in autumn. The
  colony enters winter with 150 food (the cap) and finishes it with 100. Stable without any tools.
- **Under-investment (B):** 1 farmer nets −2.1/day in spring and autumn and only −0.2 in summer. The colony drifts
  down to 24 food by winter, runs out on **day 19** and loses its first settler around **day 21–22 (~64 min)**,
  while the `winterForecast` warning burns all autumn. Starting tools alone (B with tools for 5 days) only delay it to
  day 20.
- **Neglect (C):** food runs out at the end of day 6. With water available, the first death comes about 2.7 days
  later, **around day 9–10 (~28 min)**.
- **Harsh check:** decay ×1.15 (2.3 food/settler/day) and production ×0.9, starting with 35 food and 2 farmers,
  no tools: 85.8 food at the end of autumn, 28.3 at the end of winter. It survives, but with no slack.

**Scaling rule of thumb** (shown in the farm tooltip):
- 1 farmer feeds **3.9 settlers in season** without tools (5.5 with tools). Annualized, including winter, 1 farmer
  per **3.2 settlers** (4.4 with tools).
- Winter needs **pop × 10 food** in stock at day 16.
- 10-settler check: 4 farmers (2 farms), no tools, make 31.5 food/day in autumn against a demand of 20, so +57.5
  over autumn. The colony must enter autumn with ≥ 42.5 food and **one storage** (cap 270) to bank 100+ for
  winter. With tools, it is +120 over autumn. This is the core mid-game tension: storage, tools and a second farm
  before day 16.

**Labor budget at 5 settlers** (45 wh/day): farming 18 (40%), water 5.7 (13%), hauling about 4.5 (10%;
roughly 55 items/day ÷ 12 per trip × 1 h), leaving **about 17 wh/day for wood, stone, building and crafting**.
A house costs 30 wood (30 / 1.75 = 17.1 wh) + 10 stone (10 / 1.09 = 9.1 wh) + 10 build-hours (10 / 0.875 = 11.4 wh),
about **38 wh** in total, or roughly 2 days of spare labor at 5 settlers. Starting materials pre-pay the first house. Each newcomer
adds 9 wh/day and costs about 2.8 wh of farming (2 food / (7.875 × 0.8125 annualized)), 1.1 wh of water and
0.4 wh of hauling, so **each newcomer is net-positive by about 4.7 wh/day**, minus a one-off quarter of a house
(about 9.5 wh). The colony accelerates as it grows, and tools widen the margin.

**Wood sustainability:** a lumber camp needs ≥ 8 forest tiles in radius 6 (7.3). Woodcutters spread their
cutting across the grove (6.5 target rule), and every forest tile with wood left regrows +2/day, so 8 tiles regrow
+16 wood/day, which nearly sustains one woodcutter (15.75/day). Typical placements have 20–40 forest tiles in
radius, so forests thin out visibly but do not vanish within a year. A tile only turns to Grass when a grove is
over-exploited, for example two camps on one small grove.

---

## 7. Buildings

### 7.1 Buildings table

| Id | Footprint | Cost | Build (wh) | Max builders | Workers | Production | Housing | Storage (per resource) | Unlock |
|---|---|---|---|---|---|---|---|---|---|
| `townCenter` | 3×3 | pre-placed | n/a | n/a | forage: 1 wood + 1 stone | forage ×0.5, radius 8 | 4 | 150 | start (pre-placed) |
| `house` | 2×2 | 30 wood, 10 stone | 10 | 3 | 0 | n/a | 4 | 0 | start |
| `farm` | 3×3 | 20 wood | 6 | 4 | 2 | 4 food / 4 wh (farming) | 0 | 0 | start |
| `lumberCamp` | 2×2 | 20 wood | 6 | 3 | 2 | 2.0 wood/wh from tiles, radius 6 (woodcutting) | 0 | 0 | start |
| `mine` | 2×2 | 30 wood | 10 | 3 | 2 | 1.25 stone/wh from tiles, radius 4 (mining) | 0 | 0 | start |
| `well` | 1×1 | 10 wood, 15 stone | 6 | 2 | 1 | 4 water / 2 wh (hauling); ×1.5 near water | 0 | 0 | start |
| `storage` | 2×2 | 35 wood, 10 stone | 8 | 3 | 0 | n/a | 0 | +120 | 3 player buildings completed |
| `workshop` | 2×2 | 40 wood, 25 stone | 12 | 3 | 1 | 1 tool / 3 wh, inputs 3 wood + 2 stone (crafting) | 0 | 0 | a lumber camp and a mine completed |
| `fishingDock` (optional) | 1×1 | 20 wood | 6 | 2 | 1 | 4 food / 5 wh (farming); winter ×0.6; none in storm | 0 | 0 | start |

Eating points: `townCenter` and every completed `storage`. Drinking points: those plus completed `well`s.
Placing storage near distant work sites therefore shortens meal trips, which is a real placement decision.

**Tooltip flavor text** (replaces placeholder `description`s):

| Id | Text |
|---|---|
| `townCenter` | "The heart of the colony: stores goods, feeds settlers and shelters four." |
| `house` | "A snug log cabin with four bunks. Settlers sleep better under a roof." |
| `farm` | "Tilled rows of beans and corn. Bountiful in summer, fallow in winter." |
| `lumberCamp` | "Axes and sawhorses at the forest's edge. Woodcutters fell trees nearby." |
| `mine` | "A quarry cut into the hillside. Yields stone until the seam runs dry." |
| `well` | "A stone-lined well. Draws more water when dug near a lake or river." |
| `storage` | "A timber warehouse: room for 120 more of every good, and a place to eat." |
| `workshop` | "A smithy and bench where wood and stone become tools." |
| `fishingDock` | "A short pier for nets and lines. Fish still bite in winter." |

### 7.2 Optional extra building: `fishingDock`

Flagged **optional** (**[contract +]** `BuildingType` member). It is the only food source in winter (3.8
food/day per fisher without tools, about 2 settlers' worth), which gives `archipelago` and `riverValley` an
identity and gives the player a hedge against a bad autumn. If it is cut, nothing else in this design depends on
it.

### 7.3 Placement rules

Contract terrain: Grass and Sand are buildable; Forest, Hills, Mountain and water are not.

| Building | Footprint terrain | Nearby requirement |
|---|---|---|
| all | every tile in bounds, not occupied, in `allowedTerrain`; at least one walkable neighbour tile reachable from the town center | n/a |
| `house`, `storage`, `workshop`, `lumberCamp`, `mine`, `well` | Grass or Sand | see below |
| `farm` | Grass only | none |
| `lumberCamp` | Grass or Sand | **≥ 8** Forest tiles within radius 6 |
| `mine` | Grass or Sand | **≥ 3** Hills/Mountain tiles within radius 4 |
| `well` | Grass or Sand | none (×1.5 if any Shallow/Deep water within 4) |
| `fishingDock` | Sand or Grass | orthogonally adjacent to Shallow water and **≥ 10** water tiles within radius 4 |

**[contract +]** `requiresNearby.minCount` (default 1). Radius is measured as Chebyshev distance from the
footprint's edge tiles. Error messages: "Needs 8 forest tiles nearby (found {n})", "Needs hills or mountains
nearby", "Farms need grassland", "Can't build on water/forest/hills/mountains", "Not enough {resource}: need
{n} more".

---

## 8. Population growth

Newcomers only; there are no births. The rule is simple and easy to read.

Checked daily at 08:00. All of these must hold:

1. `freeBeds ≥ 1`, where `freeBeds = 4 + 4 × completedHouses − pop` (damaged houses excluded).
2. food ≥ pop × 4 (2 days) and water ≥ pop × 4.
3. Average happiness ≥ 50.
4. pop < **30** (hard cap).
5. No settler died in the last 24 h.

Then roll `p = (0.50 + 0.10 × min(freeBeds − 1, 3)) × growthMult[difficulty]` (0.50–0.80 on normal). On success,
**1 newcomer**, or **2** if `freeBeds ≥ 2` and a second roll < 0.30. Newcomers appear on a random walkable map-edge
tile connected to the town center and walk in. Their needs are hunger 70, energy 80, happiness 65 and health 100,
and they get the newcomer specialty bonus (3.2). Log/toast: "{name} has arrived and joined {colony}." (good)
Everyone gains `newcomer` +4.

Expected pace: about 0.75 newcomers/day while the conditions hold, so 5 → 20 takes about 20 qualifying days, plus
wanderer events. Victory lands around day 22–30 (65–90 min at 1x).

---

## 9. Weather

Five kinds (contract `WeatherKind`): `clear`, `cloudy`, `rain`, `storm`, `snow`. When the current spell's
`hoursRemaining` reaches 0, roll the next kind from the season's Markov row and roll a duration (uniform real in
the range). Set `intensity` uniform 0.4–1.0 (visual only).

**Durations (hours):** clear 6–18, cloudy 4–12, rain 3–9, storm 2–5, snow 4–12.

**Warm table** (spring, summer, autumn). Rows are the current kind:

| from \ to | clear | cloudy | rain | storm | snow |
|---|---|---|---|---|---|
| clear | 0.45 | 0.40 | 0.12 | 0.03 | 0 |
| cloudy | 0.40 | 0.20 | 0.30 | 0.10 | 0 |
| rain | 0.20 | 0.45 | 0.20 | 0.15 | 0 |
| storm | 0.10 | 0.40 | 0.50 | 0 | 0 |
| snow | 0 | 1.00 | 0 | 0 | 0 |

**Winter table:**

| from \ to | clear | cloudy | rain | storm | snow |
|---|---|---|---|---|---|
| clear | 0.40 | 0.35 | 0 | 0.05 | 0.20 |
| cloudy | 0.25 | 0.25 | 0 | 0.10 | 0.40 |
| rain | 0 | 0 | 0 | 0 | 1.00 |
| storm | 0.10 | 0.40 | 0 | 0 | 0.50 |
| snow | 0.15 | 0.40 | 0 | 0.15 | 0.30 |

Season changes: entering winter turns current `rain` into `snow` (keeping the remaining hours). Leaving winter
turns `snow` into `cloudy`. During a `drought`, any roll of `rain` becomes `cloudy`. Long-run share of hours:
warm is about 49% clear, 32% cloudy, 16% rain, 3% storm; winter is about 34% clear, 32% cloudy, 31% snow, 4%
storm.

**Effects:**

| Weather | Outdoor work | Farm growth | Walk speed | Energy decay | Mood | Special |
|---|---|---|---|---|---|---|
| clear | ×1.00 | ×1.00 | ×1.00 | ×1.00 | +3 (not at night) | n/a |
| cloudy | ×1.00 | ×1.00 | ×1.00 | ×1.00 | 0 | n/a |
| rain | ×0.85 | ×1.25 | ×0.90 | ×1.00 | −3 | Rain barrels +0.5 water/h |
| storm | ×0.60 | ×0.60 | ×0.75 | ×1.15 | −8 | 3%/h chance of `stormDamage`; rain barrels; no fishing |
| snow | ×0.80 | ×0 | ×0.80 | ×1.20 | −3 | Wells ×0.8 |

Farm output multiplies outdoor work by farm growth by season. In rain that is 0.85 × 1.25 = 1.06, so rain is a
mild net plus for farms. The warm-season averages are 0.96 for outdoor work and 0.99 for farms.

---

## 10. Random events

**Daily roll at 08:00:** shuffle the eligible daily events with the sim RNG. For each, roll
`p × (positive ? posEventMult : negEventMult)`. The **first success fires and the roll stops** (at most one daily
event per day). Negative events cannot fire before day `graceDays` (relaxed 5, normal 3, harsh 2). An event of a
kind that is already active is not eligible. `stormDamage` and `wildfire` have their own triggers (hourly or daily
while their condition holds) and ignore the one-per-day limit. The roughly 0.4–0.5 events/day overall means
something notable happens about every 2 days.

Contract `RandomEventKind` has 9 of these. **[contract +]** adds `wolves`, `stormDamage`, `richVein`,
`supplyCache` and `harvestFestival`. Events with a duration live in `activeEvents`; instant events only log.

**Decision events (3), marked ⚖.** They are shown as a modal-free card in the events panel with Accept/Decline
buttons, and time out to the default after the window. **[contract +]** `PlayerCommand`
`{type: 'resolveEvent', eventId, accept: boolean}` and `GameState.pendingDecisions`.

| # | Id | Kind | Trigger | p/day | Effect | Duration | Toast text |
|---|---|---|---|---|---|---|---|
| 1 | `traderVisit` ⚖ | + | day ≥ 3; at least one offer affordable | 0.10 | One offer chosen at random among affordable ones: (a) 30 wood → 25 food; (b) 25 food → 20 stone; (c) 30 wood + 10 stone → 4 tools; (d) 30 food → 35 wood; (e) 20 wood → 25 water. Accept: swap immediately. | 12 h window, auto-decline | "A traveling trader pulls up at the town center: {give} for {get}?" |
| 2 | `wanderer` ⚖* | + | day ≥ 2; pop ≤ 28 | 0.07 | 1 settler (60%) or 2 (40%). If freeBeds ≥ group size: they **auto-join** (no decision). Otherwise decision: Accept (they sleep by the campfire) or Turn away. | 12 h window, auto-decline | "{n} wanderer(s) ask to join. {There are beds for them. / There are no free beds; they would sleep outdoors.}" |
| 3 | `harvestFestival` ⚖ | + | autumn; once per year; food ≥ pop × 6 | 0.35 | Accept: consumes pop × 2 food. All settlers go to the town center to socialize for 4 h (critical needs still override), then gain `festival` +15 for 48 h. | 6 h window, auto-decline | "The harvest is in! Hold a festival? (costs {n} food)" |
| 4 | `bountifulHarvest` | + | not winter; ≥ 1 farm | 0.06 | Farms ×1.5 | 48 h | "The crops are coming in thick and heavy. Farms +50% for 2 days." |
| 5 | `richVein` | + | ≥ 1 mine | 0.05 | Every hills/mountain tile in one random mine's radius gains +40 stone | instant | "Miners struck a rich seam at the {mine}!" |
| 6 | `supplyCache` | + | day ≥ 2 | 0.05 | One of: +30 wood, +20 stone, +25 food, +3 tools (uniform) | instant | "Settlers found an abandoned wagon: +{n} {resource}." |
| 7 | `wolves` | − | day ≥ 4 | 0.06 | At start, the settler farthest from the town center (if > 10 tiles away) is attacked: −35 health. All settlers get `wolves` −5. Woodcutting and mining ×0.8. | 24 h | "Wolves on the ridge! {name} was mauled." / "Wolves have been sighted near the colony." |
| 8 | `sickness` | − | day ≥ 5 | 0.05 (+0.05 if anyone is dehydrated or slept outdoors last night) | `ceil(pop × 0.25)` random settlers (frail weighted ×2) become sick: −1 health/h, no regeneration, work ×0.7, sleep score +20 | 36 h per settler (tough 18 h) | "A fever is going around. {names} fell ill." |
| 9 | `cropBlight` | − | not winter; ≥ 1 farm | 0.04 | One random farm produces nothing | 48 h | "Blight has struck the {farm}. It will yield nothing for 2 days." |
| 10 | `drought` | − | summer | 0.08 | No rain (see 9); farms ×0.6; wells ×0.7; enables `wildfire` | 72 h | "Drought. The soil cracks and wells run low." |
| 11 | `wildfire` | − | `drought` active; rolled at 14:00 | 0.20 | Pick a random forest tile with resource > 0 at least 8 tiles from the town center. Every Forest tile within radius 3 becomes Grass (resource 0). Every building with a footprint tile in that radius is damaged (6.6). | instant | "Wildfire! The forest near ({x},{y}) is burning." |
| 12 | `stormDamage` | − | each hour of `storm` | 0.03/h | A random completed building, other than the town center and storage, is damaged (6.6) | instant | "The storm tore the roof off the {building}. It needs repairs." |
| 13 | `toolsBreak` | − | tools in stock ≥ 4 | 0.04 | Lose `max(1, floor(0.25 × toolsInStock))` tools | instant | "Damp got into the tool crates. {n} tools rusted through." |
| 14 | `coldSnap` | − | winter | 0.20 | Energy decay ×1.3; cold-night damage −2/h; wells ×0.5 | 48 h | "A bitter cold snap. Keep everyone indoors at night." |

\* `wanderer` is only a decision when beds are short.

---

## 11. Progression and goals

Objectives are shown as a checklist in order. All of them are tracked simultaneously, so completing a later one
early still counts. **[contract +]** `GameState.progress: {objectivesDone: string[], unlocked: BuildingType[]}`.

| # | Id | Title | Condition | Reward |
|---|---|---|---|---|
| 1 | `roof` | Roof Over Heads | Complete a house | n/a |
| 2 | `bread` | Daily Bread | Complete a farm | n/a |
| 3 | `water` | Fresh Water | Complete a well | n/a |
| 4 | `foundations` | Lay the Foundations | Complete 3 player-built buildings | **Unlocks storage** |
| 5 | `timber` | Stone and Timber | Complete a lumber camp and a mine | **Unlocks workshop** |
| 6 | `toolmaker` | Toolmaker | Craft 5 tools in total | n/a |
| 7 | `growing` | Growing Settlement | Reach 10 settlers | n/a |
| 8 | `larder` | Ready for Winter | At 00:00 on the first day of winter, food ≥ pop × 10 | n/a |
| 9 | `winter` | Survive the Winter | Reach day 21 with pop ≥ 1 | n/a |
| 10 | `thriving` | **Thriving Frontier** | pop ≥ **20** and average happiness ≥ 50 (checked hourly) | **Victory** |

Unlock order: start with `house`, `farm`, `well`, `lumberCamp`, `mine` (+ `fishingDock`); then `storage`
(objective 4); then `workshop` (objective 5). Locked buildings show in the build menu greyed out with their
unlock text.

**Victory:** set `outcome.status = 'won'` with the reason "Thriving Frontier: 20 settlers call {colony} home."
and show the victory screen with stats (days, peak pop, deaths, buildings). It offers **Keep playing**, which
returns `status` to `playing` and does not re-trigger victory. **[contract +]** `GameState.victoryAcknowledged:
boolean` (or the lead's preferred equivalent).

---

## 12. Survival and failure

**Lose condition (exact):** after any tick in which `pop == 0` (all settlers dead or departed), set
`outcome.status = 'lost'` with the reason "The frontier has claimed {colony}. It lasted {days} days." There is no
other lose condition.

**Warnings** (persistent banner chips, re-evaluated hourly; red ones also toast once when they first appear):

| Id | Severity | Condition | Text |
|---|---|---|---|
| `foodLow` | warning | food < pop × 2 (under 1 day) | "Food running low: {d} days left" |
| `foodOut` | danger | food == 0 | "No food! Settlers are starving." |
| `waterLow` | warning | water < pop × 2 | "Water running low: {d} days left" |
| `waterOut` | danger | water == 0 | "No water! Settlers are getting sick." |
| `winterForecast` | warning | autumn, and food < pop × 10 | "Winter in {n} days: stockpile {pop × 10} food (have {food})" |
| `homeless` | warning | pop > beds | "{n} settler(s) sleeping outdoors" (danger in winter) |
| `storageFull` | warning | any resource ≥ 95% of cap | "Storage full: {resource}" |
| `noTools` | info | tools in stock == 0, no workshop, pop ≥ 3 | "Out of tools: work is slower. Build a workshop." |
| `unhappy` | warning | any settler Miserable or Breaking | "{name} is miserable" (danger when Breaking: "{name} may leave") |
| `lowHealth` | danger | any settler health < 30 | "{name} is badly hurt" |
| `idle` | info | ≥ 2 settlers with no valid work for 2 h | "Settlers have nothing to do. Build something?" |

---

## 13. Player decisions that matter

1. **Build order under scarcity.** The starting wood pays for exactly the four essentials. Pick a mine or a second
   farm first? Tools or houses?
2. **Placement vs. walking time.** Fields near the town center mean short meal trips. Lumber camps need forest,
   mines need hills, wells want water. A storage near the work cluster cuts commutes. At 18 tiles/h, a 20-tile
   commute costs over an hour a day per worker.
3. **Priorities vs. needs.** Raising `farming` to 3 in autumn stockpiles for winter but starves construction.
   Setting `hauling` to 1 saves labor until buffers clog.
4. **Housing vs. growth.** Newcomers only arrive with free beds and full larders. Each house is about 38 wh of
   labor. Accepting wanderers without beds adds hands now but costs happiness, and risks the cold in winter.
5. **Trader offers.** Trade surplus wood for food before winter, or hoard?
6. **Festival.** Spend pop × 2 food for +15 happiness and a burst of growth eligibility, just before winter.
7. **Tools.** A workshop is 40 wood + 25 stone and a worker, but repays about 3× in output.
8. **Winter prep.** Storage (a cap of 150 food is not enough for more than 15 settlers), a second farm, a fishing
   dock, houses (no one sleeps outdoors in the cold).

---

## 14. Difficulty table

| Parameter | relaxed (Easy) | normal | harsh (Hard) |
|---|---|---|---|
| Starting stock (wood/stone/food/water/tools) | 110 / 40 / 90 / 50 / 8 | 80 / 30 / 60 / 40 / 5 | 50 / 15 / 35 / 25 / 2 |
| `needDecayMult` (hunger and energy decay) | 0.85 | 1.00 | 1.15 |
| `productionMult` (all work rates) | 1.15 | 1.00 | 0.90 |
| `healthDamageMult` | 0.75 | 1.00 | 1.25 |
| `negEventMult` | 0.6 | 1.0 | 1.4 |
| `posEventMult` | 1.3 | 1.0 | 0.8 |
| `growthMult` | 1.25 | 1.00 | 0.80 |
| `graceDays` (no negative events before) | 5 | 3 | 2 |
| `desertionHours` | 72 | 48 | 36 |
| Specialty skill range | 6–8 | 5–7 | 4–6 |

The relaxed opening affords all four essentials plus a mine. The harsh opening affords farm, lumber camp and well
but no house, so a founder sleeps outdoors until wood comes in.

---

## 15. UX notes for feedback

**Always visible (HUD):**
- **Top bar:** Day N, season icon and name, clock (HH:MM) with a phase icon, weather icon and name, speed controls
  (pause / 1x / 2x / 4x), population "pop / beds".
- **Resource bar:** for each resource, `stock / cap` and the **net rate per day** (green +, red −). The rate is
  computed from the last 24 hourly samples of `ColonyStats` (produced − consumed); until 24 h of history exist,
  extrapolate from the hours available. For food and water also show "{d} days" of supply. Tools show "{stock} (+{held} in use)".
- **Warnings strip** (section 12) and the **objectives** checklist (collapsible).
- **Above each settler:** a short activity label on hover/selection, and an icon bubble when a need is critical
  (food, Zzz, heart).
- **Construction:** a progress bar over each site, with "Waiting for materials" when `workDone/buildHours` has
  caught up with `deliveredFraction`.
- **Building status line** (inspector and hover): "Working (2/2)", "No workers", "Output full: needs hauling",
  "Fallow (winter)", "Exhausted", "Damaged: awaiting repair", "Blighted".

**Settler inspector:** name, traits (with tooltips), mood band and happiness, four need bars, the moodlet list
with values (the "why" behind mood), skills with level and an XP bar, current activity, held tool durability, home.

**Tooltips:**

| Item | Tooltip |
|---|---|
| wood | "Wood: felled at lumber camps. Used for nearly every building and for tools." |
| stone | "Stone: quarried at mines from hills and mountains. Needed for houses, wells and tools." |
| food | "Food: grown on farms from spring to autumn. Each settler eats 2 a day. Fields lie fallow in winter, so stockpile." |
| water | "Water: drawn at wells (faster near lakes and rivers). Each settler drinks 2 a day. Without it, settlers grow sick." |
| tools | "Tools: crafted at the workshop. A settler with tools works 40% faster. Each tool lasts about 5 working days." |
| housing | "Beds: 4 in the town center, 4 per house. Settlers without a bed sleep by the campfire, unhappy and cold in winter. Newcomers only come when a bed is free." |
| hunger | "Hunger: 100 is well fed. Settlers eat at the town center or a storage when it drops below 50. Below 10 they start starving." |
| energy | "Energy: restored by sleep, faster in a bed. Exhausted settlers collapse where they stand." |
| happiness | "Happiness: drifts toward a target set by moodlets (see the list). Above 80 settlers work faster; below 15 they stop working and may leave." |
| health | "Health: lost to starvation, thirst, sickness, cold and wolves; regained when fed and rested. At 0 the settler dies." |
| priorities | "Priority 0 = never, 1 = low, 2 = normal, 3 = high. Settlers still eat and sleep when they need to." |

**Toasts:** good (green) for arrivals, completions and positive events; warning (amber); danger (red) for deaths,
desertion and fires. Decision events stay pinned until resolved or timed out, with a countdown.

---

## 16. Balance constants appendix

Transcribe into `src/sim/balance.ts`. Group names are suggestions. Keep the existing exported names where the
architect defined them (`REAL_SECONDS_PER_GAME_DAY`, `START_HOUR`, `DAYS_PER_SEASON`, `STARTING_SETTLERS`,
`SETTLER_WALK_SPEED`, `CARRY_CAPACITY`, `STARTING_STOCK`, `DEFAULT_PRIORITIES`, `DEMOLISH_REFUND`,
`TERRAIN_DEFS`, `TILE_RESOURCE_START`, `BUILDING_DEFS`, `TRAIT_DEFS`) and add the rest. Rates are per in-game
hour.

```ts
// ===== TIME =====
export const REAL_SECONDS_PER_GAME_DAY = 180;          // 1 game hour = 7.5 s at 1x
export const START_DAY = 1;
export const START_HOUR = 6;
export const DAYS_PER_SEASON = 5;                       // year = 20 days = 60 min at 1x
export const START_SEASON = 'spring';
export const DAY_PHASES = { dawnStart: 5, dayStart: 7, duskStart: 18, nightStart: 20 } as const;
export const DAYLIGHT_HOURS = { start: 5, end: 20 } as const; // dawn..dusk inclusive (renderer)
export const LIGHT_WORK_MULT = { dawn: 0.85, day: 1.0, dusk: 0.85, night: 0.6 } as const;
export const NIGHT_WALK_MULT = 0.9;
export const PERSONAL_NIGHT_WINDOW = {                  // [startHour, endHour) wrapping midnight
  default: [20, 5], nightOwl: [0, 8], earlyBird: [19, 4],
} as const;
export const SCHEDULE = { regrowthHour: 0, growthCheckHour: 8, eventRollHour: 8, wildfireRollHour: 14 } as const;

// ===== SEASONS =====
export const SEASON_FARM_MULT = { spring: 1.0, summer: 1.25, autumn: 1.0, winter: 0 } as const;
export const SEASON_ENERGY_DECAY_MULT = { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.1 } as const;
export const SEASON_TREE_REGROWTH = { spring: true, summer: true, autumn: true, winter: false } as const;

// ===== SETTLERS =====
export const STARTING_SETTLERS = 5;
export const POPULATION_CAP = 30;
export const SETTLER_START_NEEDS = { hunger: 80, energy: 90, happiness: 65, health: 100, hungerEnergyJitter: 10 } as const;
export const NEWCOMER_START_NEEDS = { hunger: 70, energy: 80, happiness: 65, health: 100 } as const;
export const SETTLER_WALK_SPEED = 2.4;                  // tiles per sim second on moveCost 1 (= 18 tiles / game hour)
export const CARRYING_WALK_MULT = 0.9;
export const CARRY_CAPACITY = 10;                       // + hauling level
export const CARRY_PER_HAULING_LEVEL = 1;
export const SKILL_SPEED = { base: 0.75, perLevel: 0.05 } as const;       // mult = base + perLevel * level
export const SKILL_SPAWN = { baseMin: 1, baseMax: 4, secondaryMin: 3, secondaryMax: 5 } as const;
export const SPECIALTY_RANGE = { relaxed: [6, 8], normal: [5, 7], harsh: [4, 6] } as const;
export const FOUNDER_SPECIALTIES = ['farming', 'construction', 'woodcutting'] as const; // founders #1..#3
export const NEWCOMER_SPECIALTY_BONUS = { perDays: 5, max: 3 } as const;
export const XP_PER_WORK_HOUR = 1;
export const XP_TO_NEXT_LEVEL_PER_LEVEL = 10;           // xpToNext(L) = 10 * (L + 1)
export const TRAIT_COUNT_WEIGHTS = { one: 0.6, two: 0.4 } as const;
export const TRAIT_EXCLUSIVE_PAIRS = [
  ['hardworking', 'lazy'], ['cheerful', 'gloomy'], ['glutton', 'frugal'], ['tough', 'frail'],
  ['nightOwl', 'earlyBird'], ['sociable', 'loner'], ['nimble', 'clumsy'],
] as const;
export const FOUNDER_TRAIT_LIMITS = { lazy: 1, gloomy: 1 } as const;

// Trait effects (1 = no effect). Fields absent = neutral.
export const TRAIT_EFFECTS = {
  hardworking: { workSpeed: 1.15, energyDecay: 1.10, workScore: 5 },
  lazy:        { workSpeed: 0.85, energyDecay: 0.90, workScore: -5, wanderScore: 15 },
  cheerful:    { happinessBaseline: 8 },
  gloomy:      { happinessBaseline: -8 },
  glutton:     { hungerDecay: 1.25, wellFedMoodlet: 4, wellFedAtHunger: 70 },
  frugal:      { hungerDecay: 0.85 },
  tough:       { healthDamage: 0.7, sicknessDuration: 0.5, ignoresWeatherMood: true },
  frail:       { healthDamage: 1.3, healthRegen: 0.75, sicknessPickWeight: 2 },
  nightOwl:    { noLightPenalty: ['dawn', 'dusk', 'night'] },
  earlyBird:   { noLightPenalty: ['dawn'] },
  sociable:    { socializeScore: 15, socializedMoodlet: 12, lonelyMoodlet: -5, lonelyAfterHours: 24 },
  loner:       { happinessBaseline: 4, socializeScore: -20, noSocialMoodlets: true },
  nimble:      { walkSpeed: 1.2 },
  clumsy:      { walkSpeed: 0.9, constructionSpeed: 0.85, craftingSpeed: 0.85 },
} as const;

// ===== NEEDS =====
export const HUNGER_DECAY = 4.0;                        // per hour, always
export const MEAL = { food: 1, water: 1, hungerRestore: 48, hours: 0.5, maxHungerToEat: 50 } as const;
export const DRINK = { water: 1, hours: 0.15, starvingHungerRestore: 8, starvingCooldownHours: 4, starvingMaxHunger: 40 } as const;
export const FOOD_PER_SETTLER_DAY = 2;                  // derived: 24 * 4 / 48 (used by forecasts)
export const WATER_PER_SETTLER_DAY = 2;
export const ENERGY_DECAY = { working: 4.0, awakeOther: 3.0 } as const;
export const SLEEP_RESTORE = { bed: 9, outdoors: 6 } as const;
export const SLEEP_WAKE = { full: 100, nap: 90 } as const;
export const COLLAPSE_ENERGY = 5;
export const OUTDOOR_SLEEP_RADIUS_FROM_TOWN_CENTER = 3;
export const RAIN_BARREL_WATER_PER_HOUR = 0.5;          // town center, in rain or storm

export const HEALTH = {
  regen: 1, regenInBed: 3, regenMinHunger: 25, regenMinEnergy: 20,
  starvingBelowHunger: 10, starvingDamage: 2.5,
  dehydratedDamage: 1.5,
  exhaustedDamage: 1,                                   // at energy <= 0
  sickDamage: 1,
  coldNightDamage: 1, coldSnapNightDamage: 2,           // sleeping outdoors in winter
  hurtBelow: 50, hurtWorkMult: 0.8, sickWorkMult: 0.7,
  criticalRestBelow: 25, restUntil: 50,
  damageLogHours: 6,
} as const;

export const HAPPINESS = { start: 65, baseTarget: 50, driftPerHour: 4 } as const;
export const MOOD_BANDS = [                             // checked top-down
  { id: 'inspired',  min: 80, workMult: 1.10 },
  { id: 'content',   min: 50, workMult: 1.00 },
  { id: 'unhappy',   min: 30, workMult: 0.90 },
  { id: 'miserable', min: 15, workMult: 0.75, workScoreMult: 0.85, sulkChancePerHour: 0.05, sulkHours: 2 },
  { id: 'breaking',  min: 0,  workMult: 0,    refusesWork: true },
] as const;
export const DESERTION_HOURS = { relaxed: 72, normal: 48, harsh: 36 } as const;

export const MOODLETS = {
  sleptInHouse:      { value: 6,   hours: 18 },
  sleptOutdoors:     { value: -10, hours: 18 },
  sleptOutdoorsCold: { value: -15, hours: 18 },
  hungry:            { value: -8,  state: true, belowHunger: 25 },
  starving:          { value: -20, state: true, belowHunger: 10 },
  dehydrated:        { value: -8,  state: true },
  tired:             { value: -6,  state: true, belowEnergy: 20 },
  hurt:              { value: -10, state: true, belowHealth: 50 },
  sick:              { value: -8,  state: true },
  fineWeather:       { value: 3,   state: true },        // clear, not night
  rain:              { value: -3,  state: true },
  storm:             { value: -8,  state: true },
  snow:              { value: -3,  state: true },
  socialized:        { value: 6,   hours: 12 },          // sociable: 12
  lonely:            { value: -5,  state: true },
  overworked:        { value: -6,  state: true, workedHours: 12 },
  colonistDied:      { value: -12, hours: 72, maxStacks: 3 },
  colonistLeft:      { value: -5,  hours: 48, maxStacks: 2 },
  newcomer:          { value: 4,   hours: 24, maxStacks: 2 },
  fullLarder:        { value: 5,   state: true, foodDays: 5, waterDays: 3 },
  emptyLarder:       { value: -8,  state: true },
  wellFed:           { value: 4,   state: true },        // glutton only
  festival:          { value: 15,  hours: 48 },
  wolves:            { value: -5,  state: true },
} as const;

// ===== UTILITY AI =====
export const AI = {
  priorityBase: { 1: 40, 2: 55, 3: 70 },
  skillScorePerLevel: 2,
  distPenaltyPerTile: 0.4, distPenaltyMaxTiles: 50,
  commitmentBonus: 15,
  jitterMax: 4,
  reevalHours: { work: 1.0, wander: 0.25 },
  storageFullPenalty: 30,
  eat:   { base: 40, slope: 2.2, maxHunger: 50, distPenaltyPerTile: 0.3, distMaxTiles: 40 },
  drink: { dehydratedScore: 75 },                       // starving fallback uses the eat curve
  sleep: { maxEnergy: 90, slope: 1.2, nightBonus: 60, distPenaltyPerTile: 0.2, distMaxTiles: 40 },
  socialize: { maxHappiness: 90, base: 20, slope: 0.5, slopeBelow: 75, duskBonus: 40,
               cooldownPenalty: 40, hours: 1, partnerRadius: 4, partnerOverlapHours: 0.5 },
  wander: { score: 12, hours: 0.5, radius: 6 },
  critical: { hungerBelow: 15, energyCollapseBelow: 5, healthRestBelow: 25, bonus: 200 },
  shortage: {
    food:  { max: 25, targetDays: 3, autumnTargetDays: 8 },
    water: { max: 25, targetDays: 3 },
    wood:  { max: 15, target: 50 },
    stone: { max: 15, target: 30 },
    tools: { max: 20, perPop: 0.6, min: 3 },             // toolTarget = max(min, ceil(pop * perPop))
  },
  buildTaskBonus: { any: 10, houseWhileHomeless: 10, farmOrWellInShortage: 10, shortageThreshold: 12 },
  haul: { minLoad: 6, fillBonus: 25, fullBonus: 15, supplySiteBonus: 15, pickupHours: 0.1, dropHours: 0.1 },
  decisionStaggerTicks: 10,
} as const;

// ===== ECONOMY =====
export const STARTING_STOCK = {
  relaxed: { wood: 110, stone: 40, food: 90, water: 50, tools: 8 },
  normal:  { wood: 80,  stone: 30, food: 60, water: 40, tools: 5 },
  harsh:   { wood: 50,  stone: 15, food: 35, water: 25, tools: 2 },
} as const;
export const DEFAULT_PRIORITIES = { building: 2, farming: 2, woodcutting: 2, mining: 2, hauling: 2, water: 2, crafting: 2 } as const;
export const OUTPUT_BUFFER_CAP = 30;                    // per building output; workshop uses 10
export const WORKSHOP_OUTPUT_BUFFER_CAP = 10;
export const GATHER_RATE = { wood: 2.0, stone: 1.25 } as const; // per worker-hour, from tiles
export const GATHER_RADIUS = { lumberCamp: 6, mine: 4, townCenterForage: 8 } as const;
export const TOWN_CENTER_FORAGE = { rateMult: 0.5, woodSlots: 1, stoneSlots: 1 } as const;
export const WELL_NEAR_WATER = { radius: 4, mult: 1.5 } as const;
export const TOOLS = {
  productivityMult: 1.4, durabilityHours: 48,
  usedBy: ['farming', 'woodcutting', 'mining', 'water', 'building'],
  craftInputs: { wood: 3, stone: 2 }, craftHours: 3,
} as const;
export const OUTDOOR_JOBS = ['farming', 'woodcutting', 'mining', 'water', 'building'] as const;
export const MAX_BUILDERS_BY_FOOTPRINT = { 1: 2, 4: 3, 9: 4 } as const; // key = w*h
export const DEMOLISH_REFUND = 0.5;
export const DAMAGE_REPAIR_PROGRESS = 0.7;              // damaged building reverts to 70% built, no materials
export const DAMAGE_IMMUNE = ['townCenter', 'storage'] as const;

// ===== TERRAIN & NATURAL RESOURCES =====
export const TERRAIN_MOVE_COST = { deepWater: null, shallowWater: 2.5, sand: 1.15, grass: 1.0, forest: 1.4, hills: 1.7, mountain: null } as const;
export const TILE_RESOURCE_START = { forestWood: 40, hillsStone: 60, mountainStone: 120 } as const;
export const FOREST_REGROWTH = { perDay: 2, max: 40, spreadChance: 0.03, spreadMinForestNeighbours: 3, spreadStartWood: 8 } as const;

// ===== BUILDINGS =====
// cost, buildHours, footprint, maxWorkers, housing, storage(per resource), production recipe
export const BUILDINGS = {
  townCenter: { footprint: [3, 3], cost: {}, buildHours: 0, maxWorkers: 0, housing: 4, storage: 150,
                eatingPoint: true, unlock: 'start' },
  house:      { footprint: [2, 2], cost: { wood: 30, stone: 10 }, buildHours: 10, maxWorkers: 0, housing: 4, storage: 0, unlock: 'start' },
  farm:       { footprint: [3, 3], cost: { wood: 20 }, buildHours: 6, maxWorkers: 2, housing: 0, storage: 0,
                production: { output: 'food', amount: 4, cycleHours: 4, inputs: {}, skill: 'farming' },
                allowedTerrain: ['grass'], unlock: 'start' },
  lumberCamp: { footprint: [2, 2], cost: { wood: 20 }, buildHours: 6, maxWorkers: 2, housing: 0, storage: 0,
                requiresNearby: { terrain: ['forest'], radius: 6, minCount: 8 }, unlock: 'start' },
  mine:       { footprint: [2, 2], cost: { wood: 30 }, buildHours: 10, maxWorkers: 2, housing: 0, storage: 0,
                requiresNearby: { terrain: ['hills', 'mountain'], radius: 4, minCount: 3 }, unlock: 'start' },
  well:       { footprint: [1, 1], cost: { wood: 10, stone: 15 }, buildHours: 6, maxWorkers: 1, housing: 0, storage: 0,
                production: { output: 'water', amount: 4, cycleHours: 2, inputs: {}, skill: 'hauling' }, unlock: 'start' },
  storage:    { footprint: [2, 2], cost: { wood: 35, stone: 10 }, buildHours: 8, maxWorkers: 0, housing: 0, storage: 120,
                eatingPoint: true, unlock: 'objective:foundations' },
  workshop:   { footprint: [2, 2], cost: { wood: 40, stone: 25 }, buildHours: 12, maxWorkers: 1, housing: 0, storage: 0,
                production: { output: 'tools', amount: 1, cycleHours: 3, inputs: { wood: 3, stone: 2 }, skill: 'crafting' },
                unlock: 'objective:timber' },
  fishingDock:{ footprint: [1, 1], cost: { wood: 20 }, buildHours: 6, maxWorkers: 1, housing: 0, storage: 0,   // OPTIONAL
                production: { output: 'food', amount: 4, cycleHours: 5, inputs: {}, skill: 'farming' },
                allowedTerrain: ['sand', 'grass'], requiresAdjacent: 'shallowWater', requiresNearbyWater: { radius: 4, minCount: 10 },
                winterMult: 0.6, stormDisabled: true, unlock: 'start' },
} as const;

// ===== POPULATION GROWTH =====
export const GROWTH = {
  checkHour: 8, minFreeBeds: 1, minFoodDays: 2, minWaterDays: 2, minAvgHappiness: 50,
  noDeathWithinHours: 24,
  baseChance: 0.5, perExtraBed: 0.1, maxExtraBeds: 3,
  pairChance: 0.3, pairMinFreeBeds: 2,
} as const;
export const VICTORY = { population: 20, minAvgHappiness: 50 } as const;

// ===== WEATHER =====
export const WEATHER_DURATION_HOURS = { clear: [6, 18], cloudy: [4, 12], rain: [3, 9], storm: [2, 5], snow: [4, 12] } as const;
export const WEATHER_INTENSITY_RANGE = [0.4, 1.0] as const;
// Rows: from; columns in order [clear, cloudy, rain, storm, snow]
export const WEATHER_TRANSITIONS = {
  warm: {
    clear:  [0.45, 0.40, 0.12, 0.03, 0],
    cloudy: [0.40, 0.20, 0.30, 0.10, 0],
    rain:   [0.20, 0.45, 0.20, 0.15, 0],
    storm:  [0.10, 0.40, 0.50, 0,    0],
    snow:   [0,    1.00, 0,    0,    0],
  },
  winter: {
    clear:  [0.40, 0.35, 0, 0.05, 0.20],
    cloudy: [0.25, 0.25, 0, 0.10, 0.40],
    rain:   [0,    0,    0, 0,    1.00],
    storm:  [0.10, 0.40, 0, 0,    0.50],
    snow:   [0.15, 0.40, 0, 0.15, 0.30],
  },
} as const;
export const WEATHER_EFFECTS = {
  clear:  { outdoorWork: 1.0,  farmGrowth: 1.0,  walk: 1.0,  energyDecay: 1.0,  wellMult: 1.0 },
  cloudy: { outdoorWork: 1.0,  farmGrowth: 1.0,  walk: 1.0,  energyDecay: 1.0,  wellMult: 1.0 },
  rain:   { outdoorWork: 0.85, farmGrowth: 1.25, walk: 0.9,  energyDecay: 1.0,  wellMult: 1.0, rainBarrels: true },
  storm:  { outdoorWork: 0.6,  farmGrowth: 0.6,  walk: 0.75, energyDecay: 1.15, wellMult: 1.0, rainBarrels: true, damageChancePerHour: 0.03 },
  snow:   { outdoorWork: 0.8,  farmGrowth: 0,    walk: 0.8,  energyDecay: 1.2,  wellMult: 0.8 },
} as const;

// ===== EVENTS =====
export const EVENT_ROLL = { maxDailyEvents: 1 } as const;
export const EVENTS = {
  traderVisit:      { positive: true,  p: 0.10, minDay: 3, decision: true, windowHours: 12,
                      offers: [ { give: { wood: 30 }, get: { food: 25 } },
                                { give: { food: 25 }, get: { stone: 20 } },
                                { give: { wood: 30, stone: 10 }, get: { tools: 4 } },
                                { give: { food: 30 }, get: { wood: 35 } },
                                { give: { wood: 20 }, get: { water: 25 } } ] },
  wanderer:         { positive: true,  p: 0.07, minDay: 2, maxPop: 28, pairChance: 0.4, decisionIfNoBeds: true, windowHours: 12 },
  harvestFestival:  { positive: true,  p: 0.35, season: 'autumn', oncePerYear: true, minFoodPerPop: 6, foodCostPerPop: 2,
                      socializeHours: 4, decision: true, windowHours: 6 },
  bountifulHarvest: { positive: true,  p: 0.06, notWinter: true, needsFarm: true, durationHours: 48, farmMult: 1.5 },
  richVein:         { positive: true,  p: 0.05, needsMine: true, stonePerTile: 40 },
  supplyCache:      { positive: true,  p: 0.05, minDay: 2, rewards: [ { wood: 30 }, { stone: 20 }, { food: 25 }, { tools: 3 } ] },
  wolves:           { positive: false, p: 0.06, minDay: 4, durationHours: 24, attackDamage: 35, attackMinDistance: 10, gatherMult: 0.8 },
  sickness:         { positive: false, p: 0.05, minDay: 5, extraPIfExposed: 0.05, infectFraction: 0.25, durationHours: 36 },
  cropBlight:       { positive: false, p: 0.04, notWinter: true, needsFarm: true, durationHours: 48 },
  drought:          { positive: false, p: 0.08, season: 'summer', durationHours: 72, farmMult: 0.6, wellMult: 0.7 },
  wildfire:         { positive: false, p: 0.20, requiresActive: 'drought', rollHour: 14, minDistanceFromTownCenter: 8, radius: 3 },
  stormDamage:      { positive: false, pPerStormHour: 0.03 },
  toolsBreak:       { positive: false, p: 0.04, minTools: 4, lossFraction: 0.25 },
  coldSnap:         { positive: false, p: 0.20, season: 'winter', durationHours: 48, energyDecayMult: 1.3, wellMult: 0.5 },
} as const;

// ===== DIFFICULTY =====
export const DIFFICULTY = {
  relaxed: { needDecayMult: 0.85, productionMult: 1.15, healthDamageMult: 0.75, negEventMult: 0.6, posEventMult: 1.3, growthMult: 1.25, graceDays: 5 },
  normal:  { needDecayMult: 1.0,  productionMult: 1.0,  healthDamageMult: 1.0,  negEventMult: 1.0, posEventMult: 1.0, growthMult: 1.0,  graceDays: 3 },
  harsh:   { needDecayMult: 1.15, productionMult: 0.9,  healthDamageMult: 1.25, negEventMult: 1.4, posEventMult: 0.8, growthMult: 0.8,  graceDays: 2 },
} as const;

// ===== WARNINGS =====
export const WARNINGS = {
  foodLowDays: 1, waterLowDays: 1, winterFoodDays: 5, storageFullFraction: 0.95,
  lowHealth: 30, idleSettlers: 2, idleHours: 2,
} as const;

// ===== NAMES (replace constants.ts placeholders) =====
export const SETTLER_FIRST_NAMES = ['Abel','Ada','Amos','Annie','August','Beau','Bessie','Calvin','Clara','Cody',
  'Cora','Dakota','Della','Eli','Etta','Ezra','Flora','Gus','Hattie','Hank','Hazel','Ira','Jesse','June','Levi',
  'Lottie','Mae','Mattie','Ned','Nell','Oren','Opal','Pearl','Reuben','Rosa','Silas','Tess','Wade','Willa','Wyatt'];
export const SETTLER_LAST_NAMES = ['Abernathy','Barlow','Blackwood','Bramble','Calloway','Cartwright','Colter',
  'Crane','Dawson','Eastwood','Fairbanks','Garrett','Hale','Hollister','Ingram','Jessup','Keller','Langley',
  'McCrae','Merritt','Noble','Pickett','Redford','Sawyer','Shelby','Tanner','Thornton','Walker','Whitlock','Yates'];
```

---

## Appendix A: Map presets (guidance for world generation)

All presets must satisfy the **start guarantees** around the 3×3 town center, which sits on Grass or Sand:
≥ 10 Forest tiles within 8 (forage), ≥ 3 Hills/Mountain within 8 (forage), ≥ 40 Grass tiles within 10 (farm
space), any water within 15, and a valid lumber camp and mine site within 15. If a candidate start fails, try the
next candidate. Target land terrain shares are given as fractions of land tiles.

| Preset | Water share | Forest | Hills | Mountain | Character |
|---|---|---|---|---|---|
| `continent` | 25% (ocean ring + lakes) | 25% | 12% | 5% | Balanced default. Wide grassland. |
| `archipelago` | 55% | 25% | 8% | 2% | 4–7 islands linked by Shallow-water fords. The start island has ≥ 600 land tiles. Fishing docks shine; farm space is tight. |
| `highlands` | 10% (lakes) | 20% | 30% | 15% | Abundant stone, little flat Grass, long walks. Wells off-water are common. |
| `riverValley` | 15% (one river, Deep core and Shallow banks, plus fords) | 25% | 12% | 10% (both valley sides) | Lush Grass along the banks. Wells near the river get the bonus. Natural chokepoints. |

## Appendix B: Contract additions requested

The following are needed by this design and are not yet in `src/sim/types.ts`. All are additive and need lead
sign-off.

- `Settler`: `xp: Record<SkillType, number>`; `moodlets: {id: string; value: number; hoursLeft: number | null}[]`;
  `status: {dehydrated: boolean; sickHoursLeft: number; drinkCooldownHours: number; breakingHours: number;
  hoursWorkedSinceWake: number; sulkHoursLeft: number; lastSocializedTick: number | null; damageLog:
  Record<string, number>}`; `toolDurability: number | null`; `hoursSinceDecision: number`.
- `RandomEventKind`: `wolves`, `stormDamage`, `richVein`, `supplyCache`, `harvestFestival`.
- `PlayerCommand`: `{type: 'resolveEvent'; eventId: number; accept: boolean}`; `GameState.pendingDecisions:
  {eventId: number; kind: RandomEventKind; payload: object; hoursLeft: number}[]`.
- `GameState.progress: {objectivesDone: string[]; unlocked: BuildingType[]; toolsCrafted: number;
  festivalYear: number | null; lastDeathTick: number | null}`; a "victory acknowledged" flag.
- `BuildingDef.requiresNearby.minCount: number`.
- `BuildingType`: `fishingDock` (optional).
- `Building` needs nothing new: damage reuses `status: 'construction'` with zero `required`.
