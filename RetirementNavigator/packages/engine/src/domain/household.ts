/**
 * Household input model: people, income, workplace plans, accounts, other income, spending, assumptions.
 * Every entity that a scenario can diff carries a stable `id`.
 *
 * Money basis: unless a field name or doc says otherwise, input amounts are in TODAY'S dollars
 * for recurring amounts (spending, part-time income, statement PIA) and NOMINAL for balances and
 * current-year salary (which are the same thing in year 1). See docs/financial-model.md §2.
 */
import { z } from 'zod';
import {
  AgeSchema,
  AgeYearsMonthsSchema,
  CalendarYearSchema,
  EntityIdSchema,
  FilingStatusSchema,
  FractionSchema,
  InflationRateSchema,
  NominalRateSchema,
  NonNegativeCentsSchema,
  RealRateSchema,
  ZERO_CENTS,
  type RealRate,
} from './primitives';

// ---------------------------------------------------------------------------------------------
// Growth modes (shared)
// ---------------------------------------------------------------------------------------------

export const GrowthModeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('flat') }),
  z.object({ mode: z.literal('inflation') }),
  z.object({ mode: z.literal('rate'), rate: NominalRateSchema }),
]);
export type GrowthMode = z.infer<typeof GrowthModeSchema>;

// ---------------------------------------------------------------------------------------------
// Employer match (the single shared model, used by the forecast, the readout and the calculators)
// ---------------------------------------------------------------------------------------------

/**
 * One match tier. Tiers are consecutive bands of pay: tier 1 covers employee deferrals from 0% to
 * `bandPctOfPay`; tier 2 covers the next `bandPctOfPay`, and so on.
 * Example "100% of the first 3%, then 50% of the next 2%" = [{1, 0.03}, {0.5, 0.02}].
 */
export const MatchTierSchema = z.object({
  matchRate: z.number().min(0).max(5, { message: 'Match rate above 500% is not supported' }),
  bandPctOfPay: FractionSchema,
});
export type MatchTier = z.infer<typeof MatchTierSchema>;

export const VestingScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('immediate') }),
  /** 0% vested until `years` of service, then 100%. */
  z.object({ kind: z.literal('cliff'), years: z.number().int().min(1).max(10) }),
  /** `vestedByYear[k]` = vested fraction after k+1 completed years of service (non-decreasing, ends at 1). */
  z.object({
    kind: z.literal('graded'),
    vestedByYear: z
      .array(FractionSchema)
      .min(1)
      .max(10)
      .refine((v) => v.every((x, i) => i === 0 || x >= (v[i - 1] ?? 0)) && v[v.length - 1] === 1, {
        message: 'Graded vesting must not decrease and must end at 100%',
      }),
  }),
]);
export type VestingSchedule = z.infer<typeof VestingScheduleSchema>;

export const EmployerMatchRuleSchema = z.object({
  tiers: z
    .array(MatchTierSchema)
    .max(5)
    .refine((t) => t.reduce((sum, tier) => sum + tier.bandPctOfPay, 0) <= 1 + 1e-9, {
      message: 'Match tiers cannot cover more than 100% of pay',
    }),
  /** Non-elective employer contribution as a share of eligible pay, paid regardless of deferrals. */
  flatPctOfPay: FractionSchema.default(0),
  /** Optional plan-specific annual dollar cap on the match (excluding the flat contribution). */
  annualMatchCap: NonNegativeCentsSchema.nullable().default(null),
  vesting: VestingScheduleSchema.default(() => ({ kind: 'immediate' }) as const),
  /** Completed years of service at the start of year 1 (drives vesting). */
  yearsOfServiceAtStart: z.number().int().min(0).max(60).default(0),
});
export type EmployerMatchRule = z.infer<typeof EmployerMatchRuleSchema>;

// ---------------------------------------------------------------------------------------------
// Employment income (per person)
// ---------------------------------------------------------------------------------------------

