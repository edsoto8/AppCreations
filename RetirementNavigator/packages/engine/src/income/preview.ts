/**
 * Income & Savings live preview (docs/financial-model.md §3): per-person compensation, workplace
 * elections, limits and match, scheduled IRA/HSA/taxable/cash contributions, and household
 * accumulation-phase net-pay feasibility. Always `ok`: outputs that need a null rule are null and the
 * rules are listed in `unverified`.
 */
import type { Cents, Fraction } from '../domain/primitives';
import type { Account, ContributionSchedule, Household, Person, WorkplacePlan } from '../domain/household';
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
import { compensationPathFloat, salaryStopAge, type CompensationFloat } from './compensation';
import { computeMatch, vestedFraction } from '../match/match';
import { capContributions } from '../limits/workplace';
import { estimateMagi, iraContributionLimit, rothIraEligibility } from '../limits/ira';
import { hsaLimit } from '../limits/hsa';
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

function growthFactor(schedule: ContributionSchedule, inflation: number, t: number): number {
  switch (schedule.growth.mode) {
    case 'flat':
      return 1;
    case 'inflation':
      return priceIndex(inflation, t);
    case 'rate':
      return Math.pow(1 + schedule.growth.rate, t - 1);
  }
}

/** Indexing rate for projecting `indexed` rule values beyond published years. */
export function indexRateFor(household: Household): NominalRate {
  const indexing = household.assumptions.rules.indexing;
  return indexing.mode === 'inflation' ? household.assumptions.inflation : indexing.rate;
}

interface PersonYearState {
  person: Person;
  comp: CompensationFloat;
  contributions: CappedContributions | null;
}

function workplaceYear(
  person: Person,
  comp: CompensationFloat,
  t: number,
  rules: ResolvedYearRules,
  priorYearFicaWages: Cents | null,
  access: RuleAccess,
  warnings: EngineWarning[],
): Omit<PersonPreviewRow, 'year' | 'age' | 'compensation' | 'totalSaved' | 'savingsRate' | 'warnings'> {
  const plans = person.workplacePlans;
  const employment = person.employment;
  let requestedTraditional = 0;
  let requestedRoth = 0;
  let total: CappedContributions | null = ZERO_CAPPED;
  let aggregated = 0;
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
        code: 'deferralCapped',
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

    if (!comp.working || total === null) return;
    const result = capContributions(
      {
        year: comp.year,
        age: comp.age,
        plan,
        requestedTraditional: toCents(trad),
        requestedRoth: toCents(roth),
        otherAggregatedDeferrals: asCents(plan.planType === '457b' ? 0 : aggregated),
        eligibleCompForMatch: toCents(matchPay),
        priorYearFicaWages,
      },
      rules,
    );
    if (result.status !== 'ok') {
      if (result.status === 'unverified') access.absorb(result.missing);
      total = null;
      return;
    }
    for (const w of result.warnings) warnings.push({ ...w, personId: person.id });
    if (plan.planType !== '457b') aggregated += result.value.traditional + result.value.roth;
    total = addCapped(total, result.value);
  });

  const firstPlan = plans[0];
  return {
    requestedTraditional: toCents(requestedTraditional),
    requestedRoth: toCents(requestedRoth),
    matchBeforeLimits: firstMatch,
    contributions: total,
    vestedFractionEndOfYear: firstPlan
      ? vestedFraction(firstPlan.match.vesting, firstPlan.match.yearsOfServiceAtStart + t)
      : 1,
  };
}

/** Last year (inclusive) a non-workplace schedule contributes: its stop year, else the owner's last working year. */
function scheduleActive(schedule: ContributionSchedule, owner: Person, year: number, firstYear: number): boolean {
  const start = schedule.startYear ?? firstYear;
  const stop = schedule.stopYear ?? owner.birthYear + salaryStopAge(owner) - 1;
  return year >= start && year <= stop;
}

interface ScheduledResult {
  /** Total scheduled contributions this year, or null if a needed limit is unverified. */
  total: number | null;
  hsaPreTax: number;
}

