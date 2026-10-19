/**
 * Turns a validated export bundle into the documents to store (BRIEF §5.11), for the two import
 * choices:
 * - `replace`: the file's documents exactly as they are (every current document is removed first).
 * - `add`: the file's documents next to the current ones. A profile or scenario id that is already
 *   taken gets a fresh id, and each scenario's `baseProfileId` (and any op on the household itself,
 *   which names it by id) follows its profile's new id. Current settings are kept.
 * Pure: no storage and no clock (ids come from the injected `makeId`).
 */
import type { ExportBundle, Household, ProfileDoc, Scenario, ScenarioDoc, SettingsDoc } from '@rn/engine';

export type ImportMode = 'replace' | 'add';

export interface ImportPlan {
  profiles: ProfileDoc[];
  scenarios: ScenarioDoc[];
  /** The settings document to store; null keeps the current settings (add) or stores none. */
  settings: SettingsDoc | null;
  /** Old id → new id for every profile whose id changed. */
  remappedProfiles: Record<string, string>;
  /** Old id → new id for every scenario whose id changed. */
  remappedScenarios: Record<string, string>;
}

export interface ExistingIds {
  profiles: ReadonlySet<string>;
  scenarios: ReadonlySet<string>;
}

/** Profile names, scenario counts and the schema version, for the confirmation step. */
export interface ImportPreview {
  schemaVersion: number;
  exportedAt: string;
  profiles: { id: string; name: string; scenarios: number }[];
  scenarioCount: number;
}

export function previewBundle(bundle: ExportBundle): ImportPreview {
  return {
    schemaVersion: bundle.schemaVersion,
    exportedAt: bundle.exportedAt,
    profiles: bundle.profiles.map((p) => ({
      id: p.id,
      name: p.household.name,
      scenarios: bundle.scenarios.filter((s) => s.scenario.baseProfileId === p.id).length,
    })),
    scenarioCount: bundle.scenarios.length,
  };
}

/** A fresh id not in `taken` (and remembered there). */
function freshId(prefix: string, taken: Set<string>, makeId: (prefix: string) => string): string {
  let id = makeId(prefix);
  while (taken.has(id)) id = makeId(prefix);
  taken.add(id);
  return id;
}

export function planImport(
  bundle: ExportBundle,
  mode: ImportMode,
  existing: ExistingIds,
  makeId: (prefix: string) => string,
): ImportPlan {
  if (mode === 'replace') {
    // An imported plan counts as set up, so the app does not send the person back to onboarding.
    const settings = bundle.settings
      ? { ...bundle.settings, onboardingComplete: bundle.settings.onboardingComplete || bundle.profiles.length > 0 }
      : null;
    return {
      profiles: bundle.profiles,
      scenarios: bundle.scenarios,
      settings,
      remappedProfiles: {},
      remappedScenarios: {},
    };
  }

  const takenProfiles = new Set<string>([...existing.profiles, ...bundle.profiles.map((p) => p.id)]);
  const takenScenarios = new Set<string>([...existing.scenarios, ...bundle.scenarios.map((s) => s.id)]);
  const remappedProfiles: Record<string, string> = {};
  const remappedScenarios: Record<string, string> = {};

  const profiles = bundle.profiles.map((doc): ProfileDoc => {
    if (!existing.profiles.has(doc.id)) return doc;
    const id = freshId('household', takenProfiles, makeId);
    remappedProfiles[doc.id] = id;
    return { ...doc, id: id as ProfileDoc['id'], household: { ...doc.household, id: id as Household['id'] } };
  });
  const scenarios = bundle.scenarios.map((doc): ScenarioDoc => {
    const baseProfileId = (remappedProfiles[doc.scenario.baseProfileId] ??
      doc.scenario.baseProfileId) as Scenario['baseProfileId'];
    const collides = existing.scenarios.has(doc.id);
    const id = collides ? freshId('scenario', takenScenarios, makeId) : doc.id;
    if (collides) remappedScenarios[doc.id] = id;
    if (!collides && baseProfileId === doc.scenario.baseProfileId) return doc;
    // Ops on the household itself name it by its id, so they follow the profile's new id too.
    const oldBase = doc.scenario.baseProfileId;
    const ops = doc.scenario.ops.map((op) =>
      op.op !== 'add' && op.collection === 'household' && op.id === oldBase && baseProfileId !== oldBase
        ? { ...op, id: baseProfileId }
        : op,
    );
    return {
      ...doc,
      id: id as ScenarioDoc['id'],
      scenario: { ...doc.scenario, id: id as Scenario['id'], baseProfileId, ops },
    };
  });
  return { profiles, scenarios, settings: null, remappedProfiles, remappedScenarios };
}
