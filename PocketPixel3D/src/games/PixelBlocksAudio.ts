/** Original music and sound effects for Pixel Blocks. */
import type { MusicTrack, SfxSpec } from './GameInterface';

export const BLOCKS_SFX = {
  start: { wave: 'pulse25', duration: 0.18, freq: [659, 988, 1319], stepDuration: 0.06, volume: 0.45 },
  pause: { wave: 'pulse50', duration: 0.12, freq: [988, 659], stepDuration: 0.06, volume: 0.4 },
  select: { wave: 'pulse12', duration: 0.06, freq: 880, volume: 0.35 },
  move: { wave: 'pulse12', duration: 0.03, freq: 330, volume: 0.22 },
  rotate: { wave: 'pulse25', duration: 0.05, freq: [523, 698], stepDuration: 0.025, volume: 0.28 },
  hardDrop: { wave: 'triangle', duration: 0.12, freq: 260, freqEnd: 70, volume: 0.55 },
  lock: { wave: 'triangle', duration: 0.06, freq: 150, freqEnd: 90, volume: 0.4 },
  clear: { wave: 'pulse50', duration: 0.24, freq: [523, 659, 784, 1047], stepDuration: 0.06, volume: 0.45 },
  bigClear: {
    wave: 'pulse25',
    duration: 0.42,
    freq: [523, 784, 659, 1047, 784, 1319, 1568],
    stepDuration: 0.06,
    volume: 0.5,
  },
  levelUp: { wave: 'pulse50', duration: 0.4, freq: [392, 523, 659, 784, 0, 1047], stepDuration: 0.065, volume: 0.45 },
  gameOver: {
    wave: 'pulse50',
    duration: 1.32,
    freq: [784, 740, 698, 659, 0, 587, 0, 494, 440, 392, 0],
    stepDuration: 0.12,
    volume: 0.45,
    release: 0.1,
  },
} as const satisfies Record<string, SfxSpec>;

/** Main play theme: D minor, 8 bars. */
export const BLOCKS_THEME: MusicTrack = {
  id: 'pixel-blocks-theme',
  tempo: 140,
  loop: true,
  channels: [
    {
      wave: 'pulse25',
      volume: 0.32,
      notes: `
        D5:2 F5:2 A5:4 G5:2 F5:2 E5:4 | F5:2 E5:2 D5:2 C5:2 D5:4 A4:4 |
        Bb4:2 D5:2 F5:4 E5:2 D5:2 C5:4 | D5:2 E5:2 F5:2 G5:2 A5:8 |
        C6:2 A5:2 F5:4 G5:2 A5:2 Bb5:4 | A5:2 G5:2 F5:2 E5:2 F5:4 D5:4 |
        E5:2 F5:2 G5:2 E5:2 C5:2 D5:2 E5:4 | D5:6 -:2 A4:2 C5:2 D5:4`,
    },
    {
      wave: 'pulse12',
      volume: 0.18,
      notes: `
        F4:8 A4:8 | F4:8 E4:8 | F4:8 D4:8 | F4:8 C5:8 |
        A4:8 F4:8 | A4:8 F4:8 | G4:8 E4:8 | F4:8 E4:8`,
    },
    {
      wave: 'triangle',
      volume: 0.45,
      notes: `
        D3:2 D4:2 D3:2 D4:2 D3:2 D4:2 D3:2 D4:2 | D3:2 D4:2 D3:2 D4:2 A2:2 A3:2 A2:2 A3:2 |
        Bb2:2 Bb3:2 Bb2:2 Bb3:2 Bb2:2 Bb3:2 Bb2:2 Bb3:2 | F2:2 F3:2 F2:2 F3:2 F2:2 F3:2 F2:2 F3:2 |
        F2:2 F3:2 F2:2 F3:2 F2:2 F3:2 F2:2 F3:2 | D3:2 D4:2 D3:2 D4:2 D3:2 D4:2 D3:2 D4:2 |
        C3:2 C4:2 C3:2 C4:2 C3:2 C4:2 C3:2 C4:2 | D3:2 D4:2 D3:2 D4:2 A2:2 A3:2 A2:2 A3:2`,
    },
    {
      wave: 'noise',
      volume: 0.2,
      notes: `
        k:2 h:2 s:2 h:2 k:2 k:2 s:2 h:2 | k:2 h:2 s:2 h:2 k:2 k:2 s:2 h:2 |
        k:2 h:2 s:2 h:2 k:2 k:2 s:2 h:2 | k:2 h:2 s:2 h:2 k:2 k:2 s:2 h:2 |
        k:2 h:2 s:2 h:2 k:2 k:2 s:2 h:2 | k:2 h:2 s:2 h:2 k:2 k:2 s:2 h:2 |
        k:2 h:2 s:2 h:2 k:2 k:2 s:2 h:2 | k:2 h:2 s:2 h:2 s:2 s:2 s:2 s:2`,
    },
  ],
};

/** Calm title loop: 4 bars. */
export const BLOCKS_TITLE_THEME: MusicTrack = {
  id: 'pixel-blocks-title',
  tempo: 110,
  loop: true,
  channels: [
    {
      wave: 'pulse50',
      volume: 0.28,
      notes: 'A4:4 D5:4 F5:4 E5:4 | D5:4 C5:4 A4:8 | Bb4:4 D5:4 G5:4 F5:4 | E5:8 D5:8',
    },
    {
      wave: 'triangle',
      volume: 0.45,
      notes: 'D3:8 A2:8 | F2:8 C3:8 | G2:8 Bb2:8 | A2:8 D3:8',
    },
  ],
};
