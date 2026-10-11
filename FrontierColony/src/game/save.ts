/**
 * Save/load to a key-value storage (localStorage in the browser, an in-memory map in tests).
 *
 * Format: one JSON "envelope" per slot under key `frontierColony.v1.save.<slot>`:
 *   { format: 'frontier-colony-save', schemaVersion, savedAt (ISO), summary, state: GameState }
 * `state` is the GameState verbatim (it is JSON-safe by contract). Loading migrates older
 * schema versions (see `migrateEnvelope`) and then validates with `validateGameState`.
 * Every failure (missing, corrupt JSON, wrong format, unknown version, invalid state, quota) is
 * returned as `{ ok: false, error }` — these functions never throw.
 */
import { SAVE_SCHEMA_VERSION, validateGameState, type GameState, type MapPreset } from '../sim';

/** Minimal subset of the Web Storage API we use. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SAVE_FORMAT = 'frontier-colony-save';
/** Version of the storage key layout (not the GameState schema). */
export const STORAGE_LAYOUT_VERSION = 1;
export const SAVE_KEY_PREFIX = `frontierColony.v${STORAGE_LAYOUT_VERSION}.save.`;

export const SAVE_SLOTS = ['autosave', 'slot1', 'slot2', 'slot3'] as const;
export type SaveSlotId = (typeof SAVE_SLOTS)[number];

export interface SaveSummary {
  colonyName: string;
  day: number;
  timeOfDay: number;
  population: number;
  seed: string;
  preset: MapPreset;
}

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  schemaVersion: number;
  savedAt: string;
  summary: SaveSummary;
  state: GameState;
}

export interface SaveSlotInfo {
  slot: SaveSlotId;
  /** True when the slot holds data (valid or not). */
  exists: boolean;
  savedAt: string | null;
  summary: SaveSummary | null;
  /** Set when the slot holds data that cannot be loaded. */
  error: string | null;
}

export type SaveResult = { ok: true; bytes: number } | { ok: false; error: string };
export type LoadResult = { ok: true; state: GameState; envelope: SaveEnvelope } | { ok: false; error: string };

export function saveKey(slot: SaveSlotId): string {
  return SAVE_KEY_PREFIX + slot;
}

/**
 * Small companion record written next to each save, so the save list can be shown without parsing
 * and validating every full game (about 90 ms for four large saves). Load still validates fully.
 */
export const SAVE_META_KEY_PREFIX = `frontierColony.v${STORAGE_LAYOUT_VERSION}.meta.`;

export function saveMetaKey(slot: SaveSlotId): string {
  return SAVE_META_KEY_PREFIX + slot;
}

interface SaveMeta {
  format: typeof SAVE_FORMAT;
  schemaVersion: number;
  savedAt: string;
  summary: SaveSummary;
}

function readMeta(json: string | null): SaveMeta | null {
  if (json === null) return null;
  try {
    const m = JSON.parse(json) as Partial<SaveMeta> | null;
    if (!m || m.format !== SAVE_FORMAT || typeof m.savedAt !== 'string' || typeof m.schemaVersion !== 'number') return null;
    const sum = m.summary as Partial<SaveSummary> | undefined;
    if (!sum || typeof sum.colonyName !== 'string' || typeof sum.day !== 'number' || typeof sum.timeOfDay !== 'number' ||
      typeof sum.population !== 'number' || typeof sum.seed !== 'string' || typeof sum.preset !== 'string') return null;
    return m as SaveMeta;
  } catch {
    return null;
  }
}

export function summarize(state: GameState): SaveSummary {
  return {
    colonyName: state.colony.name,
    day: state.time.day,
    timeOfDay: state.time.timeOfDay,
    population: state.settlers.length,
    seed: state.meta.seed,
    preset: state.meta.preset,
  };
}

export function serializeGame(state: GameState, savedAt: Date): string {
  const envelope: SaveEnvelope = {
    format: SAVE_FORMAT,
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: savedAt.toISOString(),
    summary: summarize(state),
    state,
  };
  return JSON.stringify(envelope);
}

/**
 * Upgrade an envelope from an older schema version to the current one, step by step.
 * Add a `case` per version bump, e.g. `case 1: env = v1ToV2(env); // falls through`.
 */
function migrateEnvelope(env: Record<string, unknown>): { ok: true; env: Record<string, unknown> } | { ok: false; error: string } {
  const version = env.schemaVersion;
  if (typeof version !== 'number') return { ok: false, error: 'Save has no schema version.' };
  if (version > SAVE_SCHEMA_VERSION) return { ok: false, error: 'Save was made by a newer version of the game.' };
  if (version < 1) return { ok: false, error: `Unsupported save version ${version}.` };
  // No migrations yet (current version is 1).
  return { ok: true, env };
}

