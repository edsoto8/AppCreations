# Financial Model (Phase 0 draft)

> **Status: DRAFT (Phase 0).** Each section is completed and marked *final* in the milestone that
> implements it (milestone in brackets). Formulas here are the specification the engine and the tests
> are written against. The M8 validation agent reads this document and the tests, not the engine.

Results are model-dependent educational estimates, not guarantees, tax advice, or investment
recommendations. Taxes are simplified estimates.

Notation: year index `t = 1..T`, calendar year `Y_t = Y_1 + t − 1`, where `Y_1` is the injected
current calendar year. `i_t` = inflation in year t, `r` = nominal annual return (decimal).

---

## 1. Conventions [M1]

### 1.1 Units
- Money at every public engine boundary, in storage and in exports: **integer cents** (`Cents`).
- Internal projection math: float64 dollars. Monte Carlo: float64 throughout.
- Rates: decimals. Nominal and real rates are separate branded types.
- The engine runs in **nominal** dollars. **Today's dollars are year-1 dollars.** The price index of
  year t is `P_t = Π_{k=2..t} (1 + i_k)`, with `P_1 = 1`; under constant inflation, `P_t = (1+i)^{t−1}`.
  Every year-t figure, flows and year-end balances alike, converts as `real = nominal / P_t`. This
  simple convention is the one most planners use. The per-row `deflator` field in the projection
  result is `P_t`.
- **Start-of-year balances** (`portfolioStart`, an account's `start`) are the prior year-end money,
  so in today's dollars they divide by `P_{t−1}` (1 in year 1). Row t's real start then equals row
  t−1's real end, both on the cards (savings at retirement) and in the tables.
- Under stochastic inflation (Monte Carlo) each path carries its own price index series, and real
  bands come from those per-path series. They are never deflated with a fixed assumption.

### 1.2 Inputs in today's dollars
Recurring inputs entered "per year" (spending, part-time income, statement PIA, other income with
inflation growth) are year-1 amounts, so their nominal value in year t is `x_t = x · P_t`. Balances and
the current salary are year-1 nominal, which is the same as today's dollars.

### 1.3 Rounding policy
- Each row is computed in float64 and converted to cents **once**, on output, rounding half to even.
- **Reconciliation (exact):** for each account and row, `start`, `contributions`, `withdrawals` and
  `end` are each rounded to cents independently. `growthNet` is then the reconciling item:
  `growthNet = end − start − contributions + withdrawals`, so
  `start + contributions + growthNet − withdrawals = end` holds exactly (0 cents), which is within
  the ±1 cent the brief requires. Because that identity holds by construction, the 10,000-run
  property test also **recomputes every account's year-end balance and fee drag independently**
  from the applied return with the §1.5 factors written out in the test, and checks them within
  3 cents. A 0.01% change to one growth factor makes it fail. `feeDrag = round(fee_float)` and
  `growthGross = growthNet + feeDrag`.
- Year t+1 `start` equals year t `end` in cents (the float64 balance carries forward unrounded).
- **Contribution amounts are whole cents.** They are payment amounts, and the limit functions work
  in cents. This covers each plan's traditional and Roth deferrals, the match (computed on eligible
  pay and total deferral in cents), the flat employer contribution, each scheduled amount (including
  the retirement-phase scale-down), and a routed surplus. They are rounded once, when determined.
  Balances, growth and withdrawals stay float64.
- The tax step works in cents: `TaxInput` and `TaxBreakdown` are cents at the API, so tax inputs
  and each tax component are rounded to cents, the total is their sum, and net = gross − total.
- Real values divide the **unrounded** float by the deflator, then round once (for example
  `real.portfolioEnd = round(Σ float balances / P_t)`). Accumulation-year `real.netIncome` divides
  the net pay cents, because net pay is itself a cents output of the tax step.
- Household flow totals (`flows.contributions`, `employerContributions`, `feeDrag`, `growthNet`,
  `withdrawals`, `forfeited`) are sums of the per-account cents, so they reconcile with the account
  rows. `spendingNeed`, `spendingFunded` and `shortfall` round the float figures once, so in a fully
  funded year `flows.withdrawals` and `spendingFunded` can differ by a cent.
- `toFixed` is never used for logic.

### 1.4 Time axis and ages
- **Age rule:** a person's age in calendar year Y is `age(Y) = Y − birthYear` (no months), with no
  proration of year 1.
- **Retirement** takes effect January 1 of year `R = birthYear + retirementAge`. There is no salary in
  year R. The last working year is `R − 1` (or `birthYear + stopAge − 1` if a stop age is set).
- Catch-up eligibility, RMD start and SS claiming all use the same age rule. Regulatory limits are
  calendar-year values for `Y_t`.
- **Longevity:** person p lives through the year they reach `planningAge` and is modeled as dying at
  the start of year `Dp = birthYear + planningAge + 1`. From `Dp`, the person's part-time pay and
  any other income they own (`otherIncome.ownerId`) stop. Household-owned income continues. The household runs through
  `max_p(birthYear_p + planningAge_p)`. "First death year" = `min_p Dp` when that falls within the
  horizon.
- Already-retired user: if `retirementAge ≤ age(Y_1)`, the person is retired from year 1.
- A person is **retired** in year t when they are at or past their retirement age **and draw no
  salary**. A salary stop age later than the retirement age keeps them working.
- Household **phase** for year t is `retirement` once every living person is retired; otherwise it
  is `accumulation`. `summary.retirementYear` is the first retirement-phase year (year 1 for an
  already-retired household).
- Years after a person's `stopAge` but before their retirement age are accumulation years with no
  salary and no withdrawals. Spending is current spending, assumed funded from pay, with any gap
  shown by the infeasible flag when taxes are verified.
- The horizon ends at the longer life, so the `secondDeath` marker never appears (it is reserved
  in the contract).

### 1.5 Timing within a year
- Contributions are made evenly through the year: the year's contributions earn a half-year of
  growth, `c·((1+r)^½ − 1)`.
- Withdrawals are mid-year by default; the *conservative* setting takes them at the start of the
  year. The setting applies to the forecast, scenarios and Monte Carlo.
- Annual account update for net rate `ρ` (see §4):
  - mid-year withdrawals: `E = S(1+ρ) + (C − W)(1+ρ)^½`
  - start-of-year withdrawals: `E = (S − W)(1+ρ) + C(1+ρ)^½`
- Every timing mode is linear in the flows, `E = g_S·S + g_C·C − g_W·W` (`projection/accounts.ts`):

  | Mode | g_S | g_C | g_W | Withdrawal cap |
  |---|---|---|---|---|
  | annual, mid-year | 1+ρ | (1+ρ)^½ | (1+ρ)^½ | `(g_S·S + g_C·C)/g_W` (E ≥ 0) |
  | annual, start of year | 1+ρ | (1+ρ)^½ | 1+ρ | `S` (cannot exceed the start balance) |
  | monthly, end of month | 1+ρ | ρ/(12ρ_m) | ρ/(12ρ_m) | `(g_S·S + g_C·C)/g_W` |
  | monthly, start of month | 1+ρ | ρ/(12ρ_m) | ρ/(12ρ_m)·(1+ρ_m) | `(g_S·S + g_C·C)/g_W` |

  `ρ/(12ρ_m)` is 1 when ρ = 0. For monthly modes a non-negative year-end balance implies every
  month-end balance is non-negative (a negative balance stays negative under a net outflow), so the
  year-end condition is the cap. Gross growth uses the same factors with the gross rate r.
- If every annual **net** rate ρ (after fees and drag) is ≥ 0 **and the run does not deplete**,
  then `E_conservative ≤ E_default`. (With M4 mid-year deposits, a depleting start-of-year run cannot
  reach money deposited later in the year, so it can end higher.)
- Same condition as a formula: `E_conservative ≤ E_default`
  (because `(1+ρ) ≥ (1+ρ)^½`). A 0% gross return with an expense ratio has ρ < 0, which reverses the
  ordering. In years with a negative net rate the ordering is not guaranteed, and the tests do not
  assert it.

### 1.6 Monthly mode [M3]
Deterministic forecast only. `ρ_m = (1+ρ)^{1/12} − 1`. Each month, the balance grows by `ρ_m`, then
`C/12` is added and `W/12` removed (end of period).
- With no flows, the monthly and annual end balances are mathematically identical: `(1+ρ_m)^12 = 1+ρ`.
  The test tolerance is ≤ 1 cent of float error per year.
- With end-of-period flows, the annual equivalent is `E = S(1+ρ) + C − W`, and monthly gives
  `E_m = S(1+ρ) + (C − W)·((1+ρ) − 1)/(12ρ_m)`. The documented difference per year is
  `|(C − W)|·|ρ/(12ρ_m) − 1|`, which is about 3.2% of the annual net flow at ρ = 7%.
- Compared with the default mid-year annual timing, the difference per year is
  `|(C − W)|·|(1+ρ)^½ − ρ/(12ρ_m)|`, as a share of the year's net flow (tested):

  | ρ | −15% | −10% | −5% | 3% | 5% | 7% | 10% | 15% |
  |---|---|---|---|---|---|---|---|---|
  | vs mid-year annual | 0.73% | 0.46% | 0.22% | 0.12% | 0.20% | 0.27% | 0.38% | 0.54% |
  | vs end-of-period annual | 7.08% | 4.67% | 2.31% | 1.37% | 2.27% | 3.17% | 4.50% | 6.70% |

  So for |ρ| ≤ 15% monthly and default annual results differ by less than 0.75% of each year's net
  flow; balances alone (no flows) are identical (test tolerance ≤ 1 cent per year).

