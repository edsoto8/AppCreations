# SkyHop

SkyHop is a small endless arcade game in the style of the classic "tap to flap" games. You steer a round
orange bird through an endless line of stone pillars. Each tap gives the bird a hop, and gravity pulls it
back down. Every pillar pair you pass scores one point. The game speeds up slowly as your score grows,
and your best score is saved on your device.

All artwork is drawn in code and all sounds are synthesized at runtime. There are no image or audio
files, and nothing is copied from any existing game.

## Technology

- **.NET 10**, C#
- **Blazor WebAssembly**, so the game runs in any modern browser on desktop, phone or tablet and needs no server
- **HTML canvas** for drawing, and the **Web Audio API** for sound effects
- **xUnit** for tests
- Browser **localStorage** for the high score and the mute setting

## Build and run

```bash
dotnet restore
dotnet build
dotnet run --project src/SkyHop.Web
```

Then open <http://localhost:5180>. Run all commands from this `SkyHop/` folder.

Run the tests with `dotnet test`.

To host the game anywhere that serves static files, publish it:

```bash
dotnet publish src/SkyHop.Web -c Release -o publish
```

Then serve the `publish/wwwroot` folder. (`publish/` is local build output; don't commit it.)

## Controls

| Action | Desktop | Phone / tablet |
|---|---|---|
| Flap (also start, resume, restart) | Space, Up Arrow, or left mouse click | Tap anywhere |
| Pause / resume | P or Esc, or the pause button | Pause button |
| Mute / unmute | M, or the speaker button | Speaker button |
| Debug overlay | `` ` `` (backquote) | Open the page with `?debug=1` |

- One press is one flap. Holding a key down does not repeat.
- The game pauses on its own when the window loses focus or the tab goes to the background. It only
  carries on after you tap, press Space or press Resume.

## How it plays

1. **Start**: the bird bobs on the title screen. Nothing happens until you flap.
2. **Playing**: gravity is on, pillars scroll in from the right, and each pair you pass scores one point.
3. **Game Over**: hitting a pillar or the ground plays a short fall animation, then shows your score
   and best. Tap, press Space or press Restart to play again straight away. Taps in the first 0.6 s
   after Game Over are ignored, so a panicked tap does not skip the panel.

Difficulty depends only on your score:

| Score | Tier | What changes |
|---|---|---|
| 0–10 | Beginner | Constant base speed, wide gaps, gentle gap placement |
| 11–25 | Moderate | Speed rises 2 units/s per point; gaps and spacing tighten slightly; gap positions vary more |
| 26+ | Advanced | Speed rises 1 unit/s per point up to a cap; everything else keeps easing toward its limit |

The scroll speed eases toward each new target instead of jumping. Gaps never shrink below a minimum
size. Neighbouring gaps always overlap vertically, so no pattern needs a perfect dive.

The game runs in a fixed 360 × 640 world that is scaled to fit the screen. Tall phones see a little
extra sky and ground, and wide screens get side bars. Screen size never changes the difficulty.

## Project structure

```
SkyHop/
├── src/
│   ├── SkyHop.Core/            Game logic only (no UI and no browser code)
│   │   ├── GameConfig.cs       All tuning values
│   │   ├── Game.cs             Main simulation: states, fixed-step update, collisions, events
│   │   ├── GameState.cs        GameState enum + GameStateManager (allowed transitions)
│   │   ├── Player.cs           Player state
│   │   ├── PlayerPhysics.cs    Gravity, flap, rotation and wing animation
│   │   ├── ObstaclePair.cs     Top/bottom pillar pair and its hitboxes
│   │   ├── ObstacleSpawner.cs  Spawns, moves and recycles pairs (object pool)
│   │   ├── GapGenerator.cs     Random gap placement within safe bounds
│   │   ├── DifficultyManager.cs  Score → speed, gap size, spacing, gap variation
│   │   ├── ScoreManager.cs     Score, best score, IHighScoreStore
│   │   ├── Collision.cs        Circle-vs-rectangle test
│   │   └── Input.cs            InputAction and GameEvent enums
│   └── SkyHop.Web/             Blazor WebAssembly front end
│       ├── Components/GameView.razor(.cs)  Hosts the game; start / pause / game-over overlays
│       ├── Services/           localStorage high-score store, per-frame snapshot for the renderer
│       └── wwwroot/js/
│           ├── main.js         Frame loop (requestAnimationFrame → Tick → draw)
│           ├── input.js        Keyboard / mouse / touch → actions; focus-loss pause
│           ├── renderer.js     Canvas drawing, parallax, animations, debug overlay
│           └── audio.js        Synthesized sound effects
└── tests/SkyHop.Tests/         xUnit tests for the core game logic
```

The game logic in `SkyHop.Core` knows nothing about browsers. The web project sends it actions and
frame times and draws what it reports. JavaScript handles only drawing, raw input and sound.

## Tuning the gameplay

Every gameplay value lives in **`src/SkyHop.Core/GameConfig.cs`**, grouped as `World`, `Player`,
`Obstacles`, `Difficulty` and `Timing`. Examples are gravity, flap strength, maximum fall speed,
hitbox size, gap size, pillar spacing, speed per point, tier thresholds and how long death lasts.
The tests use these same values. Run `dotnet test` after changing them: one test has a simple bot
play every difficulty tier, which checks that your tuning can still be beaten.

By default the top of the screen is a soft ceiling that holds the bird under it. Set
`World.CeilingIsLethal = true` to make flying off the top end the run instead.

## Debug mode

Debug mode is off by default. Turn it on by opening <http://localhost:5180/?debug=1>, or press
`` ` `` (backquote) during play. It shows:

- the player hitbox (red circle) and pillar hitboxes (green rectangles), which are slightly smaller
  than the artwork on purpose
- FPS, current state, vertical velocity, rotation, scroll speed, difficulty tier, score and the
  number of active pillar pairs

In debug mode, the current frame snapshot is also available as `window.skyhopDebug` in the browser console.

## Tests

`dotnet test` runs the xUnit suite in `tests/SkyHop.Tests`. It covers:

- **Scoring**: passing a pair gives exactly one point, never twice, and only after its center is passed
- **High score**: a higher score replaces the best, a lower or equal one does not, and the best
  reloads on startup
- **Difficulty**: tier thresholds, per-point increases, the limits (maximum speed, minimum gap), and
  the speed easing in
- **Obstacles**: gaps stay within bounds, the shift between gaps stays within its limit, spacing is
  exact, pairs are pooled with no growth over a 10-minute run, and long frames leave no holes
- **Game states**: Start → Playing → Dying → Game Over → Playing, pause on focus loss, the restart
  lock, and 25 back-to-back games
- **Physics**: deterministic results, the fixed timestep giving the same result at 30 and 60 FPS,
  the fall-speed cap, rotation and the ceiling
- **Fairness**: an autopilot bot reaches the maximum-speed tier on every tested seed
