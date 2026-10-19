/**
 * Profiles and settings. Every profile is a validated `ProfileDoc` persisted to IndexedDB (debounced);
 * settings (active profile, onboarding, dollar basis) live in the settings document. Scenarios live in
 * `scenarioStore`, which this store initializes, flushes, and prunes when a profile is deleted.
 */
import { create } from 'zustand';
import {
  CURRENT_SCHEMA_VERSION,
  HouseholdSchema,
  type DollarBasis,
  type EngineResult,
  type ExportBundle,
  type Household,
  type ProfileDoc,
  type ScenarioDoc,
  type SettingsDoc,
  type StoredDoc,
} from '@rn/engine';
import type { DocumentRepository } from '@/storage/repository';
import { newId } from '@/lib/ids';
import { useScenarioStore } from './scenarioStore';
import { planImport, type ImportMode } from './importPlan';

export interface ImportOutcome {
  profiles: number;
  scenarios: number;
  /** Profiles and scenarios that got a fresh id because theirs was taken (add alongside). */
  renamedIds: number;
}

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
  /**
   * Every loaded profile, the scenarios built on them and the settings, as one export bundle
   * (`exportedAt` is passed in: the caller reads the clock).
   */
  exportBundle: (exportedAt: string) => ExportBundle;
  /**
   * Store a validated bundle (`importJson`) in one transaction, then show it: `replace` removes every
   * current document first; `add` keeps them and gives colliding ids fresh ones. Nothing changes,
   * in storage or in memory, unless every document is written.
   */
  importBundle: (bundle: ExportBundle, mode: ImportMode) => Promise<EngineResult<ImportOutcome>>;
  /** Remove every profile, scenario and the settings from storage and memory (onboarding again). */
  deleteAllData: () => Promise<void>;
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
        const [profiles, settings] = await Promise.all([
          repo.list('profile'),
          repo.get('settings', 'settings'),
          useScenarioStore.getState().init(repo),
        ]);
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
      // A profile's scenarios are diffs over it, so they are deleted with it, first: if the profile
      // delete were interrupted, no scenario is left pointing at a missing base.
      await useScenarioStore.getState().removeForProfile(id);
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

    exportBundle: (exportedAt) => {
      const { profiles, activeId, onboardingComplete, dollarBasis } = get();
      const profileDocs = Object.values(profiles);
      const ids = new Set(profileDocs.map((p) => p.id as string));
      // A scenario whose base profile is not loaded could not be imported again, so it is left out.
      const scenarios = Object.values(useScenarioStore.getState().scenarios).filter((d) =>
        ids.has(d.scenario.baseProfileId),
      );
      return {
        format: 'retirement-navigator-export',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        exportedAt,
        profiles: profileDocs,
        scenarios,
        settings: {
          kind: 'settings',
          schemaVersion: CURRENT_SCHEMA_VERSION,
          id: 'settings',
          updatedAt: exportedAt,
          activeProfileId: activeId && ids.has(activeId) ? (activeId as SettingsDoc['activeProfileId']) : null,
          onboardingComplete,
          dollarBasis,
        },
      };
    },

    importBundle: async (bundle, mode) => {
      const repo = repository;
      if (!repo) return { status: 'invalid', issues: [{ path: [], message: 'Local storage is not open yet' }] };
      // Write pending edits first; with "replace" they are then discarded along with the old data.
      await get().flush();
      const scenarioStore = useScenarioStore.getState();
      const current = get();
      const plan = planImport(
        bundle,
        mode,
        { profiles: new Set(Object.keys(current.profiles)), scenarios: new Set(Object.keys(scenarioStore.scenarios)) },
        newId,
      );
      const firstImported = plan.profiles[0]?.id ?? null;
      const settings: SettingsDoc =
        mode === 'replace'
          ? (plan.settings ?? {
              kind: 'settings',
              schemaVersion: CURRENT_SCHEMA_VERSION,
              id: 'settings',
              updatedAt: now(),
              activeProfileId: firstImported,
              onboardingComplete: plan.profiles.length > 0,
              dollarBasis: current.dollarBasis,
            })
          : {
              kind: 'settings',
              schemaVersion: CURRENT_SCHEMA_VERSION,
              id: 'settings',
              updatedAt: now(),
              activeProfileId: (current.activeId ?? firstImported) as SettingsDoc['activeProfileId'],
              onboardingComplete: current.onboardingComplete || plan.profiles.length > 0,
              dollarBasis: current.dollarBasis,
            };
      let written: EngineResult<StoredDoc[]>;
      try {
        written = await repo.writeAll([...plan.profiles, ...plan.scenarios, settings], { clear: mode === 'replace' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'invalid', issues: [{ path: [], message: `Could not save the import: ${message}` }] };
      }
      if (written.status !== 'ok') return written;
      const stored = written.value;
      const profileDocs = stored.filter((d): d is ProfileDoc => d.kind === 'profile');
      const scenarioDocs = stored.filter((d): d is ScenarioDoc => d.kind === 'scenario');
      const storedSettings = stored.find((d): d is SettingsDoc => d.kind === 'settings') ?? settings;
      const imported = Object.fromEntries(profileDocs.map((d) => [d.id, d]));
      const profiles = mode === 'replace' ? imported : { ...current.profiles, ...imported };
      const wanted = storedSettings.activeProfileId;
      if (mode === 'replace') {
        for (const t of timers.values()) clearTimeout(t);
        timers.clear();
        pending.clear();
      }
      set({
        profiles,
        activeId: wanted && profiles[wanted] ? wanted : (Object.keys(profiles)[0] ?? null),
        onboardingComplete: storedSettings.onboardingComplete,
        dollarBasis: storedSettings.dollarBasis,
        invalidDocuments: mode === 'replace' ? 0 : current.invalidDocuments,
      });
      scenarioStore.load(scenarioDocs, { replace: mode === 'replace' });
      return {
        status: 'ok',
        value: {
          profiles: profileDocs.length,
          scenarios: scenarioDocs.length,
          renamedIds: Object.keys(plan.remappedProfiles).length + Object.keys(plan.remappedScenarios).length,
        },
        warnings: [],
      };
    },

    deleteAllData: async () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      pending.clear();
      useScenarioStore.getState().reset();
      await repository?.deleteAll();
      // No settings write here: an empty store is the first-run state.
      set({ profiles: {}, activeId: null, onboardingComplete: false, dollarBasis: 'todays', invalidDocuments: 0 });
    },

    flush: async () => {
      const tasks = [...pending.values()];
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      pending.clear();
      await Promise.all([...tasks.map((task) => task()), useScenarioStore.getState().flush()]);
    },
  };
});

export function useActiveProfile(): ProfileDoc | null {
  return useProfileStore((s) => (s.activeId ? (s.profiles[s.activeId] ?? null) : null));
}
