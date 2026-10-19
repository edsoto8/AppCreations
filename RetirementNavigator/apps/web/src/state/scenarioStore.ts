/**
 * Scenarios (docs/financial-model.md §10). Each scenario is a validated `ScenarioDoc` persisted to the
 * IndexedDB `scenarios` store (debounced, like profiles). A scenario stores only its diff ops over the
 * base profile (`baseProfileId`), never a copy of the household, so edits to the base flow through.
 *
 * The profile store initializes this store with the same repository, flushes it, and calls
 * `removeForProfile` when a profile is deleted (a profile's scenarios go with it).
 */
import { create } from 'zustand';
import {
  CURRENT_SCHEMA_VERSION,
  presetScenario,
  ScenarioSchema,
  type Household,
  type Scenario,
  type ScenarioDoc,
  type ScenarioOp,
} from '@rn/engine';
import type { DocumentRepository } from '@/storage/repository';
import { newId } from '@/lib/ids';

const SAVE_DELAY_MS = 300;
const NAME_MAX = 80;

export interface ScenarioState {
  scenarios: Record<string, ScenarioDoc>;
  /** Stored scenario documents that failed validation (kept on disk, not loaded). */
  invalidDocuments: number;
  init: (repo: DocumentRepository) => Promise<void>;
  /** Validate and save a new scenario (a fresh id is assigned when the given one is taken). Returns its id. */
  createScenario: (scenario: Scenario) => Promise<string>;
  /**
   * Replace a scenario's ops (debounced save). With `asCustom`, a preset scenario becomes custom
   * (`preset` null): its ops no longer match the preset, so its label and summary must not claim it.
   */
  setOps: (id: string, ops: ScenarioOp[], opts?: { asCustom?: boolean }) => void;
  /**
   * Rebuild a preset scenario's ops from its stored parameters on the current base plan (after the
   * base changed, see `presetDrift`), with `currentYear` updated. No effect on a custom scenario.
   */
  rebuildPreset: (id: string, base: Household, currentYear: number) => void;
  renameScenario: (id: string, name: string) => void;
  duplicateScenario: (id: string) => Promise<string | null>;
  deleteScenario: (id: string) => Promise<void>;
  /** Delete every scenario whose base is `profileId` (in memory and on disk). */
  removeForProfile: (profileId: string) => Promise<void>;
  /** Wait for pending saves (tests, before unload). */
  flush: () => Promise<void>;
}

let repository: DocumentRepository | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, () => Promise<unknown>>();

function cancel(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  pending.delete(id);
}

function schedule(id: string, task: () => Promise<unknown>) {
  cancel(id);
  pending.set(id, task);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      pending.delete(id);
      void task();
    }, SAVE_DELAY_MS),
  );
}

const now = () => new Date().toISOString();

function toDoc(scenario: Scenario): ScenarioDoc {
  return { kind: 'scenario', schemaVersion: CURRENT_SCHEMA_VERSION, id: scenario.id, updatedAt: now(), scenario };
}

export const useScenarioStore = create<ScenarioState>((set, get) => {
  const save = (doc: ScenarioDoc) => {
    if (!repository) return;
    const repo = repository;
    schedule(doc.id, () => repo.put(doc));
  };
  const update = (id: string, change: (s: Scenario) => Scenario) => {
    const existing = get().scenarios[id];
    if (!existing) return;
    const parsed = ScenarioSchema.safeParse(change(existing.scenario));
    if (!parsed.success) return;
    const doc = toDoc(parsed.data);
    set((s) => ({ scenarios: { ...s.scenarios, [id]: doc } }));
    save(doc);
  };

  return {
    scenarios: {},
    invalidDocuments: 0,

    init: async (repo) => {
      // Write pending edits to the repository they were made against before switching.
      // A failed write (for example a closed database) must not block loading the new one.
      await get()
        .flush()
        .catch(() => undefined);
      repository = repo;
      const results = await repo.list('scenario');
      const valid: Record<string, ScenarioDoc> = {};
      let invalid = 0;
      for (const r of results) {
        if (r.status === 'ok') valid[r.value.id] = r.value;
        else invalid++;
      }
      set({ scenarios: valid, invalidDocuments: invalid });
    },

    createScenario: async (scenario) => {
      const taken = get().scenarios;
      const id = taken[scenario.id] ? newId('scenario') : scenario.id;
      const parsed = ScenarioSchema.parse({ ...scenario, id, name: scenario.name.trim().slice(0, NAME_MAX) });
      const doc = toDoc(parsed);
      set((s) => ({ scenarios: { ...s.scenarios, [doc.id]: doc } }));
      await repository?.put(doc);
      return doc.id;
    },

    setOps: (id, ops, opts = {}) =>
      update(id, (s) => (opts.asCustom ? { ...s, ops, preset: null, presetParams: {} } : { ...s, ops })),

    rebuildPreset: (id, base, currentYear) =>
      update(id, (s) => {
        if (s.preset === null) return s;
        const rebuilt = presetScenario(
          s.preset,
          base,
          { ...s.presetParams, currentYear },
          { scenarioId: s.id, name: s.name, baseProfileId: s.baseProfileId },
        );
        return { ...s, ops: rebuilt.ops, presetParams: rebuilt.presetParams };
      }),

    renameScenario: (id, name) => {
      const trimmed = name.trim();
      if (trimmed.length === 0) return;
      update(id, (s) => ({ ...s, name: trimmed.slice(0, NAME_MAX) }));
    },

    duplicateScenario: async (id) => {
      const existing = get().scenarios[id];
      if (!existing) return null;
      const copy = structuredClone(existing.scenario);
      return get().createScenario({
        ...copy,
        id: newId('scenario') as Scenario['id'],
        name: `${copy.name} (copy)`.slice(0, NAME_MAX),
      });
    },

    deleteScenario: async (id) => {
      set((s) => ({ scenarios: Object.fromEntries(Object.entries(s.scenarios).filter(([key]) => key !== id)) }));
      cancel(id);
      await repository?.delete('scenario', id);
    },

    removeForProfile: async (profileId) => {
      const inMemory = Object.values(get().scenarios)
        .filter((d) => d.scenario.baseProfileId === profileId)
        .map((d) => d.id);
      // Also catch stored documents not loaded into memory (for example saved by another tab).
      const stored = repository
        ? (await repository.list('scenario')).flatMap((r) =>
            r.status === 'ok' && r.value.scenario.baseProfileId === profileId ? [r.value.id] : [],
          )
        : [];
      const ids = new Set<string>([...inMemory, ...stored]);
      if (ids.size === 0) return;
      set((s) => ({ scenarios: Object.fromEntries(Object.entries(s.scenarios).filter(([key]) => !ids.has(key))) }));
      for (const id of ids) cancel(id);
      const repo = repository;
      if (repo) await Promise.all([...ids].map((id) => repo.delete('scenario', id)));
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

/** Scenarios built on `profileId`, sorted by name. */
export function scenariosOf(scenarios: Record<string, ScenarioDoc>, profileId: string | null): Scenario[] {
  if (!profileId) return [];
  return Object.values(scenarios)
    .filter((d) => d.scenario.baseProfileId === profileId)
    .map((d) => d.scenario)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
