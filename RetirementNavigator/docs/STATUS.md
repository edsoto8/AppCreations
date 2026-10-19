# STATUS

Statuses: `done` · `simplified` (with limitation) · `unverified rule` · `not started`.

## Current phase
**M3 Forecasting: done.** Every M3 gate passes. It is tagged `m3-forecasting` locally (tag pushes
are refused; see Handoff).

**M2 is still untagged:** its gates wait on verified rule values and the owner's review of
`docs/rules-verification.md`. irs.gov, ssa.gov and federalregister.gov remain unreachable (see
Blockers).

Next: **M4 Retirement income**.

## Milestone log
| Milestone | Status | Tag | Date |
|---|---|---|---|
| Phase 0 (plan, contracts, doc drafts) | done (plan approved; contracts approved 2026-10-18) | — | 2026-10-18 |
| M1 Foundation | done | `m1-foundation` (local only; see Handoff) | 2026-10-18 |
| M2 Accumulation engine, income, accounts | built; **tag waits on verified rules + owner review** | — | 2026-10-19 |
| M3 Forecasting | done | `m3-forecasting` (local only) | 2026-10-19 |
| M4–M8 | not started | | |

## M3 gate evidence
| Gate | Evidence | Result |
|---|---|---|
| Reconciliation property test passes 10,000 fast-check runs | `projection/projection.property.test.ts` (seed 20261019): per-row reconciliation and carry-forward, plus an **independent recomputation** of every year-end balance and fee drag from the §1.5 factors within 3 cents. Mutation-checked: a 0.01% change to one growth factor fails it. | pass |
| Golden fixtures match the Python reference and external worked examples within $0.01 per year | `reference/ref.py` (independent; written from the docs by a QA pass that did not read the engine source), 19 fixtures, `golden.test.ts` at 1-cent tolerance. **Every figure matches exactly** (also checked at 0 cents). External worked examples: annuity-due table ä(10, 5%) = 8.1078; $100/month at 0.5%/month for 10 years = $16,387.93; PVIFA(0.5%, 240) × 1.005 = $140,278.68. | pass |
| Zero-return and annuity closed-form cases exact | `project.test.ts`: zero return/zero inflation depletion exact to the cent, FV of mid-year contributions exact, level and growing annuities within 2 cents of a rounded-up starting balance (cent rounding of the input) | pass |
| + Conservative ≤ default on paths with every net rate ≥ 0; never negative; monotonic contributions; offset ordering | property tests (1,000 / 1,000 / 500 / 500 runs) | pass |
| + Dashboard recalculation < 100 ms | `pnpm bench` (Node 22, 4-core Xeon 2.1 GHz; Node, not a browser): median 4.8–31.1 ms, p95 ≤ 46.9 ms, max 70.6 ms per `computeDashboard` (3 projections). Runs on the main thread; phone throttling is re-checked in M8. | pass |
| + `pnpm verify` green (now includes `pnpm reference`) | typecheck, lint, format, unit (engine + web), reference check, build, E2E | pass |

### M3 test results (2026-10-19, this container)
- Engine: 16 files, 348 tests. Coverage 99.3% lines, 92.5% branches, 98.6% functions.
- Web: 20 files, 101 tests (RTL); 91.2% lines, 76.1% branches.
- Python reference: `OK: 19 fixtures match the reference`.
- E2E: 24 passed, desktop and mobile. The dashboard tests check:
  - all ten cards, the scope labels and the dollar toggle;
  - every chart data table;
  - that forecast settings change the result;
  - axe in light and dark with every table open (0 violations);
  - no horizontal overflow at phone width, no outbound requests, no console errors.
- Visual: 40 screenshots (10 pages × desktop/mobile × light/dark) read back.
- Bundle: JS 1,159 kB (349 kB gzip; Recharts added about 420 kB), CSS 36 kB. Code-splitting is in
  the M8 performance pass.

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
- Engine: 13 files, 275 tests passed. Coverage 99.3% lines, 94.2% branches, 98.3% functions
  (thresholds 90%).
- Web: 18 files, 88 tests passed (React Testing Library), including pages rendered with the
  synthetic fixture rules. Web coverage is 90.4% lines and 76.5% branches; there is no threshold
  for the web package.
- E2E: 18 passed (desktop and mobile).
  - Covers onboarding (blank and sample), reload persistence, the income/match live readout,
    profile validation and the shell.
  - axe runs on every M2 page in light and dark: zero violations after fixing the 24 px target size.
  - No horizontal overflow at phone width; zero outbound requests; zero console errors after running
    Zod jitless under the CSP.
