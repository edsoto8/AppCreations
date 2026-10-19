/**
 * Spending planner (docs/financial-model.md §12.12).
 *
 * Engine calls: `projectHousehold` on a retired household of one or two people (retired from this
 * year) with one savings account and the spending plan as entered: retirement spending, spending
 * steps by the first person's age, a real glide, the pre-Medicare healthcare line and, for couples,
 * the survivor reduction from the first death year (§5, §7.7). Each year's spending need, funding,
 * shortfall and balance are read from the projection rows; longevity is the projection's depletion
 * year and age. No formula is computed here.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { Cents } from '../domain/primitives';
import {
  AgeSchema,
  FractionSchema,
  InflationRateSchema,
  NominalRateSchema,
  NonNegativeCentsSchema,
  RealRateSchema,
} from '../domain/primitives';
import type { RealRate } from '../domain/primitives';
import { SpendingStepSchema, type HouseholdInput } from '../domain/household';
import type { EngineResult } from '../domain/results';
import {
  ExpenseRatioSchema,
  SocialSecurityAtClaimSchema,
  TaxTreatmentSchema,
  assumptionsTemplate,
  itemAt,
  mapStep,
  mergeLabels,
  parseInput,
  projectInput,
  savingsAccount,
  sumOf,
  taxBasisOf,
  toResult,
  type CalculatorLabels,
} from './common';

const PersonInput = z
  .object({
    name: z.string().trim().min(1).max(60).default('Person'),
    age: AgeSchema,
    planningAge: AgeSchema,
    socialSecurity: SocialSecurityAtClaimSchema,
  })
  .refine((p) => p.planningAge >= p.age, { path: ['planningAge'], message: 'Planning age is before the current age' });

export const SpendingPlannerInputSchema = z.object({
  /** One person, or two (married filing jointly). The first person's age drives the spending steps. */
  people: z.array(PersonInput).min(1).max(2),
  startingBalance: NonNegativeCentsSchema,
  taxTreatment: TaxTreatmentSchema.default('taxDeferred'),
  costBasis: NonNegativeCentsSchema.nullable().default(null),
  annualReturn: NominalRateSchema,
  expenseRatio: ExpenseRatioSchema.default(0),
  inflation: InflationRateSchema,
  /** Annual retirement spending in today's dollars (a net need). */
  retirementSpending: NonNegativeCentsSchema,
  /** Spending from an age of the first person (today's dollars). */
  steps: z.array(SpendingStepSchema).max(10).default([]),
  /** Annual real change in spending (e.g. −0.01). */
  realGlide: RealRateSchema.default(0 as RealRate),
  /** Healthcare before Medicare, today's dollars per year, while a retired person is under 65. */
  healthcareBeforeMedicare: NonNegativeCentsSchema.default(0 as Cents),
  /** Couples: spending reduction from the first death year (labeled assumption). */
  survivorSpendingReduction: FractionSchema.default(0.2),
  withdrawalTiming: z.enum(['midYear', 'startOfYear']).default('midYear'),
});
export type SpendingPlannerInput = z.input<typeof SpendingPlannerInputSchema>;

export interface SpendingPlannerRow {
  year: number;
  /** Each person's age that year (in input order). */
  ages: number[];
  spendingNeed: Cents;
  spendingNeedReal: Cents;
  spendingFunded: Cents;
  shortfall: Cents;
  socialSecurity: Cents;
  withdrawals: Cents;
  endBalance: Cents;
  endBalanceReal: Cents;
  markers: string[];
}

export interface SpendingPlannerResult extends CalculatorLabels {
  rows: SpendingPlannerRow[];
  longevity: { lastsThroughPlanningAge: boolean; depletionYear: number | null; depletionAge: number | null };
  firstDeathYear: number | null;
  /** Σ spending need over the plan (nominal and today's dollars). */
  totalSpendingNeed: Cents;
  totalSpendingNeedReal: Cents;
}

export function spendingPlanner(input: SpendingPlannerInput, ctx: EngineContext): EngineResult<SpendingPlannerResult> {
  const parsed = parseInput(SpendingPlannerInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  const ids = ['calc-person', 'calc-partner'];
  const household: HouseholdInput = {
    id: 'calc-household',
    name: 'Calculator',
    filingStatus: x.people.length === 2 ? 'marriedFilingJointly' : 'single',
    people: x.people.map((p, i) => ({
      id: itemAt(ids, i), // at most two people (schema)
      name: p.name,
      birthYear: ctx.currentYear - p.age,
      retirementAge: p.age,
      planningAge: p.planningAge,
      socialSecurity: p.socialSecurity
        ? {
            source: { kind: 'atClaimAge', monthlyAtClaim: p.socialSecurity.monthlyAtClaim },
            claimAge: p.socialSecurity.claimAge,
          }
        : { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
    })),
    accounts: [savingsAccount(x.taxTreatment, x.startingBalance, x.costBasis, x.expenseRatio, 0)],
    spending: {
      currentAnnualSpending: 0,
      retirementAnnualSpending: x.retirementSpending,
      steps: x.steps,
      retirementRealGlide: x.realGlide,
      healthcareBeforeMedicare: x.healthcareBeforeMedicare,
      survivorSpendingReduction: x.survivorSpendingReduction,
    },
    assumptions: assumptionsTemplate(ctx.currentYear, {
      inflation: x.inflation,
      returnPreRetirement: x.annualReturn,
      returnPostRetirement: x.annualReturn,
      withdrawalTiming: x.withdrawalTiming,
    }),
  };
  return toResult(
    mapStep(projectInput(household, ctx), (projected) => {
      const p = projected.projection;
      const rows = p.rows.map((r) => ({
        year: r.year,
        ages: r.people.map((person) => person.age),
        spendingNeed: r.flows.spendingNeed,
        spendingNeedReal: r.real.spendingNeed,
        spendingFunded: r.flows.spendingFunded,
        shortfall: r.flows.shortfall,
        socialSecurity: r.flows.socialSecurity,
        withdrawals: r.flows.withdrawals,
        endBalance: r.totals.portfolioEnd,
        endBalanceReal: r.real.portfolioEnd,
        markers: [...r.markers],
      }));
      return {
        value: {
          rows,
          longevity: {
            lastsThroughPlanningAge: p.summary.depletionYear === null,
            depletionYear: p.summary.depletionYear,
            depletionAge: p.summary.depletionAge,
          },
          firstDeathYear: p.summary.firstDeathYear,
          totalSpendingNeed: sumOf(rows.map((r) => r.spendingNeed)),
          totalSpendingNeedReal: sumOf(rows.map((r) => r.spendingNeedReal)),
          basis: { dollars: 'nominalAndTodaysDollars' as const, tax: taxBasisOf(p), limits: 'notApplicable' as const },
          ...mergeLabels([p]),
          assumptions: [
            'Retired from this year. Spending is a net need in today’s dollars: the latest step whose age the first person has reached, changed each year by the real glide.',
            'The healthcare line is added while a retired person is under 65; it is the only healthcare cost before Medicare in the plan.',
            'For couples, spending falls by the survivor reduction from the first death year (a labeled assumption).',
          ],
        },
        warnings: projected.warnings,
      };
    }),
  );
}
