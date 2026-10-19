# Independent Financial Validation Report (M8)

**Date:** 2026-10-19
**Validator:** fresh-context `qa-engineer` sub-agent (BRIEF §6, "Independent validation")
**Code under test:** `RetirementNavigator/` at commit `a1050d8` (engine last changed in `fde1b53`,
"M7 review – claiming and match insights, savings in today's dollars …"). The main agent committed that
change while this pass was running; it also revised the §13 table of `docs/financial-model.md`. The full
check suite was re-run at `a1050d8` with identical results, and the §13 checks were rewritten against
the revised §13 text.

Results are model-dependent educational estimates. Every number below was computed from synthetic
fixture rules (`src/testing/fixtureRules.ts`, deliberately **not** real IRS/SSA values) or from the
bundled rules (every regulatory value unverified). No real IRS/SSA value was used or written anywhere.

## 1. Method and access rule

**Rule followed (BRIEF §6):** the validator reads only `docs/financial-model.md` and the tests, never the
engine implementation.

- **Read:** `docs/financial-model.md`, `docs/assumptions.md`, `docs/BRIEF.md` (§6), `docs/testing-strategy.md`;
  test files (`*.test.ts` headers, titles and selected bodies, to learn call shapes and coverage);
  `packages/engine/reference/ref.py` (docstring and the rules/tax helpers) and the fixture list;
  `packages/engine/src/testing/fixtureRules.ts`; the public contract `packages/engine/src/api.ts` and
  `packages/engine/src/domain/*.ts`; the barrel `packages/engine/src/index.ts` (export names only);
  `packages/engine/package.json` and `vitest.config.ts` (to run Vitest).
- **Not read:** every other file under `packages/engine/src/` (projection/, tax/, income/, limits/, match/,
  socialSecurity/, rmd/, scenario/, montecarlo/, calculators/, insights/, io/, rules/ data, money.ts,
  time.ts, samples/) and `apps/web/src` non-test files.
- **Disclosed slips (no effect on the findings):**
  1. One `grep -rn "summarizeMonteCarlo("` over `src/` printed a single declaration line from
     `montecarlo/run.ts` (`export function summarizeMonteCarlo(`). No body or logic was seen.
  2. An early introspection probe wrote `packages/engine/schemas.json` (zod-to-JSON-schema dump of the
     public calculator input schemas) into the repo by mistake because Vitest's working directory was
     the engine folder. The file was deleted during the pass; the last commit (`c2dee9b`, "untrack a
     generated schema dump committed by mistake") appears to be the main agent cleaning it up.
- **Black-box harness:** 14 Vitest files in the scratchpad (`…/scratchpad/qa/`), importing only
  `packages/engine/src/index.ts` (the `@rn/engine` barrel) and `src/testing/fixtureRules.ts`
  (`@rn/engine/testing`). Calculator input field names came from the exported zod schemas
  (`z.toJSONSchema`) and output field names from observed results, never from source. Each check
  records `{claim, hand-derived expectation, API result, verdict}`; expectations are written from the
  doc formulas (arithmetic shown in each claim). Run: `cd packages/engine && npx vitest run --root
  <scratchpad>/qa --config <scratchpad>/qa/vitest.config.ts`.
- **Tolerances:** as documented: exact cents for closed forms that the doc says round once (most
  checks); ±1 cent where the doc says "within a cent"/float error; the gross-up's $1 (`toleranceCents`
  100); bisection searches "at most $1 above" or 1e-6 for rates; Monte Carlo statistics ±3 standard
  errors for means and ±5% for standard deviations at 1,000–2,000 paths.
- **Verdicts:** PASS = the API equals the doc-derived value within tolerance. FAIL = the API contradicts
  the doc. AMBIGUOUS = the doc does not determine the value (the API result is reported, not judged).
- **Units:** in the tables, money is **integer cents** (e.g. `7105573` = $71,055.73); rates are decimals.

## 2. Summary

| Section | Checks | Pass | Fail | Ambiguous |
|---|---|---|---|---|
| §1.1–1.6 Conventions, rounding, time axis, timing, monthly mode | 41 | 41 | 0 | 0 |
| §1.7 Unverified rules in the forecast | 5 | 4 | 1 | 0 |
| §2 Rules resolution | 4 | 4 | 0 | 0 |
| §3 Income, contributions, limits, match, vesting, accumulation cash flow | 39 | 39 | 0 | 0 |
| §4 Accounts, growth, fees, basis, depletion | 12 | 12 | 0 | 0 |
| §5 Spending | 3 | 3 | 0 | 0 |
| §6 Tax model | 12 | 12 | 0 | 0 |
| §7 Retirement income (order of operations, solver, strategies, Roth/HSA, SS, pensions, survivor) | 57 | 52 | 0 | 5 |
| §8 Dashboard cards | 7 | 7 | 0 | 0 |
| §9 Optimistic / pessimistic offsets | 2 | 2 | 0 | 0 |
| §10 Scenarios, presets, optimizer, comparison | 15 | 15 | 0 | 0 |
| §11 Monte Carlo, sequence and allocation views | 17 | 17 | 0 | 0 |
| §12 Calculators | 26 | 25 | 0 | 1 |
| §13 Insights | 11 | 11 | 0 | 0 |
| I/O (export) | 1 | 1 | 0 | 0 |
| **Total** | **252** | **245** | **1** | **6** |

**252 independent checks (many with several assertions each): 245 pass, 1 fail, 6 ambiguous.** Every
closed form tried matched to the cent: timing factors (mid-year, start-of-year, both monthly modes and
the withdrawal caps), real/nominal conversion, half-to-even rounding and unrounded carry-forward, fees and
drag, raises/overrides/bonuses, tiered match with caps and zero-rate tiers, vesting with the
"entered = unvested today" convention and a growing ledger, every 402(g)/catch-up/Roth-catch-up/415(c)/
401(a)(17) branch, Roth phase-out start/mid/end for both statuses with the worksheet rounding, the
tax model (stacked gains, senior phase-out, sunset, Pub 915 tiers, per-person wage base), the gross-up
iteration sequence itself, all five strategies, RMD boundaries, Social Security factors, spousal and
survivor orderings, pensions and events, scenarios and presets, Monte Carlo determinism plus a
statistical check of `σ_a² = wᵀΣw`, and the calculator closed forms.

## 3. Discrepancies (ranked by severity)

Only one check contradicts the document. The ambiguities in §5 are ranked separately; two of them
(A1, A2) describe behavior that understates tax or leaves a survivor path undefined and are worth
treating with the same priority as D1.

### D1 (low–medium): `payrollTax` missing from `excludedFeatures` / `unverified` when a contribution limit is unverified

- **Doc (§1.7):** "Taxes unverified (`federalIncomeTax`, `payrollTax`): net pay, surplus, the infeasible
  flag and net income are null" and "`ProjectionResult.excludedFeatures` lists every skipped feature,
  `unverified` lists the rule keys, and the UI shows … a badge on each dependent card and chart."
- **API:** with the bundled rules, a wage earner **without** a workplace plan gets
  `excludedFeatures = ["federalIncomeTax", "payrollTax"]` and the payroll keys
  (`payroll.ssWageBase`, `standing:payroll.oasdiEmployeeRate`, `…medicareEmployeeRate`) in `unverified`.
  The **same person with a 401(k)** (or with only an HSA schedule) gets
  `["workplaceLimits", "federalIncomeTax", "rmd"]` (`["hsaLimits", "federalIncomeTax"]` for the HSA case):
  `payrollTax` and every payroll key are absent, although net pay is still null and FICA is computed on
  gross wages, so the payroll rules are needed regardless of the deferrals.
  `previewAccumulation` for the same household lists only the three workplace keys (no tax keys at all)
  while its `netPay` is null.
- **Impact:** labels only (no number is filled in), but the "every skipped feature" contract and any UI
  badge keyed on `payrollTax` are incomplete for most real households (anyone with a 401(k) or HSA).
- **Reproduction** (bundled `RULES`, `currentYear` 2026): single person born 1986, retirement age 65,
  planning age 90, `employment = { baseSalary: 10_000_000, raise: { mode: 'nominal', rate: 0 } }`,
  `workplacePlans = [{ id: 'w', planType: '401k', traditionalAccountId: 'k', traditionalPctOfSalary: 0.1,
  match: { tiers: [{ matchRate: 1, bandPctOfPay: 0.03 }] } }]`, accounts `[cash 'c' 0,
  workplaceTraditional 'k' 0]`, `currentAnnualSpending 1_000_000`, inflation 0. Compare
  `projectHousehold(h).value.excludedFeatures` with the same household minus the plan. (Checks 1.7d, 1.7f.)
- **Not covered by any test** (the only test file mentioning `payrollTax` is `rules/rules.test.ts`).

