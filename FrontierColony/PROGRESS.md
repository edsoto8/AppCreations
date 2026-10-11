# Frontier Colony — Progress

Shared progress tracker. The lead coordinator updates it after each wave, once that wave's checks have
been run. A milestone is marked done only after its acceptance criteria were verified (see PLAN.md).

## Milestone status

| Milestone | Status | Verified by |
|---|---|---|
| M1 Foundation | done | lead: `npm ci`, typecheck, 42/42 unit, build, 1/1 e2e |
| M2 World Generation | done (renderer polish still in progress) | lead: typecheck, 212/212 unit, build; worldgen determinism + 200-seed start-site tests |
| M3 Settler Intelligence | done | lead: 212/212 unit incl. A* vs Dijkstra, 2-day autonomy, starvation, mid-path save determinism; screenshot review |
| M4 Economy & Construction | done | lead: typecheck, 364/364 unit (incl. economy balance runs), build, e2e 13/15 (2 test-timing issues, routed to QA); screenshot review |
| M5 Gameplay | done (sim + UI) | lead: same run; 30-day soaks 8/8 normal survive, 6/8 harsh |
| M6 Visual Polish | pending | |
| M7 Testing & Optimization | pending | |
| M8 Final Release | pending | |

## Log

- Environment inspected: Node 22.22, npm 10.9, Chromium 1194 pre-installed (pinned `@playwright/test@1.56.1`).
  Agent tool model aliases opus / sonnet / haiku (all Claude 5.5) and fable (Fable 5.1) available.
- PLAN.md written. Wave 1 launched: Systems Architect (opus) and Game Designer (opus) in parallel.
- Game Designer (opus, `claude-opus-5-5`) finished `docs/GAME_DESIGN.md` (~13k words, 16 sections plus a
  constants appendix and a day-by-day balance proof). Subagent usage: 196k tokens, 13 tool calls, 20.7 min.
  Lead decision on Appendix B contract additions: all approved except the optional `fishingDock` (deferred).
- Systems Architect (opus, `claude-opus-5-5`) finished M1: scaffold, contracts (`src/sim/types.ts`,
  `src/render/types.ts`, store, controller, save), stub sim/renderer, CLAUDE.md, SPEC.md. Usage: 226k tokens,
  58 tool calls, 25.1 min. Added the approved Appendix B contract fields.
- Lead verification of M1: `npm ci` ok, `npm run typecheck` ok, `npm test` 42/42, `npm run build` ok,
  `npm run test:e2e` 1/1. Open questions resolved: `src/shared/iso.ts` may be edited by the Graphics Engineer
  (lead-owned otherwise); construction will reserve materials and require hauling (Simulation Engineer, M4);
  `fishingDock` deferred.
- Wave 2 launched (M2 World Generation), in parallel: Simulation Engineer (sonnet) — seeded noise worldgen +
  4 presets + start site; Graphics Engineer (sonnet) — chunked iso terrain, camera; UI/UX Engineer (sonnet) —
  menu, HUD, panel framework, save/load panel; Code Reviewer (opus) — review of the M1 commit.
- Code Reviewer (opus) M1 review: 0 critical, 5 major, 14 minor, 9 nit (`docs/reviews/M1-review.md`). Usage: 234k
  tokens, 32 tool calls, 11.0 min. Lead fixed MAJ-2 (loop fault isolation, validated saves, autosave backup) and
  MIN-9 (no reused e2e server), added the engine-independent math rule (MIN-7) to CLAUDE.md. MAJ-1/3/4/5 and
  MIN-1..4/8 routed to the Simulation Engineer with its M3 brief.
- Simulation Engineer (sonnet, `claude-sonnet-5-5`) finished sim M2: gradient noise, 4 presets, start-site search
  with guarantees, founder generation, walk-region labelling; 63 sim tests; largest map ≤112 ms worst case.
  Usage: 253k tokens, 37 tool calls, 15.5 min. Continued straight into sim M3 (needs, A*, utility AI).
- UI/UX Engineer (sonnet, `claude-sonnet-5-5`) finished UI M2: main menu + New Game (preset cards), HUD top bar
  with rates/tooltips, panel/tooltip/toast framework, working Save/Load panel, hotkeys, Esc menu; 50 new tests.
  Usage: 266k tokens, 67 tool calls, 19.7 min. Lead applied its requests (smoke test `/?quickstart`, autosave
  guarded by `gameStarted`). Continued into UI M3+M4 (settler roster/inspector, build menu, building inspector).
