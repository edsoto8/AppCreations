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
  the ±1 cent the brief requires. A test also asserts `|growthNet − round(growthNet_float)| ≤ 2`
  cents, so the reconciling item cannot hide an error. `feeDrag = round(fee_float)` and
  `growthGross = growthNet + feeDrag`.
- Year t+1 `start` equals year t `end` in cents (the float64 balance carries forward unrounded).
- **Contribution amounts are whole cents.** They are payment amounts, and the limit functions work
  in cents. This covers each plan's traditional and Roth deferrals, the match (computed on eligible
  pay and total deferral in cents), the flat employer contribution, each scheduled amount (including
  the retirement-phase scale-down), and a routed surplus. They are rounded once, when determined.
  Balances, growth and withdrawals stay float64.
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
  the start of year `Dp = birthYear + planningAge + 1`. The household runs through
  `max_p(birthYear_p + planningAge_p)`. "First death year" = `min_p Dp` when that falls within the
  horizon.
- Already-retired user: if `retirementAge ≤ age(Y_1)`, the person is retired from year 1.
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
- If every annual **net** rate ρ (after fees and drag) is ≥ 0, then `E_conservative ≤ E_default`
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
- **Vesting and forfeiture:** employer money also accrues in an unvested sub-ledger of the match
  destination account, `u' = u·g_S + employer·g_C`, starting from `unvestedEmployerBalance`.
  - Separation is the start of the first projection year in which the owner has no salary
    (including year 1).
  - Years of service at separation = `yearsOfServiceAtStart` + projection years worked.
  - The forfeiture is `F = min(balance, u·(1 − v(years of service)))`, taken at the start of that
    year before growth. It is included in the account's `withdrawals` and shown in `forfeited` and
    `flows.forfeited`. Household `flows.withdrawals` counts spending withdrawals only.
- Tax treatment for allocation view (b): tax-deferred = workplace traditional, traditional IRA,
  "other" tax-deferred; tax-free = workplace Roth, Roth IRA, HSA, "other" tax-free; taxable =
  taxable brokerage, cash, "other" taxable. HSA is shown as tax-free (qualified medical use).

### 4.1 Retirement-phase cash flow (M3: simple withdrawals, before taxes)
For each retirement-phase year:
1. `need = retirementAnnualSpending · P_t`.
2. Cash income `I = earned (part-time) + other income`, before taxes.
3. Scheduled contributions are funded only from `max(0, I − need)`, and are scaled down if that is
   smaller (warning `retirementContributionsReduced`).
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
- Retirement years:
  - `spend_t = S_step(age_primary) · (1+glide)^{t − t_R} · P_t`, where `S_step` is the
    retirement spending or the latest step whose `fromAge ≤ age`, and `t_R` is the first retirement
    year;
  - plus `healthcareBeforeMedicare · P_t` while any living retired person is under 65;
  - times `(1 − survivorReduction)` from the first death year onward.
- One-time outflows add to the need in their year; inflows go to the destination account.

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
- Taxable SS (Pub 915):
  - `PI = otherIncome + taxExempt + ½·SS`.
  - If PI ≤ base, taxable SS is 0.
  - If base < PI ≤ adjusted, it is `min(½(PI − base), ½SS)`.
  - Above adjusted, it is `min(0.85·SS, 0.85·(PI − adjusted) + min(½(adjusted − base), ½SS))`.
- FICA: the OASDI rate on each person's wages up to the wage base, plus the Medicare rate on all
  wages (rates and wage base are rule values). Additional Medicare tax is unsupported.
- State tax = flat rate × federal AGI (simplification).
- Taxes are never negative; a property test checks this.
- Filing status is MFJ through the first death year and single from the following year.
- **Unsupported:** AMT, NIIT, IRMAA, itemized deductions, credits, state-specific rules, and
  early-withdrawal penalties beyond a flag and a warning.

## 7. Retirement income [M4]

### 7.1 Order of operations each retirement-phase year
1. Fixed income: SS, pensions, other income, one-time inflows.
2. RMDs, taken from each traditional account where `age ≥ rmdStartAge`:
   `RMD = priorYearEnd / period(age)`.
