/**
 * Workplace-plan contribution limits (docs/financial-model.md §3.4): 402(g) deferral limit with the
 * 50+ and 60–63 catch-ups, the higher-earner Roth catch-up rule, the 401(a)(17) compensation limit and
 * the 415(c) annual additions limit. Every cap produces a warning; nothing is silently truncated.
 */
import type { Cents } from '../domain/primitives';
import type { EngineResult, EngineWarning } from '../domain/results';
import type { CappedContributions, ContributionRequest, ResolvedYearRules } from '../api';
import { RuleAccess, unverified } from '../rules/access';
import { matchFloat } from '../match/match';
import { formatWholeDollars, toCents } from '../money';

const usd = (cents: number) => formatWholeDollars(cents / 100);

/** Catch-up limit by age: 60–63 enhanced, otherwise 50+, otherwise none. Null when unverified. */
function catchUpLimit(age: number, rules: ResolvedYearRules, access: RuleAccess): number | null {
  const w = rules.values.workplace;
  if (age >= 60 && age <= 63) return access.get(w.catchUp60to63, 'workplace.catchUp60to63', 'workplaceLimits');
  if (age >= 50) return access.get(w.catchUp50, 'workplace.catchUp50', 'workplaceLimits');
  return 0;
}

export function capContributions(
  req: ContributionRequest,
  rules: ResolvedYearRules,
): EngineResult<CappedContributions> {
  const access = new RuleAccess(rules.taxYear);
  const w = rules.values.workplace;
  const deferralLimit = access.get(w.electiveDeferral, 'workplace.electiveDeferral', 'workplaceLimits');
  const compLimit = access.get(w.compensationLimit, 'workplace.compensationLimit', 'workplaceLimits');
  const additionsLimit = access.get(w.annualAdditions, 'workplace.annualAdditions', 'workplaceLimits');
  const catchUp = catchUpLimit(req.age, rules, access);
  if (deferralLimit === null || compLimit === null || additionsLimit === null || catchUp === null) {
    return unverified(access.missing);
  }

  const warnings: EngineWarning[] = [];
  const year = req.year;
  const requested = req.requestedTraditional + req.requestedRoth;

  // 402(g) (aggregated across the person's 401(k)/403(b) plans by the caller) plus catch-up.
  // Earlier aggregated plans used the base room first; anything they deferred above the 402(g)
  // limit was their catch-up, which shares the same per-person catch-up limit.
  const baseRoom = Math.max(0, deferralLimit - req.otherAggregatedDeferrals);
  const catchUpUsed = Math.max(0, req.otherAggregatedDeferrals - deferralLimit);
  const catchUpRoom = Math.max(0, catchUp - catchUpUsed);
  const basePortion = Math.min(requested, baseRoom);
  let catchUpPortion = Math.min(requested - basePortion, catchUpRoom);
  const allowed = basePortion + catchUpPortion;
  let traditional: number = req.requestedTraditional;
  let roth: number = req.requestedRoth;
  if (requested > allowed) {
    // SIMPLIFICATION: both buckets are reduced pro rata to fit the limit.
    const scale = requested > 0 ? allowed / requested : 0;
    traditional = Math.round(req.requestedTraditional * scale);
    roth = allowed - traditional;
    warnings.push({
      code: 'deferralCapped',
      year,
      message: `Employee deferrals of ${usd(requested)} exceed the room left under the ${year} limit (${usd(baseRoom + catchUpRoom)}); capped at ${usd(allowed)}.`,
    });
  }
  if (catchUpPortion > 0) {
    warnings.push({ code: 'catchUpApplied', year, message: `Includes ${usd(catchUpPortion)} of age-based catch-up.` });
  }

  // Higher-earner Roth catch-up rule.
  let catchUpIsRoth = false;
  if (catchUpPortion > 0) {
    const inForce = access.get(w.rothCatchUpInForce, 'workplace.rothCatchUpInForce', 'workplaceLimits');
    if (inForce === null) return unverified(access.missing);
    if (inForce) {
      const threshold = access.get(w.rothCatchUpWageThreshold, 'workplace.rothCatchUpWageThreshold', 'workplaceLimits');
      if (threshold === null) return unverified(access.missing);
      if (req.priorYearFicaWages === null) {
        warnings.push({
          code: 'rothCatchUpRequired',
          year,
          message: 'Prior-year FICA wages are unknown, so the higher-earner Roth catch-up rule was not applied.',
        });
      } else if (req.priorYearFicaWages > threshold) {
        if (req.plan.planOffersRoth) {
          // Catch-up dollars must be Roth: move them out of the traditional bucket first.
          const rothShortfall = Math.max(0, catchUpPortion - roth);
          const moved = Math.min(rothShortfall, traditional);
          traditional -= moved;
          roth += moved;
          catchUpIsRoth = true;
          warnings.push({
            code: 'rothCatchUpRequired',
            year,
            message: `Prior-year FICA wages above ${usd(threshold)}: the ${usd(catchUpPortion)} catch-up is made as Roth.`,
          });
        } else {
          // Plan without Roth: catch-ups are not available to this employee.
          const removeFromTraditional = Math.min(catchUpPortion, traditional);
          traditional -= removeFromTraditional;
          roth -= catchUpPortion - removeFromTraditional;
          warnings.push({
            code: 'rothCatchUpRequired',
            year,
            message: `Prior-year FICA wages above ${usd(threshold)} require Roth catch-ups, but the plan offers no Roth; the ${usd(catchUpPortion)} catch-up was removed.`,
          });
          catchUpPortion = 0;
        }
      }
    }
  }

  // 401(a)(17): the match is computed on eligible pay up to the compensation limit.
  const eligible = Math.min(req.eligibleCompForMatch, compLimit);
  if (req.eligibleCompForMatch > compLimit) {
    warnings.push({
      code: 'compensationLimitApplied',
      year,
      message: `Eligible pay above the ${usd(compLimit)} compensation limit is not counted for the match.`,
    });
  }
  const employeeTotal = traditional + roth;
  const m = matchFloat(req.plan.match, eligible / 100, employeeTotal / 100);
  let employerMatch = toCents(m.match) as number;
  let employerFlat = toCents(m.flat) as number;

  // 415(c): employee (excluding catch-up) + employer ≤ min(limit, 100% of compensation).
  const additionsCap = Math.min(additionsLimit, req.compensation);
  const employeeBase = traditional + roth - catchUpPortion;
  if (employeeBase > additionsCap) {
    // Employee deferrals alone exceed the cap: reduce them (pro rata) and allow no employer money.
    const employeeReduction = employeeBase - additionsCap;
    const total = traditional + roth;
    const tradCut = total > 0 ? Math.round((employeeReduction * traditional) / total) : 0;
    traditional -= tradCut;
    roth -= employeeReduction - tradCut;
    warnings.push({
      code: 'annualAdditionsCapped',
      year,
      message: `Employee deferrals exceed the ${usd(additionsCap)} annual additions limit (the smaller of the dollar limit and 100% of pay); deferrals reduced by ${usd(employeeReduction)}.`,
    });
  }
  const employeeAfter = traditional + roth;
  const additions = employeeAfter - catchUpPortion + employerMatch + employerFlat;
  let employerReduction = 0;
  if (additions > additionsCap) {
    // SIMPLIFICATION: the employer amount is reduced (match first); real plans correct by refund.
    employerReduction = Math.min(additions - additionsCap, employerMatch + employerFlat);
    const fromMatch = Math.min(employerReduction, employerMatch);
    employerMatch -= fromMatch;
    employerFlat -= employerReduction - fromMatch;
    warnings.push({
      code: 'annualAdditionsCapped',
      year,
      message: `Employee plus employer additions exceed the ${usd(additionsCap)} annual additions limit; employer contributions reduced by ${usd(employerReduction)}.`,
    });
  }

  return {
    status: 'ok',
    value: {
      traditional: traditional as Cents,
      roth: roth as Cents,
      catchUp: catchUpPortion as Cents,
      catchUpIsRoth,
      employerMatch: employerMatch as Cents,
      employerFlat: employerFlat as Cents,
      cappedAmount: (requested - employeeAfter + employerReduction) as Cents,
    },
    warnings,
  };
}
