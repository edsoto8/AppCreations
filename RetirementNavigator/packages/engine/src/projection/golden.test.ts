/**
 * Golden projection tests (gate M3). Expectations are independent of the engine:
 * - `reference/fixtures/*.json` come from the Python reference `reference/ref.py`, written from
 *   docs/financial-model.md only (regenerate with `python3 packages/engine/reference/ref.py --write`);
 * - the closed forms below are computed by hand in the test and cross-checked against published
 *   annuity table values.
 * The bundled rules are all unverified, so workplace contributions run "before limits" (§1.7).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HouseholdSchema, RULES, minimalHouseholdInput, projectHousehold, type HouseholdInput } from '../index';
import type { ProjectionResult } from '../index';

const FIXTURE_DIR = join(new URL('.', import.meta.url).pathname, '..', '..', 'reference', 'fixtures');

interface Fixture {
  name: string;
  description: string;
  currentYear: number;
  household: HouseholdInput;
  expected: { rows: Record<string, unknown>[]; summary: Record<string, unknown>; warnings: string[] };
}

const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) as Fixture);

/** Integer fields that are not money (compared exactly); every other integer is cents (±1). */
const EXACT_INTEGERS = new Set([
  'year',
  'age',
  'firstYear',
  'lastYear',
  'retirementYear',
  'firstDeathYear',
  'depletionYear',
  'depletionAge',
]);
const CENT_TOLERANCE = 1;

/** Every figure in `expected` must be present in `actual`; arrays of entities are matched by id. */
function compare(path: string, key: string, expected: unknown, actual: unknown, out: string[]): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return void out.push(`${path}: expected an array, got ${JSON.stringify(actual)}`);
    if (key === 'markers' || key === 'infeasibleYears') {
      const e = JSON.stringify([...expected].sort());
      const a = JSON.stringify([...actual].sort());
      if (e !== a) out.push(`${path}: expected ${e}, got ${a}`);
      return;
    }
    if (expected.length !== actual.length) out.push(`${path}: expected ${expected.length} items, got ${actual.length}`);
    expected.forEach((item, i) => {
      const id = (item as Record<string, unknown>).accountId ?? (item as Record<string, unknown>).personId;
      const match =
        id === undefined
          ? actual[i]
          : actual.find(
              (x) => (x as Record<string, unknown>).accountId === id || (x as Record<string, unknown>).personId === id,
            );
      compare(`${path}[${String(id ?? i)}]`, key, item, match, out);
    });
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') return void out.push(`${path}: missing`);
    for (const [k, v] of Object.entries(expected)) {
      compare(`${path}.${k}`, k, v, (actual as Record<string, unknown>)[k], out);
    }
    return;
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (key === 'deflator') {
      if (Math.abs(expected - actual) > 1e-12 * Math.max(1, Math.abs(expected)))
        out.push(`${path}: expected ${expected}, got ${actual}`);
    } else if (EXACT_INTEGERS.has(key) || !Number.isInteger(expected)) {
      if (expected !== actual) out.push(`${path}: expected ${expected}, got ${actual}`);
    } else if (Math.abs(expected - actual) > CENT_TOLERANCE) {
      out.push(`${path}: expected ${expected}, got ${actual} (${actual - expected} cents)`);
    }
    return;
  }
  if (expected !== actual) out.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function run(input: HouseholdInput, currentYear: number): ProjectionResult {
  const r = projectHousehold(HouseholdSchema.parse(input), { currentYear, rules: RULES });
  if (r.status !== 'ok') throw new Error(`projection ${r.status}: ${JSON.stringify(r)}`);
  return r.value;
}

