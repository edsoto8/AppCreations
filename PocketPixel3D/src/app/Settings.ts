import type { HighScoreStore } from '../games/GameInterface';
import type { LightingPresetId } from '../scene/LightingManager';

export interface PersistedSettings {
  volume: number;
  contrast: number;
  lighting: LightingPresetId;
  pixelGrid: boolean;
  ghosting: boolean;
  reflection: boolean;
  idleMotion: boolean;
  slowMotion: boolean;
  showFps: boolean;
  muted: boolean;
  lastCartridge: string | null;
}

const KEY = 'pocket-pixel-3d:settings:v1';
const SCORES_KEY = 'pocket-pixel-3d:scores:v1';
const LIGHTING_IDS: readonly LightingPresetId[] = ['studio', 'dark', 'warm', 'gallery'];

export const DEFAULT_SETTINGS: PersistedSettings = {
  volume: 0.6,
  contrast: 0.5,
  lighting: 'studio',
  pixelGrid: true,
  ghosting: true,
  reflection: true,
  idleMotion: false,
  slowMotion: false,
  showFps: false,
  muted: false,
  lastCartridge: 'pixel-blocks',
};

/** Storage may be unavailable (private mode, blocked cookies): every access is guarded. */
function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore: settings simply won't persist.
  }
}

/** Validates untrusted stored data field by field, falling back to defaults. */
export function sanitizeSettings(raw: unknown): PersistedSettings {
  const out: PersistedSettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
  out.volume = num(r.volume, out.volume);
  out.contrast = num(r.contrast, out.contrast);
  out.lighting = LIGHTING_IDS.includes(r.lighting as LightingPresetId) ? (r.lighting as LightingPresetId) : out.lighting;
  out.pixelGrid = bool(r.pixelGrid, out.pixelGrid);
  out.ghosting = bool(r.ghosting, out.ghosting);
  out.reflection = bool(r.reflection, out.reflection);
  out.idleMotion = bool(r.idleMotion, out.idleMotion);
  out.slowMotion = bool(r.slowMotion, out.slowMotion);
  out.showFps = bool(r.showFps, out.showFps);
  out.muted = bool(r.muted, out.muted);
  out.lastCartridge = typeof r.lastCartridge === 'string' || r.lastCartridge === null ? (r.lastCartridge as string | null) : out.lastCartridge;
  return out;
}

export class Settings {
  readonly values: PersistedSettings;
  private readonly scores: Record<string, number>;
  private saveTimer: number | null = null;

  constructor() {
    this.values = sanitizeSettings(read(KEY));
    const rawScores = read(SCORES_KEY);
    this.scores = {};
    if (rawScores && typeof rawScores === 'object') {
      for (const [k, v] of Object.entries(rawScores as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) this.scores[k] = Math.floor(v);
      }
    }
  }

  set<K extends keyof PersistedSettings>(key: K, value: PersistedSettings[K]): void {
    this.values[key] = value;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      write(KEY, this.values);
    }, 250);
  }

  readonly highScores: HighScoreStore = {
    get: (id) => this.scores[id] ?? 0,
    submit: (id, score) => {
      if (score <= (this.scores[id] ?? 0)) return false;
      this.scores[id] = Math.floor(score);
      write(SCORES_KEY, this.scores);
      return true;
    },
  };
}
