# Frontier Colony — Multi-Agent Benchmark Report

This records how Frontier Colony was built by a team of Claude Code subagents. A lead coordinator session
planned the work, wrote the briefs, integrated the results and verified every milestone. Every number below was
measured or reported by a tool during the run. Nothing is estimated. Where a metric was not available, it says so.

## 1. Environment and models

| Item | Value |
|---|---|
| Harness | Claude Code (cloud session, CLI 2.1.296), Agent tool with `model` override, `SendMessage` to resume agents |
| Lead coordinator model | `claude-opus-5-5` (confirmed via the session API: configured and last-served model) |
| Model aliases available to the Agent tool | `opus` → Claude Opus 5.5, `sonnet` → Claude Sonnet 5.5, `haiku` → Claude Haiku 5.5, `fable` → Claude Fable 5.1 (not used) |
| Requested-but-unavailable models | None. Every role got the tier the brief asked for, so no substitution was needed. |
| Machine | 4 vCPU Linux container, Node 22.22, npm 10.9, headless Chromium 141 (Playwright 1.56.1) with SwiftShader software WebGL |
| Wall-clock | Environment inspection 19:53 UTC, final verification 01:05 UTC (about 5 h 12 min, including three review/fix rounds) |

Each agent was asked to report the model ID in its own system prompt. All of them did.

| # | Role | Requested | Model ID self-reported by the agent |
|---|---|---|---|
| 0 | Lead coordinator | (session) | `claude-opus-5-5` |
| 1 | Systems Architect | most capable 5.5 → `opus` | `claude-opus-5-5` |
| 2 | Game Designer | most capable 5.5 → `opus` | `claude-opus-5-5` |
| 3 | Simulation Engineer | Sonnet 5.5 → `sonnet` | `claude-sonnet-5-5` |
| 4 | Graphics Engineer | Sonnet 5.5 → `sonnet` | `claude-sonnet-5-5` |
| 5 | UI/UX Engineer | Sonnet 5.5 → `sonnet` | `claude-sonnet-5-5` |
| 6 | QA Engineer | Haiku 5.5 → `haiku` | `claude-haiku-5-5` |
| 7 | Code Reviewer (3 independent instances: M1, M5, M7) | most capable 5.5 → `opus` | `claude-opus-5-5` |

## 2. Who did what

| Agent | Work |
|---|---|
| Lead | Environment inspection, PLAN.md, file-ownership rules, all agent briefs, contract sign-offs, integration commits. Fixed loop fault isolation, validated saves, save schema v2 and migration, save metadata keys, autosave backup and restore, debug-handle gating, isolated e2e build dir, controller APIs (`getCamera`, `centerOn` options). Ran independent verification each milestone, a browser playtest, README, BENCHMARK. |
| Systems Architect | M1: Vite/React/Pixi/Zustand/Vitest/Playwright scaffold with pinned compatible versions. Contracts: `GameState`, `PlayerCommand`, `SimEvent`, `GameRenderer`. Seeded RNG, iso math, fixed-step `GameController`, versioned localStorage saves, stub sim and renderer, CLAUDE.md, SPEC.md. M8: refreshed SPEC.md and CLAUDE.md against the final code. |
| Game Designer | `docs/GAME_DESIGN.md` (~14k words): time model, 14 traits, needs, utility-AI formulas, economy with a day-by-day balance proof, buildings, growth, weather Markov tables, 12 events, objectives, difficulty, and a constants appendix. Round 2: design rulings for the review's starvation, haul and pacing findings, plus a retune verified with 96 headless games (`docs/balance/M6-tuning.md`). |
| Simulation Engineer | All of `src/sim`: gradient-noise world generation with 4 presets and validated start sites, A* (binary heap, region early-reject), needs and moodlets, utility AI with commitment and interrupts, hauling with material reservation, production chains, tools, storage caps, objectives and victory, weather, events and decisions, growth, wildfire, a semantic save validator with fuzz tests. Fixed every sim review finding. |
| Graphics Engineer | All of `src/render`: procedural Canvas-2D texture atlas, chunked terrain (later baked RenderTextures with skyline meshes and an occluder pool), settler sprite rigs with per-activity poses, art for all 8 building types, construction stages, placement ghost, particles and floating text, day/night lighting, weather, seasons, event effects. |
| UI/UX Engineer | All of `src/ui`, `src/store`, `src/styles`: "dusk glass and brass" design system, main menu and New Game, HUD with rates and tooltips, panels (build, settlers, priorities, log, stats, save/load, settings, help), inspectors, decision cards, objectives, warnings, end screens, minimap, guided tour, prefs, responsive and a11y passes. |
| QA Engineer | `tests/qa` (soak across presets × difficulties, NaN walker, save/load equivalence, junk commands, strict invariants with a resource ledger, pace-bound soaks, review regressions), and most of `e2e/` (menu, speed, determinism, save/load incl. corrupt saves, build, settlers, autonomy, M5 features, cancel/demolish). |
| Code Reviewer | Three reviews: `docs/reviews/M1-review.md`, `M5-review.md`, `M7-release-review.md`. Each finding was checked with throwaway probe tests. |

