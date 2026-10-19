/**
 * Example inputs each calculator opens with (money in integer cents, rates as decimals), in the
 * shape of the calculator's engine input. Illustrative values, not recommendations.
 */
import type {
  BaristaFireInput,
  CoastFireInput,
  CompoundInterestInput,
  Contribution401kInput,
  EmployerMatchRule,
  FeeImpactInput,
  FiNumberInput,
  InflationPurchasingPowerInput,
  LumpSumVsRecurringInput,
  MatchOptimizerInput,
  RetirementAgeInput,
  RothVsTraditionalInput,
  SavingsGapInput,
  SpendingPlannerInput,
  SsClaimingComparisonInput,
  WithdrawalInput,
} from '@rn/engine';
import { CURRENT_YEAR } from '@/app/env';

/** Form values of the two-mode calculators hold both modes' fields; the engine schema picks by `mode`. */
export type WithdrawalFormValues = Omit<Extract<WithdrawalInput, { mode: 'fixedPercentage' }>, 'mode'> & {
  mode: WithdrawalInput['mode'];
  withdrawalRate: number;
  maxRate: number;
};

type SsOption = { claimAge: { years: number; months: number }; monthlyAtClaim: number };
export type SsClaimingFormValues = Omit<Extract<SsClaimingComparisonInput, { mode: 'pia' }>, 'mode'> & {
  mode: SsClaimingComparisonInput['mode'];
  piaMonthly: number;
  options: SsOption[];
};

/** "100% of the first 3% of pay, then 50% of the next 2%". */
export const EXAMPLE_MATCH: EmployerMatchRule = {
  tiers: [
    { matchRate: 1, bandPctOfPay: 0.03 },
    { matchRate: 0.5, bandPctOfPay: 0.02 },
  ],
  flatPctOfPay: 0,
  annualMatchCap: null,
  vesting: { kind: 'immediate' },
  yearsOfServiceAtStart: 0,
};

const SS_AT_67 = (monthlyAtClaim: number) => ({ monthlyAtClaim, claimAge: { years: 67, months: 0 } });

const PLAN_OPTIONS = {
  taxTreatment: 'taxDeferred',
  costBasis: null,
  expenseRatio: 0,
  withdrawalTiming: 'midYear',
  minimumEndingBalance: 0,
} as const;

export const compoundInterestDefaults = (): CompoundInterestInput => ({
  principal: 1_000_000,
  annualContribution: 600_000,
  contributionGrowth: 0,
  annualReturn: 0.06,
  years: 30,
  inflation: 0.025,
  expenseRatio: 0,
});

export const feeImpactDefaults = (): FeeImpactInput => ({
  principal: 10_000_000,
  annualContribution: 1_000_000,
  contributionGrowth: 0,
  annualReturn: 0.06,
  expenseRatio: 0.01,
  years: 30,
  inflation: 0.025,
});

export const lumpSumDefaults = (): LumpSumVsRecurringInput => ({
  total: 6_000_000,
  spreadYears: 3,
  horizonYears: 20,
  annualReturn: 0.06,
  inflation: 0.025,
  expenseRatio: 0,
});

export const inflationDefaults = (): InflationPurchasingPowerInput => ({
  amount: 5_000_000,
  futureAmount: null,
  years: 25,
  inflation: 0.03,
});

export const contribution401kDefaults = () =>
  ({
    age: 35,
    retirementAge: 65,
    salary: 8_000_000,
    salaryGrowth: 0.03,
    planType: '401k',
    planOffersRoth: true,
    traditionalPctOfSalary: 0.06,
    rothPctOfSalary: 0,
    match: EXAMPLE_MATCH,
    traditionalBalance: 5_000_000,
    rothBalance: 0,
    annualReturn: 0.06,
    inflation: 0.025,
    priorYearFicaWages: null,
  }) satisfies Contribution401kInput;

export const matchOptimizerDefaults = (): MatchOptimizerInput => ({
  eligiblePay: 8_000_000,
  match: EXAMPLE_MATCH,
  currentDeferralRate: 0.03,
  scanStep: 0.005,
  scanTo: 0.15,
});

export const rothVsTraditionalDefaults = () =>
  ({
    age: 35,
    retirementAge: 65,
    planningAge: 95,
    salary: 8_000_000,
    salaryGrowth: 0.03,
    deferralPct: 0.15,
    returnBeforeRetirement: 0.06,
    returnInRetirement: 0.045,
    inflation: 0.025,
    currentSpending: 5_000_000,
    retirementSpending: 3_500_000,
    stateTaxRate: 0,
  }) satisfies RothVsTraditionalInput;

