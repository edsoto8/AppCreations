import { describe, expect, it, beforeEach } from 'vitest';
import { minimalHouseholdInput, type ProfileDoc } from '@rn/engine';
import { openDatabase } from './db';
import { DocumentRepository } from './repository';

let dbCounter = 0;
let repo: DocumentRepository;

beforeEach(async () => {
  repo = new DocumentRepository(await openDatabase(`test-db-${++dbCounter}`));
});

const profile = () => ({
  kind: 'profile',
  schemaVersion: 1,
  id: 'household-1',
  updatedAt: '2026-10-18T12:00:00.000Z',
  household: minimalHouseholdInput(2026),
});

describe('DocumentRepository (M1 gate: a stored document round-trips through the schema)', () => {
  it('round-trips a profile through IndexedDB and the schema', async () => {
    const saved = await repo.put(profile());
    expect(saved.status).toBe('ok');
    const loaded = await repo.get('profile', 'household-1');
    expect(loaded).toEqual(saved);
    if (loaded?.status === 'ok') expect((loaded.value as ProfileDoc).household.people[0]!.name).toBe('You');
  });

  it('rejects invalid documents before writing them', async () => {
    const result = await repo.put({ ...profile(), household: { ...profile().household, people: [] } });
    expect(result.status).toBe('invalid');
    expect(await repo.get('profile', 'household-1')).toBeNull();
  });

  it('reports stored documents that fail validation instead of dropping them', async () => {
    // Simulate a document written by a newer app version.
    const db = await openDatabase(`test-db-${dbCounter}`);
    await db.put('profiles', { ...profile(), schemaVersion: 99 }, 'household-1');
    const loaded = await repo.get('profile', 'household-1');
    expect(loaded?.status).toBe('invalid');
    expect(await repo.list('profile')).toHaveLength(1);
  });

  it('lists, deletes and deletes all', async () => {
    await repo.put(profile());
    await repo.put({ ...profile(), id: 'household-2', household: minimalHouseholdInput(2026, 'household-2') });
    await repo.put({ kind: 'settings', schemaVersion: 1, id: 'settings', updatedAt: '2026-10-18T12:00:00Z' });
    expect(await repo.list('profile')).toHaveLength(2);
    await repo.delete('profile', 'household-2');
    expect(await repo.list('profile')).toHaveLength(1);
    await repo.deleteAll();
    expect(await repo.list('profile')).toHaveLength(0);
    expect(await repo.get('settings', 'settings')).toBeNull();
  });
});