## 3. Major architectural decisions

1. **Pure, deterministic simulation** (`src/sim`). There is no DOM, no `Math.random`, no `Date`, and only IEEE-exact math (sin, cos, pow, hypot and similar are banned; a unit test enforces it). One plain-JSON `GameState` makes save/load `JSON.stringify` plus a versioned envelope. The same seed and commands give the same game, and tests check this by deep equality, including across save/load mid-path.
2. **Fixed timestep, no dt.** `stepGame(state)` advances exactly one 0.1 s tick. The controller runs 0..n ticks per frame by speed, with fault isolation: an exception pauses the game and disables autosave.
3. **Strict module boundaries.** sim ← game → render / store → ui, with a dependency table in CLAUDE.md. React never holds `GameState`: it reads a 150 ms throttled snapshot. The renderer reads state directly each frame.
4. **Settler-side single source of truth** for home and workplace (from review M1 MAJ-3). Building worker lists are derived, which removed a class of dangling-reference bugs.
5. **`world.revision` only for structural changes.** Resource depletion arrives as `tileChanged` events, so chopping a tree doesn't rebuild the map.
6. **Procedural art only.** Canvas-2D drawing baked into atlases at startup means no asset licensing and a single bundle. The M6 GPU work then baked whole chunks plus their trees and rocks into RenderTextures, cutting overdraw from 5.19 to 1.34.
7. **File ownership per agent** (directory-level), so parallel agents never wrote the same file. Contract changes needed lead sign-off.

## 4. Milestones

| Milestone | Agents (parallel within a wave) | Result | Verified by the lead with |
|---|---|---|---|
| M1 Foundation | Architect ‖ Designer | done | `npm ci`, typecheck, 42/42 unit, build, 1/1 e2e |
| M2 World Generation | Sim ‖ Graphics ‖ UI ‖ Reviewer (M1) | done | 212/212 unit (determinism, 200 start-site generations), screenshots |
| M3 Settler Intelligence | Sim ‖ UI (M3+M4 UI) | done | A* vs Dijkstra on 150 maps, 2-day autonomy, starvation, mid-path save determinism |
| M4 Economy & Construction | Sim ‖ Graphics (M3+M4 art) ‖ UI (M5 UI) ‖ QA | done | 364/364 unit incl. economy balance runs; e2e 13/15 (2 test-side issues, fixed) |
| M5 Gameplay | Sim ‖ Graphics | done | 30-day soaks: normal 8/8 survive, harsh 6/8 |
| M6 Visual Polish | Graphics ‖ UI ‖ QA ‖ Reviewer (core systems) → Sim + Designer fix round | done | 456/456 unit, e2e 25/25 twice in a row on an idle machine |
| M7 Testing & Optimization | Reviewer (release) → Sim ‖ Graphics ‖ UI ‖ Lead fix round | done | see §5 |
| M8 Release | Architect (docs) ‖ Lead | done | clean `npm ci && npm run build`, docs |

M2–M4 overlapped across agents: the sim engineer's M3 ran while graphics was still on M2. Each milestone was
marked done only after the lead's own run of its acceptance checks.

## 5. Tests executed (final)

All runs below are the lead's own final runs after a clean `rm -rf node_modules && npm ci`, on the 4-vCPU container.

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | 63 packages, 0 vulnerabilities, 3.4 s |
| Typecheck (app, tests, configs, e2e) | `npm run typecheck` | 0 errors |
| Unit / integration / soak | `npm test` | **46 files, 487 tests passed, 0 failed** |
| Production build | `npm run build` | ok. JS 973 kB (303 kB gzip), CSS 61 kB |
| Browser e2e (Chromium, SwiftShader) | `npm run test:e2e`, twice back to back | **27/27 passed, both runs** (4.4 min, 4.3 min) |
| Dev server | `npm run dev` | serves HTTP 200 |
| Scripted playtest | production build, seed `playtest-7` | 4 buildings placed and completed by day 3, a newcomer joined, 0 console errors |

