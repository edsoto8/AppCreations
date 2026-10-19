/**
 * Deterministic projection (docs/financial-model.md §1, §3–7). Year by year from the injected current
 * year through the longer-lived person's planning age.
 *
 * Accumulation years reuse the Income & Savings slice (`accumulationYear`): compensation, elections,
 * limits, match, scheduled contributions and net-pay feasibility. When a limit is unverified, the
 * step is excluded and contributions are as elected (before limits); the feature is listed in
 * `excludedFeatures`. Taxes and net pay that need a null rule are null, never filled in.
 *
 * Every year first collects the income that does not depend on the phase (Social Security, pensions,
 * one-time events, RMDs). Retirement-phase years then fund the spending need (§5) with withdrawals
 * in the strategy's order, grossed up for taxes by the solver when the tax rules are verified, and
 * before taxes (labeled) when they are not (§1.7, §7.1).
 */
import type { Account, Household, Person, WorkplacePlan } from '../domain/household';
import type { CappedContributions, EngineContext, ProjectionOptions, TaxBreakdown } from '../api';
import type { EngineResult, EngineWarning } from '../domain/results';
import type { AccountYear, PersonYear, ProjectionResult, TaxYearDetail, YearRow } from '../domain/projection';
import type { Cents, Fraction } from '../domain/primitives';
import { CONTRACT_VERSION } from '../contractVersion';
import { HouseholdSchema } from '../domain/household';
import { zodIssues } from '../validation';
import { asCents, formatWholeDollars, toCents } from '../money';
import { vestedFraction } from '../match/match';
import {
  accumulationSetup,
  accumulationYear,
  rulesForYear,
  type AccumulationSetup,
  type AccumulationYear,
  type ExtraIncome,
} from '../income/preview';
import { solveWithdrawals, type SolverAccount } from '../tax/grossUp';
import { computeTax } from '../tax/tax';
import { RuleAccess } from '../rules/access';
import { rothQualifiedYear } from '../rmd/roth';
import {
  Gaps,
  eventsYear,
  isTaxDeferred,
  pensionYear,
  reinvestAccount,
  rmdFor,
  socialSecuritySetup,
  socialSecurityYear,
  spendingNeed as spendingNeedFor,
  type YearContext,
} from './retirement';
import {
  WITHDRAWAL_ORDER,
  allocateWithdrawals,
  endBalance,
  growthFactors,
  taxTreatmentOf,
  withdrawalCap,
  withdrawalCategoryOf,
  type GrowthFactors,
} from './accounts';

interface AccountState {
  account: Account;
  balance: number;
  /** Taxable: cost basis. Roth IRA: contribution basis. Otherwise 0. */
  basis: number;
  /** Unvested employer money (workplace accounts), part of `balance`. */
  unvested: number;
  /** The plan whose employer money lands here (vesting rule), if any. */
  plan: { plan: WorkplacePlan; owner: Person } | null;
}

const usd = formatWholeDollars;

function baseReturn(household: Household, account: Account, retirementPhase: boolean): number {
  if (account.expectedReturn !== null) return account.expectedReturn;
  if (account.allocation) {
    const cma = household.assumptions.capitalMarket;
    const a = account.allocation;
    return (
      a.stocks * cma.stocks.geometricReturn + a.bonds * cma.bonds.geometricReturn + a.cash * cma.cash.geometricReturn
    );
  }
  return retirementPhase ? household.assumptions.returnPostRetirement : household.assumptions.returnPreRetirement;
}

function isTaxableForDrag(account: Account): boolean {
  return account.type === 'taxableBrokerage' || (account.type === 'other' && account.taxTreatment === 'taxable');
}

function taxDetail(
  filingStatus: Household['filingStatus'],
  taxes: TaxBreakdown,
  wages: Cents,
  gains: Cents,
  solver: { iterations: number; converged: boolean } = { iterations: 0, converged: true },
): TaxYearDetail {
  return {
    filingStatus,
    wages,
    // AGI = ordinary income (incl. taxable SS) + long-term gains.
    ordinaryIncome: asCents(taxes.agi - gains),
    taxableSocialSecurity: taxes.taxableSocialSecurity,
    capitalGains: gains,
    agi: taxes.agi,
    deductions: taxes.deductions,
    taxableIncome: taxes.taxableOrdinaryIncome,
    federalOrdinaryTax: taxes.federalOrdinaryTax,
    capitalGainsTax: taxes.capitalGainsTax,
    ficaSocialSecurity: taxes.ficaSocialSecurity,
    ficaMedicare: taxes.ficaMedicare,
    stateTax: taxes.stateTax,
    totalTax: taxes.totalTax,
    marginalOrdinaryRate: taxes.marginalOrdinaryRate,
    solver,
  };
}

/**
 * Bracket fill (§7.3): how much traditional money fits before taxable ordinary income reaches the top
 * of the bracket taxed at `topRate`, at the year's fixed income. Null when brackets are unverified or
 * no rate is set (the strategy then falls back to taxable first).
 */
