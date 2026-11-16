# Factory Twin — Specification

An interactive 3D digital twin of an electronics assembly and packaging plant, driven by a
deterministic discrete-event simulation (DES). Every visible motion is a rendering of simulation
state; nothing moves by scripted animation alone.

## 1. Users can

- Explore the running factory in 3D and watch raw materials become shipped products.
- Monitor production in real time and inspect any machine, conveyor, worker, vehicle, pallet or product.
- Change operating parameters, inject failures and incidents, apply recovery actions.
- Find bottlenecks, save a baseline, compare strategies (same seed, or several seeds), run an optimizer.
- Export/import a scenario (`{ config, seed, injectedEvents[] }`) as JSON and replay it exactly.

## 2. Products and materials

| Product | Name | BOM | Assembly mean | Price | Mix |
|---|---|---|---|---|---|
| A | Smart-home sensor hub | 1 PCB, 1 enclosure, 2 sensors, 1 packaging kit | 90 s | $89 | 35% |
| B | Wireless speaker | 1 PCB, 1 enclosure, 1 speaker driver, 1 battery, 1 packaging kit | 120 s | $129 | 65% |

Materials have unit cost, initial stock, reorder point (ROP), order quantity and a triangular
supplier lead time. Inventory position = on hand + staged at dock + on order. When it drops to the
ROP a purchase order is placed; a truck arrives after the lead time, unloads at a receiving bay and
the forklift puts the lot away in raw storage. Only put-away stock can be consumed.

## 3. Flow

```
Order arrives ─► unit released to an assembly cell ─► AGV picks kit at kitting (consumes BOM)
  ─► kit buffer at cell ─► robot load ─► assembly ─► robot unload ─► C1 conveyor (one per cell)
  ─► inspection infeed table ─► inspection (handling + test) ─┬─ pass ─► C2 ─► packaging (consumes kit)
                                                             └─ reject ─► reject bin ─► AGV ─► cell rework
                                                                (second reject ─► scrap, replacement released)
  ─► C3 ─► palletizer (pallets of 24 per order) ─► forklift ─► finished-goods racks
  ─► order complete ─► carrier truck requested ─► shipping bay ─► forklift loads ─► shipped
```

An order is **on time** if its truck departs (all units shipped) by its due time.

## 4. Resources (defaults)

| Resource | Count | Notes |
|---|---|---|
| Receiving dock | 2 bays | 20 min unload per truck |
| Raw storage | 3 racks | 2 materials per rack |
| AGVs | 2 | 1.2 m/s, 4 kits per trip, kits + rework transport |
| Forklift | 1 | 1.8 m/s, put-away, palletizer → FG, FG → truck |
| Assembly cells | 3 | robot arm + assembly machine, 1 operator, WIP limit 3 per cell |
| Inspection | 2 | 25 s test + 20 s handling, 1 inspector each, 4% reject |
| Packaging line | 1 | 30 s, 2 packers (1 present = half speed) |
| Palletizer | 1 | 24 units/pallet, 20 s wrap, 2 build positions |
| FG storage | 2 racks | 30 visible slots |
| Shipping dock | 2 bays | carrier arrives 20–90 min after request |
| Control room | 1 | technician home; break room for floater/breaks |

Conveyors: 0.4 m/s, 0.7 m pitch, accumulating, capacity = floor(length / pitch).

## 5. Time, shifts and workers

- t = 0 is Day 1 06:00. Shifts 06:00–14:00 and 14:00–22:00; the plant is closed overnight.
- Each worker has a 30-minute break; breaks are staggered and a floater covers them.
- Workers may be absent for a whole shift (3% default); the floater then covers that station.
- Effective station capacity = staffed / required (assembly and inspection stop at 0; packaging
  runs at half speed with 1 of 2 packers).
- A technician repairs failures (walks to the machine, then MTTR). Repairs in progress at shift
  end are finished; queued ones wait for the next shift's technician.

## 6. Failures and incidents

Random: Weibull time-to-failure on operating time for machines, conveyors, AGVs and forklift.
A failure interrupts the current job; the job **resumes** with its remaining time after repair.

Injectable incidents (each recorded in the scenario, so replays reproduce it):

| Incident | Effect |
|---|---|
| Assembly machine failure | cell fails now, repair time given |
| Conveyor breakdown | belt stops, items freeze, upstream blocks |
| Raw material shortage | quarantines a share of one material and delays its supplier |
| Worker absence | a worker leaves for N hours |
| Inspection failure spike | reject rate raised for N hours |
| Sudden order surge | N extra orders arrive at once |
| Shipping bottleneck | one bay closed and carriers slowed for N hours |
| Packaging slowdown | packaging speed multiplied by a factor for N hours |

Recovery actions: repair now (expedite fee, short repair), reassign worker (floater or a chosen
worker to a station), reroute (release a cell's committed units to other cells), expedite
materials (emergency PO with 2 h lead time and a fee).

## 7. Calibration targets (default scenario)

Assembly is the bottleneck at 85–95% utilisation; inspection 50–60%; packaging 60–70%. Arrival
rate loads assembly to about 90%. See `DECISIONS.md` D-010 for the handling-time assumption.

## 8. Metrics

Total manufactured (units packed), production per hour, active orders, rejected and scrapped
units, average cycle time (release → packed), utilisation per station, WIP, inventory, operating
cost (materials consumed + machine/conveyor/vehicle open hours + labour hours + one-off fees),
on-time completion. Utilisation = busy time / open time. All metrics derive from simulation
events or state and are sampled on sim time (every 15 sim-minutes for trends).

## 9. Experimentation

- Editable: cells, inspection stations, AGVs, speed factors, staffing, dispatch rule, WIP limit,
  reorder points, PM interval, reject rate, order rate.
- Baseline compare with same seed or several seeds (mean ± std).
- Bottleneck detector: per-stage score from utilisation (incl. down time), queue, blocked/starved.
- Optimizer: hill climbing with random restarts over a bounded space, objective
  `revenue − operating cost − lateness penalty` per day, fixed budget, several seeds per candidate,
  runs in a Web Worker; outputs the top 3 with expected gain over baseline.

## 10. Non-goals

Rigid-body physics, multiplayer, backend, paid services, external binary assets. AGVs do not
avoid each other on aisles (they queue at pick-up/drop-off points only).
