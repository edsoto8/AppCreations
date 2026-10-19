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
  // A start-of-year balance is the prior year-end money, so it is deflated by the prior year's
  // price level (P_{t−1}; 1 in year 1) — the same today's-dollar figure as the prior row's end.
  const index = retirementRow ? rows.indexOf(retirementRow) : -1;
  const startDeflator = index > 0 ? (rows[index - 1]?.deflator ?? 1) : 1;

  const savingsNominal = retirementRow?.totals.portfolioStart ?? (0 as Cents);
  const net = retirementRow?.netIncome ?? null;
  const incomeAnnual = net ?? retirementRow?.grossIncome ?? 0;
  const spendingAnnual = retirementRow?.flows.spendingNeed ?? 0;
  const incomeNominal = monthly(incomeAnnual);
  const spendingNominal = monthly(spendingAnnual);
  const taxBasis = net === null ? 'beforeTaxes' : 'net';
  // Monthly real values divide the annual cents once (no double rounding).
  const monthlyReal = (annualCents: number) => monthly(annualCents / deflator);
  const incomeReal = monthlyReal(incomeAnnual);
  const spendingReal = monthlyReal(spendingAnnual);

  const depletionYear = baseline.summary.depletionYear;
  const living =
    depletionYear === null ? undefined : household.people.find((p) => depletionYear <= p.birthYear + p.planningAge);
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
    savingsAtRetirement: { nominal: savingsNominal, real: toCents(savingsNominal / 100 / startDeflator) },
    monthlyRetirementIncome: { nominal: incomeNominal, real: incomeReal, taxBasis },
    monthlyRetirementSpending: { nominal: spendingNominal, real: spendingReal },
    monthlySurplus: {
      nominal: asCents(incomeNominal - spendingNominal),
      real: asCents(incomeReal - spendingReal),
      taxBasis,
    },
    longevity:
      depletionYear === null || !living
        ? { kind: 'lastsThroughPlanningAge', planningAge: Math.max(...household.people.map((p) => p.planningAge)) }
        : {
            kind: 'depletes',
            year: depletionYear as CalendarYear,
            age: depletionYear - living.birthYear,
            personId: living.id,
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
