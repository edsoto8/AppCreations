/**
 * Deterministic projection (docs/financial-model.md §1, §3–4, §7 M3 subset). Year by year from the
 * injected current year through the longer-lived person's planning age.
 *
 * Accumulation years reuse the Income & Savings slice (`accumulationYear`): compensation, elections,
 * limits, match, scheduled contributions and net-pay feasibility. When a limit is unverified, the
 * step is excluded and contributions are as elected (before limits); the feature is listed in
 * `excludedFeatures`. Taxes and net pay that need a null rule are null, never filled in.
 *
 * Retirement-phase years (M3): spending need is funded by withdrawals in the strategy's order, before
 * taxes. Social Security, pensions, one-time events, RMDs, spending steps and retirement taxes are
 * modeled in M4; their presence produces `featureNotModeled` warnings.
 */
import type { Account, Household, Person, WorkplacePlan } from '../domain/household';
import type { CappedContributions, EngineContext, ProjectionOptions, TaxBreakdown } from '../api';
import type { EngineResult, EngineWarning } from '../domain/results';
import type { AccountYear, PersonYear, ProjectionResult, TaxYearDetail, YearRow } from '../domain/projection';
import type { Cents } from '../domain/primitives';
import { CONTRACT_VERSION } from '../contractVersion';
import { HouseholdSchema } from '../domain/household';
import { zodIssues } from '../validation';
import { asCents, toCents } from '../money';
import { vestedFraction } from '../match/match';
import { accumulationSetup, accumulationYear, rulesForYear } from '../income/preview';
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

const usd = (dollars: number) => `$${Math.round(dollars).toLocaleString('en-US')}`;

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

function taxDetail(household: Household, taxes: TaxBreakdown, wages: Cents): TaxYearDetail {
  return {
    filingStatus: household.filingStatus,
    wages,
    ordinaryIncome: taxes.agi,
    taxableSocialSecurity: taxes.taxableSocialSecurity,
    capitalGains: 0 as Cents,
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
    solver: { iterations: 0, converged: true },
  };
}

/** Warnings for inputs whose modeling arrives in M4 (shown once, so the UI can label them). */
function notModeledWarnings(household: Household): EngineWarning[] {
  const notes: string[] = [];
  if (household.people.some((p) => p.socialSecurity.source.kind !== 'none')) {
    notes.push('Social Security benefits are not included yet (modeled in M4).');
  }
  if (household.pensions.length > 0) notes.push('Pensions are not included yet (modeled in M4).');
  if (household.oneTimeEvents.length > 0) notes.push('One-time events are not included yet (modeled in M4).');
  const s = household.spending;
  if (s.steps.length > 0 || s.retirementRealGlide !== 0 || s.healthcareBeforeMedicare > 0) {
    notes.push('Spending steps, the spending glide and the pre-Medicare healthcare line are not applied yet (M4).');
  }
  if (household.people.length > 1) {
    notes.push('The survivor spending reduction after the first death is not applied yet (M4).');
  }
  notes.push(
    'Retirement-phase taxes, required minimum distributions and HSA medical withdrawals are modeled in M4: retirement withdrawals here are before taxes.',
  );
  return notes.map((message) => ({ code: 'featureNotModeled', message }));
}

