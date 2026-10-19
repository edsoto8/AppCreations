/**
 * JSON export and import (BRIEF §5.11). An export file holds profiles, their scenarios and the
 * settings document. Import parses, upgrades every document through the migration chain, validates
 * the bundle, and checks that each scenario's base profile is in the file. Anything else is
 * `invalid` with messages that say where the problem is; nothing is half-imported.
 */
import { CURRENT_SCHEMA_VERSION, ExportBundleSchema, type ExportBundle } from '../domain/documents';
import type { EngineResult, ValidationIssue } from '../domain/results';
import { zodIssues } from '../validation';
import { migrate } from './migrate';

/** Largest accepted file (characters): far above any real plan, small enough to parse safely. */
export const MAX_IMPORT_CHARS = 5_000_000;

export function exportJson(bundle: ExportBundle): string {
  // Validate on the way out too, so an export can always be imported again.
  return `${JSON.stringify(ExportBundleSchema.parse(bundle), null, 2)}\n`;
}

const invalid = (issues: ValidationIssue[]): EngineResult<never> => ({ status: 'invalid', issues });

export function importJson(text: string): EngineResult<ExportBundle> {
  if (typeof text !== 'string' || text.trim() === '') return invalid([{ path: [], message: 'The file is empty' }]);
  if (text.length > MAX_IMPORT_CHARS) {
    return invalid([{ path: [], message: 'The file is too large to be a Retirement Navigator export (over 5 MB)' }]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return invalid([{ path: [], message: `The file is not valid JSON (${detail})` }]);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalid([{ path: [], message: 'The file does not contain an export object' }]);
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== 'retirement-navigator-export') {
    return invalid([{ path: ['format'], message: 'This is not a Retirement Navigator export file' }]);
  }
  const version = obj.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return invalid([{ path: ['schemaVersion'], message: 'Missing or invalid schemaVersion' }]);
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return invalid([
      {
        path: ['schemaVersion'],
        message: `This file was created by a newer version of the app (schema ${version}); this version supports up to ${CURRENT_SCHEMA_VERSION}`,
      },
    ]);
  }

  // Upgrade each stored document through the migration chain.
  const issues: ValidationIssue[] = [];
  const upgrade = (key: 'profiles' | 'scenarios') => {
    const list = obj[key];
    if (!Array.isArray(list)) {
      issues.push({ path: [key], message: `Expected a list of ${key}` });
      return [];
    }
    return list.map((doc, i) => {
      const r = migrate(doc);
      if (r.status !== 'ok') {
        if (r.status === 'invalid')
          issues.push(...r.issues.map((issue) => ({ ...issue, path: [key, i, ...issue.path] })));
        return doc;
      }
      return r.value;
    });
  };
  const profiles = upgrade('profiles');
  const scenarios = upgrade('scenarios');
  let settings: unknown = obj.settings ?? null;
  if (settings !== null) {
    const r = migrate(settings);
    if (r.status === 'invalid')
      issues.push(...r.issues.map((issue) => ({ ...issue, path: ['settings', ...issue.path] })));
    else if (r.status === 'ok') settings = r.value;
  }
  if (issues.length > 0) return invalid(issues);

  const parsed = ExportBundleSchema.safeParse({
    ...obj,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profiles,
    scenarios,
    settings,
  });
  if (!parsed.success) return invalid(zodIssues(parsed.error));
  const bundle = parsed.data;

  const profileIds = new Set(bundle.profiles.map((p) => p.id as string));
  const seen = new Set<string>();
  bundle.profiles.forEach((p, i) => {
    if (seen.has(p.id)) issues.push({ path: ['profiles', i, 'id'], message: `Profile id ${p.id} appears twice` });
    seen.add(p.id);
  });
  bundle.scenarios.forEach((s, i) => {
    if (!profileIds.has(s.scenario.baseProfileId)) {
      issues.push({
        path: ['scenarios', i, 'scenario', 'baseProfileId'],
        message: `Scenario “${s.scenario.name}” refers to a profile that is not in the file`,
      });
    }
  });
  if (bundle.settings?.activeProfileId && !profileIds.has(bundle.settings.activeProfileId)) {
    issues.push({ path: ['settings', 'activeProfileId'], message: 'The active profile is not in the file' });
  }
  if (issues.length > 0) return invalid(issues);
  return { status: 'ok', value: bundle, warnings: [] };
}
