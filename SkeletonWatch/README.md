# Ajouré Skeleton Watch

A 3D skeleton (open-worked) wristwatch drawn with [three.js](https://threejs.org/) in a single HTML file.
Every wheel in the movement is modelled and geared to the next one with real tooth counts, so the
hands show the right time because the gears turn, not the other way round.

## Run

Open `index.html` in a browser. It needs an internet connection the first time, to load three.js
(r128) and the fonts from their CDNs. There is no build step.

## Controls

- Drag to turn the watch, scroll or pinch to zoom.
- Point at (or tap) a part to see its name and what it does.
- **Speed** runs time from 1x up to 3,600x so the slow wheels visibly turn.
- **Pull apart** lifts the layers of the movement away from the main plate.
- **Set to now** returns to the current time at real speed.

## The movement

| Part | Teeth / pinion | One turn every |
|---|---|---|
| Mainspring barrel | 72 | 6 hours |
| Centre wheel | 64 / 12 | 1 hour (minute hand) |
| Third wheel | 60 / 8 | 7.5 minutes |
| Fourth wheel | 70 / 8 | 1 minute (seconds hand) |
| Escape wheel | 15 / 7 | 6 seconds |
| Cannon pinion, minute wheel, hour wheel | 12, 36 / 10, 40 | 12 hours (hour hand) |

The balance beats 18,000 times an hour. At 1x speed the train advances in five ticks a second, as
the pallet fork releases the escape wheel. The ratchet and crown wheels (38 and 20 teeth) are the
winding gears and stay still.
