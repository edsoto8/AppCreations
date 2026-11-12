# Storyboard — How Cash Works Inside an ATM

60 s · 1920 × 1080 · 30 fps (1,800 frames) · composition `ATMExplainer`.
Style: dark navy stage, brushed-metal ATM, green cash, blue electronic signals, amber mechanical highlights, white type.
All mechanisms are a **simplified, generic** illustration; real dispensers differ by manufacturer.

| # | Time | Frames | Scene | What the viewer sees |
|---|---|---|---|---|
| 1 | 0–6 s | 0–179 | **Introduction** | ATM rises into the centre, camera pushes in and slides it right. Title "How Does an ATM Dispense Cash?" builds word by word, subtitle "Inside the machine that handles your money", a floating fan of illustrative notes. The front panels begin to turn to glass as the camera dives toward the cabinet. |
| 2 | 6–16 s | 180–479 | **Inside the ATM** | Cutaway: the housing becomes a glass outline. Three cassettes slide into the safe. Six numbered callouts draw leader lines to their parts, each glowing amber in turn: 1 cash cassettes, 2 dispenser mechanism (pick rollers), 3 transport pathway, 4 bill sensors, 5 reject/retract area, 6 cash exit shutter. Note: "Simplified, generic illustration". |
| 3 | 16–25 s | 480–749 | **Customer requests cash** | Enlarged ATM screen: tap *Withdraw cash*, tap *$100*, "Requesting authorization". Right: ATM → ATM network/processor → issuer bank. A blue request pulse travels out, the bank checks "Card and account valid ✓ / Funds available ✓", a response pulse returns, "Withdrawal Approved". Footer: "Authorization is permission … no cash has moved yet." |
| 4 | 25–38 s | 750–1139 | **Selecting & counting** | Camera dives into the safe. Five $20 notes, one at a time: the front note is pulled off cassette A as the pick rollers turn, fed into the vertical transport, passes the sensor gate (green flash, tick), the diverter routes it to the stacker wheel, the stack grows. Counter 0 → 5 with progress chips; "5 × $20 = $100". Explainer card: single note ✓, overlapping ✕, misfed ✕ — "problem notes are flagged and not dispensed". |
| 5 | 38–49 s | 1140–1469 | **Dispensing** | The stack is clamped and carried up the presenter belts; the shutter slides open; the front closes back up and the bundle protrudes from the cash slot with a blinking lead-through light. A hand takes the cash; "$100 Dispensed"; shutter closes. Then the cutaway reopens on the reject area: an example red note is flagged at the sensor, the diverter flips and it drops into the reject/retract cassette. |
| 6 | 49–56 s | 1470–1679 | **Cash inventory updates** | Dashboard: $20 cassette counts down 500 → 495 (value $10,000 → $9,900, total −$100); $50 and $100 unchanged. Transaction record lists separate events: authorization approved, notes picked & stacked, cash presented, customer took cash, transaction completed & recorded. Note that these are distinct events and handling varies by ATM and processor. |
| 7 | 56–60 s | 1680–1799 | **Closing summary** | Full ATM hero shot. Chips: Request → Authorize → Select → Count → Dispense → Record. Title "Inside an ATM: Cash Management in Motion". Fade to black. |

## Transitions

- 1 → 2 and 4 → 5 are seamless: the camera at the end of one scene equals the start of the next.
- Other boundaries dissolve (12-frame fade + slight blur); the closing fades out over 24 frames.

## Sound map (all original, `public/audio/`)

| Scene | Cues |
|---|---|
| 1 | whoosh (open), tap (title), note flick, whoosh into cutaway |
| 2 | stack tap as cassettes seat, soft tick per callout |
| 3 | UI taps, data pulses on request/arrival/response, approval chime |
| 4 | roller motor loop, note pick per note, transport rustle, sensor tick, counter click, stack tap, soft chime at $100 |
| 5 | presenter motor, shutter open/close, cash taken, approval chime, whoosh, soft alert for the flagged note |
| 6 | counter clicks for 500 → 495, ticks for each record |
| 7 | whoosh, closing chime |

Music: original ambient bed (`music-bed.wav`, 96 BPM) under the whole video.