The unit tests break down as: `tests/sim` 226 (worldgen, A* vs Dijkstra, needs, AI, economy, gameplay, review
regressions, walled-in sweep, skills and traits, 32-day pace-bound soaks, validator fuzzing, determinism rules),
`tests/qa` 35 (preset × difficulty soaks, strict invariants and resource ledger, save/load equivalence, junk
commands, pace bounds, regressions), `tests/render` 64 (camera, terrain model, occluders, poses, depth keys,
atmosphere, input focus), `tests/ui` 94 and `tests/store` 47 (hotkeys, snapshots, warnings, objectives, tour,
prefs, recovery), `tests/game` 15 (save round-trip, refusal of invalid states, metadata listing, v1→v2 migration,
backup fallback, quota), `tests/shared` 6 (iso math).

The 11 e2e spec files are autonomy, build, buildings (cancel/demolish), determinism, m5 (priorities, decisions,
objectives, log, game over), menu, recovery (halted sim, malformed save), saveload (incl. corrupt slot), settlers,
smoke and speed.

**Balance measurements** (headless, sensible build order):
- **Normal:** 32/32 games won. Victory day min 21.0, median 25.3, max 35.3. Population medians 10 / 16 / 23.5 at days 10 / 20 / 30.
- **Harsh:** 25/32 won, 4 lost.
- **Reviewer's release sweep:** 48 games plus a replay. Settlers trapped by placements went from 11 games to 0, and deaths from 9 to 0.

**Performance:**
- **Simulation:** 0.11 ms per tick with 30 settlers on a large map. 0.33 ms in the reviewer's developed-colony probe.
- **World generation:** the largest map takes 24–40 ms on average.
- **Rendering, headless SwiftShader at 1280×720:** about 11 fps on a static medium map (Graphics Engineer), and 2–5 fps in the lead's playtest right after a 4,500-tick catch-up. **Not measured on a real GPU** (see §7).

## 6. Bugs found and resolved

**Found by the Code Reviewer** (each confirmed with a probe test, then fixed and covered by a regression test):

| Review | Severity counts | Most important findings |
|---|---|---|
| M1 | 0 critical / 5 major / 14 minor / 9 nit | Corrupt saves loaded then crashed every frame (shape-only validator). Autosave could overwrite the only good save with an unloadable one. Settler–building relations stored on both sides (a dangling haul target already existed). Repairs indistinguishable from new construction. Contract gaps. |
| M5 (core systems) | 1 / 3 / 11 / 7 | **Rest deadlock:** starving settlers rested forever beside full farm buffers and whole colonies died. A dead wolf victim blocked all saves for a day. Farming outscored hauling food in a famine. Victory came before the first winter. 700–1,200 wood silently destroyed at the storage cap per game. |
| M7 (release) | 0 / 1 / 7 / 9 | A placement could wall settlers into a pocket where they starved beside full stores (11/48 sweep games). A malformed save summary blanked the app on every launch. Autosave failed near quota because it wrote the backup first. A faulted sim looked like it was running. GL buffers grew until Pixi GC. Arrow keys in panels also panned the camera. |

