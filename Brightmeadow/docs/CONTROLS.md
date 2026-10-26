# Controls

Keys are bound by physical position, so they work on any keyboard layout. The bindings live in
`game/scripts/core/input_setup.gd`.

| Action | Keyboard (macOS / any) | Gamepad |
|---|---|---|
| Walk left / right | `A` / `D` or `←` / `→` | Left stick or d-pad |
| Run (hold) | `Shift` (or `X`, `J`) | `X` / right shoulder |
| Jump (hold for higher) | `Space` (or `W`, `↑`, `Z`, `K`) | `A` |
| Pause / resume | `Esc` or `P` | `Start` |
| Restart level | `R` (in play, paused or on game over) | `Back` |
| Fullscreen | `F` | — |
| Mute | `M` | — |
| Debug overlay (position, speed, state, FPS) | `F3` | — |
| Menus | `↑` `↓` + `Enter`/`Space`, or the mouse | d-pad + `A` |

`Cmd+Q` quits on macOS as usual.

## Rules in one breath

Run right to the finish arch. Jump on Bramblebugs and Buzzpuffs from above to bop them (hold jump
while landing on one to bounce higher); touching them from the side costs a heart and gives a
moment of invulnerability. Three hearts per life, three lives. Falling into a pit costs a life.
Flags are checkpoints: you come back at the last one you raised. Floating grassy platforms can be
jumped up through from below.
