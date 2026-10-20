# ATLAS-09 — Progress Log

Source of truth for this build. A fresh session should be able to resume from this file alone.

## Environment (Section 0)

| Item | Value |
|---|---|
| Blender | `bpy` 5.2.2 LTS (pip module, headless). No `blender` binary on PATH. |
| Python | 3.13.16 (venv at `/opt/bpyenv`, created with `python3 -m venv`; `pip install bpy==5.2.2 pillow`) |
| CPU | Intel Xeon @ 2.80 GHz, 4 cores (`nproc` = 4) |
| GPU | None (`nvidia-smi` not found). Cycles runs on CPU only. |
| RAM | 15 GiB, no swap |
| EEVEE | **Unavailable**: `libEGL.so.1` is missing, and selecting EEVEE aborts the process. All renders, previews included, use Cycles CPU. |

Render settings chosen from the hardware:
- Preview / contact sheets: Cycles CPU, 640x360 (contact-sheet tiles smaller), 32 samples, OpenImageDenoise.
- Finals: Cycles CPU, 1920x1080, 128 samples target with OIDN. Each final is capped at about 20 min; samples drop before resolution does.

How to run: `cd ATLAS-09 && /opt/bpyenv/bin/python generate_mech.py --help`

## Milestones

| # | Milestone | Status |
|---|---|---|
| 0 | Environment check | done |
| 1 | Proportions and mechanical skeleton | in progress |
| 2 | Major structural components | todo |
| 3 | Articulated joints and hydraulic systems | todo |
| 4 | Armor plating and detailed mechanical components | todo |
| 5 | Cables, fasteners, sensors, surface details | todo |
| 6 | Materials and procedural textures | todo |
| 7 | Rigging and demonstration poses | todo |
| 8 | Presentation scene and final renders | todo |
| 9 | Inspect renders, fix defects, improve | todo |

## Milestone log

### Milestone 1: proportions and mechanical skeleton (done)

- Package layout: `generate_mech.py` (entry point) → `mech/` (`utils`, `primitives`, `skeleton`, `materials`,
  `qc`, `blockout`, part modules). Every run purges the `ATLAS-09*` collections and orphan data before it rebuilds.
- `mech/skeleton.py` holds every joint position and the bone hierarchy (27 bones: root, pelvis, spine, chest, neck,
  head, sensor, shoulder/upperarm/forearm/wrist ×2, thigh/shin/foot/toe ×2, 3 gripper fingers, tool spindle).
  Hip at z=2.10, knee 1.26, ankle 0.42, shoulder 3.20, head top about 3.95, antennas about 4.2 m.
- Blockout (`--milestone 1`): one proxy volume per bone plus joint markers, 50 objects.
- Git: the repo already existed (`AppCreations`), so there was no `git init`. Work is on branch `claude/atlas-09-mech`.

QC contact sheet `renders/qc_m1.png`, defects found:
1. The factory-startup Cube stayed in the scene (it lives in `Collection`, not the scene root). **Fixed**: purge now removes the
   default Cube/Light/Camera and the empty `Collection`.
2. Ortho front/side/back views cropped the mech (ortho scale 4.6 m across a 1.6 aspect only covers 2.9 m height).
   **Fixed**: scale 7.2.
3. The close-arm camera was too close. **Fixed**: re-aimed.
4. Proportions are acceptable: heavy torso, legs about 53% of height, arms reach mid-thigh. The legs read thin, which the
   armor in M2/M4 must correct. The knee sits forward of the hip/ankle line, a deliberate load-bearing stance.
5. Connectivity check flags blockout joint markers as floating (expected: proxies have gaps). Not carried forward.

### Milestones 2–5: structure, joints/hydraulics, armor, cables/fasteners/sensors (done)

