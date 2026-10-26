# Asset Contract

The interface between the Blender/audio generators and the Godot project. Gameplay code relies on
every name, unit, pivot and orientation below. Change this file first if a contract has to change.

## Conventions (all models)

- **Units:** 1 Blender unit = 1 m = 1 Godot unit.
- **Axes:** build in Blender's native Z-up. The glTF exporter (`export_yup=True`) converts to Godot's
  Y-up. Blender **-Y** (the "front" view) becomes Godot **+Z**, which faces the game camera.
  Blender +X stays Godot +X (the direction the level runs).
- **Pivots:** origin at the bottom-centre of the object (where it touches the ground) unless a piece
  says otherwise. Transforms applied (location/rotation/scale zero/identity on export, except where a
  rig requires otherwise).
- **Files:** `game/assets/models/<name>.glb` (GLB, embedded materials, no textures needed). Editable
  sources in `assets/blender/source/<group>.blend`. Preview renders in `assets/blender/renders/`.
- **Materials:** shared palette materials from `assets/blender/lib/palette.py` (Principled BSDF:
  base colour, roughness 0.45–0.9, metallic 0 except coin). No image textures. Material names are
  stable (`M_Grass`, `M_Earth`, ...) and reused across files.
- **Style:** rounded, chunky, beveled shapes (bevel modifier / subdivision), strong silhouettes, flat
  colour blocks, no default-looking primitives. Smooth shading with auto-smooth/weighted normals.
- **Budgets:** character ≤ 15k triangles, enemies ≤ 6k, props ≤ 3k, terrain pieces ≤ 1.5k.

### Palette

| Name | Hex | Use |
|---|---|---|
| `M_Grass` | `#6CC24A` | grass tops, bushes |
| `M_GrassDark` | `#3E9A3A` | grass lips, shadows, pine foliage |
| `M_Earth` | `#B5713F` | soil |
| `M_EarthDark` | `#8A5230` | soil bands, pebbles |
| `M_Stone` | `#A89F94` | rocks, stones in soil |
| `M_Wood` | `#9A6435` | trunks, posts, signs |
| `M_WoodDark` | `#6B4226` | wood detail |
| `M_Leaf` | `#5DB84A` | round tree foliage |
| `M_Cloud` | `#FFFFFF` (rough 1.0) | clouds |
| `M_Gold` | `#FFC53D` (metallic 0.6, rough 0.3) | coins, goal emblem |
| `M_GoldDark` | `#E09A1A` | coin rim |
| `M_Jacket` | `#23A6A6` | explorer jacket |
| `M_JacketTrim` | `#FFC93C` | jacket collar / cuffs / zip |
| `M_Pack` | `#F2753A` | backpack |
| `M_Scarf` | `#E8483B` | scarf / hat band |
| `M_Pants` | `#2E3A6B` | trousers |
| `M_Boot` | `#7A4A2A` | boots |
| `M_Sole` | `#3B2A20` | boot soles, straps |
| `M_Skin` | `#F2C29B` | skin |
| `M_Hair` | `#4A2C1D` | hair, eyebrows |
| `M_EyeWhite` | `#FFFFFF` | eyes |
| `M_EyeDark` | `#1E1A2E` | pupils, mouth |
| `M_Blush` | `#F49A8C` | cheeks |
| `M_Bug` | `#8E4BB8` | Bramblebug shell |
| `M_BugSpot` | `#C08BE0` | Bramblebug spots / belly |
| `M_Puff` | `#FF8FA3` | Buzzpuff body |
| `M_Wing` | `#E8F6FF` (rough 0.3) | Buzzpuff wings |
| `M_Flower*` | `#FFFFFF`, `#FFD84A`, `#FF7AA8` | flowers |
| `M_Banner` | `#F2753A` | checkpoint / goal fabric |

## Character — `explorer.glb`

Original human-like explorer "Juni": colourful teal jacket with yellow trim, small orange backpack,
red scarf, navy trousers, **oversized** brown boots, large expressive eyes, rosy cheeks, tuft of dark
hair. Appealing cartoon proportions (head ≈ 1/3 of height, big hands and boots).

- Height: top of hair at **1.55 m**. Origin between the feet at ground level. Faces Blender -Y.
- Fits inside a capsule of radius 0.38 m, height 1.5 m (collision is Godot-side, just stay inside it
  at rest; animation may break it).
- Rig: one armature `Armature` with bones `root`, `hips`, `spine`, `chest`, `neck`, `head`,
  `upper_arm.L/R`, `forearm.L/R`, `hand.L/R`, `thigh.L/R`, `shin.L/R`, `foot.L/R`, `pack`. Parts may be
  rigidly skinned (weight 1.0 to one bone each) and joined into one mesh.
- Animations (glTF animation names, 30 fps, in place — `root` stays at the origin, no root motion):

| Name | Frames | Loop | Notes |
|---|---|---|---|
| `idle` | 60 | yes | breathing, small head tilt, pack bob |
| `walk` | 24 | yes | relaxed walk cycle |
| `run` | 16 | yes | energetic run, forward lean, big arm swing |
| `jump` | 10 | no | take-off: crouch→stretch, arms up; holds last pose |
| `fall` | 20 | yes | arms out, legs dangling, slight flail |
| `land` | 8 | no | squash on impact, recover |
| `celebrate` | 40 | yes | hop + fist pump, happy |
| `hurt` | 12 | no | recoil backwards, wince |

