---
name: forecast-scenario-testing
description: Test Retirement Navigator forecasts and scenarios end to end — projection rows, reconciliation, survivor orderings, scenario diffs (orphaned ops, base edits flow through), presets A–G, the retirement-age optimizer and Monte Carlo determinism. Use when changing projection, scenario or Monte Carlo code.
---
# Forecast and scenario testing

## Checklist
1. Build households with the shared fixtures/builders in `packages/engine/src/testing/` (sample
   profiles: early-career, mid-career couple, near-retirement, high-earner).
2. Projection: rows cover year 1 to the longer-lived planning age; each row reconciles per account;
   markers (retirement, first death, depletion) land in the right year per the age rule.
3. Survivor: equal ages, unequal ages, higher earner dies first, lower earner dies first, same-year deaths.
4. Scenario diffs: set/unset/add per id; op on a deleted base entity is reported orphaned and skipped;
   editing the base changes scenario results; result revalidates against the schema.
5. Presets A–G produce the documented ops; D (market shock) is deterministic and reproducible.
6. Optimizer: compare with brute force over the whole age range.
7. Monte Carlo: same seed ⇒ identical results; quick run equals the first 1,000 paths of the full run;
   chunking/worker count does not change results; σ = 0 median equals the deterministic baseline.
8. Unverified rules: projection lists `excludedFeatures`; dependent outputs are flagged.

## References
- `docs/financial-model.md` §§1, 7, 10, 11; `docs/testing-strategy.md`
