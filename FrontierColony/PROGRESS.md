# Frontier Colony — Progress

Shared progress tracker. The lead coordinator updates it after each wave, once that wave's checks have
been run. A milestone is marked done only after its acceptance criteria were verified (see PLAN.md).

## Milestone status

| Milestone | Status | Verified by |
|---|---|---|
| M1 Foundation | done | lead: `npm ci`, typecheck, 42/42 unit, build, 1/1 e2e |
| M2 World Generation | done (renderer polish still in progress) | lead: typecheck, 212/212 unit, build; worldgen determinism + 200-seed start-site tests |
| M3 Settler Intelligence | done | lead: 212/212 unit incl. A* vs Dijkstra, 2-day autonomy, starvation, mid-path save determinism; screenshot review |
| M4 Economy & Construction | in progress (UI done; sim hauling/production running) | |
| M5 Gameplay | pending | |
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
