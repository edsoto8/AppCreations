/**
 * Rules resolution and indexing (docs/financial-model.md §2).
 *
 * For each rule value in a tax-year file, independently:
 * - use the value published for `targetYear` if `targetYear <= anchorYear` and it is verified;
 * - otherwise take the latest verified value from a year `b <= min(anchorYear, targetYear)`:
 *   - `indexed`: project `v · (1 + indexRate)^(targetYear − b)`, rounded per the published rounding
 *     metadata (or to the cent when none is recorded), and note it as a labeled projection;
 *   - `statutory-fixed`: carry unchanged;
 *   - no indexation recorded: not projectable, so the result is unverified;
 * - with no verified base, the value stays null (unverified / notPublished) and dependent calculations
 *   return `unverified`. Nothing is ever defaulted.
 * Numbers under a key named `rate` (bracket rates) are never indexed; all other numbers in an indexed
 * value are money in cents.
 */
import type { CalendarYear, NominalRate } from '../domain/primitives';
import type { Rounding, RulesSet, TaxYearRules, Verified } from '../domain/rules';
import type { ResolvedYearRules } from '../api';
import { roundHalfEven } from '../money';

type AnyVerified = Verified<unknown>;

function isLeaf(node: unknown): node is AnyVerified {
  return (
    !!node &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    typeof (node as { status?: unknown }).status === 'string' &&
    'value' in node
  );
}

function leafAt(root: unknown, path: readonly string[]): AnyVerified | undefined {
  let node: unknown = root;
  for (const key of path) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return isLeaf(node) ? node : undefined;
}

function roundIndexed(cents: number, rounding: Rounding | null): number {
  if (!rounding) return roundHalfEven(cents);
  const inc = rounding.incrementDollars * 100;
  const units = cents / inc;
  // Guard float noise (e.g. 49.99999999 increments) before directional rounding.
  const nearest = Math.round(units);
  const snapped = Math.abs(units - nearest) < 1e-9 ? nearest : units;
  const n =
    rounding.mode === 'down'
      ? Math.floor(snapped)
      : rounding.mode === 'up'
        ? Math.ceil(snapped)
        : roundHalfEven(snapped);
  return n * inc;
}

function indexValue(value: unknown, factor: number, rounding: Rounding | null, key?: string): unknown {
  if (typeof value === 'number') return key === 'rate' ? value : roundIndexed(value * factor, rounding);
  if (Array.isArray(value)) return value.map((v) => indexValue(v, factor, rounding));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, indexValue(v, factor, rounding, k)]));
  }
  return value;
}

function resolveLeaf(
  rules: RulesSet,
  path: readonly string[],
  usableYears: readonly number[],
  targetYear: number,
  indexRate: number,
): AnyVerified {
  const own = leafAt(rules.years[String(targetYear)], path);
  if (own?.status === 'verified' && usableYears.includes(targetYear)) return own;

  for (const base of [...usableYears].reverse()) {
    const leaf = leafAt(rules.years[String(base)], path);
    if (leaf?.status !== 'verified') continue;
    if (leaf.indexation === 'statutory-fixed') {
      return { ...leaf, notes: `Carried from ${base} (statutory-fixed).` };
    }
    if (leaf.indexation === 'indexed') {
      const years = targetYear - base;
      const factor = Math.pow(1 + indexRate, years);
      const pct = roundHalfEven(indexRate * 10_000) / 100;
      return {
        ...leaf,
        value: indexValue(leaf.value, factor, leaf.rounding),
        notes: `Projected from ${base} at ${pct}% per year for ${years} year(s) (assumption, not a published value).`,
      };
    }
  }

  // No verified base: report the most specific null entry available.
  const latestUsable =
    usableYears.length > 0 ? leafAt(rules.years[String(usableYears[usableYears.length - 1])], path) : undefined;
  const fallback = own ?? latestUsable;
  if (fallback && fallback.status !== 'verified') return fallback;
  return {
    status: 'unverified',
    value: null,
    source: null,
    unverifiedReason:
      fallback?.status === 'verified'
        ? `No published ${targetYear} value, and the latest value cannot be projected (no indexation recorded).`
        : `No rules data at or before ${targetYear}.`,
    indexation: null,
    candidate: null,
  };
}

function rebuild(template: unknown, path: string[], resolve: (path: readonly string[]) => AnyVerified): unknown {
  if (isLeaf(template)) return resolve(path);
  if (template && typeof template === 'object' && !Array.isArray(template)) {
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, rebuild(v, [...path, k], resolve)]));
  }
  return template;
}

export function resolveRules(
  rules: RulesSet,
  opts: { anchorYear: CalendarYear; targetYear: CalendarYear; indexRate: NominalRate },
): ResolvedYearRules {
  const available = Object.keys(rules.years)
    .map(Number)
    .sort((a, b) => a - b);
  const limit = Math.min(opts.anchorYear, opts.targetYear);
  const usable = available.filter((y) => y <= limit);
  const templateYear = usable[usable.length - 1] ?? available[0];
  const template = templateYear === undefined ? undefined : rules.years[String(templateYear)];
  if (!template) throw new RangeError('The rules set has no tax-year files');

  const values = {
    ...(rebuild(template, [], (path) =>
      resolveLeaf(rules, path, usable, opts.targetYear, opts.indexRate),
    ) as TaxYearRules),
    taxYear: opts.targetYear,
  };
  const baseYear = usable[usable.length - 1] ?? opts.targetYear;
  return {
    taxYear: opts.targetYear,
    baseYear,
    projected: baseYear < opts.targetYear,
    values,
    standing: rules.standing,
  };
}
