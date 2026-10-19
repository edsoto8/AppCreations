# Testing Strategy (Phase 0 draft)

## Layers
| Layer | Tool | Scope |
|---|---|---|
| Engine unit | Vitest | every module and formula; required edge cases (brief §6) |
| Engine property | fast-check | reconciliation (10,000 runs), balances never negative, taxes never negative, monotonic contributions, conservative ≤ default when returns ≥ 0 |
| Golden | Vitest + Python | fixtures from `packages/engine/reference/ref.py`; closed forms; IRS/SSA worked examples; one pinned fixture year |
| Rules integrity | Vitest | every non-null value has a source; every null has `unverifiedReason`; each year file has every required key; source domains allowed |
| Boundary | Vitest | engine sources contain no React/DOM/idb imports |
| UI | React Testing Library | key flows: forms, validation messages, live readouts, toggles |
| E2E | Playwright (against `vite preview`) | onboarding, profile, income/match, accounts, forecast, scenarios, Monte Carlo, export/import round trip, theme, mobile viewport, print |
| Accessibility | @axe-core/playwright | every main page, both themes; keyboard navigation of controls and chart tables |
| M2 flows | Playwright | onboarding (blank and sample), reload persistence, income/match live readout, profile validation, axe on every M2 page in both themes, no horizontal overflow at phone width |
| Privacy | Playwright | no outbound requests other than same-origin app assets during a full flow; CSP meta present in the build |
| Visual | Playwright screenshots, read back as images | layouts, themes, print view |
| Performance | committed `bench/` script | MC 10k paths × 60 years; dashboard recalc; container hardware and emulated phone throttling stated |

## Pinned synthetic fixture year
Real rule values are all unverified right now, so engine mechanics (limits, phase-outs, tax,
preview) are tested against `packages/engine/src/testing/fixtureRules.ts`. That file holds
round-number values that are clearly labeled synthetic and are never used by the app. Each value is
chosen to differ from current law (for example spousal 45%, survivor 95%, PIA factors
0.85/0.3/0.2, RMD start ages 71/74, Roth qualifying age 59y4m with a 4-year rule, FICA 6%/1.5%,
capital-gains rates 0/10/25%, benefit-taxation shares 40%/80%), so a fixture number can never be
mistaken for a sourced one and a formula that hard-codes a real constant instead of reading the rule
fails the tests. Changing the fixture once caught exactly that: the provisional-income share of
benefits was written as ½ in the engine instead of read from the rules. The fixture's FRA table
(66 before 1950, 67 after) keeps whole-year ages for hand-computed tests; its cohort boundaries
are not the real schedule. Tests
against the real `RULES` assert the `unverified` path. A few web tests
(`*.verified.test.tsx`) mock the engine context with the fixture (test-only subpath
`@rn/engine/testing`, which ESLint bans in app code) to check that pages render the engine's own
after-limit figures. Once values are verified, the IRS worked
examples (Pub 590-A phase-out, Pub 915) are added against the real data.

## Projection validation (M3)
- **Golden fixtures:** `packages/engine/reference/ref.py` is an independent Python 3 (stdlib)
  reference, written from this document by a QA pass that did not read the engine source.
  - 16 fixtures in `reference/fixtures/` cover zero/high/negative inflation, negative returns and
    shocks, couples with first death, already-retired and retire-at-planning-age households,
    depletion, zero balances, bonus edge cases, raise overrides, tiered match with escalation and a
    cap, cliff and graded vesting, all five withdrawal strategies, monthly and start-of-year timing,
    fees and drag.
  - `src/projection/golden.test.ts` compares every figure within 1 cent; the engine currently matches
    every figure exactly.
  - `pnpm reference` (`ref.py --check`, part of `pnpm verify`) recomputes the fixtures and fails on
    any change.
  - 19 fixtures, including part-time pay and owned income stopping at death, a salary stop age after
    the retirement age, and graded-vesting forfeiture with start-of-year timing.
  - **Not covered by the reference** (engine unit tests against the synthetic fixture rules only):
    - the verified-rules path (limits applied, taxes, net pay, surplus routing, the tax-based
      infeasible flag);
    - "other" accounts.
    The reference would need its own fixture-rules support; planned with the M4 tax model.
- **Closed forms:** zero return (exact), FV of mid-year contributions, level and growing annuities,
  annuity due, and monthly annuity tables (`project.test.ts`, `golden.test.ts`).
- **Properties** (`projection.property.test.ts`, fixed seeds):
  - reconciliation and carry-forward plus an **independent recomputation** of every year-end balance
    and fee drag from the §1.5 factors (within 3 cents), 10,000 runs (mutation-checked);
  - no negative figures through depletion;
  - start-of-year ≤ mid-year when every net rate ρ ≥ 0;
  - more contributions never lower the balance at retirement;
  - optimistic ≥ baseline ≥ pessimistic when nothing depletes.
- **Benchmark:** `pnpm bench` times `computeDashboard` per sample profile and writes
  `packages/engine/bench/results/dashboard.json` with the hardware.

## Rules in tests
Tests read limits from the rules files, never from literals. The one exception is a pinned fixture
year used for the golden tests.

## Coverage
Engine ≥ 90% of lines and branches, enforced by the Vitest coverage thresholds in `pnpm verify`.

## Independent validation (M8)
A fresh-context `qa-engineer` sub-agent reads only `docs/financial-model.md` and the tests (not the
engine source), recomputes the cases independently, and files `docs/validation-report.md`.

## `pnpm verify`
typecheck → lint → test (with coverage) → build → preview smoke (Playwright) — all green before any
milestone tag.