**Found by the implementing agents and the lead:**
- **Simulation Engineer (while playtesting M4):** a collapse/critical-hunger task thrash starved settlers with full stores; gatherers ignored bedtime for ~6 h; dense placement could wall in the town center.
- **UI Engineer:** a Zustand selector returning a fresh array crashed the tour (React #185).
- **QA:** the shared `dist/` race (another agent's plain build removed the e2e debug handle mid-run), which led to a separate `dist-e2e/`. Also found a missing `resourceProduced` event for rain collection.
- **Lead:** two e2e tests that asserted on timing a software-rendered page cannot meet; a worldgen timing test that flaked under 5 parallel agents (now asserts on the fastest sample); a wrong Node version in the README draft (Vitest 5 needs Node ≥ 22.12).

## 7. Known limitations

- **Real-hardware frame rate is unmeasured.** Every measurement in this environment used software WebGL (SwiftShader). There, the baked-chunk renderer is 3.4× faster than before but still only single-digit fps. SPEC V11 (60 fps on a laptop) is plausible from the CPU profile (~2–6 ms of JS per frame) but unverified.
- **One JS chunk:** 973 kB, 303 kB gzip. There is no code splitting; the size warning is raised to 1,500 kB.
- **No audio.**
- **No births:** population grows only through newcomers and wanderers, per the design.
- **`fishingDock` not built:** the optional extra building was deferred.
- **Visual simplifications:**
  - water depth bands are softened but still tile-granular
  - no tree wind sway
  - the redrawn occluders slightly thicken anti-aliased edges
  - mild aliasing below zoom 0.55
- **Harsh difficulty is hard on purpose:** about 1 in 8 sensible games is lost, and median victory is around day 42.
- **Saves live only in this browser's localStorage:** there is no export/import. A large map at day 30–46 is 224–245k characters. Origins shared with other apps share the ~5 MB quota.
- **The pocket-rescue safety net is covered only by unit tests:** no sweep game ever needed it once placements stopped creating pockets.
- **Duplicated palette:** the settler appearance palette is duplicated in `render/entities/palettes.ts` and the UI avatar, and they must be changed together.
- **Touch is untested:** pinch-zoom is implemented but was never tried on a touch device.
- **Desktop-first layout:** it is verified at 1920×1080, 1280×720 and 1024×768, and narrower widths hide some docks.

## 8. Usage metrics

Token and tool-call figures are the harness's `subagent_tokens`, `tool_uses` and `duration_ms` values at each
agent's final hand-back. The harness doesn't document whether `subagent_tokens` is cumulative billed tokens or
context size at completion; resumed agents sometimes reported a lower figure than a previous round. Treat them as
indicative only. **Monetary cost and the lead session's own token usage were not available** and are not
estimated here.

| Agent (model) | Rounds | Tool calls | Agent time (min) | Largest `subagent_tokens` at hand-back |
|---|---|---|---|---|
| Systems Architect (`opus`) | 2 | 109 | 32 | 353,934 |
| Game Designer (`opus`) | 2 | 48 | 49 | 309,053 |
| Simulation Engineer (`sonnet`) | 8 | 367 | 151 | 702,133 |
| Graphics Engineer (`sonnet`) | 4 | 610 | 265 | 587,983 |
| UI/UX Engineer (`sonnet`) | 7 | 348 | 140 | 688,163 |
| QA Engineer (`haiku`) | 2 | 212 | 134 | 431,437 |
| Code Reviewer (`opus`, 3 instances) | 4 | 237 | 72 | 387,959 |
| **Subagents total** | 29 | **1,931** | **842** (agent-minutes; up to 5 agents ran in parallel) | — |
| Lead coordinator (`opus`) | — | not available | ~312 wall-clock min | not available |

At release the repository has 26,953 lines of TypeScript/TSX in `src` (sim 7,974, render 10,902, ui+store 7,125), 4,369 lines of CSS and 8,097 lines of tests (wc -l, including comments). Docs include GAME_DESIGN.md (~13.9k words), SPEC.md, three review reports and the M6 tuning note.

## 9. Model-specific observations

**Opus 5.5 (Architect, Designer, Reviewer, Lead)**
- **Contracts:** the Architect's M1 contracts survived five milestones of four parallel implementers with only additive changes. The one schema bump was planned (v1→v2 with a migration).
- **Design:** the Designer produced a numerically consistent design and checked its balance arithmetic with a script before handing it over. Its M6 retune landed exactly in the target window: predicted median victory day 26, measured 25.3.
- **Review:** the Reviewer was the most valuable agent per token. Every critical and major bug that would have reached players was found by a reviewer probe, not by the implementers' own tests. That includes the rest deadlock, the save blocker, settlers walled in, and the blank-screen save. Findings were verified, not speculative, and came with root causes.
- **Weakness:** long outputs. The design doc came in at 13k words against a 5–9k target, and reports needed word limits.

**Sonnet 5.5 (Simulation, Graphics, UI)**
- **Throughput:** carried the bulk of the ~27k lines of TypeScript. It reliably honoured ownership boundaries and asked for contract changes instead of making them.
- **Self-verification:** the Graphics and UI engineers repeatedly screenshotted their own work with Playwright, inspected the PNGs and iterated, which is the main reason the visuals are polished. The Simulation Engineer wrote strong tests (A* against an independent Dijkstra, fuzzing, soaks) and found 3 real bugs by playtesting headlessly.
- **Weakness:** blind spots in emergent behaviour across systems. The rest deadlock, the famine haul priority and settlers walled in by placements all passed the engineer's own tests and were caught only by Opus review probes.
- **Process issues:** the Graphics Engineer left preview servers running twice. Mid-edit states briefly broke the shared tree for other agents (expected with a shared working tree).

**Haiku 5.5 (QA)**
- **Strengths:** wrote correct, useful tests quickly when the task was well specified (invariants, ledger, regressions, soak matrix). It diagnosed root causes well (the mid-edit renderer crash, the shared-`dist` race) and refused to loosen assertions to get green, as instructed.
- **Weakness:** long-running orchestration. It repeatedly launched e2e runs in the background and ended its turn before they finished, producing several "incomplete" reports. The lead ran the final e2e verification instead.
- **Fit:** good for writing tests, weaker for supervising multi-minute pipelines.

**Coordination lessons**
- **Briefs:** precise contracts plus directory ownership let 4–5 agents work at once with zero merge conflicts.
- **Shared tree:** a single working tree means agents see each other's half-finished edits. That caused transient typecheck failures and one invalid e2e run. Per-agent worktrees would avoid it, at the cost of more integration work.
- **Independent review:** reviewer probes found the bugs that green test suites missed. Budget at least two review rounds for any simulation-heavy project.
