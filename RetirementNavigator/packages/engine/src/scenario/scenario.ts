/**
 * Scenarios (docs/financial-model.md §10): diffs over a base household, keyed by entity id, applied to
 * a deep copy and re-validated. Presets A–G build ops; the optimizer scans retirement ages.
 */
import type { Household, HouseholdInput } from '../domain/household';
import { HouseholdSchema } from '../domain/household';
import type { EngineResult, ValidationIssue } from '../domain/results';
import type { OrphanedOp, Scenario, ScenarioOp, ScenarioPreset } from '../domain/scenario';
import type { EngineContext, OptimizerResult, ScenarioApplication, ScenarioOutcome } from '../api';
import { MonteCarloConfigSchema, type MonteCarloConfig } from '../domain/montecarlo';
import { runMonteCarloChunk } from '../montecarlo/run';
import type { Cents } from '../domain/primitives';
import { zodIssues } from '../validation';
import { projectHousehold } from '../projection/project';
import { computeDashboard } from '../projection/dashboard';
import { roundHalfEven, toCents } from '../money';

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

/** The object or array at `path` (own keys only, never the prototype chain); null when missing. */
function walk(target: Json, path: Path): object | null {
  let node: unknown = target;
  for (const key of path) {
    if (node === null || typeof node !== 'object') return null;
    if (Array.isArray(node) ? typeof key !== 'number' || key >= node.length : !Object.hasOwn(node, key)) return null;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node !== null && typeof node === 'object' ? node : null;
}

/**
 * Set a value at a path. False (`invalidPath`) when a step or the field does not exist, so a typo is
 * reported instead of being silently dropped by validation. An array index may be one past the end
 * (append).
 */
function setAt(target: Json, path: Path, value: unknown): boolean {
  const node = walk(target, path.slice(0, -1));
  const last = path[path.length - 1];
  if (node === null || last === undefined) return false;
  if (Array.isArray(node)) {
    if (typeof last !== 'number' || last > node.length) return false;
  } else if (typeof last !== 'string' || !Object.hasOwn(node, last)) {
    return false;
  }
  (node as Record<string | number, unknown>)[last] = clone(value);
  return true;
}

/** Remove the key at a path so the schema default applies on re-validation. */
function unsetAt(target: Json, path: Path): boolean {
  const node = walk(target, path.slice(0, -1));
  const last = path[path.length - 1];
  if (node === null || Array.isArray(node) || last === undefined) return false;
  if (!Object.hasOwn(node, last)) return false;
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

/** Already retired in `currentYear` (retirement starts January 1 of the retirement-age year). */
const retiredBy = (p: Household['people'][number], currentYear: number) =>
  Number.isFinite(currentYear) && currentYear - p.birthYear >= p.retirementAge;

/** Total change of a return sequence: Π(1 + r) − 1 (a preset D shock's severity). */
export function marketShockTotal(returns: readonly number[]): number {
  return returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
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
  if (Number.isFinite(currentYear)) used.currentYear = currentYear;
  switch (preset) {
    case 'A_baseline':
      break;
    case 'B_earlyRetirement': {
      const years = num(params, 'years', 5);
      used.years = years;
      for (const p of base.people) {
        if (retiredBy(p, currentYear)) continue; // already retired: earlier is not possible
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
      // Default: the first retirement year, never before the current year (a retired household's
      // first retirement year is year 1, §8). An entered year before the current year is moved up.
      const earliest = Number.isFinite(currentYear) ? currentYear : -Infinity;
      const startYear = Math.max(earliest, Math.round(num(params, 'startYear', firstRetirementYearOf(base))));
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
        if (retiredBy(p, currentYear)) continue; // already retired: a later age would restart pay
        ops.push(set('people', p.id, ['retirementAge'], Math.min(p.planningAge, p.retirementAge + years)));
      }
      break;
    }
    case 'F_reducedSpending': {
      const cut = num(params, 'cut', 0.1);
      used.cut = cut;
      const s = base.spending;
      const scale = (c: number) => roundHalfEven(c * (1 - cut));
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

/**
 * True when the base plan has changed in a way the preset's stored ops no longer reflect: the preset
 * rebuilt from its parameters and the current base gives different ops (for example, F stores the
 * cut amount, so a later change to base spending is not followed). False for custom scenarios.
 */
export function presetDrift(scenario: Scenario, base: Household): boolean {
  if (scenario.preset === null) return false;
  const rebuilt = presetScenario(scenario.preset, base, scenario.presetParams, {
    scenarioId: scenario.id,
    name: scenario.name,
    baseProfileId: scenario.baseProfileId,
  });
  return JSON.stringify(rebuilt.ops) !== JSON.stringify(scenario.ops);
}

// ---- Optimizer (§10) ----------------------------------------------------------------------------

/**
 * The household with the first person's retirement age set to `age`; every other person not yet
 * retired in `currentYear` shifts by the same amount (a retired partner stays retired). Salary stop
 * ages are cleared for the people who move.
 */
export function withRetirementAge(h: Household, age: number, currentYear = NaN): Household | null {
  const first = h.people[0];
  if (!first) return null;
  const delta = age - first.retirementAge;
  const people = h.people.map((p, i) =>
    i > 0 && retiredBy(p, currentYear)
      ? p
      : {
          ...p,
          retirementAge: p.retirementAge + delta,
          employment: p.employment ? { ...p.employment, stopAge: null } : null,
        },
  );
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
  const first = household.people[0];
  if (first && retiredBy(first, ctx.currentYear)) {
    issues.push({ path: ['people', 0, 'retirementAge'], message: `${first.name} is already retired` });
  } else if (first && range.fromAge < ctx.currentYear - first.birthYear) {
    issues.push({
      path: ['range', 'fromAge'],
      message: `The range must start at ${first.name}’s current age or later`,
    });
  }
  let mc: { config: MonteCarloConfig; paths: number; minSuccessRate: number } | null = null;
  if (criterion.kind === 'monteCarlo') {
    const config = MonteCarloConfigSchema.safeParse(criterion.config);
    if (!config.success) {
      issues.push(...zodIssues(config.error).map((i) => ({ ...i, path: ['criterion', 'config', ...i.path] })));
    } else if (!(criterion.minSuccessRate > 0 && criterion.minSuccessRate <= 1)) {
      issues.push({
        path: ['criterion', 'minSuccessRate'],
        message: 'The target success rate must be above 0% and at most 100%',
      });
    } else {
      // Each age is scored on the quick-run paths (0 … quickRunPaths − 1), so a scan stays fast; the
      // same paths are used for every age (common random numbers).
      mc = { config: config.data, paths: config.data.quickRunPaths, minSuccessRate: criterion.minSuccessRate };
    }
  }
  if (issues.length > 0) return { status: 'invalid', issues };
  const evaluated: OptimizerResult['evaluated'] = [];
  for (let age = range.fromAge; age <= range.toAge; age++) {
    const candidate = withRetirementAge(household, age, ctx.currentYear);
    if (!candidate) continue;
    const r = projectHousehold(candidate, ctx);
    if (r.status !== 'ok') continue;
    let successRate: number | null = null;
    if (mc) {
      const chunk = runMonteCarloChunk(candidate, ctx, mc.config, { pathStart: 0, pathEnd: mc.paths });
      if (chunk.status !== 'ok') continue;
      successRate = chunk.value.success.reduce((n, v) => n + v, 0) / mc.paths;
    }
    evaluated.push({
      age,
      success: mc ? (successRate ?? 0) >= mc.minSuccessRate : r.value.summary.deterministicSuccess,
      endingBalanceReal: r.value.summary.endingBalanceReal as Cents,
      successRate,
    });
  }
  const earliest = evaluated.find((e) => e.success)?.age ?? null;
  return {
    status: 'ok',
    value: { earliestAge: earliest, evaluated, criterion: mc ? 'monteCarlo' : 'deterministic' },
    warnings: [],
  };
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
