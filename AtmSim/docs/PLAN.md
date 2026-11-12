# Implementation Plan & Acceptance Tests

## Team split (parallel work)

| Workstream | Owner | Folders |
|---|---|---|
| Contracts, architecture, integration, review | lead | `core/`, `docs/`, `app/main.ts` |
| 3D modeling + mechanism animation | 3D agent | `models/`, `scene/environment.ts`, `animations/MechanismAnimator.ts`, `animations/FlowArrows.ts` |
| Banking, cash, transactions, faults, maintenance, reconciliation + unit tests | domain agent | `banking/`, `cash/`, `transactions/`, `faults/`, `maintenance/`, `reconciliation/`, `app/AtmSystem.ts`, `app/AtmApp.ts`, `tests/unit/` |
| Component knowledge base | content agent | `knowledge/` |
| Renderer, camera, view modes, interaction, UI, dashboards, audio, tours, e2e | lead | `scene/`, `interactions/`, `ui/`, `audio/`, `tutorials/`, `tests/e2e/` |

## Milestones

| # | Milestone | Usable increment |
|---|---|---|
| 1 | Foundation | Vite app, renderer, lighting, lobby, orbit camera |
| 2 | Detailed exterior | Full ATM exterior with PBR materials; hover/click picking of parts |
| 3 | Customer transactions | Screen UI on the 3D display, keypad, card insert/tap, withdraw/deposit/balance/transfer/statement |
| 4 | Internal mechanics | Cassettes, transport, stacker, presenter; animated notes; service & vault doors |
| 5 | Banking systems | Host + switch simulation, lifecycle state machine, network dashboard, declines / reversals |
| 6 | Cash management | Inventory dashboard, replenishment, strategies, reconciliation report |
| 7 | Training tools | Guided tours, exploded view, component knowledge base, troubleshooting scenarios |
| 8 | Polish & testing | Sound, performance, Playwright checks, bug fixing |

## Acceptance tests

Unit (Vitest, `tests/unit`) — business invariants:

* A1 Dispense planner never plans more notes than a cassette's counter, always sums to the amount, rejects
  unsupported amounts and reports infeasible combinations (e.g. $30 with $20/$50/$100).
* A2 Every ledger posting balances (Σ legs = 0); holds reduce *available* only.
* A3 Authorization alone never debits; completion posts once; reversal releases the hold; reversal is idempotent.
* A4 Illegal lifecycle transitions throw; every transaction ends in a final state.
* A5 Full withdrawal via the headless screen flow debits exactly the dispensed amount and moves exactly the
  planned notes from cassettes to the customer.
* A6 For each of the 14 fault scenarios: expected final state, note conservation, customer wealth conservation,
  no dangling holds, ATM usable again after recovery.
* A7 Deposit, transfer, balance, mini-statement, cancel paths.
* A8 Reconciliation balances on a clean day and detects each injected discrepancy.
* A9 Determinism: same seed + inputs ⇒ identical journal.
* A10 Operator actions: replenishment capacity, cassette reconfiguration, dispenser test, checklist.

End-to-end (Playwright, `tests/e2e`):

* E1 App loads, WebGL canvas renders, no console errors.
* E2 Complete withdrawal by clicking the 3D card, 3D keypad keys and the 3D screen; cash appears; clicking
  the cash completes the transaction; inventory panel shows the reduced cassette count.
* E3 View modes (X-ray, cutaway, exploded, internal) switch without errors; selecting a component shows details.
* E4 A fault scenario runs from the Troubleshooting panel and ends in the documented state.
* E5 Guided tour can be stepped through to the end.
* E6 Reconciliation report renders; reset restores initial inventory.