The part modules (`parts_legs.py`, `parts_torso.py`, `parts_head.py`, `parts_arms.py`, `cables.py`) were written
together but every feature is gated by `--milestone`, so each stage builds and was QC'd on its own
(`renders/qc_m2.png` … `qc_m5.png`). Generators added to `primitives.py`: bmesh builders (box, cylinder, lathe,
tube, torus, prism with bisect cuts + bend/warp, gear, helix, beam, rod) and assemblies (linked-duplicate bolts,
bolt rings/lines, louvre vents with Array modifier, cooling-fin stacks with Array modifier, shrouded fans, slewing
bearings, clevis hinges, geared joint drums, Damped-Track hydraulic pistons, Stretch-To coil-over shocks, weld seams via
Array+Curve modifiers, chamfered/bent armor plates). Each object carries `ob["bone"]` for the M7 rig.

- **M2 structure**: pelvis core and keel, waist column, chest floor, tapered chevron chest hull (prism, bisected and
  warped), keel, power pack, roll bar, neck mount, shoulder sockets, limb hubs/cores/yokes, foot base, split toes,
  sole pads, head shell (tapered, sloped brow), sensor bay, palm/fingers, drill motor/bit.
  QC defects: (1) segments float apart. Expected, since the joints that connect them are M3 (connectivity check listed
  every torso/arm part); resolved in M3. (2) Pelvis reads small next to the chest (accepted, mech style).
- **M3 joints + hydraulics**: hip/knee/ankle/toe/shoulder/elbow/head-pitch geared drums + clevis lugs; waist, neck,
  shoulder, wrist, lidar slewing bearings; 46 hydraulic cylinders (knee front/rear, hip, ankle, toe, waist, bicep,
  tricep, shoulder, head tilt, gripper fingers) and 4 coil-over shocks; manifolds, pump, wrist pinion drive.
  QC: connectivity check passes (`floating: []`) and 0 mesh problems. Defect: thighs thin from the front (fixed in M4).
- **M4 armor + mechanics**: layered, bent armor on chest/flanks/belly/collar/top deck, pelvis codpiece, abdomen bands,
  tassets, thigh/knee/shin/foot/toe plates, pauldrons, upper-arm and forearm plates, brow/cheek/top head plates;
  power core (bezel, hex frame, emissive cell, glass, guard bars), radiator, fans, exhaust stacks + heat shields,
  vents, camera pods, lens cluster, rotating lidar drum.
  QC defects → fixes: (1) dark layered chest plates read as a pair of "eyes" → replaced with a raised top band plus
  boolean-cut cooling slots; (2) thigh outer armor hidden behind the knee lugs → moved outboard and enlarged;
  (3) smooth dome pauldrons looked toy-like → faceted 7-flat bent-plate shells with Solidify + Bevel; (4) thighs still
  thin → wider femur/hub plus front-outer/inner corner shields; (5) camera pods looked like yellow toy "ears" → steel.
- **M5 cables, fasteners, sensors, details**: 473 linked-duplicate fasteners (hex, socket, rivet meshes), 40+ hoses
  and cable bundles (NURBS curves with bevel and crimped fittings; joint-crossing runs record their two bones for hooks),
  stencil labels/serials ("ATLAS-09", "SN 0917-AX", "HYD 210 BAR", "DANGER HIGH PRESSURE", "NO STEP"), hazard strips,
  LED indicators and light bars, access panels, weld seams, antennas (whip with spring base, blade, GPS puck), coupler
  pins and quick-connects.
  QC defects → fixes: (1) orange core conduits looped in front of the core like a mouth → rerouted down the flanks;
  (2) `close_arm` QC camera badly framed → re-aimed; (3) degenerate faces on small bevelled cylinders and gears
  (bevel offset larger than the face) → cylinder bevel limited to cap rims, gear bevel limited to 20% of tooth land;
  (4) lidar window was an open surface (82 non-manifold edges) → closed annular-sector prism.

Boolean log: thigh vent slots and chest cooling slots cut cleanly with EXACT. The fan bore on the back fans was first
wrongly rejected by the "lost >50% volume" sanity check, because a fan bore legitimately removes about 55% of the
plate. `boolean_cut` now takes `min_keep`. Earlier the fan-hole cut ran against a self-intersecting multi-shell housing
and EXACT produced an empty result. Fixed by moving the bore into a separate simple mounting plate.

Counts at M5: 641 parts + 473 fasteners = 1,114 visible robot objects (Torso 267, Head 105, Leg_L/R 223 each,
Arm_L 150, Arm_R 146).