function bracketRoom(
  input: Parameters<typeof solveWithdrawals>[0],
  rules: Parameters<typeof solveWithdrawals>[1],
  topRate: number | null,
  gaps: Gaps,
): number | null {
  if (topRate === null) return null;
  const bracketsRule = rules.values.tax.brackets[input.filingStatus];
  if (bracketsRule.status !== 'verified') return null;
  const brackets = bracketsRule.value;
  const i = brackets.findIndex((b) => Math.abs(b.rate - topRate) < 1e-9);
  if (i < 0) return null;
  const top = brackets[i + 1]?.lowerBound;
  if (top === undefined) return Number.POSITIVE_INFINITY;
  const base = gaps.take(
    computeTax(
      {
        filingStatus: input.filingStatus,
        ages: input.ages,
        wages: toCents(input.wages),
        wagesByPerson: input.wagesByPerson.map(toCents),
        otherOrdinaryIncome: toCents(input.ordinary),
        socialSecurityBenefits: toCents(input.socialSecurity),
        longTermCapitalGains: toCents(input.gains),
        preTaxDeductions: 0 as Cents,
        stateTaxRate: input.stateTaxRate as Fraction,
      },
      rules,
    ),
  );
  if (base === null) return null;
  // Room = top + deductions − ordinary income already counted (incl. taxable SS at the fixed income);
  // ordinary income = AGI − gains, so unused deductions add room.
  const ordinaryCounted = base.agi / 100 - input.gains;
  return Math.max(0, top / 100 + base.deductions / 100 - ordinaryCounted);
}

/**
 * Return-independent work shared by many projections of one household and context (Monte Carlo
 * paths): the validated household, the accumulation setup and each year's accumulation result for
 * the same inputs. Internal: not part of the frozen API.
 */
export interface ProjectionCache {
  household: Household | null;
  setup: AccumulationSetup | null;
  years: Map<string, AccumulationYear>;
}

export function createProjectionCache(): ProjectionCache {
  return { household: null, setup: null, years: new Map() };
}

function cachedAccumulationYear(
  cache: ProjectionCache | null,
  household: Household,
  setup: AccumulationSetup,
  t: number,
  rules: ReturnType<typeof rulesForYear>,
  extra: ExtraIncome,
): AccumulationYear {
  if (!cache) return accumulationYear(household, setup, t, rules, extra);
  // Every input that varies by path is in the key (RMD and event income can depend on balances).
  const key = `${t}|${extra.cash}|${extra.ordinary}|${extra.socialSecurity}|${extra.gains}|${extra.filingStatus}|${extra.ages?.join(',')}|${extra.spendingFactor}`;
  const hit = cache.years.get(key);
  if (hit) return hit;
  const result = accumulationYear(household, setup, t, rules, extra);
  // Bounded: years whose income varies by path (RMDs while working) are not worth keeping forever.
  if (cache.years.size < 20_000) cache.years.set(key, result);
  return result;
}

export function projectHousehold(
  input: Household,
  ctx: EngineContext,
  options: ProjectionOptions = {},
): EngineResult<ProjectionResult> {
  return projectWithCache(input, ctx, options, null);
}