No other API result contradicted the document.

## 4. Test-coverage gaps

Coverage was judged from test titles, headers and the bodies read for call shapes (not from coverage
reports). Each gap names the check in this report that now exercises the claim.

| # | Claim | What the repo tests do | Gap | This report |
|---|---|---|---|---|
| G1 | §1.7 `excludedFeatures` lists every skipped feature | presence of some features is asserted | nothing asserts `payrollTax` (or payroll keys) when a contribution limit is unverified; this is where D1 lives | 1.7d, 1.7f |
| G2 | §3.2 deferral percentages apply to pay up to `L^comp`, scaled pro rata | `preview.test.ts` caps a salary-only election (5% × 300,000) | no case with different salary and bonus percentages above `L^comp` (the reference marks "two deferral buckets scaled pro rata" Unsupported) | M1 (17,142.86 = 20,000·300/350) |
| G3 | §11 account volatility `σ_a² = wᵀΣw`, correlated shocks, no-allocation accounts on the stock shock at `blendedVolatility`, stochastic-inflation distribution | median within 4%, arithmetic mean, determinism, zero volatility, PSD | no test checks a path standard deviation, a cross-account correlation, the blended-volatility coupling or the inflation draw | 11d, 11e, 11j, N9 |
| G4 | §7.2 iteration `W_0 = need + tax(0)`, `W_{k+1} = need + tax(W_k)`, last iterate on non-convergence | convergence, `converged=false` + warning, depletion | the iterate values and which iterate is returned are not asserted | 7.2e (60,000 → 69,600 → 72,000 → 72,630) |
| G5 | Paths the Python reference raises `Unsupported` on | not in the golden fixtures; title search found no unit test for most | pension owner dying before the start age; working-year outflow from a traditional account (tax treatment); RMD while a spouse works; spousal months in a partial claim year; survivor who has not claimed by D | M7, Q2, Q1 (ambiguous); M8, M9 (pass) |
| G6 | §11 Monte Carlo runs on the annual model (monthly is deterministic only), with the household's withdrawal timing | zero-volatility test uses an annual sample | no test with a monthly or start-of-year household | M15 |
| G7 | BRIEF §6 (b) external worked examples (Pub 590-A, 590-B, 915; SSA) | deferred in `testing-strategy.md` until rules are verified | none exist; every verified-path figure is validated against synthetic fixture values only | (out of scope while rules are unverified) |
| G8 | §10 preset F "rounded half to even" | `scenario.test.ts` has a tie case (12,345 → 11,110) | covered; noted only because `presets A–G` asserts `Math.round(x·0.9)` (half-up) for the default sample, which agrees only because that value is not a tie | 10f |

BRIEF §6 required cases, mapped to independent checks here: zero/negative/high inflation (1.6a, E1);
zero/negative returns (1.5d–f, E2, 4c, N4); contributions at/above/below limits (3.4a–h, M13, M14);
catch-up boundaries (3.4b, 3.4h); Roth phase-out start/mid/end for both statuses (3.7a, 3.7b); Roth IRA
capped at earned income (3.7c, M13); retiring at the current age (1.4d); already retired (1.1, 10i, 7.x);
depletion mid-retirement (4.1a, M10, 11l); zero balance (E9); bonus larger than salary and excluded from
match pay (3.1e); raise overrides, negative raise, raise below inflation (3.1a–c); tiered match below/at/
above tiers and above the compensation limit (3.5a–c, 3.4g, 12.3a); vesting (3.5d–f, M3, M12);
infeasible plan (1.7e, E10); spouses with different ages and retirement dates (E8); first-death
orderings (7.5i, 7.5j, 7.7a, E12); RMD age boundary (7.1a–c); claiming at 62/FRA/70 (7.5d, 7.5f, 7.5g);
spousal and survivor (7.5e, 7.5h–l, M8, M9); gross-up convergence (7.2a–e); monthly vs annual (1.6a–e,
E5, N3, M15); Monte Carlo seed determinism and quick-run equality (11a–c); null rule lookups (1.7a–f,
2d, 12.9d). Retiring exactly at the planning age is covered only by the repo's `project.test.ts`.

## 5. Documentation ambiguities and inconsistencies

Ranked by how much a reader could be misled. "Engine" states the observed API behavior.

| # | Severity | Where | Issue | Engine behavior (check) |
|---|---|---|---|---|
| A1 | medium | §7.1 step 5 vs §6 and §7.1 step 7 | "One-time outflows [in the accumulation phase] are withdrawn … before taxes (simplification)" does not say whether a withdrawal from a **traditional** account is ordinary income. §6 and §7.1 step 7 list traditional withdrawals as ordinary income without exception. | Not taxed: an 8,000 outflow drawn from a traditional IRA leaves ordinary income and AGI at 60,000 (wages only). This understates the year's tax; the doc should say so or the withdrawal should be taxed. Repro: fixture rules, single age 40, salary 60,000, traditional IRA 50,000 only, current spending 30,000, outflow 8,000 nominal in 2026. (Q2) |
| A2 | medium | §7.6 | A pension whose owner dies **before** its start age is not specified (does the spouse receive `survivorFraction`, and from when?). | The survivor receives `survivorFraction × amount` from the owner's start-age year (60% × 10,000 from 2030 for an owner born 1960, start age 70, dying in 2028). Repro: MFJ, p1 born 1960 planning 67, p2 born 1960 planning 85, pension owner p1, start 70, 10,000 nominal, survivorFraction 0.6. (M7) |
| A3 | low–medium | §7.5 survivor | "`PIA × max(1, f(death age))`" never defines *death age*. With death at the start of `D`, it could be the age in `D` or the last age lived. | Age in year `D` = `planningAge + 1` (24 delayed-credit months for planning age 68 with a claim at 70: 95% × 2,000 × 1.144). `retirement.test.ts` pins this ("Dies at 69"). (7.5k) |
| A4 | low | §7.1 step 5/6 | RMDs while someone works "count as income for net pay" and "RMD money is reinvested": unclear whether the whole RMD or the RMD net of its tax is reinvested. | Whole RMD reinvested (10,000); its tax is charged in the year's tax, so net pay and surplus fall (net pay 65,300 on 80,000 wages). (Q1) |
| A5 | low | §4.1 last paragraph (and the `YearRow.grossIncome` contract comment) vs §7.1 step 5 | §4.1 says accumulation-year `grossIncome` is "wages plus other income"; §7.1 says SS, pensions and RMDs received while working count as income. | Accumulation-year `grossIncome` includes SS (62,000 = 50,000 wages + 12,000 SS). (N2) |
| A6 | low | §7.5 claim factor vs API `monthsFromFra` | §7.5 defines `m = FRA_months − claim_months` (positive when early); the API field `monthsFromFra` (on `ssBenefitAtClaim` and the SS calculator) is negative when early (−42, −60) and is undocumented. | Sign opposite to `m`. (7.5x, 12.9c) |
| A7 | low | §7.4 | "Turns 59½ means `birthYear + 59` if `birthMonth ≤ 6`" hard-codes the real 59½ although the rule value is `qualifiedAgeMonths`; with the fixture's 712 months (59y4m) the engine uses months 1–8 (`rmd.test.ts`). | Rule-driven. State the rule in terms of `qualifiedAgeMonths`. |
| A8 | low | §2 | Signature written as `resolveRules(anchorYear, targetYear, indexRate)`; the API is `resolveRules(rules, { anchorYear, targetYear, indexRate })`. | — (2a–d) |
| A9 | low | §7.5 amount in year t | `12·monthly·Π(1 + cola)` for a set COLA does not give the product's start index. | `Π` over years 2…t (like `P_t`): 24,000; 24,720; … (7.5b) |
| A10 | low | §1.3/§4 | Whether `AccountYear.appliedReturn` is gross or net of fees and drag is not stated. | Gross `r` including offset and shock (1.3g, 4a, M4). |
| A11 | low | §10 preset F | "Rounded half to even" does not say whether the cut or the result is rounded (they differ on ties). | The result: 25 cents → 22.5 → 22 (rounding the cut would give 23). (10f) |
| A12 | low | `docs/testing-strategy.md` | Says "16 fixtures" and later "19 fixtures", and lists "the verified-rules path" as **not** covered by the reference; `reference/fixtures/` holds 43 fixtures, 16 of them `verified-*`, and `golden.test.ts` requires ≥ 30 with ≥ 12 verified. | Stale text. |
| A13 | low | `reference/ref.py` docstring | Says the senior deduction "is absent after its 2028 sunset"; the fixture and the reference code use 2029. | Engine: present in 2029, absent from 2030 (M11, 6f). |
| A14 | info | §1.7 | `excludedFeatures` lists `rmd` even when the horizon ends decades before any RMD age (a person dying at 41). Harmless over-reporting. | — |
| A15 | resolved during the pass | §13 SS-claiming insight | In the code at the start of the pass (before `fde1b53`), the insight moved an `atClaimAge` input's claiming age by a year while keeping the entered amount, so it could only report a lost year of benefits (what-if 552,000 vs 576,000 real). The §13 revision committed during the pass (`fde1b53`) ("an amount entered at the claiming age is not moved") removes that case; re-run checks 13h and 13i pass. | — |

