/**
 * Test helper: initialize the profile store on a fresh fake IndexedDB, add a household, and render
 * `ui` inside a router. Returns the store for assertions.
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SAMPLE_PROFILES, type Household } from '@rn/engine';
import { openDatabase } from '@/storage/db';
import { DocumentRepository } from '@/storage/repository';
import { useProfileStore } from '@/state/profileStore';

export const TEST_YEAR = 2026;
let counter = 0;

export async function setupProfile(household?: Household) {
  const repo = new DocumentRepository(await openDatabase(`rn-test-${++counter}`));
  await useProfileStore.getState().init(repo);
  const sample = SAMPLE_PROFILES.find((p) => p.id === 'midCareerCouple');
  const h = household ?? sample?.build(TEST_YEAR);
  if (!h) throw new Error('missing sample profile');
  await useProfileStore.getState().createProfile(h);
  return { repo, store: useProfileStore };
}

export async function renderWithProfile(ui: React.ReactElement, opts: { household?: Household; path?: string } = {}) {
  const ctx = await setupProfile(opts.household);
  const result = render(<MemoryRouter initialEntries={[opts.path ?? '/']}>{ui}</MemoryRouter>);
  return { ...ctx, ...result };
}
