/**
 * 401(k) contribution calculator (docs/financial-model.md §12.2).
 *
 * Engine calls:
 * - `previewAccumulation` (year 1): the requested deferrals and the pre-limit match the elections
 *   imply, and the year's eligible pay and compensation (§3.1–3.3, §3.5);
 * - `resolveRules` + `capContributions` (year 1): the 402(g) limit with the age-based catch-ups, the
 *   higher-earner Roth catch-up rule, 401(a)(17) and 415(c), with their warnings (§3.4). With a null
 *   limit it is `unverified`, and the calculator reports the missing keys and no capped figure;
 * - `projectHousehold`: every working year's contributions (capped when the limits are verified, as
 *   elected and labeled "before limits" otherwise, §1.7) and the account balances to retirement.
 * Totals are sums of the projection's cents. No formula is computed here.
 */
import { z } from 'zod';
import type { CappedContributions, EngineContext, MatchBreakdown } from '../api';
import type { Cents, NominalRate } from '../domain/primitives';
import {
  AgeSchema,
  FractionSchema,
  InflationRateSchema,
  NominalRateSchema,
  NonNegativeCentsSchema,
  ZERO_CENTS,
} from '../domain/primitives';
import { EmployerMatchRuleSchema, type HouseholdInput } from '../domain/household';
import type { EngineResult, EngineWarning, UnverifiedDetail } from '../domain/results';
import { previewAccumulation } from '../income/preview';
import { capContributions } from '../limits/workplace';
import { resolveRules } from '../rules/resolve';
import {
  CALC_IDS,
  all,
  andThen,
  assumptionsTemplate,
  buildHousehold,
  itemAt,
  lastOf,
  limitsBasisOf,
  mapStep,
  mergeLabels,
  parseInput,
  project,
  ruleValue,
  sumOf,
  toResult,
  toStep,
  type CalculatorLabels,
} from './common';

export const Contribution401kInputSchema = z
  .object({
    age: AgeSchema,
    /** Salary stops at the start of the year this age is reached. */
    retirementAge: AgeSchema,
    /** Current annual base salary (nominal). */
    salary: NonNegativeCentsSchema,
    /** Nominal annual raise (decimal). */
    salaryGrowth: NominalRateSchema.default(0 as NominalRate),
    planType: z.enum(['401k', '403b', '457b']).default('401k'),
    planOffersRoth: z.boolean().default(true),
    traditionalPctOfSalary: FractionSchema.default(0),
    rothPctOfSalary: FractionSchema.default(0),
    /** The plan's match (the shared EmployerMatchRule); null = no employer money. */
    match: EmployerMatchRuleSchema.nullable().default(null),
    traditionalBalance: NonNegativeCentsSchema.default(ZERO_CENTS),
    rothBalance: NonNegativeCentsSchema.default(ZERO_CENTS),
    annualReturn: NominalRateSchema,
    inflation: InflationRateSchema.default(0 as NominalRate),
    /** Last year's FICA (Box 3) wages, for the higher-earner Roth catch-up rule; null = unknown. */
    priorYearFicaWages: NonNegativeCentsSchema.nullable().default(null),
  })
  .superRefine((x, ctx) => {
    if (x.retirementAge <= x.age) {
      ctx.addIssue({
        code: 'custom',
        path: ['retirementAge'],
        message: 'Retirement age must be after the current age',
      });
    }
    if (!x.planOffersRoth && (x.rothPctOfSalary > 0 || x.rothBalance > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['rothPctOfSalary'],
        message: 'Roth contributions need a plan that offers Roth',
      });
    }
  });
export type Contribution401kInput = z.input<typeof Contribution401kInputSchema>;

export interface Contribution401kRow {
  year: number;
  age: number;
  salary: Cents;
  employeeTraditional: Cents;
  employeeRoth: Cents;
  /** Of the employee amounts, age-based catch-up (0 while limits are unverified). */
  catchUp: Cents;
  employerMatch: Cents;
  employerFlat: Cents;
  traditionalBalance: Cents;
  rothBalance: Cents;
  totalBalance: Cents;
  totalBalanceReal: Cents;
}

export interface Contribution401kResult extends CalculatorLabels {
  yearOne: {
    year: number;
    requestedTraditional: Cents;
    requestedRoth: Cents;
    /** Match on the requested deferrals before limits. */
    matchBeforeLimits: MatchBreakdown;
    /** After 402(g)/catch-up/401(a)(17)/415(c); null while a limit is unverified. */
    capped: CappedContributions | null;
    /** Warnings from the limit step (capping, catch-up, Roth catch-up). */
    limitWarnings: EngineWarning[];
  };
  /** Working years, from this year to the year before retirement. */
  rows: Contribution401kRow[];
  totals: {
    employeeContributions: Cents;
    employerContributions: Cents;
    /** Growth after fees over the working years. */
    growth: Cents;
    /** Balance at the start of the retirement year (nominal and today's dollars). */
    balanceAtRetirement: Cents;
    balanceAtRetirementReal: Cents;
  };
}

const PLAN_ID = 'calc-plan';
const TRAD_ID = 'calc-traditional';
const ROTH_ID = 'calc-roth';

