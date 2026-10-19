# STATUS

Statuses: `done` · `simplified` (with limitation) · `unverified rule` · `not started`.

## Current phase
**M4 Retirement income: done** with two gates blocked on sources (the IRS RMD table example and the
Pub 915 worked example need verified values; see M4 gate evidence). Tagged `m4-retirement-income`
locally. **M5 Scenarios: done** (`m5-scenarios`). **M6 Monte Carlo: done** with the laptop
performance target **missed on this container** (see M6 gate evidence; `m6-monte-carlo`). **M7a
Calculators: done** (`m7a-calculators`). **M7b Insights, export, print: done** (`m7b-insights-io`).
**M8 Quality: in progress.** All tags are local only (tag pushes are refused; see Handoff).

**M2 is still untagged:** its gates wait on verified rule values and the owner's review of
`docs/rules-verification.md`. irs.gov, ssa.gov and federalregister.gov remain unreachable (see
Blockers).

Next: **M8** (independent validation report, final review sweep, docs, final STATUS).

## Milestone log
| Milestone | Status | Tag | Date |
|---|---|---|---|
| Phase 0 (plan, contracts, doc drafts) | done (plan approved; contracts approved 2026-10-18) | — | 2026-10-18 |
| M1 Foundation | done | `m1-foundation` (local only; see Handoff) | 2026-10-18 |
| M2 Accumulation engine, income, accounts | built; **tag waits on verified rules + owner review** | — | 2026-10-19 |
| M3 Forecasting | done | `m3-forecasting` (local only) | 2026-10-19 |
| M4 Retirement income | done (RMD and Pub 915 worked-example gates **blocked on sources**) | `m4-retirement-income` (local only) | 2026-10-19 |
| M5 Scenarios | done | `m5-scenarios` (local only) | 2026-10-19 |
| M6 Monte Carlo | done; **laptop target missed on this hardware** (6.0 s first run / 3.3 s warm vs 3 s) | `m6-monte-carlo` (local only) | 2026-10-19 |
| M7a Calculators | done | `m7a-calculators` (local only) | 2026-10-19 |
| M7b Insights, export, print | done | `m7b-insights-io` (local only) | 2026-10-19 |
| M8 Quality | in progress | | |

## M6 gate evidence
| Gate | Evidence | Result |
|---|---|---|
| Seed determinism and quick-run equality | Same seed and inputs → identical chunks; another seed differs; chunks split three ways and merged equal one chunk; a 1,000-path run is the prefix of a 2,000-path run (`montecarlo/run.test.ts`). Web: the quick-run chunk is reused by the full run and both summaries equal direct engine summaries; a pool of 3 executors equals one (`runner.test.ts`). | pass |
| Median reconciles with the deterministic baseline under zero volatility | Every path equals the baseline within a cent with taxes and withdrawals (fixture rules), with fixed inflation and with stochastic inflation at the plan's own rate (nominal and real); p50 ending = baseline ending; success rate = deterministic success. Independently: each cached path equals an uncached projection of independently rebuilt draws **bit for bit** for all 4 samples × both rule sets with stochastic inflation. | pass |
| PSD validation tested | Non-PSD 4×4 correlation (stochastic inflation) → `invalid` with a clear message; the optimizer reports it once; the UI blocks the run for 3×3 and 4×4 cases (`random.test.ts`, `run.test.ts`, `MonteCarloPage.test.tsx`). | pass |
| Performance targets measured and recorded | See below. Laptop target (10,000 paths × 60 years < 3 s) **missed on this container**; phone target (< 10 s, emulated) met only as a projection. | **partial** |
| + MC option in scenarios and the optimizer; MC readiness | Compare view success rates equal direct engine summaries per applied scenario; optimizer MC result equals `optimizeRetirementAge` with the same config (worker, per-age progress, cancel); readiness band equals `monteCarloReadiness`. | pass |