export const retirementAgeDefaults = (): RetirementAgeInput => ({
  age: 45,
  planningAge: 95,
  currentBalance: 30_000_000,
  annualContribution: 2_000_000,
  returnBeforeRetirement: 0.06,
  returnInRetirement: 0.045,
  inflation: 0.025,
  retirementSpending: 5_000_000,
  socialSecurity: SS_AT_67(200_000),
  ...PLAN_OPTIONS,
  fromAge: 55,
  toAge: 70,
});

export const savingsGapDefaults = (): SavingsGapInput => ({
  age: 40,
  retirementAge: 65,
  planningAge: 95,
  currentBalance: 15_000_000,
  annualContribution: 1_000_000,
  returnBeforeRetirement: 0.06,
  returnInRetirement: 0.045,
  inflation: 0.025,
  retirementSpending: 6_000_000,
  socialSecurity: SS_AT_67(220_000),
  ...PLAN_OPTIONS,
  maxExtraContribution: 100_000_000,
});

export const coastFireDefaults = (): CoastFireInput => ({
  age: 35,
  retirementAge: 65,
  planningAge: 95,
  currentBalance: 10_000_000,
  annualContribution: 1_500_000,
  returnBeforeRetirement: 0.06,
  returnInRetirement: 0.045,
  inflation: 0.025,
  retirementSpending: 5_000_000,
  socialSecurity: SS_AT_67(200_000),
  ...PLAN_OPTIONS,
  maxBalance: 10_000_000_000,
});

export const baristaFireDefaults = () =>
  ({
    age: 45,
    retirementAge: 50,
    planningAge: 95,
    currentBalance: 60_000_000,
    annualContribution: 2_000_000,
    returnBeforeRetirement: 0.06,
    returnInRetirement: 0.045,
    inflation: 0.025,
    retirementSpending: 5_000_000,
    socialSecurity: SS_AT_67(180_000),
    ...PLAN_OPTIONS,
    partTime: { startAge: 50, endAge: 60, annualIncome: 2_500_000 },
    maxPartTimeIncome: 50_000_000,
  }) satisfies BaristaFireInput;

const DRAWDOWN_OPTIONS = {
  taxTreatment: 'taxFree',
  costBasis: null,
  expenseRatio: 0,
  withdrawalTiming: 'midYear',
  socialSecurity: null,
  minimumEndingBalance: 0,
} as const;

export const withdrawalDefaults = (): WithdrawalFormValues => ({
  mode: 'fixedPercentage',
  startingBalance: 100_000_000,
  age: 65,
  years: 30,
  annualReturn: 0.05,
  inflation: 0.025,
  ...DRAWDOWN_OPTIONS,
  withdrawalRate: 0.04,
  maxRate: 1,
});

export const fiNumberDefaults = (): FiNumberInput => ({
  age: 45,
  years: 50,
  annualReturn: 0.05,
  inflation: 0.025,
  ...DRAWDOWN_OPTIONS,
  annualSpending: 5_000_000,
  withdrawalRate: 0.04,
  maxBalance: 10_000_000_000,
});

export const spendingPlannerDefaults = () =>
  ({
    people: [{ name: 'You', age: 65, planningAge: 95, socialSecurity: SS_AT_67(240_000) }],
    startingBalance: 100_000_000,
    taxTreatment: 'taxDeferred',
    costBasis: null,
    annualReturn: 0.05,
    expenseRatio: 0,
    inflation: 0.025,
    retirementSpending: 6_000_000,
    steps: [{ fromAge: 80, annualSpending: 5_000_000 }],
    realGlide: 0,
    healthcareBeforeMedicare: 0,
    survivorSpendingReduction: 0.2,
    withdrawalTiming: 'midYear',
  }) satisfies SpendingPlannerInput;

export const ssClaimingDefaults = (currentYear: number = CURRENT_YEAR): SsClaimingFormValues => ({
  mode: 'amountsAtClaimAge',
  birthYear: currentYear - 60,
  birthMonth: 1,
  throughAge: 90,
  piaMonthly: 200_000,
  options: [
    { claimAge: { years: 62, months: 0 }, monthlyAtClaim: 140_000 },
    { claimAge: { years: 67, months: 0 }, monthlyAtClaim: 200_000 },
    { claimAge: { years: 70, months: 0 }, monthlyAtClaim: 248_000 },
  ],
});
