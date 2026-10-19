/**
 * Document repository over IndexedDB. Every write is validated against the engine schema; every read
 * passes through `migrate()` so documents from older schema versions are upgraded and validated, and
 * is checked to be the requested kind stored under its own id.
 */
import {
  migrate,
  StoredDocSchema,
  zodIssues,
  type EngineResult,
  type StoredDoc,
  type ValidationIssue,
} from '@rn/engine';
import { STORES, type Db, type StoreName } from './db';

type Kind = StoredDoc['kind'];
export type DocOfKind<K extends Kind> = Extract<StoredDoc, { kind: K }>;

const STORE_FOR_KIND: Record<Kind, StoreName> = {
  profile: 'profiles',
  scenario: 'scenarios',
  settings: 'settings',
};

function readAs<K extends Kind>(raw: unknown, kind: K, key: string): EngineResult<DocOfKind<K>> {
  const result = migrate(raw);
  if (result.status !== 'ok') return result;
  if (result.value.kind !== kind || result.value.id !== key) {
    return {
      status: 'invalid',
      issues: [{ path: [], message: `Stored document "${key}" is not a valid ${kind} document` }],
    };
  }
  return { ...result, value: result.value as DocOfKind<K> };
}

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

  /** Read a document by kind and id, migrated to the current schema. Null if absent. */
  async get<K extends Kind>(kind: K, id: string): Promise<EngineResult<DocOfKind<K>> | null> {
    const raw = await this.db.get(STORE_FOR_KIND[kind], id);
    return raw === undefined ? null : readAs(raw, kind, id);
  }

  /** All documents of a kind (each migrated; invalid ones are returned as results, not dropped). */
  async list<K extends Kind>(kind: K): Promise<EngineResult<DocOfKind<K>>[]> {
    const store = STORE_FOR_KIND[kind];
    const [keys, raws] = await Promise.all([this.db.getAllKeys(store), this.db.getAll(store)]);
    return raws.map((raw, i) => readAs(raw, kind, String(keys[i])));
  }

  async delete(kind: Kind, id: string): Promise<void> {
    await this.db.delete(STORE_FOR_KIND[kind], id);
  }

  /**
   * Validate every document, then write them all in one transaction (after clearing every store when
   * `clear` is set). Nothing is written if any document is invalid, and an interrupted transaction
   * writes nothing either, so an import is never half-applied.
   */
  async writeAll(docs: readonly unknown[], opts: { clear: boolean }): Promise<EngineResult<StoredDoc[]>> {
    const values: StoredDoc[] = [];
    const issues: ValidationIssue[] = [];
    docs.forEach((doc, i) => {
      const parsed = StoredDocSchema.safeParse(doc);
      if (parsed.success) values.push(parsed.data);
      else issues.push(...zodIssues(parsed.error).map((issue) => ({ ...issue, path: [i, ...issue.path] })));
    });
    if (issues.length > 0) return { status: 'invalid', issues };
    const tx = this.db.transaction([...STORES], 'readwrite');
    await Promise.all([
      ...(opts.clear ? STORES.map((s) => tx.objectStore(s).clear()) : []),
      ...values.map((value) => tx.objectStore(STORE_FOR_KIND[value.kind]).put(value, value.id)),
      tx.done,
    ]);
    return { status: 'ok', value: values, warnings: [] };
  }

  /** Remove every stored document. The "delete all my data" UI also clears the theme preference. */
  async deleteAll(): Promise<void> {
    const tx = this.db.transaction([...STORES], 'readwrite');
    await Promise.all([...STORES.map((s) => tx.objectStore(s).clear()), tx.done]);
  }
}
