/**
 * Income & Savings live preview (docs/financial-model.md §3): per-person compensation, workplace
 * elections, limits and match, scheduled IRA/HSA/taxable/cash contributions, and household
 * accumulation-phase net-pay feasibility. Always `ok`: outputs that need a null rule are null and the
 * rules are listed in `unverified`.
 */
import type { Cents, Fraction } from '../domain/primitives';
import type { Household, Person, WorkplacePlan } from '../domain/household';
import type { EngineResult, EngineWarning, UnverifiedDetail } from '../domain/results';
import type {
  AccumulationPreview,
  CappedContributions,
  CashFlowPreviewRow,
  EngineContext,
  PersonPreviewRow,
  ResolvedYearRules,
  TaxBreakdown,
} from '../api';
import { compensationPathFloat, type CompensationFloat } from './compensation';
import { computeMatch, vestedFraction } from '../match/match';
import { capContributions } from '../limits/workplace';
import { scheduledContributions, type PersonYearInput } from './scheduled';
import { computeTax } from '../tax/tax';
import { resolveRules } from '../rules/resolve';
import { RuleAccess } from '../rules/access';
import { asCents, toCents } from '../money';
import { priceIndex } from '../time';
import type { NominalRate } from '../domain/primitives';

const ZERO_CAPPED: CappedContributions = {
  traditional: 0 as Cents,
  roth: 0 as Cents,
  catchUp: 0 as Cents,
  catchUpIsRoth: false,
  employerMatch: 0 as Cents,
  employerFlat: 0 as Cents,
  cappedAmount: 0 as Cents,
};

function addCapped(a: CappedContributions, b: CappedContributions): CappedContributions {
  return {
    traditional: (a.traditional + b.traditional) as Cents,
    roth: (a.roth + b.roth) as Cents,
    catchUp: (a.catchUp + b.catchUp) as Cents,
    catchUpIsRoth: a.catchUpIsRoth || b.catchUpIsRoth,
    employerMatch: (a.employerMatch + b.employerMatch) as Cents,
    employerFlat: (a.employerFlat + b.employerFlat) as Cents,
    cappedAmount: (a.cappedAmount + b.cappedAmount) as Cents,
  };
}

/** Election percentage in year t with optional auto-escalation (never below the starting election). */
function escalated(start: number, plan: WorkplacePlan, bucket: 'traditional' | 'roth', t: number): number {
  const esc = plan.autoEscalation;
  if (!esc || esc.appliesTo !== bucket || start >= esc.capPct) return start;
  return Math.min(esc.capPct, start + esc.stepPct * (t - 1));
}

/** Indexing rate for projecting `indexed` rule values beyond published years. */
export function indexRateFor(household: Household): NominalRate {
  const indexing = household.assumptions.rules.indexing;
  return indexing.mode === 'inflation' ? household.assumptions.inflation : indexing.rate;
}

type WorkplaceYear = Omit<
  PersonPreviewRow,
  'year' | 'age' | 'compensation' | 'totalSaved' | 'savingsRate' | 'warnings'
> & {
  /** Per plan (in plan order): contributions after limits; null when a limit is unverified. */
  capped: (CappedContributions | null)[];
};

