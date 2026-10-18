/**
 * Schema-version migration chain for stored and exported documents.
 *
 * `MIGRATIONS[v]` upgrades a raw document from version v to v + 1. Adding schema version N means:
 * bump CURRENT_SCHEMA_VERSION, add MIGRATIONS[N - 1], and add a fixture for version N - 1 under
 * `io/fixtures/` (the test migrates a fixture from every prior version).
 */
import { CURRENT_SCHEMA_VERSION, StoredDocSchema, type StoredDoc } from '../domain/documents';
import type { EngineResult, ValidationIssue } from '../domain/results';
import { zodIssues } from '../validation';

type RawDoc = Record<string, unknown>;

/** Version 1 is the first version, so the chain is empty. */
export const MIGRATIONS: Readonly<Record<number, (doc: RawDoc) => RawDoc>> = {};

function invalid(message: string, path: (string | number)[] = []): EngineResult<never> {
  const issue: ValidationIssue = { path, message };
  return { status: 'invalid', issues: [issue] };
}

/** Upgrade a stored document of any prior schemaVersion to the current one, then validate it. */
export function migrate(doc: unknown): EngineResult<StoredDoc> {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return invalid('Expected a document object');
  }
  let current = doc as RawDoc;
  const version = current['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return invalid('Missing or invalid schemaVersion', ['schemaVersion']);
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return invalid(
      `This file was created by a newer version of the app (schema ${version}); this version supports up to ${CURRENT_SCHEMA_VERSION}`,
      ['schemaVersion'],
    );
  }
  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return invalid(`No migration from schema ${v}`, ['schemaVersion']);
    current = { ...step(current), schemaVersion: v + 1 };
  }
  const parsed = StoredDocSchema.safeParse(current);
  if (!parsed.success) return { status: 'invalid', issues: zodIssues(parsed.error) };
  return { status: 'ok', value: parsed.data, warnings: [] };
}
