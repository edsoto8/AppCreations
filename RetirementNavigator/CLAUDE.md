# CLAUDE.md — Retirement Navigator

Local-first retirement planning and forecasting web app (pnpm workspace: `packages/engine` + `apps/web`).

**Read first, every session:** `docs/BRIEF.md` (the authoritative build brief), this file, then
`docs/STATUS.md` (current milestone, handoff, frozen contracts, open risks).

Run all commands from this folder (`RetirementNavigator/`), not the repo root.

## Commands
- `pnpm install` then `pnpm dev` (http://localhost:5173)
- `pnpm verify`: typecheck, lint, format check, unit tests with coverage, build, E2E (Playwright on `vite preview`)
- `pnpm test` / `pnpm lint` / `pnpm format` / `pnpm e2e`
- `pnpm --filter @rn/web screenshots`: PNGs in `apps/web/test-results/screens/` (read them back)
- E2E uses the preinstalled Chromium in the cloud container; locally run `pnpm --filter @rn/web exec playwright install chromium`

## Conventions
- Money is integer cents (`Cents`) at engine boundaries, in storage and in exports; float64 inside.
  No `toFixed` for logic.
- Rates are decimals. Nominal and real are distinct branded types.
- Age in year Y = Y − birthYear. Retirement starts January 1 of the retirement-age year.
- Engine calls return `EngineResult<T>` (`ok | unverified | invalid`) and never throw for user data.
- Rule values are `Verified<T>`. Never fill a value from memory. Null means unverified, and the engine
  never substitutes a default.
- TS strict + `noUncheckedIndexedAccess`. Pin exact dependency versions (TypeScript stays on 6.0.x until
  typescript-eslint supports 7).
- UI primitives are shadcn/ui-style source files in `apps/web/src/components/ui/`, written by hand on `radix-ui`
  (the shadcn registry is unreachable from the cloud container).

## Boundaries
- `packages/engine`: pure TypeScript. No React, DOM, `idb`, `Date.now()` or `Math.random()`.
- Frozen contracts: `packages/engine/src/domain/*` and `packages/engine/src/api.ts`
  (`CONTRACT_VERSION`). Changing them requires a version bump and a STATUS.md note, and only the
  main agent makes the change.
- The main agent owns `package.json` files, the lockfile, tsconfigs, the ESLint config and the barrel
  `index.ts`.
- Rules sources are limited to irs.gov, ssa.gov and federalregister.gov.