---

### 1.7 Unverified rules in the forecast (owner decision, 2026-10-19)
While rule values are unverified, the forecast is still shown, **with the dependent steps left out
and labeled**, never with a filled-in value:
- Workplace limits unverified (`workplaceLimits`): contributions are **as elected, before limits**
  (requested deferrals and the match on them). This can overstate savings for people above the
  limits.
- IRA/HSA limits or Roth eligibility unverified: a dollar or percent schedule contributes the
  requested amount; "maximum allowed" contributes nothing (its amount is the unknown limit).
- Taxes unverified (`federalIncomeTax`, `payrollTax`): net pay, surplus, the infeasible flag and net
  income are **null**; no surplus is routed.
- `ProjectionResult.excludedFeatures` lists every skipped feature, `unverified` lists the rule keys,
  and the UI shows a persistent banner plus a badge on each dependent card and chart.

## 2. Rules resolution [M2, final]
- Values are `Verified<T>`, each `verified`, `unverified` (null plus `unverifiedReason`), or
  `notPublished`.
- `resolveRules(anchorYear, targetYear, indexRate)`:
  - if `targetYear ≤ anchorYear` and the year's value is verified, use it;
  - otherwise start from the latest verified year `b ≤ anchorYear` and set
    - `indexed`: `v_target = round_rule(v_b · (1 + indexRate)^{target − b})`, using the published
      rounding metadata (for example "down to a multiple of $500"); if the rounding metadata is null
      the value is not rounded, and the result is labeled "projected";
    - `statutory-fixed`: `v_target = v_b`;
    - null at the base stays null and dependent outputs are `unverified`.
  - The default index rate is the inflation assumption (a labeled assumption).
- Resolution is per rule value. Numbers under a key named `rate` (bracket rates) are never
  indexed; every other number in an indexed value is money in cents. With no rounding metadata the
  projected value is rounded to the cent. A verified value with no recorded indexation is not
  projected (it becomes `unverified`). With no verified base, the most specific null entry is
  reported (the target year's own, else the latest usable year's).
- Calculations read rules through `RuleAccess`, which records every null value a calculation needed
  (key, reason, dependent features). A calculation that needed any null value returns
  `{status:'unverified', missing}`; values a given input does not need are not read (for example,
  LTCG breakpoints only when there are gains).
- Sunset provisions carry `sunsetYear`. After it, law is modeled as written (the provision is absent),
  which is a labeled assumption.

## 3. Income and contributions [M2, final]

### 3.1 Salary, raises, bonus (per person, working years)
- `base_1 = baseSalary`. For t ≥ 2: `base_t = base_{t−1}·(1 + g_t)`, where `g_t` is the override for
  `Y_t` if one is set, else either the nominal rate or `(1+i_t)(1+realRaise) − 1`. Year 1 applies no
  raise, because the entered salary is the current one.
- Implied real raise: `(1+g_t)/(1+i_t) − 1` is stored in each row.
- Bonus:
  - percent of salary: `b_t = pct·base_t`.
  - fixed: `b_1 = amount`, then `b_t = b_{t−1}·(1+g_t)` (with salary), `·(1+q)` (own rate), or
    unchanged (flat).
- Part-time phase: `pt_t = annualIncome·P_t` for ages in [startAge, endAge). FICA applies; there
  are no plan deferrals (simplification). Part-time income is added to any salary in the same year.
- Salary stops at `stopAge` (default: retirement age); after that, salary and bonus are 0.

### 3.2 Eligible compensation
- `E^def_t = min(base_t + [bonusCountsForDeferrals]·b_t, L^comp_t)`
- `E^match_t = min(base_t + [bonusCountsForMatch]·b_t, L^comp_t)`
- `L^comp` is the 401(a)(17) compensation limit. The compensation path itself is rule-free (it
  reports eligible pay before `L^comp`); the limit is applied where it matters: to the pay the
  deferral percentages apply to (scaled pro rata when above `L^comp`) and to the match base
  (`capContributions`). When `L^comp` is unverified, requested deferrals are shown on uncapped pay and
  labeled "before limits".

### 3.3 Employee deferrals
- Requested traditional deferral: `d^T = p^T_sal·base + p^T_bon·b`, and likewise Roth. If the bonus
  does not count for deferrals, the bonus percentages are ignored and a warning is shown. Salary
  dollars above `L^comp` are excluded.
- Auto-escalation: `p_t = min(cap, p_1 + step·(t−1))` for the chosen bucket; an election already
  at or above the cap stays where it is.

### 3.4 Limits (warnings and caps, never silent truncation)
- Employee limit:
  - `L^emp = L^402g + catchUp(age)`, where `catchUp` is `catchUp60to63` for ages 60–63,
    `catchUp50` for ages ≥ 50 otherwise, and 0 below 50.
  - 401(k) and 403(b) deferrals are aggregated per person. A 457(b) has its own equal limit.
  - Requested deferrals fill the base room `max(0, L^402g − other aggregated deferrals)` first; the
    excess, up to the catch-up room, is the catch-up portion. The catch-up room is shared across the
    person's aggregated plans: `max(0, catchUp(age) − max(0, other aggregated deferrals − L^402g))`.
  - If requested > allowed, both buckets are scaled pro rata to fit, with a `deferralCapped` warning.
- Roth catch-up: if it is in force for `Y_t` and the prior-year FICA wages exceed the threshold
  (projected wages are used for t ≥ 2; the user input is used for year 1), the catch-up portion is
  Roth. If the plan offers no Roth, the catch-up is disallowed and a warning is shown. If the year-1
  input is unknown, the catch-up stays as elected and a warning is shown.
- 415(c): (employee excluding catch-up) + employer ≤ `min(L^415, 100% of compensation)`, where
  compensation is the person's total compensation for the year (`ContributionRequest.compensation`;
  simplification: salary + bonus from this employer, not the plan's own 415 definition).
  - If the employee portion alone exceeds the cap, the deferrals are reduced pro rata to fit and no
    employer money is allowed (warning).
  - Otherwise employer money is reduced, the match before the flat contribution (simplification;
    real plans correct by refund), with a warning.
- A bonus that does not count for deferrals gets no deferral; if the elections imply one, a
  `bonusDeferralIgnored` warning says so.

### 3.5 Employer match (single `EmployerMatchRule`)
- The deferral rate is `δ = (d^T + d^R)/E^match`. Tier k covers the band
  `[a_k, a_k + β_k)` with `a_1 = 0` and `a_{k+1} = a_k + β_k`.
