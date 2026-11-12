# ATM Training Simulator

An interactive 3D simulator of a generic, modern freestanding bank ATM. You can operate it as a customer, open
it up, watch the banknotes travel through the mechanism, follow the authorization to the bank host and back,
break it on purpose, repair it as an operator, and balance it at the end of the day.

Everything is fictional: **Meridian Training Bank**, its customers, cards (prefix `9990`), PINs, the network and the
banknotes ("TRAINING NOTE — NOT LEGAL TENDER", colours unlike real money). Where real ATMs differ by manufacturer,
the simulator shows a clearly labelled generic design. No real card data, credentials, banking connectivity,
security-bypass or safe-opening information exists anywhere in the app.

## Run it

Requires Node 20+.

```bash
cd AtmSim
npm install
npm run dev        # → http://localhost:5199
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5199 |
| `npm test` | 77 Vitest unit tests of the banking / cash / transaction logic |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | Type-check + production build into `dist/` (static files, open with any web server) |
| `npm run e2e` | 6 Playwright browser tests that click the real 3D ATM (starts the dev server) |

## Using the simulator

**Layout** — left: modes, guided tours, component list, failure scenarios · centre: the 3D ATM · right: details,
transaction lifecycle, cash, audit (and the active dashboard) · bottom: stage timeline, play/pause, speed
(0.25× 0.5× 1× 2×), step-to-next-stage, live electronic journal.

**Customer mode** — pick a card in the *Training wallet* (PINs are shown). Drag the 3D card into the card slot
(or onto the contactless pad), click it, or press *Insert card*. Type the PIN on the 3D keypad (or your keyboard:
digits, Enter, Backspace = CLEAR, Esc = CANCEL), then touch buttons on the ATM screen. Click the presented cash,
your ejected card and the printed receipt to take them. Transactions: withdrawal, deposit, balance, transfer between
own accounts, mini statement, receipts, cancel, end session.

**Views** (top-left of the viewport) — Exterior · X-ray · Cutaway · Exploded · Internal (doors open, inspection
lighting). *Note path* shows animated arrows along the banknote routes. Hover any part for its name; click it for
purpose, how it works, relationships, inputs/outputs, common failures and maintenance.

**Modes**
- *Banking network* — `ATM → Controller → Switch → Authorization host → Ledger`, with each hop animated and every
  fictional request/response message readable (codes 00/05/51/54/55/57/61/62/75/91/68).
- *Cash inventory* — cassettes, note counts, available vs rejected / retracted / deposited / presented cash,
  low-cash warnings, dispense strategy (fewest notes / balanced / small notes) and a live plan preview.
- *Maintenance* — operator session, checklist, replenish / remove / install / reconfigure cassettes, empty bins,
  device health, component self-tests, clear jams, load paper, restore power, return retained cards, journal.
- *Troubleshooting* — 14 scenarios (insufficient funds, ATM out of cash, unsupported amount, no feasible note
  combination, low cash, cash jam, pick failure, rejected note, printer out of paper, card reader down, network
  timeout, host unavailable, cash not collected, power loss). Each explains what happened, outlines the affected
  parts in 3D, shows the resulting transaction state and customer outcome, and runs the recovery workflow.
  *Run demonstration* drives the whole customer flow automatically; *Arm only* lets you trigger it yourself.
- *Reconciliation* — beginning inventory, replenishments, dispensed (journal vs device vs host), deposits,
  rejected, retracted, expected vs observed cash, per-cassette table, explained differences, deliberate
  discrepancies, close business day, audit log. *Reset* (top right) restores the initial training state.

**Guided tours** — 1 Exterior · 2 Cash withdrawal (a real $180 withdrawal followed note by note) · 3 Inside the
ATM · 4 Banking communication · 5 Cash management · 6 Reconciliation · 7 Troubleshooting.

Sound is synthesised with Web Audio (no audio files); every sound has a visual equivalent and can be muted.
*Quality* cycles high / medium / low (shadows, outlines, resolution).

## How it works

See `docs/ARCHITECTURE.md` (design), `docs/DOMAIN-API.md` (domain contract) and `docs/PLAN.md` (milestones and
acceptance tests). In short:

- **Pure domain layer** (`banking/ cash/ transactions/ faults/ maintenance/ reconciliation/ app/AtmSystem.ts
  app/AtmApp.ts`) with no three.js or DOM. The 3D layer implements its ports: the sim clock, the mechanism driver
  (animates each pick, sensor check, divert, stack, present, retract, card and receipt movement) and the customer.
- **Money cannot be created or destroyed**: each banknote is an object that only moves between locations; the
  ledger is double-entry; authorizations place holds, completions post, reversals release. Tests assert note
  conservation, customer-wealth conservation and "no dangling holds" after every scenario.
- **Transaction state machine**: `CREATED → AUTH_PENDING → AUTHORIZED → DISPENSING → PRESENTED → COLLECTED →
  COMPLETED`, with `DECLINED`, `TIMED_OUT`, `DISPENSE_FAILED`, `RETRACTED`, `SUSPECT`, `REVERSAL_PENDING`,
  `REVERSED`, `CANCELLED`; illegal transitions throw. Undeliverable completions/reversals are store-and-forwarded.
- **Deterministic**: seeded RNG; the same inputs produce the same journal.
- **Procedural 3D**: every mesh, texture and label is generated in code (no downloaded models).

## Known limitations

- Conceptual model only — not a real ATM protocol (no ISO 8583 / NDC / XFS implementation) and not a guide to real
  service procedures.
- One shared customer wallet is used for all demo cards; deposits are credited immediately (no funds hold) and the
  validator only flags notes pre-marked as suspect.
- No partial dispense: a dispense either presents the full bundle or fails and is reversed.
- Network-timeout is modelled for withdrawal authorizations only.
- After *Reset* the simulated clock keeps running, so journal times continue from where they were.
- 3D: cassettes hold notes on edge, so fill level changes stack length; notes inside the machine are best seen in
  X-ray / cutaway / internal views; in X-ray small parts (handles, labels, LEDs) stay opaque; the service door
  swing slightly intersects the left side panel; long receipts are compressed onto a short paper strip.
- Performance target is 60 fps on a MacBook-class GPU (≈430 draw calls, ≈60k triangles); headless software
  rendering (used by the e2e tests) runs far slower, so those tests raise the sim speed.