- Simulation Engineer finished sim M3 + M1-review contract fixes: A* (binary heap, region early-reject), needs
  with 24 moodlets, utility AI, semantic `validateGameState` with fuzz tests, `assertInvariants`. 0.047 ms/tick
  for 30 settlers on a large map. Lead approved its `world.revision` rule (structural changes only) and amended
  CLAUDE.md; Graphics Engineer told to redraw resources from `tileChanged` events. Cumulative usage: 470k tokens,
  87 tool calls, 39.3 min (M2+M3). Continued into sim M4.
- UI/UX Engineer finished UI M3+M4: settler roster with procedural avatars, live settler inspector, hover card,
  build catalogue with unlock state, placement hint bar, building inspector with cancel/demolish, net rates from
  hourly samples. Cumulative usage: 399k tokens, 120 tool calls, 39.4 min. Continued into UI M5.
- Lead: snapshot now carries the selected entity's detail; `buildingPlaced` toast. Integration commit 8eb93b6
  (typecheck, 212/212 unit, build green).
- QA Engineer (haiku) launched: Playwright e2e suite + Vitest soak/regression tests in `e2e/` and `tests/qa/`.
- Graphics Engineer (sonnet, `claude-sonnet-5-5`) finished renderer M2: procedural canvas-drawn atlas, chunked
  terrain with render groups and culling, shoreline foam, 3 tree species, depletion via `tileChanged`, eased
  camera with cursor-anchored zoom, drag fling, pinch, keyboard pan. ~2 ms JS per frame at any zoom on 128×128.
  Usage: 365k tokens, 85 tool calls, 42.8 min. Continued into renderer M3+M4 (animated settlers, building art,
  construction, placement ghost, gather feedback) plus a fix for 1-level elevation steps that read as fences.
- UI/UX Engineer finished UI M5: priorities panel, colony log with unread badge, decision cards with countdown,
  objectives tracker, warnings strip, game-over/victory overlay, season/weather tooltips, stats sparklines;
  112 UI/store tests. Cumulative usage: 504k tokens. Open items routed to sim: document decision payload keys,
  "lasted 1 days" grammar, decision window length; worldgen 300 ms timing test flaked under parallel load.
- Simulation Engineer finished sim M4: material reservation + hauling, builders limited by delivered share,
  recipe production (farm seasonal, well, workshop), gatherer buffers, tile/haul/work-slot reservations, storage
  cap, tools, objectives/unlocks/victory, stats. Fixed 3 bugs found while playtesting (collapse/hunger task
  thrash starved settlers with full stores; gatherers ignored bedtime; placement could wall in the town center).
  Balance (normal, sensible script): all builds 0.2–0.6 days; 16/16 preset×seed runs kept 5 settlers alive 16
  days; neglect (no farm) first death day 9.8 vs design day 9–10. 0.113 ms/tick for 30 settlers.
  Usage this round: 117k tokens, 38 tool calls, 17.3 min. Continued into sim M5.
- QA Engineer (haiku, `claude-haiku-5-5`) added 15 Vitest regression tests (`tests/qa/`: 12-way soak with NaN
  walker, save/load equivalence, junk commands; all pass) and 14 Playwright specs in `e2e/` with a console-error
  fixture. e2e run was 0/15 because of a mid-edit renderer crash (settler textures undefined in the Graphics
  Engineer's uncommitted work), not a committed defect; to be re-run after the graphics wave. Usage: 200k
  tokens, 65 tool calls, 16.8 min.
- Simulation Engineer finished sim M5: weather Markov chain, 12 random events + storm/wildfire damage via repair
  flow, typed decision payloads with `windowHours`, population growth, forest regrowth/spread, priorities verified
  to gate jobs, difficulty multipliers. 30-day soaks: normal 8/8 survive winter and reach victory ~day 20–25;
  harsh 6/8 survive. Cumulative usage: 702k tokens, 102 tool calls, 40.4 min (M5 round).
- Graphics Engineer finished renderer M3+M4: settler sprite rigs with walk cycle and per-activity poses/tools/
  carried goods, baked art for all 8 buildings (3 house variants, 6 farm stages), output piles, chimney smoke,
  construction (pad, blueprint, rise, scaffolding, material piles), placement ghost, floating +N labels, tree
  felling, pooled particles; 41 render unit tests. Cumulative usage: 588k tokens, 173 tool calls, 84 min.
- UI follow-ups: affordability from `getAvailableStock`, reserved stock in tooltips, mirrored constants removed.
- Lead e2e run on an idle machine: 13/15. Failures are test-side: save/load reads the clock after load resumes the
  game; the speed test samples a 1 s window while headless SwiftShader renders ~1–3 fps.
- Wave M6 launched: Graphics (day/night, weather, seasons, event visuals, hills fix, GPU cost), UI (minimap,
  onboarding, settings, typed decisions, responsive/a11y), QA (e2e fixes + M5 coverage), Code Reviewer (opus)
  core-systems review of 87a094e.
- Core-systems review (`docs/reviews/M5-review.md`): 1 critical, 3 major, 11 minor, 7 nit. Verdict "not release
  ready" until CRIT-1 (rest deadlock starves colonies with food in farm buffers), MAJ-1 (dangling wolves target
  blocks all saves), MAJ-2 (farming outscores hauling food in famine) are fixed; MAJ-3 victory too early (day
  14–20 vs design 22–30). Reviewer usage: 388k tokens, 86 tool calls, 21.8 min.
  Routing: Simulation Engineer — CRIT-1, MAJ-1, MAJ-2, MIN-1..6, new `Activity.indoorsBuildingId` contract field;
  Game Designer (resumed) — amend §5.4/§5.5, retune §8 growth in `docs/balance/M6-tuning.md`; Graphics — use
  the new field instead of label regex; QA — TEST-1/3/4/5. Lead fixed MIN-7 (save metadata keys, fast listing),
  MIN-8 (ghost refresh), MIN-9 (debug handle gated to dev / `VITE_E2E=1` / `?debug`).
