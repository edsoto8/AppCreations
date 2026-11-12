# CLAUDE.md

Guidance for Claude Code when working in `AtmSim/`.

## Project Overview

Interactive 3D ATM training simulator: Three.js + TypeScript + Vite. A generic freestanding lobby ATM you can
operate (card, PIN, withdraw/deposit/transfer…), open, inspect, break and repair. Fictional bank, accounts,
cards and training currency only. `README.md` covers features and usage; `docs/ARCHITECTURE.md` the design;
`docs/DOMAIN-API.md` the domain contract.

## Commands (run from this `AtmSim/` folder)

```bash
npm install
npm run dev          # http://localhost:5199
npm test             # Vitest unit tests (domain invariants)
npm run typecheck    # tsc --noEmit (strict)
npm run build        # typecheck + production build to dist/
npm run e2e          # Playwright browser tests (starts the dev server)
```

## Key rules

- **Domain is pure.** `banking/ cash/ transactions/ faults/ maintenance/ reconciliation/ app/AtmSystem.ts
  app/AtmApp.ts` must not import three.js or touch the DOM. They talk to the browser only through the ports in
  `core/types.ts` (`SimClock`, `MechanismDriver`, `CustomerPort`) and the `EventBus`.
- **Money is integer cents.** Notes are individual objects that only move between locations — never create or
  destroy them. Authorization holds; completion posts; reversal releases. `AtmSystem.checkInvariants()` must stay
  empty after every scenario (tests assert it).
- **All mechanism timing uses the sim clock** (`AnimClock`: `wait`/`tween`/`stage`) so speed, pause and step work.
  Camera and UI transitions use real time (GSAP).
- **Shared contracts live in `src/core/types.ts` and `src/models/types.ts`.** Change them additively.
- Touch-button ids on the ATM screen (`menu-withdraw`, `acct-…`, `receipt-yes`, …) are used by tours and tests.
- No real card data, credentials, security-bypass or safe-opening content anywhere.