3. HSA qualified withdrawals up to the qualified medical expenses (tax-free).
4. The gross-up solver funds the remaining net need using the withdrawal strategy.
5. Excess RMD after tax is reinvested in the taxable account (or cash if there is none).

### 7.2 Gross-up solver
- Find gross withdrawals `W` so that `fixed + W − tax(W) = need` within tolerance.
- Iteration:
  - start at `W_0 = max(0, need − fixedNet)`;
  - each step computes `W_{k+1} = max(0, need + tax(W_k) − fixed)` and allocates it by strategy;
  - stop when `|W_{k+1} − W_k| ≤ $1`, or after N iterations (default 50).
- It converges because the effective marginal rate (federal, SS inclusion and state combined) is
  below 1, which makes the map a contraction.
- Non-convergence returns the last iterate with `converged:false` and a warning. Tests cover both
  outcomes.
- Depletion: if balances can't fund the need, `unfunded > 0`, `depleted = true`, and balances are
  floored at 0 (never negative).

### 7.3 Withdrawal strategies
| Strategy | Order |
|---|---|
| taxableFirst | cash → taxable → traditional → Roth → HSA (non-medical) |
| traditionalFirst | traditional → cash → taxable → Roth → HSA |
| rothLast | cash, taxable and traditional pro rata by available balance → HSA → Roth |
| proportional | all accounts pro rata by available balance |

"Available balance" is each account's withdrawal cap for the year (§1.5).
| bracketFill | traditional up to the top of the target bracket's taxable income → cash → taxable → Roth → HSA |

### 7.4 Roth and HSA withdrawals
- Roth IRA: qualified from the year the owner reaches 59½ (calendar year `birthYear + 59` if
  `birthMonth ≤ 6`, else `+60`) **and** at least 5 tax years after the first contribution year
  (verified rules). Before that, basis comes out first untaxed, and earnings are flagged with a
  warning (simplified; no penalty is modeled).
- There are no Roth IRA owner RMDs. Roth 401(k) lifetime RMDs follow the verified rule.
- HSA: qualified medical withdrawals are tax-free; non-medical withdrawals after 65 are ordinary
  income; non-medical withdrawals before 65 are flagged as penalized (simplified).

### 7.5 Social Security
- Claim factor, with `m = FRA_months − claim_months`:
  - if m > 0: `1 − (5/9%·min(m,36) + 5/12%·max(0, m−36))`;
  - if m < 0: `1 + 2/3%·min(−m, months to 70)`.
  - All constants come from verified standing rules.
- Benefits begin in the claim year, and the first year is prorated by the months of entitlement
  (birth month + claim months).
- Statement PIA is in today's dollars; the nominal benefit is `PIA·f·12·Π(1+COLA)` from year 1 to t.
  The COLA is an assumption (default: inflation).
- **Spousal:** the excess is `max(0, share·PIA_other − PIA_own)`, reduced by the spousal early-claim
  factors, and is payable from the year both have claimed.
- **Survivor (simple model):**
  - from the first death year, the survivor receives `max(own, deceased's claimed-age benefit
    including DRCs)`, floored at the RIB-LIM share of the deceased's PIA if verified, and the lower
    benefit ends;
  - if the deceased had not yet claimed, their benefit is computed as if claimed at the death age;
  - the survivor's own early-claim survivor reduction is **not** modeled (simplification).
- Earnings test: unsupported. A warning is shown when someone claims before FRA while still earning.
- Benefit-reduction scenario: an optional user cut from a year onward (labeled as an assumption).
- WEP/GPO: applied only per their verified current status (the candidate source says repealed).
- **Illustrative estimator (not an official SSA calculation):**
  - from history: wage-index each year with AWI to eligibility year − 2, take the top 35 years,
    `AIME = Σ/420`, and compute `PIA = 0.9·min(AIME,b1) + 0.32·clip(AIME−b1, 0, b2−b1) +
    0.15·max(0, AIME−b2)`, truncated to the dime;
  - average mode: `AIME = avg·min(years,35)/35/12`, using the current year's bend points in today's
    dollars;
  - entered history is assumed already capped at each year's taxable maximum (labeled).

