/**
 * Scenarios (docs/financial-model.md §10): diffs over a base household, keyed by entity id, applied to
 * a deep copy and re-validated. Presets A–G build ops; the optimizer scans retirement ages.
 */
import type { Household, HouseholdInput } from '../domain/household';
import { HouseholdSchema } from '../domain/household';
import type { EngineResult, ValidationIssue } from '../domain/results';
import type { OrphanedOp, Scenario, ScenarioOp, ScenarioPreset } from '../domain/scenario';
import type { EngineContext, OptimizerResult, ScenarioApplication, ScenarioOutcome } from '../api';
import type { MonteCarloConfig } from '../domain/montecarlo';
import type { Cents } from '../domain/primitives';
import { zodIssues } from '../validation';
import { projectHousehold } from '../projection/project';
import { computeDashboard } from '../projection/dashboard';
import { toCents } from '../money';

type Json = Record<string, unknown>;
type Path = (string | number)[];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Find the entity object an op targets; null when missing. */
function locate(
  h: Json,
  op: Exclude<ScenarioOp, { op: 'add' }>,
): { list: Json[] | null; index: number; entity: Json } | null {
  if (op.collection === 'household') return h.id === op.id ? { list: null, index: -1, entity: h } : null;
  if (op.collection === 'workplacePlans') {
    for (const person of h.people as Json[]) {
      const plans = person.workplacePlans as Json[];
      const index = plans.findIndex((p) => p.id === op.id);
      const entity = plans[index];
      if (entity) return { list: plans, index, entity };
    }
    return null;
  }
  const list = h[op.collection] as Json[];
  const index = list.findIndex((e) => e.id === op.id);
  const entity = list[index];
  return entity ? { list, index, entity } : null;
}

/** Set a value at a path; false when an intermediate step does not exist. */
function setAt(target: Json, path: Path, value: unknown): boolean {
  let node: unknown = target;
  for (const key of path.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return false;
    node = (node as Record<string | number, unknown>)[key];
  }
  const last = path[path.length - 1];
  if (node === null || typeof node !== 'object' || last === undefined) return false;
  if (Array.isArray(node) && (typeof last !== 'number' || last > node.length)) return false;
  (node as Record<string | number, unknown>)[last] = clone(value);
  return true;
}

/** Remove the key at a path so the schema default applies on re-validation. */
function unsetAt(target: Json, path: Path): boolean {
  let node: unknown = target;
  for (const key of path.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return false;
    node = (node as Record<string | number, unknown>)[key];
  }
  const last = path[path.length - 1];
  if (node === null || typeof node !== 'object' || Array.isArray(node) || last === undefined) return false;
  if (!(last in (node as object))) return false;
  // Rebuild the object without the key (no dynamic delete), keeping it in place for its parent.
  const record = node as Record<string, unknown>;
  const kept = Object.entries(record).filter(([k]) => k !== String(last));
  for (const k of Object.keys(record)) Reflect.deleteProperty(record, k);
  Object.assign(record, Object.fromEntries(kept));
  return true;
}

export function applyScenario(base: Household, scenario: Scenario): ScenarioApplication {
  const h = clone(base) as unknown as Json;
  const orphaned: OrphanedOp[] = [];
  let appliedOps = 0;
  scenario.ops.forEach((op, opIndex) => {
    if (op.op === 'add') {
      const entity = clone(op.entity) as Json;
      if (op.collection === 'workplacePlans') {
        const parent = (h.people as Json[]).find((p) => p.id === op.parentId);
        if (!parent) {
          orphaned.push({ opIndex, op, reason: 'missingParent' });
          return;
        }
        (parent.workplacePlans as Json[]).push(entity);
      } else {
        (h[op.collection] as Json[]).push(entity);
      }
      appliedOps++;
      return;
    }
    const target = locate(h, op);
    if (!target) {
      orphaned.push({ opIndex, op, reason: 'missingEntity' });
      return;
    }
    if (op.op === 'unset' && op.path === null) {
      if (target.list === null) {
        orphaned.push({ opIndex, op, reason: 'invalidPath' });
        return;
      }
      target.list.splice(target.index, 1);
      appliedOps++;
      return;
    }
    const ok = op.op === 'set' ? setAt(target.entity, op.path, op.value) : unsetAt(target.entity, op.path ?? []);
    if (!ok) {
      orphaned.push({ opIndex, op, reason: 'invalidPath' });
      return;
    }
    appliedOps++;
  });
  const parsed = HouseholdSchema.safeParse(h as HouseholdInput);
  if (!parsed.success) return { household: null, appliedOps, orphaned, issues: zodIssues(parsed.error) };
  return { household: parsed.data, appliedOps, orphaned, issues: [] };
}