function workplaceYear(
  person: Person,
  comp: CompensationFloat,
  t: number,
  rules: ResolvedYearRules,
  priorYearFicaWages: Cents | null,
  access: RuleAccess,
  warnings: EngineWarning[],
): WorkplaceYear {
  const plans = person.workplacePlans;
  const employment = person.employment;
  let requestedTraditional = 0;
  let requestedRoth = 0;
  let total: CappedContributions | null = ZERO_CAPPED;
  let aggregated = 0;
  const planRows: PersonPreviewRow['plans'] = [];
  const capped: (CappedContributions | null)[] = [];
  let firstMatch = computeMatch(
    plans[0]?.match ?? {
      tiers: [],
      flatPctOfPay: 0,
      annualMatchCap: null,
      vesting: { kind: 'immediate' },
      yearsOfServiceAtStart: 0,
    },
    0 as Cents,
    0 as Cents,
  );

  const compLimitRule = rules.values.workplace.compensationLimit;
  const compLimit = compLimitRule.status === 'verified' ? compLimitRule.value / 100 : null;

  plans.forEach((plan, index) => {
    const bonusForDeferrals = employment?.bonusCountsForDeferrals ? comp.bonus : 0;
    if (
      t === 1 &&
      !employment?.bonusCountsForDeferrals &&
      (plan.traditionalPctOfBonus > 0 || plan.rothPctOfBonus > 0)
    ) {
      warnings.push({
        code: 'bonusDeferralIgnored',
        year: comp.year,
        personId: person.id,
        message:
          'The bonus is not eligible compensation for deferrals in this plan, so bonus deferral percentages are ignored.',
      });
    }
    // Deferral percentages apply to pay up to the compensation limit (when it is known).
    const eligible = comp.baseSalary + bonusForDeferrals;
    const scale = compLimit !== null && eligible > compLimit ? compLimit / eligible : 1;
    const salary = comp.working ? comp.baseSalary * scale : 0;
    const bonus = comp.working ? bonusForDeferrals * scale : 0;
    const trad =
      escalated(plan.traditionalPctOfSalary, plan, 'traditional', t) * salary + plan.traditionalPctOfBonus * bonus;
    const roth = escalated(plan.rothPctOfSalary, plan, 'roth', t) * salary + plan.rothPctOfBonus * bonus;
    requestedTraditional += trad;
    requestedRoth += roth;
    const matchPay = comp.working ? comp.eligibleForMatch : 0;
    const breakdown = computeMatch(plan.match, toCents(matchPay), toCents(trad + roth));
    if (index === 0) firstMatch = breakdown;
    planRows.push({
      planId: plan.id,
      requestedTraditional: toCents(trad),
      requestedRoth: toCents(roth),
      deferralRate: matchPay > 0 ? (trad + roth) / matchPay : 0,
      matchBeforeLimits: breakdown,
    });

    if (!comp.working) {
      capped.push(ZERO_CAPPED);
      return;
    }
    if (total === null) {
      capped.push(null);
      return;
    }
    const result = capContributions(
      {
        year: comp.year,
        age: comp.age,
        plan,
        requestedTraditional: toCents(trad),
        requestedRoth: toCents(roth),
        otherAggregatedDeferrals: asCents(plan.planType === '457b' ? 0 : aggregated),
        eligibleCompForMatch: toCents(matchPay),
        compensation: toCents(comp.baseSalary + comp.bonus),
        priorYearFicaWages,
      },
      rules,
    );
    if (result.status !== 'ok') {
      if (result.status === 'unverified') access.absorb(result.missing);
      total = null;
      capped.push(null);
      return;
    }
    capped.push(result.value);
    for (const w of result.warnings) warnings.push({ ...w, personId: person.id });
    if (plan.planType !== '457b') aggregated += result.value.traditional + result.value.roth;
    total = addCapped(total, result.value);
  });

  const firstPlan = plans[0];
  return {
    requestedTraditional: toCents(requestedTraditional),
    requestedRoth: toCents(requestedRoth),
    matchBeforeLimits: firstMatch,
    plans: planRows,
    contributions: total,
    capped,
    vestedFractionEndOfYear: firstPlan
      ? vestedFraction(firstPlan.match.vesting, firstPlan.match.yearsOfServiceAtStart + t)
      : 1,
  };
}

function otherIncomeFor(household: Household, year: number, t: number): { gross: number; taxable: number } {
  let gross = 0;
  let taxable = 0;
  for (const income of household.otherIncome) {
    if (year < income.startYear || (income.endYear !== null && year > income.endYear)) continue;
    // Income owned by a person stops after that person's planning age (modeled death, §1.4).
    const owner = income.ownerId === null ? null : household.people.find((p) => p.id === income.ownerId);
    if (owner && year > owner.birthYear + owner.planningAge) continue;
    const growth =
      income.growth.mode === 'flat'
        ? 1
        : income.growth.mode === 'inflation'
          ? priceIndex(household.assumptions.inflation, t)
          : Math.pow(1 + income.growth.rate, t - 1);
    const amount = (income.annualAmount / 100) * growth;
    gross += amount;
    taxable += amount * income.taxableFraction;
  }
  return { gross, taxable };
}

/** One year of the accumulation slice, shared by the preview and the projection. */
export interface AccumulationYear {
  /** Keyed by person id. */
  people: Map<string, PersonPreviewRow>;
  cashFlow: CashFlowPreviewRow;
  /** Per person and plan (plan order): contributions after limits, or null when a limit is unverified. */
  planCapped: Map<string, (CappedContributions | null)[]>;
  /** Float64 dollars for the projection (spending, gross pay and other income). */
  float: { grossPay: number; otherIncome: number; otherTaxable: number; spending: number; anyWorking: boolean };
}

export interface AccumulationSetup {
  firstYear: number;
  paths: Map<string, CompensationFloat[]>;
  access: RuleAccess;
}