export const BonusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('percentOfSalary'), pct: z.number().min(0).max(10) }),
  z.object({ kind: z.literal('fixed'), amount: NonNegativeCentsSchema }),
]);
export type Bonus = z.infer<typeof BonusSchema>;

export const BonusGrowthSchema = z.discriminatedUnion('mode', [
  /** Fixed bonus grows at the salary raise rate; a percent-of-salary bonus always tracks salary. */
  z.object({ mode: z.literal('withSalary') }),
  z.object({ mode: z.literal('ownRate'), rate: NominalRateSchema }),
  z.object({ mode: z.literal('flat') }),
]);

export const RaiseSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('nominal'), rate: NominalRateSchema }),
  /** Nominal raise = (1 + inflation)(1 + realRate) - 1. */
  z.object({ mode: z.literal('inflationPlus'), realRate: RealRateSchema }),
]);
export type Raise = z.infer<typeof RaiseSchema>;

export const RaiseOverrideSchema = z.object({
  year: CalendarYearSchema,
  /** Nominal raise applied to the prior year's base salary in `year` (may be 0 or negative). */
  rate: NominalRateSchema,
});

export const PartTimePhaseSchema = z
  .object({
    startAge: AgeSchema,
    endAge: AgeSchema,
    /** Annual earnings in today's dollars; grows with inflation. FICA applies; no plan deferrals. */
    annualIncome: NonNegativeCentsSchema,
  })
  .refine((p) => p.startAge < p.endAge, { message: 'Part-time end age must be after its start age', path: ['endAge'] });

export const EmploymentIncomeSchema = z.object({
  /** Current gross annual base salary (year 1, nominal = today's dollars). */
  baseSalary: NonNegativeCentsSchema,
  bonus: BonusSchema.default(() => ({ kind: 'none' }) as const),
  bonusGrowth: BonusGrowthSchema.default(() => ({ mode: 'withSalary' }) as const),
  /** Plan-dependent; default on (labeled in the UI). */
  bonusCountsForDeferrals: z.boolean().default(true),
  bonusCountsForMatch: z.boolean().default(true),
  raise: RaiseSchema,
  raiseOverrides: z
    .array(RaiseOverrideSchema)
    .refine((o) => new Set(o.map((x) => x.year)).size === o.length, { message: 'Only one raise override per year' })
    .default(() => []),
  /** Last age with salary is `stopAge - 1`; null = the person's retirement age. */
  stopAge: AgeSchema.nullable().default(null),
  partTime: PartTimePhaseSchema.nullable().default(null),
  /** Prior-year FICA (Box 3) wages; needed for the higher-earner Roth catch-up rule. Null = unknown. */
  priorYearFicaWages: NonNegativeCentsSchema.nullable().default(null),
});
export type EmploymentIncome = z.infer<typeof EmploymentIncomeSchema>;

// ---------------------------------------------------------------------------------------------
// Workplace plans (401(k)/403(b)/457(b)) — contributions and match come ONLY from here
// ---------------------------------------------------------------------------------------------

export const AutoEscalationSchema = z.object({
  stepPct: FractionSchema,
  capPct: FractionSchema,
  appliesTo: z.enum(['traditional', 'roth']),
});

export const WorkplacePlanSchema = z.object({
  id: EntityIdSchema,
  planType: z.enum(['401k', '403b', '457b']),
  traditionalAccountId: EntityIdSchema,
  rothAccountId: EntityIdSchema.nullable().default(null),
  planOffersRoth: z.boolean().default(false),
  traditionalPctOfSalary: FractionSchema.default(0),
  rothPctOfSalary: FractionSchema.default(0),
  traditionalPctOfBonus: FractionSchema.default(0),
  rothPctOfBonus: FractionSchema.default(0),
  autoEscalation: AutoEscalationSchema.nullable().default(null),
  match: EmployerMatchRuleSchema,
  /** Roth match is plan-dependent; default traditional. */
  matchDestination: z.enum(['traditional', 'roth']).default('traditional'),
});
export type WorkplacePlan = z.infer<typeof WorkplacePlanSchema>;

