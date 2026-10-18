/**
 * Document repository over IndexedDB. Every write is validated against the engine schema; every read
 * passes through `migrate()` so documents from older schema versions are upgraded and validated.
 */
import { migrate, StoredDocSchema, zodIssues, type EngineResult, type StoredDoc } from '@rn/engine';
import { STORES, type Db, type StoreName } from './db';

const STORE_FOR_KIND: Record<StoredDoc['kind'], StoreName> = {
  profile: 'profiles',
  scenario: 'scenarios',
  settings: 'settings',
};

export class DocumentRepository {
  constructor(private readonly db: Db) {}

  /** Validate and save a document. Returns the validated document or the validation issues. */
  async put(doc: unknown): Promise<EngineResult<StoredDoc>> {
    const parsed = StoredDocSchema.safeParse(doc);
    if (!parsed.success) return { status: 'invalid', issues: zodIssues(parsed.error) };
    const value = parsed.data;
    await this.db.put(STORE_FOR_KIND[value.kind], value, value.id);
    return { status: 'ok', value, warnings: [] };
  }

  /** Read a document by kind and id, migrating it to the current schema. Null if absent. */
  async get(kind: StoredDoc['kind'], id: string): Promise<EngineResult<StoredDoc> | null> {
    const raw = await this.db.get(STORE_FOR_KIND[kind], id);
    return raw === undefined ? null : migrate(raw);
  }

  /** All documents of a kind (each migrated; invalid ones are returned as results, not dropped). */
  async list(kind: StoredDoc['kind']): Promise<EngineResult<StoredDoc>[]> {
    const raws = await this.db.getAll(STORE_FOR_KIND[kind]);
    return raws.map((raw) => migrate(raw));
  }

  async delete(kind: StoredDoc['kind'], id: string): Promise<void> {
    await this.db.delete(STORE_FOR_KIND[kind], id);
  }

  /** Remove every stored document ("delete all my data"). */
  async deleteAll(): Promise<void> {
    const tx = this.db.transaction([...STORES], 'readwrite');
    await Promise.all([...STORES.map((s) => tx.objectStore(s).clear()), tx.done]);
  }
}
