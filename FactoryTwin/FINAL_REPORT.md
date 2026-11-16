# Final report — Factory Twin

## What was built

- **A deterministic discrete-event simulation** of the whole flow: order arrivals, WIP-limited
  release, AGV kitting, three robot assembly cells, accumulating conveyors, two inspection
  stations with rework and scrap, packaging, a palletizer, a forklift doing put-away, storage
  and truck loading, finished goods, and per-order carriers through two shipping bays. It also
  models suppliers with a reorder-point / order-quantity policy and receiving bays. Two shifts
  run with staggered breaks, a floater covers breaks and absences, and technicians handle
  repairs. Machines, conveyors and vehicles fail on Weibull wear clocks, and an interrupted job
  resumes after repair.
- **A 3D digital twin** in React Three Fiber, built from procedural models only (no external
  assets). Robot arms are driven by IK from product positions. The view includes gantries,
  packaging, a palletizer, belts that scroll by the belt odometer, AGVs, a forklift, workers
  whose gait follows a distance odometer, and trucks. Products, totes, cartons and pallets are
  instanced and selectable. Stack lights and floor halos show state. Cameras offer overview,
  top-down, focus and follow modes with smooth transitions, plus hover tooltips and a selection
  marker.
- **Dashboard.** Nine KPI tiles, production and WIP trends, a utilisation trend by stage,
  inventory, per-machine state bars, a cost breakdown, the bottleneck ranking with a
  plain-language explanation, and alerts. Every value comes from the event log or simulation
  state.
- **Incidents.** Eight injectable incident types, an incident timeline, and four recovery
  actions. Every intervention is recorded into the scenario, and exported JSON replays to an
  identical log.
- **Experiments.** An editor for 11 parameters, baseline-vs-current comparison over N seeds,
  and a hill-climbing optimizer with a fixed budget and common random numbers. Comparison and
  optimization run in a Web Worker; the optimizer returns the top 3 distinct recommendations.
- **Three one-click scenarios** with numbers measured in the simulation (see README and
  `docs/scenario-results.md`).

## How it was verified

- **91 Vitest tests** cover the 10 required invariants: station sequence, single capacity,
  no output while failed, bottleneck relief, inventory exactness, rework and scrap,
  speed-independence, identical seeded logs, dashboard values equal to a log recompute, and
  30 days in 2.3 s with no violations. They also cover purity, NaN-free snapshots, scenario
  replay with live interventions, all incident types, workforce coverage, cost composition and
  the optimizer.
- **Calibration:** over 30 days, assembly runs at 91–93% (the detected bottleneck), inspection
  at 50–51% and packaging at 66–69%, which meets the spec targets. Doing so required explicit
  handling times: the spec's stated means cannot reach these targets on their own (D-010).
- **5 Playwright smoke tests** run on the production build: render, play/pause/speed,
  dashboard, clicking a machine in 3D, and injecting a failure.
- **Visual verification:** screenshots of every key state were captured and inspected (`docs/`).
  Inspecting them led to fixes: robot reach, items piling up invisibly on a stopped belt,
  camera behaviour, overview framing, and state legibility from a distance.
- **Architecture review** (a subagent, after M6) found 13 issues. Fixed: the floater being
  stranded after its own break (confirmed bug, now covered by a regression test that fails on
  the old code), overlapping incidents cancelling each other, the worker-host clock running
  ahead, staffing changes mid-phase, failed belts handing off items, the frame cap, vehicle
  utilisation definitions, the bottleneck wording, vehicles snapping to a node, and per-frame
  React diffing.

## Known limitations

- **Headless browser rendering.** Software WebGL (SwiftShader) runs at about 1–2 fps, so the
  60 fps target on an M1 is not measured here. The draw-call count (about 280 against a budget
  of 400) and triangle count (about 570k) are measured, and the performance monitor (`Perf`)
  shows fps on real hardware.
- **Vehicle movement.** AGVs do not avoid each other on aisles; they queue only at
  pick-up and drop-off points. Workers may walk close to equipment.
- **Optimizer.** It is first-improvement hill climbing with 3 seeds × 4 days per candidate.
  Results depend on the path taken, and small differences are within noise; one-standard-
  deviation bands are reported. Its #1 result can change when the model changes, so
  `npm run report` regenerates the optimized preset.
- **Packaging kits** are consumed straight from raw storage; line-side replenishment is not
  modelled (D-014).
- **Vehicle repairs** use field service rather than the shift technician (D-028).
- **Git tags.** `m1`–`m7` exist locally, but the session's git proxy rejected pushing tags; only
  the branch is on the remote.

## Suggested next steps

1. Aisle segment reservations for AGVs, with a congestion KPI.
2. A changeover time between products A and B, and batching-aware dispatch.
3. A real-GPU benchmark run (Playwright with a hardware GPU) that logs fps at 1x and 10x.
4. A smarter optimizer (simulated annealing or Bayesian search) with confidence intervals and
   ranking selection.
5. Run the live view on the worker host by default, once the inspector detail queries are
   batched.
6. Persist experiment results and baselines across sessions (IndexedDB).
