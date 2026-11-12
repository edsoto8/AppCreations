/** Visual language of the explainer: dark navy, metallic housing, green cash, blue signals, amber mechanics. */
export const COLORS = {
  bgDeep: '#050b1a',
  bg: '#0a1530',
  bgPanel: '#0f1d3d',
  grid: 'rgba(120, 160, 255, 0.06)',
  white: '#f4f7fc',
  text: '#dfe7f5',
  muted: '#8ea0c4',
  cash: '#2fd17a',
  cashDark: '#14894a',
  cashLight: '#a6f3c6',
  signal: '#3ea6ff',
  signalGlow: '#7cc4ff',
  amber: '#ffb238',
  amberGlow: '#ffd27a',
  red: '#ff5c6c',
  metalLight: '#dfe5ee',
  metalMid: '#9aa6b8',
  metalDark: '#4b566a',
  steel: '#2a3447',
  glass: 'rgba(140, 190, 255, 0.10)',
} as const;

export const FONT = {
  sans: 'Inter, "Liberation Sans", Arial, sans-serif',
  mono: '"JetBrains Mono", "DejaVu Sans Mono", monospace',
} as const;

/** Scene boundaries in seconds (60 s total @ 30 fps = 1800 frames). */
export const SCENES = {
  intro: { from: 0, duration: 6 },
  inside: { from: 6, duration: 10 },
  request: { from: 16, duration: 9 },
  counting: { from: 25, duration: 13 },
  dispensing: { from: 38, duration: 11 },
  inventory: { from: 49, duration: 7 },
  closing: { from: 56, duration: 4 },
} as const;

export const FPS = 30;
export const TOTAL_SECONDS = 60;
