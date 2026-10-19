# STATUS

Statuses: `done` · `simplified` (with limitation) · `unverified rule` · `not started`.

## Current phase
**M2 Accumulation engine, income, accounts: built; tag pending.** Every M2 gate passes except two
that need verified rule values: the IRS worked example for the Roth phase-out, and the owner's
review of `docs/rules-verification.md`. Both wait on reaching irs.gov, ssa.gov and federalregister.gov
(see Blockers). Next after the tag: **M3 Forecasting**.

## Milestone log
| Milestone | Status | Tag | Date |
|---|---|---|---|
| Phase 0 (plan, contracts, doc drafts) | done (plan approved; contracts approved 2026-10-18) | — | 2026-10-18 |
| M1 Foundation | done | `m1-foundation` (local only; see Handoff) | 2026-10-18 |
| M2 Accumulation engine, income, accounts | built; **tag waits on verified rules + owner review** | — | 2026-10-19 |
| M3–M8 | not started | | |

## M2 gate evidence
| Gate | Evidence | Result |
|---|---|---|
| `docs/rules-verification.md` complete and reviewed by the owner before tagging | Candidates and sources are listed, but no value could be read at source (sites blocked) | **blocked** |
| Roth eligibility matches an IRS worked example at phase-out start, midpoint and end | Mechanics verified at start, midpoint and end for both statuses against the pinned synthetic fixture, with rounding and the $200-minimum edge (`limits/limits.test.ts`). The IRS worked example (Pub 590-A) needs the publication and verified values. | **partial (blocked)** |
| Match readout matches hand-computed tier cases | `match/match.test.ts`: 0/2/3/4/5/10% deferral on $100k with 100% of 3% + 50% of 2%; cap binding inside a tier; zero-rate tier gap; monotonic property; UI readout asserted in RTL and E2E ($1,920 of $3,840) | pass |
| Every rule value has a source (test) | `rules/rules.test.ts`: every verified leaf has a primary source, every null leaf has a reason, every year file has every key, candidates are marked search-excerpt; 79 leaves | pass |
| + Null rules produce `unverified` and the UI shows a disabled feature | Engine tests on the real `RULES` (limits, IRA, HSA, tax, preview); RTL and E2E assert "Not available yet … (rule values are unverified)" and no invented limit | pass |
| + `pnpm verify` green | typecheck, lint, format, unit (engine + web), build, E2E | pass |

### Test results (2026-10-19, this container, `pnpm verify`)
- Engine: 13 files, 267 tests passed. Coverage 99.0% lines, 94.0% branches, 98.1% functions
  (thresholds 90%).
- Web: 15 files, 81 tests passed (React Testing Library). Web coverage is 89.6% lines and 74.1%
  branches; there is no threshold for the web package.
- E2E: 18 passed (desktop and mobile).
  - Covers onboarding (blank and sample), reload persistence, the income/match live readout,
    profile validation and the shell.
  - axe runs on every M2 page in light and dark: zero violations after fixing the 24 px target size.
  - No horizontal overflow at phone width; zero outbound requests; zero console errors after running
    Zod jitless under the CSP.
- Visual: 36 screenshots (9 pages × desktop/mobile × light/dark) read back.
- Bundle: JS 738 kB (228 kB gzip), CSS 34 kB (7.4 kB gzip). Code-splitting is planned for the M8
  performance pass.

## Feature status
| Feature (BRIEF §) | Status | Notes |
|---|---|---|
| Monorepo, tooling, app shell, theme, CSP, disclaimers (UI), unencrypted-storage notice | done | M1 |
| IndexedDB layer, schemaVersion, migration chain | done | Chain empty at v1; kind/id checked on read |
| Rules loader/indexer (`resolveRules`), `RuleAccess`, rules data 2026/2027/standing | done / **unverified rule** | Code done and tested; **every value unverified** (79 leaves: 55 unverified, 24 not yet published) |
| Rules & Sources page | done | Every value with status, source, date, indexation, candidate (display-only) |
| Compensation: salary, bonus (3 kinds, growth modes, eligibility toggles), raises (nominal / inflation+real, overrides), stop age, part-time phase | done | |
| Workplace contributions: % of salary and bonus, auto-escalation, 402(g)/catch-ups/Roth catch-up/401(a)(17)/415(c) capping with warnings | done / **unverified rule** | Engine tested on the fixture; in the app, limits show "Not available yet" |
| Employer match: tiers, flat, cap, vesting (display), capture readout | done | Readout is labeled "before plan limits" while limits are unverified; forfeiture is applied in M3 |
| 10-year live preview; today's/future dollars toggle | done | |
| Net-pay feasibility (taxes, FICA, flat state) | done / **unverified rule** | Tax model tested on the fixture; in the app, taxes show "Unverified" |
| Profile and household editor (spouse add/remove, assumptions, anchor year) | done | Spending steps and glide come in M4 |
| Accounts CRUD (all types, schedules, fees, allocation, deletion guards) | done | |
| Roth IRA page (MAGI estimate and override, eligibility readout) | done / **unverified rule** | Spousal and backdoor Roth unsupported (stated) |
| HSA page (coverage, HDHP attestation, limit, medical expenses) | done / **unverified rule** | Withdrawals in M4 |
| Sample profiles (4), onboarding, multiple profiles | done | |
| Sub-agents and skills | simplified | Skills are discovered; agents are not (R3); delegation uses general-purpose agents told to follow the definitions |
| M3–M8 features | not started | Placeholders show no figures |

