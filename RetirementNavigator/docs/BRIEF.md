# Retirement Navigator: Build Brief for Claude Code (v2, reviewed)

## 0. How to use this brief

You are building **Retirement Navigator**, a local-first retirement planning and forecasting web app. It is a serious financial modeling tool, not a compound-interest toy. Act as software architect, financial modeling engineer, full-stack developer, UX designer, and QA engineer.

**First action:** save this brief verbatim as `docs/BRIEF.md` and reference it from `CLAUDE.md`. If the directory is not a git repository, run `git init` (greenfield project). Use the system date as "today"; do not assume a date from this text.

**Work in this order:**
1. **Plan mode (read-only).** Inspect the repo and present a short plan: architecture, milestone gates, parallelization map, the list of rule values needed (section 4), and the feature-to-milestone traceability table (section 11). Wait for my approval.
2. **Phase 0 files.** After approval, write the Phase 0 files (section 3): domain schemas, doc drafts, frozen engine signatures. **Stop for a second approval** of the frozen contracts before any milestone code.
3. **Milestones.** Build milestone by milestone (section 11) without confirmation on minor tasks.

**Stop-and-ask rule (single source of truth):**
- Stop and ask only for a **decision that needs my input**: a default in this brief that conflicts with correctness, or a scope choice this brief does not settle.
- **Never stop for an unverifiable rule value.** Set it to `null` with an `unverifiedReason`, disable the dependent feature in the UI with an "unverified" label, log it in `docs/STATUS.md`, and continue (section 4).

**Context management:** work may span many sessions. At the end of every milestone: update `docs/STATUS.md` (including a **Handoff** section: next steps, frozen contracts, open risks), commit with a tag (`m1-foundation`, and so on), then continue in a fresh context. At the start of each fresh context, read `docs/BRIEF.md`, `CLAUDE.md`, and `docs/STATUS.md`. Keep `CLAUDE.md` short (commands, conventions, boundaries).

---

## 1. Product goals and non-goals

**Goal:** help individuals and couples estimate retirement savings, forecast wealth, compare strategies, and understand risk, using transparent, documented assumptions.

**Non-goals (MVP):** authentication, backend, paid APIs, telemetry, brokerage/bank linking, personalized investment advice, full tax-return accuracy, state-by-state tax precision, long-term-care and healthcare-cost modeling beyond a simple user-entered line item, estate planning.

**Required disclaimers (in UI, printable summary, and docs):** results are model-dependent educational estimates, not guarantees, tax advice, or investment recommendations. Taxes are simplified estimates. Early-retirement scenarios carry a persistent note that healthcare costs before Medicare are user-entered only.

---

## 2. Decisions already made

