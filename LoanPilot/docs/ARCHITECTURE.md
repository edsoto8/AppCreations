# LoanPilot architecture

LoanPilot is a local-first auto loan calculator and payoff simulator. A .NET 10 Web API owns every
financial calculation; the React front end only collects input and renders results, so the numbers on
screen, in exports and in tests always come from the same engine.

```
LoanPilot/
├── backend/
│   ├── src/
│   │   ├── LoanPilot.Core     Domain model + financial engine. No packages, no I/O, fully deterministic.
│   │   ├── LoanPilot.Data     SQLite persistence: Dapper repositories, schema migrations.
│   │   └── LoanPilot.Api      ASP.NET Core minimal API, Serilog, CSV/XLSX export, serves the built SPA.
│   └── tests/                 xUnit v3: Core (engine), Data (real SQLite files), Api (WebApplicationFactory)
├── frontend/                  React 19 + TypeScript + Vite, Tailwind CSS v4, shadcn/ui, Recharts, Vitest
└── docs/                      ARCHITECTURE.md, API.md, CALCULATIONS.md
```

## Layers

| Layer | Responsibility | Depends on |
|---|---|---|
| `LoanPilot.Core.Domain` | `Loan`, `Scenario`, `PaymentRecord`, `UserPreferences`, enums | nothing |
| `LoanPilot.Core.Engine` | amortization, accrual, status, simulation, target/budget solvers, comparison, refinance, insights, validation | Domain |
| `LoanPilot.Data` | repositories (`LoanRepository`, `ScenarioRepository`, `PaymentRecordRepository`, `PreferencesRepository`), migrations | Core |
| `LoanPilot.Api` | HTTP endpoints, DTO mapping, validation → 400 problem details, exports, logging | Core, Data |
| `frontend` | pages, forms, charts; calls the API with a short debounce for live feedback | API contract (`docs/API.md`) |

## Key decisions

- **Backend is the single source of truth for money.** The front end performs no financial math (only
  formatting). The simulator posts unsaved scenario definitions to `/simulate` with a ~150 ms debounce;
  local round-trips are a few milliseconds, so feedback is immediate.
- **`decimal` everywhere** for money and rates, rounded to cents with `MidpointRounding.AwayFromZero`
  at each posting. SQLite stores money as TEXT (invariant culture) so values round-trip exactly.
- **Dates are `DateOnly`** (ISO `yyyy-MM-dd` in JSON and SQLite). The engine never reads the clock;
  "today" is passed in (the API uses `TimeProvider`, overridable with `?asOf=` for tests).
- **Existing loans project from the balance as-of date.** History is never invented: interest paid to
  date is shown only when entered, derivable from payment records, or explicitly labelled as an
  estimate from the original schedule.
- **Scenarios never modify the loan.** They are stored separately (recurring extras, lump sums,
  optional budget payment) and simulated against the loan on demand.
- **Single-process deployment.** `npm run build` writes the SPA into the API's `wwwroot`; `dotnet run`
  then serves UI and API on one port (http://localhost:5080). In development Vite proxies `/api`.
- **SQLite file** lives in the user's local app-data folder (`LoanPilot/loanpilot.db`) unless
  `LoanPilot:DataDirectory` / `--data-dir` overrides it. Logs (Serilog, rolling daily) go next to it.
- **No external services.** Insights are rule-based and computed from the user's numbers.
- **shadcn/ui components are vendored source** in `frontend/src/components/ui` (the shadcn registry is
  not reachable from the build environment, so they were written to the shadcn new-york conventions).
