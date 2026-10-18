/**
 * IndexedDB database. Data is stored UNENCRYPTED on this device (stated in the UI and docs).
 * The IndexedDB version number tracks object-store layout only; document shape is versioned by each
 * document's `schemaVersion` and upgraded by the engine's `migrate()` on read.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const DB_NAME = 'retirement-navigator';
export const DB_VERSION = 1;
export const STORES = ['profiles', 'scenarios', 'settings'] as const;
export type StoreName = (typeof STORES)[number];

interface RnDb extends DBSchema {
  profiles: { key: string; value: unknown };
  scenarios: { key: string; value: unknown };
  settings: { key: string; value: unknown };
}

export type Db = IDBPDatabase<RnDb>;

export function openDatabase(name: string = DB_NAME): Promise<Db> {
  return openDB<RnDb>(name, DB_VERSION, {
    upgrade(db) {
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    },
  });
}