- Visual: 36 screenshots (9 pages × desktop/mobile × light/dark) read back.
- Bundle: JS 740 kB (228 kB gzip), CSS 34 kB (7.4 kB gzip). Code-splitting is planned for the M8
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
| Projection engine (per-year rows, per-account flows, nominal and real, fees and taxable drag, mid-year / start-of-year timing, monthly mode, return precedence, offsets, market shock) | done | `projection/`; validated against the Python reference |
| Contributions in the forecast | done / **unverified rule** | Owner decision 2026-10-19: as elected, **before plan limits**, labeled, while limits are unverified. This can overstate savings for people above the limits. |
| Accumulation cash flow in the forecast | done / **unverified rule** | Net pay, surplus and the tax-based infeasible flag are null while taxes are unverified. A rule-free check still flags years where pay is below spending. Surplus routing works only with verified taxes. |
| Vesting forfeiture at separation | done | The entered unvested balance is the not-yet-vested part; tests cover cliff and graded |
| Part-time phase in the projection | done | Stops at the person's modeled death |
| Simple withdrawals (taxable first, traditional first, Roth last, proportional) | simplified | Before taxes until M4. Bracket fill falls back to taxable first with a warning. |
| Dashboard cards (10) with formula docs and tests; readiness heuristic | done | Retirement income is "before taxes" until M4 |
| Forecast chart (baseline, fixed-offset lines, retirement / first-death / depletion markers, annual flows), today's/future toggle | done | Every chart has a data table |
| Allocation views (a) account type, (b) tax treatment | done | (c) asset class in M6 |
| Forecast settings (timing, granularity, order, surplus, offsets, minimum ending balance) | done | Profile page |
| SS, pensions, one-time events, RMDs, retirement taxes, spending steps/glide/healthcare, survivor reduction | not started (M4) | Disclosed on the dashboard (`featureNotModeled`) |
| M5–M8 features | not started | Placeholders show no figures |

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
- **R5 (M3):** Until rules are verified, the forecast's contributions are before plan limits (savings
  may be overstated for high savers). Until M4, retirement has no Social Security, pensions or
  taxes, so most sample profiles read "At risk". The dashboard banner states both.
- **R6 (M3):** The Python reference does not yet cover the verified-rules path (limits, taxes,
  surplus routing) or "other" accounts. Those are covered by engine unit tests against the synthetic
  fixture only.

## Review findings (M3)
The code-reviewer pass ran as a general-purpose agent following `.claude/agents/code-reviewer.md`
(range `fcc4b63..805af3a`). It confirmed each finding with probe tests. Before that, the independent
QA reference had already found four discrepancies, all resolved: contribution rounding was
documented as whole cents; real portfolio value moved to unrounded floats; flow totals were
documented as sums of account cents; and the bonus warning code was fixed.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| B1 | Part-time pay continued after the earner's planning age (modeled death) | blocking | Fixed: part-time pay and owner-linked other income stop from the death year. Engine test, a reference fixture, and the property generator no longer drops this case. |
| B2 | Graded vesting under-counted the forfeiture of the entered "unvested" balance | blocking | Fixed: the ledger starts at `U0/(1 − v0)` (employer money subject to vesting), with a warning when nothing can forfeit it. Doc, engine, reference and tests updated together. |
| B3 | The 10,000-run reconciliation was tautological (growthNet is the reconciling item), and §1.3 cited a missing test | blocking | Fixed: the same 10,000 runs now recompute every end balance and fee drag independently (within 3 cents), mutation-checked; §1.3 corrected |
| S1 | A salary stop age after the retirement age gave "retirement" rows with salary | should fix | Fixed: retired means at or past the retirement age **and** no salary. Fixture and test added; the UI explains a later stop age. |
| S2 | Working-year funding gaps were hidden while taxes are unverified | should fix | Fixed: a rule-free check (pay + other income < spending) flags the year with a warning |
| S3 | Today's-dollar start balances were deflated one year too many | should fix | Fixed: starts divide by `P_{t−1}` (card and tables); doc §1.1 and §8; engine and RTL tests |
| S4 | `inflationOverride` half-wired and could throw | should fix | Validated (`invalid`, never throws). Documented as deflator/spending only until M6 wires stochastic inflation through. |
| S5 | Longevity could report a deceased person's age | should fix | Fixed: the age is that of the first listed person still alive (`longevity.personId`, contract 1.5.0) |
| S6 | Granularity tip and scope banner overstated | should fix | Fixed wording |
| S7 | Reference coverage gaps | should fix | Added fixtures for death, stop age and forfeiture with start-of-year timing (19 total). The rest is recorded in `testing-strategy.md` and R6. |
| S8 | STATUS not updated | should fix | This update |
| — | Rounded scaled retirement contributions could cause a 1-cent false depletion | optional | Fixed: scaled amounts round down |
| — | Monthly real card values rounded twice | optional | Fixed: one rounding |
| — | Card test compared against the engine's own row | optional | Fixed: an independent closed-form value |
| — | Unvested money on an unlinked account is never forfeited | optional | Now warned |
| — | Income/surplus cards lack the limits badge; first-death marker for someone already past their planning age | optional | Kept (minor); revisit in M4 |

