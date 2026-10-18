# CLAUDE.md — Retirement Navigator

Local-first retirement planning and forecasting web app (pnpm workspace: `packages/engine` + `apps/web`).

**Read first, every session:** `docs/BRIEF.md` (the authoritative build brief), this file, then
`docs/STATUS.md` (current milestone, handoff, frozen contracts, open risks).

Run all commands from this folder (`RetirementNavigator/`), not the repo root.

## Commands
- `pnpm install`
- `pnpm typecheck` (Phase 0). `pnpm dev`, `pnpm verify` and `pnpm bench` arrive in M1 and M6.

## Conventions
- Money is integer cents (`Cents`) at engine boundaries, in storage and in exports; float64 inside.
  No `toFixed` for logic.
- Rates are decimals. Nominal and real are distinct branded types.
- Age in year Y = Y − birthYear. Retirement starts January 1 of the retirement-age year.
- Engine calls return `EngineResult<T>` (`ok | unverified | invalid`) and never throw for user data.
- Rule values are `Verified<T>`. Never fill a value from memory. Null means unverified, and the engine
  never substitutes a default.
- TS strict + `noUncheckedIndexedAccess`. Pin exact dependency versions.

## Boundaries
- `packages/engine`: pure TypeScript. No React, DOM, `idb`, `Date.now()` or `Math.random()`.
- Frozen contracts: `packages/engine/src/domain/*` and `packages/engine/src/api.ts`
  (`CONTRACT_VERSION`). Changing them requires a version bump and a STATUS.md note, and only the
  main agent makes the change.
- The main agent owns `package.json` files, the lockfile, tsconfigs, the ESLint config and the barrel
  `index.ts`.
- Rules sources are limited to irs.gov, ssa.gov and federalregister.gov.