### Milestone 6: materials and procedural textures (done)

`mech/materials.py` now holds both the flat blockout set (M1–M5) and the procedural PBR set, built by a small node-graph
builder (`NB`). The recipes:
- `painted()` (weathered yellow armor, dark armor, painted industrial steel, greasy joint steel, spring paint, stencil
  paint): per-object tint from Object Info > Random; large-scale fading; **edge wear** from a Bevel-node normal vs true
  normal mask, broken up by noise, revealing bare metal; **scratches** from contour lines of 90×-stretched noise, gated by a
  second noise; **AO cavity grime/grease**; roughness noise; bump that sinks the chipped areas.
- `hazard()`: painted recipe with a diagonal saw-wave stripe pattern injected as the paint colour.
- `brushed_titanium()` (anisotropic, stretched-noise brushing), `chrome()` (smudges + oil film for piston rods),
  `rubber()`/`plastic()` (dust, cavity dirt, micro bump), `carbon()` (checker + band weave under a clear coat),
  `emissive()` (blue core / amber optics / red and green LEDs with slight noise flicker), `glass()` (transmission),
  `lens_inner()` (coated optics with thin-film iridescence), `grease()`, `metal()` (bolts with rust spots, gears with
  heavy grime, welds with heat-tint banding, copper), `concrete()` (voronoi cracks, stains), `floor_paint()`.
- Reproducibility: every Mapping-node offset comes from `utils.rng(material name)` (seed 9009). Object Info Random
  hashes object names, so it is deterministic too.

QC (`renders/qc_m6.png` plus close-ups) defects → fixes:
1. Yellow read pale/buttery under AgX Medium-High Contrast → base paint pushed to (0.90, 0.47, 0.008).
2. Edge wear barely visible → Bevel mask gain 9→14 and threshold lowered; still deliberately subtle.
3. Scratches on dark steel looked like stray hairs → thinner contour lines (×120), sparser gate, steel scratch 0.6→0.35.
4. Render cost: 800×600 at 48 samples takes about 70 s per view on 4 CPU cores. Bevel and AO nodes run at 4 and 8 samples to
   keep that bounded. Finals at 1080p will need about 96–128 samples to fit the 20-minute cap (measured in M8).

### Milestone 7: rigging and demonstration poses (done)

`mech/rig.py`:
- Armature `ATLAS-09_Rig` (27 bones) from `skeleton.BONES`. Each roll is set with `align_roll(worldX × boneY)` so every
  limb bone's local X equals world X. Hip/knee/ankle/toe/elbow/finger bends are all X rotations; shoulder pitch is the
  shoulder bone's Y; wrist rotation, head yaw, waist twist, lidar spin and drill spin are Y rotations of their bones.
- 1,122 tagged objects are bone-parented with world transforms preserved. Hydraulics: each cylinder/rod pair hangs
  under two anchor empties on different bones, and each part has a Damped Track (TRACK_Y) aimed at the other anchor.
  Coil springs use Stretch To with no volume change. Piston rod/barrel fractions were re-dimensioned
  (`rod_frac`, `barrel_frac`) so rods neither leave the barrel nor punch through its base over the posed range.
- 32 joint-crossing cables get 64 Hook modifiers: the far half follows the second bone, and the mid point is
  shared 50/50.
- Actions (fake-user, so both persist in the .blend): **Neutral** (frame 1: settled stance, arms slightly forward,
  elbows 14°, gripper open) and **Demo** (frames 1→48: pelvis drops 16 cm with 4° pitch, waist twist, head yaw 28°,
  lidar spin, gripper arm reaching forward with the gripper closing, drill arm braced forward with the spindle turned,
  right foot stepping forward). Legs come from an analytic 2-bone IK in the sagittal plane, so both feet stay flat.
  `rig.set_pose(rig, "Demo"|"Neutral"|"rest")` selects the action (and slot) and jumps to its last key.