// ---------------------------------------------------------------------------------------------
// Social Security input (per person)
// ---------------------------------------------------------------------------------------------

export const EarningsRecordSchema = z.object({ year: CalendarYearSchema, earnings: NonNegativeCentsSchema });

export const SocialSecurityInputSchema = z.object({
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    /** Monthly benefit at full retirement age from the person's SSA statement, in today's dollars. Takes priority. */
    z.object({ kind: z.literal('statement'), piaMonthly: NonNegativeCentsSchema }),
    /**
     * Monthly benefit at the planned claiming age, read from the person's SSA statement (which lists
     * the benefit at each claiming age), in today's dollars. Needs no rule values for the person's own
     * benefit; spousal and survivor amounts still need the verified SSA rules. (Contract 1.6.0.)
     */
    z.object({ kind: z.literal('atClaimAge'), monthlyAtClaim: NonNegativeCentsSchema }),
    /** Illustrative estimator, not an official SSA calculation. */
    z.object({
      kind: z.literal('estimateAverage'),
      averageAnnualEarnings: NonNegativeCentsSchema,
      yearsOfEarnings: z.number().int().min(0).max(50),
    }),
    z.object({ kind: z.literal('estimateHistory'), earnings: z.array(EarningsRecordSchema).max(80) }),
  ]),
  claimAge: AgeYearsMonthsSchema.refine(
    (a) => a.years * 12 + a.months >= 62 * 12 && a.years * 12 + a.months <= 70 * 12,
    {
      message: 'Claiming age must be between 62 and 70',
    },
  ),
});
export type SocialSecurityInput = z.infer<typeof SocialSecurityInputSchema>;

// ---------------------------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------------------------

export const PersonSchema = z.object({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(60),
  birthYear: CalendarYearSchema,
  /** Used only where SSA rules count months (FRA, claiming). Annual model otherwise. */
  birthMonth: z.number().int().min(1).max(12).default(1),
  /** Retirement takes effect January 1 of the year the person reaches this age (no salary that year). */
  retirementAge: AgeSchema,
  /** Longevity assumption; the household runs until the longer-lived person's planning age. */
  planningAge: AgeSchema.default(100),
  employment: EmploymentIncomeSchema.nullable().default(null),
  workplacePlans: z
    .array(WorkplacePlanSchema)
    .max(2)
    .default(() => []),
  socialSecurity: SocialSecurityInputSchema,
});
export type Person = z.infer<typeof PersonSchema>;

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------

export const AllocationSchema = z
  .object({ stocks: FractionSchema, bonds: FractionSchema, cash: FractionSchema })
  .refine((a) => Math.abs(a.stocks + a.bonds + a.cash - 1) < 1e-9, { message: 'Allocation must total 100%' });
export type Allocation = z.infer<typeof AllocationSchema>;

/** Contribution schedule for non-workplace accounts (IRA, HSA, taxable, cash, other). */
export const ContributionScheduleSchema = z
  .object({
    amount: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('dollars'),
        amount: NonNegativeCentsSchema,
        frequency: z.enum(['annual', 'monthly']),
      }),
      z.object({ kind: z.literal('percentOfSalary'), pct: FractionSchema }),
      /** Contribute the year's allowed maximum (IRA/HSA), after eligibility and earned-income caps. */
      z.object({ kind: z.literal('maxAllowed') }),
    ]),
    growth: GrowthModeSchema.default(() => ({ mode: 'flat' }) as const),
    /** First contribution year; null = year 1. */
    startYear: CalendarYearSchema.nullable().default(null),
    /** Last contribution year (inclusive); null = the owner's last working year. */
    stopYear: CalendarYearSchema.nullable().default(null),
  })
  .refine((c) => c.startYear === null || c.stopYear === null || c.startYear <= c.stopYear, {
    message: 'Contribution stop year is before its start year',
    path: ['stopYear'],
  });