### Performance (measured 2026-10-19, 4-core Intel Xeon @ 2.1 GHz cloud container)
| Measurement | Result | Source |
|---|---|---|
| Node, one thread, 10,000 paths × 60 years, bundled rules (before taxes) | 8.2 s (0.82 ms/path); projected 2.2 s over 4 workers | `packages/engine/bench/results/montecarlo.json` |
| Node, one thread, same with the synthetic verified rules (taxes and gross-up) | 12.6 s (1.26 ms/path); projected 3.3 s over 4 workers | same |
| Browser, headless Chromium, 4 Web Workers, Mid-career couple (before taxes) | **6.0 s** on the first run after opening the page; **3.3 s** on the next run (quick run 1.5 s / 1.0 s) | `apps/web/bench-results/montecarlo-browser-desktop.json` |
| Phone, emulated: 4× CPU throttling on the main thread, one thread (measured) | 34 s; **projected 8.5 s over 4 workers** | `apps/web/bench-results/montecarlo-browser-mobile.json` |

- **Target status:** the laptop target (3 s) is **not met on this container** (a 2.1 GHz server core in
  headless Chromium); a typical laptop core is faster, but no laptop was measured, so no laptop claim
  is made. The phone target is met only as a projection: Chromium cannot throttle Web Workers
  ("Operation is only supported for pages, not workers"), so the phone run is the throttled main thread
  and the 4-worker figure divides it (ideal scaling; a phone may have fewer fast cores).
- **Optimized first (results unchanged, tested):** locale formatting removed from message text, rule
  resolution cached, return-independent work shared across paths, a run prepared once per worker
  range, workers spawned and warmed when the page opens; about 4–10× faster per projection than at the
  start of M6. The remaining cost is mostly the gross-up solver's tax evaluations (with verified rules)
  and building each year's row.
- **First-run gap:** the first run in fresh workers is slower (V8 warm-up); the page warms its workers
  on open, but a run started immediately still sees it.
- The Monte Carlo optimizer scans ages in one worker (about 21 s for 33 ages × 1,000 paths); progress
  and cancel keep the page responsive. Spreading ages over the pool is a follow-up.

## Review findings (M6)
| # | Finding | Severity | Resolution |
|---|---|---|---|
| B1 | Phone target not measured; page CPU throttling does not reach workers | blocking | Phone run moved to the throttled main thread (measured) with a labeled projection; laptop measured with real workers; shortfall recorded above |
| S2 | §11 said stochastic inflation drives all spending; working-years spending uses the assumption | should fix | Docs and code comment corrected |
| S3 | The optimizer hid a Monte Carlo failure as "no age qualifies" | should fix | `invalid` with issues; `monteCarloPaths` reported; UI lists issues |
| S4 | A worker that fails to load hung the run at 0% | should fix | Persistent error listener; the range fails with "The simulation worker could not start" (tested) |
| S5 | Missing regression tests (cache = uncached; zero volatility with stochastic inflation) | should fix | Added (bit-for-bit and within a cent) |
| — | Per-sub-chunk re-preparation; histogram when nearly all paths deplete; unused field; legend wording; assumptions text | optional | All fixed |

## M7a gate evidence
| Gate | Evidence | Result |
|---|---|---|
| Each calculator has a closed-form or engine-parity test | 133 engine tests (closed forms FV, growing annuity, payment, withdrawal exhaustion, coast number, inflation conversions, SS proration and break-even; parity with `computeMatch`, `compareScenarios`, brute-force retirement age, `ssBenefitAtClaim`); web `parity.test.tsx`: all 15 through the UI equal the engine | pass |
| No duplicated formulas | `noDuplicatedFormulas.test.ts` fails on `Math.pow`, `**`, `Math.exp*`, `Math.log*` in calculator sources (and tests itself); the UI calls only engine functions (review) | pass |
| + Roth-vs-traditional link wired | Roth IRA page and Income & Savings link to the prefilled calculator (RTL and E2E) | pass |

