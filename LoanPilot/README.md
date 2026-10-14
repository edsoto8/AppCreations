# LoanPilot — auto loan calculator & payoff simulator

LoanPilot helps you understand an auto loan you already have (or are about to sign): what you still
owe, when it will be paid off, how much interest is left — and what happens if you pay a little extra,
make a lump-sum payment, aim for a payoff date or stick to a monthly budget. Everything runs on your own
computer: no accounts, no cloud services, no paid APIs.

Stack: React 19 + TypeScript, Tailwind CSS, shadcn/ui, Recharts · .NET 10 Web API · SQLite + Dapper ·
Serilog · xUnit and Vitest.

## Run it

Prerequisites: **.NET 10 SDK** and **Node.js 22.22+** (npm).

```bash
cd LoanPilot
./start.sh            # macOS / Linux
# or
.\start.ps1           # Windows PowerShell
```

The script builds the web interface on first run (`npm ci && npm run build`) and starts the app at
**http://localhost:5080**. Pass `--rebuild` (`-Rebuild` in PowerShell) after pulling changes, and
`--data-dir <folder>` to keep the database somewhere specific.

Manual equivalent:

```bash
cd LoanPilot/frontend && npm ci && npm run build      # writes the SPA into the API's wwwroot
cd .. && dotnet run --project backend/src/LoanPilot.Api -c Release
```

Development (hot reload): run the API (`dotnet run --project backend/src/LoanPilot.Api`) and, in a
second terminal, `cd frontend && npm run dev`, then open http://localhost:5173 (Vite proxies `/api`).

**Where your data lives:** a SQLite file `loanpilot.db` in your local app-data folder
(`%LOCALAPPDATA%\LoanPilot` on Windows, `~/Library/Application Support/LoanPilot` on macOS,
`~/.local/share/LoanPilot` on Linux), with rolling logs in `logs/` next to it. Override with `--data-dir` or the `LoanPilot__DataDirectory` environment variable.
Back up by copying the folder. Before a schema upgrade the database is copied to a `.bak` file; an
unreadable or foreign database is never overwritten.

## Features

**Loans** — any number of auto loans with vehicle details, lender, amount financed, down payment, APR,
term, start and first-payment dates, payment (or let LoanPilot compute the standard payment), payment
frequency (monthly, biweekly, weekly) and interest method (monthly periodic, or daily simple interest
with Actual/365 or Actual/Actual day count). For a loan already in progress, enter the **current
principal balance and its date** — no need to reconstruct the history. Edit, archive and delete.
A live preview shows the payment, payoff date and interest while you type.

