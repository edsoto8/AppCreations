/** Original music and sound effects for Retro Racer. */
import type { MusicTrack, SfxSpec } from './GameInterface';

export const RACER_SFX = {
  start: { wave: 'pulse25', duration: 0.3, freq: [392, 0, 392, 0, 784], stepDuration: 0.06, volume: 0.45 },
  pause: { wave: 'pulse50', duration: 0.12, freq: [784, 523], stepDuration: 0.06, volume: 0.4 },
  select: { wave: 'pulse12', duration: 0.06, freq: 1047, volume: 0.35 },
  overtake: { wave: 'pulse12', duration: 0.08, freq: [880, 1175], stepDuration: 0.04, volume: 0.3 },
  fuel: { wave: 'pulse50', duration: 0.24, freq: [523, 659, 784, 1047], stepDuration: 0.06, volume: 0.45 },
  crash: { wave: 'noise', duration: 0.7, freq: 2200, freqEnd: 70, volume: 0.6, release: 0.3 },
  respawn: { wave: 'pulse25', duration: 0.18, freq: [523, 659, 784], stepDuration: 0.06, volume: 0.35 },
  stage: {
    wave: 'pulse50',
    duration: 0.42,
    freq: [523, 659, 784, 1047, 0, 784, 1047],
    stepDuration: 0.06,
    volume: 0.45,
  },
  lowFuel: { wave: 'pulse50', duration: 0.16, freq: [1760, 0, 1760, 0], stepDuration: 0.04, volume: 0.3 },
  offroad: { wave: 'noise', duration: 0.08, freq: 280, volume: 0.25 },
  gameOver: {
    wave: 'pulse50',
    duration: 1.32,
    freq: [659, 0, 587, 0, 523, 494, 0, 440, 415, 330, 0],
    stepDuration: 0.12,
    volume: 0.45,
    release: 0.1,
  },
} as const satisfies Record<string, SfxSpec>;

/**
 * Engine putter, one spec per speed bucket (index = floor(speed * 2)) so nothing is allocated per
 * tick. Higher buckets are higher and brighter.
 */
export const RACER_ENGINE_SFX: readonly SfxSpec[] = Array.from({ length: 9 }, (_, i) => ({
  wave: 'pulse12' as const,
  duration: 0.045,
  freq: 55 + i * 14,
  freqEnd: 50 + i * 12,
  volume: 0.12 + i * 0.01,
  release: 0.02,
}));

/** Main driving theme: E minor, 8 bars. */
export const RACER_THEME: MusicTrack = {
  id: 'retro-racer-theme',
  tempo: 160,
  loop: true,
  channels: [
    {
      wave: 'pulse25',
      volume: 0.28,
      notes: `
        E5:2 E5:2 G5:2 E5:2 B5:4 A5:2 G5:2 | F#5:2 G5:2 A5:2 F#5:2 D5:8 |
        E5:2 E5:2 G5:2 E5:2 B5:4 D6:2 B5:2 | A5:4 G5:2 F#5:2 E5:8 |
        C5:4 E5:4 G5:4 C6:4 | B5:2 A5:2 G5:2 A5:2 B5:8 |
        C6:2 B5:2 A5:2 G5:2 F#5:2 G5:2 A5:2 F#5:2 | E5:8 -:4 B4:2 D5:2`,
    },
    {
      wave: 'pulse12',
      volume: 0.15,
      notes: `
        B4:4 G4:4 B4:4 G4:4 | A4:4 F#4:4 A4:4 F#4:4 | B4:4 G4:4 B4:4 G4:4 | C5:4 A4:4 B4:4 D#5:4 |
        E5:4 C5:4 E5:4 G4:4 | D5:4 B4:4 D5:4 G4:4 | C5:4 E5:4 D5:4 F#4:4 | B4:4 G4:4 B4:8`,
    },
    {
      wave: 'triangle',
      volume: 0.45,
      notes: `
        E2:2 E3:2 E2:2 E3:2 E2:2 E3:2 E2:2 E3:2 | D2:2 D3:2 D2:2 D3:2 D2:2 D3:2 D2:2 D3:2 |
        E2:2 E3:2 E2:2 E3:2 E2:2 E3:2 E2:2 E3:2 | A2:2 A3:2 A2:2 A3:2 B2:2 B3:2 B2:2 B3:2 |
        C3:2 C4:2 C3:2 C4:2 C3:2 C4:2 C3:2 C4:2 | G2:2 G3:2 G2:2 G3:2 G2:2 G3:2 G2:2 G3:2 |
        A2:2 A3:2 A2:2 A3:2 D3:2 D4:2 D3:2 D4:2 | E2:2 E3:2 E2:2 E3:2 B2:2 B3:2 B2:2 B3:2`,
    },
    {
      wave: 'noise',
      volume: 0.2,
      notes: `
        k:2 h:1 h:1 s:2 h:2 k:2 h:2 s:2 h:1 h:1 | k:2 h:1 h:1 s:2 h:2 k:2 h:2 s:2 h:1 h:1 |
        k:2 h:1 h:1 s:2 h:2 k:2 h:2 s:2 h:1 h:1 | k:2 h:1 h:1 s:2 h:2 k:2 h:2 s:2 h:1 h:1 |
        k:2 h:1 h:1 s:2 h:2 k:2 h:2 s:2 h:1 h:1 | k:2 h:1 h:1 s:2 h:2 k:2 h:2 s:2 h:1 h:1 |
        k:2 h:1 h:1 s:2 h:2 k:2 h:2 s:2 h:1 h:1 | k:2 h:1 h:1 s:2 h:2 s:1 s:1 s:1 s:1 s:2 s:2`,
    },
  ],
};

/** Title loop: 4 bars. */
export const RACER_TITLE_THEME: MusicTrack = {
  id: 'retro-racer-title',
  tempo: 130,
  loop: true,
  channels: [
    {
      wave: 'pulse50',
      volume: 0.28,
      notes: 'B4:2 E5:2 G5:2 B5:2 A5:4 G5:4 | F#5:2 D5:2 A4:2 D5:2 F#5:8 | G5:2 E5:2 C5:2 E5:2 G5:4 A5:4 | B5:8 -:8',
    },
    {
      wave: 'triangle',
      volume: 0.45,
      notes: 'E3:8 E3:8 | D3:8 D3:8 | C3:8 C3:8 | B2:8 E3:8',
    },
  ],
};