// ---- Presets (§10) ------------------------------------------------------------------------------

const num = (params: Record<string, number | string | boolean>, key: string, fallback: number): number => {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/** First year in which every person has reached their retirement age. */
export function firstRetirementYearOf(h: Household): number {
  return Math.max(...h.people.map((p) => p.birthYear + p.retirementAge));
}

const set = (collection: Exclude<ScenarioOp, { op: 'add' }>['collection'], id: string, path: Path, value: unknown) =>
  ({ op: 'set', collection, id, path, value }) as ScenarioOp;

export function presetScenario(
  preset: ScenarioPreset,
  base: Household,
  params: Record<string, number | string | boolean>,
  ids: { scenarioId: string; name: string; baseProfileId: string },
): Scenario {
  const ops: ScenarioOp[] = [];
  const used: Record<string, number | string | boolean> = {};
  const currentYear = num(params, 'currentYear', NaN);
  switch (preset) {
    case 'A_baseline':
      break;
    case 'B_earlyRetirement': {
      const years = num(params, 'years', 5);
      used.years = years;
      for (const p of base.people) {
        const current = Number.isFinite(currentYear) ? currentYear - p.birthYear : 0;
        ops.push(set('people', p.id, ['retirementAge'], Math.max(current, p.retirementAge - years, 0)));
        if (p.employment?.stopAge != null) ops.push(set('people', p.id, ['employment', 'stopAge'], null));
      }
      break;
    }
    case 'C_aggressiveSavings': {
      const points = num(params, 'deferralIncrease', 0.05);
      used.deferralIncrease = points;
      for (const p of base.people) {
        for (const plan of p.workplacePlans) {
          const rothOnly = plan.traditionalPctOfSalary === 0 && plan.rothPctOfSalary > 0;
          const key = rothOnly ? 'rothPctOfSalary' : 'traditionalPctOfSalary';
          ops.push(set('workplacePlans', plan.id, [key], Math.min(1, plan[key] + points)));
        }
      }
      if (params.irasToMax === true) {
        used.irasToMax = true;
        for (const a of base.accounts) {
          if (a.type !== 'traditionalIra' && a.type !== 'rothIra') continue;
          ops.push(
            set('accounts', a.id, ['contribution'], {
              amount: { kind: 'maxAllowed' },
              growth: { mode: 'flat' },
              startYear: a.contribution?.startYear ?? null,
              stopYear: a.contribution?.stopYear ?? null,
            }),
          );
        }
      }
      break;
    }
    case 'D_marketDownturn': {
      const severity = num(params, 'severity', -0.3);
      const duration = Math.max(1, Math.min(10, Math.round(num(params, 'durationYears', 1))));
      const startYear = Math.round(num(params, 'startYear', firstRetirementYearOf(base)));
      used.severity = severity;
      used.durationYears = duration;
      used.startYear = startYear;
      // The total drawdown is `severity`, spread evenly (geometrically) over the duration.
      const perYear = Math.pow(1 + severity, 1 / duration) - 1;
      ops.push(
        set('household', base.id, ['assumptions', 'marketShock'], {
          startYear,
          returns: Array(duration).fill(perYear),
        }),
      );
      break;
    }
    case 'E_delayedRetirement': {
      const years = Math.max(3, Math.min(5, Math.round(num(params, 'years', 3))));
      used.years = years;
      for (const p of base.people) {
        ops.push(set('people', p.id, ['retirementAge'], Math.min(p.planningAge, p.retirementAge + years)));
      }
      break;
    }
    case 'F_reducedSpending': {
      const cut = num(params, 'cut', 0.1);
      used.cut = cut;
      const s = base.spending;
      const scale = (c: number) => Math.round(c * (1 - cut));
      ops.push(set('household', base.id, ['spending', 'retirementAnnualSpending'], scale(s.retirementAnnualSpending)));
      ops.push(
        set(
          'household',
          base.id,
          ['spending', 'steps'],
          s.steps.map((st) => ({ ...st, annualSpending: scale(st.annualSpending) })),
        ),
      );
      break;
    }
    case 'G_rothStrategy': {
      for (const p of base.people) {
        for (const plan of p.workplacePlans) {
          if (!plan.planOffersRoth || plan.rothAccountId === null) continue;
          ops.push(
            set(
              'workplacePlans',
              plan.id,
              ['rothPctOfSalary'],
              Math.min(1, plan.rothPctOfSalary + plan.traditionalPctOfSalary),
            ),
          );
          ops.push(set('workplacePlans', plan.id, ['traditionalPctOfSalary'], 0));
          ops.push(
            set(
              'workplacePlans',
              plan.id,
              ['rothPctOfBonus'],
              Math.min(1, plan.rothPctOfBonus + plan.traditionalPctOfBonus),
            ),
          );
          ops.push(set('workplacePlans', plan.id, ['traditionalPctOfBonus'], 0));
        }
      }
      break;
    }
  }
  return {
    id: ids.scenarioId as Scenario['id'],
    name: ids.name,
    baseProfileId: ids.baseProfileId as Scenario['baseProfileId'],
    preset,
    presetParams: used,
    ops,
  };
}

// ---- Optimizer (§10) ----------------------------------------------------------------------------

/** The household with the first person's retirement age set to `age` and everyone else shifted by the same amount. */
export function withRetirementAge(h: Household, age: number): Household | null {
  const first = h.people[0];
  if (!first) return null;
  const delta = age - first.retirementAge;
  const people = h.people.map((p) => ({
    ...p,
    retirementAge: p.retirementAge + delta,
    employment: p.employment ? { ...p.employment, stopAge: null } : null,
  }));
  const parsed = HouseholdSchema.safeParse({ ...h, people });
  return parsed.success ? parsed.data : null;
}

export function optimizeRetirementAge(
  household: Household,
  ctx: EngineContext,
  criterion: { kind: 'deterministic' } | { kind: 'monteCarlo'; config: MonteCarloConfig; minSuccessRate: number },
  range: { fromAge: number; toAge: number },
): EngineResult<OptimizerResult> {
  const issues: ValidationIssue[] = [];
  if (!Number.isInteger(range.fromAge) || !Number.isInteger(range.toAge) || range.fromAge > range.toAge) {
    issues.push({ path: ['range'], message: 'The age range must run from a lower to a higher whole age' });
  }
  if (criterion.kind === 'monteCarlo') {
    issues.push({ path: ['criterion'], message: 'The Monte Carlo criterion arrives with Monte Carlo (M6)' });
  }
  if (issues.length > 0) return { status: 'invalid', issues };
  const evaluated: OptimizerResult['evaluated'] = [];
  for (let age = range.fromAge; age <= range.toAge; age++) {
    const candidate = withRetirementAge(household, age);
    if (!candidate) continue;
    const r = projectHousehold(candidate, ctx);
    if (r.status !== 'ok') continue;
    evaluated.push({
      age,
      success: r.value.summary.deterministicSuccess,
      endingBalanceReal: r.value.summary.endingBalanceReal as Cents,
      successRate: null,
    });
  }
  const earliest = evaluated.find((e) => e.success)?.age ?? null;
  return { status: 'ok', value: { earliestAge: earliest, evaluated, criterion: 'deterministic' }, warnings: [] };
}

// ---- Comparison (§10) ---------------------------------------------------------------------------

/**
 * Base plus each scenario: the dashboard (baseline and offset runs), orphaned ops and validation
 * issues. `afterTaxEndingBalanceReal` subtracts an assumed liquidation tax on tax-deferred money at the
 * final year's marginal ordinary rate (preset G's after-tax comparison); null while taxes are
 * unverified.
 */
export function compareScenarios(
  base: Household,
  scenarios: readonly Scenario[],
  ctx: EngineContext,
): ScenarioOutcome[] {
  const one = (
    household: Household | null,
    meta: Omit<ScenarioOutcome, 'dashboard' | 'afterTaxEndingBalanceReal' | 'status'>,
  ): ScenarioOutcome => {
    if (!household) return { ...meta, status: 'invalid', dashboard: null, afterTaxEndingBalanceReal: null };
    const d = computeDashboard(household, ctx);
    if (d.status !== 'ok') {
      return {
        ...meta,
        status: 'invalid',
        issues: d.status === 'invalid' ? d.issues : meta.issues,
        dashboard: null,
        afterTaxEndingBalanceReal: null,
      };
    }
    const last = d.value.baseline.rows[d.value.baseline.rows.length - 1];
    const rate = last?.tax?.marginalOrdinaryRate ?? null;
    const afterTax =
      last && rate !== null
        ? toCents((last.real.portfolioEnd - (last.totals.byTaxTreatment.taxDeferred / last.deflator) * rate) / 100)
        : null;
    return { ...meta, status: 'ok', dashboard: d.value, afterTaxEndingBalanceReal: afterTax };
  };
  const outcomes: ScenarioOutcome[] = [one(base, { scenarioId: null, name: 'Base plan', orphaned: [], issues: [] })];
  for (const scenario of scenarios) {
    const applied = applyScenario(base, scenario);
    outcomes.push(
      one(applied.household, {
        scenarioId: scenario.id,
        name: scenario.name,
        orphaned: applied.orphaned,
        issues: applied.issues,
      }),
    );
  }
  return outcomes;
}
