/**
 * "Use my plan’s values": calculator inputs read from the active household. Ages follow the engine's
 * rule (age in year Y = Y − birth year); the savings balance and this year's contributions are read
 * from the engine's own projection of the plan (year 1: portfolio at the start of the year, employee
 * plus employer contributions). Nothing here computes a financial figure.
 */
import {
  projectHousehold,
  type Account,
  type BaristaFireInput,
  type CoastFireInput,
  type CompoundInterestInput,
  type Contribution401kInput,
  type EngineContext,
  type FeeImpactInput,
  type FiNumberInput,
  type Household,
  type InflationPurchasingPowerInput,
  type MatchOptimizerInput,
  type Person,
  type RetirementAgeInput,
  type RothVsTraditionalInput,
  type SavingsGapInput,
  type SpendingPlannerInput,
  type WorkplacePlan,
} from '@rn/engine';
import type { PlanPrefill, PlanValues } from './useCalculator';
import * as D from './defaults';

interface PlanFacts {
  household: Household;
  person: Person;
  currentYear: number;
  age: number;
  /** Household savings at the start of this year (engine projection, year 1). */
  balance: number;
  /** This year's contributions, employee plus employer (engine projection, year 1). */
  contributions: number;
  /** The person's own benefit at the claiming age, when the plan holds it that way (no rule needed). */
  ssAtClaim: { monthlyAtClaim: number; claimAge: { years: number; months: number } } | null;
  plan: WorkplacePlan | null;
  /** Nominal raise, when the plan states one (an inflation-plus raise is left at the example value). */
  salaryGrowth: number | null;
}

function personOf(household: Household, personId: string | null): Person | undefined {
  return household.people.find((p) => p.id === personId) ?? household.people[0];
}

function planFacts(household: Household, ctx: EngineContext, personId: string | null): PlanFacts | null {
  const person = personOf(household, personId);
  if (!person) return null;
  const projected = projectHousehold(household, ctx);
  const first = projected.status === 'ok' ? projected.value.rows[0] : undefined;
  const ss = person.socialSecurity;
  const raise = person.employment?.raise;
  return {
    household,
    person,
    currentYear: ctx.currentYear,
    age: ctx.currentYear - person.birthYear,
    balance: first?.totals.portfolioStart ?? 0,
    contributions: first ? first.flows.contributions + first.flows.employerContributions : 0,
    ssAtClaim:
      ss.source.kind === 'atClaimAge' ? { monthlyAtClaim: ss.source.monthlyAtClaim, claimAge: ss.claimAge } : null,
    plan: person.workplacePlans[0] ?? null,
    salaryGrowth: raise?.mode === 'nominal' ? raise.rate : null,
  };
}

const whose = (f: PlanFacts) => (f.household.people.length > 1 ? `${f.person.name}’s` : 'your');

function prefillWith<T>(build: (f: PlanFacts) => PlanValues<T> | null): PlanPrefill<T> {
  return (household, ctx, personId) => {
    const facts = planFacts(household, ctx, personId);
    return facts ? build(facts) : null;
  };
}

/** The shared plan fields (savings gap, retirement age, Coast and Barista FIRE). */
function planFields(f: PlanFacts) {
  const a = f.household.assumptions;
  return {
    age: f.age,
    retirementAge: f.person.retirementAge,
    planningAge: f.person.planningAge,
    currentBalance: f.balance,
    annualContribution: f.contributions,
    returnBeforeRetirement: a.returnPreRetirement,
    returnInRetirement: a.returnPostRetirement,
    inflation: a.inflation,
    retirementSpending: f.household.spending.retirementAnnualSpending,
    socialSecurity: f.ssAtClaim,
    withdrawalTiming: a.withdrawalTiming,
  };
}

function planNote(f: PlanFacts): string {
  const ss = f.ssAtClaim ? '' : ' Social Security is left out unless the plan holds the benefit at the claiming age.';
  return `Filled from ${whose(f)} ages and the plan’s savings, contributions, returns and spending.${ss}`;
}

export const prefillCompoundInterest = prefillWith<CompoundInterestInput>((f) => ({
  values: {
    ...D.compoundInterestDefaults(),
    principal: f.balance,
    annualContribution: f.contributions,
    annualReturn: f.household.assumptions.returnPreRetirement,
    years: Math.max(1, f.person.retirementAge - f.age),
    inflation: f.household.assumptions.inflation,
  },
  note: `Filled from the plan’s savings, this year’s contributions and the years until ${whose(f)} retirement.`,
}));