export function accumulationSetup(household: Household, ctx: EngineContext, years: number): AccumulationSetup {
  const firstYear = ctx.currentYear;
  const inflation = household.assumptions.inflation;
  return {
    firstYear,
    paths: new Map(household.people.map((p) => [p.id, compensationPathFloat(p, firstYear, years, inflation)])),
    access: new RuleAccess(firstYear),
  };
}

/**
 * Income beyond pay and other income that the projection adds in accumulation years (Social Security,
 * pensions, RMDs, one-time inflows): cash, and the parts that are taxable.
 */
export interface ExtraIncome {
  cash: number;
  ordinary: number;
  socialSecurity: number;
  gains: number;
  /** Projection overrides after a death (§7.7): filing status, filer ages, spending factor. */
  filingStatus?: Household['filingStatus'];
  ages?: number[];
  spendingFactor?: number;
}

export function accumulationYear(
  household: Household,
  setup: AccumulationSetup,
  t: number,
  rules: ResolvedYearRules,
  extra: ExtraIncome = { cash: 0, ordinary: 0, socialSecurity: 0, gains: 0 },
): AccumulationYear {
  const { firstYear, paths, access } = setup;
  const inflation = household.assumptions.inflation;
  const year = firstYear + t - 1;
  const states = new Map<string, PersonYearInput>();
  const yearWarnings: EngineWarning[] = [];
  const people = new Map<string, PersonPreviewRow>();
  const planCapped = new Map<string, (CappedContributions | null)[]>();

  for (const person of household.people) {
    const comp = paths.get(person.id)?.[t - 1];
    if (!comp) continue;
    const warnings: EngineWarning[] = [];
    const prior = paths.get(person.id)?.[t - 2];
    const priorWages =
      t === 1
        ? (person.employment?.priorYearFicaWages ?? null)
        : prior
          ? toCents(prior.baseSalary + prior.bonus + prior.partTimeIncome)
          : null;
    const { capped, ...wp } = workplaceYear(person, comp, t, rules, priorWages, access, warnings);
    planCapped.set(person.id, capped);
    const totalComp = comp.baseSalary + comp.bonus + comp.partTimeIncome;
    const c = wp.contributions;
    const totalSaved = c === null ? null : c.traditional + c.roth + c.employerMatch + c.employerFlat;
    states.set(person.id, { person, comp, contributions: c });
    people.set(person.id, {
      year,
      age: comp.age,
      compensation: {
        year,
        age: comp.age,
        working: comp.working,
        baseSalary: toCents(comp.baseSalary),
        bonus: toCents(comp.bonus),
        partTimeIncome: toCents(comp.partTimeIncome),
        totalCompensation: toCents(totalComp),
        eligibleCompForDeferrals: toCents(comp.eligibleForDeferrals),
        eligibleCompForMatch: toCents(comp.eligibleForMatch),
        nominalRaise: comp.nominalRaise,
        realRaise: comp.realRaise,
      },
      ...wp,
      totalSaved: totalSaved === null ? null : asCents(totalSaved),
      savingsRate: totalSaved === null || totalComp <= 0 ? null : totalSaved / 100 / totalComp,
      warnings,
    });
    yearWarnings.push(...warnings);
  }

  // Household cash flow.
  const scheduled = scheduledContributions(household, t, year, firstYear, states, rules, access, yearWarnings);
  // Pre-tax HSA dollars must be known to estimate income tax.
  const hsaPreTax = scheduled.hsaPreTax;
  const other = otherIncomeFor(household, year, t);
  let grossPay = 0;
  let workplaceEmployee: number | null = 0;
  let preTax = 0;
  const wagesByPerson: Cents[] = [];
  const ages: number[] = [];
  let anyWorking = false;
  for (const s of states.values()) {
    const pay = s.comp.baseSalary + s.comp.bonus + s.comp.partTimeIncome;
    grossPay += pay;
    wagesByPerson.push(toCents(pay));
    ages.push(s.comp.age);
    anyWorking ||= s.comp.age < s.person.retirementAge;
    if (s.contributions === null) workplaceEmployee = null;
    else if (workplaceEmployee !== null) {
      workplaceEmployee += (s.contributions.traditional + s.contributions.roth) / 100;
      preTax += s.contributions.traditional / 100;
    }
  }
  const spendingToday = anyWorking
    ? household.spending.currentAnnualSpending
    : household.spending.retirementAnnualSpending;
  const spending = (spendingToday / 100) * priceIndex(inflation, t) * (extra.spendingFactor ?? 1);

  let taxes: TaxBreakdown | null = null;
  if (workplaceEmployee !== null && hsaPreTax !== null) {
    const taxResult = computeTax(
      {
        filingStatus: extra.filingStatus ?? household.filingStatus,
        ages: extra.ages ?? ages,
        wages: toCents(grossPay),
        wagesByPerson,
        otherOrdinaryIncome: toCents(other.taxable + extra.ordinary),
        socialSecurityBenefits: toCents(extra.socialSecurity),
        longTermCapitalGains: toCents(extra.gains),
        // SIMPLIFICATION: HSA contributions are treated as pre-tax for income tax (FICA on gross wages).
        preTaxDeductions: toCents(preTax + hsaPreTax),
        stateTaxRate: household.assumptions.stateTaxRate as Fraction,
      },
      rules,
    );
    if (taxResult.status === 'unverified') access.absorb(taxResult.missing);
    else if (taxResult.status === 'ok') taxes = taxResult.value;
  }

  const contributions =
    workplaceEmployee === null || scheduled.total === null ? null : workplaceEmployee + scheduled.total;
  const netPay = taxes === null ? null : grossPay + other.gross + extra.cash - taxes.totalTax / 100;
  const surplus = netPay === null || contributions === null ? null : netPay - contributions - spending;
  let infeasible = surplus === null || !anyWorking ? null : surplus < -0.005;
  // Without verified taxes the surplus is unknown, but taxes and contributions are never negative:
  // pay + other income below spending alone proves the year is infeasible (no rule value needed).
  const provenGap = grossPay + other.gross + extra.cash - spending;
  if (infeasible === null && anyWorking && provenGap < -0.005) {
    infeasible = true;
    yearWarnings.push({
      code: 'savingsPlanInfeasible',
      year,
      message: `In ${year}, pay and other income do not cover spending even before taxes and contributions (shortfall at least $${Math.round(-provenGap).toLocaleString('en-US')}).`,
    });
  } else if (infeasible) {
    yearWarnings.push({
      code: 'savingsPlanInfeasible',
      year,
      message: `In ${year}, estimated take-home pay does not cover the planned contributions plus spending (shortfall $${Math.round(-(surplus ?? 0)).toLocaleString('en-US')}).`,
    });
  }
  return {
    people,
    planCapped,
    float: { grossPay, otherIncome: other.gross, otherTaxable: other.taxable, spending, anyWorking },
    cashFlow: {
      year,
      grossPay: toCents(grossPay + other.gross),
      taxes,
      netPay: netPay === null ? null : toCents(netPay),
      employeeContributions: contributions === null ? null : toCents(contributions),
      spending: toCents(spending),
      surplus: surplus === null ? null : toCents(surplus),
      infeasible,
      warnings: yearWarnings,
      scheduled: scheduled.byAccount,
      rothIra: scheduled.rothIra,
    },
  };
}

