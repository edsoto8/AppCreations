# STATUS

Statuses: `done` · `simplified` (with limitation) · `unverified rule` · `not started`.

## Current phase
**M1 Foundation complete** (tag `m1-foundation`). Next: **M2 Accumulation engine, income, accounts**.

## Milestone log
| Milestone | Status | Tag | Date |
|---|---|---|---|
| Phase 0 (plan, contracts, doc drafts) | done (plan approved; contracts approved 2026-10-18) | — | 2026-10-18 |
| M1 Foundation | done | `m1-foundation` | 2026-10-18 |
| M2–M8 | not started | | |

## M1 gate evidence
| Gate | Evidence | Result |
|---|---|---|
| Engine has no React/DOM imports (enforced) | Three layers: ESLint `no-restricted-imports`/`-globals`/`-properties`/`-syntax` on `packages/engine/src`; engine `tsconfig` with `lib: ["ES2023"]`, `types: []`; `src/boundary.test.ts` scanning sources. A deliberate violation file was flagged by both ESLint (5 errors) and `tsc` before being deleted. | pass |
| `pnpm verify` green | typecheck → lint → format check → unit tests with coverage → build → E2E | pass |
| A stored document round-trips through the schema | `apps/web/src/storage/repository.test.ts` (IndexedDB via fake-indexeddb → `migrate()` → equal); `packages/engine/src/io/migrate.test.ts` (JSON round trip) | pass |
| + CSP meta in the built `index.html` | `e2e/shell.spec.ts` "serves the production CSP" | pass |
| + No outbound requests (smoke) | `e2e/shell.spec.ts` visits every section on desktop and mobile; zero non-origin requests, zero console errors | pass |

### Test results (2026-10-18, this container, final `pnpm verify` before the tag)
- Engine: 7 files, 176 tests passed. Coverage is above 96% on every metric (≈99% statements/lines).
  The threshold is 90%. `src/api.ts` (unimplemented stubs) is excluded until its functions are
  implemented. The count includes the early M2 rules work (see below).
- Web: 3 files, 17 tests passed.
- E2E (Playwright, Chromium 1194, `vite preview`): 10 passed, 2 skipped (two keyboard/focus tests run on
  desktop only). Each section is checked with axe (WCAG 2.0/2.1/2.2 A/AA) in the light theme on desktop
  and mobile, and the shell in the dark theme. Zero violations.
- Visual check: screenshots of the dashboard and Data pages at desktop (1280×860) and mobile (Pixel 7),
  light and dark, read back. Fixed one mobile issue: the "Planned for M7b" badge wrapped.
- Bundle (production): JS 363.8 kB (115.8 kB gzip), CSS 22.7 kB (5.5 kB gzip), Inter woff2 subsets
  total 218 kB.

## Feature status
| Feature (BRIEF §) | Status | Notes |
|---|---|---|
| Monorepo, strict TS, ESLint, Prettier, Vitest, Playwright | done | |
| App shell, sidebar navigation, mobile drawer, light/dark/system theme | done | |
| Disclaimers in the UI footer | done | Print summary and docs disclaimers arrive with M7b/M8. |
| CSP (production build) | done | The dev server is exempt (HMR websocket); documented. |
| Unencrypted-storage notice (UI and docs) | done | Data & Privacy page, assumptions.md, user-guide.md |
| IndexedDB layer with schemaVersion + migration chain skeleton | done | Chain is empty at v1. |
| Zod domain models / frozen contracts | done | CONTRACT_VERSION 1.1.0 |
| Sub-agents and skills | simplified | Created in `RetirementNavigator/.claude/`, but **not discoverable** in this session (see R3). Delegation uses general-purpose agents that are told to follow those definitions. |
| Pages for M2–M7b features | not started | Placeholders say "Not built yet" and show no figures. |
| Rules data | unverified rule | Government sources are blocked (see Blockers). |

