/**
 * Shared by the Monte Carlo worker and the in-process optimizer executor: run the engine's
 * `optimizeRetirementAge` one age at a time (each call scans a one-age range), so progress can be
 * reported per age and a cancel can stop between ages. Every number comes from the engine: the
 * per-age results are concatenated in age order and the earliest age is the first one the engine
 * marked as meeting the criterion. Each age is evaluated independently by the engine (the Monte
 * Carlo criterion scores every age on the same paths 0 … quickRunPaths − 1), so the outcome equals
 * one `optimizeRetirementAge` call over the whole range (tested).
 */
import {
  optimizeRetirementAge,
  type EngineContext,
  type EngineResult,
  type EngineWarning,
  type Household,
  type OptimizerResult,
} from '@rn/engine';

export type OptimizerCriterion = Parameters<typeof optimizeRetirementAge>[2];

export interface AgeRange {
  fromAge: number;
  toAge: number;
}

export interface OptimizeRequest {
  household: Household;
  ctx: EngineContext;
  criterion: OptimizerCriterion;
  range: AgeRange;
}

export type OptimizeOutcome = EngineResult<OptimizerResult> | { status: 'cancelled' };

/**
 * Scan `req.range` age by age. `onProgress` receives the ages done and the ages in the range.
 * `between`, when given, is awaited between ages and returns false to stop (cancel); without it the
 * loop is synchronous (the worker cancels by being terminated).
 */
export async function optimizeByAge(
  req: OptimizeRequest,
  opts: { onProgress?: (agesDone: number, agesTotal: number) => void; between?: () => Promise<boolean> } = {},
): Promise<OptimizeOutcome> {
  const { household, ctx, criterion, range } = req;
  const { fromAge, toAge } = range;
  // A malformed range is reported by the engine for the whole range (it returns before scanning).
  if (!Number.isInteger(fromAge) || !Number.isInteger(toAge) || fromAge > toAge) {
    return optimizeRetirementAge(household, ctx, criterion, range);
  }
  const total = toAge - fromAge + 1;
  const evaluated: OptimizerResult['evaluated'] = [];
  const warnings: EngineWarning[] = [];
  let kind: OptimizerResult['criterion'] = criterion.kind;
  let monteCarloPaths: OptimizerResult['monteCarloPaths'] = null;
  for (let age = fromAge; age <= toAge; age++) {
    if (opts.between && age > fromAge && !(await opts.between())) return { status: 'cancelled' };
    const r = optimizeRetirementAge(household, ctx, criterion, { fromAge: age, toAge: age });
    // The engine's checks (retired first person, range start, criterion) do not depend on the age
    // once the range start is valid, so only the first age can fail; its issues are the range's.
    if (r.status !== 'ok') return r;
    evaluated.push(...r.value.evaluated);
    warnings.push(...r.warnings);
    kind = r.value.criterion;
    monteCarloPaths = r.value.monteCarloPaths;
    opts.onProgress?.(age - fromAge + 1, total);
  }
  const earliestAge = evaluated.find((e) => e.success)?.age ?? null;
  return { status: 'ok', value: { earliestAge, evaluated, criterion: kind, monteCarloPaths }, warnings };
}
