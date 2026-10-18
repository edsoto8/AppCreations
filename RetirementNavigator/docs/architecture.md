# Architecture (Phase 0 draft)

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
3. A derived selector builds the projection input and calls `projectHousehold(household, { currentYear, rules })`.
   It runs on the main thread when a run takes under ~30 ms, and otherwise in `forecast.worker.ts`.
   Recalculation is debounced.
4. View models convert between today's and nominal dollars (`real = nominal / deflator`) for cards,
   charts, tables and exports.
5. Monte Carlo always runs in `montecarlo.worker.ts`. The worker runs a quick 1,000-path chunk, then
   refines in chunks to the selected count. It posts progress messages and supports a cancel token.

## State shape
- `profiles: Record<id, ProfileDoc>`, `activeProfileId`.
- `scenarios: Record<id, ScenarioDoc>` (each references `baseProfileId`).
- `settings: SettingsDoc` (theme, dollar basis, onboarding flag).
- Every document carries `schemaVersion`. `migrate()` upgrades older documents, one step per version.

## Error handling
- Engine calls return `EngineResult<T>` (`ok` | `unverified` | `invalid`). User data never makes the
  engine throw.
- The projection returns `ok` with `excludedFeatures`/`unverified` when rules are null. The UI shows
  "Unverified rule" instead of any number that depends on an excluded feature.
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