**Dashboard** — current principal, original amount, % of principal repaid, payment, remaining
payments, projected payoff date, remaining interest, total projected cost, next payment with its
interest/principal split, estimated payoff amount today (clearly not a lender quote), potential
savings from early payoff, equity (if you enter the vehicle's value), balance and principal-vs-interest
charts, warnings and top insights.

**Payoff simulator** — the core of the app; results update as you type:
- extra monthly payments (quick picks $25/$50/$100/$250, slider, custom amount, optional start date);
- one-time lump sums on a chosen date;
- combined strategies: several recurring extras with their own start/end dates (to model changing
  amounts) plus several lump sums;
- target payoff date → the exact required payment and how much more than today's payment that is;
- budget → "I can pay $X a month": payoff timeline and savings.

Every result shows the new payoff date, months saved, interest saved, new remaining interest and the %
reduction, with charts of balance over time (both plans reaching zero), principal vs interest,
interest savings and the payoff timeline. Scenarios never change the loan; save and name them.

**Scenario comparison** — baseline, presets (+$50, +$100, a lump sum) and your saved strategies side by
side, sortable, with the best strategy for fastest payoff, lowest remaining interest, lowest recurring
payment and best within a monthly budget, plus balance and timeline charts.

**Amortization schedule** — every payment (number, date, starting balance, scheduled and extra payment,
interest, principal, ending balance, cumulative interest); monthly, annual and calendar views; search
and filters; baseline vs scenario comparison; **CSV and Excel export**; a **printable summary** (use
your browser's "Save as PDF" for a PDF report); upcoming payments as a calendar (.ics) download.

**Insights** — plain-language observations computed from your loan ("Adding $50 per month could pay
off your loan 5 months earlier and save about $269 in interest"), each with "How this was
calculated". Rule-based; no AI service involved.

**Advanced** — refinance comparison with break-even and a rate comparison table; payment history with
manual entry, CSV import and actual-vs-scheduled tracking; vehicle equity.

**Settings** — light/dark/system theme, display currency, default interest method, comparison budget,
loan management (including archived loans) and a summary of the calculation rules.

## How the numbers are calculated

The .NET engine is the single source of truth — the browser never does financial math, so the screen,
exports and tests always agree. Highlights (full detail in [docs/CALCULATIONS.md](docs/CALCULATIONS.md)):

- `decimal` arithmetic; every posting rounded to the cent (half away from zero).
- APR is a nominal annual rate. Monthly periodic interest = balance × APR ÷ 12 per period; daily simple
  interest = balance × APR × days ÷ 365 (or ÷ 365/366 per calendar year with Actual/Actual).
- Payments cover interest first, then principal. **Extra payments go to principal and never reduce or
  skip your next scheduled payment** — the loan simply ends sooner. Lump sums are principal-only.
- Interest is never compounded; a payment that doesn't cover the interest is flagged and the shortfall
  is carried as unpaid interest.
- Due dates keep the first payment's day of month and handle month ends and leap years
  (Jan 31 → Feb 29 → Mar 31).
- Existing loans project from the balance date. Interest paid before then is shown only if you enter it
  or record complete payment history — LoanPilot never invents history, and labels every estimate.

> **Disclaimer.** LoanPilot's results are estimates for planning. Lender rules, fees, payment posting
> dates, grace periods and contract terms can change your actual payoff amount and date. Remaining
> principal is not the same as a payoff quote — ask your lender for an official payoff quote before
> paying off a loan.

## Tests

```bash
dotnet test LoanPilot.sln           # engine, data layer and API (xUnit)
cd frontend && npm test             # UI (Vitest + Testing Library)
python3 tools/reference_amortization.py   # regenerate independent reference values
```

Engine tests compare against values from an independent exact-rational Python implementation
(`tools/reference_amortization.py`) and published amortization figures. They cover standard and
zero-percent loans, extra and multiple payments, lump sums under both accrual methods, target dates,
budgets, daily interest across leap years, month-end dates, rounding and final payments, invalid input,
existing loans without history, and insufficient-payment (negative amortization) cases. The data tests
use real SQLite files; the API tests run the real host, including persistence across a restart.

## Project layout

```
backend/src/LoanPilot.Core   domain + financial engine (no dependencies)
backend/src/LoanPilot.Data   SQLite (Dapper) repositories and migrations
backend/src/LoanPilot.Api    minimal Web API, Serilog, CSV/XLSX export, serves the SPA
backend/tests/*              xUnit test projects
frontend/                    React + TypeScript + Tailwind + shadcn/ui + Recharts
docs/                        architecture, API contract, calculation rules
tools/                       independent reference calculator
```

## Known limitations

- Fees, insurance, GAP and other add-ons are not modelled; enter the payment your lender charges.
- Extra payments are assumed to post on the payment date (or the lump-sum date under daily accrual);
  real posting can lag by days.
- Lenders that "advance the due date" when you prepay are not modelled (LoanPilot keeps paying the
  scheduled payment, which is the better choice for paying less interest anyway).
- Payment frequency changes mid-loan and variable rates are not supported.
- The "payoff estimate" assumes scheduled payments since the balance date were made on time.
- Single-user, local only; no sync between devices (copy the data folder to move it).
- The PDF report is produced through the browser's print dialog.

## Ideas for the future

- Variable-rate and deferred-payment loans; payment holidays.
- Lender-specific posting rules (due-date advancement, payment application order).
- Packaged desktop build (single executable) and automatic backups.
- Multi-loan payoff strategies (avalanche / snowball across several loans).
- Import from lender statements (OFX/QFX).
