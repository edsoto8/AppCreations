# Robotics model, algorithms and simplifications

This simulator is an **educational, simplified** model of a robot vacuum. It is designed to behave
plausibly and to make the underlying ideas visible. It is **not** an accurate engineering simulation
of any real product. Every simplification is listed below.

All units are SI (m, s, W, Wh, g, ml). The simulation runs at a fixed step of 20 ms of *simulated*
time (`SimConfig.stepDt`). Nothing in `src/sim` reads the wall clock or `Math.random`. All randomness
comes from a seeded `Rng` (mulberry32), so a layout + seed + command sequence always reproduces the
same run.

## 1. Ground truth vs. the robot's belief

| Layer | Owner | Who may read it |
|---|---|---|
| `HouseLayout` → `WorldModel` (shapes, spatial hash, floor/room grids, cliffs) | `src/sim/world` | physics (collisions) and sensor models only |
| `RobotMap` (occupancy, low-obstacle, cliff and floor-type layers, costmap) | `src/sim/mapping` | planning, navigation, mission logic, UI map |

The robot never plans on ground truth. It discovers walls, furniture, dropped obstacles and cliffs
with its sensors. Layout edits rebuild the `WorldModel` but **not** the robot's map: the robot has to
perceive the change.

Two pieces of information are given to the robot directly, because a real user draws them in the app:
**room labels** (the rectangles that define "Kitchen", "Office", …) and **no-go / no-mop zones**.

**Simplification: perfect localisation.** The robot's pose estimate equals its true pose; there is no
SLAM back-end. Wheel slip noise (σ = 1 % per wheel) perturbs the *motion*, and the controllers
correct for it, but the map is always built at the true pose.

## 2. Robot body: differential drive

`RobotBody` integrates a unicycle model from wheel speeds:

```
v_L = v − ω·L/2,   v_R = v + ω·L/2          (L = wheel base = 0.235 m)
v   = (v_R + v_L)/2,   ω = (v_R − v_L)/L
x  += v·cos(θ + ω·dt/2)·dt,  y += v·sin(θ + ω·dt/2)·dt,  θ += ω·dt
```

- Commands are limited by linear/angular acceleration and by surface drag (carpet ×1.3 → lower top speed).
- Wheel angles accumulate as `∫v_wheel dt / r_wheel`, and they drive the 3D wheel animation.
- **Collisions:** the 0.175 m circular footprint is tested against every shape in a 0.5 m spatial hash
  (oriented boxes and circles). The body is pushed out along the contact normal. Contacts within
  ±100° of the heading fire the **bumper** (stored as a hit angle and a hit point).
- **Cliff reflex:** six IR cliff sensors (four front, two rear) are checked at the *proposed* pose. If
  any relevant sensor would be over a drop, the whole motion (translation **and** rotation) is refused.

Vertical extents matter. Every shape has `[zMin, zMax]`. The robot (0.10 m tall) drives under beds,
tables and desks whose clearance is more than 0.10 m, and collides only with their legs.

## 3. Sensors

| Sensor | Model | Used for |
|---|---|---|
| 2D LiDAR (5 Hz, 360 rays/rev, 6 m, σ = 8 mm, 1 % dropout) | ray casts at 9.2 cm height via DDA over the spatial hash; fractional ray accumulation keeps angular resolution exact at any step size | occupancy mapping, point cloud, recovery direction |
| Front structured-light / camera | 11 rays in a ±35° cone, 0.55 m range, at 1.5 cm and 5 cm height, 10 Hz | **low obstacles** under the LiDAR plane (cables, socks, pet bowls) |
| Bumper | from the collision step | marks the contact point as an obstacle, then a reflex back-off |
| Cliff sensors (6×) | point-in-cliff test at sensor positions | cliff layer and reflex |
| Right-side wall ToF | 2 rays (90° and 45°), 0.18 m | wall hugging during edge cleaning |
| Floor-type (ultrasonic/camera) | reads the true floor type within 0.4 m ahead, 5 Hz | learned floor map: lift mops on carpet, mop-only carpet avoidance |

**Dropouts are discarded.** A missing echo carries no information, so it is not integrated as a
max-range "free" ray. Doing that would carve free space straight through solid furniture; an early
version did exactly this, which is why it is called out here.

## 4. Mapping

- **Occupancy grid** (5 cm cells, log-odds): each ray walks the cells it crosses. Cells before the
  end get a miss (−0.4); the end cell gets a hit (+0.85), or a miss for a max-range return. Values are
  clamped to [−2, 3.5]. A cell counts as occupied above 0.6 and free below −0.3; anything else is unknown.
