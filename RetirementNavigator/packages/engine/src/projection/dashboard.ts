/**
 * Dashboard cards (docs/financial-model.md §8) and the optimistic / baseline / pessimistic reruns
 * (§9: fixed return offsets, not confidence intervals). Readiness is a labeled heuristic.
 */
import type { Household } from '../domain/household';
import type { EngineResult } from '../domain/results';
import type { ProjectionResult } from '../domain/projection';
import type { CalendarYear, Cents } from '../domain/primitives';
import type { DashboardCards, DashboardResult, EngineContext } from '../api';
import { asCents, roundHalfEven, toCents } from '../money';
import { projectHousehold } from './project';

const monthly = (cents: number): Cents => asCents(roundHalfEven(cents / 12));

export function dashboardCards(
  household: Household,
  ctx: EngineContext,
  baseline: ProjectionResult,
  pessimistic: ProjectionResult,
): DashboardCards {
  const rows = baseline.rows;
  const retirementYear = baseline.summary.retirementYear;
  const retirementRow = rows.find((r) => r.year === retirementYear) ?? rows[rows.length - 1];
  const deflator = retirementRow?.deflator ?? 1;

  const savingsNominal = retirementRow?.totals.portfolioStart ?? (0 as Cents);
  const net = retirementRow?.netIncome ?? null;
  const incomeNominal = monthly(net ?? retirementRow?.grossIncome ?? 0);
  const spendingNominal = monthly(retirementRow?.flows.spendingNeed ?? 0);
  const taxBasis = net === null ? 'beforeTaxes' : 'net';
  const real = (c: number) => toCents(c / 100 / deflator);

  const primary = household.people[0];
  return {
    people: household.people.map((p) => {
      const currentAge = ctx.currentYear - p.birthYear;
      return {
        personId: p.id,
        name: p.name,
        currentAge,
        retirementAge: p.retirementAge,
        yearsToRetirement: Math.max(0, p.retirementAge - currentAge),
      };
    }),
    currentSavings: asCents(household.accounts.reduce((sum, a) => sum + a.balance, 0)),
    firstRetirementYear: retirementYear,
    savingsAtRetirement: { nominal: savingsNominal, real: real(savingsNominal) },
    monthlyRetirementIncome: { nominal: incomeNominal, real: real(incomeNominal), taxBasis },
    monthlyRetirementSpending: { nominal: spendingNominal, real: real(spendingNominal) },
    monthlySurplus: {
      nominal: asCents(incomeNominal - spendingNominal),
      real: asCents(real(incomeNominal) - real(spendingNominal)),
      taxBasis,
    },
    longevity:
      baseline.summary.depletionYear === null || !primary
        ? { kind: 'lastsThroughPlanningAge', planningAge: Math.max(...household.people.map((p) => p.planningAge)) }
        : {
            kind: 'depletes',
            year: baseline.summary.depletionYear as CalendarYear,
            age: baseline.summary.depletionYear - primary.birthYear,
          },
    readiness: {
      status: !baseline.summary.deterministicSuccess
        ? 'atRisk'
        : pessimistic.summary.deterministicSuccess
          ? 'onTrack'
          : 'borderline',
      baselineSuccess: baseline.summary.deterministicSuccess,
      pessimisticSuccess: pessimistic.summary.deterministicSuccess,
    },
  };
}

export function computeDashboard(household: Household, ctx: EngineContext): EngineResult<DashboardResult> {
  const baseline = projectHousehold(household, ctx);
  if (baseline.status !== 'ok') return baseline;
  const offsets = baseline.value.rows.length > 0 ? household.assumptions.deterministicOffsets : null;
  const optimistic = projectHousehold(household, ctx, { returnOffset: offsets?.optimistic ?? 0 });
  const pessimistic = projectHousehold(household, ctx, { returnOffset: offsets?.pessimistic ?? 0 });
  if (optimistic.status !== 'ok') return optimistic;
  if (pessimistic.status !== 'ok') return pessimistic;
  return {
    status: 'ok',
    value: {
      baseline: baseline.value,
      optimistic: optimistic.value,
      pessimistic: pessimistic.value,
      cards: dashboardCards(household, ctx, baseline.value, pessimistic.value),
    },
    warnings: baseline.warnings,
  };
}
