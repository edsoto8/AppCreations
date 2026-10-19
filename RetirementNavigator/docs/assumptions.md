# Assumptions (Phase 0 draft)

These defaults are **assumptions**, not forecasts or recommendations. Each one is editable in the app
and labeled wherever a result depends on it. Regulatory values are not listed here; they live in the
sourced rules files (see `docs/rules-verification.md` and the in-app Rules & Sources page).

Results are model-dependent educational estimates, not guarantees, tax advice, or investment
recommendations.

## Economic defaults
| Assumption | Default | Rationale |
|---|---|---|
| Inflation | 2.5% / yr | A round number slightly above a 2% price-stability target, to leave room for higher inflation. Illustrative, not a forecast. |
| Return before retirement (blended fallback, geometric) | 6.0% nominal | An illustrative round number for a diversified portfolio. Used only when an account has neither an expected return nor an allocation. |
| Return in retirement (blended fallback, geometric) | 5.0% nominal | Illustrates a more conservative mix in retirement. Same caveat. |
| Optimistic / pessimistic offsets | +2 / −2 percentage points | Fixed offsets to show sensitivity. **Not confidence intervals.** |
| Withdrawal timing | mid-year (conservative option: start of year) | Brief default. |
| Raises | 3.0% nominal (or inflation + X% real) | Illustrative default for new profiles. |
| Social Security COLA | equals inflation | Keeps benefits level in real terms; editable. |
| Indexing of `indexed` rules beyond published years | equals inflation | Brief default; labeled "projected" wherever used. |
| Post-sunset law | as written | Brief default. |
| Survivor spending reduction | 20% | Brief default. |
| Pension survivor continuation | 100% | Brief default, per pension. |
| Taxable-account tax drag | 0 percentage points | Brief default. |
| State income tax | flat effective rate, default 0% | The only state modeling. |
| Minimum ending balance (success criterion) | $0 (today's dollars) | User-set. |
| HSA qualified medical expenses | $0 / yr | Brief default. |
| Pre-Medicare healthcare line item | $0 / yr | User-entered only. Early-retirement scenarios carry a persistent note. |
| Planning age | 100 | Brief default. |

## Capital-market assumptions (editable defaults for Monte Carlo and allocation-implied returns)
| Asset class | Geometric return | Volatility (log) | Implied arithmetic mean |
|---|---|---|---|
| Stocks | 7.0% | 16% | ≈ 8.4% |
| Bonds | 4.5% | 6% | ≈ 4.7% |
| Cash | 3.0% | 1% | ≈ 3.0% |

Correlations (stocks/bonds/cash): stocks–bonds 0.10, stocks–cash 0.00, bonds–cash 0.20. Blended
fallback volatility: 12%.

**Rationale:** these are round illustrative numbers chosen to be broadly plausible for a long horizon,
with equities riskier and more rewarding than bonds and cash. They come from no particular
published forecast, and the app says so beside every Monte Carlo result. Implied arithmetic mean =
`(1+g)·e^{σ²/2} − 1`.

Stochastic inflation (optional): median 2.5%, volatility 1.5%, correlations with assets 0 by default.

## Readiness heuristic thresholds (labeled heuristic)
- Deterministic: On track = baseline and pessimistic both succeed; Borderline = baseline only;
  At risk = baseline fails.
- Monte Carlo (from M6): ≥ 85% / 70–85% / < 70%.

## Simplifications (summary; full list in financial-model.md §14)
- Annual model. Contributions are mid-year. Year 1 is not prorated.
- Age = calendar year − birth year. Retirement starts January 1 of the retirement-age year.
- Survivor model: higher-of SS benefit, single filing from the year after death, spending cut,
  pension continuation, full account transfer, and no estate tax.
- MAGI for the Roth eligibility check = salary + bonus − traditional deferrals − HSA (overridable).
- State tax = flat rate × federal AGI.
- The vesting fraction applies to the whole employer sub-ledger at separation.
- An infeasible savings plan is flagged but still modeled as carried out.
- Forecast while rules are unverified (owner decision 2026-10-19): contributions are as elected,
  before plan limits, and retirement income is before taxes. Both are labeled in the UI.
- Retirement phase in M3:
  - spending is funded by withdrawals in the chosen order, before taxes;
  - Social Security, pensions, one-time events, RMDs, spending steps, the glide, healthcare and the
    survivor reduction are added in M4, and the app lists them as not yet modeled;
  - extra cash income in retirement is assumed spent;
  - retirement-year contributions come only from income left after spending.
- The household phase (not each person's) picks the pre- or post-retirement fallback return.
- Taxable basis falls pro rata to the share of the year's available balance withdrawn.

## Data and privacy
Everything stays on this device in IndexedDB, **unencrypted**. Nothing is sent over the network: no
analytics, telemetry or remote fonts.
