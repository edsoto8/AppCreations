# Architecture

## Layout
```
RetirementNavigator/
  packages/engine/   pure TypeScript calculation library (no React, no DOM, no clock, no Math.random)
    src/domain/      Zod schemas + inferred types — the frozen contracts (CONTRACT_VERSION in src/api.ts)
    src/api.ts       frozen public function signatures
    src/rules/       <taxYear>.ts and standing.ts data files (Verified<T>), loader, indexer
    src/<module>/    income, match, limits, accounts, tax, socialSecurity, withdrawals, rmd, survivor,
                     projection, scenario, montecarlo, calculators, insights, io
    reference/       Python reference implementation + golden fixtures
  apps/web/          React + Vite UI (shadcn/ui, Tailwind, Recharts, Zustand, idb)
    src/app/         shell, sidebar, theme, router (HashRouter)
    src/features/    one folder per page
    src/state/       Zustand stores
    src/storage/     IndexedDB repository, schemaVersion, migrations
    src/workers/     forecast.worker.ts, montecarlo.worker.ts
    e2e/             Playwright + axe
  docs/  .claude/
```

## Module boundaries
- The engine has no dependency on `apps/web`, `react*`, `idb` or browser globals. Three things enforce
  this: the engine `tsconfig` (`lib: ["ES2023"]`, `types: []`, so DOM types aren't available), an ESLint
  `no-restricted-imports`/`no-restricted-globals` rule, and a test that scans engine sources for banned
  imports.
- The web app imports the engine only through `@rn/engine`, the barrel at `packages/engine/src/index.ts`.
- Calculators import only engine public APIs. A lint rule forbids them from importing internal
  modules, and code review checks that they duplicate no formulas.

## Data flow
1. A form (React Hook Form + Zod resolver using the engine schemas) updates the profile in the
   Zustand store.
2. The store is persisted to IndexedDB (debounced ~150 ms).
3. A derived selector builds the projection input and calls `computeDashboard(household, { currentYear, rules })`
   (the baseline `projectHousehold` plus the optimistic and pessimistic reruns).
   - Measured (`pnpm bench`, 4-core Xeon 2.1 GHz, after the M6 optimizations): median 2–8 ms, p95
     ≤ 13 ms per full dashboard recalculation for the sample profiles (annual and monthly, both rule
     sets).
   - In the browser (production build, `e2e/perf-dashboard.spec.ts`): median 5–8 ms unthrottled and
     20–37 ms (max 78.5 ms) at emulated 4× phone throttling. That is under the 100 ms target, so it runs on the
     main thread inside `useMemo`, with `useDeferredValue` to keep typing responsive; no forecast
     worker is needed.
4. View models convert between today's and nominal dollars (`real = nominal / deflator`) for cards,
   charts, tables and exports.
5. Monte Carlo always runs in `montecarlo.worker.ts` (a module worker, its own same-origin asset).
   - `features/monte-carlo/runner.ts` keeps a pool of min(4, `hardwareConcurrency`) workers, spawned
     and warmed when the page opens, and splits each path range contiguously across them. The quick
     run (paths 0–999) is summarized first and its chunks are reused by the full run.
   - Protocol: `run` → `progress` per 100-path sub-chunk → one `chunk` (typed-array buffers
     transferred) or `error`; `optimize` → `optimizeProgress` per age → `optimized`. Replies carry a
     `runId`; stale ones are ignored. Cancel terminates the workers (fresh ones are spawned next time).
     A worker that fails to load fails its range with a clear message.
   - Each worker prepares a run once (`prepareMonteCarlo`) and runs sub-chunks with
     `runPreparedChunk`; paths share return-independent work through the projection cache.
   - Without `Worker` (tests, or a browser without workers) an in-process executor runs the same calls.
6. **Code splitting:** every page except the dashboard is a lazy route chunk behind a loading status
   and a `PageErrorBoundary` (a failed chunk load shows a Reload button). The dashboard is the landing
   page and needs the charts and the engine, so about 1.15 MB of JS (356 kB gzip) still loads at
   start, against one 1.58 MB bundle before splitting (figures in STATUS). Zod and the app's jitless
   switch are one chunk, so the switch runs before any schema use (the CSP forbids Zod's JIT probe).

## State shape
- `profiles: Record<id, ProfileDoc>`, `activeProfileId`.
- `scenarios: Record<id, ScenarioDoc>` (each references `baseProfileId`).
- `settings: SettingsDoc` (theme, dollar basis, onboarding flag).
- Every document carries `schemaVersion`. `migrate()` upgrades older documents, one step per version.

## Error handling
- Engine calls return `EngineResult<T>` (`ok` | `unverified` | `invalid`). User data never makes the
  engine throw.
- The projection returns `ok` with `excludedFeatures`/`unverified` when rules are null.
  - Following the owner's decision of 2026-10-19 (`financial-model.md` §1.7), the forecast leaves the
    unverified steps out and labels them: contributions "as elected, before plan limits", income
    "before taxes".
  - A figure that would need a null rule directly (taxes, net pay, surplus) is null and is never shown
    as a number.
- The UI shows Zod messages per field, has an error boundary per page, and surfaces engine warnings
  inline.

## Security and privacy
- No backend, no network calls carrying user data, no analytics, self-hosted fonts.
- CSP meta tag (defined in `apps/web/csp.ts`), injected into the **production build only**:
  `default-src 'self'; connect-src 'none'; worker-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'`.
  The last three directives strengthen the brief's policy: they don't fall back to `default-src`.
  - `'unsafe-inline'` styles are needed because Recharts and the Radix/shadcn primitives set inline
    styles.
  - The Vite dev server is exempt, because HMR needs a websocket that `connect-src 'none'` would
    block. E2E, axe and no-outbound tests therefore run against `vite preview`.
- No `dangerouslySetInnerHTML` with user data. All imports are validated with Zod.

## Web state and forms (M2)
- `state/profileStore.ts` (Zustand) holds profiles (validated `ProfileDoc`s), the active profile,
  onboarding status and dollar basis.
  - Profile writes to IndexedDB are debounced (300 ms) and flushed on `pagehide`.
  - Settings are written immediately, because they gate navigation such as onboarding.
- `hooks/useHouseholdForm.ts`: one React Hook Form instance over the whole household, validated by
  the engine's `HouseholdSchema` through `zodResolver`.
  - Cross-field rules surface on the right field.
  - Only valid households are committed to the store; a valid household clears stale cross-field
    errors.
- Pages compute live readouts with engine calls on the last valid household, e.g.
  `previewAccumulation(household, ctx, 10)`. The UI holds no financial formulas.
- The current year is read once in the UI (`app/env.ts`, overridable with `?year=` for reproducible
  E2E) and injected into the engine.
- `src/zodConfig.ts` (imported first) runs Zod jitless, because Zod 4's JIT probes `new Function`,
  which the CSP forbids.

## Tooling decisions (M1)
- TypeScript 6.0.3: typescript-eslint 8.71 supports `<6.1`; TypeScript 7 (native) came out on 2026-10-18.
- React Router 8 (HashRouter): works offline, under the CSP and in any static host.
- shadcn/ui components are hand-written in `apps/web/src/components/ui/` following the shadcn conventions
  (cva variants, `cn()`, Radix primitives from the `radix-ui` package), because the shadcn registry
  (ui.shadcn.com) is blocked in the cloud container.
- `@playwright/test` is pinned to 1.56.1 to match the preinstalled Chromium build (1194) in the cloud
  container; `playwright.config.ts` uses that binary when present.
- eslint-plugin-jsx-a11y is not used (no ESLint 10 support); accessibility is enforced by axe in Playwright.
- The theme is applied before first paint by `public/theme-init.js` (an external file, so the CSP needs no
  inline script) and mirrored in localStorage; documents live in IndexedDB.
- Fonts: Inter Variable from `@fontsource-variable/inter`, bundled and served same-origin.
  `build.assetsInlineLimit: 0` prevents `data:` URIs the CSP would block.

## MCP servers
None are added. No concrete advantage for this project has been identified.

## Projection (M3)
- `packages/engine/src/projection/`:
  - `accounts.ts`: the per-account update `E = g_S·S + g_C·C − g_W·W` for every timing mode,
    withdrawal caps, withdrawal orders and tax-treatment groups.
  - `project.ts`: `projectHousehold`, the year loop.
  - `dashboard.ts`: `computeDashboard`, the cards and readiness.
- The year loop reuses the M2 Income & Savings slice (`income/preview.ts` → `accumulationYear`), so
  the 10-year preview and the forecast share one implementation of pay, elections, limits, match,
  scheduled contributions and net pay.
- Float64 balances carry forward unrounded. Each row converts to cents once (`growthNet` is the
  reconciling item), and every result is checked against the frozen `ProjectionResultSchema` in
  tests.
- Validation: an independent Python reference (`packages/engine/reference/ref.py`, written from
  `financial-model.md`, not from the engine) produces golden fixtures. Vitest compares them within
  1 cent per year. fast-check property tests cover reconciliation, non-negative balances, the timing
  ordering and monotonic contributions.
