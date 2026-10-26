/** Lighting presets. Colours are sRGB hex; positions are directions from the fox (normalised later). */

export interface LightingPreset {
  id: string;
  label: string;
  sky: { top: number; horizon: number };
  ground: number;
  fog: { near: number; far: number };
  hemi: { sky: number; ground: number; intensity: number };
  key: { color: number; intensity: number; dir: [number, number, number]; shadowRadius: number };
  rim: { color: number; intensity: number; dir: [number, number, number] };
  fill: { color: number; intensity: number; dir: [number, number, number] };
  envIntensity: number;
  exposure: number;
  contactOpacity: number;
}

export const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: 'studio',
    label: 'Studio',
    sky: { top: 0x1a1d24, horizon: 0x3b3f48 },
    ground: 0x4a4d54,
    fog: { near: 3, far: 11 },
    hemi: { sky: 0xdfe8ff, ground: 0x4a3c30, intensity: 0.9 },
    key: { color: 0xfff1e0, intensity: 3.1, dir: [0.75, 1.25, 0.95], shadowRadius: 5 },
    rim: { color: 0xbfd4ff, intensity: 2.6, dir: [-0.9, 0.85, -1.1] },
    fill: { color: 0xffe2c8, intensity: 0.6, dir: [-1, 0.4, 0.8] },
    envIntensity: 0.35,
    exposure: 1.0,
    contactOpacity: 0.85,
  },
  {
    id: 'golden',
    label: 'Golden Hour',
    sky: { top: 0x2c2848, horizon: 0xd98a52 },
    ground: 0x6e5440,
    fog: { near: 3, far: 12 },
    hemi: { sky: 0xffc89a, ground: 0x4a2c1c, intensity: 0.75 },
    key: { color: 0xffb36b, intensity: 4.2, dir: [1.4, 0.55, 0.5], shadowRadius: 4 },
    rim: { color: 0xffd7a8, intensity: 2.2, dir: [-1.2, 0.6, -0.9] },
    fill: { color: 0x8a90d8, intensity: 0.55, dir: [-1, 0.6, 1] },
    envIntensity: 0.3,
    exposure: 1.0,
    contactOpacity: 0.8,
  },
  {
    id: 'overcast',
    label: 'Overcast',
    sky: { top: 0x8e9aa6, horizon: 0xc7cdd2 },
    ground: 0x9a9c96,
    fog: { near: 4, far: 13 },
    hemi: { sky: 0xeef4ff, ground: 0x6d6a60, intensity: 2.1 },
    key: { color: 0xffffff, intensity: 0.9, dir: [0.3, 1.6, 0.4], shadowRadius: 12 },
    rim: { color: 0xffffff, intensity: 0.8, dir: [-0.8, 1, -1] },
    fill: { color: 0xffffff, intensity: 0.5, dir: [-1, 0.5, 1] },
    envIntensity: 0.6,
    exposure: 1.0,
    contactOpacity: 0.95,
  },
  {
    id: 'moonlight',
    label: 'Moonlight',
    sky: { top: 0x04070f, horizon: 0x18233a },
    ground: 0x232b38,
    fog: { near: 2.5, far: 10 },
    hemi: { sky: 0x6f86c8, ground: 0x10141c, intensity: 0.6 },
    key: { color: 0xa8c0ff, intensity: 2.4, dir: [-0.6, 1.2, 0.8], shadowRadius: 6 },
    rim: { color: 0x7fa6ff, intensity: 3.2, dir: [0.9, 0.7, -1.1] },
    fill: { color: 0x3a4a80, intensity: 0.4, dir: [1, 0.3, 1] },
    envIntensity: 0.15,
    exposure: 1.15,
    contactOpacity: 0.7,
  },
  {
    id: 'dramatic',
    label: 'Dramatic',
    sky: { top: 0x050506, horizon: 0x141418 },
    ground: 0x1c1c20,
    fog: { near: 2, far: 8 },
    hemi: { sky: 0x9aa4c0, ground: 0x1a1410, intensity: 0.2 },
    key: { color: 0xffe0c0, intensity: 3.6, dir: [1.2, 1.4, 0.2], shadowRadius: 3 },
    rim: { color: 0x9fc4ff, intensity: 5.5, dir: [-0.6, 0.9, -1.3] },
    fill: { color: 0xff9a60, intensity: 0.3, dir: [-1, 0.2, 0.7] },
    envIntensity: 0.12,
    exposure: 1.05,
    contactOpacity: 0.9,
  },
];

export const DEFAULT_PRESET = 'studio';