export const prefillFeeImpact = prefillWith<FeeImpactInput>((f) => ({
  values: {
    ...D.feeImpactDefaults(),
    principal: f.balance,
    annualContribution: f.contributions,
    annualReturn: f.household.assumptions.returnPreRetirement,
    years: Math.max(1, f.person.retirementAge - f.age),
    inflation: f.household.assumptions.inflation,
  },
  note: `Filled from the plan’s savings, this year’s contributions and the years until ${whose(f)} retirement. The expense ratio is the example value.`,
}));

export const prefillInflation = prefillWith<InflationPurchasingPowerInput>((f) => ({
  values: {
    ...D.inflationDefaults(),
    amount: f.household.spending.retirementAnnualSpending,
    years: Math.max(1, f.person.retirementAge - f.age),
    inflation: f.household.assumptions.inflation,
  },
  note: `Filled from the plan’s retirement spending, inflation and the years until ${whose(f)} retirement.`,
}));

function planAccount(h: Household, id: string | null): Account | undefined {
  return id ? h.accounts.find((a) => a.id === id) : undefined;
}

export const prefillContribution401k = prefillWith<Contribution401kInput>((f) => {
  const plan = f.plan;
  const employment = f.person.employment;
  if (!plan || !employment) return null;
  const trad = planAccount(f.household, plan.traditionalAccountId);
  const roth = planAccount(f.household, plan.rothAccountId);
  return {
    values: {
      ...D.contribution401kDefaults(),
      age: f.age,
      retirementAge: f.person.retirementAge,
      salary: employment.baseSalary,
      salaryGrowth: f.salaryGrowth ?? D.contribution401kDefaults().salaryGrowth,
      planType: plan.planType,
      planOffersRoth: plan.planOffersRoth,
      traditionalPctOfSalary: plan.traditionalPctOfSalary,
      rothPctOfSalary: plan.planOffersRoth ? plan.rothPctOfSalary : 0,
      match: plan.match,
      traditionalBalance: trad?.balance ?? 0,
      rothBalance: plan.planOffersRoth ? (roth?.balance ?? 0) : 0,
      annualReturn: trad?.expectedReturn ?? f.household.assumptions.returnPreRetirement,
      inflation: f.household.assumptions.inflation,
      priorYearFicaWages: employment.priorYearFicaWages,
    },
    note: `Filled from ${whose(f)} salary, workplace plan, match and plan balances.`,
  };
});

export const prefillMatchOptimizer = prefillWith<MatchOptimizerInput>((f) => {
  const plan = f.plan;
  const employment = f.person.employment;
  if (!plan || !employment) return null;
  return {
    values: {
      ...D.matchOptimizerDefaults(),
      eligiblePay: employment.baseSalary,
      match: plan.match,
      currentDeferralRate: plan.traditionalPctOfSalary + plan.rothPctOfSalary,
    },
    note: `Filled from ${whose(f)} base salary (as the eligible pay), plan match and current deferral.`,
  };
});

export const prefillRothVsTraditional = prefillWith<RothVsTraditionalInput>((f) => {
  const employment = f.person.employment;
  if (!employment) return null;
  const a = f.household.assumptions;
  const deferral = f.plan ? f.plan.traditionalPctOfSalary + f.plan.rothPctOfSalary : 0;
  const defaults = D.rothVsTraditionalDefaults();
  return {
    values: {
      ...defaults,
      age: f.age,
      retirementAge: f.person.retirementAge,
      planningAge: f.person.planningAge,
      salary: employment.baseSalary,
      salaryGrowth: f.salaryGrowth ?? defaults.salaryGrowth,
      deferralPct: deferral > 0 ? Math.min(1, deferral) : defaults.deferralPct,
      returnBeforeRetirement: a.returnPreRetirement,
      returnInRetirement: a.returnPostRetirement,
      inflation: a.inflation,
      currentSpending: f.household.spending.currentAnnualSpending,
      retirementSpending: f.household.spending.retirementAnnualSpending,
      stateTaxRate: a.stateTaxRate,
    },
    note: `Filled from ${whose(f)} ages, salary and deferral, and the plan’s returns, spending and state tax rate.`,
  };
});

export const prefillRetirementAge = prefillWith<RetirementAgeInput>((f) => {
  const { retirementAge, ...fields } = planFields(f);
  const from = Math.max(f.age + 1, retirementAge - 5);
  const to = Math.min(f.person.planningAge, Math.max(from, retirementAge + 5));
  return {
    values: { ...D.retirementAgeDefaults(), ...fields, fromAge: from, toAge: to },
    note: planNote(f),
  };
});

