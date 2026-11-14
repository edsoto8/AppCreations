import type { HighScoreStore } from '../games/GameInterface';
import type { LightingPresetId } from '../scene/LightingPresets';

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
  /** True when the viewer picked a lighting preset before; otherwise lighting follows their theme. */
  readonly lightingChosen: boolean;
  private readonly scores: Record<string, number>;
  private saveTimer: number | null = null;

  constructor() {
    window.addEventListener('pagehide', this.flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
    const raw = read(KEY);
    this.values = sanitizeSettings(raw);
    this.lightingChosen = !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).lighting === this.values.lighting;
    const rawScores = read(SCORES_KEY);
    this.scores = {};
    mergeScores(this.scores, rawScores);
  }

  /** Writes pending settings immediately (called when the page is hidden or closed). */
  readonly flush = (): void => {
    if (this.saveTimer === null) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    write(KEY, this.values);
  };

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
      // Merge with what other tabs may have stored since we loaded, keeping the best of each.
      mergeScores(this.scores, read(SCORES_KEY));
      const beaten = score > (this.scores[id] ?? 0);
      if (beaten) this.scores[id] = Math.floor(score);
      write(SCORES_KEY, this.scores);
      return beaten;
    },
  };
}

/** Copies valid, higher scores from untrusted stored data into `into`. */
function mergeScores(into: Record<string, number>, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) into[k] = Math.max(into[k] ?? 0, Math.floor(v));
  }
}
