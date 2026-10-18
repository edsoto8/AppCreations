import { describe, expect, it } from 'vitest';
import { migrate, migrateWith, MIGRATIONS } from './migrate';
import { CURRENT_SCHEMA_VERSION } from '../domain/documents';
import { minimalHouseholdInput } from '../samples/minimal';

const profileDoc = () => ({
  kind: 'profile',
  schemaVersion: 1,
  id: 'household-1',
  updatedAt: '2026-10-18T12:00:00.000Z',
  household: minimalHouseholdInput(2026),
});

describe('migrate', () => {
  it('accepts a current-version profile and validates it', () => {
    const r = migrate(profileDoc());
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.value.kind).toBe('profile');
  });

  it('round-trips a stored document through JSON and the schema', () => {
    const first = migrate(profileDoc());
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') return;
    const second = migrate(JSON.parse(JSON.stringify(first.value)));
    expect(second).toEqual(first);
  });

  it('accepts settings and scenario documents', () => {
    expect(
      migrate({ kind: 'settings', schemaVersion: 1, id: 'settings', updatedAt: '2026-10-18T12:00:00Z' }).status,
    ).toBe('ok');
    const scenario = {
      kind: 'scenario',
      schemaVersion: 1,
      id: 'scenario-1',
      updatedAt: '2026-10-18T12:00:00Z',
      scenario: { id: 'scenario-1', name: 'A', baseProfileId: 'household-1' },
    };
    expect(migrate(scenario).status).toBe('ok');
  });

  it.each([
    [null, 'Expected a document object'],
    [[], 'Expected a document object'],
    ['text', 'Expected a document object'],
    [{ kind: 'profile' }, 'Missing or invalid schemaVersion'],
    [{ kind: 'profile', schemaVersion: 0 }, 'Missing or invalid schemaVersion'],
    [{ kind: 'profile', schemaVersion: 1.5 }, 'Missing or invalid schemaVersion'],
  ])('rejects malformed input %j', (input, message) => {
    const r = migrate(input);
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.issues[0]!.message).toBe(message);
  });

  it('rejects documents from a newer app version with a clear message', () => {
    const r = migrate({ ...profileDoc(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.issues[0]!.message).toMatch(/newer version of the app/);
  });

  it('reports schema problems with paths', () => {
    const doc = profileDoc();
    const r = migrate({ ...doc, household: { ...doc.household, filingStatus: 'marriedFilingJointly' } });
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.issues[0]!.path).toEqual(['household', 'people']);
  });

  it('has a migration step for every prior version', () => {
    for (let v = 1; v < CURRENT_SCHEMA_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf('function');
  });
});

describe('migrateWith (chain mechanics)', () => {
  it('returns invalid when a step throws, instead of throwing', () => {
    const r = migrateWith(
      profileDoc(),
      {
        1: () => {
          throw new Error('boom');
        },
      },
      2,
    );
    expect(r).toEqual({ status: 'invalid', issues: [{ path: [], message: 'Could not upgrade from schema 1: boom' }] });
  });

  it('reports non-Error throws too', () => {
    const r = migrateWith(
      profileDoc(),
      {
        1: () => {
          throw 'text';
        },
      },
      2,
    );
    expect(r.status === 'invalid' && r.issues[0]!.message).toBe('Could not upgrade from schema 1: text');
  });

  it('reports a gap in the chain', () => {
    const r = migrateWith(profileDoc(), {}, 2);
    expect(r.status === 'invalid' && r.issues[0]!.message).toBe('No migration from schema 1');
  });

  it('never mutates the caller’s document', () => {
    const doc = profileDoc();
    const before = JSON.stringify(doc);
    migrateWith(
      doc,
      {
        1: (d) => {
          d['name'] = 'mutated';
          delete d['household'];
          return d;
        },
      },
      2,
    );
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('accepts timestamps with an offset', () => {
    expect(migrate({ ...profileDoc(), updatedAt: '2026-10-18T12:00:00+02:00' }).status).toBe('ok');
  });
});