export type ContributionSchedule = z.infer<typeof ContributionScheduleSchema>;

const AccountBase = z.object({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(60),
  ownerId: EntityIdSchema,
  balance: NonNegativeCentsSchema,
  /** Expected geometric (median) nominal return; null = household assumption for the phase. */
  expectedReturn: NominalRateSchema.nullable().default(null),
  /** Expense ratio, modeled as return drag. */
  expenseRatio: z.number().min(0).max(0.05).default(0),
  /** Asset-class allocation for Monte Carlo and view (c); null = blended-return fallback. */
  allocation: AllocationSchema.nullable().default(null),
});

export const AccountSchema = z.discriminatedUnion('type', [
  AccountBase.extend({
    type: z.literal('workplaceTraditional'),
    planType: z.enum(['401k', '403b', '457b']),
    /** Part of `balance` attributable to employer contributions not yet vested. */
    unvestedEmployerBalance: NonNegativeCentsSchema.default(ZERO_CENTS),
  }),
  AccountBase.extend({
    type: z.literal('workplaceRoth'),
    planType: z.enum(['401k', '403b', '457b']),
    unvestedEmployerBalance: NonNegativeCentsSchema.default(ZERO_CENTS),
  }),
  AccountBase.extend({
    type: z.literal('traditionalIra'),
    contribution: ContributionScheduleSchema.nullable().default(null),
  }),
  AccountBase.extend({
    type: z.literal('rothIra'),
    contribution: ContributionScheduleSchema.nullable().default(null),
    /** Contribution basis (withdrawable tax- and penalty-free). Must not exceed balance at entry. */
    contributionBasis: NonNegativeCentsSchema,
    /** First year any Roth IRA contribution was made (5-year rule); null = unknown, treated as year 1. */
    firstContributionYear: CalendarYearSchema.nullable().default(null),
    /** MAGI override for the eligibility check; null = documented default estimate. */
    magiOverride: NonNegativeCentsSchema.nullable().default(null),
  }),
  AccountBase.extend({
    type: z.literal('hsa'),
    contribution: ContributionScheduleSchema.nullable().default(null),
    coverage: z.enum(['selfOnly', 'family']),
    /** User attests to HDHP coverage; contributions are blocked without it. */
    hdhpAttested: z.boolean(),
  }),
  AccountBase.extend({
    type: z.literal('taxableBrokerage'),
    contribution: ContributionScheduleSchema.nullable().default(null),
    costBasis: NonNegativeCentsSchema,
  }),
  AccountBase.extend({ type: z.literal('cash'), contribution: ContributionScheduleSchema.nullable().default(null) }),
  AccountBase.extend({
    type: z.literal('other'),
    contribution: ContributionScheduleSchema.nullable().default(null),
    taxTreatment: z.enum(['taxDeferred', 'taxFree', 'taxable']),
  }),
]);
export type Account = z.infer<typeof AccountSchema>;
export type AccountType = Account['type'];
export type TaxTreatment = 'taxDeferred' | 'taxFree' | 'taxable';

// ---------------------------------------------------------------------------------------------
// Other income, pensions, one-time events
// ---------------------------------------------------------------------------------------------

/** A recurring non-employment income stream (rental, annuity, consulting). */
export const IncomeSourceSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(60),
    ownerId: EntityIdSchema.nullable().default(null),
    startYear: CalendarYearSchema,
    /** Inclusive; null = through the end of the projection. */
    endYear: CalendarYearSchema.nullable().default(null),
    /** Annual amount in today's dollars at year 1. */
    annualAmount: NonNegativeCentsSchema,
    growth: GrowthModeSchema.default(() => ({ mode: 'inflation' }) as const),
    taxableFraction: FractionSchema.default(1),
  })
  .refine((x) => x.endYear === null || x.startYear <= x.endYear, {
    message: 'End year is before start year',
    path: ['endYear'],
  });
