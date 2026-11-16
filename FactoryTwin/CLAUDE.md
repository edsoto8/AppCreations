# CLAUDE.md — Factory Twin

Digital twin of an electronics assembly & packaging plant: TypeScript, React 19, Vite 7, three.js via
React Three Fiber, Zustand, Recharts, Vitest, Playwright. Read `SPEC.md`, `ARCHITECTURE.md`,
`DECISIONS.md` and `TASKS.md` before changing anything; shared contracts are in `src/simulation/types.ts`.

## Commands (run from `FactoryTwin/`)

```bash
npm install            # .npmrc sets legacy-peer-deps (see D-004)
npm run dev            # http://localhost:5173  (?scenario=breakdown&t=9&paused=1&select=station:cell-1&cam=focus)
npm run build          # tsc -b + vite build
npm test               # Vitest, headless simulation tests (~20 s)
npm run check:30day    # 30 simulated days headless
npm run calibrate      # utilisation per stage for the default scenario
npm run report         # docs/scenario-results.md (runs the optimizer, ~1-2 min)
npm run test:e2e       # Playwright smoke tests (builds + previews on :4173)
npm run screenshots    # needs `npx vite preview --port 4173` running; writes docs/*.png
```

## Rules

- `src/simulation`, `entities`, `production`, `logistics`, `optimization` must not import React,
  three, the DOM, or call Math.random / Date.now (enforced by `src/tests/purity.test.ts`).
- Sim time only moves by processing events. Randomness comes from `rng.stream(name)`.
- The renderer reads `runtime.current` inside `useFrame`; never push per-tick sim data into React state.
- Every visible motion must be a function of snapshot state and render time.
