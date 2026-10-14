# LoanPilot progress

Status keys: `[ ]` not started · `[~]` in progress · `[x]` verified complete · `[!]` blocked

## Milestones

### Milestone 1 — Foundation
- [x] Solution, project structure, shared build settings (`Directory.Build.props`, warnings are errors)
- [x] Domain model (`Loan`, `Scenario`, `PaymentRecord`, `UserPreferences`)
- [x] SQLite + Dapper data layer with migrations (money stored as exact TEXT)
- [x] API host with Serilog (console + rolling file in the data folder)
- [x] Front-end scaffold (Vite, React 19, TS, Tailwind v4, shadcn/ui, Recharts, Vitest)

### Milestone 2 — Financial engine
- [x] Amortization: monthly periodic and daily simple interest (Actual/365, Actual/Actual)
- [x] Loan status for new and existing loans (balance as-of date, no invented history)
- [x] Recurring extras with date windows, multiple lump sums, combined strategies, budget payment
- [x] Target payoff date solver (minimal payment to the cent, verified)
- [x] Validation and warnings (insufficient payment, balloon, beyond maturity, stale balance, …)
- [x] Engine tests against an independent exact-rational reference (`tools/reference_amortization.py`)

### Milestone 3 — Dashboard
- [x] Responsive shell, sidebar / mobile sheet navigation, light/dark/system themes
- [x] Loan entry / edit / archive / delete with live server preview and field-level errors
- [x] Dashboard KPI cards, repayment progress, balance and principal-vs-interest charts

### Milestone 4 — Payoff simulator
- [x] Extra monthly, lump sum, combined, target date and budget modes with live results
- [x] Charts: balance over time (baseline vs scenario), principal vs interest, interest savings, timeline
- [x] Saved scenarios + comparison with fastest / lowest interest / lowest recurring / within-budget picks

### Milestone 5 — Insights and reporting
- [x] Rule-based insights engine with "How this was calculated" explanations
- [x] Amortization schedule: monthly / annual / calendar views, search, filters, baseline-vs-scenario
- [x] CSV and Excel (dependency-free OOXML writer, verified with openpyxl) export

### Milestone 6 — Polish
- [x] Accessibility (labels, keyboard, focus return from dialogs, not colour-only), responsive at 390/768/1440
- [x] Advanced: refinance + break-even, rate comparison, payment records + CSV import + tracking,
      equity, printable summary (print-to-PDF), payment calendar (.ics)
- [x] Documentation (README, CLAUDE.md, docs/ARCHITECTURE.md, docs/API.md, docs/CALCULATIONS.md)
- [x] Final validation from a fresh clone

## Final handoff

**Build:** `dotnet build LoanPilot.sln` — 0 warnings, 0 errors. `npm run build` — no warnings
(app chunk 340 kB, charts chunk 405 kB).

**Tests (fresh clone of the branch):**

| Suite | Result |
|---|---|
| LoanPilot.Core.Tests (engine) | 110 passed |
| LoanPilot.Data.Tests (SQLite) | 81 passed |
| LoanPilot.Api.Tests (real host) | 16 passed |
| Front end (Vitest) | 142 passed, 18 files; `tsc` clean |

**End-to-end check** (Playwright against `./start.sh` on a fresh data folder): empty state → create a
loan with a current balance through the form → dashboard → simulator +$100 and save scenario →
comparison → schedule CSV and Excel downloads (XLSX opened with openpyxl) → insights → restart →
loan and scenario still there. No console errors; no horizontal overflow on any route at 390 or 768 px.

**Definition of done:** every item verified (loan profile; current balance; accurate payoff
projection; extra monthly; lump sums; combined strategies; visual comparison; schedule verified against
independent references; insights from real calculations; persistence across restarts; tests passing;
documented local startup).

### Agent usage
- Lead (this session): architecture, API contract, financial engine and its tests, Web API, exporters,
  integration, review triage and fixes, final validation.
- Backend Engineer sub-agent (isolated worktree): SQLite/Dapper data layer + 81 tests.
- Frontend Designer sub-agent: design system, shell, Loan Details, Dashboard, Settings.
- Two Frontend Engineer sub-agents in parallel on disjoint folders: Simulator + Comparison;
  Schedule + Insights + Refinance + Payments.
- Independent Financial Engineer review of the engine: 3 high / 5 medium / 6 low findings — 8 high and
  medium plus 5 low fixed with 18 regression tests; months-saved rounding kept as documented behaviour.
- Independent full-stack Code Reviewer: 2 high (cross-site writes to the local API; duplicate CSV
  imports) / 6 medium / 9 low — all high and medium and most low fixed; remaining items under
  "Known issues".

### Decisions
- The backend engine is authoritative; the browser never computes money (display aggregation of
  engine values only).
- Daily-accrual existing loans accrue from the last due date before the balance date.
- Extra payments never advance the due date or reduce the next payment; lump sums are principal-only.
- Payment records count as interest history only when complete (≥ payments made, all with a split).
- shadcn/ui components are hand-written (registry blocked by the network policy); XLSX written without
  a third-party library.
- The API answers only localhost host names and rejects cross-site writes.

### Known issues / follow-ups
- Simulation responses resend baseline rows with every request (fast locally; ~1 MB for 50-year weekly
  loans). Could be trimmed.
- Schedule comparison difference columns subtract engine values in the browser (display only).
- Full-page screenshots show the sticky header mid-page (capture artifact, not a layout bug).

### Recommended next actions
1. Package a single-file desktop build (self-contained `dotnet publish` with the SPA embedded).
2. Lender posting-rule options (due-date advancement, payment application order).
3. Multi-loan payoff strategies (avalanche / snowball).

## Work log

### Session 1
- Installed .NET 10 SDK 10.0.112 from the Ubuntu feed (the default dotnet download host is blocked).
- The shadcn registry (ui.shadcn.com) is blocked by the network policy, so shadcn/ui components are
  written into the repo by hand following the shadcn new-york conventions.
- Built and verified all six milestones and the advanced features; two independent reviews; final
  validation from a fresh clone.