export type IncomeSource = z.infer<typeof IncomeSourceSchema>;

export const PensionSchema = z.object({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(60),
  ownerId: EntityIdSchema,
  startAge: AgeSchema,
  annualAmount: NonNegativeCentsSchema,
  /** Whether `annualAmount` is stated in today's dollars or nominal dollars at the start age. */
  amountBasis: z.enum(['todaysDollars', 'nominalAtStart']),
  cola: GrowthModeSchema.default(() => ({ mode: 'flat' }) as const),
  taxableFraction: FractionSchema.default(1),
  payout: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('annuity') }),
    /** Lump sum paid at the start age (nominal), rolled into the destination account. */
    z.object({ kind: z.literal('lumpSum'), amount: NonNegativeCentsSchema, destinationAccountId: EntityIdSchema }),
  ]),
  /** Share of the annuity that continues to a surviving spouse (default 100%). */
  survivorFraction: FractionSchema.default(1),
});
export type Pension = z.infer<typeof PensionSchema>;

export const OneTimeEventSchema = z.object({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(60),
  year: CalendarYearSchema,
  direction: z.enum(['inflow', 'outflow']),
  amount: NonNegativeCentsSchema,
  amountBasis: z.enum(['todaysDollars', 'nominal']),
  taxTreatment: z.enum(['none', 'ordinaryIncome', 'capitalGain']).default('none'),
  /** For capital-gain inflows (e.g. a home sale): taxable gain as a share of the amount. */
  gainFraction: FractionSchema.default(0),
  /** Inflow destination; null = the surplus destination. Outflows are funded like spending. */
  destinationAccountId: EntityIdSchema.nullable().default(null),
});
export type OneTimeEvent = z.infer<typeof OneTimeEventSchema>;

// ---------------------------------------------------------------------------------------------
// Spending
// ---------------------------------------------------------------------------------------------

export const SpendingStepSchema = z.object({
  /** Age of the primary person when the step takes effect. */
  fromAge: AgeSchema,
  /** Annual spending in today's dollars from that age. */
  annualSpending: NonNegativeCentsSchema,
});

export const SpendingPlanSchema = z.object({
  /** Current annual household spending (today's dollars), used in accumulation-phase cash flow. */
  currentAnnualSpending: NonNegativeCentsSchema,
  /** Annual retirement spending (today's dollars), a NET (after-tax) need. */
  retirementAnnualSpending: NonNegativeCentsSchema,
  steps: z
    .array(SpendingStepSchema)
    .max(10)
    .refine((st) => new Set(st.map((x) => x.fromAge)).size === st.length, { message: 'Only one spending step per age' })
    .default(() => []),
  /** Annual real change in retirement spending (e.g. -0.01 = 1% less each year in real terms). */
  retirementRealGlide: RealRateSchema.default(0 as RealRate),
  /** User-entered pre-Medicare healthcare line item (today's dollars per year, retired years before 65). */
  healthcareBeforeMedicare: NonNegativeCentsSchema.default(ZERO_CENTS),
  /** Household spending reduction after the first death (labeled assumption, default 20%). */
  survivorSpendingReduction: FractionSchema.default(0.2),
  /** Annual qualified medical expenses paid from an HSA (today's dollars, default 0). */
  hsaQualifiedMedicalExpenses: NonNegativeCentsSchema.default(ZERO_CENTS),
});
export type SpendingPlan = z.infer<typeof SpendingPlanSchema>;

// ---------------------------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------------------------

export const WithdrawalStrategySchema = z.enum([
  'taxableFirst',
  'traditionalFirst',
  'rothLast',
  'proportional',
  'bracketFill',
]);
export type WithdrawalStrategy = z.infer<typeof WithdrawalStrategySchema>;

export const CapitalMarketAssumptionSchema = z.object({
  /** Geometric (median) nominal annual return. */
  geometricReturn: z.number().min(-0.5).max(0.5),
  /** Volatility (standard deviation) of annual log returns. */
  volatility: z.number().min(0).max(1),
});

