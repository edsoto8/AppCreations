---
name: financial-calculation-validation
description: Validate a Retirement Navigator engine calculation (income, match, limits, tax, Social Security, RMD, withdrawals, projection, Monte Carlo) against docs/financial-model.md, sourced rules and independent golden values. Use when adding or changing any engine formula or before tagging a milestone.
---
# Financial calculation validation

Run from `RetirementNavigator/`.

## Checklist
1. Find the formula's section in `docs/financial-model.md`. If it is missing or vague, write it there first.
2. Confirm every regulatory input comes from a `Verified<T>` rule (`packages/engine/src/rules/`), never a
   literal. A null rule must produce `{status:'unverified'}`, never a default. Add a test for that path.
3. Golden values must be independent of the engine:
   - closed forms (FV, growing annuity, payment) computed by hand in the test;
   - IRS/SSA worked examples (cite publication and example number in the test name);
   - `python3 packages/engine/reference/ref.py` fixtures.
4. Units: cents at boundaries, round-half-even once per row, rates as decimals, nominal vs real explicit.
5. Edge cases: zero, negative, boundary below/at/above (ages 50, 59½, 60–63, 65, RMD age; phase-out
   start/mid/end; tier bands; compensation limit).
6. Invariants as fast-check properties: reconciliation (exact/±1 cent), non-negative balances and
   taxes, monotonic contributions, conservative ≤ default only if all returns ≥ 0.
7. Run `pnpm --filter @rn/engine test -- --coverage`; module coverage ≥ 90% lines and branches.
8. Record any simplification in code (`// SIMPLIFICATION:`), financial-model.md §14 and the UI label.

## References
- Spec: `docs/financial-model.md`; assumptions: `docs/assumptions.md`
- Contracts: `packages/engine/src/domain/*`, `packages/engine/src/api.ts`
- Rules verification log: `docs/rules-verification.md`
