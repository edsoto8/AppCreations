/**
 * File helpers for the Data & Privacy page. Downloads use a `blob:` URL on an `<a download>`: the
 * browser saves the file, nothing is fetched, and the CSP's `connect-src 'none'` does not apply.
 */
import type { ValidationIssue } from '@rn/engine';

export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke once the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** "Mid-career couple (sample)" → "mid-career-couple-sample" (file names). */
export function fileSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'profile';
}

const ITEM_NAMES: Record<string, string> = {
  profiles: 'Profile',
  scenarios: 'Scenario',
  people: 'person',
  accounts: 'account',
  workplacePlans: 'workplace plan',
  otherIncome: 'income source',
  pensions: 'pension',
  oneTimeEvents: 'one-time event',
  ops: 'change',
  steps: 'spending step',
  tiers: 'match tier',
  returns: 'year',
};

/** Wrapper keys that add nothing a reader needs ("profiles › 1 › household › people" → "Profile 1 › person 2"). */
const SKIPPED = new Set(['household', 'scenario']);

const words = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** An issue path in plain words: ["profiles", 0, "household", "people", 1, "birthYear"] → "Profile 1 › person 2 › birth year". */
export function describeIssuePath(path: readonly (string | number)[]): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    const next = path[i + 1];
    if (typeof key === 'string' && typeof next === 'number' && ITEM_NAMES[key]) {
      parts.push(`${ITEM_NAMES[key]} ${next + 1}`);
      i++;
    } else if (typeof key === 'number') {
      parts.push(`item ${key + 1}`);
    } else if (key !== undefined && !SKIPPED.has(key)) {
      parts.push(words(key));
    }
  }
  return parts.length === 0 ? 'The file' : capitalize(parts.join(' › '));
}

/** The technical path, for people who open the file to fix it: profiles[0].household.people[1].birthYear. */
export function technicalPath(path: readonly (string | number)[]): string {
  return path.map((k, i) => (typeof k === 'number' ? `[${k}]` : i === 0 ? k : `.${k}`)).join('');
}

export function issueLine(issue: ValidationIssue): string {
  return `${describeIssuePath(issue.path)}: ${issue.message}`;
}
