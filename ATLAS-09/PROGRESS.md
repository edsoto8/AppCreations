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