- QC: `renders/qc_m7_neutral.png`, `renders/qc_m7_demo.png`. The intersection test (BVH triangle overlap between
  lower legs L/R, thighs L/R, lower arms vs torso/thighs/shins) gives 0 overlaps in both Neutral and Demo.
  Connectivity check: 0 floating. Mesh check: 0 problems.

QC defects → fixes:
1. Demo first rendered with the gripper arm swinging *backward*: shoulder bones run along ±X, so "forward" is −Y
   rotation on the left and +Y on the right. Fixed and commented in `pose_values`.
2. Pauldron outer end was open (visible ring from the side) → profile closed to the axis.

### Milestone 8: presentation scene and final renders (done; finals rendered after the M9 fixes below)

`mech/scene.py`:
- Octagonal concrete display platform (r 3.1 m, 0.25 m high, feet at z=0) with a hazard band, steel nosing,
  painted rings, chevrons, "BAY 09" / "MAX LOAD 42 t" stencils, tie-down rings and four hazard bollards.
- Hangar: concrete floor with walkway lines, hazard zone and a drain grate; ribbed back wall with columns, amber wall
  lights and a roof girder truss; a side wall (backdrop for the side reference view); three crates for depth.
- Lights: warm key area light, low cool fill, **strong cool-left / warm-right rim area lights**, soft top light, two
  spot "shaft" lights behind the stage, and a low kicker. Contact shadows come from the area lights (shadows are on).
- Atmosphere: a 28×24×11 m box with Principled Volume (density 0.0025, anisotropy 0.35), volume bounces 0, step
  rate 4. It is hidden for the orthographic reference cameras so they stay crisp.
- Cameras (all named as required): `cam_hero` (30 mm, low angle, f/5.6, Demo pose), `cam_three_quarter`
  (42 mm, f/6.3, Neutral), `cam_torso_head` (55 mm, f/2.8, Neutral), `cam_leg_hydraulics` (42 mm, f/3.5, Demo),
  `cam_front` and `cam_side` (orthographic, 8.6 m, Neutral, no DOF). Each camera stores its pose and output
  filename; `scene.render_all` sets the action per camera, so both actions are verified in the finals.

QC (`renders/preview/*.png` at 640×360) defects → fixes:
1. First previews were blown out to white: haze density 0.012 + 30 kW shaft spots lit the whole volume →
   density 0.0025, shafts 5 kW / 3.5 kW, key/fill/top reduced, rims increased, darker world and concrete.
2. Ortho front/side looked through 24 m of fog → haze hidden for orthographic cameras.
3. Side reference view had a black void behind it → added a side wall.
4. Hazard band on the platform went solid yellow on some octagon faces (stripes depended only on rotated X/Y)
   → stripes now driven by dot(position, (1,1,1)), diagonal on every face orientation.
5. "BAY 09" stencil too faint at grazing angles → larger, brighter paint.
6. Render cost: the first 1080p hero at 64 samples took **907 s**. Profiling at 480×270 (32 samples): base 30.4 s, no volume
   26.4 s, AO 8→1 sample 21.3 s, Bevel 4→1 18.2 s. Kept the volume, set AO to 2 samples. Bevel stays at 4: at 2
   samples the bevel-normal noise made the ×14 edge mask fire everywhere and every painted surface rendered as
   bare worn metal (beige). Finals use **96 samples** (about 15–18 min per frame) to stay within the about 20-minute cap.

### Milestone 9: inspect renders, fix defects, improve (done)

**Final pass 1** (96 samples, 1920×1080) took 1230 / 1191 / 1439 / 1536 / 977 / 932 s
(hero / three-quarter / torso-head / leg-hydraulics / front / side). Every PNG was opened and inspected.

Defects found in pass 1 → fixes:
1. Painted steel read mid-grey/beige under the strong area lights, which flattened contrast with the yellow armor →
   steel_dark 0.10→0.055, armor_dark 0.055→0.035, joint steel 0.085→0.05.
2. The power-core blue clipped to near-white (emission 18) → 7, with a more saturated blue.
3. `three_quarter.png` clipped the antenna tip; `torso_head.png` cut off the lidar dome and antennas → lens and aim adjusted.
4. `side.png` was washed out by the warm right rim light striking the flank and had a crate cluttering the background →
   rim light moved further behind; crates and haze hidden for the orthographic reference cameras.