## Blockers and risks
- **Rules sources unreachable.** irs.gov, ssa.gov and federalregister.gov are blocked by this
  environment's network policy (direct fetch and curl both fail; checked again 2026-10-18 after the
  owner chose to allowlist). The owner chose to allowlist these domains. Until access works, M2 rules
  files ship with every value `unverified` (candidates kept for display only), and
  `docs/rules-verification.md` cannot be completed. **The M2 tag waits on that review.**
- **R1:** The CSP applies to the production build only.
- **R2:** The survivor SS model omits the survivor's own early-claim reduction (documented).
- **R3:** The sub-agents in `RetirementNavigator/.claude/agents` are not discoverable in this session;
  the `Agent` tool reported "Agent type 'code-reviewer' not found". Project agents load at session
  start from the session's working directory. Fix: start a new session from `RetirementNavigator/`,
  or ask for the definitions to be mirrored to the repo-root `.claude/`.
- **R4:** Benchmarks run on a 4-core cloud container. Phone numbers will come from emulated
  (throttled) runs.

## Review findings (M1)
The code-reviewer pass ran as a general-purpose agent following `.claude/agents/code-reviewer.md`.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | The skip link (`#main`) became the route `/main` under HashRouter | blocking | Fixed: it moves focus without navigating. E2E now asserts the route and h1 are unchanged. |
| 2 | Household validation missed references: pension/other-income owners, pension and one-time-event destination accounts, plan Roth account when Roth is elected, a shared plan account, plan/account `planType` mismatch, Roth escalation without Roth, surplus into tax-advantaged accounts | blocking | Fixed in `household.ts` superRefine, with tests |
| 3 | Inflation of −100% makes the deflator 0 | blocking | Fixed: `InflationRateSchema` covers (−50%, 50%] |
| 4 | Documented invariants not enforced (graded vesting, tier bands ≤ 100%, part-time ages, schedule and income years, unique raise and step entries, correlation symmetry and diagonal) | optional | Fixed, with tests. The PSD check comes in M6. |
| 5 | Zod object defaults shared between parses | optional | Fixed: factory defaults, with a test |
| 6 | `migrate` could throw from a step or mutate its input | optional | Fixed: try/catch and a JSON clone (`migrateWith`), with tests. **M7b note:** `importJson` must migrate each nested document before parsing the bundle. |
| 7 | Repository reads not narrowed by kind, and not checked against key or kind | optional | Fixed: `get<K>`/`list<K>` with runtime checks, plus a test |
| 8 | CSP missing `object-src`/`base-uri`/`form-action`; e2e duplicated the string; meta order unchecked | optional | Fixed: `apps/web/csp.ts` (the brief's four directives plus these three, a strengthening). E2E imports it and checks the meta comes before scripts. |
| 9 | Same `<title>` on every route; no focus move on navigation; group labels not linked to lists | optional | Fixed, with unit and E2E tests |
| 10 | Theme in both localStorage and SettingsDoc; "system" ignored live OS changes | optional | Fixed: `SettingsDoc.theme` removed (contract 1.1.0), with a live `matchMedia` listener. Clearing `rn-theme` on delete-all is tracked for M7b. |
| 11 | `toCents` lacked a safe-integer guard | optional | Fixed (RangeError programming-error guard); tolerance documented |
| 12 | Engine banned-globals list missed `crypto`, `performance`, `globalThis`, `process` | optional | Fixed in ESLint and the boundary test |
| 13 | Timestamps rejected UTC offsets | optional | Fixed: `{ offset: true }` |

No open findings.

## Contract changes
| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-10-18 | Initial frozen contract (approved). `migrate` implemented in `io/migrate.ts` and re-exported from `api.ts` (no signature change). |
| 1.1.0 | 2026-10-18 | From the M1 review: stricter household validation (cross-references and invariants), `InflationRateSchema` bound (−50%, 50%], factory defaults, `SettingsDoc.theme` removed (the theme lives in localStorage for pre-paint), offset timestamps accepted. No stored documents existed, so no migration is needed. `resolveRules` implemented (M2, signature unchanged). |

## Traceability (BRIEF §5 → milestone)
| Feature | Milestone |
|---|---|
| App shell, sidebar, theme, CSP, unencrypted-storage note, disclaimers (UI) | M1 ✅ |
| Rules loader, indexer, Rules & Sources page | M2 |
| Profile (ages, filing, state rate), household/spouse | M2 (spending steps/glide → M4) |
| Income: salary, bonus, raises, overrides, real raise; part-time phase input | M2 (part-time projection → M3) |
| Workplace contributions, auto-escalation, limit capping; tiered match, flat, vesting, readout; 10-year preview | M2 |
| Accumulation cash flow (net pay, infeasible flag, surplus routing) | M2 |
| Accounts CRUD, fees, start/stop, schedules | M2 |
| Roth IRA eligibility, limits, readout; Roth-vs-trad link stub | M2 (calculator M7a) |
| HSA inputs and limits | M2 (withdrawals M4) |
| Sample profiles, onboarding, multiple profiles | M2 |
| Projection rows, reconciliation, fees, timing modes, monthly mode | M3 |
| Dashboard cards + formula docs, forecast chart, offsets, markers, real/nominal toggle, allocation (a)(b) | M3 (death marker M4; readiness MC M6) |
| Spending plan, SS (entered / illustrative / spousal / survivor / reduction), pensions, one-time events, taxable basis and drag | M4 |
| Withdrawal ordering, RMDs, tax model, gross-up solver, survivor modeling, gross-to-net, HSA and Roth withdrawals | M4 |
| Scenarios CRUD, diff, presets A–G, compare, deterministic optimizer | M5 |
| Monte Carlo (all of §5.7), allocation (c), MC option in scenarios and the optimizer | M6 |
| 15 calculators | M7a |
| Insights; CSV/JSON export/import; migrations; print summary; delete-all | M7b |
| Full E2E, axe audit, performance, independent validation, user guide | M8 |

## Handoff
- **Already done for M2 (landed with the M1 tag, counted in M2):** rules data files `rules/2026.ts`,
  `rules/2027.ts` and `rules/standing.ts` (every value `unverified` or `notPublished`, with
  search-excerpt candidates for display only); rules-integrity tests (each leaf has a source or a
  reason; every year file has every key; zero values are verified yet); `resolveRules`
  (anchor/indexing/rounding/statutory-fixed), tested on synthetic verified data.
- **Next steps (M2):**
  1. Rules & Sources page.
  2. Engine slice: compensation path, `computeMatch` and the readout, `capContributions`,
     `rothIraEligibility`, `estimateMagi`, `hsaLimit`, net-pay feasibility (taxes `unverified` until
     verified).
  3. UI: profile and household editor, Income & Savings with the 10-year preview, account CRUD, Roth
     IRA and HSA pages, sample profiles, onboarding, multiple profiles.
  4. Gates: the IRS worked example for the Roth phase-out (start, middle and end, both statuses) needs
     verified values and Pub 590-A. Hand-computed match tier cases. A test that every rule has a
     source. Owner review of `rules-verification.md` before the tag.
- **Frozen contracts:** `packages/engine/src/domain/*`, `packages/engine/src/api.ts` (1.1.0).
- **Tags:** the session's git proxy refused to push tags (HTTP 403), though branch pushes work. The
  milestone tag `m1-foundation` is local only. It points at the commit titled "fix(RetirementNavigator):
  resolve M1 review findings; start M2 rules data". To publish it from a clone:
  `git tag -a m1-foundation <that commit> -m "M1 Foundation" && git push origin m1-foundation`.
- **Open risks:** rule sourcing (blocked), agent discovery (R3), tag publishing (above).
