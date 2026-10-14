# CLAUDE.md

LoanPilot is a local-first auto loan calculator and payoff simulator: a React + TypeScript front end
(`frontend/`) over a .NET 10 minimal Web API (`backend/`) with SQLite + Dapper and Serilog.
`docs/ARCHITECTURE.md` is the design, `docs/API.md` the HTTP contract, `docs/CALCULATIONS.md` the
financial rules, `PROGRESS.md` the milestone log and `README.md` the user-facing guide.

## Commands

Run from this `LoanPilot/` folder:

```bash
dotnet build LoanPilot.sln                                    # backend (warnings are errors)
dotnet test LoanPilot.sln                                     # engine, data and API tests
dotnet test backend/tests/LoanPilot.Core.Tests                # engine only (fast)
dotnet run --project backend/src/LoanPilot.Api -- --data-dir ./tmp-data   # API on :5080

cd frontend
npm ci
npm run dev        # Vite on :5173, proxies /api to :5080
npm test           # Vitest
npm run typecheck
npm run build      # writes the SPA into backend/src/LoanPilot.Api/wwwroot (gitignored)

./start.sh         # (or start.ps1) build the SPA if needed and serve everything on :5080
python3 tools/reference_amortization.py   # independent reference values used by engine tests
```

## Architecture rules

- **The backend engine is the only place financial math happens.** `LoanPilot.Core` has no package
  dependencies and never reads the clock: "today" is passed in (`LoanWorkspace.Today`, overridable with
  `?asOf=yyyy-MM-dd`). The front end only formats numbers — never compute money in TypeScript.
- Money is `decimal`, rounded to cents half-away-from-zero at each posting (`Money.Round`). Dates are
  `DateOnly`. Payment dates always come from `PaymentCalendar.DueDate(anchor, frequency, index)`.
- `AmortizationEngine.Run` is the single projection routine; `LoanAnalyzer.Analyze` turns a `Loan` into
  status + baseline. Existing loans project from the balance as-of date; never invent history
  (interest paid is `Unknown` unless entered or derivable from complete payment records).
- Validation lives in Core (`LoanValidator`, `ScenarioValidator`, `RefinanceCalculator.Validate`,
  `PaymentHistory.Validate`) and throws `LoanValidationException` with camelCase field names; the API's
  exception handler maps it to a 400 `ValidationProblem` that the front end shows next to the field.
- `LoanPilot.Data` is the only place with SQL. Money is stored as TEXT (exact). Schema changes are new
  entries in `Schema/Migrations.cs` — never edit a released migration; the initializer never deletes or
  overwrites an existing database.
- API endpoints are in `Endpoints.cs`; engine records are serialized directly (camelCase, enums as
  camelCase strings). Keep `docs/API.md` and `frontend/src/api/types.ts` in sync with any change.
- Front end: pages in `src/pages/<name>/`, shadcn/ui components (hand-written; the registry is not
  reachable here) in `src/components/ui/`, API calls in `src/api/endpoints.ts`, React Query hooks in
  `src/api/queries.ts` or the page folder; mutations invalidate the `['loans']` root.

## Conventions

- C#: four-space indent, file-scoped namespaces `LoanPilot.*`, `sealed` by default, test names
  `Subject_Condition_Outcome`; engine tests check against independently computed values.
- TypeScript strict, no `any`; parse `yyyy-MM-dd` with the helpers in `lib/format.ts` (never
  `new Date('yyyy-mm-dd')`, which shifts in negative-offset time zones).
- Every user-visible estimate is labelled as one, and copy must not contradict the engine's rules.
