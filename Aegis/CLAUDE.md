# CLAUDE.md

Guidance for working in `Aegis/`, a procedural Blender (Python) scene: the AEGIS mechanical dragon.
`README.md` has the architecture, rig controls, timeline and known limitations.

## Commands

Run from `Aegis/`. Needs `pip install -r requirements.txt` (Blender 5.3 as the `bpy` module).

- Build + validate + save: `python3 build.py --milestone 6 --save aegis_dragon.blend`
- Review a change visually: `SPP=16 python3 preview.py 6 tag head,chest,front34` (studio light, no hangar)
- Check animation frames: `python3 posecheck.py 1:a 142:a 264:s`
- Final stills / frames: `python3 render_final.py stills|test|anim` (opens the saved .blend; `REBUILD=1` builds from code)

## Rules

- The code is the source of truth. Do not edit `aegis_dragon.blend` by hand; change `aegis/*.py`, rebuild, and re-save.
- Proportions live in `aegis/rig.py`. Geometry modules read them; do not duplicate coordinates.
- World frame: dragon faces −Y, +Z up, +X is its left (`.L`). Head parts are in head design units scaled by `rig.HS`.
- Mirroring: for wing bones, Z rotations flip sign between `.L` and `.R`; X rotations do not.
- After any rig or animation change, the validation printed by `build.py` must say `RESULT: PASS`.
- Always look at a render after a geometry change. Scripts running without error says nothing about how it looks.
- Only Cycles (CPU) is available headless. A 960×540 test at 16 samples takes about 30 s; keep previews small.
