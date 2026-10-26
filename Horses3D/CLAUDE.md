# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this folder.

## Project Overview

Horse Meadow is a static three.js page: procedurally built, animated 3D horses in a pasture.
Plain ES modules, no build step, no package.json. `README.md` covers controls and features.

## Commands

```bash
python3 -m http.server 8000   # from this Horses3D/ folder, then open http://localhost:8000
```

There are no tests. Check changes by loading the page and watching the browser console;
`window.meadow` exposes the scene, camera, controls and herd for poking at state.

## Key Decisions

- **three.js comes from the CDN** via the import map in `index.html`, pinned to an exact version
  (`three@0.170.0`). Keep `three` and `three/addons/` on the same version.
- **Horse local axes**: +Z forward, +Y up, root on the ground. Leg arrays are ordered
  left-front, right-front, left-hind, right-hind. Negative `rotation.x` on a hip swings the leg forward.
- **Gaits are data.** `GAITS` in `horse.js` holds speed, stride frequency, swing amplitude, knee bend,
  bob, pitch, nod and per-leg phase offsets. Animation blends toward the target gait every frame;
  tune gaits there rather than in the pose code.
- **Behaviour** lives in `Horse.#think` (state choice) and `Horse.update` (steering, fence and
  separation). Herd-wide settings are on the `herd` object in `main.js`.
- `world.js` exports `FENCE_RADIUS` and `groundHeight`; the paddock inside the fence is flat (y = 0).