## M7b gate evidence
| Gate | Evidence | Result |
|---|---|---|
| Every insight re-runs the engine | A spy on `projectHousehold` counts ≥ 1 + insights runs; re-applying each insight's own ops reproduces its figure exactly (`insights.test.ts`) | pass |
| CSV injection test | `=`, `+`, `-`, `@`, tab and CR cells escaped; plain numbers kept; a formula in an account name is escaped (`io.test.ts`); download content equals `toCsv` (RTL, E2E) | pass |
| Migration fixtures from every prior version | Schema version 1 is the only version; a fixture exists for every version up to the current one and the test enforces it (`io/fixtures/v1-export.json`) | pass |
| Malformed JSON rejected with clear messages | Empty, broken JSON, non-object, wrong format, bad/newer schemaVersion, oversized, field errors with paths, dangling scenario base profile, duplicate profiles; UI shows each problem and changes nothing (RTL, E2E) | pass |
| + Delete-all | IndexedDB stores and the app's localStorage key cleared, stores reset, back to onboarding (RTL, E2E) | pass |

## Review findings (M7a, M7b)
| # | Finding | Severity | Resolution |
|---|---|---|---|
| B1 | The Social Security claiming insight misstated results: an amount entered at the claiming age was only delayed (lifetime −$36,000), a person already claiming was back-dated, months were dropped | blocking | Only unclaimed, PIA-based, in-forecast benefits move; +12 months, up to 70; tests for each case |
| B2 | The full-match insight summed tier bands (missed bonus-eligible pay, caps, the compensation limit; overshot or undershot) | blocking | Gated on the engine readout's `unclaimed`; smallest 0.01% salary rate whose readout leaves nothing unclaimed; minimality tested |
| S3 | "Savings needed" was a flat nominal amount labeled today's dollars | should fix | Today's dollars rising with inflation; over-pay years mentioned |
| S4 | JSON import accepted duplicate scenario ids and mismatched inner ids | should fix | Rejected with messages; tests |
| — | Retire-later no-op card; shock years not shifted; delete-all E2E depth; theme rewritten at start-up after delete-all | optional | Fixed (the theme is stored only when chosen; E2E checks IndexedDB and localStorage after a reload) |
| — | Export leaves out stored documents that failed validation, and "Replace all data" then removes them; couple prefill pairs household totals with one person's ages | optional | Recorded here; the import preview counts what the file holds |

## M5 gate evidence
| Gate | Evidence | Result |
|---|---|---|
| Diff semantics: orphaned ops reported, base edits flow through | `scenario.test.ts`: set/unset/add by entity id on a copy; ops on deleted entities and plans of a deleted person are `missingEntity` / `missingParent`; unknown fields and prototype keys are `invalidPath` (never applied); unsetting a required field gives issues and no household; a base edit to an untouched field reaches the scenario. Web: the orphan warning after deleting an account, and base edits reaching the compare table (`ScenariosPage.test.tsx`). | pass |
| Optimizer equals brute force | Single person, and a couple with salary stop ages (partner shifted, stop ages cleared), each against a separately written scan; the Monte Carlo criterion against running each candidate's paths directly. Web: the optimizer table equals `optimizeRetirementAge`. | pass |
| Preset D reproducible | Two builds give identical ops and identical projections; the shock replaces the return in its years; the default start is the first retirement year and never before the current year. | pass |
| + `pnpm verify` green | typecheck, lint, format, unit (engine 535, web 150), reference (43), build, E2E (32, including the M5 spec with axe in both themes and phone width) | pass |