### Defaults (use these; do not ask)
- **Stack:** React + TypeScript (strict) + Vite, Tailwind CSS, shadcn/ui, Recharts, Lucide, React Hook Form + Zod, Zustand, IndexedDB (via the `idb` package), Vitest, React Testing Library, Playwright, fast-check. Before installing, check current stable versions on the package registry and pin them, and check library compatibility (for example the Zod major version with the React Hook Form resolver, Tailwind with shadcn/ui). Do not assume versions from memory.
- **Package manager and layout:** pnpm workspace with `packages/engine` (pure TS calculation library, zero React/DOM imports, enforced by lint rule or tsconfig) and `apps/web`. `pnpm dev` at the root starts `apps/web`.
- **Money representation:** integer cents at all public engine API boundaries, storage, and exports. Internal projection math uses float64, converted to cents once on output with a documented rounding policy. Monte Carlo uses float64. Never use `toFixed` for logic.
- **Rates:** decimals (0.07, not 7). Nominal and real are separate typed fields. The engine runs in nominal dollars; the UI converts to today's dollars. When inflation is stochastic (Monte Carlo), the engine emits per-path real series so the UI never deflates with a fixed assumption.
- **Time axis (documented and tested):** Year 1 is the injected current calendar year, with no proration. A person's age in a given year is that year minus birth year (state this rule in `financial-model.md`). Retirement takes effect on January 1 of the retirement-age year (no salary that year). Catch-up eligibility, RMD start, and Social Security claiming are evaluated with the same age rule. Regulatory limits are calendar-year values.
- **Timing convention (user-configurable):** annual model. Contributions are made evenly through the year (mid-year growth on that year's contributions). Withdrawals are taken evenly through the year (mid-year) by default, with a "conservative" setting that takes them at the start of the year. The setting applies consistently to the forecast, scenarios, and Monte Carlo. Property-test "conservative ending balance ≤ default" **only on paths where every annual return is ≥ 0**; with negative-return years the ordering is not guaranteed and must not be asserted.
- **Monthly mode:** deterministic forecast only (not Monte Carlo). Monthly rate = (1 + r)^(1/12) − 1. Document the tolerance between monthly and annual end balances for end-of-period timing, and bound the documented difference for mid-year timing.
- **Supported filing statuses (MVP):** single and married filing jointly only. Others are listed as unsupported and not selectable.
- **Charts:** every chart has an accessible data-table alternative.
- **Theming and layout:** sidebar navigation, light and dark mode, mobile-first responsive.
- **Heavy compute:** Monte Carlo runs in a Web Worker.

### ASK (stop and request input)
- A default above that conflicts with correctness.
- A scope choice this brief does not settle.

---

## 3. Phase 0 deliverables

Presented in plan mode, then written after approval:

1. Repo inspection summary.
2. Architecture plan: package layout, module boundaries, data flow, state shape, error handling.
3. TypeScript domain model as Zod schemas with inferred types: `Household`, `Person`, `Account`, `ContributionSchedule`, `EmployerMatchRule` (one shared type), `IncomeSource`, `Pension`, `SocialSecurityInput`, `SpendingPlan`, `Assumptions`, `TaxYearRules`, `Scenario` (diff), `ProjectionResult` (per-year rows), `MonteCarloConfig`, `MonteCarloResult`, `Insight`.
4. Drafts of `docs/financial-model.md` and `docs/assumptions.md`: every formula, timing convention, simplification, and unsupported case.
5. Milestone plan with gates (section 11) and the feature-to-milestone traceability table: every item in sections 5.1 to 5.11 maps to a milestone or is explicitly deferred. You may add gates; you may not weaken the ones in this brief.
6. Parallelization map and frozen interface contracts (types and function signatures).
7. Rule-value inventory with authoritative sources (section 4). **Start rules sourcing now**, in parallel (see the `rules-researcher` agent, section 7).

---

## 4. Regulatory and tax-year rules

Hardcoding unverified limits is the highest-risk failure in this project.

**Storage and metadata**
- Versioned data files: `packages/engine/src/rules/<taxYear>.ts`, typed as `TaxYearRules`. Every value carries `source` (publication and URL), `retrievedOn`, `indexation` (`'indexed' | 'statutory-fixed'`), and rounding metadata where indexed (verified at source).
- **Sources allowed:** irs.gov, ssa.gov, federalregister.gov, and their official PDFs. Cross-check each high-impact value (deferral limits, IRA limits, Roth phase-outs, brackets, standard deduction, RMD age and table, full retirement age) against two documents where possible. Never fill values from memory.
- **Unverifiable values:** `null`, with `source: null` and `unverifiedReason`. The engine returns an explicit `unverified` result for any calculation that needs a null value and never substitutes a default. The UI disables and labels the feature. If web access is unavailable or IRS pages block fetching, say so in `docs/STATUS.md`, mark everything affected unverified, and continue with the rest.
- Maintain `docs/rules-verification.md`: the 15 highest-impact values, each with source, retrieval date, and a second source if found, for my spot-check **before the M2 tag**.

**Years and indexing**
- Cover the current tax year and the next year if already published; past years may be added for backtesting.
- The user selects the **anchor rules year**. The engine uses published data up to the latest published year and, beyond it, indexes only values marked `indexed`, at a user-configurable rate (default: the inflation assumption), labeled as an assumption. **`statutory-fixed` values are never indexed** (for example, Social Security benefit-taxation thresholds, if verified as fixed).
- Provisions with a sunset: store the sunset year; model post-sunset law as a labeled assumption (default: law as written). Include any additional age-based deduction currently in force, with its income phase-out, after verifying it.

**Rules to model, each verified and sourced**
- 401(k)/403(b)/457: employee deferral limit; age-based and enhanced-age-band catch-ups; any Roth-catch-up requirement for higher earners under current law (requires prior-year wage input and a "plan offers Roth" flag); employer-plus-employee annual additions limit; compensation limit.
- IRA/Roth IRA: limits, catch-up, Roth income phase-outs for the supported filing statuses, earned-income cap.
- HSA: limits (self-only and family), catch-up, HDHP attestation. Traditional IRA deductibility phase-outs are fetched **only if** the deductible-traditional-IRA feature is built; otherwise omit and list as unsupported.
- Federal ordinary brackets and standard deduction (supported statuses); long-term capital gains brackets; Social Security benefit taxation thresholds; Social Security taxable maximum; FICA rates and wage base.
- RMD start age by birth year and the uniform lifetime table. Verify; do not assume.
- Social Security: full retirement age by birth year, early and delayed claiming adjustments, spousal benefit rules, survivor rules, earnings-test thresholds (if modeled), PIA bend points and the wage-index series (illustrative estimator). Verify the current treatment of the Windfall Elimination Provision and Government Pension Offset; do not apply from memory. COLA is a configurable assumption.

**Process and tests**
- "Rules & sources" page in the app lists every value, source, retrieval date, and indexation status.
- Tests read limits from the rules files, not literals, except one pinned fixture year used for golden tests.
- A test fails if any non-null rule value lacks a source, if a null value lacks `unverifiedReason`, or if a year's file is missing required keys.

---

## 5. Features

Build in the milestone order of section 11.

### 5.1 Dashboard
Summary cards: current age, retirement age, years to retirement, current savings, projected savings at retirement, projected monthly retirement income, estimated monthly retirement spending, surplus/shortfall, portfolio longevity, readiness status. **Every card has a formula entry in `docs/financial-model.md` and a test**, stating the dollar basis (today's or nominal), tax basis (gross or net), and the year it refers to (for example, "first retirement year, net of estimated taxes"). Portfolio longevity is the depletion age or "lasts through planning age". Toggle between today's dollars and future nominal dollars (applies to cards, charts, tables, and exports). Readiness status uses documented thresholds, labeled as a heuristic, based on the deterministic baseline and (once available) the Monte Carlo success rate.

Main forecast chart: accumulated savings, contributions, investment growth, withdrawals, portfolio value through planning age (default 100, configurable), retirement marker, first-death marker (couples), depletion marker, and optimistic/baseline/pessimistic deterministic scenarios (fixed return offsets, **not** confidence intervals), with year-by-year tooltips.

Allocation views: (a) by account type, (b) by tax treatment (tax-deferred, tax-free, taxable) stacked over time, and (c) by asset class (stocks, bonds, cash) from per-account allocation (see 5.7).

### 5.2 Profile (individual and household)
Age or date of birth, retirement age, planning age, filing status (supported ones only), state (used only as a flat, user-entered effective state tax rate), current and retirement spending (with an optional "spending changes at age X" step and a real-terms spending glide), inflation, return assumptions, tax assumptions. A spouse/partner has separate income, accounts, retirement age, Social Security input, and longevity.

**Survivor modeling (simple model, documented as a simplification):** the household runs until the longer-lived spouse's planning age. In the year of the first death: the survivor receives the higher of the two Social Security benefits, using the deceased's **claimed-age amount including delayed-retirement credits** (the lower one ends); filing status switches to single starting the following tax year; household spending drops by a user-editable percentage (default 20%, labeled as an assumption); any pension continues at a user-entered survivor percentage (default 100%, per pension); and all accounts transfer in full, with no estate or inheritance taxes. Unsupported and listed: the one-time Social Security death benefit, state-specific rules, survivor-specific RMD and beneficiary rules, life insurance. Each spouse's planning age is independent. Tests: equal and unequal ages, higher earner dying first, lower earner dying first, both dying in the same year.

### 5.2a Income, savings rate, and employer match (guided inputs)
A dedicated **Income & Savings** screen (also an onboarding step), per person. Every field has a tooltip, validation, and a plain-language example.

**Income**
- Current gross annual base salary.
- **Bonus:** percent of salary or fixed dollars, paid annually. Options: grows with salary, grows at its own rate, or stays flat. Toggle for whether the bonus counts as eligible compensation for deferrals and for the match (plan-dependent, default on, labeled). Separate contribution percentage for the bonus is allowed (for example 10% of salary but 50% of bonus).
- **Annual raises:** default percent per year plus year-specific overrides (for example +10% promotion in 2029, or a zero-raise year). Entered as nominal, or as "inflation plus X% real raise"; the implied real raise is shown next to the nominal one.
- **Inflation:** one global assumption, kept separate from raises. It drives spending growth, deflation to today's dollars, default indexing of `indexed` regulatory values beyond published years, and optionally the Social Security COLA.
- Income stop date (the retirement age by default) and an optional partial-retirement or part-time phase (feeds Barista FIRE).

**Your contributions (workplace plans)**
- Percent of salary (and optionally of bonus) for Traditional 401(k) and Roth 401(k); total percentage shown; dollar equivalents live, per year and per paycheck. Optional auto-escalation (for example +1% per year up to a cap).
- Warnings and automatic capping when exceeding the year's employee deferral limit (including catch-up).

**Employer match**
- A tier builder (rate and "up to X% of pay" per tier), optional flat employer contributions, optional vesting schedule. This is the **single `EmployerMatchRule` model** used everywhere.
- Live readout: "Contribute X% ($Y) to capture the full match. You currently capture $A of a possible $B and leave $C per year unclaimed."
- Respects the compensation limit and the annual additions limit. By default the match goes to the traditional bucket; an optional Roth match is plan-dependent and verified per section 4.

**Live preview:** next 10 years of salary, bonus, total compensation, employee contribution, employer match, total saved, savings as a percent of compensation, with limit warnings. Updates instantly; the nominal/today's-dollars toggle applies.

### 5.3 Accounts and contributions
Multiple accounts. Per account: type, balance, contribution (annual or monthly, dollar or percent), contribution growth, expected return, fees (expense ratio, modeled as return drag), tax treatment, start and stop dates. Traditional and Roth are tracked separately with distinct withdrawal treatment. Limits are enforced by tax-year rules with visible warnings and automatic capping, never silent truncation.

**Single source of truth:** workplace-plan accounts (401(k)/403(b)/457) take their contributions and match **only** from the person-level Income & Savings model (5.2a). The account contribution schedule applies to IRA, HSA, taxable brokerage, cash, and other accounts. The match calculator and the match optimizer calculator both use the one `EmployerMatchRule`.

### 5.3a Roth IRA
Per person:
- Inputs: balance, annual or monthly contribution, start and stop dates, expected return, fees.
- **Eligibility check:** estimated MAGI against the phase-out range for the filing status (single, married filing jointly): full, reduced (calculation shown), or ineligible, plus the allowed contribution. MAGI defaults to salary plus bonus minus traditional 401(k) and HSA contributions (documented simplification); the user can override it.
- Limits from the rules file: annual limit, catch-up from age 50, cap at earned income. Each spouse has their own limit. **Spousal IRA for a non-working spouse is unsupported** (list it; cap each IRA at that person's own earned income in the MVP).
- Live readout: "Roth IRA this year: $X of $Y allowed", with a warning and automatic capping. If over the income limit, show an informational note about backdoor Roth contributions (not modeled; listed as unsupported).
- **Withdrawals:** track contribution basis separately from earnings. Qualified distributions (age 59½ and the 5-year rule, verified) are tax-free. Pre-59½ withdrawals are simplified: contributions come out first untaxed, earnings are flagged with a warning. No Roth IRA owner RMDs; verify Roth 401(k) RMD treatment.
- Link to the Roth vs traditional calculator (a stub until M7a). Roth conversions: roadmap only.

### 5.3b HSA (simple)
Inputs: coverage type (self-only or family), HDHP attestation, balance, contribution, return. Limits from the rules file. Withdrawal model: qualified medical withdrawals are tax-free up to a user-entered annual medical-expense amount (default 0); non-medical withdrawals after 65 are taxed as ordinary income; pre-65 non-medical withdrawals are flagged as penalized (simplified). Everything else is documented as unsupported.

### 5.4 Forecast engine (`packages/engine`)
Pure, deterministic, UI-independent. Year-by-year from the current year to planning age. Calculates contributions, growth, fees, inflation, salary growth, per-account balances, spending, taxes, withdrawals, Social Security, pensions, remaining portfolio. Each row records every component. Per-year result includes `phase` ('accumulation', 'retirement'), per-account start and end balances, flows, tax detail, and both nominal and real values.

**Income timing per year:** apply the raise to prior-year base salary (override if set), compute the bonus (from the new base or its own path), then eligible compensation, employee contributions (percent of base and of bonus), tiered match, limit capping, and the split by account. The real raise is explicit in each row.

**Accumulation-phase cash flow:** compute net pay (federal income tax, FICA, flat state rate), then net pay minus employee contributions minus spending. If negative, flag the savings plan as **infeasible** with a warning (do not hide it). Any surplus goes to a user-chosen account (default: taxable brokerage) or can be set to "spent".

**Reconciliation and fees:** rows hold float64 values converted to cents on output. The invariant "start + contributions + growth_net − withdrawals = end" holds within ±1 cent per row. Fees are a row-level shadow figure: `growth_net = growth_gross − fee_drag`. Assert the invariant in tests.

### 5.5 Retirement income planner
Sources: Social Security, pensions, other income, traditional withdrawals, Roth withdrawals, HSA, brokerage withdrawals, cash.

**Gross-up solver:** spending is a net need, but gross withdrawals depend on taxes and taxes depend on withdrawals (Social Security taxability, capital gains, brackets). Use a bounded fixed-point iteration (maximum N iterations, tolerance of $1), documented, with tests for convergence and non-convergence handling. Output per year: gross income, estimated taxes, net income.

**Withdrawal ordering strategies:** taxable-first, traditional-first, Roth-last, proportional, and a simple bracket-filling heuristic (documented). RMDs per verified rules.

**Social Security:** user-entered statement estimates take priority. An illustrative estimator (clearly labeled "not an official SSA calculation") accepts either a simple average-earnings input or an earnings history, uses verified bend points and wage-index data, and is clearly separated from entered values. Claiming-age comparison. COLA assumption. **Spousal benefit** (up to the verified percentage of the other spouse's PIA) and **survivor benefit** are modeled per verified SSA rules. The **earnings test before full retirement age** is unsupported in the MVP: show a warning when someone is modeled as claiming before FRA while still earning. Optional user-set benefit-reduction scenario after a configurable year, labeled as an assumption (not a prediction). WEP/GPO per verified current status only.

**Pension/other income fields:** start age, annual amount, COLA, taxable percent, lump-sum vs annuity, survivor percent. One-time events (inheritance, home sale, large expense) are supported as dated amounts with a tax-treatment flag.

**Taxable-account mechanics:** contributions add basis 1:1; withdrawals reduce basis pro rata; annual tax drag on taxable growth is an explicit user-set percentage (default 0, labeled).

**Tax model (MVP, simplified, documented):** federal ordinary brackets and standard deduction (plus any verified age-based deduction), taxable portion of Social Security via the provisional-income formula, capital gains on the gain fraction of brokerage withdrawals, a flat user-entered state rate, FICA on wages. Unsupported and listed: AMT, NIIT, IRMAA, itemized deductions, credits, state-specific rules, early-withdrawal penalties beyond a flag and warning.

### 5.6 Scenario simulator
Create, save, duplicate, rename, delete, compare. Presets: A Baseline, B Early Retirement (5 years earlier), C Aggressive Savings, D Market Downturn (configurable severity and timing, deterministic return-shock sequence), E Delayed Retirement (3 to 5 years), F Reduced Spending, G Roth Strategy (traditional vs Roth allocation, comparing after-tax outcomes with documented marginal-rate assumptions). Unlimited custom scenarios.

**Diff semantics:** a scenario is a diff over the base profile, keyed by entity ID (set, unset, or add per ID). A diff referencing a deleted base entity is flagged "orphaned" and not applied. Edits to the base flow through to scenarios.

Compare balances, retirement income, depletion age, and funding success. Until M6, **"funding success" and the retirement-age optimizer use the deterministic criterion** (no depletion before planning age, with a user-set minimum ending balance). M6 adds a Monte Carlo success-rate option to both.

### 5.7 Monte Carlo
1,000 to 10,000 paths. Seeded PRNG (documented algorithm, for example PCG or mulberry32). **Path i uses a PRNG stream derived from hash(seed, i)**, so the 1,000-path quick run equals paths 0 to 999 of the full run and results do not depend on chunking or worker count. Identical seed, inputs, algorithm, and build give identical results (verified by test). Optimization changes must match golden outputs to a documented tolerance (for example 1e-9 relative).

**Inputs:** per-account allocation (stocks, bonds, cash) with an "all-in-one blended return" fallback; capital-market assumptions (means, volatilities, correlations) shown as editable defaults, **labeled as assumptions with a stated source or rationale**; inflation fixed or stochastic. Validate that the correlation matrix is positive semi-definite. Default rebalancing: annual back to target allocation (documented); glide paths unsupported.

**Return model:** lognormal annual returns. **User-entered expected returns are geometric (median) returns**; the arithmetic mean is derived and shown, so the Monte Carlo median reconciles with the deterministic baseline. Document model limits (fat tails, no mean reversion, no regime changes).

**Outputs:** ending-balance distribution, probability of funding modeled spending through planning age, median, 10th and 90th percentiles, year-by-year percentile bands, sequence-of-returns illustration (same average return, different order). Withdrawals and taxes inside each path use the same engine logic as the deterministic forecast, with any performance simplification documented.

Required wording: "model-dependent estimate, not a guarantee." Never label percentile bands or scenario ranges as statistical confidence intervals. Never show a success probability without its assumptions beside it.

### 5.8 Standalone calculators
Compound interest; 401(k) contribution; employer match optimizer; Roth vs traditional; retirement age; savings gap; inflation purchasing power; withdrawal (fixed-percentage and sustainable-rate modes); Social Security claiming comparison; fee impact; lump sum vs recurring; spending planner; Coast FIRE; Barista FIRE; FI number. All call the shared engine with no duplicated formulas; each calculator's formulas and assumptions are documented in `docs/financial-model.md`.

### 5.9 Insights engine
Deterministic, rule-based, each with a visible "assumptions" disclosure. Examples: savings increase needed for the goal, value of capturing the full match, impact of retiring two years later, lifetime cost of fees, inflation impact, spending sensitivity, depletion risk, Social Security claiming-age effect. Every insight is computed by re-running the engine (a what-if), never by approximation text. Wording is descriptive ("in this model, ..."), never directive.

### 5.10 UX
Responsive desktop and mobile, sidebar navigation, light and dark mode, interactive charts, sliders with synchronized numeric inputs, instant debounced recalculation (engine off the main thread when slow), WCAG 2.2 AA forms and charts, financial term tooltips, scenario comparison, CSV export, printable summary (print stylesheet with assumptions and disclaimers), sample profiles (early-career, mid-career couple, near-retirement, high-earner), first-run onboarding. Style: professional wealth-management software, restrained, uncluttered.

### 5.11 Data management
Multiple profiles, scenario persistence, save/load, JSON import/export, CSV export of forecast rows (escape cells beginning with `=`, `+`, `-`, `@`), Zod validation on all inputs and imports (clear error messages), `schemaVersion` on every stored document with a tested migration chain (a fixture migrated from every prior version), and a "delete all my data" control. State in the docs and the UI that IndexedDB data is stored unencrypted on the device.

**Privacy:** no network requests carrying user data. No analytics, telemetry, or remote fonts (self-host fonts). Content-Security-Policy via meta tag or headers: `default-src 'self'; connect-src 'none'; worker-src 'self'; style-src 'self' 'unsafe-inline'` (inline styles are needed by the chart and styling libraries; document this). Add a Playwright test asserting no outbound requests during a full user flow other than loading app assets.

---

## 6. Financial accuracy requirements

- Every formula is documented with assumptions in `docs/financial-model.md`; every major forecast has an in-app methodology explanation.
- Pure functions. No hidden global state, no `Date.now()` or `Math.random()` in the engine (inject the date and the PRNG).
- Real vs nominal is explicit in types.
- **Independent validation:** golden values come from (a) hand-derived closed-form formulas (annuity, growing annuity, payment), (b) **external worked examples** from IRS publications (for example Pub 590-A/590-B, Pub 915) and SSA published examples, and (c) a small Python reference script committed with its fixtures. The M8 validation pass is run by a fresh-context `qa-engineer` sub-agent that reads only `docs/financial-model.md` and the tests, **not** the engine source.
- Required test cases: zero, negative, and high inflation; zero and negative returns; contributions at, above, and below limits; catch-up age boundaries; Roth phase-out start, midpoint, and end for each supported filing status; Roth IRA capped at earned income; retiring at current age; retiring at planning age; already-retired user; depletion mid-retirement; zero balance; zero bonus; bonus larger than salary; bonus excluded from eligible compensation; year-specific raise overrides; negative or zero raise; raise below inflation; tiered match edge cases (below, at, above each tier, and above the compensation limit); vesting; infeasible savings plan; spouse with different ages and retirement dates; first-death orderings; RMD age boundary; claiming at 62, FRA, and 70; spousal and survivor benefits; gross-up solver convergence; monthly vs annual mode; Monte Carlo seed determinism and quick-run equality; rules lookups for null (unverified) values.
- Property-based tests (fast-check): balances never negative after depletion handling; flows reconcile within ±1 cent per row; taxes never negative; higher contributions never reduce balance at retirement, all else equal; conservative timing ≤ default timing on non-negative-return paths only.
- Treat taxes as estimates. Mark simplified calculations and unsupported edge cases in code comments, docs, and the UI.
- Do not invent IRS or Social Security rules (section 4).

---

## 7. Claude Code project structure: sub-agents and skills

Create real Claude Code assets, **right after Phase 0 approval and before M1**, and verify they are discoverable (if not, tell me to restart or reload):

- Sub-agents in `.claude/agents/*.md` with proper frontmatter (name, description, tools, model as appropriate): `financial-modeling-engineer`, `software-architect`, `ui-ux-designer`, `frontend-developer`, `qa-engineer`, `code-reviewer`, and **`rules-researcher`** (web tools; writes only `packages/engine/src/rules/` and `docs/rules-verification.md`). Each definition is self-contained (sub-agents do not see this brief): tight scope, explicit tool allowlist (reviewer and QA read-mostly), and a definition of what it must hand back. The main agent does all delegation.
- Skills in `.claude/skills/<name>/SKILL.md`: `financial-calculation-validation`, `ui-component-development`, `forecast-scenario-testing`, `financial-chart-development`, `code-quality-review`. Each has a trigger description, a checklist, and repo-convention references.
- Do not add MCP servers unless you can state a concrete advantage in `docs/architecture.md`.
- **Parallelism rules:** freeze shared types and engine signatures in Phase 0. Parallelize only work on disjoint files, in isolated worktrees or distinct directories. **Contract changes** require a version bump, a note in `docs/STATUS.md`, and are applied by the main agent only. Shared config files (lockfile, root `package.json`, barrel exports, tsconfig) are owned by one agent at a time. Integrate sequentially and run the full suite after each integration. The Code Reviewer runs at the end of every milestone; findings are resolved or recorded in `docs/STATUS.md`.

---

## 8. Documentation (required deliverables)

`CLAUDE.md`, `docs/BRIEF.md`, `docs/architecture.md`, `docs/financial-model.md`, `docs/assumptions.md`, `docs/testing-strategy.md`, `docs/roadmap.md`, `docs/user-guide.md`, `docs/rules-verification.md`, `docs/STATUS.md`. Docs are updated in the same milestone as the code they describe.

---

## 9. Quality bars

- TypeScript `strict`, `noUncheckedIndexedAccess`; ESLint and Prettier; no `any` without justification.
- Coverage: engine package ≥ 90% lines and branches; UI key flows via React Testing Library; Playwright E2E for onboarding, profile entry, income and match, account management, forecast, scenario compare, Monte Carlo, export/import round trip, light/dark mode, mobile viewport, print view.
- Accessibility: axe checks in Playwright on every main page, keyboard navigation of all controls and chart data tables, visible focus, sufficient contrast in both themes.
- **Performance (explicit targets):** Monte Carlo with 10,000 paths over a 60-year horizon, including withdrawals and the simplified tax model, finishes in under 3 seconds on a typical modern laptop and under 10 seconds on a mid-range phone. The UI stays responsive: Web Worker, progress indicator, cancel button. A "quick run" of 1,000 paths returns a near-instant first result, then refines to the selected count. Deterministic dashboard recalculation targets under 100 ms for a typical profile. Measure with a committed benchmark script, stating the hardware and, for phones, the **emulated** CPU throttling factor; label results as emulated and never claim real-device numbers. If a target is missed, optimize first (typed arrays, no allocation in the inner loop, precomputed tables), then report the shortfall honestly in `docs/STATUS.md` rather than relaxing the target. Report bundle size.
- **Visual verification:** use Playwright screenshots read back as images to verify layouts, themes, and print view.
- Security: dependency audit, input validation on all external data, no `dangerouslySetInnerHTML` with user data.

---

## 10. Honesty and reporting rules

- Do not claim a feature is complete unless it is implemented **and** tested. Statuses in `docs/STATUS.md`: `done`, `simplified` (with the limitation), `unverified rule`, `not started`.
- If something is too complex for the current milestone, ship a clearly labeled simplified version and document it.
- At the end of each milestone, report: what was built, actual test-result summaries, what was run and visually verified, known limitations, and open questions.
- **Never cut, even under time pressure:** disclaimers, rule sourcing and unverified flags, privacy and CSP, input validation, accessibility basics.

---

## 11. Milestones, gates, and traceability

Each milestone ends with: working code, tests passing (`pnpm verify`: typecheck, lint, test, build, run locally), docs updated, reviewer pass, app run and checked via Playwright screenshots, and a tagged commit. Gates below are minimums; you may add, not weaken.

**M1 Foundation.** Monorepo, strict TS, lint/test tooling, app shell, sidebar nav, light/dark theme, Zod domain models, IndexedDB layer with schema-versioning skeleton, `pnpm verify`, sub-agents and skills verified, Phase 0 contracts in code.
*Gates:* engine package has no React/DOM imports (enforced); `pnpm verify` green; a stored document round-trips through the schema.

**M2 Accumulation engine, income, accounts.** Rules loader with sourced data; accumulation-engine slice (income, bonus, raises, contributions, match, limits, net-pay feasibility); Income & Savings screen with live preview; profile editor (individual and household); account CRUD; Roth IRA page; simple HSA; sample profiles; onboarding; multi-profile management.
*Gates:* `docs/rules-verification.md` complete and reviewed by me before tagging; Roth eligibility matches an IRS worked example at phase-out start, midpoint, and end; match readout matches hand-computed tier cases; every rule value has a source (test).

**M3 Forecasting.** Full engine with decumulation (simple withdrawals), per-year rows, dashboard cards (with formula docs) and forecast chart, real/nominal toggle, allocation views (a) and (b).
*Gates:* reconciliation property test passes 10,000 fast-check runs; golden fixtures match the Python reference and external worked examples within $0.01 per year; zero-return and annuity closed-form cases exact.

**M4 Retirement income.** Spending plan, Social Security (entered, illustrative, spousal, survivor), pensions and one-time events, withdrawal ordering, RMDs, simplified tax model with gross-up solver, survivor modeling, gross-to-net view, HSA withdrawals.
*Gates:* solver converges within tolerance on all fixtures; RMD matches IRS table examples; survivor test orderings pass; unverified-rule paths return explicit `unverified`.

**M5 Scenarios.** Diff scenarios, presets A to G, comparison views, deterministic-success retirement-age optimizer.
*Gates:* diff semantics tests (orphaned entities, base edits flow through); optimizer result verified by brute-force check; scenario D is deterministic and reproducible.

**M6 Monte Carlo.** Seeded engine in a Web Worker, outputs and charts, sequence-risk illustration, methodology panel, allocation view (c), Monte Carlo option in scenarios and the optimizer.
*Gates:* seed determinism and quick-run equality tests; median reconciles with the deterministic baseline under zero volatility; PSD validation tested; performance targets measured and recorded.

**M7a Calculators.** The 15 calculators on the shared engine, Roth-vs-traditional link wired.
*Gates:* each calculator has a closed-form or engine-parity test; no duplicated formulas (lint or review check).

**M7b Insights, export, print.** Insights engine, CSV and JSON export/import with validation and migrations, printable summary, delete-all-data.
*Gates:* every insight re-runs the engine; CSV injection test; migration fixtures from every prior version; JSON import rejects malformed files with clear messages.

**M8 Quality.** Full E2E, accessibility audit, performance pass, independent financial validation pass (fresh-context `qa-engineer`), docs completion, final reviewer sweep, honest `docs/STATUS.md`.
*Gates:* axe clean on all main pages; no-outbound-requests test passes; coverage targets met; validation report filed.

**Traceability table (Phase 0 produces the full version; seed):**

| Feature | Milestone |
|---|---|
| Rules loader, rules page | M2 (sourcing starts Phase 0) |
| Income & Savings, match, Roth IRA, HSA | M2 / M4 (HSA withdrawals) |
| Onboarding, sample profiles, multi-profile | M2 |
| Dashboard cards, forecast chart, allocation (a)(b) | M3 |
| SS, pensions, RMDs, taxes, survivor | M4 |
| Scenarios, optimizer | M5 |
| Monte Carlo, allocation (c) | M6 |
| Calculators | M7a |
| Insights, export/import, print, delete-all | M7b |
| CSP, no-outbound test, accessibility, performance, user guide | M1 (CSP) / M8 |

If time or context becomes a constraint, protect this priority order: engine correctness and tests, dashboard and forecast, scenarios, Monte Carlo, calculators (never cutting the items in section 10). A smaller, correct product beats a larger, unverified one.

---

## 12. Final deliverable

A functioning, attractive, technically sound retirement planning website that runs locally with `pnpm install && pnpm dev`, with `pnpm verify` green, an honest `docs/STATUS.md`, and a completed `docs/rules-verification.md`.