export const prefillSavingsGap = prefillWith<SavingsGapInput>((f) => ({
  values: { ...D.savingsGapDefaults(), ...planFields(f) },
  note: planNote(f),
}));

export const prefillCoastFire = prefillWith<CoastFireInput>((f) => ({
  values: { ...D.coastFireDefaults(), ...planFields(f) },
  note: planNote(f),
}));

export const prefillBaristaFire = prefillWith<BaristaFireInput>((f) => {
  const defaults = D.baristaFireDefaults();
  const partTime = f.person.employment?.partTime;
  return {
    values: {
      ...defaults,
      ...planFields(f),
      partTime: partTime
        ? { ...partTime }
        : { ...defaults.partTime, startAge: f.person.retirementAge, endAge: f.person.retirementAge + 5 },
    },
    note: planNote(f),
  };
});

export const prefillWithdrawal = prefillWith<D.WithdrawalFormValues>((f) => {
  const a = f.household.assumptions;
  const defaults = D.withdrawalDefaults();
  const years = Math.max(1, f.person.planningAge - f.age + 1);
  return {
    values: {
      ...defaults,
      startingBalance: f.balance,
      age: f.age,
      years,
      annualReturn: a.returnPostRetirement,
      inflation: a.inflation,
      socialSecurity: f.ssAtClaim,
      withdrawalTiming: a.withdrawalTiming,
    },
    note: `Filled from the plan’s savings and ${whose(f)} age through the planning age, as if retired from this year.`,
  };
});

export const prefillFiNumber = prefillWith<FiNumberInput>((f) => {
  const a = f.household.assumptions;
  const age = Math.max(f.age, f.person.retirementAge);
  return {
    values: {
      ...D.fiNumberDefaults(),
      age,
      years: Math.max(1, f.person.planningAge - age + 1),
      annualReturn: a.returnPostRetirement,
      inflation: a.inflation,
      annualSpending: f.household.spending.retirementAnnualSpending,
      socialSecurity: f.ssAtClaim,
      withdrawalTiming: a.withdrawalTiming,
    },
    note: `Filled from the plan’s retirement spending, ${whose(f)} retirement and planning ages and the return in retirement.`,
  };
});

export const prefillSpendingPlanner = prefillWith<SpendingPlannerInput>((f) => {
  const h = f.household;
  const a = h.assumptions;
  const s = h.spending;
  return {
    values: {
      ...D.spendingPlannerDefaults(),
      people: h.people.map((p) => ({
        name: p.name,
        age: f.currentYear - p.birthYear,
        planningAge: p.planningAge,
        socialSecurity:
          p.socialSecurity.source.kind === 'atClaimAge'
            ? { monthlyAtClaim: p.socialSecurity.source.monthlyAtClaim, claimAge: p.socialSecurity.claimAge }
            : null,
      })),
      startingBalance: f.balance,
      annualReturn: a.returnPostRetirement,
      inflation: a.inflation,
      retirementSpending: s.retirementAnnualSpending,
      steps: s.steps.map((st) => ({ ...st })),
      realGlide: s.retirementRealGlide,
      healthcareBeforeMedicare: s.healthcareBeforeMedicare,
      survivorSpendingReduction: s.survivorSpendingReduction,
      withdrawalTiming: a.withdrawalTiming,
    },
    note: 'Filled from the plan’s people, savings, retirement spending plan and Social Security entered at the claiming age, as if retired from this year.',
  };
});

export const prefillSsClaiming = prefillWith<D.SsClaimingFormValues>((f) => {
  const ss = f.person.socialSecurity;
  const base = { birthYear: f.person.birthYear, birthMonth: f.person.birthMonth, throughAge: f.person.planningAge };
  if (ss.source.kind === 'statement') {
    return {
      values: { ...D.ssClaimingDefaults(), ...base, mode: 'pia', piaMonthly: ss.source.piaMonthly },
      note: `Filled from ${whose(f)} birth date, planning age and the benefit at full retirement age.`,
    };
  }
  if (ss.source.kind === 'atClaimAge') {
    return {
      values: {
        ...D.ssClaimingDefaults(),
        ...base,
        mode: 'amountsAtClaimAge',
        options: [{ claimAge: ss.claimAge, monthlyAtClaim: ss.source.monthlyAtClaim }],
      },
      note: `Filled from ${whose(f)} birth date, planning age and the benefit at the planned claiming age. Add the amounts at other ages from the SSA statement.`,
    };
  }
  return {
    values: { ...D.ssClaimingDefaults(), ...base },
    note: `Filled from ${whose(f)} birth date and planning age; the benefit amounts are example values.`,
  };
});
