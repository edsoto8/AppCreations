/**
 * Profiles and settings. Every profile is a validated `ProfileDoc` persisted to IndexedDB (debounced);
 * settings (active profile, onboarding, dollar basis) live in the settings document.
 */
import { create } from 'zustand';
import { HouseholdSchema, type DollarBasis, type Household, type ProfileDoc } from '@rn/engine';
import type { DocumentRepository } from '@/storage/repository';
import { newId } from '@/lib/ids';

const SAVE_DELAY_MS = 300;

export interface ProfileState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  profiles: Record<string, ProfileDoc>;
  /** Stored documents that failed validation (kept on disk, not loaded). */
  invalidDocuments: number;
  activeId: string | null;
  onboardingComplete: boolean;
  dollarBasis: DollarBasis;
  init: (repo: DocumentRepository) => Promise<void>;
  createProfile: (household: Household, opts?: { activate?: boolean }) => Promise<string>;
  updateActiveHousehold: (household: Household) => void;
  renameProfile: (id: string, name: string) => void;
  duplicateProfile: (id: string) => Promise<string | null>;
  deleteProfile: (id: string) => Promise<void>;
  setActive: (id: string) => void;
  completeOnboarding: () => void;
  setDollarBasis: (basis: DollarBasis) => void;
  /** Wait for pending saves (tests, before unload). */
  flush: () => Promise<void>;
}

let repository: DocumentRepository | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, () => Promise<unknown>>();

function schedule(key: string, task: () => Promise<unknown>) {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  pending.set(key, task);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      pending.delete(key);
      void task();
    }, SAVE_DELAY_MS),
  );
}

const now = () => new Date().toISOString();

function toDoc(household: Household): ProfileDoc {
  return { kind: 'profile', schemaVersion: 1, id: household.id, updatedAt: now(), household };
}

/** Re-key a household (and keep ids unique) for a duplicated profile. */
function cloneHousehold(source: Household, name: string): Household {
  const copy = structuredClone(source);
  copy.id = newId('household') as Household['id'];
  copy.name = name;
  return HouseholdSchema.parse(copy);
}

export const useProfileStore = create<ProfileState>((set, get) => {
  // Settings change rarely and gate navigation (onboarding), so they are written immediately.
  const saveSettings = () => {
    if (!repository) return;
    const { activeId, onboardingComplete, dollarBasis } = get();
    void repository.put({
      kind: 'settings',
      schemaVersion: 1,
      id: 'settings',
      updatedAt: now(),
      activeProfileId: activeId,
      onboardingComplete,
      dollarBasis,
    });
  };
  const saveProfile = (doc: ProfileDoc) => {
    if (!repository) return;
    const repo = repository;
    schedule(`profile:${doc.id}`, () => repo.put(doc));
  };

  return {
    status: 'idle',
    error: null,
    profiles: {},
    invalidDocuments: 0,
    activeId: null,
    onboardingComplete: false,
    dollarBasis: 'todays',

    init: async (repo) => {
      repository = repo;
      set({ status: 'loading', error: null });
      try {
        const [profiles, settings] = await Promise.all([repo.list('profile'), repo.get('settings', 'settings')]);
        const valid: Record<string, ProfileDoc> = {};
        let invalid = 0;
        for (const r of profiles) {
          if (r.status === 'ok') valid[r.value.id] = r.value;
          else invalid++;
        }
        const s = settings?.status === 'ok' ? settings.value : null;
        const activeId =
          s?.activeProfileId && valid[s.activeProfileId] ? s.activeProfileId : (Object.keys(valid)[0] ?? null);
        set({
          status: 'ready',
          profiles: valid,
          invalidDocuments: invalid,
          activeId,
          onboardingComplete: s?.onboardingComplete ?? false,
          dollarBasis: s?.dollarBasis ?? 'todays',
        });
      } catch (error) {
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    },

    createProfile: async (household, opts = {}) => {
      const parsed = HouseholdSchema.parse(household);
      // A household id that is already taken (for example a second copy of a sample) gets a suffix,
      // so creating a profile never overwrites an existing one.
      const taken = get().profiles;
      let id: string = parsed.id;
      for (let n = 2; taken[id]; n++) id = `${parsed.id.slice(0, 56)}-${n}`;
      const doc = toDoc({ ...parsed, id: id as typeof parsed.id });
      set((s) => ({
        profiles: { ...s.profiles, [doc.id]: doc },
        activeId: opts.activate === false ? s.activeId : doc.id,
      }));
      await repository?.put(doc);
      saveSettings();
      return doc.id;
    },

    updateActiveHousehold: (household) => {
      const { activeId, profiles } = get();
      if (!activeId || !profiles[activeId]) return;
      const doc = toDoc({ ...household, id: profiles[activeId].household.id });
      set((s) => ({ profiles: { ...s.profiles, [doc.id]: doc } }));
      saveProfile(doc);
    },

    renameProfile: (id, name) => {
      const existing = get().profiles[id];
      const trimmed = name.trim();
      if (!existing || trimmed.length === 0) return;
      const doc = toDoc({ ...existing.household, name: trimmed.slice(0, 80) });
      set((s) => ({ profiles: { ...s.profiles, [id]: doc } }));
      saveProfile(doc);
    },

    duplicateProfile: async (id) => {
      const existing = get().profiles[id];
      if (!existing) return null;
      return get().createProfile(cloneHousehold(existing.household, `${existing.household.name} (copy)`.slice(0, 80)));
    },

    deleteProfile: async (id) => {
      const { profiles, activeId } = get();
      const rest = Object.fromEntries(Object.entries(profiles).filter(([key]) => key !== id));
      set({ profiles: rest, activeId: activeId === id ? (Object.keys(rest)[0] ?? null) : activeId });
      const t = timers.get(`profile:${id}`);
      if (t) clearTimeout(t);
      timers.delete(`profile:${id}`);
      pending.delete(`profile:${id}`);
      await repository?.delete('profile', id);
      saveSettings();
    },

    setActive: (id) => {
      if (!get().profiles[id]) return;
      set({ activeId: id });
      saveSettings();
    },

    completeOnboarding: () => {
      set({ onboardingComplete: true });
      saveSettings();
    },

    setDollarBasis: (dollarBasis) => {
      set({ dollarBasis });
      saveSettings();
    },

    flush: async () => {
      const tasks = [...pending.values()];
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      pending.clear();
      await Promise.all(tasks.map((task) => task()));
    },
  };
});

export function useActiveProfile(): ProfileDoc | null {
  return useProfileStore((s) => (s.activeId ? (s.profiles[s.activeId] ?? null) : null));
}
