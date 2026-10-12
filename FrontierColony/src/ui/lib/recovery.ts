/** Clearing saved data from the crash recovery screen. Pure over a small storage interface so it can be tested. */

export const SAVED_DATA_PREFIX = 'frontierColony.';

export interface EnumerableStorage {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

/** Remove every `frontierColony.*` key (saves and preferences) and nothing else. Returns the removed keys. */
export function clearSavedData(storage: EnumerableStorage | null): string[] {
  if (!storage) return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k !== null && k.startsWith(SAVED_DATA_PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    // Storage is blocked: nothing more can be done here.
  }
  return keys;
}
