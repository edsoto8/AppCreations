# How LoanPilot calculates

All money is `decimal`. Every posted amount (interest charge, payment, balance) is rounded to the cent
with **round half away from zero**; accruals between postings stay unrounded until they post. The
engine (`backend/src/LoanPilot.Core/Engine`) is the single source of truth — the web UI, exports and
insights all show its output.

## Inputs and the APR

The APR is treated as a **nominal annual rate**. The periodic rate is `APR ÷ 100 ÷ periods per year`
(12 monthly, 26 biweekly, 52 weekly). A term in months converts to payments as `months × periods ÷ 12`,
rounded.

**Standard payment** (used when you leave the payment blank):
`P = L · i / (1 − (1 + i)^−n)`, or `L ÷ n` at 0 % APR, rounded to the cent. `(1 + i)^n` is computed
exactly by repeated squaring. Because the payment is rounded, the last payment absorbs the difference.

## Accrual methods

| | Monthly (periodic) | Daily simple interest |
|---|---|---|
| Interest per period | `balance × APR ÷ periods per year` | `balance × APR × days ÷ day basis` |
| Depends on days in period | No — February costs the same as March | Yes — longer periods cost more |
| First period | Always one period of interest | Actual days from the loan start date |
| Paying early in a period | No effect | Saves interest for the days the principal is gone |
| Typical use | Amortization tables, many bank loans | Most US auto lenders ("simple interest loans") |

Day-count basis (daily method only):

- **Actual/365** — every day is 1/365 of a year, also in leap years (a 366-day leap year costs one day
  more than the nominal APR). This is the common US auto-loan convention and the default.
- **Actual/Actual** — each day is 1/365 or 1/366 of a year according to its own calendar year; a period
  that crosses New Year is split at the boundary.

## Payment dates

Monthly due dates keep the first payment's day of month and are computed from that anchor each time
(never chained), so `Jan 31 → Feb 28/29 → Mar 31 → Apr 30`. A Feb 29 first payment falls on Feb 28 in
common years. Biweekly and weekly dates step 14 or 7 days from the first payment.

## Payment allocation rules

1. A payment pays **interest owed first** — carried unpaid interest, then this period's interest — and
   the rest reduces **principal**.
2. **Extra amounts** (recurring extras, a budget surplus, lump sums credited to that payment) are added
   to the payment and, after interest, go to principal.
3. **Extra payments never reduce or skip later scheduled payments.** The regular payment stays the
   same; the loan simply ends sooner with a smaller final payment. (Some lenders "advance the due
   date" instead; LoanPilot does not assume that.)
4. **Lump sums are principal-only.** Under daily accrual a lump sum dated between due dates posts on its
   own date and stops interest on that principal from that day; interest accrued until then is paid
   with the next regular payment. Under monthly accrual a lump sum is credited with the first payment
   due on or after its date (it reduces interest from the following period on).
5. **Interest is never compounded.** If a payment does not cover the interest charged, the shortfall is
   carried as unpaid interest (shown in the schedule) and paid before any principal. The balance cannot
   go negative and no payment exceeds what is owed.
6. **Final payment** = remaining principal + interest, which is usually smaller than the regular
   payment. At the contract's final payment, a residual smaller than one regular payment is folded
   into it (the final payment adjustment lenders make); a larger shortfall is not folded in —
   payments continue past maturity and a warning explains why.

## Existing loans

- **Balance entered:** the projection starts from the balance and its as-of date. The as-of balance is
  assumed to include all payments due on or before that date; daily interest accrues from that date.
  History is **not reconstructed**: interest paid to date is shown only if you enter it or record
  payments with an interest split. Otherwise it is "unknown" and lifetime cost is not shown.
- **No balance entered:** the balance is **estimated** from the original schedule, assuming every
  payment so far was made on time with no extras (or the number of payments you entered). Every
  figure derived from that estimate is labelled *Estimated*.
- A balance older than 45 days is flagged as stale.

## Payoff estimate vs. lender payoff quote

The dashboard's "estimated payoff today" is principal plus interest accrued since the last payment
(daily Actual/365 for monthly-accrual loans), assuming scheduled payments up to today were made. It
is **not** an official payoff quote: lenders add per-diem interest up to the day funds post, and may
include fees. Always ask your lender for a payoff quote before paying off a loan.

## Simulator, solvers and comparison

- **Simulation** runs the same engine with the scenario's extras and compares it with the baseline:
  interest saved, payments saved, **months saved** (calendar months between payoff dates) and the
  percentage reduction in remaining interest.
- **Target payoff date:** a binary search over the regular payment, to the cent, using the real
  engine — so the answer respects accrual method, day counts and dates. The result is the *smallest*
  payment that finishes on or before the target (one cent less misses it).
- **Budget payoff:** you pay the budget every period; the surplus over the scheduled payment is extra
  principal. Budgets below the scheduled payment are rejected (that would be a missed payment).
- **Comparison "best" picks:** fastest payoff (earliest payoff date), lowest remaining interest, lowest
  recurring payment (among strategies that save interest, the one with the smallest regular outlay —
  lump-sum-only strategies count as the scheduled payment), and best within budget (lowest interest
  among strategies whose highest regular payment fits the budget; lump sums are not counted against a
  monthly budget).

## Refinance

The new loan starts from the same position as the baseline (same principal and unpaid interest, same
first due date), at the new APR and term, with fees either paid upfront or financed into the principal.
**Lifetime savings** = remaining cost of keeping the loan − (refinanced payments + upfront fees).
**Break-even** compares your position month by month — everything paid so far (plus upfront fees)
plus what is still owed — and is the first month from which refinancing is never more expensive.

## Insights

Insights are rules evaluated on your numbers: repayment progress, projected payoff, a suggested extra
payment (the round amount closest to 10 % of your payment), a larger extra as a percentage of remaining
interest, a lump sum of about 10 % of the balance, where your next payment goes, daily interest cost,
paying off today, sensitivity to a 1-point lower APR, vehicle equity and your best saved scenario. Each
one runs the engine and states its inputs and method in "How this was calculated".

## Disclaimer

LoanPilot's figures are estimates for planning. Lender rules, fees, payment posting dates, grace
periods and contract terms can change the actual payoff amount and date.