## Enemies

Both: origin at bottom-centre, face Blender -Y (Godot code turns them to face ±X). Silhouettes must
be readable and distinct from the player and from each other.

- **`bramblebug.glb`** — ground patroller. Round purple beetle with spotted shell, a little leaf
  sprout on top, stubby legs, big yellow-white eyes with a grumpy brow. ~0.9 m long, ~0.8 m tall.
  Animation `walk` (16 frames, loop): legs scuttle, body bobs. Optional `idle`.
- **`buzzpuff.glb`** — flyer that moves between two points. Round fuzzy pink puff (~0.8 m), two
  translucent-looking pale wings, tiny antennae, big eyes. Origin at the centre of the body
  (**exception**: it floats). Animation `fly` (8 frames, loop): fast wing flap, body bob.

## Collectibles and markers

- **`coin.glb`** — gold coin, 0.6 m diameter, 0.12 m thick, raised rim, embossed leaf/sun emblem.
  Disc faces Blender -Y (Godot +Z, the camera). **Origin at the centre** of the disc.
- **`checkpoint.glb`** — wooden post 2.4 m tall with a small cap. Separate child objects named
  exactly `Post` and `Flag`. `Flag` is a pennant whose origin is at its pole-attachment edge; Godot
  slides it from y=0.5 (lowered) to y=2.1 (raised) and swaps its colour, so model it raised-ready
  with origin at the flag's top-left attachment point, placed at y=2.1.
- **`goal.glb`** — finish marker: a wooden arch ~4 m wide × 4.5 m tall with bunting, and a big gold
  star/sun emblem on top as a separate child object named `Emblem` (origin at the emblem centre so
  Godot can spin it). Origin bottom-centre of the arch. The player walks through the arch.

## Terrain (modular, tiled by Godot along +X)

Every piece: **origin at the centre of the top walking surface** (x centre, y=top in Godot, z centre).
The walking surface is flat at height 0. Pieces tile seamlessly left–right with no gaps or overlaps
in the walk surface. Grass lip may overhang the front (camera side) by ≤ 0.15 m.

- `ground_mid_a.glb`, `ground_mid_b.glb`, `ground_mid_c.glb`: 1.0 m wide (x −0.5..0.5), depth 4.0 m
  (Blender y −2..2), soil down to −8.0 m. Grass band ~0.35 m on top, soil with stones/bands below.
  Variants differ in stones/tufts but share the exact side profile so any order tiles.
- `ground_cap_left.glb` / `ground_cap_right.glb`: 0.5 m wide end pieces with a rounded outer edge.
  **Caps are the exception to the centre rule:** their origin is at the **inner** edge of the top
  surface, so the left cap spans x −0.5..0 and the right cap x 0..0.5. Same depth and profile as the
  mids where they meet.
- `float_mid_a.glb`, `float_mid_b.glb`: floating grassy platform slice 1.0 m wide, depth 2.5 m,
  0.9 m thick with a rounded soil underside.
- `float_cap_left.glb` / `float_cap_right.glb`: 0.5 m end pieces, same inner-edge origin rule.

## Decoration (no collision)

`tree_round.glb` (~4.5 m), `tree_pine.glb` (~5 m, stylised tiered cones), `bush.glb` (~1 m),
`flowers.glb` (patch ~1 m), `grass_tuft.glb` (~0.4 m), `rock.glb` (~0.8 m), `mushroom.glb` (~0.6 m),
`fence.glb` (one 2.0 m segment, posts at both ends), `signpost.glb` (~1.6 m, arrow board pointing +X),
`hill_a.glb` / `hill_b.glb` (background hills ~24 m wide × 10 m tall, rounded, with a few bush bumps),
`cloud_a.glb` / `cloud_b.glb` (puffy, ~6 m wide, origin at centre).

## Manifest

The generator writes `game/assets/models/manifest.json`:
`{ "<name>": { "file": "<name>.glb", "bounds_min": [x,y,z], "bounds_max": [x,y,z], "triangles": n,
"animations": { "<anim>": frames } } }` with bounds in **Godot axes** (Y-up, +Z toward camera).

## Audio — `game/assets/audio/`

All original, procedurally synthesised by `assets/audio/synth_audio.py` (deterministic). 44.1 kHz
16-bit WAV for SFX (mono), OGG Vorbis for music (stereo, seamless loop).

| File | Use |
|---|---|
| `jump.wav` | jump take-off |
| `coin.wav` | coin pickup (bright two-note chime) |
| `stomp.wav` | stomping an enemy |
| `hurt.wav` | player takes damage |
| `checkpoint.wav` | checkpoint activated |
| `land.wav` | soft landing thud (quiet) |
| `fall.wav` | falling off the level / losing a life |
| `level_complete.wav` | finish fanfare (2–4 s) |
| `game_over.wav` | game over jingle (2–3 s) |
| `ui_move.wav`, `ui_select.wav` | menu navigation |
| `music_meadow.ogg` | looping level music, 120 BPM, major key, 32–64 s, loops seamlessly |
| `music_menu.ogg` | gentler looping menu music, 16–32 s |
