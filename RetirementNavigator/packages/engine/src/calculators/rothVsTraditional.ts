/**
 * Roth vs traditional calculator (docs/financial-model.md §12.4).
 *
 * Engine calls: `presetScenario('G_rothStrategy')` builds the Roth twin of a traditional-deferral
 * household (the same percentage of salary, moved to Roth), and `compareScenarios` projects both
 * (`computeDashboard`). The after-tax ending balance of each is the engine's
 * `afterTaxEndingBalanceReal` (§10: the real ending balance minus an assumed liquidation tax on
 * tax-deferred money at the projection's own final-year marginal ordinary rate). It is null while
 * tax rules are unverified; the calculator then reports the before-tax balances only, labeled.
 *
 * The working-years tax saving of the traditional deferral reaches the comparison through the
 * engine's cash-flow model: net pay above spending and contributions is routed to a taxable
 * brokerage account (`assumptions.surplus`), which needs verified tax rules (§3.8). Differences are
 * of engine outputs; no formula is computed here.
 */
import { z } from 'zod';
import type { EngineContext, ScenarioOutcome } from '../api';
import type { Cents, NominalRate } from '../domain/primitives';
import {
  AgeSchema,
  FractionSchema,
  InflationRateSchema,
  NominalRateSchema,
  NonNegativeCentsSchema,
} from '../domain/primitives';
import type { HouseholdInput } from '../domain/household';
import type { ProjectionResult } from '../domain/projection';
import type { EngineResult } from '../domain/results';
import { compareScenarios, presetScenario } from '../scenario/scenario';
import {
  CALC_IDS,
  assumptionsTemplate,
  buildHousehold,
  lastOf,
  limitsBasisOf,
  mergeLabels,
  notNull,
  parseInput,
  taxBasisOf,
  type CalculatorLabels,
} from './common';

export const RothVsTraditionalInputSchema = z
  .object({
    age: AgeSchema,
    retirementAge: AgeSchema,
    planningAge: AgeSchema,
    salary: NonNegativeCentsSchema,
    salaryGrowth: NominalRateSchema.default(0 as NominalRate),
    /** Share of salary deferred, the same in both cases (traditional in one, Roth in the other). */
    deferralPct: FractionSchema,
    returnBeforeRetirement: NominalRateSchema,
    returnInRetirement: NominalRateSchema,
    inflation: InflationRateSchema,
    /** Working-years household spending in today's dollars (paid from net pay). */
    currentSpending: NonNegativeCentsSchema,
    /** Retirement spending in today's dollars (a net need). */
    retirementSpending: NonNegativeCentsSchema,
    stateTaxRate: FractionSchema.default(0),
  })
  .superRefine((x, ctx) => {
    if (x.retirementAge <= x.age) {
      ctx.addIssue({
        code: 'custom',
        path: ['retirementAge'],
        message: 'Retirement age must be after the current age',
      });
    }
    if (x.retirementAge > x.planningAge) {
      ctx.addIssue({ code: 'custom', path: ['retirementAge'], message: 'Retirement age is after planning age' });
    }
  });
export type RothVsTraditionalInput = z.input<typeof RothVsTraditionalInputSchema>;

export interface RothVsTraditionalSide {
  endingBalance: Cents;
  endingBalanceReal: Cents;
  /** Tax-deferred part of the ending balance (nominal). */
  endingTaxDeferred: Cents;
  /** After the assumed liquidation tax (today's dollars); null while tax rules are unverified. */
  afterTaxEndingBalanceReal: Cents | null;
  /** Final-year marginal ordinary rate the after-tax figure uses; null while taxes are unverified. */
  marginalRate: number | null;
  depletionYear: number | null;
  success: boolean;
}

export interface RothVsTraditionalResult extends CalculatorLabels {
  traditional: RothVsTraditionalSide;
  roth: RothVsTraditionalSide;
  /** Roth minus traditional, after tax (today's dollars); null while taxes are unverified. */
  afterTaxDifferenceReal: Cents | null;
  /** Roth minus traditional, before tax (today's dollars). */
  beforeTaxDifferenceReal: Cents;
}

const PLAN_ID = 'calc-plan';

/** One side of the comparison, from a compared outcome whose dashboard exists. */
function side(o: ScenarioOutcome, baseline: ProjectionResult): RothVsTraditionalSide {
  // A projection has at least one row; the after-tax figure exists only when the final year was taxed.
  const last = lastOf(baseline.rows);
  return {
    endingBalance: baseline.summary.endingBalance,
    endingBalanceReal: baseline.summary.endingBalanceReal,
    endingTaxDeferred: last.totals.byTaxTreatment.taxDeferred,
    afterTaxEndingBalanceReal: o.afterTaxEndingBalanceReal,
    marginalRate:
      o.afterTaxEndingBalanceReal === null ? null : notNull(last.tax, 'final-year tax detail').marginalOrdinaryRate,
    depletionYear: baseline.summary.depletionYear,
    success: baseline.summary.deterministicSuccess,
  };
}