function scheduledContributions(
  household: Household,
  t: number,
  year: number,
  firstYear: number,
  people: Map<string, PersonYearState>,
  rules: ResolvedYearRules,
  access: RuleAccess,
  warnings: EngineWarning[],
): ScheduledResult {
  const inflation = household.assumptions.inflation;
  let total = 0;
  let hsaPreTax = 0;
  let unknown = false;
  const iraRoom = new Map<string, { initial: number; remaining: number } | null>();

  const householdMagi = (): number => {
    let magi = 0;
    for (const s of people.values()) {
      magi += estimateMagi({
        salary: toCents(s.comp.baseSalary),
        bonus: toCents(s.comp.bonus),
        traditionalDeferrals: s.contributions?.traditional ?? (0 as Cents),
        hsaContributions: 0 as Cents,
        otherIncome: toCents(s.comp.partTimeIncome),
      });
    }
    return magi;
  };

  for (const account of household.accounts) {
    if (account.type === 'workplaceTraditional' || account.type === 'workplaceRoth') continue;
    const schedule = account.contribution;
    const state = people.get(account.ownerId);
    if (!schedule || !state || !scheduleActive(schedule, state.person, year, firstYear)) continue;
    const comp = state.comp;
    const earned = comp.baseSalary + comp.bonus + comp.partTimeIncome;

    let wanted: number | 'max';
    if (schedule.amount.kind === 'dollars') {
      wanted =
        (schedule.amount.amount / 100) *
        (schedule.amount.frequency === 'monthly' ? 12 : 1) *
        growthFactor(schedule, inflation, t);
    } else if (schedule.amount.kind === 'percentOfSalary') {
      wanted = schedule.amount.pct * comp.baseSalary;
    } else {
      wanted = 'max';
    }

    const amount = limitAccount(
      account,
      wanted,
      comp.age,
      earned,
      household,
      rules,
      access,
      warnings,
      iraRoom,
      householdMagi,
      year,
    );
    if (amount === null) {
      unknown = true;
      continue;
    }
    total += amount;
    if (account.type === 'hsa') hsaPreTax += amount;
  }
  return { total: unknown ? null : total, hsaPreTax };
}

function limitAccount(
  account: Exclude<Account, { type: 'workplaceTraditional' | 'workplaceRoth' }>,
  wanted: number | 'max',
  age: number,
  earned: number,
  household: Household,
  rules: ResolvedYearRules,
  access: RuleAccess,
  warnings: EngineWarning[],
  iraRoom: Map<string, { initial: number; remaining: number } | null>,
  householdMagi: () => number,
  year: number,
): number | null {
  const owner = account.ownerId;
  if (account.type === 'traditionalIra' || account.type === 'rothIra') {
    // Traditional and Roth IRAs share one annual limit per person, capped at earned income.
    if (!iraRoom.has(owner)) {
      const limit = iraContributionLimit(age, rules, access);
      const initial = limit === null ? null : Math.min(limit / 100, earned);
      iraRoom.set(owner, initial === null ? null : { initial, remaining: initial });
    }
    const roomState = iraRoom.get(owner) ?? null;
    if (roomState === null) return null;
    const room = roomState.remaining;
    let cap = room;
    if (account.type === 'rothIra') {
      const magi = account.magiOverride ?? (householdMagi() as Cents);
      const roth = rothIraEligibility(
        {
          magi: magi as Cents,
          filingStatus: household.filingStatus,
          age,
          earnedIncome: toCents(earned),
          // Earlier IRA contributions this year share the limit (the reduced Roth limit is net of them).
          otherIraContributions: toCents(roomState.initial - roomState.remaining),
        },
        rules,
      );
      if (roth.status !== 'ok') {
        if (roth.status === 'unverified') access.absorb(roth.missing);
        return null;
      }
      cap = Math.min(room, roth.value.allowed / 100);
      for (const w of roth.warnings) warnings.push({ ...w, accountId: account.id });
    }
    const amount = wanted === 'max' ? cap : Math.min(wanted, cap);
    if (wanted !== 'max' && wanted > cap + 0.005) {
      warnings.push({
        code: 'iraCapped',
        year,
        accountId: account.id,
        message: `${account.name}: contribution capped at the allowed $${Math.round(cap).toLocaleString('en-US')}.`,
      });
    }
    roomState.remaining = room - amount;
    return amount;
  }
  if (account.type === 'hsa') {
    const limit = hsaLimit({ coverage: account.coverage, age, hdhpAttested: account.hdhpAttested }, rules);
    if (limit.status !== 'ok') {
      if (limit.status === 'unverified') access.absorb(limit.missing);
      return null;
    }
    for (const w of limit.warnings) warnings.push({ ...w, accountId: account.id });
    const cap = limit.value / 100;
    if (wanted !== 'max' && wanted > cap + 0.005) {
      warnings.push({
        code: 'hsaCapped',
        year,
        accountId: account.id,
        message: `${account.name}: contribution capped at the $${Math.round(cap).toLocaleString('en-US')} HSA limit.`,
      });
    }
    return wanted === 'max' ? cap : Math.min(wanted, cap);
  }
  // Taxable, cash and other accounts have no contribution limit; "max" has no meaning there.
  return wanted === 'max' ? 0 : wanted;
}

