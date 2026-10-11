# Frontier Colony — Development Plan

The lead coordinator (main Claude Code session) owns this plan. Each work package is handed to a real
Claude Code subagent launched with the Agent tool. Its `model` parameter picks the model tier.

## Team and model assignment

| # | Agent | Model alias requested | Resolves to | Owns (write access) |
|---|---|---|---|---|
| 0 | Lead coordinator | (session model) | `claude-opus-5-5` | plan/progress docs, integration, final verification |
| 1 | Systems Architect | `opus` | Opus 5.5 | scaffold, `src/sim/types.ts`, contracts, `CLAUDE.md`, SPEC architecture |
| 2 | Game Designer | `opus` | Opus 5.5 | `docs/GAME_DESIGN.md`, balance numbers (`src/sim/balance.ts` after M1) |
| 3 | Simulation Engineer | `sonnet` | Sonnet 5.5 | `src/sim/**` (except `types.ts` contract changes need lead sign-off) |
| 4 | Graphics Engineer | `sonnet` | Sonnet 5.5 | `src/render/**` |
| 5 | UI/UX Engineer | `sonnet` | Sonnet 5.5 | `src/ui/**`, `src/styles/**`, `src/store/**` |
| 6 | QA Engineer | `haiku` | Haiku 5.5 | `tests/**`, `e2e/**` |
| 7 | Code Reviewer | `opus` | Opus 5.5 | read-only; produces review reports in `docs/reviews/` |

All four requested model tiers (Opus 5.5, Sonnet 5.5, Haiku 5.5) are available in this environment. No
substitution is needed. Each agent is asked to report the model ID from its own system prompt as a check.

## File ownership rule

Parallel agents never write to the same directory. `package.json`, `vite.config.ts`, `tsconfig*.json`,
`src/main.tsx` and `src/game/**` (the loop that glues sim, renderer and store together) belong to the
architect in M1 and to the lead coordinator after that. An agent that needs a dependency or a contract
change asks for it in its report instead of editing shared files.

## Milestones

| Milestone | Work packages (parallel within a wave) | Acceptance criteria |
|---|---|---|
| M1 Foundation | Architect: scaffold, contracts, test config, app shell. Designer (parallel): game design + balance doc | `npm install`, `npm run dev`, `npm test`, `npm run build`, `npm run test:e2e` all succeed; contracts compile |
| M2 World Generation | Sim: seeded RNG, noise, terrain/biomes, map presets. Graphics: iso terrain, camera pan/zoom. UI: HUD shell, new-game screen | Same seed → identical map (unit test); map renders; camera moves and zooms |
| M3 Settler Intelligence | Sim: settlers, needs, A* pathfinding, utility AI. Graphics: animated settlers. UI: settler list + inspector | Settlers move around obstacles and choose tasks without input; activity labels shown |
| M4 Economy & Construction | Sim: resources, buildings, placement rules, construction, production/consumption. Graphics: buildings, construction anim, ghost placement. UI: build menu, resource bar with rates | Player places a building, settlers build it, it produces resources |
| M5 Gameplay | Sim: survival/failure, population growth, random events, weather effects, priorities, save/load. UI: priorities panel, events log, save/load, game-over | Colony can grow or fail; events fire; save→load round-trips |
| M6 Visual Polish | Graphics: day/night lighting, weather particles, gather effects. UI: tooltips, feedback toasts, styling | Reviewer and lead check screenshots |
| M7 Testing & Optimization | QA: unit + e2e suite. Reviewer: full review. Engineers fix findings. Lead: profiling | All tests green; no critical review findings open |
| M8 Release | Lead: production build, docs, BENCHMARK.md, README | Fresh `npm ci && npm run build` succeeds; docs complete |

The reviewer evaluates after M1, after M4 (core systems) and after M6 (full game).
QA writes tests after each wave and runs the whole suite at M7.

## Coordination mechanics

- Agents are continued with `SendMessage` between milestones, so they keep their context.
- Every agent ends with a report: files changed, verification commands run and their results, known
  gaps, and its own model ID.
- The lead runs `npm run typecheck && npm test && npm run build` after each wave before marking a
  milestone done in `PROGRESS.md`.
