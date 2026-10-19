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
round-number values that are clearly labeled synthetic and are never used by the app. Tests
against the real `RULES` assert the `unverified` path. Once values are verified, the IRS worked
examples (Pub 590-A phase-out, Pub 915) are added against the real data.

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