export function contribution401k(
  input: Contribution401kInput,
  ctx: EngineContext,
): EngineResult<Contribution401kResult> {
  const parsed = parseInput(Contribution401kInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  const workplace = { planType: x.planType, expectedReturn: x.annualReturn, ownerId: CALC_IDS.person };
  const householdInput: HouseholdInput = {
    id: 'calc-household',
    name: 'Calculator',
    filingStatus: 'single',
    people: [
      {
        id: CALC_IDS.person,
        name: 'You',
        birthYear: ctx.currentYear - x.age,
        retirementAge: x.retirementAge,
        planningAge: x.retirementAge,
        employment: {
          baseSalary: x.salary,
          raise: { mode: 'nominal', rate: x.salaryGrowth },
          priorYearFicaWages: x.priorYearFicaWages,
        },
        workplacePlans: [
          {
            id: PLAN_ID,
            planType: x.planType,
            traditionalAccountId: TRAD_ID,
            rothAccountId: x.planOffersRoth ? ROTH_ID : null,
            planOffersRoth: x.planOffersRoth,
            traditionalPctOfSalary: x.traditionalPctOfSalary,
            rothPctOfSalary: x.rothPctOfSalary,
            match: x.match ?? { tiers: [] },
          },
        ],
        socialSecurity: { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
      },
    ],
    accounts: [
      { ...workplace, type: 'workplaceTraditional', id: TRAD_ID, name: 'Traditional', balance: x.traditionalBalance },
      ...(x.planOffersRoth
        ? [{ ...workplace, type: 'workplaceRoth' as const, id: ROTH_ID, name: 'Roth', balance: x.rothBalance }]
        : []),
    ],
    spending: { currentAnnualSpending: 0, retirementAnnualSpending: 0 },
    assumptions: assumptionsTemplate(ctx.currentYear, {
      inflation: x.inflation,
      returnPreRetirement: x.annualReturn,
      returnPostRetirement: x.annualReturn,
    }),
  };
  const steps = andThen(buildHousehold(householdInput), (household) =>
    mapStep(all(toStep(previewAccumulation(household, ctx, 1)), project(household, ctx)), ([preview, projected]) => ({
      household,
      preview,
      projected,
    })),
  );
  return toResult(
    mapStep(steps, ({ household, preview, projected }) => {
      // One person with one plan, working at least one year (schema): these rows exist.
      const personRow = itemAt(itemAt(preview.people, 0).rows, 0);
      const planRow = itemAt(personRow.plans, 0);
      const plan = itemAt(itemAt(household.people, 0).workplacePlans, 0);

      // Year 1: the requested deferrals, then the limits.
      const missing: UnverifiedDetail[] = [];
      const rules = resolveRules(ctx.rules, {
        anchorYear: ctx.currentYear,
        targetYear: ctx.currentYear,
        indexRate: x.inflation,
      });
      const cappedResult = capContributions(
        {
          year: ctx.currentYear,
          age: x.age,
          plan,
          requestedTraditional: planRow.requestedTraditional,
          requestedRoth: planRow.requestedRoth,
          otherAggregatedDeferrals: ZERO_CENTS,
          eligibleCompForMatch: personRow.compensation.eligibleCompForMatch,
          compensation: personRow.compensation.totalCompensation,
          priorYearFicaWages: x.priorYearFicaWages,
        },
        rules,
      );
      const capped = ruleValue(cappedResult, missing);

      // Working years and the balance at retirement (planning age = retirement age, so the last row
      // is the retirement year).
      const p = projected.projection;
      const working = p.rows.filter((r) => r.phase === 'accumulation');
      const retirementRow = lastOf(p.rows);
      const lastWorking = lastOf(working);
      const account = (r: (typeof p.rows)[number], id: string) =>
        r.accounts.find((a) => a.accountId === id)?.end ?? ZERO_CENTS;
      const rows = working.map((r) => {
        const person = itemAt(r.people, 0);
        return {
          year: r.year,
          age: person.age,
          salary: person.baseSalary,
          employeeTraditional: person.employeeTraditional,
          employeeRoth: person.employeeRoth,
          catchUp: person.catchUp,
          employerMatch: person.employerMatch,
          employerFlat: person.employerFlat,
          traditionalBalance: account(r, TRAD_ID),
          rothBalance: account(r, ROTH_ID),
          totalBalance: r.totals.portfolioEnd,
          totalBalanceReal: r.real.portfolioEnd,
        };
      });
      return {
        value: {
          yearOne: {
            year: ctx.currentYear,
            requestedTraditional: planRow.requestedTraditional,
            requestedRoth: planRow.requestedRoth,
            matchBeforeLimits: planRow.matchBeforeLimits,
            capped,
            limitWarnings: cappedResult.status === 'ok' ? cappedResult.warnings : [],
          },
          rows,
          totals: {
            employeeContributions: sumOf(rows.map((r) => r.employeeTraditional + r.employeeRoth)),
            employerContributions: sumOf(working.map((r) => r.flows.employerContributions)),
            growth: sumOf(working.map((r) => r.flows.growthNet)),
            balanceAtRetirement: retirementRow.totals.portfolioStart,
            // A start-of-year balance in today's dollars is the prior year-end's real value (§1.1).
            balanceAtRetirementReal: lastWorking.real.portfolioEnd,
          },
          basis: { dollars: 'nominalAndTodaysDollars', tax: 'beforeTaxes', limits: limitsBasisOf(p) },
          ...mergeLabels([p], missing),
          assumptions: [
            'Contributions are percentages of base salary, made evenly through the year; the match follows the plan’s tiers.',
            'While the contribution limits are unverified, contributions are as elected, before limits, which can overstate savings above the limits.',
            'Balances are before taxes; withdrawals in retirement are not part of this calculator.',
          ],
        },
        warnings: projected.warnings,
      };
    }),
  );
}