/** Rules in force for projection year `year` under the household's anchor and indexing settings. */
export function rulesForYear(household: Household, ctx: EngineContext, year: number): ResolvedYearRules {
  return resolveRules(ctx.rules, {
    anchorYear: household.assumptions.rules.anchorYear,
    targetYear: year,
    indexRate: indexRateFor(household),
  });
}

export function previewAccumulation(
  household: Household,
  ctx: EngineContext,
  years: number,
): EngineResult<AccumulationPreview> {
  if (!Number.isInteger(years) || years < 1 || years > 60) {
    return { status: 'invalid', issues: [{ path: ['years'], message: 'Years must be between 1 and 60' }] };
  }
  const setup = accumulationSetup(household, ctx, years);
  const peopleRows = new Map<string, PersonPreviewRow[]>(household.people.map((p) => [p.id, []]));
  const cashFlow: CashFlowPreviewRow[] = [];
  for (let t = 1; t <= years; t++) {
    const y = accumulationYear(household, setup, t, rulesForYear(household, ctx, setup.firstYear + t - 1));
    for (const [personId, row] of y.people) peopleRows.get(personId)?.push(row);
    cashFlow.push(y.cashFlow);
  }
  const unverifiedDetails: UnverifiedDetail[] = setup.access.missing;
  return {
    status: 'ok',
    value: {
      years,
      people: household.people.map((p) => ({ personId: p.id, rows: peopleRows.get(p.id) ?? [] })),
      cashFlow,
      unverified: unverifiedDetails,
    },
    warnings: [],
  };
}
