/**
 * Shared invariant checks for the QA soak and save tests. Test helper only (not a test file:
 * vitest picks up `tests/**\/*.test.ts`).
 */
import { getStorageCapacity, RESOURCE_TYPES, type GameState } from '../../src/sim';

/** Walk every value reachable from `root` and return the paths of NaN, Infinity or undefined leaves. */
export function findNonFinite(root: unknown, limit = 20): string[] {
  const bad: string[] = [];
  const stack: { value: unknown; path: string }[] = [{ value: root, path: '$' }];
  while (stack.length > 0 && bad.length < limit) {
    const { value, path } = stack.pop()!;
    if (value === undefined) {
      bad.push(`${path} is undefined`);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) bad.push(`${path} is ${String(value)}`);
    } else if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) stack.push({ value: value[i], path: `${path}[${i}]` });
      } else {
        for (const [k, v] of Object.entries(value)) stack.push({ value: v, path: `${path}.${k}` });
      }
    }
  }
  return bad;
}

/** Returns a list of violated resource bounds (empty when everything is within 0..capacity). */
export function resourceViolations(state: GameState): string[] {
  const cap = getStorageCapacity(state);
  const out: string[] = [];
  for (const r of RESOURCE_TYPES) {
    const v = state.colony.stock[r];
    if (!(v >= 0)) out.push(`stock.${r} = ${v} (negative)`);
    if (v > cap) out.push(`stock.${r} = ${v} exceeds capacity ${cap}`);
  }
  return out;
}

/** Returns a list of population violations (negative counts, mismatched counters). */
export function populationViolations(state: GameState): string[] {
  const out: string[] = [];
  if (state.settlers.length < 0) out.push('negative settler count');
  if (state.stats.deaths < 0 || state.stats.births < 0 || state.stats.arrivals < 0) out.push('negative lifetime counter');
  const ids = new Set(state.settlers.map((s) => s.id));
  if (ids.size !== state.settlers.length) out.push('duplicate settler ids');
  return out;
}
