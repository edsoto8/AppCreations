# ATM Simulator — Architecture

An interactive 3D training simulator of a **generic** freestanding bank ATM. Everything is fictional:
accounts, cards, PINs, the bank ("Meridian Training Bank"), the network and the banknotes (labelled
"TRAINING NOTE — NOT LEGAL TENDER"). Where real ATMs differ by manufacturer the simulator shows a clearly
labelled generic design.

## Layers

```
src/
  core/            types.ts (all shared contracts), events.ts, clock.ts (InstantClock), rng.ts, money.ts
  banking/         ledger, accounts/cards seed data, authorization host, network/switch       ┐
  cash/            note inventory, cassettes, dispense planning (denomination strategies)     │ DOMAIN
  transactions/    state machine, electronic journal + audit log, transaction engine          │ pure TS,
  faults/          fault catalog, armed-fault state, scenario autopilot                       │ no three.js,
  maintenance/     device health, operator console, component tests, checklist                │ no DOM
  reconciliation/  baseline, daily balancing report, discrepancy injection                    │
  app/AtmSystem.ts composition root of the domain; app/AtmApp.ts headless ATM screen flow    ┘
  knowledge/       component knowledge base (ComponentInfo for every ComponentId)
  animations/      AnimClock (sim time: speed/pause/step + tweens), mechanism animator, flow arrows
  models/          procedural ATM model (exterior, internals, notes, card) → AtmModel contract
  scene/           renderer, lobby environment, lighting, camera rig, view modes
  interactions/    raycast picking, hover, card drag, keypad/screen hit-testing
  ui/              DOM panels, ATM screen canvas renderer, dashboards, timeline
  tutorials/       guided tour definitions + runner
  audio/           WebAudio-synthesised sound effects
  app/main.ts      browser entry: wires domain ↔ 3D ↔ UI
```

Rule: domain folders import only from `core/` and each other. The presentation layer implements the
domain's **ports** (`SimClock`, `MechanismDriver`, `CustomerPort`) and listens to the `EventBus`.

## Ports

| Port | Implemented by (browser) | Implemented by (tests) |
|---|---|---|
| `SimClock` | `animations/AnimClock` (driven by render loop, speed 0.25–2×, pause, step-to-next-stage) | `core/clock.InstantClock` |
| `MechanismDriver` | `animations/MechanismAnimator` (moves note meshes along model anchors) | no-op driver |
| `CustomerPort` | UI: resolves when the user clicks the presented cash / ejected card | test port (auto-collect, or never) |

The domain decides **what** happens (which notes move where, which state a transaction is in). The
driver only **shows** it and resolves when the animation is done. Because every wait is on sim time,
speed/pause/step apply to animations, host latency and customer time-outs consistently.

## Money model (invariants)

* All amounts are integer **cents**.
* Every banknote is an individual `Note` object with a `loc`. Notes are created once at initialisation
  (cassettes, branch vault, customer wallet) and afterwards only **move**. ⇒ *Note conservation*: the count
  of notes per denomination over all locations never changes.
* The machine keeps **logical counters** per cassette, separate from the physical notes. They agree unless a
  discrepancy is deliberately injected — that is exactly what reconciliation detects.
* Ledger is **double entry**: each `LedgerPosting` has legs summing to zero. Customer deposit accounts are
  liabilities; GL accounts `GL-ATM-CASH` (asset: cash in this ATM) and `GL-SUSPENSE` balance them.
* Authorization places a **hold** (available = ledger − holds) and posts nothing. Posting happens on
  **completion** (customer collected cash). Reversal releases the hold. ⇒ an authorization alone never debits.
* *Customer wealth conservation*: Σ customer account ledger balances + value of notes in `customer` wallet
  is constant across any sequence of customer transactions (with no injected discrepancy), including
  declines, time-outs, jams, retractions and power loss.
* After a session ends, no hold may remain for a transaction in a final state.

`AtmSystem.checkInvariants()` returns a list of violations (empty = healthy). Tests call it after every scenario.

## Transaction lifecycle

```
CREATED → AUTH_PENDING → AUTHORIZED → DISPENSING → PRESENTED → COLLECTED → COMPLETED
               │  └→ DECLINED            │              └→ RETRACTED ─┐
               └→ TIMED_OUT ─────────────┼→ DISPENSE_FAILED ──────────┼→ REVERSAL_PENDING → REVERSED
         any non-final ─→ SUSPECT (power loss) ──────────────────────┘
DEPOSIT:  CREATED → ESCROWED → AUTH_PENDING → AUTHORIZED → COMPLETED ;  ESCROWED → CANCELLED
local rejections (unsupported amount, cannot dispense): CREATED → CANCELLED
```

The transition table is enforced in `transactions/stateMachine.ts`; an illegal transition throws.
Each transition is journaled and emitted as `txn.state`.

## Conceptual banking path

`ATM → ATM Controller → ATM Network/Switch → Bank Authorization Host → Account Ledger` and back.
`banking/network.ts` walks each hop with sim-time latency, emitting `net.message` per hop so the
network dashboard can animate it. Messages are readable, fictional and ISO-8583-*like* (response codes
00/05/51/55/61/62/75/91/68). PIN verification is simulated with a toy hash — never real cryptography.
No real card data, credentials or connectivity exist anywhere in the app.

## Fault model

`faults/catalog.ts` defines 14 `FaultDefinition`s. `FaultState` holds armed faults. The engine and network
consult it at well-defined points (pick, validate, transport, present, auth request, printer, card reader,
power). One-shot faults disarm after triggering; latching faults stay until an operator recovery action.
`faults/autopilot.ts` can drive a whole demonstration (insert card → PIN → transaction) for any fault.

## Presentation

* **Scene:** WebGL renderer with PCF soft shadows (limited casters), ACES tone mapping, a procedural lobby
  (tiled floor, walls, ceiling panels, instruction stand). OrbitControls with damped camera focus moves.
* **View modes:** Exterior · X-ray (shell transparent) · Cutaway (shell clipped by a plane) · Exploded
  (parts tween to `explodeOffsets`) · Internal mechanism (doors open, inspection lighting).
* **Interaction:** raycasting resolves `userData.componentId`, `userData.key` (keypad) and screen UVs
  (touch buttons on the display canvas). Hover outlines, click selects + shows knowledge-base details.
* **UI:** left panel (modes, tours, components, scenarios), center viewport, right panel tabs
  (details, transaction, inventory, events), bottom timeline (stages, play/pause, speed, step, log).
  Dashboards: Network, Cash inventory, Maintenance, Troubleshooting, Reconciliation.

## Determinism

All domain randomness comes from `core/rng.ts` (seeded). With `InstantClock` and the same inputs, a
scenario produces identical journals, so tests can replay them.