export function projectHousehold(
  input: Household,
  ctx: EngineContext,
  options: ProjectionOptions = {},
): EngineResult<ProjectionResult> {
  const parsed = HouseholdSchema.safeParse(input);
  if (!parsed.success) return { status: 'invalid', issues: zodIssues(parsed.error) };
  const household = parsed.data;
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
  const setup = accumulationSetup(household, ctx, years);
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
      unvested:
        account.type === 'workplaceTraditional' || account.type === 'workplaceRoth'
          ? Math.min(account.unvestedEmployerBalance, account.balance) / 100
          : 0,
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
  /** Projection years each person has worked so far (years of service accrue per working year). */
  const yearsWorked = new Map(household.people.map((p) => [p.id, 0]));
  const separated = new Set<string>();

  let strategy = a.withdrawalStrategy;
  if (strategy === 'bracketFill') {
    warnings.push({
      code: 'withdrawalStrategyFallback',
      message: 'Bracket-fill withdrawals need the tax model (M4); this forecast uses the taxable-first order.',
    });
    strategy = 'taxableFirst';
  }
  const order = WITHDRAWAL_ORDER[strategy];
  const categories = household.accounts.map((acc) => ({ id: acc.id, category: withdrawalCategoryOf(acc) }));

  const rows: YearRow[] = [];
  let deflator = 1;
  let retirementYear: number | null = null;
  let firstDeathYear: number | null = null;
  let depletionYear: number | null = null;
  const infeasibleYears: number[] = [];
  const shock = a.marketShock;

  for (let t = 1; t <= years; t++) {
    const year = firstYear + t - 1;
    if (t > 1) deflator *= 1 + (options.inflationOverride?.(t) ?? a.inflation);
    const rules = rulesForYear(household, ctx, year);
    const acc = accumulationYear(household, setup, t, rules);
    for (const w of acc.cashFlow.warnings) warnings.push(w);

    const alive = (p: Person) => year <= p.birthYear + p.planningAge;
    const retired = (p: Person) => year - p.birthYear >= p.retirementAge;
    const retirementPhase = household.people.every((p) => !alive(p) || retired(p));
    if (retirementPhase && retirementYear === null) retirementYear = year;
    const someoneDied = household.people.some((p) => !alive(p));
    const markers: YearRow['markers'] = [];
    if (retirementYear === year) markers.push('retirement');
    if (someoneDied && firstDeathYear === null) {
      firstDeathYear = year;
      markers.push('firstDeath');
    }

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
        socialSecurity: 0 as Cents,
        pension: 0 as Cents,
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

    const spendingToday = retirementPhase
      ? household.spending.retirementAnnualSpending
      : household.spending.currentAnnualSpending;
    const spendingNeed = (spendingToday / 100) * deflator;
    const earned = acc.float.grossPay;
    const otherIncome = acc.float.otherIncome;

    // Retirement phase: contributions are funded only from cash income left after spending.
    if (retirementPhase && scheduledTotal > 0) {
      const leftover = Math.max(0, earned + otherIncome - spendingNeed);
      if (leftover < scheduledTotal - 0.005) {
        const k = leftover / scheduledTotal;
        // Contribution amounts are whole cents (§1.3); the scaled amounts are rounded too.
        for (const [id, v] of scheduled) scheduled.set(id, toCents(v * k) / 100);
        warnings.push({
          code: 'retirementContributionsReduced',
          year,
          message: `In ${year}, scheduled contributions are reduced to ${usd(leftover)}: in retirement they are funded only from earned and other income left after spending.`,
        });
        scheduledTotal = [...scheduled.values()].reduce((x, y) => x + y, 0);
      }
    }
    for (const [id, v] of scheduled) add(contrib, id, v);

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

    // ---- Withdrawals (retirement phase): fund the need before taxes ----------------------------
    let withdrawalNeed = 0;
    let unfunded = 0;
    let withdrawals = new Map<string, number>();
    if (retirementPhase) {
      withdrawalNeed = Math.max(0, spendingNeed + scheduledTotal - earned - otherIncome);
      const allocation = allocateWithdrawals(withdrawalNeed, categories, caps, order);
      withdrawals = allocation.byAccount;
      unfunded = allocation.unfunded;
    }
    const depleted = retirementPhase && unfunded > 0.005;
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
      const cap = caps.get(id) ?? 0;
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
        rmd: 0 as Cents,
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

    const fundedWithdrawals = withdrawalNeed - unfunded;
    const shortfall = retirementPhase ? Math.min(spendingNeed, unfunded) : 0;
    const grossIncome = earned + otherIncome + (retirementPhase ? fundedWithdrawals : 0);
    const netPay = acc.cashFlow.netPay;
    const netIncome = retirementPhase ? null : netPay;
    const taxes = retirementPhase ? null : acc.cashFlow.taxes;

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
        surplusRouted: toCents(surplusRouted),
        socialSecurity: 0 as Cents,
        pensions: 0 as Cents,
        otherIncome: toCents(otherIncome),
        oneTimeInflows: 0 as Cents,
        oneTimeOutflows: 0 as Cents,
        spendingNeed: toCents(spendingNeed),
        spendingFunded: toCents(spendingNeed - shortfall),
        shortfall: toCents(shortfall),
      },
      cashFlow: {
        netPay: retirementPhase ? null : netPay,
        employeeContributions: toCents(workplaceEmployee + scheduledTotal),
        surplus: retirementPhase ? null : surplus,
        infeasible: retirementPhase ? null : acc.cashFlow.infeasible,
      },
      tax: taxes ? taxDetail(household, taxes, toCents(earned)) : null,
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
        spendingNeed: toCents(spendingNeed / deflator),
        grossIncome: toCents(grossIncome / deflator),
        netIncome: netIncome === null ? null : toCents(netIncome / 100 / deflator),
      },
      grossIncome: toCents(grossIncome),
      netIncome,
      depleted,
      markers,
    });
  }

  warnings.push(...notModeledWarnings(household));
  const last = rows[rows.length - 1];
  const primary = household.people[0];
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
        depletionAge: depletionYear !== null && primary ? depletionYear - primary.birthYear : null,
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