### 7.6 Pensions and other income
- Annuity from the start age: amount in today's dollars or nominal at start, then COLA. The taxable
  share is per the input.
- A lump sum is paid at the start age into the destination account and taxed per the account type
  (rollover assumed).
- Survivor continuation is `survivorFraction` of the annuity after the owner's death.

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
| Portfolio longevity | depletion age, or "lasts through planning age" | — | — | — |
| Readiness | heuristic, below | — | — | — |

Readiness (a labeled heuristic):
- **On track**: baseline and pessimistic deterministic runs both succeed.
- **Borderline**: the baseline succeeds but the pessimistic run fails.
- **At risk**: the baseline fails.
- From M6, Monte Carlo success ≥ 85% / 70–85% / < 70% is shown alongside, with its assumptions.

- "First retirement year" is the first year in which every living person is retired; for an
  already-retired household it is year 1.
- Real values divide by that year's deflator `P_t`. Monthly figures are the annual cents ÷ 12,
  rounded half to even.
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
- Diff ops `set | unset | add`, keyed by `(collection, id)`, are applied in order to a deep copy of the
  base. The result is re-validated with the household schema.
- An op whose id is missing from the base is `orphaned` and skipped. Because a scenario stores only
  ops, edits to the base flow through.
- Presets:
  - A: no ops.
  - B: every retirement age −5 (not below the current age).
  - C: workplace deferral +5 points and IRAs at `maxAllowed`.
  - D: `marketShock` with a severity of −30% (by default in the first retirement year), configurable.
  - E: retirement age +3 (3–5).
  - F: spending −10%.
  - G: all deferrals moved to Roth where offered. Outcomes are compared after tax; the documented
    marginal-rate assumption is the model's own computed tax, and ending traditional balances are
    shown after an assumed liquidation tax at the final year's marginal rate.
- Optimizer: the earliest age in a range for which the criterion holds. It is checked against brute
  force.

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
- Each path reuses the projection core (withdrawals, gross-up and taxes) through
  `ProjectionOptions.returnOverride` / `inflationOverride`. Any performance simplification will be
  listed here.
- Success: no depletion before planning age and ending real balance ≥ minimum.
- Model limits: no fat tails, no mean reversion, no regime changes; returns are independent across
  years.

## 12. Calculators [M7a]
Each calculator is a thin wrapper that builds an engine input and calls engine functions; none has
formulas of its own.

| Calculator | Engine call |
|---|---|
| Compound interest | single taxable account projection |
| 401(k) contribution | `capContributions` + projection |
| Employer match optimizer | `computeMatch` readout |
| Roth vs traditional | twin projections, after-tax compare |
| Retirement age | `optimizeRetirementAge` |
| Savings gap | solve for the extra contribution meeting the success criterion (bisection over projection) |
| Inflation purchasing power | deflator |
| Withdrawal (fixed % and sustainable rate) | projection with spending = rate × balance / bisection |
| SS claiming comparison | `ssBenefitAtClaim` at 62–70 plus cumulative totals |
| Fee impact | twin projections with f vs 0 |
| Lump sum vs recurring | twin projections |
| Spending planner | spending steps |
| Coast FIRE | contributions stop now; success? |
| Barista FIRE | part-time phase |
| FI number | `spending / withdrawal rate` via the withdrawal calculator |

Closed forms used in the tests:
- future value: `FV = PV(1+r)^n + PMT·((1+r)^n − 1)/r`
- growing annuity: `PMT·((1+r)^n − (1+g)^n)/(r − g)`
- payment: `PMT = PV·r/(1 − (1+r)^{−n})`

## 13. Insights [M7b]
Each insight re-runs `projectHousehold` with a what-if set of scenario ops and reports the delta in
descriptive language ("In this model, …"), with its assumptions disclosed.

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