## Blockers and risks
- **Rules sources unreachable.** irs.gov, ssa.gov and federalregister.gov are blocked by this
  environment's network policy. Direct fetch and curl both fail; this was checked again on 2026-10-19,
  after the owner chose to allowlist the domains.
  - Network settings may apply only to new sessions.
  - Until access works, every rule value stays `unverified` and the features that need them show
    "Not available yet". `docs/rules-verification.md` can't be completed.
  - **The M2 tag waits on verification and the owner's review.**
- **R1:** The CSP applies to the production build only.
- **R2:** The survivor SS model omits the survivor's own early-claim reduction (documented).
- **R3:** The sub-agents in `RetirementNavigator/.claude/agents` are not discoverable in this session;
  the `Agent` tool reported "Agent type 'code-reviewer' not found". Project agents load at session
  start from the session's working directory. Fix: start a new session from `RetirementNavigator/`,
  or ask for the definitions to be mirrored to the repo-root `.claude/`.
- **R4:** Benchmarks run on a 4-core cloud container. Phone numbers will come from emulated
  (throttled) runs.

## Review findings (M2)
_Pending the code-reviewer pass._

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
| 1.2.0 | 2026-10-19 | Additive for M2: `TaxInput.wagesByPerson` (per-person wage base); `CompensationYear.age/working`; `previewAccumulation` and its row types (per-plan rows, cash-flow warnings, per-account `scheduled` amounts); standing rules `capitalGainsRates` and `roth.reducedContributionRounding` (sourced rule values instead of literals). M2 functions implemented and re-exported from `api.ts` with unchanged signatures. |

## Traceability (BRIEF §5 → milestone)
| Feature | Milestone |
|---|---|
| App shell, sidebar, theme, CSP, unencrypted-storage note, disclaimers (UI) | M1 ✅ |
| Rules loader, indexer, Rules & Sources page | M2 ✅ (values unverified) |
| Profile (ages, filing, state rate), household/spouse | M2 ✅ (spending steps/glide → M4) |
| Income: salary, bonus, raises, overrides, real raise; part-time phase input | M2 ✅ (part-time projection → M3) |
| Workplace contributions, auto-escalation, limit capping; tiered match, flat, vesting, readout; 10-year preview | M2 ✅ (limits unverified; forfeiture → M3) |
| Accumulation cash flow (net pay, infeasible flag, surplus routing) | M2 ✅ (taxes unverified; surplus routing → M3) |
| Accounts CRUD, fees, start/stop, schedules | M2 ✅ |
| Roth IRA eligibility, limits, readout; Roth-vs-trad link stub | M2 ✅ (unverified; calculator M7a) |
| HSA inputs and limits | M2 ✅ (unverified; withdrawals M4) |
| Sample profiles, onboarding, multiple profiles | M2 ✅ |
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
- **Done in M2:**
  - Engine: compensation, match, workplace/IRA/HSA limits, Roth eligibility, tax model, the
    Income & Savings preview, rules data and resolver.
  - UI: profiles, onboarding, Profile, Income & Savings, Accounts, Roth IRA, HSA, Rules & Sources.
  - Tests: 267 engine and 81 web unit tests; 18 E2E tests.
- **To tag M2 (`m2-accumulation`):**
  1. Make irs.gov, ssa.gov and federalregister.gov reachable (environment network settings, likely
     in a new session).
  2. Verify each value at source (see the procedure in `docs/rules-verification.md`) and add the IRS
     Pub 590-A worked example test for the Roth phase-out.
  3. Owner spot-checks the top 15 values.
  4. Tag.
- **Next (M3 Forecasting):**
  - Projection engine: accounts growth and fees, timing modes, monthly mode, per-row reconciliation,
    surplus routing, vesting forfeiture, simple withdrawals.
  - Python reference script and golden fixtures.
  - Dashboard cards with formula docs; forecast chart with offsets and markers; allocation views
    (a) and (b); real/nominal toggle.
- **Frozen contracts:** `packages/engine/src/domain/*`, `packages/engine/src/api.ts` (1.2.0).
- **Tags:** the session's git proxy refused to push tags (HTTP 403), though branch pushes work.
  `m1-foundation` is local only, pointing at the commit titled "fix(RetirementNavigator): resolve M1
  review findings; start M2 rules data". To publish it from a clone:
  `git tag -a m1-foundation <that commit> -m "M1 Foundation" && git push origin m1-foundation`.
- **Open risks:** rule sourcing (blocked), agent discovery (R3), tag publishing (above), bundle size
  (738 kB JS, to code-split in M8).