- `m_k = rate_k · max(0, min(δ, a_k+β_k) − a_k) · E^match`, and `match = min(Σ m_k, annualCap)`.
- `flat = flatPct · E^match`.
- Readout (per plan, on the requested deferrals, before limits):
  - full-capture rate `δ*` = the end of the last tier with a positive rate; if a dollar cap binds
    inside tier k, `δ* = a_k + (cap − match before tier k)/(rate_k·E^match)`; dollars `δ*·E^match`;
  - possible match `= min(Σ rate_k β_k E^match, cap)`;
  - unclaimed `= possible − match`.
  - The readout is labeled "before plan limits" while the limits are unverified. Once they are
    verified, the readout adds the after-limit match the forecast counts (with 402(g), 401(a)(17) and
    415(c), from `PersonPreviewRow.contributions.employerMatch`, summed over the person's plans), or
    says that the limits do not reduce it.
- **Vesting:** employer dollars are tracked in an `unvested` sub-ledger that grows at the account's
  return. At separation (retirement), the forfeiture is
  `unvested·(1 − v(years of service at separation))`, and it is shown as `forfeited`.
  Simplification: the vesting fraction applies to the whole employer sub-ledger. M2 shows the vested
  share at the end of each preview year; the forfeiture itself is applied in the projection (M3).

### 3.6 Non-workplace contributions
- Dollar or percent-of-salary schedules, growing flat, with inflation, or at a set rate, between the
  start and stop years.
- `maxAllowed` contributes the year's limit after eligibility caps; for taxable, cash and other
  accounts (no limit) it contributes nothing. Percent-of-salary schedules apply to base salary.
  Dollar schedules grow from year 1. Monthly amounts are ×12. A schedule is active from its start
  year (default year 1) through its stop year (default the owner's last working year).
- Order each year (`income/scheduled.ts`): HSAs → traditional IRAs → Roth IRA eligibility per owner
  → Roth IRA schedules → taxable, cash and other accounts. HSAs come first, so this year's HSA
  contributions reduce the MAGI used for Roth IRA eligibility.
- The result per account (`CashFlowPreviewRow.scheduled`) is the requested amount (null for
  "maximum allowed") and the allowed amount after limits (null when a limit it needs is unverified).
  The Roth IRA and HSA pages show these engine figures; the UI does no limit arithmetic of its own.
- IRA:
  - annual limit plus catch-up (50+), shared by traditional and Roth IRAs (filled in account order);
  - capped at the person's own earned income (spousal IRA unsupported);
  - the Roth IRA amount is further reduced by the phase-out (§3.7).
- HSA:
  - self-only or family limit, plus catch-up (55+);
  - one limit per person, shared by all of that person's HSAs (filled in account order; the coverage
    of the person's first HSA sets the limit);
  - blocked without HDHP attestation.

### 3.7 Roth IRA eligibility
- MAGI defaults to `salary + bonus − traditional deferrals − HSA contributions + part-time income`,
  summed over both people for married filing jointly, a documented simplification the user can
  override (`magiOverride` on the Roth IRA account). Deferrals and HSA contributions are the amounts
  after limits, so the estimate is null (never a guess) while those limits are unverified; an
  override still works.
- The engine reports each Roth IRA owner's figures in `CashFlowPreviewRow.rothIra`: MAGI source and
  components, MAGI, other IRA contributions and the eligibility result.
- Worksheet order (Pub 590-A reduced Roth IRA contribution worksheet; pending verification at
  source):
  - base `= min(L, earned income)`, where L is the IRA limit plus catch-up;
  - over the phase-out range `[A, B]`: `phased = base` for MAGI ≤ A, 0 for MAGI ≥ B, otherwise
    `base·(B − MAGI)/(B − A)` rounded up to a multiple of the worksheet increment, with a minimum
    when above 0. Both the increment and the minimum are rule values
    (`standing:roth.reducedContributionRounding`). They are currently unverified, so the
    reduced-contribution path returns `unverified`. The full and ineligible paths don't need them;
  - `allowed = max(0, min(phased, base − other IRA contributions this year))`.

### 3.8 Accumulation-phase cash flow
- `netPay = wages + bonus + partTime + other income − federalTax − FICA − stateTax` (taxes per §6;
  traditional deferrals and HSA contributions are excluded from income-tax wages; FICA is on gross
  wages, which slightly overstates FICA for payroll HSA contributions).
- `surplus = netPay − all employee contributions (workplace after limits + scheduled IRA/HSA/taxable/
  cash) − spending_t`, where spending is current spending while anyone is working and retirement
  spending once everyone is retired.
- In years with someone working, `surplus < 0` flags the plan **infeasible** with a warning. Balances
  still assume the plan is carried out, and the shortfall is shown, not hidden.
- When taxes are unverified the surplus is unknown. Taxes and contributions are never negative, so
  `gross pay + other income − spending < 0` still **proves** the year infeasible. It is flagged with
  a warning ("even before taxes and contributions"); no rule value is needed or filled in.
- If `surplus > 0`, it goes to the chosen account (default: spent) as a mid-year contribution
  (`flows.surplusRouted`; a taxable account's basis rises by the same amount). A negative surplus
  is not withdrawn from savings; the year is listed in `summary.infeasibleYears`.
- Every figure that needs an unverified rule (limits, taxes) is null and labeled in the UI.

## 4. Accounts, growth and fees [M3]
- Expected return precedence: `account.expectedReturn`, then the allocation-implied
  `Σ w_k·g_k^CMA`, then the phase assumption (pre- or post-retirement, by the **household** phase of
  that year). Then the deterministic offset is added (§9). The applied return is floored at −99%.
- Fee drag: net rate `ρ = (1+r)(1−f) − 1`, where f is the expense ratio. The gross figure uses r, and
  `feeDrag = growthGross − growthNet`.
- Taxable accounts: `ρ = (1+r)(1−f) − 1 − drag`, where drag is the user's tax-drag percentage points
  (default 0).
- Market shock (scenario D): the given returns replace r for every account in those years (the
  offset still applies).
- Taxable basis: contributions add basis 1:1. A withdrawal W reduces basis pro rata,
  `basis' = basis·(1 − W/balance)`, and the realized gain is `W·(1 − basis/balance)`.
  In the projection the "balance" for that ratio is the account's withdrawal cap (the amount
  available that year), so `basis' = (basis + C)·(1 − W/cap)`.
- Roth IRA: withdrawals come from contribution basis first, then earnings (§7.4):
  `basis' = max(0, basis + C − W)`.
- Contributions route to accounts as follows:
  - workplace traditional deferrals go to the plan's traditional account;
  - Roth deferrals go to its Roth account;
  - employer match and flat go to the match destination (the Roth account if `matchDestination` is
    Roth, else the traditional account);
  - scheduled amounts go to their own account;
  - a routed surplus goes to the surplus account.
- **Vesting and forfeiture:** employer money subject to vesting accrues in a sub-ledger of the
  match destination account, `u' = u·g_S + employer·g_C`.
  - The entered `unvestedEmployerBalance` is the part **not vested today**, `U0 = E0·(1 − v0)`, with
    `v0 = v(yearsOfServiceAtStart)`. So the ledger starts at `E0 = U0/(1 − v0)`.
  - If the plan is fully vested at the start (`v0 = 1`), or no plan sends employer money to the
    account, the entered amount is never forfeited, with a warning.
  - Separation is the start of the first projection year in which the owner has no salary
    (including year 1).
  - Years of service at separation = `yearsOfServiceAtStart` + projection years worked.
  - The forfeiture is `F = min(balance, u·(1 − v(years of service)))`, taken at the start of that
    year before growth. It is included in the account's `withdrawals` and shown in `forfeited` and
    `flows.forfeited`. Household `flows.withdrawals` counts spending withdrawals only.
- Tax treatment for allocation view (b): tax-deferred = workplace traditional, traditional IRA,
  "other" tax-deferred; tax-free = workplace Roth, Roth IRA, HSA, "other" tax-free; taxable =
  taxable brokerage, cash, "other" taxable. HSA is shown as tax-free (qualified medical use).

### 4.1 Retirement-phase cash flow (M3 baseline; superseded in M4 by §7.1, kept for the before-taxes path)
For each retirement-phase year:
1. `need = retirementAnnualSpending · P_t`.
2. Cash income `I = earned (part-time) + other income`, before taxes.
3. Scheduled contributions are funded only from `max(0, I − need)`, and are scaled down if that is
   smaller (warning `retirementContributionsReduced`). The scaled amounts round **down** to whole
   cents, so they never exceed the income left over.
4. Withdrawal need `W = max(0, need + contributions − I)`, before taxes. It is drawn by the
   strategy's order (§7.3). Within one group, accounts are drawn pro rata by their caps; no account
   goes below its cap (§1.5). `bracketFill` needs the tax model, so it falls back to taxableFirst
   with a warning until M4.
5. Any unfunded part is the shortfall (`spendingFunded = need − shortfall`). The first year with a
   shortfall above half a cent is the depletion year, with a `portfolioDepleted` warning.
6. `grossIncome = I + funded withdrawals`. `netIncome` is null until the M4 tax model (retirement
   taxes, RMDs, SS, pensions, one-time events, spending steps, glide, healthcare and the survivor
   reduction all arrive in M4 and are listed as `featureNotModeled` warnings while they are not
   modeled).

Accumulation-phase years make no withdrawals: spending is funded from pay (§3.8). Their
`grossIncome` is wages plus other income, and `netIncome = netPay` (null when taxes are unverified).

- **Deterministic success:** no depletion year, and the real ending balance ≥
  `minimumEndingBalance` (today's dollars).

## 5. Spending [M4]
- Accumulation years: `spend_t = currentAnnualSpending · P_t`.
- Retirement-phase years:
  - `spend_t = S_step(age_1) · (1+glide)^{t − t_R} · P_t`, where:
    - `S_step` is the retirement spending, or the latest step whose `fromAge ≤ age_1`;
    - `age_1` is the first listed person's age that year (calendar arithmetic, even after their death);
    - `t_R` is the first retirement-phase year (glide exponent 0 in that year);
  - plus `healthcareBeforeMedicare · P_t` while any **living retired** person is under 65 (a
    user-entered line item). Any plan in which someone retires before 65 carries the
    `healthcarePreMedicareUserEntered` note on every forecast (shown on the dashboard).
- For couples, spending in **both** phases is multiplied by `(1 − survivorSpendingReduction)` from
  the first death year D (§7.7) onward: a survivor who is still working spends less too.
- Rule-free: none of this needs a rule value.
- One-time events (§7.6) add outflows to the year's withdrawal need and inflows to an account.

## 6. Tax model (simplified, documented) [M4; payroll and ordinary tax used in M2 net pay]
- Ordinary income = wages − pre-tax deductions + traditional withdrawals + taxable pensions + taxable
  other income + taxable SS + HSA non-medical withdrawals.
- Deduction = standard deduction(status) + additional 65+ amounts per eligible filer (the married
  amount for MFJ, the unmarried amount for single) + the senior deduction: for each eligible filer,
  `max(0, amount − rate × max(0, MAGI − start))`, with the household MAGI (MAGI = AGI as a
  simplification). The senior deduction is
  absent after its verified sunset year (law as written); while its amount is unverified it counts as
  in force, so 65+ tax results are `unverified`.
- Taxable ordinary = `max(0, ordinary − deduction)`. Tax = Σ over brackets.
- LTCG are stacked on top of ordinary taxable income: the low rate up to `zeroRateMax`, the middle
  rate up to `fifteenRateMax`, and the high rate above. The three rates are rule values
  (`standing:capitalGainsRates`). Any unused deduction offsets gains first.
- Taxable SS (Pub 915), with `t1`, `t2` the inclusion shares and base/adjusted the thresholds
  (all rule values, `standing:ssBenefitTaxation`; no share is written into the code):
  - `PI = otherIncome + taxExempt + t1·SS` (the worksheet's share of benefits in provisional
    income is the same rule value as the tier-1 share).
  - If PI ≤ base, taxable SS is 0.
  - If base < PI ≤ adjusted, it is `min(t1·(PI − base), t1·SS)`.
  - Above adjusted, it is `min(t2·SS, t2·(PI − adjusted) + min(t1·(adjusted − base), t1·SS))`.
- FICA: the OASDI rate on each person's wages up to the wage base, plus the Medicare rate on all
  wages (rates and wage base are rule values). Additional Medicare tax is unsupported.
- State tax = flat rate × federal AGI (simplification).
- Taxes are never negative; a property test checks this.
- Filing status is MFJ through the first death year and single from the following year.
- **Unsupported:** AMT, NIIT, IRMAA, itemized deductions, credits, state-specific rules, and
  early-withdrawal penalties beyond a flag and a warning.

## 7. Retirement income [M4]
Everything here follows §1.7. A step that needs a null rule value is **left out and labeled**, and
listed in `excludedFeatures`; it is never filled in. With the bundled (unverified) rules:
- Social Security works only from an `atClaimAge` input;
- spousal and survivor benefits, RMDs, taxes and Roth qualification are left out.

### 7.1 Order of operations each year
1. **Spending need** (§5) plus one-time outflows (`amountBasis` today's dollars × `P_t`, or nominal).
2. **Fixed income** (gross):
   - earned (part-time) pay;
   - Social Security (§7.5);
   - pension annuities (§7.6);
   - other income, owned by a living person or the household.
   Lump-sum pensions and one-time inflows are **deposits** to their destination account at mid-year.
   They are not spending income.
3. **RMDs** (retirement or accumulation phase; verified rules only, else `rmd` is excluded). For each
   traditional account (workplace traditional, traditional IRA, "other" tax-deferred, and workplace
   Roth only if `roth401kLifetimeRmdRequired`) whose owner is alive and `age ≥ rmdStartAge(birthYear)`:
   - `RMD = min(cap, priorYearEnd / period(age))`; in year 1, `priorYearEnd` is the entered balance;
   - it counts as a withdrawal from that account and as ordinary income.
4. **HSA medical** (retirement phase): tax-free withdrawals up to
   `min(hsaQualifiedMedicalExpenses · P_t, remaining need)`, drawn pro rata from the HSAs' caps.
   - Medical expenses are part of the spending need, not added to it.
   - In accumulation years medical costs are paid from pay (simplification).
  - Medical withdrawals count in `flows.hsaMedical` and in `flows.withdrawals`.
5. **Remaining need.** In the **retirement phase**, `need − (fixed income + RMDs + HSA medical)`, net
   of taxes, is funded by withdrawals:
   - taxes verified: the gross-up solver (§7.2);
   - otherwise before taxes (`W = max(0, remaining)`), as in M3.

   In the **accumulation phase**, spending is funded from pay (§3.8). Social Security, pension
   annuities and RMDs received while someone still works count as income for net pay, surplus and
   the infeasible check (their tax is in the year's tax). RMD money is reinvested (step 6). One-time
   outflows are withdrawn from the portfolio by the same strategy, before taxes (simplification).
6. **Excess.** If fixed income, RMDs and HSA medical exceed the need (after tax when taxes are
   verified), the excess is **reinvested** mid-year in the first taxable brokerage account, else the
   first cash account; with neither it is spent. RMD money in excess is never left in the
   tax-deferred account.
7. **Taxes** (verified rules only), on:
   - wages (part-time);
   - ordinary income: traditional withdrawals including RMDs, the taxable share of pensions and
     other income, HSA non-medical withdrawals (at any age; §7.4), one-time `ordinaryIncome` inflows;
   - Social Security benefits (taxable share per Pub 915, §6);
   - long-term gains: the gain part of taxable-brokerage withdrawals, `W·(1 − basis/cap)`, plus
     `gainFraction` of one-time `capitalGain` inflows;
   - filing status: MFJ through the first death year, then single;
   - with `ages` of the living filers.
   Roth withdrawals, Roth basis, HSA medical and cash are untaxed.

### 7.2 Gross-up solver
- Find gross withdrawals `W` so that `fixed + RMD + HSA medical + W − tax(W) = need` within the
  tolerance (`grossUp.toleranceCents`, default $1).
- Iteration (bounded fixed point, `grossUp.maxIterations`, default 50):
  - `W_0 = max(0, need − (fixed + RMD + HSA) + tax(W = 0))`;
  - `W_{k+1} = max(0, need + tax(W_k) − fixed − RMD − HSA)`, where each `W_k` is allocated by the
    strategy and the caps, and the tax uses that allocation's ordinary income and gains;
  - stop when `|W_{k+1} − W_k| ≤ tolerance`.
  The map is a contraction because the combined marginal rate (federal, SS inclusion and state) is
  below 1.
- If W exceeds the total cap, W is capped and the rest is `unfunded` (depletion, §4.1). A solve
  that converges within the tolerance while accounts still have money is fully funded, even if net
  income is a few cents under the need.
- Non-convergence returns the last iterate with `solver.converged = false` and a
  `grossUpNotConverged` warning. The tests cover convergence, non-convergence and depletion.
- Output per year: `grossIncome`, `tax` (detail with solver iterations), `netIncome = grossIncome −
  totalTax`.

### 7.3 Withdrawal strategies
| Strategy | Order |
|---|---|
| taxableFirst | cash → taxable → traditional → Roth → HSA (non-medical) |
| traditionalFirst | traditional → cash → taxable → Roth → HSA |
| rothLast | cash, taxable and traditional pro rata by available balance → HSA → Roth |
| proportional | all accounts pro rata by available balance |
| bracketFill | traditional up to the bracket top (below) → cash → taxable → Roth → HSA |

- "Available balance" is each account's withdrawal cap for the year (§1.5), after RMDs.
- **Bracket fill (heuristic):** traditional withdrawals beyond RMDs fill taxable ordinary income up to
  the top of the bracket whose rate is `bracketFillTopRate`: `T = max(0, top + deductions −
  ordinary income already counted − taxable SS at the fixed income)`.
  - SS taxation is estimated at the fixed income (simplification).
  - Bracket fill never withdraws more than the need (no deliberate Roth conversions).
  - It needs verified brackets, and falls back to taxableFirst with a warning otherwise.

### 7.4 Roth and HSA withdrawals
- **Roth IRA** withdrawals come from contribution basis first (untaxed). Earnings are qualified, and
  untaxed, from the calendar year the owner turns 59½ **and** at least `fiveYearRuleYears` after
  `firstContributionYear` (year 1 if unknown).
  - "Turns 59½" means `birthYear + 59` if `birthMonth ≤ 6`, else `birthYear + 60`, using
    `qualifiedAgeMonths`.
  - Earnings withdrawn earlier are flagged with `rothEarningsWithdrawnEarly`. No tax or penalty is
    modeled (simplified).
  - With unverified rules the check is excluded (`rothQualification`) and no flag is shown.
- **Workplace Roth:** treated as qualified (simplification; its own 5-year rule is not tracked).
- There are no Roth IRA owner RMDs. Workplace Roth RMDs follow `roth401kLifetimeRmdRequired`.
- **HSA:**
  - qualified medical withdrawals are tax-free (§7.1 step 4);
  - non-medical withdrawals (in the strategy order) are ordinary income at any age;
  - before 65 they are also flagged `hsaNonMedicalPre65` as penalized (no penalty amount is modeled).

### 7.5 Social Security
- **Own benefit at claim**, by input kind:
  - `atClaimAge`: the entered monthly benefit at the planned claiming age (today's dollars) is used
    directly. No rule values are needed.
  - `statement` (PIA at FRA): `monthly = PIA · f` with the claim factor `f` below (verified FRA
    table and factors needed, else excluded: `socialSecurityClaiming`).
  - `estimateAverage` / `estimateHistory`: an illustrative PIA (below), labeled "not an official SSA
    calculation" (`ssEstimateIllustrative`), then `f` as above.
- **Claim factor**, with `m = FRA_months − claim_months`:
  - if m > 0: `1 − (r1·min(m,36) + r2·max(0, m−36))`;
  - if m < 0: `1 + d·min(−m, months to delayedCreditMaxAge)`.
  - r1, r2, d and the max age are verified standing rules.
- **Timing:** benefits begin in the claim year, `birthYear + claimAge.years`, prorated by the months
  of entitlement that year: `max(0, 12 − (birthMonth − 1 + claimAge.months))`. The person must be
  alive.
- **Amount in year t:** `12 · monthly · P_t` (COLA = inflation), or `12 · monthly · Π(1 + cola)` for
  a set COLA rate. The `benefitReduction` assumption multiplies by `(1 − reduction)` from its year
  (labeled an assumption, not a prediction).
- **Spousal (verified rules only, else excluded: `spousalSurvivorBenefits`):**
  - excess = `max(0, maxShareOfPia·PIA_other − PIA_own)`, reduced for claiming before one's own FRA
    with the spousal factors;
  - payable from the year both have claimed (months: the fewer of the two that year).
  - Needs both PIAs: `atClaimAge` inputs have no PIA, so spousal is excluded for them.
  - A person with no benefit of their own (`none`) has PIA 0, so they receive the full spousal
    excess (reduced for claiming before their own FRA at their entered claiming age). Nobody
    receives a spousal amount based on a spouse whose own benefit is 0 or `none`.
- **Survivor (simple model; verified rules only, else excluded):**
  - from the first death year, but no earlier than the survivor's own claim year (prorated in that
    year like an own benefit), the survivor receives
    `max(own, maxShareOfDeceased × deceased's benefit, ribLimFloorShareOfPia × deceased PIA)` (the
    floor only when a PIA is known);
  - the deceased's benefit stops;
  - if the deceased had not claimed before death, their benefit is `PIA × max(1, f(death age))`:
    never reduced for the deceased's age, with any delayed credits earned up to the death age (the
    claim range clamps the age);
  - the survivor's own early-claim survivor reduction is not modeled;
  - for an `atClaimAge` deceased who had not claimed yet, the entered amount stands in for the
    benefit at the death age (simplification; no PIA is known).
  - While excluded, each person keeps only their own benefit, and the survivor gets nothing extra.
- **Earnings test:** unsupported. `ssClaimBeforeFraWhileWorking` warns when someone claims before FRA
  while drawing salary or part-time pay. With an unverified FRA, the warning says the claim is made
  while still earning and that, if it is before full retirement age, the earnings test may reduce
  benefits (no age is substituted).
- **WEP/GPO:** applied only per the verified current status. The candidate says they are repealed;
  no reduction is modeled either way.
- **Illustrative estimator (not an official SSA calculation):**
  - from history: wage-index each year with AWI to the eligibility year − 2, take the top 35 years,
    `AIME = Σ/420`, and `PIA = p1·min(AIME,b1) + p2·clip(AIME−b1, 0, b2−b1) + p3·max(0, AIME−b2)`
    (factors `p1..p3` and bend points `b1, b2` from the rules), truncated to the dime. The 35 years,
    the 420 divisor, eligibility at 62 and indexing to the eligibility year − 2 are statutory
    constants of the method, listed for verification in `rules-verification.md`;
  - average mode: `AIME = avg·min(years,35)/35/12`, using the current year's bend points;
  - entered history is assumed already capped at each year's taxable maximum (labeled).

### 7.6 Pensions, other income and one-time events
- **Pension annuity:**
  - starts in the year the owner reaches `startAge`;
  - the amount is today's dollars × `P_t`, or nominal at start;
  - it then grows by its COLA (flat, inflation or a rate) from the start year;
  - a pension already in payment before year 1 (start age reached earlier) is taken at its entered
    amount in year 1 and grows by its COLA from year 1 (stated on the Retirement Income page);
  - `taxableFraction` of it is ordinary income.
  - After the owner's death, `survivorFraction` continues to a surviving spouse; for a single owner it
    stops.
- **Lump sum:** the stated amount is **nominal** (`amountBasis` applies to the annuity amount only).
  It is paid in the start year into `destinationAccountId` (a rollover; untaxed when the destination
  is tax-deferred, otherwise taxed per `taxableFraction` as ordinary income).
- A continuing survivor pension is reported on the survivor's person row.
- **Other income:** as in §3.8. Owned income stops after the owner's death (§1.4).
- **Flows:** `flows.pensions` is annuity income only. Lump sums and one-time inflows are counted
  in `flows.oneTimeInflows` (deposits). `flows.spendingNeed` includes one-time outflows, which are
  also reported separately in `flows.oneTimeOutflows`.
- **One-time events** (in their `year`; `amountBasis` today's dollars × `P_t`, or nominal):
  - **outflow:** added to that year's withdrawal need (§7.1 step 1);
  - **inflow:** deposited mid-year into `destinationAccountId`, or else the surplus account, the first
    taxable brokerage, the first cash account; with none, it is spent with an `oneTimeInflowSpent`
    warning.
    - Tax: `ordinaryIncome` → ordinary income; `capitalGain` → `gainFraction` × amount as long-term
      gains; `none` → untaxed.
    - Basis: a taxable-brokerage deposit adds basis equal to the **whole** deposit, because any gain
      is taxed in the event itself (it is not taxed again when withdrawn).

### 7.7 Survivor modeling
- **First death year** `D = birthYear + planningAge + 1` of the first to die (§1.4). From D:
  - the deceased's salary, part-time pay, owned other income and SS stop;
  - survivor SS (§7.5) and pension continuation (§7.6) apply;
  - spending is reduced by `survivorSpendingReduction` (§5), in working years too;
  - accounts stay in the household, and the survivor's age governs RMDs on the deceased's accounts
    (spousal rollover assumption);
  - filing status is MFJ in D, single from D + 1. The joint return in D counts the deceased as a
    filer for the age-based deductions (their 65+ additional and senior deductions) as well as the
    survivor; from D + 1 only the survivor's age counts.
- The tests cover both orderings (older or younger spouse dies first) and equal planning ages.
## 8. Dashboard cards [M3, extended M4/M6]
| Card | Definition | Dollar basis | Tax basis | Year |
|---|---|---|---|---|
| Current age | `Y_1 − birthYear` (each person) | — | — | year 1 |
| Retirement age | input | — | — | — |
| Years to retirement | `max(0, retirementAge − currentAge)` | — | — | — |
| Current savings | Σ account balances | nominal = today's | gross (pre-tax balances) | start of year 1 |
| Projected savings at retirement | `portfolioStart` in the first retirement year | toggle | gross | first retirement year, start |
| Projected monthly retirement income | `netIncome/12`, or `grossIncome/12` labeled "before taxes" while netIncome is null (all of M3) | toggle | net, or before taxes (labeled) | first retirement year |
| Estimated monthly retirement spending | `spendingNeed/12` | toggle | net need | first retirement year |
| Surplus / shortfall | income − spending (monthly) | toggle | same basis as income | first retirement year |
| Portfolio longevity | depletion age of the first listed person still alive that year, or "lasts through planning age" | — | — | — |
| Readiness | heuristic, below | — | — | — |

Readiness (a labeled heuristic):
- **On track**: baseline and pessimistic deterministic runs both succeed.
- **Borderline**: the baseline succeeds but the pessimistic run fails.
- **At risk**: the baseline fails.
- From M6, Monte Carlo success ≥ 85% / 70–85% / < 70% is shown alongside, with its assumptions.

- "First retirement year" is the first year in which every living person is retired; for an
  already-retired household it is year 1.
- Real values divide by that year's deflator `P_t`, except savings at retirement, which is a
  start-of-year balance and divides by `P_{t−1}` (§1.1). Monthly figures divide the annual cents by
  12 (and by `P_t` for real values) and round once, half to even.
- Cards that depend on an excluded (unverified) feature carry its label, for example "before plan
  limits" or "before taxes" (§1.7). A figure that needs a null rule directly (net pay) is not shown
  as a number.
- Implemented in `projection/dashboard.ts` (`computeDashboard`); tests in
  `projection/project.test.ts`.

## 9. Optimistic / baseline / pessimistic lines [M3]
These rerun the projection with `returnOffset` set to +optimistic, 0 and +pessimistic (default
±2 percentage points) on every account's nominal return. They are fixed return offsets, not
confidence intervals. Everything else (contributions, spending, inflation) is unchanged.

## 10. Scenarios [M5]
- **Diff ops** `set | unset | add`, keyed by `(collection, id)`, are applied in order to a deep copy of
  the base (`applyScenario`). The result is re-validated with the household schema; invalid results
  return the issues and no household.
  - `set` writes `value` at `path` inside the entity. Every step and the field itself must already
    exist as the entity's own keys (after schema defaults), otherwise the op is `invalidPath`: a
    misspelled field is reported, never silently dropped. An array index may be one past the end
    (append). Paths may not contain `__proto__`, `constructor` or `prototype` (rejected by the
    scenario schema).
  - `unset` with a path removes that key, so the schema default applies (a required field without a
    default makes the result invalid). Without a path it removes the entity, except the household
    itself (`invalidPath`).
  - `add` appends a new entity; `workplacePlans` need `parentId` (a person), else `missingParent`.
  - An op whose id is missing from the base is `orphaned` (`missingEntity`) and skipped.
  - Because a scenario stores only ops, edits to the base flow through.
- **Presets** (`presetScenario`; the parameters used are stored in `presetParams`):
  - A Baseline: no ops.
  - Every preset records `currentYear` in `presetParams`. A person already retired in the current
    year (age ≥ retirement age) is left unchanged by B and E: retiring earlier is no longer possible,
    and a later age would restart their salary.
  - B Early retirement: every retirement age −`years` (default 5), not below today's age. Salary stop
    ages are cleared.
  - C Aggressive savings: each workplace plan's salary deferral +`deferralIncrease` (default 5
    points; the Roth percentage if the plan is Roth-only, capped at 100%). Traditional and Roth IRA
    schedules move to "maximum allowed" only with `irasToMax` (off by default), because "maximum
    allowed" contributes nothing while IRA limits are unverified (§1.7).
  - D Market downturn: `marketShock` starting `startYear` (default: the first year everyone is
    retired; never before the current year, so for a retired household it is year 1, and an entered
    earlier year moves up to the current year). The total drawdown is `severity` (default −30%), spread geometrically over
    `durationYears` (default 1): each year's return is `(1+severity)^{1/n} − 1`. It is deterministic
    and reproducible (tested).
  - E Delayed retirement: every retirement age +`years` (3–5, default 3), capped at the planning age.
  - F Reduced spending: retirement spending and spending steps −`cut` (default 10%), rounded half to
    even to the cent (§1.3). Current (working-years) spending is unchanged.
  - G Roth strategy: all workplace deferrals (salary and bonus) moved to Roth where the plan offers
    Roth with a Roth account.
- **Drift** (`presetDrift`): presets B, C, E, F and G store the values computed on the base at
  creation (for example F stores the cut amount). When rebuilding the preset from its `presetParams`
  on the current base gives different ops, the scenario has drifted; the UI says so and offers to
  rebuild it. Editing a preset's ops makes it a custom scenario.
- `marketShockTotal(returns) = Π(1 + r) − 1`, the severity of a shock sequence (shown by the UI).
- **Comparison** (`compareScenarios`): for the base and each scenario, the dashboard
  (baseline, optimistic and pessimistic runs), orphaned ops and issues.
  - **After-tax ending balance** (for G): real ending balance minus an assumed liquidation tax on
    tax-deferred money at the final year's marginal ordinary rate,
    `real.portfolioEnd − (taxDeferred_end / P_T) × marginalRate_T`. The marginal rate is the
    model's own computed rate; this is the documented marginal-rate assumption.
  - The after-tax figure is null while taxes are unverified (never estimated).
  - Funding success is the deterministic criterion (§4.1); a Monte Carlo success rate is added in M6.
- **Optimizer** (`optimizeRetirementAge`, deterministic criterion):
  - evaluates every age in the range, setting the first person's retirement age and shifting every
    other person not yet retired by the same number of years (salary stop ages cleared for those
    who move; a retired partner stays retired);
  - is `invalid` when the first person is already retired, or when the range starts below their
    current age;
  - reports the earliest age whose baseline succeeds, or null;
  - candidates that fail validation (for example past a planning age) are skipped.
  - Tests check the result against an independent brute-force scan.
  - **Monte Carlo criterion (M6):** an age succeeds when the success rate (§11) over the quick-run
    paths `0 … quickRunPaths − 1` is at least `minSuccessRate`. The same paths are used for every
    age (common random numbers), so differences between ages are not sampling noise between seeds.
    Tested against running each candidate directly.
- **Monte Carlo in the comparison (M6):** the UI applies each scenario (`applyScenario`) and runs
  the same Monte Carlo (same seed and paths) on each resulting household.

## 11. Monte Carlo [M6]
- PRNG:
  - path i is seeded by `splitmix32(hash32(seed, i))`, which fills the 128-bit `xoshiro128**` state;
  - normals come from Box–Muller (both outputs used, in order).
  - Because path i's stream depends only on (seed, i), results are independent of chunking or worker
    count, and the quick run (paths 0–999) is a prefix of the full run.
- Account return: `ln(1+R_a) ~ N(ln(1+g_a), σ_a²)`, with the same `g_a` as the deterministic model and
  `σ_a² = wᵀΣw`. Here Σ is built from the CMA vols and correlations, and the blended fallback
  volatility is used without an allocation. The shocks are correlated through the Cholesky factor of
  the correlation matrix, which must be PSD (checked).
- Median `1+R = 1+g`, and the arithmetic mean `E[R] = (1+g)·e^{σ²/2} − 1` is shown.
- Rebalancing is annual back to target, approximated by a single lognormal at the portfolio's
  volatility (documented). Glide paths are unsupported.
- Stochastic inflation: `ln(1+i) ~ N(ln(1+median), σ_i²)`, correlated with the assets. Each path has
  its own deflator.
- **Median per account and year:** the return the deterministic baseline applies to that account in
  that year (its expected return for the phase, or a market-shock return), so `ln(1+R) ~
  N(ln(1+g_{a,t}), σ_a²)` and with zero volatility every path equals the baseline (tested).
- **Shocks:** each year draws one standard normal per asset class (plus one for inflation when it is
  stochastic), correlated through the Cholesky factor; account `a`'s log-return shock is
  `Σ_k w_{a,k} σ_k e_k`, whose variance is `wᵀΣw`. An account without an allocation moves with the
  stock shock at `blendedVolatility` (simplification).
- Each path reuses the projection core (withdrawals, gross-up and taxes) through
  `ProjectionOptions.returnOverride` / `inflationOverride`, on the annual model (monthly mode is
  deterministic only).
- **Stochastic inflation** drives each path's deflator, spending, Social Security COLA and
  inflation-linked pensions. **Simplification:** salaries (inflation-based raises) and the indexing
  of tax-year rule values use the inflation assumption, not the path's inflation.
- **Performance (no change to results):** a run shares its return-independent work across paths
  (validated household, rule resolution, each year's accumulation slice for identical inputs), and
  message text is built without locale formatting. Measured in `bench/results/montecarlo.json`.
- **Sequence-of-returns illustration** (`sequenceRiskIllustration`): from the first retirement year,
  each account's baseline return plus the deviations −20%, −12%, −6%, +2%, +8%, +12%, +16% (sum 0,
  so the same arithmetic average), in that order and reversed, each through the full projection.
- **Allocation view (c)** (`allocationByAssetClass`): each account's year-end balance split by its
  target allocation (annual rebalancing keeps it at target); accounts without an allocation are
  shown as "no allocation".
- Success: no depletion before planning age and ending real balance ≥ minimum.
- Model limits: no fat tails, no mean reversion, no regime changes; returns are independent across
  years.

## 12. Calculators [M7a]
The 15 standalone calculators live in `packages/engine/src/calculators/` (one file each, exported from
`calculators/index.ts`, with `runCalculator(id, input, ctx)` dispatching by `CalculatorId`). Each one is a
thin wrapper: it validates its own small input with Zod (`invalid` with field paths, never a throw for
user data), builds an engine input (usually a synthetic household validated by `HouseholdSchema`, on the
template of `samples/minimal.ts`), calls existing engine functions, and reports figures read from the
engine results. None has a financial formula of its own.

### 12.0 Shared conventions
- **Money and rates:** integer cents in and out; rates are decimals. Year 1 is `ctx.currentYear`; a
  person's birth year is `currentYear − age`.
- **Labels on every result** (`CalculatorLabels`):
  - `basis.dollars`: `nominal`, `todaysDollars` or `nominalAndTodaysDollars` (fields named `…Real` are
    today's dollars, §1.1);
  - `basis.tax`: `beforeTaxes` (no tax subtracted: growth-only figures, or tax rules unverified so the
    projection funded the need before taxes, §1.7) or `afterTaxes` (the projection computed taxes and
    grossed withdrawals up, §7.2). It is read from the projection's `excludedFeatures`;
  - `basis.limits`: `afterLimits`, `beforeLimits` (workplace limits unverified, §1.7) or `notApplicable`;
  - `excludedFeatures` and `unverified`: the union of the projections' own lists (plus any null keys
    the calculator's other engine calls needed);
  - `assumptions`: short descriptive statements shown beside the result.
- **Unverified rules:** a calculator never substitutes a rule value. When a figure needs a null rule it
  either returns `unverified` with the missing keys (Social Security claiming comparison in PIA mode)
  or reports the projection's before-limits / before-taxes figures with the labels above (§1.7).
- **Synthetic households:** the plan calculators model no salary in working years (pay and
  working-years spending are outside the calculator; `currentAnnualSpending` is 0). With verified tax
  rules such a household is flagged infeasible by construction (net pay 0 is below its contributions),
  so its `savingsPlanInfeasible` warning is dropped; every other engine warning is passed through,
  except where a calculator says otherwise.
- **Searches (bisection):** `searchMinimum` (smallest passing value) and `searchMaximum` (largest
  passing value) on a predicate that is monotone in the searched input. Both evaluate the bounds first:
  `atBound` (the near bound already passes, or the far bound still passes), `notWithinBound` (nothing
  in the range passes) or `found`. Money searches run on whole cents and stop at a $1 bracket (the
  passing end is returned, so the result is at most $1 above the exact boundary); rate searches stop at
  1e-6. Each search reports its `evaluations` (bounded at 200).
- **Arithmetic the calculators do:** sums and differences of engine cents, bisection midpoints, and
  input construction (a withdrawal rate × a balance and a deferral rate × pay, rounded half to even to
  whole cents; a total split into equal whole-cent payments). Construction invariants (a validated
  horizon has rows) are read through `itemAt`/`lastOf`/`notNull`, which throw a `RangeError` only on a
  programming error, like `asCents`.
- **"No duplicated formulas" gate:** `calculators/noDuplicatedFormulas.test.ts` reads every calculator
  source file (tests excluded) and fails on `Math.pow`, `**`, `Math.exp`/`Math.expm1` or `Math.log*`
  outside comments.

### 12.1 Compound interest (`compoundInterest`)
- **Inputs:** `principal`, `annualContribution` (default 0), `contributionGrowth` (default 0),
  `annualReturn`, `years` (1–100), `inflation` (default 0, for the today's-dollar columns),
  `expenseRatio` (default 0).
- **Engine call:** `projectHousehold` on a one-cash-account household that stays in the accumulation
  phase for exactly `years` rows (the person reaches the retirement age in year `years + 1`; that row
  is not reported). The account return is the input; contributions are a dollar schedule (flat, or
  growing at `contributionGrowth`) for `years` years.
- **Outputs:** per year start balance, contributions, growth after fees (the reconciling item, §1.3),
  fee drag, end balance and real end balance; totals = sums of the rows, so
  `principal + totalContributions + totalGrowth = endingBalance` exactly.
- **Basis:** nominal and today's dollars; before taxes; limits not applicable.
- **Timing:** contributions mid-year (§1.5), so the closed form tested is
  `FV = PV(1+ρ)^n + PMT·(1+ρ)^½·((1+ρ)^n − 1)/ρ` with `ρ = (1+r)(1−f) − 1`, and the growing annuity
  `PMT·(1+ρ)^½·((1+ρ)^n − (1+g)^n)/(ρ − g)`.

### 12.2 401(k) contribution (`contribution401k`)
- **Inputs:** `age`, `retirementAge` (> age), `salary`, `salaryGrowth` (nominal raise), `planType`,
  `planOffersRoth` (default true), `traditionalPctOfSalary`, `rothPctOfSalary`, `match` (an
  `EmployerMatchRule`, or null), `traditionalBalance`, `rothBalance`, `annualReturn`, `inflation`,
  `priorYearFicaWages` (null = unknown).
- **Engine calls:** `previewAccumulation` (year 1: requested deferrals, pre-limit match, eligible pay
  and compensation); `resolveRules` + `capContributions` (year 1: 402(g) with the 50+ and 60–63
  catch-ups, the Roth catch-up rule, 401(a)(17), 415(c), with their warnings, §3.4); `projectHousehold`
  on a one-person household with that plan, its traditional and Roth accounts and planning age = the
  retirement age (every working year's contributions and the balances).
- **Outputs:** `yearOne` (requested amounts, pre-limit match readout, capped amounts or null, limit
  warnings); per working year salary, employee traditional/Roth, catch-up, employer match and flat,
  account balances (nominal and real); totals (employee, employer, growth, balance at the start of the
  retirement year nominal and in today's dollars, §1.1).
- **Basis:** nominal and today's dollars; before taxes; `afterLimits`, or `beforeLimits` while the
  limits are unverified (then `yearOne.capped` is null, the missing keys are listed, and the projection
  shows contributions as elected, which can overstate savings above the limits).
- **Notes:** from year 2 the Roth catch-up test uses the projected prior-year wages (§3.4), so a
  higher earner's catch-up can move to Roth after year 1.

### 12.3 Employer match optimizer (`matchOptimizer`)
- **Inputs:** `eligiblePay`, `match` (`EmployerMatchRule`), `currentDeferralRate`, `scanStep`
  (default 0.5%), `scanTo` (default 20%).
- **Engine call:** `computeMatch` at the current rate and at each grid rate `k·scanStep` up to `scanTo`
  (deferral dollars = rate × pay, whole cents).
- **Outputs:** the engine readout (`pctToCaptureFullMatch`, `dollarsToCaptureFullMatch`,
  `maxPossibleMatch`), `unclaimedAtCurrentRate` (match left on the table per year),
  `additionalDeferralNeeded` = max(0, dollars to capture − current deferral), the scan table and the
  lowest scanned rate whose match equals the possible match (a cross-check; with a dollar cap binding
  inside a tier the grid point is at or above the exact capture rate).
- **Basis:** nominal; before taxes; **before plan limits** (402(g), 401(a)(17), 415(c) are not applied;
  the 401(k) contribution calculator shows the after-limit match). Annual true-up assumed (§14).

### 12.4 Roth vs traditional (`rothVsTraditional`)
- **Inputs:** `age`, `retirementAge`, `planningAge`, `salary`, `salaryGrowth`, `deferralPct` (the same
  share of salary in both cases), returns before and in retirement, `inflation`, `currentSpending`
  (working years, today's dollars), `retirementSpending` (net need), `stateTaxRate`.
- **Engine calls:** a one-person household with a 401(k) offering Roth (traditional and Roth accounts,
  no match) and a taxable brokerage that receives the working-years surplus (`assumptions.surplus`);
  `presetScenario('G_rothStrategy')` builds the Roth twin; `compareScenarios` projects both
  (`computeDashboard`).
- **Outputs:** per side the ending balance (nominal and real), the tax-deferred part, the engine's
  `afterTaxEndingBalanceReal` (§10: real ending balance minus tax-deferred money ÷ `P_T` × the final
  year's marginal ordinary rate, the model's own rate), that marginal rate, depletion year and success;
  the Roth − traditional difference after tax and before tax (today's dollars).
- **How the tax saving enters:** the traditional case pays less tax while working, so its net pay is
  higher; the part above spending and contributions is invested in the taxable account (verified tax
  rules only, §3.8). Withdrawals in retirement are grossed up for taxes (§7.2).
- **Basis:** nominal and today's dollars; `afterTaxes` when both after-tax figures exist; while tax
  rules are unverified the after-tax figures are null and the basis is `beforeTaxes` (the twins are
  then identical before taxes: no surplus is routed and no tax is computed). Limits follow the
  projection.

### 12.5 Retirement age (`retirementAge`)
- **Inputs:** the plan fields (12.0: `age`, `planningAge`, `currentBalance`, `annualContribution`
  (today's dollars, rising with inflation, until the year before retirement), returns before and in
  retirement, `inflation`, `retirementSpending`, optional Social Security entered at the claiming age,
  `taxTreatment` (`taxDeferred` default, `taxFree`, `taxable` brokerage with `costBasis`),
  `expenseRatio`, `withdrawalTiming`, `minimumEndingBalance`), plus `fromAge`, `toAge`
  (≤ planning age, > current age).
- **Engine calls:** `optimizeRetirementAge` (deterministic criterion, a brute-force scan of every age,
  §10) on the plan household retiring at `toAge`; then `withRetirementAge` + `projectHousehold` at the
  earliest successful age (or `toAge` when none succeeds) for the outcome shown and the labels. The
  optimizer's own range checks (for example a range starting before the current age) are passed through
  as `invalid`.
- **Outputs:** `earliestAge` (null if none), every evaluated age (success, real ending balance), and the
  outcome at the shown age.
- **Basis:** today's dollars (real ending balance); tax basis from the projection.

### 12.6 Savings gap (`savingsGap`)
- **Inputs:** the plan fields, plus `maxExtraContribution` (default $1,000,000 a year). Needs at least
  one working year.
- **Engine calls:** `projectHousehold` on the plan household as entered, and inside `searchMinimum`
  over an extra annual contribution added to the entered one (both today's dollars, rising with
  inflation, until the year before retirement).
- **Search:** [$0, `maxExtraContribution`], whole cents, $1 tolerance. Higher contributions never lower
  the balance (an engine property test), so success is monotone in the extra amount. `atBound` = the
  plan already meets the criterion (extra 0); `notWithinBound` = not even the bound is enough (extra
  null).
- **Outputs:** the extra and total annual contribution, the plan's outcome as entered and with the extra.
- **Basis:** today's dollars; tax basis from the projection.

### 12.7 Inflation purchasing power (`inflationPurchasingPower`)
- **Inputs:** `amount` (today's dollars), `futureAmount` (a fixed nominal amount; default = `amount`),
  `years` (1–100), `inflation`.
- **Engine call:** `projectHousehold` on a household built only to convert dollars with the engine's
  price index `P_t` (§1.1): a retirement spending need of `amount` gives the nominal cost of today's
  amount each year (`flows.spendingNeed = amount·P_t`), and a flat nominal pension of `futureAmount`
  in payment from year 1 gives its value in today's dollars (`real.grossIncome = futureAmount/P_t`).
  The household has no accounts; its funding is irrelevant and its warnings are not reported.
- **Outputs:** per year from now (0…years) the price level, the cost of today's amount and today's value
  of the future amount; the figures `years` from now.
- **Basis:** nominal and today's dollars; taxes not applicable (`beforeTaxes`); no rule values are
  needed (empty labels). Constant inflation; closed forms tested `A(1+i)^n` and `F/(1+i)^n`.

### 12.8 Withdrawal (`withdrawal`)
- **Inputs (both modes):** `startingBalance`, `age` (default 65), `years` (the plan runs through
  age + years − 1 ≤ 120), `annualReturn`, `inflation`, `taxTreatment` (default `taxFree`), `costBasis`,
  `expenseRatio`, `withdrawalTiming`, optional Social Security at the claiming age,
  `minimumEndingBalance`.
- **Fixed percentage** (`withdrawalRate`): `projectHousehold` on a household retired from year 1 whose
  retirement spending is `rate × startingBalance` in today's dollars (so it rises with inflation, §5).
  Outputs: the initial spending, per year need (nominal and real), withdrawals, shortfall and balances,
  longevity (lasts through the horizon, or the depletion year and age, and the years fully funded),
  ending balance and success.
- **Sustainable rate** (`maxRate`, default 100%): `searchMaximum` over the initial rate in [0, `maxRate`],
  tolerance 1e-6, each step the fixed-percentage plan; the result is the highest rate meeting the
  deterministic criterion (§4.1), with the plan at that rate. `atBound` = even `maxRate` lasts;
  `notWithinBound` = not even 0% meets the criterion (for example a minimum ending balance above what
  the balance can reach).
- **Basis:** nominal and today's dollars; the spending is a net need, so the tax basis is `afterTaxes`
  when the projection computed taxes and `beforeTaxes` while tax rules are unverified (for a
  tax-deferred account that overstates longevity).
- **Closed forms tested:** with mid-year withdrawals `E_t = E_{t−1}(1+r) − W_t(1+r)^½`, the level
  ending balance `S(1+r)^n − W(1+r)^½((1+r)^n − 1)/r`, and the exhausting payment
  `W = S(1+r)^½(1 − q)/(1 − q^n)`, `q = (1+i)/(1+r)` (the payment formula `PV·r/(1 − (1+r)^{−n})` divided
  by `(1+r)^½` when i = 0); start-of-year timing gives the annuity due `S·r/((1+r)(1 − (1+r)^{−n}))`.

### 12.9 Social Security claiming comparison (`ssClaimingComparison`)
- **Inputs:** `birthYear`, `birthMonth`, `throughAge` (≥ 62, not yet passed), and either
  - mode `pia`: `piaMonthly` (the PIA from the SSA statement, today's dollars), or
  - mode `amountsAtClaimAge`: up to 12 `{claimAge, monthlyAtClaim}` options (the benefit at each claiming
    age as the statement lists it).
- **Engine calls:** PIA mode: `fullRetirementAge` and `ssBenefitAtClaim` at each whole age 62–70; any
  null rule value makes the whole result `unverified` with the missing keys (never a substituted value).
  Amounts mode needs no rule value (§7.5). In both modes the lifetime totals come from
  `projectHousehold`, one run per claiming age, of a retired single person with that Social Security
  input and inflation 0 (the COLA follows inflation, so nominal = today's dollars); a total is the sum
  of `flows.socialSecurity` from this year through `throughAge`, including the claim-year proration by
  birth month.
- **Outputs:** per option the monthly benefit, the claim factor and months from FRA (PIA mode), the first
  benefit year, the total through `throughAge`, the running total by age, and the break-even age against
  the earliest option (the first age its running total reaches the earliest's; null if never); the
  option with the highest total; FRA (PIA mode). Claiming ages before this year's age are left out.
- **Basis:** today's dollars; gross benefits (`beforeTaxes`: taxation of benefits is not part of the
  comparison). Own retirement benefit only; spousal and survivor benefits and the earnings test are out
  of scope.

### 12.10 Fee impact (`feeImpact`)
- **Inputs:** as compound interest, with a required `expenseRatio`.
- **Engine calls:** `projectHousehold` twice (the compound-interest household with f and with 0).
- **Outputs:** both totals; `lifetimeCost` = ending balance without fees − with fees (nominal and real),
  which is the fees plus the growth they would have earned; `feesCharged` = Σ yearly fee drag; per year
  both balances and the cumulative cost.
- **Basis:** nominal and today's dollars; before taxes. Closed forms tested: FV at `ρ = (1+r)(1−f) − 1`
  and at r.

### 12.11 Lump sum vs recurring (`lumpSumVsRecurring`)
- **Inputs:** `total`, `spreadYears`, `horizonYears` (≥ spreadYears), `annualReturn`, `inflation`,
  `expenseRatio`.
- **Engine calls:** `projectHousehold` twice: the total as the starting balance, and a zero balance with
  `total ÷ spreadYears` (whole cents, half to even) contributed mid-year in each of the first
  `spreadYears` years; both run to `horizonYears`.
- **Outputs:** both totals (the recurring `totalContributions` is the amount actually invested, which
  can differ from `total` by the rounding), the differences (nominal and real) and per-year balances.
- **Assumptions:** the lump is invested at the start of year 1; money waiting to be invested earns
  nothing in this comparison. Closed forms tested: `T(1+r)^H` and `P(1+r)^½((1+r)^n − 1)/r·(1+r)^{H−n}`.

### 12.12 Spending planner (`spendingPlanner`)
- **Inputs:** one or two people (`name`, `age`, `planningAge`, optional Social Security at the claiming
  age; two people file jointly), `startingBalance`, `taxTreatment`, `costBasis`, `annualReturn`,
  `expenseRatio`, `inflation`, `retirementSpending`, `steps` (by the first person's age), `realGlide`,
  `healthcareBeforeMedicare`, `survivorSpendingReduction`, `withdrawalTiming`.
- **Engine call:** `projectHousehold` on a household retired from this year with that spending plan (§5:
  steps, glide, the pre-Medicare line while a retired person is under 65, the survivor reduction from
  the first death year, §7.7).
- **Outputs:** per year ages, spending need (nominal and real), funded, shortfall, Social Security,
  withdrawals, balances and markers; longevity (lasts through the planning age, or the depletion year
  and age); the first death year; the total need.
- **Basis:** nominal and today's dollars; tax basis from the projection. Engine warnings are passed
  through (the pre-Medicare note applies to real people here).

### 12.13 Coast FIRE (`coastFire`)
- **Inputs:** the plan fields, plus `maxBalance` (default $100 million).
- **Engine calls:** `projectHousehold` with contributions stopped from today (does the plan still meet
  the criterion?), with the entered contributions (for comparison), and inside `searchMinimum` over
  today's balance with no contributions.
- **Search:** [$0, `maxBalance`], whole cents, $1 tolerance; success is monotone in the starting balance.
  `atBound` = $0 already coasts (nothing to fund beyond other income).
- **Outputs:** `coasts`, both outcomes, the coast number and the gap (coast number − today's balance,
  at least 0; null above the bound).
- **Basis:** today's dollars; tax basis from the projection. Closed form tested (zero inflation): the
  present value at retirement of the spending, `S(1+r)^{−½}(1 − (1+r)^{−N})/(1 − (1+r)^{−1})`, discounted
  `(1+r)^{−n}` to today.

### 12.14 Barista FIRE (`baristaFire`)
- **Inputs:** the plan fields, plus `partTime` (`startAge`, `endAge` exclusive, `annualIncome` in today's
  dollars) and `maxPartTimeIncome` (default $500,000).
- **Engine calls:** `projectHousehold` on the plan household with the part-time phase (§3.1: today's
  dollars rising with inflation; FICA applies when verified; no plan deferrals); in retirement the
  part-time pay is cash income that funds spending before withdrawals (§4.1, §7.1). `searchMinimum` over
  the part-time income.
- **Search:** [$0, `maxPartTimeIncome`], whole cents, $1 tolerance. `atBound` = no part-time income is
  needed.
- **Outputs:** success at the entered income, the minimum part-time income and the plan at it, and the
  total part-time pay at the entered income (gross, nominal).
- **Basis:** today's dollars; tax basis from the projection (with verified rules, payroll and income tax
  on the part-time pay raise the minimum).

### 12.15 FI number (`fiNumber`)
- **Inputs:** the drawdown fields of 12.8 without the balance, plus `annualSpending` (today's dollars, a
  net need rising with inflation), `withdrawalRate` (optional), `maxBalance` (default $100 million).
- **Choice (documented):** the FI number is computed through the withdrawal calculator's drawdown plan,
  never as a hand-coded `spending ÷ rate`:
  - `sustainable.fiNumber`: `searchMinimum` over the starting balance ([$0, `maxBalance`], $1) for the
    smallest balance whose plan spending `annualSpending` meets the deterministic criterion through the
    horizon; at that balance the withdrawal calculator's sustainable-rate search reports the initial
    rate it supports.
  - `ruleOfThumb.fiNumber` (when a rate is given): `searchMinimum` over the starting balance for the
    smallest balance whose fixed-percentage plan (`rate × balance`) has a first-year spending need (read
    from the projection) of at least `annualSpending`: the rule-of-thumb "spending ÷ rate", found
    through the engine; the same plan reports whether it lasts under the return assumption.
- **Basis:** nominal and today's dollars; tax basis from the projection.
- **Closed form tested:** the growing-annuity present value
  `S = W(1+r)^{−½}(1 − q^n)/(1 − q)`, `q = (1+i)/(1+r)`, with mid-year withdrawals.

### 12.16 Tests
Each calculator has a closed-form or engine-parity test (closed forms are computed in the tests only,
with zero-tax setups: cash, tax-free or before-tax paths), an invalid-input test and, where rules matter,
the unverified path with the bundled rules; verified paths use the SYNTHETIC fixture rules
(`testing/fixtureRules.ts`, not real values). Parity tests: 401(k) year 1 vs the projection rows,
match scan vs `computeMatch`, Roth vs traditional vs `compareScenarios`, retirement age vs a brute-force
projection of each age, SS amounts vs `ssBenefitAtClaim`, fee impact vs two compound-interest runs.

## 13. Insights [M7b]
Each insight (`computeInsights`) states its change as scenario ops (`whatIfOps`), applies them to a
copy of the plan with `applyScenario`, re-runs `projectHousehold`, and reports the baseline, the
what-if and the difference in today's dollars, in descriptive language ("In this model, …"). Every
insight lists its assumptions, plus "before plan limits" / "before taxes" when those rules are
unverified. An insight that does not apply is left out.

| Insight | What-if | Figure |
|---|---|---|
| Retiring two years later | every person not yet retired: retirement age + 2 (capped at the planning age) | real ending balance; longevity |
| Capturing the full match | each plan's salary deferral raised to the sum of its match tiers' bands (only when below it) | savings at retirement (real end of the year before the first retirement year) |
| Lifetime cost of fees | every expense ratio set to 0 (only when some are above 0) | real ending balance |
| Inflation one point higher | `inflation + 0.01` | real ending balance |
| Retirement spending 10% lower | preset F's ops with a 10% cut | real ending balance; longevity |
| Returns one point lower | every return source (phase returns, capital-market geometric returns, account expected returns) − 0.01 | real ending balance; longevity (tone "attention" when either run depletes) |
| Claiming Social Security one year later | each claiming age + 1 year (whole years, up to 70) when the plan has Social Security income | lifetime Social Security income, Σ flows.socialSecurity / P_t |
| Savings needed for the goal | only when the deterministic criterion fails: a new cash account with an annual contribution X; bisection on X in [0, $500,000] to the nearest $100 | the smallest X found that meets the criterion (or "not within $500,000") |

Tests: a spy confirms the projection runs once for the baseline and at least once per insight, and
re-applying each insight's own ops reproduces its figure exactly.

## 14. Unsupported / simplified (master list)
- Other filing statuses; unmarried couples.
- Spousal IRA; backdoor Roth; Roth conversions (roadmap); deductible traditional IRA.
- 457(b) special catch-up.
- Earnings test (warning only).
- AMT, NIIT, IRMAA, itemized deductions, credits, Additional Medicare tax.
- State-specific rules (flat rate only).
- SS death benefit; survivor early-claim reduction; beneficiary RMD rules; life insurance; estate
  tax.
- Long-term care; healthcare beyond the user line item.
- Glide paths; fat tails.
- Early-withdrawal penalties (flag only).
- Plan-specific match true-ups (annual model assumes a true-up).
- HSA: when both spouses have family-coverage HSAs, each spouse's family limit is applied to that
  spouse's HSAs separately rather than split between them (simplification). One person's own HSAs
  share one limit.
- 457(b) and 401(k)/403(b) catch-ups are not coordinated across plans (a 457(b) has its own limit and
  catch-up).
- 415(c) compensation is this employer's salary + bonus, not the plan's own definition.
- Retirement spending starts at the retirement age, even when a person's salary stops earlier
  (`employment.stopAge`).
- Statutory ages (catch-up at 50 and 60–63, HSA catch-up at 55, the additional deduction at 65) are
  constants in the engine, not rule values; moving them into the rules data is planned with M4.
