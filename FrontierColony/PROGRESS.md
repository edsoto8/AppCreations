# Frontier Colony — Progress

Shared progress tracker. The lead coordinator updates it after each wave, once that wave's checks have
been run. A milestone is marked done only after its acceptance criteria were verified (see PLAN.md).

## Milestone status

| Milestone | Status | Verified by |
|---|---|---|
| M1 Foundation | done | lead: `npm ci`, typecheck, 42/42 unit, build, 1/1 e2e |
| M2 World Generation | pending | |
| M3 Settler Intelligence | pending | |
| M4 Economy & Construction | pending | |
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
