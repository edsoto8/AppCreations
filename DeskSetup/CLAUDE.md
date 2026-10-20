# CLAUDE.md

DeskSetup builds a photoreal minimalist desk scene with Blender's Python API (Blender 5.2 `bpy`
module, Python 3.13) and renders it in Cycles. `README.md` covers usage, configuration and the
layout solver.

## Commands

Run from this `DeskSetup/` folder (`.venv` holds `bpy==5.2.2` and `pytest`):

```bash
.venv/bin/python -m pytest                                  # all tests (bpy tests skip without bpy)
.venv/bin/python -m pytest tests/test_layout.py             # solver only, no Blender needed
ruff check .                                                # lint (config in pyproject.toml)
.venv/bin/python build.py --preview --views front           # quick visual check (~1 min)
.venv/bin/python build.py                                   # final renders + .blend -> output/ (~2 h on 4 cores)
```

## Architecture

- **Units: millimetres everywhere in our code.** `geometry.py` converts to Blender metres at the
  bpy boundary (`geo.v`, `geo.m`, `mesh_object` scales bmesh output). Keep 1 BU = 1 m so Cycles
  light units stay physical. Don't hand Blender raw mm values.
- **`config.py` and `layout.py` never import bpy.** All numbers live in `config.py`; every
  position is computed in `layout.solve`, which also validates (overlaps, reach) and produces the
  ergonomic report. Component builders don't invent positions; add new placement logic to the
  solver and test it in `tests/test_layout.py`.
- **One module per component** in `desksetup/components/`, each `build(cfg, layout, collection)`
  returning a root empty with parented parts. `scene.build` wires them together and gives each its
  own collection.
- **Materials are procedural and cached by name** (`materials._get`). Colours are linear RGB.
  New materials go in `materials.py`, not inline in components.
- **World frame:** origin on the floor under the desk centre, +X right, +Y away from the user
  (towards the wall), +Z up. Monitor-local frame: origin at the front-face centre, +Y into the
  monitor.

## Conventions

- Python 3.13, 4-space indent, line length 130, type hints on public functions.
- Field names carry units (`_mm`, `_in`, `_deg`). `None` means "solve it".
- Re-render the four views and commit `output/` when a change affects the look.
- No brand logos or trademarks in geometry or textures.