No open blocking or should-fix findings.

## Review findings (M2)
The code-reviewer pass ran as a general-purpose agent following `.claude/agents/code-reviewer.md`
(range `54ef5e2..7f951c2`). It confirmed the first three findings with probe tests against the
synthetic fixture.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | The catch-up was counted again for each aggregated 401(k)/403(b) plan | blocking | Fixed: the catch-up room is shared (`catchUp − catch-up already used`), with a two-plan test |
| 2 | The senior-deduction phase-out was applied once to the total instead of per filer | blocking | Fixed: `seniors · max(0, amount − rate·max(0, MAGI − start))`, with an MFJ test |
| 3 | The reduced Roth IRA limit did not follow the Pub 590-A worksheet order | blocking | Fixed: base `= min(L, earned income)`, phase-out on the base, then `min(reduced, base − other IRA)`; tests for both probe cases. Still pending verification at source (the publication is blocked). |
| 4 | Unknown inputs became numbers in the preview (deferrals or HSA as 0 in MAGI; taxes without pre-tax HSA) | blocking | Fixed: MAGI is null when deferrals or HSA amounts are unknown; taxes are null unless deferrals and HSA amounts are known. Tests assert nulls, never guesses. |
| 5 | The 1.2.0 contract bump was not recorded, and was not purely additive | blocking | Fixed: the 1.2.0 row now states the breaking parts; the review fixes are recorded as 1.3.0 |
| 6 | Onboarding samples overwrote an existing profile with the same id | blocking | Fixed: `createProfile` never overwrites; a taken id gets `-2`, `-3`, … (the ProfilesPage workaround is removed), with a store test |
| 7 | The match readout showed pre-limit numbers unlabeled once limits are verified | should fix | Fixed: with verified limits the readout shows the after-limit match the forecast counts, or says limits do not reduce it. RTL test with the synthetic fixture rules. |
| 8 | Two HSAs of one person each got the full limit | should fix | Fixed: one HSA room per person, shared across that person's HSAs, with engine and page tests |
| 9 | The Roth IRA page rebuilt MAGI and limits in the UI and could disagree with the engine | should fix | Fixed: the engine reports `CashFlowPreviewRow.rothIra` and per-account `scheduled` allowed amounts; the Roth IRA and HSA pages render those, with no limit arithmetic in the UI. RTL tests with the synthetic fixture rules. |
| 10 | Duplicated formulas in the UI (implied raise, price index, HSA cap) | should fix | Fixed: `impliedRaise` and `priceIndex` are exported by the engine and used by the UI; the HSA cap comes from the engine (#9) |
| 11 | 415(c) used match-eligible pay and missed employee-only excess | should fix | Fixed: the cap is `min(limit, compensation)` with compensation passed in; employee excess is reduced first, with its own warning |
| 12 | The Employer column's `*` had no screen-reader text | should fix | Fixed: sr-only "(before limits, unverified)", asserted in RTL |
| — | `deferralCapped` reused for ignored bonus deferrals | optional | Fixed: new `bonusDeferralIgnored` warning code |
| — | Statutory ages (50, 60–63, 55, 65) are hard-coded | optional | Kept: they are fixed by statute and stated in `financial-model.md`; moving them into the rules data is tracked for M4 with the other statutory constants |
| — | Spending and feasibility use `retirementAge`, while salary uses `stopAge` | optional | Kept as a documented simplification: retirement spending starts at the retirement age even if salary stops earlier |
| — | Removing a workplace plan leaves its account | optional | Kept: the account keeps its balance (it may be a rollover); it can be deleted on Accounts |

No open blocking or should-fix findings.

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
| 1.2.0 | 2026-10-19 | M2 additions, **not purely additive**: `TaxInput.wagesByPerson` is a new required input (per-person wage base; breaks existing callers); `StandingRulesSchema` gains two required keys, `capitalGainsRates` and `roth.reducedContributionRounding` (sourced rule values instead of literals). Additive: `CompensationYear.age/working`; `previewAccumulation` and its row types (per-plan rows, cash-flow warnings, per-account `scheduled` amounts). M2 functions implemented and re-exported from `api.ts` with unchanged signatures. No stored documents carry these types, so no migration is needed. |
| 1.3.0 | 2026-10-19 | From the M2 review, **not purely additive**: `ContributionRequest.compensation` is a new required input (415(c) 100%-of-compensation test). Additive: `CashFlowPreviewRow.rothIra` with the new `RothIraYear` type; warning code `bonusDeferralIgnored`; `impliedRaise`, `priceIndex` and `ageInYear` exported. Test-only subpath `@rn/engine/testing` (synthetic fixture rules; ESLint bans it in app code). No stored documents change. |
| 1.4.0 | 2026-10-19 | M3, **not purely additive**: `YearRow.cashFlow.netPay/surplus/infeasible`, `netIncome` and `real.netIncome` are now nullable (taxes are never filled in); `flows.forfeited` and `flows.surplusRouted` are new required fields; warning codes `featureNotModeled`, `withdrawalStrategyFallback` and `retirementContributionsReduced`; new `DashboardCards`, `DashboardResult` and `computeDashboard`; `projectHousehold` implemented; `CONTRACT_VERSION` moved to `contractVersion.ts` (re-exported from `api.ts`). No stored documents are affected. |
| 1.5.0 | 2026-10-19 | From the M3 review: `DashboardCards.longevity` (depletes) gains a required `personId`; the `summary.depletionAge` and `retirementYear` comments are corrected to their definitions. No stored documents are affected. |

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
| Projection rows, reconciliation, fees, timing modes, monthly mode | M3 ✅ |
| Dashboard cards + formula docs, forecast chart, offsets, markers (incl. first death), real/nominal toggle, allocation (a)(b) | M3 ✅ (readiness MC M6) |
| Part-time phase projection, surplus routing, vesting forfeiture | M3 ✅ (surplus routing needs verified taxes) |
| Spending plan, SS (entered / illustrative / spousal / survivor / reduction), pensions, one-time events, taxable basis and drag | M4 |
| Withdrawal ordering, RMDs, tax model, gross-up solver, survivor modeling, gross-to-net, HSA and Roth withdrawals | M4 |
| Scenarios CRUD, diff, presets A–G, compare, deterministic optimizer | M5 |
| Monte Carlo (all of §5.7), allocation (c), MC option in scenarios and the optimizer | M6 |
| 15 calculators | M7a |
| Insights; CSV/JSON export/import; migrations; print summary; delete-all | M7b |
| Full E2E, axe audit, performance, independent validation, user guide | M8 |

## Handoff
- **Done in M3:**
  - Engine `projection/`: `projectHousehold` (annual and monthly, both timings, fees and drag,
    vesting forfeiture, surplus routing, simple withdrawals before taxes) and `computeDashboard`
    (cards, readiness, ±offset reruns).
  - The forecast follows the owner decision (§1.7): unverified steps are left out and labeled.
  - Validation:
    - an independent Python reference with 19 fixtures, matching exactly;
    - property tests (10,000-run reconciliation with independent recomputation);
    - closed forms and annuity tables;
    - `pnpm bench`.
  - UI: the dashboard (cards, forecast chart, allocation views, year-by-year table, scope banner)
    and forecast settings on the Profile page.
  - Tests: 348 engine and 101 web unit tests; 24 E2E tests; 40 screenshots read back.
- **To tag M2 (`m2-accumulation`), unchanged:**
  1. Make irs.gov, ssa.gov and federalregister.gov reachable (environment network settings, likely
     in a new session).
  2. Verify each value at source (procedure in `docs/rules-verification.md`) and add the IRS
     Pub 590-A worked example test.
  3. Owner spot-checks the top 15 values.
  4. Tag.
- **Next (M4 Retirement income):**
  - Spending plan: steps, glide, pre-Medicare healthcare, survivor reduction.
  - Social Security: entered, illustrative, spousal and survivor benefits, plus the
    benefit-reduction option.
  - Pensions and one-time events.
  - Taxes in retirement: the RMD tax model with the gross-up solver, bracket-fill withdrawals,
    gross-to-net, HSA medical and Roth-basis withdrawals, survivor filing.
  - All of these rules are currently unverified, so they follow the §1.7 pattern or return
    `unverified`.
  - Also in M4:
    - extend the Python reference to the verified path (R6);
    - wire `inflationOverride` fully, ahead of M6;
    - move statutory ages into the rules data (M2 note);
    - fix the minor optional items from the M3 review.
- **Frozen contracts:** `packages/engine/src/domain/*`, `packages/engine/src/api.ts` (1.5.0).
- **Tags:** the session's git proxy refuses tag pushes (HTTP 403); branch pushes work.
  `m1-foundation` and `m3-forecasting` exist locally only. To publish from a clone, recreate them on
  the commits titled "fix(RetirementNavigator): resolve M1 review findings; start M2 rules data" and
  "fix(RetirementNavigator): resolve M3 review findings", for example
  `git tag -a m3-forecasting <commit> -m "M3 Forecasting" && git push origin m3-forecasting`.
- **Open risks:**
  - rule sourcing (blocked);
  - agent discovery (R3);
  - tag publishing (above);
  - before-limits and no-SS readings (R5);
  - reference coverage (R6);
  - bundle size (1,159 kB JS, to code-split in M8).