/**
 * Capital-market assumptions: labeled, editable defaults (see docs/assumptions.md for rationale).
 * Shared by the deterministic projection (allocation-implied returns) and Monte Carlo (volatility).
 */
export const CapitalMarketSchema = z.object({
  stocks: CapitalMarketAssumptionSchema,
  bonds: CapitalMarketAssumptionSchema,
  cash: CapitalMarketAssumptionSchema,
  /** Correlation of log returns, order [stocks, bonds, cash]. Must be 3×3, symmetric, unit diagonal, PSD. */
  correlation: z
    .array(z.array(z.number().min(-1).max(1)).length(3))
    .length(3)
    .refine(
      (m) =>
        m.every(
          (row, i) =>
            Math.abs((row[i] ?? 0) - 1) < 1e-12 && row.every((v, j) => Math.abs(v - (m[j]?.[i] ?? NaN)) < 1e-12),
        ),
      { message: 'Correlation matrix must be symmetric with 1s on the diagonal' },
    ),
  /** Volatility used for accounts without an allocation (blended-return fallback). */
  blendedVolatility: z.number().min(0).max(1),
  /** Rationale/source shown beside every result that uses these values. */
  note: z.string().min(1),
});
export type CapitalMarket = z.infer<typeof CapitalMarketSchema>;

export const AssumptionsSchema = z.object({
  /** Bounded so the deflator (1 + i) stays positive; extreme values are still testable. */
  inflation: InflationRateSchema,
  /**
   * Geometric (median) nominal returns: the blended-return fallback for accounts with neither an
   * expected return nor an allocation. Precedence: account.expectedReturn, then allocation × CMA
   * geometric returns, then these.
   */
  returnPreRetirement: NominalRateSchema,
  returnPostRetirement: NominalRateSchema,
  capitalMarket: CapitalMarketSchema,
  /** Fixed return offsets for the optimistic / pessimistic deterministic lines (NOT confidence intervals). */
  deterministicOffsets: z
    .object({ optimistic: z.number().min(0).max(0.1), pessimistic: z.number().min(-0.1).max(0) })
    .default(() => ({ optimistic: 0.02, pessimistic: -0.02 }) as const),
  /** Contributions are always mid-year. Withdrawals mid-year (default) or start of year (conservative). */
  withdrawalTiming: z.enum(['midYear', 'startOfYear']).default('midYear'),
  /** Monthly granularity is deterministic-only. */
  granularity: z.enum(['annual', 'monthly']).default('annual'),
  /** Flat, user-entered effective state income-tax rate (the only state modeling). */
  stateTaxRate: FractionSchema.default(0),
  /** Annual tax drag on taxable-account growth (labeled, default 0). */
  taxableAccountTaxDrag: z.number().min(0).max(0.05).default(0),
  rules: z.object({
    /** Latest tax year whose published values are used; later years are projected. */
    anchorYear: CalendarYearSchema,
    /** Indexing rate for `indexed` values beyond published years. */
    indexing: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('inflation') }),
        z.object({ mode: z.literal('rate'), rate: NominalRateSchema }),
      ])
      .default(() => ({ mode: 'inflation' }) as const),
    /** Treatment of provisions after their sunset year (labeled assumption). */
    postSunsetLaw: z.enum(['asWritten']).default('asWritten'),
  }),
  socialSecurity: z
    .object({
      cola: z
        .discriminatedUnion('mode', [
          z.object({ mode: z.literal('inflation') }),
          z.object({ mode: z.literal('rate'), rate: NominalRateSchema }),
        ])
        .default(() => ({ mode: 'inflation' }) as const),
      /** Optional user-set benefit reduction from a year (an assumption, not a prediction). */
      benefitReduction: z.object({ fromYear: CalendarYearSchema, reduction: FractionSchema }).nullable().default(null),
    })
    .default(() => ({ cola: { mode: 'inflation' }, benefitReduction: null }) as const),
  withdrawalStrategy: WithdrawalStrategySchema.default('taxableFirst'),
  /** For `bracketFill`: fill traditional withdrawals up to the top of this ordinary-rate bracket. */
  bracketFillTopRate: z.number().min(0).max(1).nullable().default(null),
  /** Where an accumulation-phase cash surplus goes. */
  surplus: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('spent') }),
      z.object({ mode: z.literal('account'), accountId: EntityIdSchema }),
    ])
    .default(() => ({ mode: 'spent' }) as const),
  /** Deterministic success criterion: no depletion before planning age and at least this ending balance (today's $). */
  minimumEndingBalance: NonNegativeCentsSchema.default(ZERO_CENTS),
  /** Deterministic return-shock sequence (scenario D). Overrides all account returns for those years. */
  marketShock: z
    .object({ startYear: CalendarYearSchema, returns: z.array(NominalRateSchema).min(1).max(10) })
    .nullable()
    .default(null),
  grossUp: z
    .object({
      maxIterations: z.number().int().min(1).max(200).default(50),
      toleranceCents: z.number().int().min(1).max(10_000).default(100),
    })
    .default(() => ({ maxIterations: 50, toleranceCents: 100 }) as const),
});
export type Assumptions = z.infer<typeof AssumptionsSchema>;