/** `projectHousehold` sharing return-independent work through `cache` (same household and ctx). */
export function projectWithCache(
  input: Household,
  ctx: EngineContext,
  options: ProjectionOptions,
  cache: ProjectionCache | null,
): EngineResult<ProjectionResult> {
  let household: Household;
  if (cache?.household) {
    household = cache.household;
  } else {
    const parsed = HouseholdSchema.safeParse(input);
    if (!parsed.success) return { status: 'invalid', issues: zodIssues(parsed.error) };
    household = parsed.data;
    if (cache) cache.household = household;
  }
  const firstYear = ctx.currentYear;
  const lastYear = Math.max(...household.people.map((p) => p.birthYear + p.planningAge));
  if (lastYear < firstYear) {
    return {
      status: 'invalid',
      issues: [{ path: ['people'], message: 'Everyone is past their planning age in the current year' }],
    };
  }
  const years = lastYear - firstYear + 1;
  const a = household.assumptions;
  const offset = options.returnOffset ?? 0;
  const setup = cache?.setup ?? accumulationSetup(household, ctx, years);
  if (cache) cache.setup = setup;
  const warnings: EngineWarning[] = [];

  // Account state (float64 dollars).
  const states = new Map<string, AccountState>();
  for (const account of household.accounts) {
    states.set(account.id, {
      account,
      balance: account.balance / 100,
      basis:
        account.type === 'taxableBrokerage'
          ? account.costBasis / 100
          : account.type === 'rothIra'
            ? account.contributionBasis / 100
            : 0,
      unvested: 0,
      plan: null,
    });
  }
  for (const person of household.people) {
    for (const plan of person.workplacePlans) {
      const dest =
        plan.matchDestination === 'roth' && plan.rothAccountId ? plan.rothAccountId : plan.traditionalAccountId;
      const state = states.get(dest);
      if (state) state.plan = { plan, owner: person };
    }
  }
  // The sub-ledger holds employer money still subject to vesting. The entered
  // `unvestedEmployerBalance` is the part not yet vested today, U0 = E0·(1 − v0), so E0 = U0/(1 − v0)
  // (§4). An unvested amount on an account with no linked plan, or with a fully vested plan, is kept.
  for (const state of states.values()) {
    const account = state.account;
    if (account.type !== 'workplaceTraditional' && account.type !== 'workplaceRoth') continue;
    const entered = Math.min(account.unvestedEmployerBalance, account.balance) / 100;
    if (entered <= 0) continue;
    const match = state.plan?.plan.match;
    const v0 = match ? vestedFraction(match.vesting, match.yearsOfServiceAtStart) : 1;
    if (v0 < 1) {
      state.unvested = entered / (1 - v0);
    } else {
      warnings.push({
        code: 'featureNotModeled',
        message: `${account.name}: the unvested employer balance is not forfeited, because no plan with an unvested schedule sends employer money to this account.`,
      });
    }
  }
  /** Projection years each person has worked so far (years of service accrue per working year). */
  const yearsWorked = new Map(household.people.map((p) => [p.id, 0]));
  const separated = new Set<string>();

  const bracketFill = a.withdrawalStrategy === 'bracketFill';
  // Bracket fill fills traditional first (up to the bracket room), then taxable first (§7.3).
  const order = WITHDRAWAL_ORDER[a.withdrawalStrategy === 'bracketFill' ? 'taxableFirst' : a.withdrawalStrategy];
  let bracketFillFellBack = false;
  const categories = household.accounts.map((acc) => ({ id: acc.id, category: withdrawalCategoryOf(acc) }));
  const gaps = new Gaps();
  const ss = socialSecuritySetup(household, ctx.rules, firstYear, gaps);
  warnings.push(...ss.warnings);
  const standingAccess = new RuleAccess('standing');
  const roth401kRmd = household.accounts.some((acc) => acc.type === 'workplaceRoth')
    ? standingAccess.get(ctx.rules.standing.rmd.roth401kLifetimeRmdRequired, 'rmd.roth401kLifetimeRmdRequired', 'rmd')
    : false;
  /** Price level by calendar year (filled as the loop advances; years before year 1 use 1). */
  const deflators = new Map<number, number>();
  /** Price level of a past or current projection year (years before year 1 count as year 1). */
  const deflatorAt = (y: number) => deflators.get(Math.max(y, firstYear)) ?? 1;
  const warnedOnce = new Set<string>();
  const warnOnce = (key: string, w: EngineWarning) => {
    if (warnedOnce.has(key)) return;
    warnedOnce.add(key);
    warnings.push(w);
  };

  const rows: YearRow[] = [];
  let deflator = 1;
  let retirementYear: number | null = null;
  let firstDeathYear: number | null = null;
  let depletionYear: number | null = null;
  const infeasibleYears: number[] = [];
  const shock = a.marketShock;

  // Retiring before Medicare age (65, a statutory constant listed in rules-verification.md): the
  // only healthcare cost before 65 is the user-entered line, so say so on every forecast (brief §1).
  const early = household.people.filter((p) => p.retirementAge < 65 && p.planningAge >= p.retirementAge);
  if (early.length > 0) {
    const line = household.spending.healthcareBeforeMedicare / 100;
    warnings.push({
      code: 'healthcarePreMedicareUserEntered',
      year: firstYear,
      message:
        `${early.map((p) => p.name).join(' and ')} ${early.length > 1 ? 'retire' : 'retires'} before 65. ` +
        (line > 0
          ? `Healthcare before Medicare is only the ${usd(line)} a year you entered (today’s dollars); nothing else is modeled.`
          : 'Healthcare before Medicare is not in the plan: the pre-Medicare healthcare line is $0.'),
    });
  }

  for (let t = 1; t <= years; t++) {
    const year = firstYear + t - 1;
    if (t > 1) {
      // SIMPLIFICATION: an inflation override (Monte Carlo) drives the deflator and what is priced from
      // it: retirement spending, Social Security COLA and inflation-linked pensions. Pay, working-years
      // spending, schedules and rule indexing use the inflation assumption (docs §11). If that ever
      // changes, the deflator must join the accumulation cache key (cachedAccumulationYear).
      const i = options.inflationOverride?.(t) ?? a.inflation;
      if (!Number.isFinite(i) || i <= -1) {
        return {
          status: 'invalid',
          issues: [{ path: ['options', 'inflationOverride'], message: 'Inflation must be above −100%' }],
        };
      }
      deflator *= 1 + i;
    }
    deflators.set(year, deflator);
    const rules = rulesForYear(household, ctx, year);
    const alive = (p: Person) => year <= p.birthYear + p.planningAge;
    if (firstDeathYear === null && household.people.some((p) => !alive(p))) firstDeathYear = year;
    const pre: YearContext = {
      household,
      year,
      t,
      deflator,
      alive,
      retired: () => false,
      retirementPhase: false,
      firstRetirementYear: retirementYear,
      firstDeathYear,
    };
    // Income that does not depend on the phase (§7.1 step 2): SS, pensions, one-time events.
    const ssPaid = socialSecurityYear(pre, ss, ctx.rules.standing, gaps);
    const ssTotal = [...ssPaid.values()].reduce((x, y) => x + y, 0);
    const pensions = pensionYear(pre, deflatorAt);
    const events = eventsYear(pre);
    // RMDs (§7.1 step 3) on the start-of-year balance.
    const rmd = new Map<string, number>();
    for (const state of states.values()) {
      const amount = rmdFor(pre, state.account, state.balance, ctx.rules.standing, gaps, roth401kRmd);
      if (amount > 0) rmd.set(state.account.id, amount);
    }
    const rmdTotal = [...rmd.values()].reduce((x, y) => x + y, 0);
    const inflowOrdinary =
      events.inflows.reduce((x, e) => x + e.ordinary, 0) + pensions.lumpSums.reduce((x, l) => x + l.taxable, 0);
    const inflowGains = events.inflows.reduce((x, e) => x + e.gains, 0);
    // Filing (§7.7): MFJ through the first death year, single after. Filers are the living plus anyone
    // who died at the start of this year (a joint return for the year of death).
    const filingStatus: Household['filingStatus'] =
      household.filingStatus === 'marriedFilingJointly' && (firstDeathYear === null || year <= firstDeathYear)
        ? 'marriedFilingJointly'
        : 'single';
    const filerAges = household.people
      .filter((p) => alive(p) || year === p.birthYear + p.planningAge + 1)
      .filter((p) => filingStatus === 'marriedFilingJointly' || alive(p))
      .map((p) => year - p.birthYear);
    const survivorFactor =
      household.people.length > 1 && firstDeathYear !== null && year >= firstDeathYear
        ? 1 - household.spending.survivorSpendingReduction
        : 1;
    const acc = cachedAccumulationYear(cache, household, setup, t, rules, {
      cash: ssTotal + pensions.annuity,
      ordinary: pensions.taxable + rmdTotal + inflowOrdinary,
      socialSecurity: ssTotal,
      gains: inflowGains,
      filingStatus,
      ages: filerAges,
      spendingFactor: survivorFactor,
    });
    for (const w of acc.cashFlow.warnings) warnings.push(w);

    // Retired = at or past the retirement age and drawing no salary (a stop age after the retirement
    // age keeps the person working, so the household stays in the accumulation phase).
    const retired = (p: Person) =>
      year - p.birthYear >= p.retirementAge && !(acc.people.get(p.id)?.compensation.working ?? false);
    const retirementPhase = household.people.every((p) => !alive(p) || retired(p));
    if (retirementPhase && retirementYear === null) retirementYear = year;
    const markers: YearRow['markers'] = [];
    if (retirementYear === year) markers.push('retirement');
    if (firstDeathYear === year) markers.push('firstDeath');
    const c: YearContext = { ...pre, retired, retirementPhase, firstRetirementYear: retirementYear };

    // ---- Contributions per account (dollars) ---------------------------------------------------
    const contrib = new Map<string, number>();
    const employer = new Map<string, number>();
    const add = (map: Map<string, number>, id: string | null, amount: number) => {
      if (id === null || amount === 0) return;
      map.set(id, (map.get(id) ?? 0) + amount);
    };
    const personYears: PersonYear[] = [];
    for (const person of household.people) {
      const row = acc.people.get(person.id);
      if (!row) continue;
      const capped = acc.planCapped.get(person.id) ?? [];
      let trad = 0;
      let roth = 0;
      let catchUp = 0;
      let match = 0;
      let flat = 0;
      person.workplacePlans.forEach((plan, i) => {
        const c: CappedContributions | null = capped[i] ?? null;
        const pr = row.plans[i];
        // Before limits (unverified): the elected amounts and the match on them.
        const pt = c ? c.traditional / 100 : (pr?.requestedTraditional ?? 0) / 100;
        const pRoth = c ? c.roth / 100 : (pr?.requestedRoth ?? 0) / 100;
        const pm = c ? c.employerMatch / 100 : (pr?.matchBeforeLimits.match ?? 0) / 100;
        const pf = c ? c.employerFlat / 100 : (pr?.matchBeforeLimits.flat ?? 0) / 100;
        trad += pt;
        roth += pRoth;
        catchUp += c ? c.catchUp / 100 : 0;
        match += pm;
        flat += pf;
        add(contrib, plan.traditionalAccountId, pt);
        add(contrib, plan.rothAccountId ?? plan.traditionalAccountId, pRoth);
        const dest =
          plan.matchDestination === 'roth' && plan.rothAccountId ? plan.rothAccountId : plan.traditionalAccountId;
        add(contrib, dest, pm + pf);
        add(employer, dest, pm + pf);
      });
      const comp = row.compensation;
      personYears.push({
        personId: person.id as PersonYear['personId'],
        age: row.age,
        alive: alive(person),
        retired: retired(person),
        baseSalary: comp.baseSalary,
        bonus: comp.bonus,
        partTimeIncome: comp.partTimeIncome,
        totalCompensation: comp.totalCompensation,
        eligibleCompForDeferrals: comp.eligibleCompForDeferrals,
        eligibleCompForMatch: comp.eligibleCompForMatch,
        nominalRaise: comp.nominalRaise,
        realRaise: comp.realRaise,
        employeeTraditional: toCents(trad),
        employeeRoth: toCents(roth),
        catchUp: toCents(catchUp),
        employerMatch: toCents(match),
        employerFlat: toCents(flat),
        socialSecurity: toCents(ssPaid.get(person.id) ?? 0),
        pension: toCents(pensions.byPerson.get(person.id) ?? 0),
      });
    }
    let workplaceEmployee = 0;
    for (const p of personYears) workplaceEmployee += (p.employeeTraditional + p.employeeRoth) / 100;

    // Scheduled (IRA/HSA/taxable/cash/other): allowed after limits, or as elected when unverified.
    const scheduled = new Map<string, number>();
    for (const s of acc.cashFlow.scheduled) {
      const amount = s.allowed !== null ? s.allowed / 100 : s.requested !== null ? s.requested / 100 : 0;
      if (amount > 0) scheduled.set(s.accountId, amount);
    }
    let scheduledTotal = [...scheduled.values()].reduce((x, y) => x + y, 0);

    const spendingNeed = spendingNeedFor(c);
    const earned = acc.float.grossPay;
    const otherIncome = acc.float.otherIncome;
    // Cash income this year (gross): pay, other income, SS and pension annuities.
    const fixedCash = earned + otherIncome + ssTotal + pensions.annuity;

    // Retirement phase: contributions are funded only from cash income left after spending.
    if (retirementPhase && scheduledTotal > 0) {
      const leftover = Math.max(0, fixedCash - spendingNeed - events.outflow);
      if (leftover < scheduledTotal - 0.005) {
        const k = leftover / scheduledTotal;
        // Contribution amounts are whole cents (§1.3); scaled amounts round down so they never
        // exceed the income left over.
        for (const [id, v] of scheduled) scheduled.set(id, Math.floor(v * k * 100 + 1e-9) / 100);
        warnings.push({
          code: 'retirementContributionsReduced',
          year,
          message: `In ${year}, scheduled contributions are reduced to ${usd(leftover)}: in retirement they are funded only from earned and other income left after spending.`,
        });
        scheduledTotal = [...scheduled.values()].reduce((x, y) => x + y, 0);
      }
    }
    for (const [id, v] of scheduled) add(contrib, id, v);

    // Deposits at mid-year: lump-sum pensions and one-time inflows (§7.6).
    let inflowTotal = 0;
    for (const lump of pensions.lumpSums) {
      add(contrib, lump.accountId, lump.amount);
      inflowTotal += lump.amount;
    }
    for (const e of events.inflows) {
      inflowTotal += e.amount;
      if (e.accountId === null) {
        warnings.push({
          code: 'oneTimeInflowSpent',
          year,
          message: `In ${year}, a one-time inflow of ${usd(e.amount)} has no account to go to, so it is treated as spent.`,
        });
        continue;
      }
      add(contrib, e.accountId, e.amount);
      // A taxable deposit adds basis equal to the full amount (its gain is realized in the event).
    }

    // Accumulation-phase surplus routing (needs net pay, i.e. verified taxes).
    let surplusRouted = 0;
    const surplus = acc.cashFlow.surplus;
    if (!retirementPhase && surplus !== null && surplus > 0 && a.surplus.mode === 'account') {
      surplusRouted = surplus / 100;
      add(contrib, a.surplus.accountId, surplusRouted);
    }
    if (!retirementPhase && acc.cashFlow.infeasible) infeasibleYears.push(year);

    // ---- Separation: forfeit unvested employer money -------------------------------------------
    const forfeited = new Map<string, number>();
    for (const person of household.people) {
      const working = acc.people.get(person.id)?.compensation.working ?? false;
      if (working) {
        yearsWorked.set(person.id, (yearsWorked.get(person.id) ?? 0) + 1);
        continue;
      }
      if (separated.has(person.id)) continue;
      separated.add(person.id);
      for (const state of states.values()) {
        if (!state.plan || state.plan.owner.id !== person.id || state.unvested <= 0) continue;
        const match = state.plan.plan.match;
        const yos = match.yearsOfServiceAtStart + (yearsWorked.get(person.id) ?? 0);
        const lost = Math.min(state.balance, state.unvested * (1 - vestedFraction(match.vesting, yos)));
        if (lost > 0) forfeited.set(state.account.id, lost);
        state.unvested = 0;
      }
    }

    // ---- Rates and withdrawal caps -------------------------------------------------------------
    const factors = new Map<string, { net: GrowthFactors; gross: GrowthFactors; r: number }>();
    const caps = new Map<string, number>();
    for (const state of states.values()) {
      const account = state.account;
      const override = options.returnOverride?.(t, account.id);
      const shocked = shock && year >= shock.startYear && year < shock.startYear + shock.returns.length;
      let r =
        override ??
        (shocked ? (shock.returns[year - shock.startYear] ?? 0) : baseReturn(household, account, retirementPhase)) +
          offset;
      r = Math.max(r, -0.99);
      let rho = (1 + r) * (1 - account.expenseRatio) - 1 - (isTaxableForDrag(account) ? a.taxableAccountTaxDrag : 0);
      rho = Math.max(rho, -0.99);
      const net = growthFactors(rho, a.withdrawalTiming, a.granularity);
      factors.set(account.id, { net, gross: growthFactors(r, a.withdrawalTiming, a.granularity), r });
      const start = state.balance - (forfeited.get(account.id) ?? 0);
      caps.set(account.id, withdrawalCap(start, contrib.get(account.id) ?? 0, net));
    }

    // ---- Withdrawals: RMDs, HSA medical, then the need (§7.1–7.3) -----------------------------
    const withdrawals = new Map<string, number>();
    // Caps before any withdrawal: the basis and gain fractions use the year's full available balance.
    const capsAtStart = new Map(caps);
    const take = (id: string, amount: number) => {
      if (amount <= 0) return;
      withdrawals.set(id, (withdrawals.get(id) ?? 0) + amount);
      caps.set(id, Math.max(0, (caps.get(id) ?? 0) - amount));
    };
    let rmdTaken = 0;
    for (const [id, amount] of rmd) {
      const x = Math.min(amount, caps.get(id) ?? 0);
      take(id, x);
      rmdTaken += x;
    }
    const outflow = events.outflow;
    const need = retirementPhase ? spendingNeed + outflow + scheduledTotal : outflow;
    // HSA medical (retirement phase): tax-free, up to the medical expenses and the remaining need.
    let hsaMedical = 0;
    const hsaMedicalBy = new Map<string, number>();
    if (retirementPhase) {
      const medical = (household.spending.hsaQualifiedMedicalExpenses / 100) * deflator;
      const room = Math.max(0, Math.min(medical, need - fixedCash - rmdTaken));
      if (room > 0) {
        const hsas = household.accounts
          .filter((acct) => acct.type === 'hsa')
          .map((acct) => ({ id: acct.id, category: 'hsa' as const }));
        const got = allocateWithdrawals(room, hsas, caps, [['hsa']]);
        for (const [id, w] of got.byAccount) {
          take(id, w);
          hsaMedical += w;
          hsaMedicalBy.set(id, w);
        }
      }
    }
    const cashBefore = retirementPhase ? fixedCash + rmdTaken + hsaMedical : 0;
    let unfunded: number;
    let excess: number;
    let solved: ReturnType<typeof solveWithdrawals> | null = null;
    let yearFiling: Household['filingStatus'] = filingStatus;
    let spendingWithdrawals: number;
    if (retirementPhase) {
      const solverAccounts: SolverAccount[] = household.accounts.map((acct) => {
        const state = states.get(acct.id);
        const category = withdrawalCategoryOf(acct);
        return {
          id: acct.id,
          category,
          cap: caps.get(acct.id) ?? 0,
          basis: acct.type === 'taxableBrokerage' && state ? state.basis + (contrib.get(acct.id) ?? 0) : 0,
          ordinary: category === 'traditional' || category === 'hsa',
          gains: acct.type === 'taxableBrokerage',
        };
      });
      const baseInput = {
        need,
        fixedCash: cashBefore,
        wages: earned,
        wagesByPerson: household.people.map((p) => {
          const comp = acc.people.get(p.id)?.compensation;
          return comp ? (comp.baseSalary + comp.bonus + comp.partTimeIncome) / 100 : 0;
        }),
        ordinary: acc.float.otherTaxable + pensions.taxable + rmdTaken + inflowOrdinary,
        socialSecurity: ssTotal,
        gains: inflowGains,
        filingStatus,
        ages: filerAges,
        stateTaxRate: a.stateTaxRate,
        accounts: solverAccounts,
        order,
        traditionalFirstUpTo: null as number | null,
        maxIterations: a.grossUp.maxIterations,
        toleranceDollars: a.grossUp.toleranceCents / 100,
      };
      if (bracketFill) {
        const room = bracketRoom(baseInput, rules, a.bracketFillTopRate, gaps);
        if (room === null) bracketFillFellBack = true;
        else baseInput.traditionalFirstUpTo = room;
      }
      yearFiling = baseInput.filingStatus;
      solved = solveWithdrawals(baseInput, rules);
      if (solved.status === 'unverified') {
        setup.access.absorb(solved.missing);
        // Taxes unverified: fund the need before taxes (§1.7).
        const before = Math.max(0, need - cashBefore);
        excess = Math.max(0, cashBefore - need);
        const allocation = allocateWithdrawals(before, categories, caps, order);
        for (const [id, w] of allocation.byAccount) take(id, w);
        spendingWithdrawals = before - allocation.unfunded;
        unfunded = allocation.unfunded;
      } else {
        const v = solved.value;
        for (const [id, w] of v.byAccount) take(id, w);
        spendingWithdrawals = v.withdrawn;
        unfunded = v.unfunded;
        excess = v.excess;
        if (!v.converged) {
          warnings.push({
            code: 'grossUpNotConverged',
            year,
            message: `In ${year}, the tax gross-up did not converge within ${a.grossUp.maxIterations} iterations; the last estimate is shown.`,
          });
        }
      }
    } else {
      // Accumulation: spending comes from pay; one-time outflows are withdrawn (before taxes).
      const allocation = allocateWithdrawals(outflow, categories, caps, order);
      for (const [id, w] of allocation.byAccount) take(id, w);
      // SIMPLIFICATION (§7.1 step 5): working-years outflows are withdrawn before taxes, so the income
      // tax on tax-deferred money (or gains on taxable money) they draw is not modeled. Say so.
      const taxed = household.accounts.filter(
        (acct) =>
          (allocation.byAccount.get(acct.id) ?? 0) > 0.005 && (isTaxDeferred(acct) || acct.type === 'taxableBrokerage'),
      );
      if (taxed.length > 0) {
        warnOnce(`outflow-tax-${year}`, {
          code: 'featureNotModeled',
          year,
          message: `In ${year}, one-time expenses are paid from ${taxed.map((acct) => acct.name).join(' and ')} while working; the income tax on that withdrawal is not modeled, so taxes that year are understated.`,
        });
      }
      spendingWithdrawals = outflow - allocation.unfunded;
      unfunded = allocation.unfunded;
      // RMD money is not spent while working: it is reinvested.
      excess = rmdTaken;
    }
    // Reinvest the excess (§7.1 step 6).
    let reinvested = 0;
    const target = reinvestAccount(household);
    if (excess > 0.005 && target) {
      reinvested = excess;
      add(contrib, target, excess);
    } else if (excess > 0.005) {
      warnOnce('excess-spent', {
        code: 'excessIncomeSpent',
        year,
        message: `From ${year}, income or required minimum distributions beyond the year’s need have no taxable or cash account to go to, so they are treated as spent.`,
      });
    }
    // Roth IRA earnings and HSA non-medical warnings (§7.4).
    for (const acct of household.accounts) {
      const w = withdrawals.get(acct.id) ?? 0;
      if (w <= 0) continue;
      const owner = household.people.find((p) => p.id === acct.ownerId);
      if (acct.type === 'rothIra' && owner) {
        const state = states.get(acct.id);
        const basisAvailable = (state?.basis ?? 0) + (contrib.get(acct.id) ?? 0);
        if (w > basisAvailable + 0.005) {
          const qualified = gaps.take(
            rothQualifiedYear(
              owner.birthYear as never,
              owner.birthMonth,
              acct.firstContributionYear ?? firstYear,
              ctx.rules.standing,
            ),
          );
          if (qualified !== null && year < qualified) {
            warnOnce(`roth-${acct.id}`, {
              code: 'rothEarningsWithdrawnEarly',
              year,
              accountId: acct.id,
              message: `${acct.name}: Roth IRA earnings are withdrawn before they are qualified (from ${qualified}). No tax or penalty is modeled.`,
            });
          }
        }
      }
      if (acct.type === 'hsa' && owner) {
        const nonMedical = w - (hsaMedicalBy.get(acct.id) ?? 0);
        if (nonMedical > 0.005 && year - owner.birthYear < 65) {
          warnOnce(`hsa-${acct.id}`, {
            code: 'hsaNonMedicalPre65',
            year,
            accountId: acct.id,
            message: `${acct.name}: non-medical HSA withdrawals before 65 are penalized; the penalty is not modeled.`,
          });
        }
      }
    }
    // Depletion is a retirement-phase event (§4.1). A working-years one-time outflow that savings
    // cannot cover is a shortfall with its own warning, not depletion.
    const depleted = retirementPhase && unfunded > 0.005;
    if (!retirementPhase && unfunded > 0.005) {
      warnings.push({
        code: 'oneTimeOutflowUnfunded',
        year,
        message: `In ${year}, savings cannot cover ${usd(unfunded)} of the one-time expenses.`,
      });
    }
    if (depleted && depletionYear === null) {
      depletionYear = year;
      markers.push('depletion');
      warnings.push({
        code: 'portfolioDepleted',
        year,
        message: `The portfolio runs out in ${year}: ${usd(unfunded)} of that year’s spending is not funded.`,
      });
    }

    // ---- Account updates and cents rows --------------------------------------------------------
    const accountRows: AccountYear[] = [];
    const sums = {
      contributions: 0,
      employer: 0,
      growthGross: 0,
      feeDrag: 0,
      growthNet: 0,
      withdrawals: 0,
      forfeited: 0,
    };
    const byTreatment = { taxDeferred: 0, taxFree: 0, taxable: 0 };
    let portfolioStart = 0;
    let portfolioEnd = 0;
    let portfolioEndFloat = 0;
    for (const state of states.values()) {
      const id = state.account.id;
      const f = factors.get(id);
      if (!f) continue;
      const S = state.balance;
      const F = forfeited.get(id) ?? 0;
      const C = contrib.get(id) ?? 0;
      const W = withdrawals.get(id) ?? 0;
      const cap = capsAtStart.get(id) ?? 0;
      const E = endBalance(S - F, C, W, f.net);
      const grossEnd = f.gross.gS * (S - F) + f.gross.gC * C - f.gross.gW * W;
      const growthNetFloat = E - (S - F) - C + W;
      const growthGrossFloat = grossEnd - (S - F) - C + W;

      // Basis: contributions add basis; withdrawals reduce taxable basis pro rata and Roth basis first.
      if (state.account.type === 'taxableBrokerage') {
        const before = state.basis + C;
        state.basis = cap > 0 ? before * (1 - Math.min(1, W / cap)) : before;
      } else if (state.account.type === 'rothIra') {
        state.basis = Math.max(0, state.basis + C - W);
      }
      if (state.plan && !separated.has(state.plan.owner.id)) {
        state.unvested = state.unvested * f.net.gS + (employer.get(id) ?? 0) * f.net.gC;
      }
      state.balance = E;
      portfolioEndFloat += E;

      const start = toCents(S);
      const contributions = toCents(C);
      const out = toCents(W + F);
      const end = toCents(E);
      const growthNet = asCents(end - start - contributions + out);
      const feeDrag = toCents(growthGrossFloat - growthNetFloat);
      const growthGross = asCents(growthNet + feeDrag);
      const forfeit = toCents(F);
      accountRows.push({
        accountId: id as AccountYear['accountId'],
        start,
        contributions,
        employerContributions: toCents(employer.get(id) ?? 0),
        growthGross,
        feeDrag,
        growthNet,
        withdrawals: out,
        rmd: toCents(Math.min(rmd.get(id) ?? 0, capsAtStart.get(id) ?? 0)),
        forfeited: forfeit,
        end,
        basisEnd: toCents(state.basis),
        appliedReturn: f.r,
      });
      sums.contributions += contributions;
      sums.employer += toCents(employer.get(id) ?? 0);
      sums.growthGross += growthGross;
      sums.feeDrag += feeDrag;
      sums.growthNet += growthNet;
      sums.withdrawals += out - forfeit;
      sums.forfeited += forfeit;
      portfolioStart += start;
      portfolioEnd += end;
      byTreatment[taxTreatmentOf(state.account)] += end;
    }

    const shortfall = Math.min(spendingNeed + outflow, unfunded);
    // Gross income: cash income, RMDs and HSA medical, plus withdrawals for the need (retirement
    // phase); in accumulation years pay, other income, SS, pensions and RMDs (reinvested).
    const grossIncome = retirementPhase
      ? fixedCash + rmdTaken + hsaMedical + spendingWithdrawals
      : fixedCash + rmdTaken;
    const netPay = acc.cashFlow.netPay;
    const retirementTax = retirementPhase && solved?.status === 'ok' ? solved.value : null;
    const taxes = retirementPhase ? (retirementTax?.tax ?? null) : acc.cashFlow.taxes;
    const netIncome = retirementPhase
      ? retirementTax
        ? toCents(grossIncome - retirementTax.tax.totalTax / 100)
        : null
      : netPay === null
        ? null
        : toCents(netPay / 100 + rmdTaken);

    rows.push({
      year,
      index: t,
      phase: retirementPhase ? 'retirement' : 'accumulation',
      deflator,
      people: personYears,
      accounts: accountRows,
      flows: {
        contributions: asCents(sums.contributions),
        employerContributions: asCents(sums.employer),
        growthGross: asCents(sums.growthGross),
        feeDrag: asCents(sums.feeDrag),
        growthNet: asCents(sums.growthNet),
        withdrawals: asCents(sums.withdrawals),
        forfeited: asCents(sums.forfeited),
        rmd: toCents(rmdTaken),
        hsaMedical: toCents(hsaMedical),
        reinvested: toCents(reinvested),
        surplusRouted: toCents(surplusRouted),
        socialSecurity: toCents(ssTotal),
        pensions: toCents(pensions.annuity),
        otherIncome: toCents(otherIncome),
        oneTimeInflows: toCents(inflowTotal),
        oneTimeOutflows: toCents(outflow),
        spendingNeed: toCents(spendingNeed + outflow),
        spendingFunded: toCents(spendingNeed + outflow - shortfall),
        shortfall: toCents(shortfall),
      },
      cashFlow: {
        netPay: retirementPhase ? null : netPay,
        employeeContributions: toCents(workplaceEmployee + scheduledTotal),
        surplus: retirementPhase ? null : surplus,
        infeasible: retirementPhase ? null : acc.cashFlow.infeasible,
      },
      tax: taxes
        ? taxDetail(
            yearFiling,
            taxes,
            toCents(earned),
            toCents(retirementTax ? retirementTax.gains : inflowGains),
            retirementTax ? { iterations: retirementTax.iterations, converged: retirementTax.converged } : undefined,
          )
        : null,
      totals: {
        portfolioStart: asCents(portfolioStart),
        portfolioEnd: asCents(portfolioEnd),
        byTaxTreatment: {
          taxDeferred: asCents(byTreatment.taxDeferred),
          taxFree: asCents(byTreatment.taxFree),
          taxable: asCents(byTreatment.taxable),
        },
      },
      real: {
        // Real values divide the unrounded float by the deflator, then round once (§1.3).
        portfolioEnd: toCents(portfolioEndFloat / deflator),
        spendingNeed: toCents((spendingNeed + outflow) / deflator),
        grossIncome: toCents(grossIncome / deflator),
        netIncome: netIncome === null ? null : toCents(netIncome / 100 / deflator),
      },
      grossIncome: toCents(grossIncome),
      netIncome,
      depleted,
      markers,
    });
  }

  setup.access.absorb(gaps.missing);
  setup.access.absorb(standingAccess.missing);
  if (bracketFillFellBack) {
    warnings.push({
      code: 'withdrawalStrategyFallback',
      message:
        'Bracket-fill withdrawals need verified tax brackets and a bracket-fill rate equal to one of the bracket rates; this forecast uses the taxable-first order.',
    });
  }
  const last = rows[rows.length - 1];
  // The age shown for the depletion year is the first listed person still alive that year.
  const depletionPerson =
    depletionYear === null
      ? null
      : (household.people.find((p) => (depletionYear ?? 0) <= p.birthYear + p.planningAge) ?? null);
  const endingBalance = last?.totals.portfolioEnd ?? (0 as Cents);
  const endingBalanceReal = last?.real.portfolioEnd ?? (0 as Cents);
  const missing = setup.access.missing;
  const excluded = [...new Set(missing.flatMap((m) => m.features))];
  return {
    status: 'ok',
    value: {
      contractVersion: CONTRACT_VERSION,
      granularity: a.granularity,
      rows,
      summary: {
        firstYear: firstYear as YearRow['year'],
        lastYear: lastYear as YearRow['year'],
        retirementYear: (retirementYear ?? lastYear) as YearRow['year'],
        firstDeathYear: firstDeathYear as YearRow['year'] | null,
        depletionYear: depletionYear as YearRow['year'] | null,
        depletionAge: depletionPerson ? (depletionYear ?? 0) - depletionPerson.birthYear : null,
        endingBalance,
        endingBalanceReal,
        infeasibleYears: infeasibleYears as YearRow['year'][],
        deterministicSuccess: depletionYear === null && endingBalanceReal >= a.minimumEndingBalance,
      },
      excludedFeatures: excluded,
      unverified: missing.map((m) => ({ key: m.key, reason: m.reason, features: [...m.features] })),
      warnings: warnings.map((w) => ({
        code: w.code,
        message: w.message,
        ...(w.year !== undefined ? { year: w.year } : {}),
      })),
    },
    warnings,
  };
}
