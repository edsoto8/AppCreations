# Horse Meadow (Horses3D)

A small three.js scene with a herd of fully 3D, procedurally built horses roaming a fenced pasture.
No models or textures are loaded. Every horse is assembled from three.js primitives (capsules,
spheres, cylinders, cones) and animated in code.

## Run it

ES modules need to be served over HTTP, so open it through any static server from this folder:

```bash
cd Horses3D
python3 -m http.server 8000      # or: npx serve .
# then open http://localhost:8000
```

three.js 0.170.0 is loaded from the jsDelivr CDN through an import map, so there is nothing to install.

## What you get

- **9 horses**: Bay, Chestnut (white socks and blaze), Palomino, Black, Dapple Grey, Pinto,
  Appaloosa, Buckskin, and a chestnut foal. Patterned coats use a generated canvas texture.
- **Real gaits**, each with its own leg timing: a 4-beat walk, a diagonal trot and a gallop, with
  smooth blending between them, plus body bob, pitch, lean into turns, head nod and tail swish.
- **Behaviour**: each horse picks its own activity (grazing with its head down, resting, walking,
  trotting, galloping) and steers around the others and the fence.
- **Scene**: rolling hills, instanced grass and flowers, a round paddock fence, hay bales, a water
  trough, low-poly trees, mountains, drifting clouds, soft shadows and dust when galloping.

## Controls

| Action | How |
|---|---|
| Orbit / zoom | Drag / scroll (pinch on touch) |
| Follow a horse | Click it, or click its name at the bottom |
| Stop following | `Esc`, or click empty ground |
| Herd mode | **Roam** (free), **Graze** (everyone eats), **Gallop** (the herd runs laps) |
| More horses | **+ Add horse** (up to 16, random coats) |

From the browser console, `window.meadow` exposes `scene`, `camera`, `controls`, `herd`,
`follow(horse)` and `addHorse({ coat, size })`.

## Files

```
Horses3D/
├── index.html      Page, UI overlay and import map
└── src/
    ├── main.js     Renderer, camera, herd setup, dust, UI and the frame loop
    ├── horse.js    Horse model (built from primitives), gaits, behaviour and animation
    └── world.js    Sky, lights, ground, grass, fence, props, trees, mountains, clouds
```