## 6. Conclusion

Against the document alone, the engine's financial mechanics reproduce every hand-derived value tried,
across all sections, including the edge cases BRIEF §6 lists. The single contradiction (D1) is a
labeling completeness issue, not a wrong figure. The most valuable follow-ups are documentation: settle
A1 (tax on working-year traditional outflows, which currently understates tax), A2 (pension owner
dying before the start age) and A3 (the survivor's "death age"), then add tests for G1–G6 so the
behavior these checks observed is pinned.

## 7. Every check

Money is integer cents; rates are decimals. "Expected" is the value derived from the doc (the
arithmetic is in the claim text); "API result" is what the public API returned.

### §1.1–1.6 Conventions, rounding, time axis, timing, monthly mode

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| R1 | contributions are whole cents: 3% × 33,333.33 = 999.9999 → 1,000.00 employee + 1,000.00 match | `[100000, 100000, 200000]` | `[100000, 100000, 200000]` | PASS |
| N1 | accumulation: grossIncome = wages + other income; real.netIncome = round(netPay/P_t) | `[6100000, 4689320, 4830000]` | `[6100000, 4689320, 4830000]` | PASS |
| N3 | monthly cap = S(1+ρ)/(ρ/(12ρ_m)) = 11,071.10; end 0 (tolerance 1) | `1107106` | `1107106` | PASS |
| E1 | negative inflation −2%: need 10,000 / 9,800 / 9,604; high inflation 20%: 10,000 / 12,000 / 14,400 | `[[1000000, 980000, 960400], [1000000, 1200000, 1440000]]` | `[[1000000, 980000, 960400], [1000000, 1200000, 1440000]]` | PASS |
| E2 | negative return −20%, mid-year: 80,000 − 10,000·√0.8 = 71,055.73 | `7105573` | `7105573` | PASS |
| E3 | mid-year cap = S(1+ρ)/(1+ρ)^½ = 11,000: withdrawal 11,000, shortfall 9,000, end 0 | `[1100000, 900000, 0, true]` | `[1100000, 900000, 0, true]` | PASS |
| E4 | start-of-year cap = S: withdrawal 10,000, shortfall 10,000 | `[1000000, 1000000]` | `[1000000, 1000000]` | PASS |
| E5 | monthly contributions ($1,000/month ×12): E = 12,000·ρ/(12ρ_m) = 12,380.31 (FV of end-of-month annuity) (tolerance 1) | `1238030` | `1238030` | PASS |
| E7 | between stopAge (63) and retirementAge (65): accumulation, no salary, no withdrawals, current spending | `["accumulation", 0, 0, 3000000]` | `["accumulation", 0, 0, 3000000]` | PASS |
| E8 | couple: p1 retires 2027, p2 2030 → phase accumulation until 2029, retirement from 2030 | `[["accumulation", true, false], 2030]` | `[["accumulation", true, false], 2030]` | PASS |
| P6 | flows.withdrawals/feeDrag/growthNet/contributions = Σ per-account cents; spendingFunded within 1 cent of withdrawals | `[true, true, true, true, true]` | `[true, true, true, true, true]` | PASS |
| 1.1a | deflator P_t = (1+i)^(t-1) (row 3) (tolerance 1e-12) | `1.0609` | `1.0609` | PASS |
| 1.1b | real.portfolioEnd = round(end/P_t) (row 3) | `10911726` | `10911726` | PASS |
| 1.1c | deflator year 1 = 1 | `1` | `1` | PASS |
| 1.1d | savingsAtRetirement.real = portfolioStart / P_{t-1} | `10911726` | `10911726` | PASS |
| 1.1e | row t real start equals row t-1 real end (cards) | `10911726` | `10911726` | PASS |
| 1.3a | cents rounding half to even: 4.5 → 4 | `4` | `4` | PASS |
| 1.3b | cents rounding half to even: 1.5 → 2 | `2` | `2` | PASS |
| 1.3c | float balance carries forward unrounded (year 2: 6.75 → 7, not 6) | `7` | `7` | PASS |
| 1.3d | mid-year net: E = S(1+ρ) − W(1+ρ)^½ with ρ=(1+r)(1−f)−1 | `9563777` | `9563777` | PASS |
| 1.3e | feeDrag = round(gross − net) using the same factors with r (tolerance 1) | `101815` | `101815` | PASS |
| 1.3f | identity start + contributions + growthNet − withdrawals = end; growthGross = growthNet + feeDrag | `[true, true]` | `[true, true]` | PASS |
| 1.3g | appliedReturn reports gross r (or net?) (tolerance 1e-12) — *note: doc does not say whether appliedReturn is gross or net of fees* | `0.07` | `0.07` | PASS |
| 1.5a | start-of-year: E = (S−W)(1+ρ) = 90,000·1.05 = 94,500.00 | `9450000` | `9450000` | PASS |
| 1.5b | mid-year: E = 105,000 − 10,000·1.05^½ = 94,753.05 | `9475305` | `9475305` | PASS |
| 1.5c | E_conservative ≤ E_default when ρ ≥ 0 | `true` | `true` | PASS |
| 1.5d | ρ=−1%: start-of-year E = 90,000·0.99 = 89,100.00 | `8910000` | `8910000` | PASS |
| 1.5e | ρ=−1%: mid-year E = 99,000 − 10,000·0.99^½ = 89,050.13 | `8905013` | `8905013` | PASS |
| 1.5f | ordering reverses for ρ < 0 (conservative > default) | `true` | `true` | PASS |
| 1.5g | contributions get half-year growth: FV = c(1+r)^½((1+r)^n−1)/r (n=3) (tolerance 1) | `3277717` | `3277717` | PASS |
| 1.4a | retirement Jan 1 of birthYear+retirementAge: salary in R−1, none in R; phase flips in R | `[[2027, 63, 5000000, "accumulation"], [2028, 64, 0, "retirement"]]` | `[[2027, 63, 5000000, "accumulation"], [2028, 64, 0, "retirement"]]` | PASS |
| 1.4b | summary.retirementYear = first retirement-phase year; household runs through birthYear+planningAge | `[2028, 2026, 2034]` | `[2028, 2026, 2034]` | PASS |
| 1.4c | salary stop age 66 > retirement age 64: salary through 65, retirement phase from 2030 | `[5000000, "accumulation", 2030]` | `[5000000, "accumulation", 2030]` | PASS |
| 1.4d | retirementAge ≤ age(Y1) → retired from year 1 (no salary year 1) | `["retirement", 0, 2026]` | `["retirement", 0, 2026]` | PASS |
| 1.4e | first death year = 1956+72+1 = 2029; last year = 1966+75 = 2041; p1 alive 2028, dead 2029 | `[2029, 2041, true, false]` | `[2029, 2041, true, false]` | PASS |
| 1.4f | secondDeath marker never appears (horizon ends at the longer life) | `false` | `false` | PASS |
| 1.6a | no flows: monthly = annual within ≤ 1 cent per year (cumulative) | `true` | `true` | PASS |
| 1.6b | monthly end-of-month: E = S(1+ρ) − W·ρ/(12ρ_m) = 107,000 − 12,000·1.031692 = 94,619.69 (tolerance 1) | `9461970` | `9461970` | PASS |
| 1.6c | monthly start-of-month: g_W = ρ/(12ρ_m)·(1+ρ_m) → 94,549.69 (tolerance 1) | `9454970` | `9454970` | PASS |
| 1.6d | monthly vs mid-year annual difference = \|W\|·\|(1+ρ)^½ − ρ/(12ρ_m)\| (0.27% at 7%) (tolerance 0.02) | `32.599373834912626` | `32.6` | PASS |
| 1.6e | §1.6 table values reproduce from the formulas (vs mid-year and vs end-of-period) (tolerance 0.01 pt) | `{"docMid": [0.73, 0.46, 0.22, 0.12, 0.2, 0.27, 0.38, 0.54], "docEnd": [7.08, 4.67, 2.31, 1.37, 2.27, 3.17, 4.5, 6.7]}` | `{"calcMid": [0.73, 0.46, 0.22, 0.12, 0.2, 0.27, 0.38, 0.54], "calcEnd": [7.08, 4.67, 2.31, 1.37, 2.27, 3.17, 4.5, 6.7]}` | PASS |

### §1.7 Unverified rules in the forecast

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| 1.7f | payrollTax is listed in excludedFeatures whenever net pay is null for lack of payroll rules (with and without a workplace plan) — *note: with plan: ["workplaceLimits","federalIncomeTax","rmd"]; without: ["federalIncomeTax","payrollTax"]* | `[true, true]` | `[false, true]` | **FAIL** |
| 1.7a | workplace contributions as elected before limits: 90,000 + 12,000 match | `10200000` | `10200000` | PASS |
| 1.7b | maxAllowed IRA contributes nothing; a dollar IRA schedule contributes the requested amount | `[0, 300000]` | `[0, 300000]` | PASS |
| 1.7c | netPay, surplus, infeasible, netIncome are null; no surplus routed | `[null, null, null, null, 0]` | `[null, null, null, null, 0]` | PASS |
| 1.7d | excludedFeatures lists workplaceLimits, iraLimits, federalIncomeTax (payrollTax: see 1.7f) and unverified keys are listed | `[true, true, true, true]` | `[true, true, true, true]` | PASS |

### §2 Rules resolution

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| 2a | indexed with rounding metadata: 402(g) 21,000; 415(c) 63,000; no metadata: 60–63 catch-up 9,548.10 | `[2100000, 6300000, 954810]` | `[2100000, 6300000, 954810]` | PASS |
| 2b | bracket bounds indexed, rates never indexed | `[0.2, 1060900]` | `[0.2, 1060900]` | PASS |
| 2c | statutory-fixed values carry unchanged (HSA 55+ catch-up 1,200); projected flag and base year | `[120000, true, 2026]` | `[120000, true, 2026]` | PASS |
| 2d | no verified base at or before the target → null (never back-cast) | `["unverified-or-notPublished", null]` | `["unverified-or-notPublished", null]` | PASS |

### §3 Income, contributions, limits, match, vesting, accumulation cash flow

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| N8 | monthly 500 → 6,000/yr, grows with inflation (6,120 in year 2), stops after the last working year | `[600000, 612000, 0]` | `[600000, 612000, 0]` | PASS |
| E6 | auto-escalation p_t = min(cap, p_1 + step(t−1)): 3,4,5,6,6%; election 8% above cap stays 8% | `[[300000, 400000, 500000, 600000, 600000], [800000, 800000, 800000, 800000, 800000]]` | `[[300000, 400000, 500000, 600000, 600000], [800000, 800000, 800000, 800000, 800000]]` | PASS |
| E10 | verified: net pay 33,000 − spending 40,000 → surplus −7,000, infeasible; not withdrawn from savings | `[3300000, -700000, true, 0]` | `[3300000, -700000, true, 0]` | PASS |
| M1 | deferral % applied to pay up to L^comp, scaled pro rata: 20,000·300/350 = 17,142.86 | `1714286` | `1714286` | PASS |
| M2 | Roth catch-up: year 1 uses the entered prior wages (100,000 → traditional), year 2 uses projected 145,000 → 7,000 catch-up Roth | `[[2700000, 0], [2000000, 700000]]` | `[[2700000, 0], [2000000, 700000]]` | PASS |
| M12 | preview vested share at year end (cliff 3, 1 year at start): 0 then 1 | `[0, 1]` | `[0, 1]` | PASS |
| M13 | IRA limit shared; traditional IRAs filled before Roth IRAs; capped at earned income 5,000 → trad 5,000, Roth 0 | `[500000, 0]` | `[500000, 0]` | PASS |
| M14 | HSA limit 4,000 (first HSA self-only) shared in account order: 3,000 + 1,000, hsaCapped warning | `[300000, 100000, true]` | `[300000, 100000, true]` | PASS |
| 3.1a | raise overrides (promotion +10%, cut −5%), no raise in year 1 | `[10000000, 10300000, 11330000, 10763500, 11086405]` | `[10000000, 10300000, 11330000, 10763500, 11086405]` | PASS |
| 3.1b | inflationPlus: base_2 = 100,000·(1.02·1.01) = 103,020 | `10302000` | `10302000` | PASS |
| 3.1c | implied real raise stored: (1+g)/(1+i) − 1 (override year 10% at 2% → 7.8431%) (tolerance 1e-9) | `0.07843137254901977` | `0.07843137254901977` | PASS |
| 3.1d | fixed bonus at own rate 5%: 10,000, 10,500, 11,025 | `[1000000, 1050000, 1102500]` | `[1000000, 1050000, 1102500]` | PASS |
| 3.1e | bonus 150% of salary (> salary); bonus excluded from match comp, included in deferral comp | `[15450000, 10300000, 25750000]` | `[15450000, 10300000, 25750000]` | PASS |
| 3.1f | part-time pt_t = annualIncome·P_t for ages in [start, end); salary stops at retirement age — *note: year-4 value 21,648.6432 must round to 21,648.64* | `[0, 2080800, 2122416, 2164864, 0, 0]` | `[0, 2080800, 2122416, 2164864, 0, 0]` | PASS |
| 3.4a | aggregated plans: other deferrals 15,000, age 55 → allowed 12,000 (5,000 base + 7,000 catch-up), capped 3,000 + warning | `[1200000, 700000, 300000, true]` | `[1200000, 700000, 300000, true]` | PASS |
| 3.4b | Roth catch-up: age 61, prior wages 150,000 > 140,000 → 20,000 trad + 9,000 Roth catch-up | `[2000000, 900000, 900000, true]` | `[2000000, 900000, 900000, true]` | PASS |
| 3.4c | Roth catch-up required but plan has no Roth → catch-up disallowed (20,000) with a warning | `[2000000, 0, 0, true]` | `[2000000, 0, 0, true]` | PASS |
| 3.4d | year-1 prior wages unknown → catch-up stays as elected (traditional) with a warning | `[2900000, false, true]` | `[2900000, false, true]` | PASS |
| 3.4e | 415(c): employee alone (18,000) exceeds min(60,000, 100%·15,000) → deferral 15,000, employer 0 | `[1500000, 0, 0]` | `[1500000, 0, 0]` | PASS |
| 3.4f | 415(c): employer reduced, match before flat (match 0, flat 40,000) | `[2000000, 0, 4000000, true]` | `[2000000, 0, 4000000, true]` | PASS |
| 3.4g | 401(a)(17): match on min(400,000, 300,000) → 4% × 300,000 = 12,000 | `1200000` | `1200000` | PASS |
| 3.4h | catch-up boundaries: 50 → 27,000; 64 → 27,000 (not 29,000) | `[2700000, 2700000]` | `[2700000, 2700000]` | PASS |
| 3.5a | three tiers, δ=7% on 80,000: perTier [3,200, 800, 200], match 4,200, possible 4,800, δ*=10% ($8,000), unclaimed 600 | `[[320000, 80000, 20000], 420000, 480000, 0.1, 800000, 60000]` | `[[320000, 80000, 20000], 420000, 480000, 0.1, 800000, 60000]` | PASS |
| 3.5b | cap 4,500 binds inside tier 3: δ* = 8.5%, $6,800; possible 4,500; unclaimed 300 | `[420000, 450000, 0.085, 680000, 30000]` | `[420000, 450000, 0.085, 680000, 30000]` | PASS |
| 3.5c | zero-rate last tier: δ* = end of last positive tier (3%); flat 2% = 1,600 regardless of deferral | `[0.03, 160000, 160000]` | `[0.03, 160000, 160000]` | PASS |
| 3.5d | graded vesting: entered 6,000 unvested at v0=0.4 → ledger 10,000; F = (10,000+4,000)·(1−0.6) = 5,600 at start of 2027 | `[560000, 560000, true]` | `[560000, 560000, true]` | PASS |
| 3.5e | cliff 3 yrs, 1 at start + 1 worked = 2 → forfeit all: 5,000 + 4,000 = 9,000 | `900000` | `900000` | PASS |
| 3.5f | fully vested at start (v0=1): entered unvested amount never forfeited, with a warning | `[0, true]` | `[0, true]` | PASS |
| 3.7a | phase-out mid (single 103,333): 8,500·8,667/12,000 = 6,139.13 → round up to $10 = 6,140 | `614000` | `614000` | PASS |
| 3.7b | MFJ phase-out start 200,000 / mid 208,000 / end 216,000 / near end 215,950 → 8,500 / 4,250 / 0 / 200 (minimum) | `[850000, 425000, 0, 20000]` | `[850000, 425000, 0, 20000]` | PASS |
| 3.7c | capped at earned income then phased: base 6,000 → 3,000 at mid-range | `300000` | `300000` | PASS |
| 3.7d | worksheet order: min(phased 4,250, 8,500 − other IRA 5,000) = 3,500 | `350000` | `350000` | PASS |
| 3.7e | estimateMagi = 120,000 + 5,000 − 10,000 − 3,000 + 2,000 = 114,000 | `11400000` | `11400000` | PASS |
| 3.6a | HSA self-only 56 = 4,000 + 1,200 = 5,200; age 54 family = 8,000; no HDHP → 0 | `[520000, 800000, 0]` | `[520000, 800000, 0]` | PASS |
| 3.6b | order: HSA first reduces MAGI (110,000 − 4,000 = 106,000) → Roth IRA max allowed 4,250 | `[10600000, 425000, 425000]` | `[10600000, 425000, 425000]` | PASS |
| 3.8a | netPay = 60,000 − 8,000 − 4,500 = 47,500; surplus 7,500 routed mid-year to cash (end 7,500 at 0% return) | `[4750000, 750000, 750000, 750000, false]` | `[4750000, 750000, 750000, 750000, false]` | PASS |
| 3.8b | traditional deferral 6,000: netPay 48,700, contributions 6,000, surplus 2,700 | `[4870000, 600000, 270000]` | `[4870000, 600000, 270000]` | PASS |
| 3.8c | FICA on gross wages (60,000) not on wages net of deferrals | `[360000, 90000]` | `[360000, 90000]` | PASS |
| 1.7e | unverified taxes: gross pay 30,000 < spending 40,000 still flags the year infeasible | `[true, true]` | `[true, true]` | PASS |

### §4 Accounts, growth, fees, basis, depletion

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| E9 | zero balance retiree depletes in year 1 (shortfall = need) | `[2026, 100000]` | `[2026, 100000]` | PASS |
| M3 | ledger u' = u·g_S + employer·g_C at 10%: F = 0.4·(11,000 + 4,000·1.1^½) = 6,078.10 (tolerance 1) | `607809` | `607809` | PASS |
| M4 | market shock replaces every account’s r in its years; offset still applies (−30% + 2 = −28%; other years 8%) | `[0.08, -0.28, 0.08]` | `[0.08, -0.28, 0.08]` | PASS |
| 4a | return precedence (account, allocation Σw·g, phase) + offset −2 pts; floor −99% | `[0.06, 0.04, 0.02, -0.99]` | `[0.06, 0.04, 0.02, -0.99]` | PASS |
| 4b | taxable net rate ρ = (1+r)(1−f) − 1 − drag: 1,000·(1 + 1.04·0.995 − 1 − 0.01) = 1,024.80 | `102480` | `102480` | PASS |
| 4c | floored −99% return: 1,000 → 10.00 | `1000` | `1000` | PASS |
| 4d | taxable basis' = (basis + C)(1 − W/cap) = 54,000 | `5400000` | `5400000` | PASS |
| 4e | Roth basis' = max(0, 8,000 − 10,000) = 0 | `0` | `0` | PASS |
| 4f | allocation view (b): taxDeferred 1,000; taxFree (HSA + Roth) 5,000; taxable (other-taxable + cash) 9,000 | `[100000, 500000, 900000]` | `[100000, 500000, 900000]` | PASS |
| 4.1a | depletion: year 3 funds 5,000, shortfall 5,000, depletion year 2028 at age 72, success false, portfolioDepleted warning | `[500000, 500000, 2028, 72, false, true]` | `[500000, 500000, 2028, 72, false, true]` | PASS |
| 4.1b | success requires real end ≥ minimumEndingBalance (40,000 < 40,001 → false, no depletion) | `[false, null, 4000000]` | `[false, null, 4000000]` | PASS |
| 4.1c | retirement-phase contribution limited to income − need = 3,000 (requested 5,000) with a warning | `[300000, true]` | `[300000, true]` | PASS |

### §5 Spending

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| 5a | spend_t = S_step(age_1)·(1+glide)^(t−t_R)·P_t + healthcare·P_t (living retired under 65), ×(1−reduction) from D | `[7000000, 7078800, 6138880, 4657240]` | `[7000000, 7078800, 6138880, 4657240]` | PASS |
| 5b | healthcare stops at 65; steps keep using the first person’s calendar age after death (tolerance 1) | `3937387` | `3937387` | PASS |
| 5c | survivor reduction (20%) applies to working-years spending from D (2027: 40,000 → 32,000) | `[4000000, 3200000, "accumulation"]` | `[4000000, 3200000, "accumulation"]` | PASS |

### §6 Tax model

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| M11 | senior deduction in force through its sunset year 2029 (deduction 20,500) | `2050000` | `2050000` | PASS |
| 6a | LTCG stacked on ordinary; unused deduction offsets gains first: tax 500 | `[0, 50000, 50000]` | `[0, 50000, 50000]` | PASS |
| 6b | gains stacked above fifteenRateMax → high rate (25%): ordinary 144,000 + gains 2,500 | `[14400000, 250000]` | `[14400000, 250000]` | PASS |
| 6c | 65+ additional + senior deduction phase-out (single 70, AGI 100,000): deduction 20,500, tax 17,850 | `[2050000, 1785000]` | `[2050000, 1785000]` | PASS |
| 6d | MFJ both 65+: deduction 37,000 (married additional amount, per-filer senior phase-out), tax 36,900 | `[3700000, 3690000]` | `[3700000, 3690000]` | PASS |
| 6e | MFJ one filer 65+: 30,000 + 1,500 + 2,000 = 33,500 | `3350000` | `3350000` | PASS |
| 6f | senior deduction absent after its sunset year (2029) → 2030 deduction 17,000 | `1700000` | `1700000` | PASS |
| 6g | taxable SS (Pub 915 tiers): 9,600 / 2,800 / MFJ 5,600 / PI ≤ base → 0 | `[960000, 280000, 560000, 0]` | `[960000, 280000, 560000, 0]` | PASS |
| 6h | taxable SS enters ordinary income: taxable SS 9,600, tax 2,920 | `[960000, 292000]` | `[960000, 292000]` | PASS |
| 6i | FICA: OASDI per person up to the wage base (6%·(150,000 + 100,000) = 15,000); Medicare 1.5%·300,000 = 4,500 | `[1500000, 450000]` | `[1500000, 450000]` | PASS |
| 6j | state = flat rate × AGI (60,000 − 6,000 pre-tax = 54,000 → 2,700); FICA on gross | `[5400000, 270000, 360000]` | `[5400000, 270000, 360000]` | PASS |
| 6k | zero income → every component 0 (never negative); total = sum of components | `[0, true]` | `[0, true]` | PASS |

### §7 Retirement income (order of operations, solver, strategies, Roth/HSA, SS, pensions, survivor)

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| N2 | accumulation grossIncome = wages + other income (§4.1, M3 text) vs SS/pensions counted as income while working (§7.1 step 5) — *note: engine includes SS (62,000) in an accumulation-year grossIncome; §4.1 still says “wages plus other income”* | `{"docs41": 5000000, "withSs": 6200000}` | `6200000` | *AMBIGUOUS* |
| N4 | W capped at total cap 30,000; tax (30,000 − 22,000)·10% = 800; shortfall 40,000 − 29,200 = 10,800; depleted | `[3000000, 80000, 1080000, true]` | `[3000000, 80000, 1080000, true]` | PASS |
| N5 | RMD 50,000 > need: tax 4,600; excess 25,400 reinvested (first cash, no taxable) | `[5000000, 460000, 2540000, 2540000]` | `[5000000, 460000, 2540000, 2540000]` | PASS |
| N6 | taxable-brokerage gains W·(1 − basis/cap): W = 51,282.05, gains 25,641.03, federal 0 (deduction offsets gains, rest in 0% band), state 1,282.05; basis 100,000·(1 − W/200,000) | `[true, true, 0, true, true]` | `[true, true, 0, true, true]` | PASS |
| N7 | owned other income stops at the owner’s death (D = 2027); household-owned continues | `[800000, 300000]` | `[800000, 300000]` | PASS |
| 7.5a | atClaimAge: claim year prorated 12 − (birthMonth − 1 + months) = 6 months; then 12·monthly·P_t | `[0, 1224000, 2496960]` | `[0, 1224000, 2496960]` | PASS |
| 7.5b | set COLA 3%: 12·monthly·Π(1+cola) (Π from year 2, like P_t); benefitReduction 20% from 2028 — *note: doc does not state the start index of Π(1+cola); this expectation assumes the same convention as P_t* | `[2400000, 2472000, 2036928]` | `[2400000, 2472000, 2036928]` | PASS |
| 7.5c | statement PIA with bundled rules: excluded (socialSecurityClaiming), 0 paid | `[true, 0]` | `[true, 0]` | PASS |
| 7.5d | claim factor: 63y6m (m=42) 0.796 → 1,194; 68y3m (m=−15) 1.09 → 1,635; 70 → 1.216 → 1,824 | `[119400, 163500, 182400]` | `[119400, 163500, 182400]` | PASS |
| 7.5e | spousal: excess 900 reduced for claiming 24 months early (0.856) → 770.40 | `77040` | `77040` | PASS |
| 7.5f | projection, claim at 62: 12·2,000·0.724 = 17,376 | `1737600` | `1737600` | PASS |
| 7.5g | projection, claim at FRA (67, born 1959): 24,000 | `2400000` | `2400000` | PASS |
| 7.5h | spousal (none → PIA 0) at FRA: household 12·(2,000 + 900) = 34,800 | `3480000` | `3480000` | PASS |
| 7.5i | survivor (older dies first): 34,800 before D; 12·max(600, 95%·2,000, 80%·2,000) = 22,800 from D=2029 | `[3480000, 2280000]` | `[3480000, 2280000]` | PASS |
| 7.5j | survivor (younger dies first, D = 1959 + 69 + 1 = 2029): survivor keeps own 24,000 | `[2029, 2400000]` | `[2029, 2400000]` | PASS |
| 7.5k | unclaimed deceased: survivor gets 95%·PIA·max(1, f(death age)); doc does not define "death age" (age in D = 69, or last age alive = 68) — *note: engine uses death age 69; the doc should say which* | `{"ifAge69": 2608320, "ifAge68": 2444160}` | `2608320` | *AMBIGUOUS* |
| 7.5l | no spousal before both have claimed (p1 unclaimed until death) → p2 receives 0 in 2026–2028 | `0` | `0` | PASS |
| 7.7a | filing status MFJ through D (2029), single from D + 1 | `["marriedFilingJointly", "marriedFilingJointly", "single"]` | `["marriedFilingJointly", "marriedFilingJointly", "single"]` | PASS |
| 7.1a | RMD at start age 71: 295,000/29.5 = 10,000; excess 5,000 reinvested in the taxable account after tax 0 | `[1000000, 1000000, 500000, 500000, 0]` | `[1000000, 1000000, 500000, 500000, 0]` | PASS |
| 7.1b | RMD boundary: age 70 (born 1956) → no RMD; withdrawal = need 5,000 (tax 0) | `[0, 500000]` | `[0, 500000]` | PASS |
| 7.1c | born 1960 → start age 74: no RMD at 66 | `0` | `0` | PASS |
| 7.1d | HSA medical = min(medical·P_t, need) = 3,000 (part of need); cash 7,000; flows.withdrawals 10,000 | `[300000, 300000, 700000, 1000000]` | `[300000, 300000, 700000, 1000000]` | PASS |
| 7.2a | gross-up: W − tax(W) = need → W = 72,992.13 (senior phase-out + 30% bracket + 5% state) (tolerance 100) | `7299213` | `7299181` | PASS |
| 7.2b | net income = gross − total tax within the $1 tolerance of need 60,000 (tolerance 100) | `6000000` | `5999980` | PASS |
| 7.2c | solver converged; netIncome = grossIncome − totalTax | `[true, true]` | `[true, true]` | PASS |
| 7.2d | non-convergence (1 iteration): converged=false with grossUpNotConverged warning | `[false, true]` | `[false, true]` | PASS |
| 7.3a | taxableFirst: cash 10,000 → taxable 10,000 → traditional 5,000 | `[1000000, 1000000, 500000, 0, 0]` | `[1000000, 1000000, 500000, 0, 0]` | PASS |
| 7.3b | traditionalFirst: traditional 10,000 → cash 10,000 → taxable 5,000 | `[1000000, 500000, 1000000, 0, 0]` | `[1000000, 500000, 1000000, 0, 0]` | PASS |
| 7.3c | rothLast: cash/taxable/traditional pro rata 8,333.33 each (±1 cent) | `true` | `true` | PASS |
| 7.3d | rothLast, need 45,000: group 30,000, then HSA 10,000, then Roth 5,000 | `[1000000, 1000000, 1000000, 500000, 1000000]` | `[1000000, 1000000, 1000000, 500000, 1000000]` | PASS |
| 7.3e | proportional: 5,000 from each | `[500000, 500000, 500000, 500000, 500000]` | `[500000, 500000, 500000, 500000, 500000]` | PASS |
| 7.3f | bracketFill with unverified brackets → taxableFirst fallback with a warning | `[[1000000, 1000000, 500000, 0, 0], true]` | `[[1000000, 1000000, 500000, 0, 0], true]` | PASS |
| 7.3g | bracketFill (fixture): traditional up to T = top 10,000 + deductions 22,000 = 32,000; tax 1,000; cash 9,000 | `[3200000, 900000, 100000]` | `[3200000, 900000, 100000]` | PASS |
| 7.3h | bracketFill never withdraws more than the need: need 30,000 → traditional 30,888.89, cash 0 (tolerance 100) | `3088889` | `3088880` | PASS |
| 7.4a | Roth earnings before qualification → rothEarningsWithdrawnEarly; HSA non-medical before 65 → hsaNonMedicalPre65 | `[true, true]` | `[true, true]` | PASS |
| 7.4b | bundled rules: Roth qualification excluded and no flag shown | `[true, false]` | `[true, false]` | PASS |
| 7.6a | annuity today’s $ × P_t at start (21,854.54), flat thereafter, survivorFraction 50% after owner’s death (2032) | `[0, 2185454, 2185454, 2185454, 1092727]` | `[0, 2185454, 2185454, 2185454, 1092727]` | PASS |
| 7.6b | lump sum nominal 50,000 deposited to destination in start year; counted in oneTimeInflows, not pensions | `[5000000, 5000000, 0]` | `[5000000, 5000000, 0]` | PASS |
| 7.6c | one-time outflow today’s $ × P_t (10,609) added to spending need (31,827 + 10,609) | `[1060900, 4243600]` | `[1060900, 4243600]` | PASS |
| 7.6d | pension already in payment: entered amount in year 1, COLA from year 1 (12,000; 12,360) | `[1200000, 1236000]` | `[1200000, 1236000]` | PASS |
| 7.6e | capital-gain inflow: gains = 40% × 100,000 = 40,000 in tax detail; basis rises by the whole deposit (110,000) | `[4000000, 11000000]` | `[4000000, 11000000]` | PASS |
| E11 | workplace Roth: no RMD when roth401kLifetimeRmdRequired is false (fixture) | `0` | `0` | PASS |
| E12 | RMD while owner alive (76: 240,000/27 = 8,888.89); after death the survivor’s age (67 < 74) → none | `[888889, 0]` | `[888889, 0]` | PASS |
| E13 | excess income with no taxable/cash account is spent (excessIncomeSpent warning), nothing reinvested | `[0, true]` | `[0, true]` | PASS |
| E14 | inflow without destination → first taxable brokerage (5,000), not the cash account | `[500000, 0]` | `[500000, 0]` | PASS |
| E15 | working-year one-time outflow 8,000 withdrawn from the portfolio | `800000` | `800000` | PASS |
| E16 | claiming at 62 while drawing salary (FRA unverified) → ssClaimBeforeFraWhileWorking warning | `true` | `true` | PASS |
| M6 | survivor continuation (60%) from D = 2028 is reported on the survivor’s row | `[1000000, 0, 600000, 600000]` | `[1000000, 0, 600000, 600000]` | PASS |
| M7 | pension whose owner dies before its start age (doc silent): does the survivor fraction start at the owner’s start-age year? — *note: The Python reference raises Unsupported for this path; the doc should state the rule.* | `"not specified by §7.6"` | `[0, 0, 0, 0, 600000, 600000, 600000]` | *AMBIGUOUS* |
| M8 | spousal months in the claim year = the fewer of the two (6): 12,000 + 5,400 = 17,400; then 34,800 | `[1740000, 3480000]` | `[1740000, 3480000]` | PASS |
| M9 | survivor benefit starts at max(D = 2027, survivor claim year 2029): 0, 0, 22,800 | `[0, 0, 2280000]` | `[0, 0, 2280000]` | PASS |
| 7.2e | gross-up iteration W_{k+1} = need + tax(W_k) from W_0 = need + tax(0): sequence 60,000 → 69,600 → 72,000 → 72,630 — *note: with maxIterations = n the engine returns W_1+n−1 (= the iterate after n passes counting W_0 as pass 0); doc: “returns the last iterate”* | `[6000000, 6960000, 7200000, 7263000]` | `[[6960000, 1, false], [7200000, 2, false], [7263000, 3, false]]` | PASS |
| 7.3i | bracket fill with SS: room T = 32,000 using taxable SS estimated at the fixed income (0), not at the final income | `3200000` | `3200000` | PASS |
| Q1 | RMD while a spouse works: RMD 10,000 taken, taxed in the year’s tax, reinvested (step 6) — *note: doc does not say whether the reinvested RMD is the whole RMD or net of the tax it adds; reported for the record* | `{"rmd": 1000000, "reinvested": "RMD (whole, or after its tax? doc: “RMD money is reinvested (step 6)”)", "taxOrdinaryIncludesRmd": true}` | `{"phase": "accumulation", "rmd": 1000000, "reinvested": 1000000, "txContrib": 1000000, "ordinary": 9000000, "netPay": 6530000, "surplus": 2530000}` | *AMBIGUOUS* |
| Q2 | working-year one-time outflow from a traditional IRA “before taxes”: is the withdrawal counted as ordinary income in the year’s tax? — *note: “before taxes (simplification)” can mean no gross-up or no tax at all; the Python reference raises Unsupported here* | `{"withdrawal": 800000, "ordinaryIfTaxed": 6800000, "ordinaryIfNot": 6000000}` | `{"withdrawal": 800000, "ordinary": 6000000, "agi": 6000000, "warnings": ["excessIncomeSpent"]}` | *AMBIGUOUS* |
| Q3 | accumulation year: medical expenses paid from pay, no HSA medical withdrawal | `[0, 0]` | `[0, 0]` | PASS |
| Q4 | bracket fill with only a traditional account: beyond T falls through to traditional → gross-up W = 55,750 and tax 5,750 within the $1 tolerance, no shortfall | `[true, true, 0]` | `[true, true, 0]` | PASS |

### §8 Dashboard cards

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| 8a | people card (age 60, years to retirement 3), current savings 100,000, first retirement year 2029 | `[60, 3, 10000000, 2029]` | `[60, 3, 10000000, 2029]` | PASS |
| 8b | savings at retirement: portfolioStart 115,762.50 nominal; real = /P_{t−1} = 109,117.73 | `[11576250, 10911726]` | `[11576250, 10911726]` | PASS |
| 8c | monthly spending = spendingNeed/12 (nominal 2,731.82; real /P_t), income = grossIncome/12 labeled beforeTaxes; surplus = income − spending | `[273182, 250000, 273182, "beforeTaxes", 0]` | `[273182, 250000, 273182, "beforeTaxes", 0]` | PASS |
| 8d | hand: 2029 need 30,000·1.03^3 = 32,781.81 → monthly 2,731.82 (273,181.75 → 273,182 cents) | `273182` | `273182` | PASS |
| 8e | longevity: depletion year and age of first listed person (from summary); readiness atRisk when baseline fails | `[2032, 66, "atRisk"]` | `[2032, 66, "atRisk"]` | PASS |
| 8f | readiness: baseline succeeds & pessimistic fails → borderline; both succeed → onTrack | `["borderline", "onTrack"]` | `["borderline", "onTrack"]` | PASS |
| M10 | longevity: depletion 2031 reported at age of p2 (65), p1 dead | `["depletes", 2031, 65, "p2"]` | `["depletes", 2031, 65, "p2"]` | PASS |

### §9 Optimistic / pessimistic offsets

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| 8g | pessimistic run (−2 pts): 2% → 0%: 100,000 − 5·4,000 = 80,000 exactly | `8000000` | `8000000` | PASS |
| 8h | custom offsets +3 / −1 pts added to every account’s return | `[0.08, 0.05, 0.04]` | `[0.08, 0.05, 0.04]` | PASS |

### §10 Scenarios, presets, optimizer, comparison

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| 10a | diff ops: set applied; misspelled path → invalidPath; missing id → missingEntity; unset household → invalidPath; plan add without parent → missingParent | `[67, ["invalidPath", "missingEntity", "invalidPath", "missingParent"]]` | `[67, ["invalidPath", "missingEntity", "invalidPath", "missingParent"]]` | PASS |
| 10b | unset with a path restores the schema default (survivorSpendingReduction → 0.2) | `0.2` | `0.2` | PASS |
| 10c | B: retirement age −5 not below today’s age (65 → max(62, 60) = 62), stop age cleared | `[62, null]` | `[62, null]` | PASS |
| 10d | E: years clamped to 3–5 and capped at planning age (65 + 5 = 70) | `70` | `70` | PASS |
| 10e | D: −30% over 2 years → each (0.7)^½ − 1 = −16.334%; starts at first all-retired year (2029); marketShockTotal = −30% | `[2029, [-0.1633399735, -0.1633399735], -0.3]` | `[2029, [-0.1633399735, -0.1633399735], -0.3]` | PASS |
| 10f | F: −10% rounded half to even (1,000,005 → 900,004; 25 → 22 cents) | `[900004, 22]` | `[900004, 22]` | PASS |
| 10g | F leaves current (working-years) spending unchanged; drift false on the same base, true after a base edit | `[4000000, false, true]` | `[4000000, false, true]` | PASS |
| 10h | optimizer earliest age equals an independent brute-force scan of 56–75 | `66` | `66` | PASS |
| 10i | optimizer is invalid when the first person is already retired | `"invalid"` | `"invalid"` | PASS |
| 10j | after-tax ending balance = real.portfolioEnd − (taxDeferred_end/P_T)·marginalRate_T (tolerance 1) | `55090752` | `55090752` | PASS |
| 10k | after-tax figure null while taxes are unverified | `null` | `null` | PASS |
| R3 | optimizer (Monte Carlo criterion): each age’s success rate over paths 0–99 equals my direct run of that candidate; earliest = first ≥ 70% | `[[0.47, 0.63, 0.75, 0.84, 0.89], 60, 100]` | `[[0.47, 0.63, 0.75, 0.84, 0.89], 60, 100]` | PASS |
| M5 | D: entered start year 2020 moves up to the current year 2026 (retired household: year 1) | `2026` | `2026` | PASS |
| 10l | optimizer: range starting below current age → invalid; ages past the planning age (71, 72) skipped | `["invalid", [68, 69, 70]]` | `["invalid", [68, 69, 70]]` | PASS |
| M17 | C: +5 pts capped at 100% (97% → 100%); G: salary and bonus deferrals moved to Roth (0/0 → 97%/10%) | `[1, [0, 0, 0.97, 0.1]]` | `[1, [0, 0, 0.97, 0.1]]` | PASS |

### §11 Monte Carlo, sequence and allocation views

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| 11a | seed determinism and chunk independence: paths 0–30 in one chunk = 0–7 + 7–30 | `true` | `true` | PASS |
| 11b | quick run is a prefix of the full run (paths=1000 vs 2000, paths 0–20 equal) | `true` | `true` | PASS |
| 11c | another seed gives different numbers | `false` | `false` | PASS |
| 11d | ln(1+R) ~ N(ln(1+g), σ²): 100% stocks, 2,000 paths → mean ln(1.07) = 0.06766 ± 3 SE, sd 0.16 ± 5% (tolerance mean ±0.0107, sd ±5%) | `{"mean": 0.06765864847381486, "sd": 0.16}` | `{"m": 0.06886954183671806, "sd": 0.1582621198926158}` | PASS |
| 11e | σ_a² = wᵀΣw (60/40 → σ = 0.10126), median 1+g = 1.06 (tolerance mean ±3 SE, sd ±5%) | `{"mean": 0.058268908123975824, "sd": 0.10125611092669914}` | `{"m": 0.05923119574233974, "sd": 0.10039220692079083}` | PASS |
| 11f | zero volatility: every path equals the deterministic baseline (within 1 cent), with taxes and withdrawals (tolerance 0.01) | `0` | `0` | PASS |
| 11g | zero volatility: success rate = deterministic success; p50 ending = baseline ending (±1 cent) | `[1, true]` | `[1, true]` | PASS |
| 11h | implied arithmetic mean (1+g)e^{σ²/2} − 1: stocks 1.07·e^{0.0128} − 1 = 8.3784% (tolerance 1e-12) | `0.08378402959195164` | `0.08378402959195164` | PASS |
| 11i | readiness bands ≥85% / 70–85% / <70% | `["onTrack", "borderline", "borderline", "atRisk"]` | `["onTrack", "borderline", "borderline", "atRisk"]` | PASS |
| 11j | stochastic inflation: per-path deflator; P_1 = 1 (year-1 real = nominal); ln(1+i_2) ~ N(ln 1.025, 0.015²) (tolerance mean ±3 SE, sd ±5%) | `{"nominalIdentical": true, "year1RealEqualsNominal": true, "mean": 0.024692612590371414, "sd": 0.015}` | `{"nominalIdentical": true, "year1RealEqualsNominal": true, "m": 0.02420950182163162, "sd": 0.015381521197979277}` | PASS |
| 11k | isPositiveSemiDefinite: valid CMA matrix true; indefinite matrix false | `[true, false]` | `[true, false]` | PASS |
| N9 | no-allocation account shock = (σ_blended/σ_stocks)·stock shock: log-return deviation ratio 0.12/0.16 = 0.75 (same seed, same path) (tolerance 0.001) — *note: compares path-by-path log-return deviations of a 100%-stock account and a no-allocation account in two runs with the same seed* | `0.75` | `0.7500000082782277` | PASS |
| E17 | sequence illustration: deviations −20,−12,−6,+2,+8,+12,+16% (sum 0) in order and reversed | `[[-0.2, -0.12, -0.06, 0.02, 0.08, 0.12, 0.16], [0.16, 0.12, 0.08, 0.02, -0.06, -0.12, -0.2], 0]` | `[[-0.2, -0.12, -0.06, 0.02, 0.08, 0.12, 0.16], [0.16, 0.12, 0.08, 0.02, -0.06, -0.12, -0.2], 0]` | PASS |
| E18 | allocation view (c): year-end 1,058.50 (5.85% allocation-implied) split 635.10/317.55/105.85; unallocated 500 apart | `[63510, 31755, 10585, 50000]` | `[63510, 31755, 10585, 50000]` | PASS |
| M15 | MC uses the annual model for a monthly household, with conservative timing applied (zero vol path = annual start-of-year baseline) — *note: max \|path − annual\| = 0.0000; max \|path − monthly\| = 12773.43* | `[true, true]` | `[true, true]` | PASS |
| M16 | success requires ending real ≥ minimumEndingBalance (minimum $1 above baseline → every zero-vol path fails) | `[0, false]` | `[0, false]` | PASS |
| 11l | zero-vol depleting retiree: depletion age 74 for all 50 paths; success 0 | `[[{"age": 74, "count": 50}], 0]` | `[[{"age": 74, "count": 50}], 0]` | PASS |

### §12 Calculators

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| 12.1a | compound interest FV with fee (ρ = 4.475%, n = 15) = 111821.72 (tolerance 1) | `11182172` | `11182172` | PASS |
| 12.1b | principal + totalContributions + totalGrowth = endingBalance exactly | `11182172` | `11182172` | PASS |
| 12.1c | growing contributions: 33577.37 (tolerance 1) | `3357737` | `3357738` | PASS |
| 12.7a | inflation purchasing power: 1,000·1.03^10 = 1,343.92; 1,000/1.03^10 = 744.09; no rule labels | `[134392, 74409, []]` | `[134392, 74409, []]` | PASS |
| R2 | lump sum vs recurring: payment 33,333.33 (whole cents), totalContributions 99,999.99 (differs from total by the rounding) | `[3333333, 9999999]` | `[3333333, 9999999]` | PASS |
| 12.8a | sustainable rate, start-of-year: annuity due 7.64215% (tolerance 1e-5) (tolerance 0.00001) | `0.07642151161018218` | `0.07642078399658203` | PASS |
| 12.8b | sustainable rate, inflation-indexed mid-year: S(1+r)^½(1 − q)/(1 − q^n) = 6.28928% (tolerance 0.00001) | `0.06289275172570558` | `0.06289196014404297` | PASS |
| 12.11a | lump sum vs recurring closed forms (±1 cent) | `[true, true]` | `[true, true]` | PASS |
| 12.10a | fee impact lifetimeCost = 50,000(1.06^20 − 1.0494^20) = 29199.86 (tolerance 2) | `2919986` | `2919985` | PASS |
| 12.10b | feesCharged = Σ yearly fee drag; lifetimeCost > feesCharged (lost growth on fees) | `[true, true]` | `[true, true]` | PASS |
| 12.15a | FI number (sustainable) = growing-annuity PV 793649.26 (search returns the passing end, ≤ $1 above) | `true` | `true` | PASS |
| 12.15b | FI rule of thumb 40,000/0.04 = 1,000,000 (found through the engine, ±$1) (tolerance 100) | `100000000` | `100000052` | PASS |
| 12.13a | coast number = PV closed form 386816.30 (within $1 above); gap = coast − 100,000 | `[true, true]` | `[true, true]` | PASS |
| 12.3a | match optimizer: unclaimed 2,000, additional deferral 3,000, lowest scanned full-capture rate 5%, basis before limits | `[200000, 300000, 0.05, "beforeLimits"]` | `[200000, 300000, 0.05, "beforeLimits"]` | PASS |
| 12.9a | SS comparison totals 487,200 / 576,000 / 624,960; break-even ages vs 62: — / 78 / 80 | `[[48720000, 57600000, 62496000], [78, 80]]` | `[[48720000, 57600000, 62496000], [78, 80]]` | PASS |
| 12.6a | savings gap (0% return): extra = 10,000/yr (passing end, ≤ $1 above) | `true` | `true` | PASS |
| 12.14a | barista FIRE (0% return, no balance): minimum part-time income = 20,000 (≤ $1 above) | `true` | `true` | PASS |
| 12.4a | Roth vs traditional with unverified taxes: after-tax figures null, basis beforeTaxes, before-tax endings identical | `[null, null, "beforeTaxes", true]` | `[null, null, "beforeTaxes", true]` | PASS |
| 12.2a | 401(k) calculator: unverified → capped null & beforeLimits; fixture → 20,000 trad + 9,000 Roth catch-up, match 6,000, afterLimits | `[null, "beforeLimits", 2000000, 900000, 600000, "afterLimits"]` | `[null, "beforeLimits", 2000000, 900000, 600000, "afterLimits"]` | PASS |
| 12.5a | retirement-age calculator: evaluates every age 55–70; earliestAge = first successful one | `[16, 63]` | `[16, 63]` | PASS |
| 12.8c | sustainable-rate search: maxRate 10% still lasts → atBound; minimum ending above reach → notWithinBound | `["atBound", "notWithinBound"]` | `["atBound", "notWithinBound"]` | PASS |
| 12.0a | plan calculator (verified rules): savingsPlanInfeasible warning dropped; tax basis afterTaxes | `[false, "afterTaxes"]` | `[false, "afterTaxes"]` | PASS |
| 12.12a | spending planner: first death year 2029; need 50,000 ×3 then 35,000 (30% survivor reduction) | `[2029, [5000000, 5000000, 5000000, 3500000]]` | `[2029, [5000000, 5000000, 5000000, 3500000]]` | PASS |
| 12.9b | SS comparison, PIA mode (fixture): claim 62 → factor 0.724, monthly 1,448, 60 months before FRA | `[0.724, 144800, 60]` | `[0.724, 144800, 60]` | PASS |
| 12.9c | sign of monthsFromFra vs the doc’s m = FRA_months − claim_months — *note: API reports −60 for a claim 60 months before FRA (sign opposite to §7.5’s m); the field is not documented* | `"doc §7.5: m > 0 means claiming before FRA"` | `-60` | *AMBIGUOUS* |
| 12.9d | PIA mode with bundled rules → unverified with missing keys (never a substituted value) | `["unverified", true]` | `["unverified", true]` | PASS |

### §13 Insights

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| 13a | inflation +1 pt insight: what-if = my own re-run with inflation 3.5% (real ending balance) | `55827795` | `55827795` | PASS |
| 13b | insight baseline = baseline real ending balance | `117422118` | `117422118` | PASS |
| 13c | fees insight: what-if = my re-run with every expense ratio 0 | `192085799` | `192085799` | PASS |
| 13d | retire two years later: what-if = my re-run with retirementAge 64 | `146906243` | `146906243` | PASS |
| 13e | spending 10% lower: what-if = my re-run with retirement spending 63,000 | `143601272` | `143601272` | PASS |
| 13f | returns one point lower: what-if = my re-run with every return source − 0.01 | `55482205` | `55482205` | PASS |
| 13g | full-match insight: what-if = real end of the year before retirement with 5% deferral | `197131649` | `197131649` | PASS |
| 13h | SS claiming insight: left out when the only benefit is an amount entered at the claiming age (atClaimAge is not moved) | `"absent"` | `"absent"` | PASS |
| 13i | SS claiming insight (statement PIA, fixture rules): baseline Σ SS/P_t at 67 and what-if at 68y0m equal my own re-runs (±1 cent) — *note: baseline 57599999, what-if 59174398* | `[true, true]` | `[true, true]` | PASS |
| 13k | returns one point lower also lowers market-shock returns by 0.01 (−20%/−10% → −21%/−11%): what-if = my re-run | `0` | `0` | PASS |
| 13j | savings needed for the goal: X passes, X − $100 fails (nearest $100); X is a multiple of $100 | `[true, false, 0]` | `[true, false, 0]` | PASS |

### I/O (export)

| ID | Claim and hand-derived expectation (from the doc) | Expected | API result | Verdict |
|---|---|---|---|---|
| E19 | csvCell escapes =,+,-,@ text but not plain numbers | `[true, "-12.5"]` | `[true, "-12.5"]` | PASS |