5. The DOF close-ups (torso-head 1439 s, leg-hydraulics 1536 s) went over the ~20-minute cap → those cameras now use 0.75× samples
   (72) via `scene.SAMPLE_SCALE`.
6. QC contact sheet inside the full scene: the back QC camera sat behind the hangar wall (black tile) and the ortho tiles
   looked through the haze → back camera moved inside the hangar; haze hidden for ortho QC tiles.

Earlier M9 improvements (before pass 1), from reviewing the M8 previews:
- **Geometry Nodes** (the brief asked for them "where useful"): two node groups built in Python, `ATLAS_GN_RivetRow`
  (Mesh Line → Instance on Points) and `ATLAS_GN_Tread` (grid → alternating ±45° lozenges). They put 77 instanced rivets
  on the power pack, chest floor, pelvis and shin rails, plus anti-slip tread on both foot insteps. Blender 5.2 changed the
  modifier-input API (`mod[identifier]` → `mod.properties.inputs.<id>.value`). The first attempt failed for every
  modifier (logged as `GN` errors); `_set_inputs` now supports both APIs.
- **Subdivision Surface** on rubber sole pads, toe pads, heel bumpers and gripper pads.
- Exoskeletal **chest frame posts** following the hull taper on both rear corners (the "internal structural frame" was
  barely visible before).
- Demo pose reworked twice for a readable hero silhouette (gripper first bunched up beside the head): drill arm thrust
  forward, gripper low and forward, head tracking the drill.
- Hazard band stripes fixed on all platform faces; floor stencil enlarged.

**Final validation** (`build_report.json`, milestone 9): 597 meshes checked → 0 problems; connectivity → 0 floating;
intersections (8 subsystem pairs × Neutral and Demo) → all 0; build log has no Boolean, GN or mesh errors;
27 bones, 1,128 objects bone-parented, 64 cable hooks.

**Deliverable verification** (headless reopen of `ATLAS-09.blend`, then two rebuilds *inside* that file): 1,253 objects,
641 meshes, 30 materials, 62 curves, 1,120 visible robot objects (477 fasteners), armature `ATLAS-09_Rig`, actions
`Demo` + `Neutral`, cameras cam_front/cam_hero/cam_leg_hydraulics/cam_side/cam_three_quarter/cam_torso_head.
- **Bug found by this check**: each rerun added `Demo.001`, `Neutral.001` and so on, because the actions carry fake users and
  survive the orphan purge. Fixed: generated actions are tagged `atlas09` and deleted in `purge_generated`.
  The re-check after the fix gives identical counts on all three passes (`IDEMPOTENT True`).

**Final pass 2**: see `renders/timings.txt` for the per-frame times of the delivered renders.

## Unfinished, degraded or deviating items (final summary)

- **Final samples reduced to 96 (72 for the two DOF close-ups)** instead of the requested 128–256: CPU-only rendering
  (4 cores, no GPU) costs about 12–25 min per 1080p frame at these settings. Resolution was kept at 1920×1080.
- **EEVEE unavailable** (no `libEGL.so.1` in the container), so every preview and QC pass used Cycles CPU at low samples.
- **No `blender` binary**: the pip `bpy` 5.2.2 module was used. `generate_mech.py` also accepts `blender -b --python … --`
  but that path was not exercised here.
- **Leg IK is sagittal only**: the Demo stance changes hip/knee/ankle pitch and pelvis height; there is no hip yaw/roll
  in the poses (the rig supports them, the IK helper does not solve them).
- **Cable hooks** bend each joint-crossing hose at one shared midpoint; there is no slack simulation. Under large
  rotations a hose can straighten or kink.
- **Bevel-node edge mask needs 4 samples**: at fewer, noise turns every painted surface into worn bare metal, so it
  remains one of the main render costs.
- **Hip drum etc. are not collision-tested against armor at extreme angles**: the intersection test covers the
  Neutral and Demo poses only.
- Repo note: `git init` was not needed (the project lives inside the existing `AppCreations` repo, branch
  `claude/atlas-09-mech`).