describe('golden fixtures from the Python reference (every figure within 1 cent)', () => {
  it('has at least 8 fixtures, each a valid household', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    for (const f of fixtures) expect(HouseholdSchema.safeParse(f.household).success, f.name).toBe(true);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s: per-year rows and summary within 1 cent', (_name, f) => {
    const result = run(f.household, f.currentYear);
    const diffs: string[] = [];
    compare('rows', 'rows', f.expected.rows, result.rows, diffs);
    compare('summary', 'summary', f.expected.summary, result.summary, diffs);
    const codes = new Set(result.warnings.map((w) => w.code));
    for (const code of f.expected.warnings) if (!codes.has(code)) diffs.push(`warnings: missing ${code}`);
    expect(diffs.slice(0, 40), `${diffs.length} difference(s); ${f.description}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Hand-derived closed forms and published annuity-table values (not in project.test.ts)
// ---------------------------------------------------------------------------------------------

const YEAR = 2026;

function single(person: Record<string, unknown>, accounts: Record<string, unknown>[], extra: Record<string, unknown>) {
  const base = minimalHouseholdInput(YEAR);
  return {
    ...base,
    people: [{ ...base.people[0]!, ...person }],
    accounts,
    spending: { currentAnnualSpending: 0, retirementAnnualSpending: 0, ...(extra.spending as object) },
    assumptions: { ...base.assumptions, inflation: 0, ...(extra.assumptions as object) },
  } as HouseholdInput;
}

const cashAccount = (balanceCents: number, extra: Record<string, unknown>) => ({
  type: 'cash',
  id: 'cash',
  name: 'Cash',
  ownerId: 'person-1',
  balance: balanceCents,
  ...extra,
});

const endOf = (r: ProjectionResult, index: number) => r.rows[index]!.accounts.find((a) => a.accountId === 'cash')!.end;

describe('closed forms and published table values', () => {
  it('annuity due (start-of-year withdrawals): B = W·(1+r)·(1 − (1+r)^−n)/r; ä(10, 5%) = 8.1078 (PVIFA-due table)', () => {
    const r = 0.05;
    const n = 10;
    const w = 40_000;
    const factor = ((1 + r) * (1 - Math.pow(1 + r, -n))) / r;
    expect(factor).toBeCloseTo(8.1078, 4); // standard present-value-of-annuity-due table, 5%, 10 periods
    const exact = w * factor;
    const balance = Math.ceil(exact * 100);
    const result = run(
      single(
        { birthYear: YEAR - 70, retirementAge: 65, planningAge: 95 },
        [cashAccount(balance, { expectedReturn: r })],
        { spending: { retirementAnnualSpending: w * 100 }, assumptions: { withdrawalTiming: 'startOfYear' } },
      ),
      YEAR,
    );
    // The only money left after n withdrawals is the rounding residue, grown n years.
    const residue = (balance / 100 - exact) * Math.pow(1 + r, n) * 100;
    expect(Math.abs(endOf(result, n - 1) - residue)).toBeLessThanOrEqual(1);
    expect(result.rows[n - 1]!.depleted).toBe(false);
    expect(result.rows[n]!.depleted).toBe(true);
    for (let k = 0; k < n; k++) expect(result.rows[k]!.flows.withdrawals).toBe(w * 100);
  });

  it('monthly end-of-month saving: $100/month at 0.5%/month for 10 years = $16,387.93 (FV of an ordinary annuity)', () => {
    // Textbook example: 6% compounded monthly, 120 deposits of $100, FV = 100·((1.005)^120 − 1)/0.005.
    const fv = (100 * (Math.pow(1.005, 120) - 1)) / 0.005;
    expect(fv).toBeCloseTo(16_387.93, 2);
    const result = run(
      single(
        {
          birthYear: YEAR - 40,
          retirementAge: 50,
          planningAge: 60,
          employment: { baseSalary: 0, raise: { mode: 'nominal', rate: 0 } },
        },
        [
          cashAccount(0, {
            expectedReturn: Math.pow(1.005, 12) - 1,
            contribution: { amount: { kind: 'dollars', amount: 10_000, frequency: 'monthly' } },
          }),
        ],
        { assumptions: { granularity: 'monthly' } },
      ),
      YEAR,
    );
    expect(Math.abs(endOf(result, 9) - 1_638_793)).toBeLessThanOrEqual(1);
    expect(result.rows[10]!.accounts[0]!.contributions).toBe(0);
  });

  it('monthly start-of-month withdrawals: $1,000/month for 20 years at 0.5%/month needs PVIFA(0.5%, 240)·1.005 = $140,278.68', () => {
    const rm = 0.005;
    const pvifa = (1 - Math.pow(1 + rm, -240)) / rm;
    expect(pvifa).toBeCloseTo(139.5808, 4); // present-value-of-annuity table, 0.5%, 240 periods
    const exact = 1_000 * pvifa * (1 + rm);
    expect(exact).toBeCloseTo(140_278.68, 2);
    const balance = Math.ceil(exact * 100);
    const result = run(
      single(
        { birthYear: YEAR - 70, retirementAge: 65, planningAge: 95 },
        [cashAccount(balance, { expectedReturn: Math.pow(1 + rm, 12) - 1 })],
        {
          spending: { retirementAnnualSpending: 1_200_000 },
          assumptions: { granularity: 'monthly', withdrawalTiming: 'startOfYear' },
        },
      ),
      YEAR,
    );
    const residue = (balance / 100 - exact) * Math.pow(1 + rm, 240) * 100;
    expect(Math.abs(endOf(result, 19) - residue)).toBeLessThanOrEqual(1);
    expect(result.rows[19]!.depleted).toBe(false);
    expect(result.rows[20]!.depleted).toBe(true);
  });

  it('zero return and zero inflation: contributions and withdrawals add exactly, to the cent', () => {
    const result = run(
      single(
        {
          birthYear: YEAR - 60,
          retirementAge: 63,
          planningAge: 70,
          employment: { baseSalary: 0, raise: { mode: 'nominal', rate: 0 } },
        },
        [
          cashAccount(1_234_567, {
            expectedReturn: 0,
            contribution: { amount: { kind: 'dollars', amount: 33_333, frequency: 'monthly' } },
          }),
        ],
        { spending: { retirementAnnualSpending: 277_777 } },
      ),
      YEAR,
    );
    // 3 years × 12 × $333.33, then 8 withdrawals of $2,777.77.
    expect(endOf(result, 2)).toBe(1_234_567 + 3 * 12 * 33_333);
    expect(endOf(result, 10)).toBe(1_234_567 + 3 * 12 * 33_333 - 8 * 277_777);
    for (const row of result.rows) expect(row.accounts[0]!.growthNet).toBe(0);
  });
});