export function deserializeGame(json: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Save data is corrupt (not valid JSON).' };
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { format?: unknown }).format !== SAVE_FORMAT) {
    return { ok: false, error: 'Not a Frontier Colony save.' };
  }
  const migrated = migrateEnvelope(parsed as Record<string, unknown>);
  if (!migrated.ok) return migrated;
  const validation = validateGameState(migrated.env.state);
  if (!validation.ok) return { ok: false, error: `Save data is invalid: ${validation.error}.` };
  return { ok: true, state: validation.state, envelope: migrated.env as unknown as SaveEnvelope };
}

/** Key holding the autosave that the latest autosave replaced (one generation of backup). */
export const AUTOSAVE_BACKUP_KEY = `${SAVE_KEY_PREFIX}autosave.prev`;

/**
 * Serialize, check that the result loads back, then write. A state that would not load (for
 * example a NaN that JSON turns into null) is refused, so it never replaces a good save.
 */
export function saveToSlot(storage: KeyValueStorage, slot: SaveSlotId, state: GameState, now: Date = new Date()): SaveResult {
  try {
    const json = serializeGame(state, now);
    const check = deserializeGame(json);
    if (!check.ok) return { ok: false, error: `Save refused: the game state is invalid (${check.error})` };
    if (slot === 'autosave') {
      const previous = storage.getItem(saveKey(slot));
      if (previous !== null) storage.setItem(AUTOSAVE_BACKUP_KEY, previous);
    }
    storage.setItem(saveKey(slot), json);
    const meta: SaveMeta = { format: SAVE_FORMAT, schemaVersion: SAVE_SCHEMA_VERSION, savedAt: now.toISOString(), summary: summarize(state) };
    storage.setItem(saveMetaKey(slot), JSON.stringify(meta));
    return { ok: true, bytes: json.length };
  } catch (err) {
    const quota = err instanceof Error && /quota/i.test(`${err.name} ${err.message}`);
    return { ok: false, error: quota ? 'Not enough browser storage to save.' : 'Saving failed.' };
  }
}

export function loadFromSlot(storage: KeyValueStorage, slot: SaveSlotId): LoadResult {
  let json: string | null;
  try {
    json = storage.getItem(saveKey(slot));
  } catch {
    return { ok: false, error: 'Browser storage is not available.' };
  }
  if (json === null) return { ok: false, error: 'This save slot is empty.' };
  return deserializeGame(json);
}

export function deleteSlot(storage: KeyValueStorage, slot: SaveSlotId): void {
  try {
    storage.removeItem(saveKey(slot));
    storage.removeItem(saveMetaKey(slot));
    if (slot === 'autosave') storage.removeItem(AUTOSAVE_BACKUP_KEY);
  } catch {
    // Storage unavailable: nothing to delete.
  }
}

export function listSaveSlots(storage: KeyValueStorage): SaveSlotInfo[] {
  return SAVE_SLOTS.map((slot): SaveSlotInfo => {
    let json: string | null = null;
    try {
      json = storage.getItem(saveKey(slot));
    } catch {
      return { slot, exists: false, savedAt: null, summary: null, error: 'Browser storage is not available.' };
    }
    if (json === null) return { slot, exists: false, savedAt: null, summary: null, error: null };
    let meta: SaveMeta | null = null;
    try {
      meta = readMeta(storage.getItem(saveMetaKey(slot)));
    } catch {
      meta = null;
    }
    // Trust the metadata only if it matches the stored save's timestamp; otherwise fall back to a full parse.
    if (meta && meta.schemaVersion <= SAVE_SCHEMA_VERSION && json.includes(`"savedAt":${JSON.stringify(meta.savedAt)}`)) {
      return { slot, exists: true, savedAt: meta.savedAt, summary: meta.summary, error: null };
    }
    const result = deserializeGame(json);
    return result.ok
      ? { slot, exists: true, savedAt: result.envelope.savedAt, summary: result.envelope.summary, error: null }
      : { slot, exists: true, savedAt: null, summary: null, error: result.error };
  });
}

/** In-memory storage for tests and for browsers where localStorage throws. */
export function createMemoryStorage(): KeyValueStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** `window.localStorage` if usable, otherwise an in-memory fallback (saves then last only for the session). */
export function getBrowserStorage(): KeyValueStorage {
  try {
    const ls = window.localStorage;
    const probe = '__frontierColony_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return createMemoryStorage();
  }
}