- The **low-obstacle layer** (front sensor, bumper) is separate, because the LiDAR would otherwise
  "clear" objects that are below its scan plane. Front-sensor rays that see empty floor clear stale
  marks.
- The **cliff layer** is permanent for the session. Because LiDAR cannot see drops, each trigger also
  marks a 0.3 m strip ahead of the triggering sensor, which forms a virtual barrier.
- The **costmap** is an exact Euclidean distance transform (Felzenszwalb, two 1-D passes) from lethal
  cells (occupied, low-obstacle, cliff, no-go). Cells closer than radius + 1.5 cm are INSCRIBED (the
  robot centre may not go there). Cost decays exponentially out to 0.45 m. Unknown cells are not
  traversable. The costmap is rebuilt at most every 0.25 s, and only when inputs changed (~3 ms).
- A **relaxed costmap** (radius − 3.5 cm, no margin) is built on demand. It is used only as a
  fallback when the strict one finds no route. Map noise can make a real 0.5 m passage look
  impassable; with the relaxed map the robot then "squeezes through" at 0.12 m/s instead of declaring
  itself trapped.

## 5. Path planning and execution

- **A\*** on the 8-connected grid with an octile heuristic. Step cost is `length × (1 + 3·cost/252)`,
  and corner cutting is not allowed. A robot that starts inside the inflated band (after a bump) may
  escape through INSCRIBED cells within 0.25 m. A blocked goal is replaced with the nearest
  traversable cell within tolerance. Paths are then smoothed by line-of-sight shortcuts that never
  increase the cost band. Buffers are reused between calls (typically 4–5 ms, worst case ~20 ms on a
  16 × 12 m house).
- **Pure-pursuit follower** (lookahead 0.25 m): it rotates in place when the heading error is more
  than 0.6 rad, slows near the goal, and its progress along the path never goes backwards.
- **Navigator** (execution layer):
  - Every 0.2 s, when the costmap has changed, it checks the next 2.5 m of path against *actual
    contact* with mapped obstacles (radius − 1.5 cm). This is deliberately less conservative than the
    planning band, so map noise does not cause constant replans.
  - **Dynamic replanning:** if the path is blocked, it re-plans to the first safe point after the
    blockage and keeps the rest of the path (a detour). For go-to goals it re-plans fully.
  - **Reflexes:** a bump means back up 7 cm. A front cliff means back up. A rear cliff means move
    forward 8 cm. After each reflex it re-plans.
  - **Stuck detection:** commanded motion without progress for 3 s, or no progress across 6 s,
    triggers an escape manoeuvre (back up 15 cm, then rotate toward the most open LiDAR direction).
    After 3 failed escapes the goal fails.
  - **Failure handling:** more than 8 bumps on one goal fails that goal. The mission skips the task
    and continues.

## 6. Exploration and coverage

- **Frontier exploration:** a frontier is a free cell with an unknown 4-neighbour. Frontier cells are
  clustered (8-connected), and each cluster gets a reachable target. The robot picks the nearest
  target by a Dijkstra distance field, with a small bonus for large frontiers. A frontier is
  blacklisted when it is unreachable, or when the robot reached it and it still could not be observed.
  The current target is dropped as soon as it stops being a frontier.
- **Region:** the selected rooms, or a 1.6 × 1.6 m square for spot cleaning. The region is restricted
  to cells *reachable* from the robot, so cells seen through gaps it cannot pass are not planned.
  Mop-only missions also exclude carpets the robot has learned about.
- **Edge cleaning first:** the boundary of the traversable area is traced into loops, oriented with
  walls on the right (the side-brush side). While driving them, the side ToF sensor feeds a *virtual
  pose offset* to the follower. The robot then hugs the wall about 1.2 cm from its shell, while the
  follower still tracks the planned loop. This is how the 5 cm map quantisation is overcome.
- **Boustrophedon lanes** run along the longer axis, spaced 0.20 m apart. They are split at obstacles,
  chained into sweeps, and ordered greedily by nearest endpoint. Pass 2 runs perpendicular
  (cross-hatching).
- **Touch-ups:** after each pass, reachable cells in the region with fewer passes than required
  (after removing isolated specks) get extra lanes, up to two rounds per pass.

## 7. Cleaning model (simplified)

Dirt lives on the 5 cm grid as five layers: dust, crumbs, hair (grams), liquid (ml) and stain
intensity (0–1). The seed is base dust (smooth value noise), traffic patches at doorways, and the
layout's hotspots. Spills add dirt with a smooth falloff.

Each time a footprint **enters** a cell (a "pass"), a fraction of the dirt is removed:

```
efficiency = base × surface × suction × speed × bin
  base        vacuum 0.72, mop 0.55
  surface     hardwood 1.0, tile 1.0, rug 0.82, carpet 0.65 (hair harder: 0.85 / 0.6 / 0.45)
  suction     quiet 0.7, standard 1.0, turbo 1.25, max 1.45
  speed       clamp(sqrt(0.28 m/s / v), 0.75, 1.25)   (slower = cleaner)
  bin         airflow falls off above 70 % full; 0.1 when full
```

- **Main roller** (22 × 5.5 cm) gives the full effect. The **side brush** (front-right, reaching 3 cm
  past the shell) applies 45 %.
- **Mop pads** (two 6.2 cm discs at the rear) remove liquid (×1.3), stains (×0.45 per pass, so
  several passes are needed) and residual dust. They only work on hard floors and lift automatically
  on carpets/rugs and in no-mop zones. Efficiency scales with water flow, pad wetness and pad soiling.
- Vacuuming never removes liquid or stains. Mopping never fills the dustbin.
- Removed solids go into the dustbin (mass is conserved and tested). Recovered liquid and half of the
  dispensed water go to the robot's dirty-water reservoir.
- **Coverage %** is reported against an **evaluation-only** ground-truth mask: cells within 0.14 m of
  a collision-free, dock-connected robot centre. That is the floor the footprint can physically reach.

## 8. Battery and resources (simulated time only)

Power draw is base 3 W + LiDAR 2 W + drive (≤ 9 W × drag) + brushes 5 W + suction (12/22/38/55 W)
+ mop 4 W. Charging runs at 90 W constant power up to 80 %, then tapers to 15 % of that.

- The default **battery is 30 Wh**, a demo value; real robots carry about 75 Wh. With the smaller
  pack, a whole-home run shows the recharge-and-resume cycle.
- The robot returns to the dock when its state of charge falls to
  `max(20 %, energy to reach dock + 5 %)`, or when the bin is full, the clean water is empty or the
  dirty water is full.
- It **saves the remaining plan**: the current lane is trimmed to its unfinished part and put back at
  the front of the queue. It then docks, services and charges to 80 % (for battery returns), undocks
  and resumes the saved plan.
- The robot's clean-water tank is 200 ml; flow is 0.12 / 0.22 / 0.35 ml/s.

## 9. Docking and the dock service cycle

Returning uses A\* to an approach pose 0.85 m in front of the dock. The final alignment uses the
dock's IR beacon, which is modelled as the known dock pose: align laterally on the dock axis, turn to
face the dock, creep in at 3–12 cm/s with heading and lateral correction, then settle onto the
contacts. If it misaligns or times out, it retries up to 3 times.

The dock runs a timed state machine in simulated time, while the robot charges throughout:

1. Contacts engaged
2. Self-empty (12 s; the dustbin is moved to the bag)
3. Mop wash (18 s; uses dock clean water, which becomes dirty water)
4. Water exchange (8 s; drains the robot's recovery tank and refills its clean tank)
5. Hot-air drying (20 s; only at the end of a mopping mission)
6. Ready

Phases that are not needed are skipped.

## 10. Operating modes

Robot modes: `idle, undocking, mapping, cleaning, returning, docking, maintenance, charging, manual,
paused, recovering, diagnostic, error`. Mission kinds: initial mapping, whole house, selected rooms,
spot, edge. Cleaning modes: vacuum, mop, vacuum + mop.

- `transitions.ts` holds two pure tables:
  - which user commands each mode accepts (the dashboard disables buttons and shows the reason), and
  - which mode transitions are legal.

  Invalid internal transitions are refused and logged.
- **Pause freezes the entire simulation** (clock, physics, sensors, battery, dirt, dock), not just
  motion.
- **Manual drive** keeps mapping and the safety reflexes on, and the vacuum can be toggled.
- The **diagnostic** self-test checks nine items: LiDAR ray rate, 360° rotation, odometry, brush /
  fan / mop actuators, cliff sensors, bumper and structured light.

## 11. Known limitations

- No localisation error, no SLAM loop closure, no wheel odometry drift in the map.
- Single-plane LiDAR, with no reflectivity model, no multipath and no glass or mirrors.
- Cleaning is a per-pass efficiency model with no airflow or fluid dynamics. Liquid does not spread,
  and the side brush does not physically move debris.
- Furniture collision footprints are boxes, discs or legs, and an office chair's star base is
  simplified to its central disc.
- Thresholds only animate the suspension; they do not resist motion.
- Doors are always open (openings only).
- Docking alignment uses the known dock pose (as an idealised beacon).
- Coverage reaches about 84–98 % of reachable floor, depending on clutter. Corners and narrow spaces
  around chair legs are the usual misses.