- Simulation Engineer fixed CRIT-1, MAJ-1, MAJ-2, MIN-1..6 and nits 1/2/4 with 25 regression tests
  (`tests/sim/review.test.ts`); added `Activity.indoorsBuildingId` and a `goodsLost` event. Growth retune waits on
  the Game Designer's `docs/balance/M6-tuning.md`.
- Lead: `SAVE_SCHEMA_VERSION` 1 → 2 with a v1→v2 migration in `src/game/save.ts` (+ test). Checkpoint 78c1e81:
  typecheck clean, 426 unit tests pass + 3 expected-fail (QA pace-bound soaks pending the retune), build ok.
- QA round 2: strict invariants + resource ledger (8 tests), pace-bound soak (5 pass, 3 `it.fails` pending
  retune), CRIT-1/MAJ-1 regressions (4 pass), e2e specs for M5 features and cancel/demolish, sturdier speed and
  save/load specs. QA twice ended its turn before running the full e2e suite (it backgrounds long runs); the
  lead will run the e2e suite after the M6 wave instead. Rain collection lacks a `resourceProduced` event (minor).
- Game Designer (resumed) amended GAME_DESIGN §4.3/§5.4/§5.5/§8/§11 and wrote `docs/balance/M6-tuning.md`:
  rest only when regeneration is possible, buffer eating/drinking, famine work lock, winter growth pause, victory
  gated on "Survive the Winter". Its 32-game headless model: normal victory p10/median/p90 = day 22/26/30, 0 lost;
  harsh median day 42, 3/32 lost. Usage this round: ~113k tokens, 35 tool calls, 28 min. Simulation Engineer
  applying the tuning.
- UI/UX Engineer finished UI M6: typed decision payloads, minimap (canvas, click/drag pan, viewport rect), 7-step
  coach-mark tour that advances on player action, How to Play panel, real Settings (UI scale, tooltips, autosave,
  replay tutorial), toast grouping, number roll-up, responsive pass at 1920/1280/1024 widths, a11y labels.
  Caught and fixed a React #185 selector loop. Cumulative usage: 665k tokens, 99 tool calls this round, 58.5 min.
  Lead applied its requests: autosave honours the pref; `centerOn(tile, { animate })`.
- Simulation Engineer applied the M6 tuning: 32/32 normal games won (victory day min 21.0, median 25.3, max 35.3),
  harsh 25/32 won, 4 lost; normal population medians 10/16/23.5 at days 10/20/30. Exported `DAY_PHASES`,
  `MOOD_BANDS`. Lead flipped QA's 3 pace `it.fails` to plain `it` (they pass).
- Lead: worldgen timing test now asserts on the fastest of 5 samples (CPU contention only adds time; the median
  flaked at >300 ms with 5 agents running). e2e builds to its own `dist-e2e/` after QA found a shared-`dist` race
  where another agent's plain build removed the debug handle mid-run.
- QA round 2 final: `npm test` 41 files / 452 passed. Two full e2e runs on the isolated `dist-e2e` build: 23/25
  each; failures were build.spec (test clicked the town-center tile; fixed by clicking the footprint, committed)
  and smoke.spec (5–6 ticks in 5 s at 1x — headless SwiftShader at ~1 fps under load; renderer GPU cost is being
  reduced in M6). Cumulative QA usage: 427k tokens, 140 tool calls, 78.7 min.