function otherIncomeFor(household: Household, year: number, t: number): { gross: number; taxable: number } {
  let gross = 0;
  let taxable = 0;
  for (const income of household.otherIncome) {
    if (year < income.startYear || (income.endYear !== null && year > income.endYear)) continue;
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

export function previewAccumulation(
  household: Household,
  ctx: EngineContext,
  years: number,
): EngineResult<AccumulationPreview> {
  if (!Number.isInteger(years) || years < 1 || years > 60) {
    return { status: 'invalid', issues: [{ path: ['years'], message: 'Years must be between 1 and 60' }] };
  }
  const firstYear = ctx.currentYear;
  const inflation = household.assumptions.inflation;
  const access = new RuleAccess(firstYear);
  const paths = new Map(household.people.map((p) => [p.id, compensationPathFloat(p, firstYear, years, inflation)]));
  const peopleRows = new Map<string, PersonPreviewRow[]>(household.people.map((p) => [p.id, []]));
  const cashFlow: CashFlowPreviewRow[] = [];

  for (let t = 1; t <= years; t++) {
    const year = firstYear + t - 1;
    const rules = resolveRules(ctx.rules, {
      anchorYear: household.assumptions.rules.anchorYear,
      targetYear: year,
      indexRate: indexRateFor(household),
    });
    const states = new Map<string, PersonYearState>();
    const yearWarnings: EngineWarning[] = [];

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
      const wp = workplaceYear(person, comp, t, rules, priorWages, access, warnings);
      const totalComp = comp.baseSalary + comp.bonus + comp.partTimeIncome;
      const c = wp.contributions;
      const totalSaved = c === null ? null : c.traditional + c.roth + c.employerMatch + c.employerFlat;
      states.set(person.id, { person, comp, contributions: c });
      peopleRows.get(person.id)?.push({
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
    const spending = (spendingToday / 100) * priceIndex(inflation, t);

    let taxes: TaxBreakdown | null = null;
    if (workplaceEmployee !== null) {
      const taxResult = computeTax(
        {
          filingStatus: household.filingStatus,
          ages,
          wages: toCents(grossPay),
          wagesByPerson,
          otherOrdinaryIncome: toCents(other.taxable),
          socialSecurityBenefits: 0 as Cents,
          longTermCapitalGains: 0 as Cents,
          // SIMPLIFICATION: HSA contributions are treated as pre-tax for income tax (FICA on gross wages).
          preTaxDeductions: toCents(preTax + scheduled.hsaPreTax),
          stateTaxRate: household.assumptions.stateTaxRate as Fraction,
        },
        rules,
      );
      if (taxResult.status === 'unverified') access.absorb(taxResult.missing);
      else if (taxResult.status === 'ok') taxes = taxResult.value;
    }

    const contributions =
      workplaceEmployee === null || scheduled.total === null ? null : workplaceEmployee + scheduled.total;
    const netPay = taxes === null ? null : grossPay + other.gross - taxes.totalTax / 100;
    const surplus = netPay === null || contributions === null ? null : netPay - contributions - spending;
    const infeasible = surplus === null || !anyWorking ? null : surplus < -0.005;
    if (infeasible) {
      yearWarnings.push({
        code: 'savingsPlanInfeasible',
        year,
        message: `In ${year}, estimated take-home pay does not cover the planned contributions plus spending (shortfall $${Math.round(-(surplus ?? 0)).toLocaleString('en-US')}).`,
      });
    }
    cashFlow.push({
      year,
      grossPay: toCents(grossPay + other.gross),
      taxes,
      netPay: netPay === null ? null : toCents(netPay),
      employeeContributions: contributions === null ? null : toCents(contributions),
      spending: toCents(spending),
      surplus: surplus === null ? null : toCents(surplus),
      infeasible,
      warnings: yearWarnings,
    });
  }

  const unverifiedDetails: UnverifiedDetail[] = access.missing;
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
