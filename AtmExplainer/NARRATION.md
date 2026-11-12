# Narration — How Cash Works Inside an ATM

No text-to-speech engine or voice service was available in the build environment, so the video carries this
script as **on-screen captions** and is fully understandable without audio. To add a voice-over, record these
lines to the timings below (≈ 145 words, a calm explainer pace), save as `public/audio/voiceover.wav`, and add an
`<Audio>` element for it to the "Music" track in `src/ATMExplainer.tsx` (lower the music volume to ~0.4).

The same lines live in `src/narration.ts`, which drives the captions — edit both together.

| Time | Scene | Line |
|---|---|---|
| 0.6–5.6 s | Introduction | Every time you withdraw cash, a precise machine goes to work. |
| 6.3–10.9 s | Inside the ATM | Inside, cash is stored in removable cassettes — usually one denomination per cassette. |
| 11.1–15.8 s | Inside the ATM | A dispenser picks notes, moves them past sensors along a transport path, and on to the exit shutter. |
| 16.3–20.4 s | Request | When you ask for $100, the ATM first requests authorization. |
| 20.6–24.8 s | Request | The request travels through the network to your bank, which approves it. No cash has moved yet. |
| 25.3–31.0 s | Counting | Now the mechanics begin: pick rollers pull $20 notes from the cassette, one at a time. |
| 31.2–37.8 s | Counting | Sensors check every note as it passes. Five notes at $20 each — one hundred dollars. |
| 38.3–45.6 s | Dispensing | The notes are gathered into a stack and carried to the shutter, which opens to present your cash. |
| 46.0–48.9 s | Dispensing | A note that feeds incorrectly can be diverted to a reject area instead. |
| 49.3–55.8 s | Inventory | Finally, the ATM updates its cash inventory and records each event, for monitoring and reconciliation. |
| 56.2–59.4 s | Closing | Request. Authorize. Select. Count. Dispense. Record. |

## Accuracy notes for the narrator

- Authorization is **permission**, not payment: the issuer approves (typically placing a hold); the cash is then
  dispensed and the transaction completed/posted. Exact handling varies by ATM, network and processor.
- "Reject area": many dispensers divert notes that fail checks (double, skewed, damaged) to a reject cassette;
  some machines also retract cash a customer leaves behind, by policy. Designs vary — the video says so.
- Do not describe security features, lock procedures or ways to manipulate hardware.
