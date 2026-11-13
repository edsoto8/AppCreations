/** Original music and sound effects for Pixel Snake. */
import type { MusicTrack, SfxSpec } from './GameInterface';

export const SNAKE_SFX = {
  start: { wave: 'pulse50', duration: 0.2, freq: [523, 784, 1047, 1568], stepDuration: 0.05, volume: 0.4 },
  pause: { wave: 'pulse25', duration: 0.12, freq: [880, 587], stepDuration: 0.06, volume: 0.4 },
  select: { wave: 'pulse12', duration: 0.07, freq: [988, 1319], stepDuration: 0.035, volume: 0.35 },
  turn: { wave: 'pulse12', duration: 0.025, freq: 440, volume: 0.16 },
  eat: { wave: 'pulse50', duration: 0.09, freq: [659, 988], stepDuration: 0.045, volume: 0.4 },
  bonusAppear: { wave: 'pulse25', duration: 0.24, freq: [1047, 1319, 1047, 1319], stepDuration: 0.06, volume: 0.35 },
  bonusEat: {
    wave: 'pulse25',
    duration: 0.3,
    freq: [784, 988, 1175, 1568, 1976],
    stepDuration: 0.06,
    volume: 0.45,
  },
  bonusExpire: { wave: 'triangle', duration: 0.2, freq: 523, freqEnd: 262, volume: 0.35 },
  speedUp: { wave: 'pulse50', duration: 0.16, freq: [587, 784, 1175], stepDuration: 0.05, volume: 0.35 },
  die: { wave: 'noise', duration: 0.45, freq: 1800, freqEnd: 120, volume: 0.55 },
  gameOver: {
    wave: 'pulse25',
    duration: 1.2,
    freq: [587, 0, 523, 0, 494, 440, 0, 392, 392, 0],
    stepDuration: 0.12,
    volume: 0.45,
    release: 0.1,
  },
} as const satisfies Record<string, SfxSpec>;

/** Main play theme: G major, 8 bars, bouncy. */
export const SNAKE_THEME: MusicTrack = {
  id: 'pixel-snake-theme',
  tempo: 150,
  loop: true,
  channels: [
    {
      wave: 'pulse50',
      volume: 0.28,
      notes: `
        G4:2 B4:2 D5:2 B4:2 C5:2 E5:2 D5:4 | B4:2 G4:2 A4:2 B4:2 A4:4 -:4 |
        E5:2 D5:2 C5:2 E5:2 D5:2 B4:2 G4:4 | A4:2 B4:2 C5:2 A4:2 D5:8 |
        G5:2 F#5:2 E5:2 D5:2 E5:2 C5:2 A4:4 | B4:2 C5:2 D5:2 E5:2 D5:4 B4:4 |
        C5:2 E5:2 G5:2 E5:2 F#5:2 D5:2 A4:2 C5:2 | B4:4 A4:2 F#4:2 G4:8`,
    },
    {
      wave: 'pulse12',
      volume: 0.16,
      notes: `
        D4:8 B3:8 | D4:8 F#4:8 | E4:8 G4:8 | F#4:8 A4:8 |
        G4:8 E4:8 | D4:8 G4:8 | E4:8 F#4:8 | D4:8 B3:8`,
    },
    {
      wave: 'triangle',
      volume: 0.45,
      notes: `
        G2:4 D3:4 G2:4 D3:4 | G2:4 D3:4 D2:4 A2:4 | C3:4 G2:4 C3:4 G2:4 | D3:4 A2:4 D3:4 F#2:4 |
        E2:4 B2:4 A2:4 E3:4 | G2:4 D3:4 G2:4 B2:4 | C3:4 G2:4 D3:4 A2:4 | D3:4 F#2:4 G2:8`,
    },
    {
      wave: 'noise',
      volume: 0.18,
      notes: `
        k:4 h:2 h:2 s:4 h:2 h:2 | k:4 h:2 h:2 s:4 h:2 h:2 | k:4 h:2 h:2 s:4 h:2 h:2 | k:4 h:2 h:2 s:4 h:2 h:2 |
        k:4 h:2 h:2 s:4 h:2 h:2 | k:4 h:2 h:2 s:4 h:2 h:2 | k:4 h:2 h:2 s:4 h:2 h:2 | k:4 s:2 s:2 s:2 s:2 s:2 s:2`,
    },
  ],
};

/** Title loop: 4 bars. */
export const SNAKE_TITLE_THEME: MusicTrack = {
  id: 'pixel-snake-title',
  tempo: 120,
  loop: true,
  channels: [
    {
      wave: 'pulse25',
      volume: 0.28,
      notes: 'D5:2 -:2 B4:2 G4:2 -:4 D5:2 E5:2 | F#5:4 E5:2 D5:2 B4:8 | C5:2 -:2 E5:2 G5:2 -:4 F#5:2 E5:2 | D5:4 A4:4 G4:8',
    },
    {
      wave: 'triangle',
      volume: 0.45,
      notes: 'G2:8 G2:8 | D3:8 G2:8 | C3:8 C3:8 | D3:8 G2:8',
    },
  ],
};
