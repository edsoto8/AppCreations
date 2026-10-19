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
- `mech/skeleton.py` holds every joint position and the bone hierarchy (32 bones: root, pelvis, spine, chest, neck,
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