// ---------------------------------------------------------------------------------------------
// Household (root input entity)
// ---------------------------------------------------------------------------------------------

const SURPLUS_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set(['taxableBrokerage', 'cash', 'other']);

export const HouseholdSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(80),
    filingStatus: FilingStatusSchema,
    /** Display only; state tax is the flat `assumptions.stateTaxRate`. */
    stateCode: z.string().length(2).nullable().default(null),
    /** First entry is the primary person (spending steps use the primary person's age). */
    people: z.array(PersonSchema).min(1).max(2),
    accounts: z
      .array(AccountSchema)
      .max(50)
      .default(() => []),
    otherIncome: z
      .array(IncomeSourceSchema)
      .max(20)
      .default(() => []),
    pensions: z
      .array(PensionSchema)
      .max(10)
      .default(() => []),
    oneTimeEvents: z
      .array(OneTimeEventSchema)
      .max(50)
      .default(() => []),
    spending: SpendingPlanSchema,
    assumptions: AssumptionsSchema,
  })
  .superRefine((h, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const planAccountIds = new Set<string>();
    const expectedPeople = h.filingStatus === 'marriedFilingJointly' ? 2 : 1;
    if (h.people.length !== expectedPeople) {
      ctx.addIssue({
        code: 'custom',
        path: ['people'],
        message:
          h.filingStatus === 'marriedFilingJointly'
            ? 'Married filing jointly needs two people'
            : 'Single filing status supports one person (unmarried partners are unsupported)',
      });
    }
    const ids = new Set<string>();
    const all = [
      ...h.people.map((p) => p.id),
      ...h.people.flatMap((p) => p.workplacePlans.map((w) => w.id)),
      ...h.accounts.map((a) => a.id),
      ...h.otherIncome.map((i) => i.id),
      ...h.pensions.map((p) => p.id),
      ...h.oneTimeEvents.map((e) => e.id),
    ];
    for (const id of all) {
      if (ids.has(id)) ctx.addIssue({ code: 'custom', path: [], message: `Duplicate id "${id}"` });
      ids.add(id);
    }
    const personIds = new Set(h.people.map((p) => p.id as string));
    const accountsById = new Map(h.accounts.map((a) => [a.id as string, a]));
    h.accounts.forEach((a, i) => {
      if (!personIds.has(a.ownerId))
        ctx.addIssue({ code: 'custom', path: ['accounts', i, 'ownerId'], message: 'Unknown owner' });
      if (a.type === 'rothIra' && a.contributionBasis > a.balance) {
        ctx.addIssue({
          code: 'custom',
          path: ['accounts', i, 'contributionBasis'],
          message: 'Basis cannot exceed balance',
        });
      }
    });
    h.people.forEach((p, pi) => {
      if (p.retirementAge > p.planningAge) {
        ctx.addIssue({
          code: 'custom',
          path: ['people', pi, 'retirementAge'],
          message: 'Retirement age is after planning age',
        });
      }
      p.workplacePlans.forEach((w, wi) => {
        const trad = accountsById.get(w.traditionalAccountId);
        if (!trad || trad.type !== 'workplaceTraditional' || trad.ownerId !== p.id) {
          ctx.addIssue({
            code: 'custom',
            path: ['people', pi, 'workplacePlans', wi, 'traditionalAccountId'],
            message: 'Must reference this person’s traditional workplace account',
          });
        }
        if (w.rothAccountId !== null) {
          const roth = accountsById.get(w.rothAccountId);
          if (!roth || roth.type !== 'workplaceRoth' || roth.ownerId !== p.id) {
            ctx.addIssue({
              code: 'custom',
              path: ['people', pi, 'workplacePlans', wi, 'rothAccountId'],
              message: 'Must reference this person’s Roth workplace account',
            });
          }
        }
        const usesRoth =
          w.rothPctOfSalary > 0 ||
          w.rothPctOfBonus > 0 ||
          w.matchDestination === 'roth' ||
          w.autoEscalation?.appliesTo === 'roth';
        if (usesRoth && !w.planOffersRoth) {
          issue(['people', pi, 'workplacePlans', wi], 'Roth elections need a plan that offers Roth');
        } else if (usesRoth && w.rothAccountId === null) {
          issue(['people', pi, 'workplacePlans', wi, 'rothAccountId'], 'Roth elections need a Roth workplace account');
        }
        for (const id of [w.traditionalAccountId, w.rothAccountId]) {
          if (id === null) continue;
          const account = accountsById.get(id);
          if (account && (account.type === 'workplaceTraditional' || account.type === 'workplaceRoth')) {
            if (account.planType !== w.planType) {
              issue(['people', pi, 'workplacePlans', wi, 'planType'], 'Plan type must match its accounts');
            }
          }
          if (planAccountIds.has(id)) {
            issue(['people', pi, 'workplacePlans', wi], `Account "${id}" is already used by another plan`);
          }
          planAccountIds.add(id);
        }
      });
    });
    h.pensions.forEach((pension, i) => {
      if (!personIds.has(pension.ownerId)) issue(['pensions', i, 'ownerId'], 'Unknown owner');
      if (pension.payout.kind === 'lumpSum' && !accountsById.has(pension.payout.destinationAccountId)) {
        issue(['pensions', i, 'payout', 'destinationAccountId'], 'Unknown destination account');
      }
    });
    h.otherIncome.forEach((income, i) => {
      if (income.ownerId !== null && !personIds.has(income.ownerId))
        issue(['otherIncome', i, 'ownerId'], 'Unknown owner');
    });
    h.oneTimeEvents.forEach((event, i) => {
      if (event.destinationAccountId !== null && !accountsById.has(event.destinationAccountId)) {
        issue(['oneTimeEvents', i, 'destinationAccountId'], 'Unknown destination account');
      }
    });
    if (h.assumptions.surplus.mode === 'account') {
      const surplus = accountsById.get(h.assumptions.surplus.accountId);
      if (!surplus) {
        issue(['assumptions', 'surplus', 'accountId'], 'Unknown surplus account');
      } else if (!SURPLUS_ACCOUNT_TYPES.has(surplus.type)) {
        // Surplus cash must not bypass workplace, IRA or HSA contribution limits.
        issue(
          ['assumptions', 'surplus', 'accountId'],
          'Surplus can go only to a taxable brokerage, cash or other account',
        );
      }
    }
  });
export type Household = z.infer<typeof HouseholdSchema>;
export type HouseholdInput = z.input<typeof HouseholdSchema>;