## Review findings (M5)
The code-reviewer pass ran as a general-purpose agent following `.claude/agents/code-reviewer.md`
(commit `5a94b9e`), confirming the first finding with a probe test.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| B1 | A stored scenario path `['__proto__', …]` polluted `Object.prototype` and made validation throw; `set` on a misspelled field was counted as applied | blocking | Fixed: the schema rejects `__proto__`/`constructor`/`prototype`; paths walk own keys only; a missing field is `invalidPath`. Tests. |
| B2 | No pre-Medicare healthcare note on the Scenarios page | blocking | Fixed: per-plan forecast notes above the compare table; the optimizer shows the note when a scanned age is below 65. RTL tests. (The optimizer check uses the first person's ages; a partner shifted below 65 is covered by the compare view's per-plan notes, not the optimizer note.) |
| S3 | Presets E and B and the optimizer put retired people back to work | should fix | Fixed in the engine (skip people already retired; optimizer refuses a retired first person); UI explains. |
| S4 | Preset D could start in the past | should fix | Fixed: never before the current year; UI range checks. |
| S5 | Preset values go stale when the base changes | should fix | `presetDrift` + "Rebuild from base plan"; editing a preset makes it custom. |
| S6 | The UI recomputed the shock's total drop | should fix | Engine `marketShockTotal`. |
| S7 | Missing "before plan limits" labels on balance figures | should fix | Fixed on the compare table, chart, data table and optimizer. |
| S8 | Test gaps | should fix | Brute force with a couple and stop ages; after-tax figure hand-computed with the synthetic fixture (= $240,000); preset D default checked independently; unset required; orphaned plan ops; preset C/G edge cases. |
| — | Preset B on a retiree moved the age later; `Math.round` in F; real values from rounded cents; store details; raw issue paths | optional | All fixed. |

No open blocking or should-fix findings.