/** The traditional-deferral household the comparison starts from (exported for parity tests). */
export function rothVsTraditionalHousehold(
  x: z.output<typeof RothVsTraditionalInputSchema>,
  currentYear: number,
): HouseholdInput {
  const workplace = { planType: '401k' as const, ownerId: CALC_IDS.person, balance: 0 };
  return {
    id: 'calc-household',
    name: 'Calculator',
    filingStatus: 'single',
    people: [
      {
        id: CALC_IDS.person,
        name: 'You',
        birthYear: currentYear - x.age,
        retirementAge: x.retirementAge,
        planningAge: x.planningAge,
        employment: { baseSalary: x.salary, raise: { mode: 'nominal', rate: x.salaryGrowth } },
        workplacePlans: [
          {
            id: PLAN_ID,
            planType: '401k',
            traditionalAccountId: 'calc-traditional',
            rothAccountId: 'calc-roth',
            planOffersRoth: true,
            traditionalPctOfSalary: x.deferralPct,
            match: { tiers: [] },
          },
        ],
        socialSecurity: { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
      },
    ],
    accounts: [
      { ...workplace, type: 'workplaceTraditional', id: 'calc-traditional', name: 'Traditional 401(k)' },
      { ...workplace, type: 'workplaceRoth', id: 'calc-roth', name: 'Roth 401(k)' },
      {
        type: 'taxableBrokerage',
        id: 'calc-side',
        name: 'Taxable savings',
        ownerId: CALC_IDS.person,
        balance: 0,
        costBasis: 0,
      },
    ],
    spending: { currentAnnualSpending: x.currentSpending, retirementAnnualSpending: x.retirementSpending },
    assumptions: {
      ...assumptionsTemplate(currentYear, {
        inflation: x.inflation,
        returnPreRetirement: x.returnBeforeRetirement,
        returnPostRetirement: x.returnInRetirement,
      }),
      stateTaxRate: x.stateTaxRate,
      surplus: { mode: 'account', accountId: 'calc-side' },
    },
  };
}

export function rothVsTraditional(
  input: RothVsTraditionalInput,
  ctx: EngineContext,
): EngineResult<RothVsTraditionalResult> {
  const parsed = parseInput(RothVsTraditionalInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  const built = buildHousehold(rothVsTraditionalHousehold(x, ctx.currentYear));
  if (!built.ok) return built.result;
  const base = built.value;
  const roth = presetScenario(
    'G_rothStrategy',
    base,
    { currentYear: ctx.currentYear },
    {
      scenarioId: 'calc-roth-scenario',
      name: 'Roth',
      baseProfileId: base.id,
    },
  );
  const outcomes = compareScenarios(base, [roth], ctx);
  const sides = outcomes.map((o) =>
    o.dashboard ? { side: side(o, o.dashboard.baseline), baseline: o.dashboard.baseline } : null,
  );
  // A validated base and its preset-G twin always project; this guards the contract all the same.
  if (sides.some((x) => x === null)) return { status: 'invalid', issues: outcomes.flatMap((o) => o.issues) };
  const trad = notNull(sides[0], 'the traditional outcome');
  const rothSide = notNull(sides[1], 'the Roth outcome');
  const t = trad.side;
  const r = rothSide.side;
  const afterTax =
    t.afterTaxEndingBalanceReal !== null && r.afterTaxEndingBalanceReal !== null
      ? ((r.afterTaxEndingBalanceReal - t.afterTaxEndingBalanceReal) as Cents)
      : null;
  return {
    status: 'ok',
    value: {
      traditional: t,
      roth: r,
      afterTaxDifferenceReal: afterTax,
      beforeTaxDifferenceReal: (r.endingBalanceReal - t.endingBalanceReal) as Cents,
      basis: {
        dollars: 'nominalAndTodaysDollars',
        tax: afterTax === null ? 'beforeTaxes' : taxBasisOf(trad.baseline),
        limits: limitsBasisOf(trad.baseline),
      },
      ...mergeLabels([trad.baseline, rothSide.baseline]),
      assumptions: [
        'The same percentage of salary is deferred in both cases: traditional (pre-tax) or Roth (after tax).',
        'In the traditional case the lower tax while working leaves more net pay; any net pay above spending and contributions is invested in a taxable account (needs verified tax rules).',
        'After tax, tax-deferred money left at the end is reduced by the final year’s marginal ordinary rate (an assumption); Roth money is tax-free.',
        'Retirement spending is a net need; withdrawals are grossed up for taxes when tax rules are verified.',
      ],
    },
    warnings: [],
  };
}
