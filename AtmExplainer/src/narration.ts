/**
 * Narration script, timed in seconds. Shown as on-screen captions (the video is complete without audio
 * narration); NARRATION.md has the same script for recording a voice-over.
 */
export const NARRATION: Array<{ from: number; to: number; text: string }> = [
  { from: 0.6, to: 5.6, text: 'Every time you withdraw cash, a precise machine goes to work.' },
  { from: 6.3, to: 10.9, text: 'Inside, cash is stored in removable cassettes — usually one denomination per cassette.' },
  { from: 11.1, to: 15.8, text: 'A dispenser picks notes, moves them past sensors along a transport path, and on to the exit shutter.' },
  { from: 16.3, to: 20.4, text: 'When you ask for $100, the ATM first requests authorization.' },
  { from: 20.6, to: 24.8, text: 'The request travels through the network to your bank, which approves it. No cash has moved yet.' },
  { from: 25.3, to: 31.0, text: 'Now the mechanics begin: pick rollers pull $20 notes from the cassette, one at a time.' },
  { from: 31.2, to: 37.8, text: 'Sensors check every note as it passes. Five notes at $20 each — one hundred dollars.' },
  { from: 38.3, to: 45.6, text: 'The notes are gathered into a stack and carried to the shutter, which opens to present your cash.' },
  { from: 46.0, to: 48.9, text: 'A note that feeds incorrectly can be diverted to a reject area instead.' },
  { from: 49.3, to: 55.8, text: 'Finally, the ATM updates its cash inventory and records each event, for monitoring and reconciliation.' },
  { from: 56.2, to: 59.4, text: 'Request. Authorize. Select. Count. Dispense. Record.' },
];
