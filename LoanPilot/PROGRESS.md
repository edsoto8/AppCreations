# LoanPilot progress

Status keys: `[ ]` not started · `[~]` in progress · `[x]` verified complete · `[!]` blocked

## Milestones

### Milestone 1 — Foundation
- [~] Solution, project structure, shared build settings
- [~] Domain model (`Loan`, `Scenario`, `PaymentRecord`, `UserPreferences`)
- [ ] SQLite + Dapper data layer with migrations
- [ ] API host with Serilog
- [ ] Front-end scaffold (Vite, React, TS, Tailwind, shadcn/ui, Recharts, Vitest)

### Milestone 2 — Financial engine
- [ ] Amortization (monthly periodic and daily simple accrual, Actual/365 and Actual/Actual)
- [ ] Loan status for new and existing loans (balance as-of date, no invented history)
- [ ] Extra recurring payments, lump sums, combined strategies, budget payment
- [ ] Target payoff date solver
- [ ] Validation, warnings (insufficient payment, balloon, stale balance)
- [ ] Engine tests against independently computed references

### Milestone 3 — Dashboard
- [ ] Responsive shell, navigation, themes
- [ ] Loan entry / edit / archive / delete
- [ ] Dashboard cards, progress, charts

### Milestone 4 — Payoff simulator
- [ ] Recurring extras, lump sums, combined, target date, budget
- [ ] Live charts (balance, principal vs interest, interest savings, timeline)
- [ ] Saved scenarios + comparison with "best" picks

### Milestone 5 — Insights and reporting
- [ ] Insights engine with explanations
- [ ] Amortization schedule (monthly / annual, search, filter, compare)
- [ ] CSV and Excel export

### Milestone 6 — Polish
- [ ] Accessibility, responsive checks, empty states, validation messages
- [ ] Advanced: refinance + break-even, rate comparison, payment records + CSV import + tracking, equity, printable summary
- [ ] Documentation, final validation

## Work log

### Session 1
- Installed .NET 10 SDK 10.0.112 from the Ubuntu feed (the default dotnet download host is blocked).
- The shadcn registry (ui.shadcn.com) is blocked by the network policy, so shadcn/ui components are
  written into the repo by hand following the shadcn new-york conventions.