## M4 gate evidence
| Gate | Evidence | Result |
|---|---|---|
| The gross-up solver converges on all fixtures and handles non-convergence | Every retirement row of the 15 verified-path reference fixtures converges, and every figure matches the independent Python reference. A 300-run property test asserts convergence and net income ≥ need − tolerance. A 1-iteration budget reports `converged: false` with the last estimate and `grossUpNotConverged` (`grossUp.test.ts`, `retirement.test.ts`). Withdrawals are capped at what is available; the unfunded part is reported only when every cap is exhausted. | pass |
| RMDs match IRS table examples | RMD mechanics (start age by birth year, prior year-end balance ÷ period, survivor's age after death, Roth 401(k) flag, excess reinvested after tax) are tested against the synthetic fixture and the Python reference. The IRS Uniform Lifetime Table example (Pub 590-B) needs the publication and verified table values, which are unreachable. With the bundled rules RMDs are left out and labeled (`rmd`). | **blocked (sources)** |
| Survivor orderings pass | Older or younger spouse dying first, and equal planning ages, each with Social Security step-up, pension continuation, filing status, deductions in the death year and the survivor's RMD age (`retirement.test.ts`; fixtures `verified-survivor-older-dies-first`, `-younger-dies-first`, `-equal-planning-ages`, `verified-rmd-excess-reinvested-survivor-rollover`). | pass |
| Unverified paths return `unverified` | FRA, claim factors, spousal and survivor amounts, the estimator, RMDs, Roth qualification and taxes each return `unverified` with their keys against the bundled rules; the forecast leaves those steps out and labels them (§1.7). `atClaimAge` needs no rule. Tests in `socialSecurity.test.ts`, `rmd.test.ts`, `tax.test.ts`, `retirement.test.ts`, and bundled-rules reference fixtures. | pass |
| + Pub 915 worked example for taxable Social Security | The provisional-income method is tested by hand against the synthetic fixture (`tax.test.ts`) and the reference. Pub 915's worked example needs the publication. | **blocked (sources)** |
| + `pnpm verify` green | typecheck, lint, format, unit (engine + web), reference check, build, E2E | pass |

### M4 test results (2026-10-19, this container)
- Engine: 23 files, 490 tests. Coverage 98.8% lines, 90.8% branches, 98.3% functions.
- Web: 25 files, 131 tests (RTL); 90.4% lines, 74.3% branches.
- Python reference: `OK: 43 fixtures match the reference` (15 on the verified path with the
  synthetic fixture rules; R6 is resolved).
- E2E: 32 passed, desktop and mobile, including Social Security and a pension flowing into the
  gross-to-net table and surviving a reload, axe in both themes with every table open, phone width.
- Visual: 48 screenshots (12 pages × desktop/mobile × light/dark) read back.

### Synthetic fixture values changed (M4 review S7)
The fixture now uses values that differ from current law (spousal 45%, survivor 95%, PIA factors
0.85/0.3/0.2, RMD start ages 71/74, Roth qualifying age 59y4m with a 4-year rule, FICA 6%/1.5%,
capital-gains rates 0/10/25%, benefit-taxation shares 40%/80% with thresholds $20k/$30k and
$30k/$40k, IRA $8,500 + $1,200, HSA catch-up $1,200, 60–63 catch-up $9,000, senior-deduction
phase-out 5% through 2029). The reference fixtures were regenerated and every hand-computed test
was recomputed. The change exposed one real defect: the engine wrote the provisional-income share
of benefits as ½ instead of reading the rule; it now reads `tier1` (§6).

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
| Profile and household editor (spouse add/remove, assumptions, anchor year) | done | |
| Accounts CRUD (all types, schedules, fees, allocation, deletion guards) | done | |
| Roth IRA page (MAGI estimate and override, eligibility readout) | done / **unverified rule** | Spousal and backdoor Roth unsupported (stated) |
| HSA page (coverage, HDHP attestation, limit, medical expenses) | done / **unverified rule** | Qualified medical withdrawals in retirement (M4) |
| Sample profiles (4), onboarding, multiple profiles | done | |
| Sub-agents and skills | simplified | Skills are discovered; agents are not (R3); delegation uses general-purpose agents told to follow the definitions |
| Projection engine (per-year rows, per-account flows, nominal and real, fees and taxable drag, mid-year / start-of-year timing, monthly mode, return precedence, offsets, market shock) | done | `projection/`; validated against the Python reference |
| Contributions in the forecast | done / **unverified rule** | Owner decision 2026-10-19: as elected, **before plan limits**, labeled, while limits are unverified. This can overstate savings for people above the limits. |
| Accumulation cash flow in the forecast | done / **unverified rule** | Net pay, surplus and the tax-based infeasible flag are null while taxes are unverified. A rule-free check still flags years where pay is below spending. Surplus routing works only with verified taxes. |
| Vesting forfeiture at separation | done | The entered unvested balance is the not-yet-vested part; tests cover cliff and graded |
| Part-time phase in the projection | done | Stops at the person's modeled death |
| Withdrawal strategies (taxable first, traditional first, Roth last, proportional, bracket fill) | done / **unverified rule** | Grossed up for taxes with verified tax rules; before taxes (labeled) while they are unverified. Bracket fill needs verified brackets and falls back to taxable first with a warning. |
| Dashboard cards (10) with formula docs and tests; readiness heuristic | done | Retirement income reads "before taxes" while tax rules are unverified |
| Forecast chart (baseline, fixed-offset lines, retirement / first-death / depletion markers, annual flows), today's/future toggle | done | Every chart has a data table |
| Allocation views (a) account type, (b) tax treatment | done | (c) asset class in M6 |
| Forecast settings (timing, granularity, order, surplus, offsets, minimum ending balance) | done | Profile page |
| Spending plan: steps, real glide, pre-Medicare healthcare, survivor reduction | done | Rule-free; a persistent note when anyone retires before 65 |
| Social Security: entered at claiming age | done | Rule-free |
| Social Security: statement PIA, illustrative estimator, spousal, survivor, benefit-reduction assumption | done / **unverified rule** | Left out and labeled while SSA rules are unverified; the estimator is labeled "not an official SSA calculation"; earnings test is a warning only |
| Pensions (annuity, COLA, survivor fraction, lump sum) and one-time events | done | Rule-free except the taxes on them |
| RMDs (start age, Uniform Lifetime Table, survivor's age, excess reinvested) | done / **unverified rule** | Left out and labeled with the bundled rules |
| Retirement taxes, gross-up solver, gross-to-net view, filing after a death | done / **unverified rule** | Gross-to-net shows "Unverified rule" or "Before taxes", never estimated |
| HSA qualified medical and Roth-basis withdrawals, early-withdrawal flags | done / **unverified rule** | Penalties are flagged, not modeled |
| Retirement Income page (SS, pensions, events, spending plan, gross-to-net, claiming-age comparison) | done | |
| Scenarios: create, save, duplicate, rename, delete, compare (up to 4 + base), presets A–G, custom overrides, drift rebuild | done | Opt-in Monte Carlo success rates per plan |
| Retirement-age optimizer (deterministic or Monte Carlo criterion) | done | |
| Monte Carlo: worker pool, quick run then full run, progress, cancel, settings, capital-market editor, success rate with assumptions, bands, histogram, depletion ages, sequence illustration, methodology | done | Laptop performance target missed on this container (see M6) |
| Allocation view (c) by asset class | done | Sample profiles set no allocation, so they show "no allocation" |
| Monte Carlo in scenario comparison, optimizer and dashboard readiness | done | The optimizer's MC scan uses one worker |
| Calculators (15) and the Roth-vs-traditional link | done / **unverified rule** where rules are needed | Unverified results show "Not available yet"; most figures are before taxes and limits |
| Insights (8 what-ifs) | done | Re-run through the engine |
| JSON export/import, CSV export, delete all, printable summary | done | |

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
- **R5:** Until rules are verified, the forecast's contributions are before plan limits (savings
  may be overstated for high savers) and retirement is before taxes, with no statement-based Social
  Security, spousal/survivor amounts or RMDs. Entered Social Security (`atClaimAge`), pensions and
  events are included. The dashboard banner lists what is left out.
- **R6 (resolved in M4):** the Python reference now covers the verified path (15 fixtures).
- **R7 (M4):** bracket fill can overshoot the bracket top because Social Security inclusion and the
  senior-deduction phase-out react to the withdrawal (documented in §7.3).
- **R8 (M4):** an `invalid` engine sub-result inside the projection reads as "no value" (`Gaps.take`);
  no case is known with a valid household. Accumulation-year taxes use the RMD before the
  forfeiture cap (only differs if a forfeiture leaves less than the RMD in that account).
- **R9 (M4):** statutory constants (Medicare age 65, claim range 62–70, the estimator's 35/420/62/E−2)
  are in code, listed in `rules-verification.md` for verification.

## Review findings (M4)
The code-reviewer pass ran as a general-purpose agent following `.claude/agents/code-reviewer.md`
(M4 engine, reference and Retirement Income page).

| # | Finding | Severity | Resolution |
|---|---|---|---|
| B1 | A working-years one-time outflow that savings could not cover was reported as depletion | blocking | Fixed: depletion is a retirement-phase event; the shortfall raises `oneTimeOutflowUnfunded`. Test added. |
| B2 | A spouse with no benefit of their own (`none`) got no spousal amount, and spousal could be paid off a zero benefit | blocking | Fixed: `none` has PIA 0 (full spousal excess); no spousal amount off a zero benefit. Test added; §7.5. |
| S1 | Death-year joint return ignored the deceased's 65+ deductions; survivor spending cut skipped working years | should fix | Fixed in engine, reference and §5/§7.7; tests added. |
| S2 | Survivor benefit could start before the survivor's own claim year; an unclaimed deceased benefit was reduced for the death age | should fix | Fixed: starts at the survivor's claim year (prorated); `PIA × max(1, f)`. Tests; §7.5. |
| S3 | Income beyond the need with no taxable or cash account vanished silently | should fix | Fixed: `excessIncomeSpent` warns once. |
| S4 | Tax detail mixed gains into ordinary income | should fix | Fixed: ordinary = AGI − gains. Test added. |
| S5 | Destination rules differed between engine validation and the UI, and allowed tax-advantaged "other" accounts | should fix | Fixed: shared `canReceiveTaxableMoney` / `canReceiveLumpSum` (contract 1.8.0); tests. |
| S6 | Statutory constants typed into code (65, 62–70, estimator method, a "12%" example, 67 earnings-test fallback) | should fix | The fallback and the example are removed; the rest is listed in `rules-verification.md` (R9). |
| S7 | Synthetic fixture values equal to current law | should fix | Changed (see M4 gate evidence); this caught the hard-coded ½ in provisional income. |
| S8 | UI tips contradicted the engine (survivor cut timing, healthcare line) | should fix | Wording fixed (Spending plan, Profile). |
| S9 | The early-retirement healthcare note was not persistent | should fix | Fixed: `healthcarePreMedicareUserEntered` on every forecast where someone retires before 65, shown on the dashboard. |
| — | `Gaps.take` turns `invalid` into null | optional | Documented (R8) |
| — | Bracket-fill fallback message named only brackets | optional | Fixed wording |
| — | Bracket fill can overshoot | optional | Documented (R7) |
| — | Accumulation tax uses the uncapped RMD | optional | Documented (R8) |
| — | Pension already in payment before year 1 not described | optional | §7.6 and the Pensions tip |
| — | Unused `deposits` map; stale header comment; §7.6 basis wording | optional | Fixed |

No open blocking or should-fix findings.

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
| 1.6.0 | 2026-10-19 | M4, **not purely additive**: new SS source kind `atClaimAge`; new required flows `rmd`, `hsaMedical`, `reinvested`; warning code `oneTimeInflowSpent`; M4 functions implemented and re-exported. Stored profiles gain no required field (the new source kind is optional input). |
| 1.7.0 | 2026-10-19 | M4 validation: lump-sum and inflow destination types are checked, duplicate earnings years rejected (stricter; a stored profile violating these fails validation with a clear message). |
| 1.10.0 | 2026-10-19 | Additive: the 15 calculators and their schemas/result types, `CALCULATORS`, `runCalculator`; `prepareMonteCarlo`, `runPreparedChunk`, `PreparedMonteCarlo`; `impliedArithmeticMeans`, `monteCarloReadiness`; `computeInsights` implemented. `OptimizerResult` gains a required `monteCarloPaths` (callers that build it must set it; the app only reads it). No stored documents change. |
| 1.9.0 | 2026-10-19 | From the M5 review and M6/M7b engine work. **Stricter:** scenario paths reject prototype keys, and a `set` on a field that does not exist is an orphaned `invalidPath` op (stored scenarios with such ops now show them as not applied). **Changed signature:** `summarizeMonteCarlo(chunks, config, household, firstYear)` (it needs the capital-market assumptions; it was a stub). Additive: `presetDrift`, `marketShockTotal`, `runMonteCarloChunk`, `isPositiveSemiDefinite`, `allocationByAssetClass`, `sequenceRiskIllustration`, `toCsv` options for display names and `csvCell`, `exportJson`, `importJson`, `MAX_IMPORT_CHARS`; presets record `currentYear` in `presetParams`; the optimizer's Monte Carlo criterion. No stored documents change shape. |
| 1.8.0 | 2026-10-19 | M5 `compareScenarios` (dashboards per scenario plus an after-tax ending balance that stays null while taxes are unverified). From the M4 review: warning codes `oneTimeOutflowUnfunded`, `excessIncomeSpent`; shared destination helpers `canReceiveTaxableMoney` and `canReceiveLumpSum`, and an "other" account must be taxed as taxable to receive surplus, inflows or a non-rollover lump sum (stricter). |

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
| Spending plan, SS (entered / illustrative / spousal / survivor / reduction), pensions, one-time events, taxable basis and drag | M4 ✅ (SSA rules unverified) |
| Withdrawal ordering, RMDs, tax model, gross-up solver, survivor modeling, gross-to-net, HSA and Roth withdrawals | M4 ✅ (tax and RMD rules unverified) |
| Scenarios CRUD, diff, presets A–G, compare, deterministic optimizer | M5 ✅ |
| Monte Carlo (all of §5.7), allocation (c), MC option in scenarios and the optimizer | M6 ✅ (laptop target missed here) |
| 15 calculators | M7a ✅ |
| Insights; CSV/JSON export/import; migrations; print summary; delete-all | M7b ✅ |
| Full E2E, axe audit, performance, independent validation, user guide | M8 |

## Handoff
- **Done in M4:**
  - Engine: spending plan, Social Security (all input kinds, spousal, survivor, reduction),
    pensions, one-time events, RMDs, HSA medical and Roth-basis withdrawals, the gross-up solver,
    bracket fill, retirement taxes and survivor filing, all following §1.7 while rules are
    unverified.
  - Validation: the Python reference covers 43 fixtures (15 on the verified path); property tests
    for solver convergence; hand-computed tests on a synthetic fixture whose values differ from law.
  - UI: the Retirement Income page (Social Security with the claiming-age comparison, pensions,
    one-time events, spending plan, gross-to-net) and the dashboard notes.
- **Done in M5:** the scenario engine (diffs, presets A–G, drift, optimizer, comparison) and the
  Scenarios page (list, editor, compare view with chart and table, optimizer), persisted per profile.
- **M6 so far:** the Monte Carlo engine, the optimizer's Monte Carlo criterion, the sequence
  illustration, allocation (c) data, and `pnpm bench` results in
  `packages/engine/bench/results/montecarlo.json` (single Node thread on this 2.1 GHz container:
  0.87 ms per path before taxes, 1.32 ms with taxes and gross-up; 10,000 paths × 60 years projected at
  2.3 s and 3.4 s over 4 workers — the taxed case is over the 3 s laptop target on this hardware; a
  browser measurement with real workers follows with the M6 UI).
- **M7b so far:** CSV export and JSON export/import in the engine.
- **To tag M2 (`m2-accumulation`), unchanged:**
  1. Make irs.gov, ssa.gov and federalregister.gov reachable (environment network settings, likely
     in a new session).
  2. Verify each value at source (procedure in `docs/rules-verification.md`, including the
     statutory constants) and add the IRS worked-example tests (Pub 590-A phase-out, Pub 590-B
     RMD table, Pub 915).
  3. Owner spot-checks the top 15 values.
  4. Tag.
- **Done in M6–M7b:** the Monte Carlo engine and page (workers, quick run, bands, success rate with
  assumptions, sequence illustration, methodology), Monte Carlo in scenarios, the optimizer and the
  dashboard readiness card, allocation view (c); the 15 calculators; insights; JSON/CSV export and
  import; delete all; the printable summary.
- **Next (M8):** file the fresh-context validation report (`docs/validation-report.md`), resolve the
  final review sweep, finish the user guide, and write the final STATUS with every shortfall.
- **Frozen contracts:** `packages/engine/src/domain/*`, `packages/engine/src/api.ts` (1.10.0).
- **Tags:** the session's git proxy refuses tag pushes (HTTP 403); branch pushes work.
  `m1-foundation`, `m3-forecasting`, `m4-retirement-income`, `m5-scenarios`, `m6-monte-carlo`,
  `m7a-calculators` and `m7b-insights-io` exist locally only. To publish from a
  clone, recreate them on the commits titled "fix(RetirementNavigator): resolve M1 review findings;
  start M2 rules data", "fix(RetirementNavigator): resolve M3 review findings" and
  "docs(RetirementNavigator): M4 status, statutory constants, fixture policy", for example
  `git tag -a m4-retirement-income <commit> -m "M4 Retirement income" && git push origin m4-retirement-income`.
- **Open risks:**
  - rule sourcing (blocked);
  - agent discovery (R3);
  - tag publishing (above);
  - before-limits and before-taxes readings (R5);
  - bracket-fill overshoot, `Gaps.take`, statutory constants (R7–R9);
  - bundle size (to code-split in M8).
