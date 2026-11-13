/** Lighting preset data (no Three.js import, so UI code can use it). Colours are hex numbers. */
export type LightingPresetId = 'studio' | 'dark' | 'warm' | 'gallery';

export interface LightingPreset {
  label: string;
  /** UI theme that suits the backdrop. */
  theme: 'light' | 'dark';
  background: string;
  key: { color: number; intensity: number; position: [number, number, number] };
  fill: { color: number; intensity: number };
  rim: { color: number; intensity: number };
  hemi: { sky: number; ground: number; intensity: number };
  environment: number;
  shadowOpacity: number;
  exposure: number;
}

export const LIGHTING_PRESETS: Record<LightingPresetId, LightingPreset> = {
  studio: {
    label: 'Studio',
    theme: 'light',
    background: 'radial-gradient(ellipse at 50% 35%, #fbfaf7 0%, #e7e4dd 55%, #cfcbc2 100%)',
    key: { color: 0xffffff, intensity: 2.6, position: [160, 300, 260] },
    fill: { color: 0xe8eeff, intensity: 0.7 },
    rim: { color: 0xffffff, intensity: 1.7 },
    hemi: { sky: 0xffffff, ground: 0xbdb7aa, intensity: 0.55 },
    environment: 0.85,
    shadowOpacity: 0.26,
    exposure: 1.0,
  },
  dark: {
    label: 'Dark studio',
    theme: 'dark',
    background: 'radial-gradient(ellipse at 50% 35%, #30333b 0%, #16171b 55%, #08090b 100%)',
    key: { color: 0xfff4e8, intensity: 2.4, position: [140, 260, 220] },
    fill: { color: 0x6f86c9, intensity: 0.25 },
    rim: { color: 0x9fc4ff, intensity: 3.2 },
    hemi: { sky: 0x404660, ground: 0x050506, intensity: 0.25 },
    environment: 0.32,
    shadowOpacity: 0.6,
    exposure: 1.05,
  },
  warm: {
    label: 'Warm showcase',
    theme: 'light',
    background: 'radial-gradient(ellipse at 50% 35%, #fbf1e4 0%, #ead2b5 55%, #cda886 100%)',
    key: { color: 0xffd9ac, intensity: 2.8, position: [220, 220, 200] },
    fill: { color: 0xa9c4ff, intensity: 0.5 },
    rim: { color: 0xffe2c2, intensity: 1.3 },
    hemi: { sky: 0xfff0dc, ground: 0xb48a62, intensity: 0.5 },
    environment: 0.7,
    shadowOpacity: 0.32,
    exposure: 1.0,
  },
  gallery: {
    label: 'Gallery spot',
    theme: 'light',
    background: 'radial-gradient(ellipse at 50% 30%, #f1f4f8 0%, #d6dce4 55%, #aeb6c2 100%)',
    key: { color: 0xffffff, intensity: 3.4, position: [20, 420, 140] },
    fill: { color: 0xffffff, intensity: 0.35 },
    rim: { color: 0xdfe8ff, intensity: 2.2 },
    hemi: { sky: 0xffffff, ground: 0x9aa3b0, intensity: 0.4 },
    environment: 0.6,
    shadowOpacity: 0.4,
    exposure: 1.0,
  },
};

