# Level 01 — "Brightmeadow Trail"

414 m long, 7 sections, 168 coins, 13 Bramblebugs, 7 Buzzpuffs, 3 checkpoints. Layout:
`game/levels/level_01.json` (all numbers in metres; gameplay on z = 0).

## Movement envelope it was designed against

From `MovementModel` with `movement_default.tres` (and confirmed in real physics by the tests):

| | Value |
|---|---|
| Full jump height | 2.30 m (tap: 0.89 m) |
| Flat jump reach, walking (6 m/s) | 4.20 m |
| Flat jump reach, running (9.5 m/s) | 6.65 m |
| Player height / capsule radius | 1.5 m / 0.35 m |

Rules used: rises ≤ 2.0 m, walking gaps ≤ 3 m (plus landing margin), running gaps ≤ 5 m, no jump
before the run tutorial sign needs running, enemies never patrol within 3 m of a spawn point,
flyers never pass through platforms. `tests/integration/test_level_feasibility.gd` checks all of
this against the live config, and `test_autoplay.gd` plays the level through real physics.

## Sections

| x (m) | Section | Teaches / tests |
|---|---|---|
| −8 | **Meadow Gate** | Walk sign, coin line, a 0.8 m step, a 2 m pit with a coin arc, first jump-through platform, first Bramblebug (walks toward you on open ground, coins above it invite a stomp). |
| 56 | **First Hops** | Platform hops over a pit, then the run sign and a 5 m running jump marked by a coin arc. Two Bramblebugs. Steps up to **checkpoint 1** (x 108). |
| 112 | **Stepping Hills** | Two 1.5 m terraces, a Bramblebug on the high ground, floating steps back down. |
| 143 | (valley floor) | First Buzzpuff glides low over flat ground (jump over or bop it), then a pit guarded by a vertical Buzzpuff — wait for it to dip. |
| 164 | **Buzzpuff Valley** | Rising platforms to an optional high bonus ledge, then a three-platform pit crossing with another vertical Buzzpuff. **Checkpoint 2** (x 203.5). |
| 216 | **Sky Steps** | The longest pit: six floating platforms of varying height, one with a Bramblebug, two running jumps, a vertical Buzzpuff in the widest gap. |
| 280 | **Bramble Ridge** | Terraces up to the ridge, a 5 m running jump, a ridge Bramblebug and Buzzpuff, platforms stepping back down. **Checkpoint 3** (x 334.5). |
| 352 | **Finish Field** | Last guarded gap, a final coin climb, a coin carpet, one last Bramblebug, the goal arch at x 394 and room to celebrate. |

Expected time: the bot (always running, never stopping) needs ~56 s; a first-time player who
explores, collects coins and loses a life or two should take roughly 3–5 minutes. That estimate
is a design judgement, not a measurement — it needs human playtesting.
