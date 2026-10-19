/**
 * Retirement-income inputs for one projection year (docs/financial-model.md §5, §7.5–7.7): the
 * spending need, pensions, one-time events, Social Security and RMDs. Float64 dollars; rule values
 * are read through `RuleAccess`-style results and recorded as missing when null (never filled in).
 */
import type { Account, Household, Person } from '../domain/household';
import type { EngineResult, EngineWarning, UnverifiedDetail } from '../domain/results';
import type { AgeYearsMonths, CalendarYear, Cents } from '../domain/primitives';
import type { RulesSet, StandingRules } from '../domain/rules';
import {
  estimatePia,
  fullRetirementAge,
  spousalBenefit,
  ssBenefitAtClaim,
  survivorBenefit,
} from '../socialSecurity/socialSecurity';
import { rmdAmount, rmdStartAge } from '../rmd/rmd';
import { toCents } from '../money';

export interface YearContext {
  household: Household;
  year: number;
  /** 1-based year index. */
  t: number;
  /** Price level P_t (today's dollars are year-1 dollars). */
  deflator: number;
  alive: (p: Person) => boolean;
  retired: (p: Person) => boolean;
  retirementPhase: boolean;
  firstRetirementYear: number | null;
  firstDeathYear: number | null;
}

/**
 * Records rule gaps from engine sub-results; returns the value or null. An `invalid` sub-result also
 * reads as null: the household is validated before projecting, so it means an input the sub-call
 * cannot use (no case is known with a valid household; listed as a risk in STATUS.md).
 */
export class Gaps {
  readonly missing: UnverifiedDetail[] = [];
  take<T>(result: EngineResult<T>): T | null {
    if (result.status === 'ok') return result.value;
    if (result.status === 'unverified') this.missing.push(...result.missing);
    return null;
  }
}

// ---- Spending (§5) ---------------------------------------------------------------------------

export function spendingNeed(c: YearContext): number {
  const { household: h, year, deflator } = c;
  const s = h.spending;
  const survivor =
    h.people.length > 1 && c.firstDeathYear !== null && year >= c.firstDeathYear ? 1 - s.survivorSpendingReduction : 1;
  if (!c.retirementPhase) return (s.currentAnnualSpending / 100) * deflator * survivor;
  const first = h.people[0];
  const age1 = first ? year - first.birthYear : 0;
  let base = s.retirementAnnualSpending;
  for (const step of [...s.steps].sort((x, y) => x.fromAge - y.fromAge))
    if (step.fromAge <= age1) base = step.annualSpending;
  const glideYears = c.firstRetirementYear === null ? 0 : Math.max(0, year - c.firstRetirementYear);
  let need = (base / 100) * Math.pow(1 + s.retirementRealGlide, glideYears) * deflator;
  const preMedicare = h.people.some((p) => c.alive(p) && c.retired(p) && year - p.birthYear < 65);
  if (preMedicare) need += (s.healthcareBeforeMedicare / 100) * deflator;
  return need * survivor;
}

// ---- Pensions (§7.6) -------------------------------------------------------------------------

export interface PensionYear {
  /** Annuity income this year (gross) and its taxable part, total and per owner. */
  annuity: number;
  taxable: number;
  byPerson: Map<string, number>;
  /** Lump sums deposited this year: account, amount, taxable ordinary income (0 for tax-deferred). */
  lumpSums: { accountId: string; amount: number; taxable: number }[];
}

function growth(mode: Household['pensions'][number]['cola'], deflatorRatio: number, years: number): number {
  switch (mode.mode) {
    case 'flat':
      return 1;
    case 'inflation':
      return deflatorRatio;
    case 'rate':
      return Math.pow(1 + mode.rate, years);
  }
}

export function pensionYear(c: YearContext, deflatorAt: (year: number) => number): PensionYear {
  const out: PensionYear = { annuity: 0, taxable: 0, byPerson: new Map(), lumpSums: [] };
  const { household: h, year } = c;
  const accounts = new Map(h.accounts.map((a) => [a.id, a]));
  for (const pension of h.pensions) {
    const owner = h.people.find((p) => p.id === pension.ownerId);
    if (!owner) continue;
    const startYear = owner.birthYear + pension.startAge;
    if (year < startYear) continue;
    // A pension already in payment before year 1 is entered at its current amount: grow from year 1.
    const fromYear = Math.max(startYear, c.year - c.t + 1);
    // Amount at the start year in nominal dollars.
    const atStart =
      pension.amountBasis === 'todaysDollars'
        ? (pension.annualAmount / 100) * deflatorAt(startYear)
        : pension.annualAmount / 100;
    if (pension.payout.kind === 'lumpSum') {
      if (year !== startYear || !c.alive(owner)) continue;
      // The lump sum is stated in nominal dollars at the start age (schema); amountBasis applies to
      // the annuity amount only.
      const amount = pension.payout.amount / 100;
      const dest = accounts.get(pension.payout.destinationAccountId);
      const deferred = dest ? isTaxDeferred(dest) : false;
      out.lumpSums.push({
        accountId: pension.payout.destinationAccountId,
        amount,
        taxable: deferred ? 0 : amount * pension.taxableFraction,
      });
      continue;
    }
    let amount = atStart * growth(pension.cola, deflatorAt(year) / deflatorAt(fromYear), year - fromYear);
    if (!c.alive(owner)) {
      const spouseAlive = h.people.some((p) => p.id !== owner.id && c.alive(p));
      if (!spouseAlive) continue;
      amount *= pension.survivorFraction;
    }
    out.annuity += amount;
    out.taxable += amount * pension.taxableFraction;
    // A continuing survivor pension is reported on the survivor's row.
    const recipient = c.alive(owner) ? owner : (h.people.find((p) => p.id !== owner.id && c.alive(p)) ?? owner);
    out.byPerson.set(recipient.id, (out.byPerson.get(recipient.id) ?? 0) + amount);
  }
  return out;
}

export function isTaxDeferred(a: Account): boolean {
  return (
    a.type === 'workplaceTraditional' ||
    a.type === 'traditionalIra' ||
    (a.type === 'other' && a.taxTreatment === 'taxDeferred')
  );
}

// ---- One-time events (§7.6) ------------------------------------------------------------------

export interface EventsYear {
  outflow: number;
  /** Deposits (account null = spent with a warning), with the ordinary income and gains they realize. */
  inflows: { accountId: string | null; amount: number; ordinary: number; gains: number }[];
}

export function eventsYear(c: YearContext): EventsYear {
  const { household: h, year, deflator } = c;
  const out: EventsYear = { outflow: 0, inflows: [] };
  const fallback = inflowFallback(h);
  for (const e of h.oneTimeEvents) {
    if (e.year !== year) continue;
    const amount = e.amountBasis === 'todaysDollars' ? (e.amount / 100) * deflator : e.amount / 100;
    if (e.direction === 'outflow') {
      out.outflow += amount;
      continue;
    }
    out.inflows.push({
      accountId: e.destinationAccountId ?? fallback,
      amount,
      ordinary: e.taxTreatment === 'ordinaryIncome' ? amount : 0,
      gains: e.taxTreatment === 'capitalGain' ? amount * e.gainFraction : 0,
    });
  }
  return out;
}

/** Destination for inflows and reinvested excess: the surplus account, else first taxable, else first cash. */
export function inflowFallback(h: Household): string | null {
  if (h.assumptions.surplus.mode === 'account') return h.assumptions.surplus.accountId;
  return reinvestAccount(h);
}

export function reinvestAccount(h: Household): string | null {
  return (
    (h.accounts.find((a) => a.type === 'taxableBrokerage') ?? h.accounts.find((a) => a.type === 'cash'))?.id ?? null
  );
}

// ---- Social Security (§7.5) ------------------------------------------------------------------

interface SsPlan {
  person: Person;
  claimYear: number;
  /** Months of benefit in the claim year. */
  firstYearMonths: number;
  /** Own benefit at claim, monthly, in today's dollars (year-1 dollars); null when unknown. */
  monthly: number | null;
  /** PIA in today's dollars, when known (statement or estimate). */
  pia: number | null;
  /** FRA when verified. */
  fra: AgeYearsMonths | null;
}

export interface SsSetup {
  plans: Map<string, SsPlan>;
  warnings: EngineWarning[];
}

const months = (a: AgeYearsMonths) => a.years * 12 + a.months;

export function socialSecuritySetup(h: Household, rules: RulesSet, currentYear: number, gaps: Gaps): SsSetup {
  const plans = new Map<string, SsPlan>();
  const warnings: EngineWarning[] = [];
  const standing = rules.standing;
  for (const person of h.people) {
    const ss = person.socialSecurity;
    const src = ss.source;
    const claimYear = person.birthYear + ss.claimAge.years;
    const firstYearMonths = Math.max(0, 12 - (person.birthMonth - 1 + ss.claimAge.months));
    if (src.kind === 'none') {
      // No benefit record of their own: PIA 0. Spousal and survivor benefits can still apply (§7.5).
      plans.set(person.id, { person, claimYear, firstYearMonths, monthly: 0, pia: 0, fra: null });
      continue;
    }
    // FRA is needed for the benefit only for PIA-based inputs; for `atClaimAge` it only refines the
    // earnings-test warning, so a gap there is not recorded.
    const fraResult = fullRetirementAge(person.birthYear as CalendarYear, person.birthMonth, standing);
    const fra = src.kind === 'atClaimAge' ? (fraResult.status === 'ok' ? fraResult.value : null) : gaps.take(fraResult);
    let pia: number | null = null;
    let monthly: number | null = null;
    if (src.kind === 'atClaimAge') {
      monthly = src.monthlyAtClaim / 100;
    } else {
      if (src.kind === 'statement') pia = src.piaMonthly / 100;
      else {
        const est = gaps.take(
          estimatePia(
            src.kind === 'estimateAverage'
              ? {
                  kind: 'average',
                  birthYear: person.birthYear as CalendarYear,
                  averageAnnualEarnings: src.averageAnnualEarnings,
                  yearsOfEarnings: src.yearsOfEarnings,
                }
              : { kind: 'history', birthYear: person.birthYear as CalendarYear, earnings: src.earnings },
            rules,
          ),
        );
        if (est) {
          pia = est.piaMonthly / 100;
          warnings.push({
            code: 'ssEstimateIllustrative',
            personId: person.id,
            message: `${person.name}: the Social Security amount is an illustrative estimate, not an official SSA calculation.`,
          });
        }
      }
      if (pia !== null) {
        const at = gaps.take(
          ssBenefitAtClaim(
            {
              piaMonthly: toCents(pia),
              birthYear: person.birthYear as CalendarYear,
              birthMonth: person.birthMonth,
              claimAge: ss.claimAge,
            },
            standing,
          ),
        );
        monthly = at ? at.monthly / 100 : null;
      }
    }
    // Earnings test (unsupported): warn when claiming before FRA while earning. With FRA unverified, any
    // claim while still earning gets the warning (no FRA is assumed).
    if (fra === null || months(ss.claimAge) < months(fra)) {
      const earnsAfterClaim =
        (person.employment !== null && (person.employment.stopAge ?? person.retirementAge) > ss.claimAge.years) ||
        (person.employment?.partTime !== null &&
          person.employment?.partTime !== undefined &&
          person.employment.partTime.endAge > ss.claimAge.years);
      if (earnsAfterClaim && claimYear >= currentYear) {
        warnings.push({
          code: 'ssClaimBeforeFraWhileWorking',
          personId: person.id,
          message: fra
            ? `${person.name} claims Social Security before full retirement age while still earning. The earnings test is not modeled, so benefits may be overstated.`
            : `${person.name} claims Social Security while still earning. If that is before full retirement age (not verified yet), the earnings test, which is not modeled, may reduce benefits.`,
        });
      }
    }
    plans.set(person.id, { person, claimYear, firstYearMonths, monthly, pia, fra });
  }
  return { plans, warnings };
}

/** Benefit index from year 1 (COLA): the inflation price level, or a set rate. */
function cola(h: Household, t: number, deflator: number): number {
  const c = h.assumptions.socialSecurity.cola;
  return c.mode === 'inflation' ? deflator : Math.pow(1 + c.rate, t - 1);
}

function reduction(h: Household, year: number): number {
  const r = h.assumptions.socialSecurity.benefitReduction;
  return r && year >= r.fromYear ? 1 - r.reduction : 1;
}

/** Social Security paid this year per person (nominal dollars). */
export function socialSecurityYear(
  c: YearContext,
  setup: SsSetup,
  standing: StandingRules,
  gaps: Gaps,
): Map<string, number> {
  const { household: h, year, t, deflator } = c;
  const index = cola(h, t, deflator) * reduction(h, year);
  const paid = new Map<string, number>();
  const monthsIn = (plan: SsPlan) => (year < plan.claimYear ? 0 : year === plan.claimYear ? plan.firstYearMonths : 12);

  // Own benefits for the living.
  for (const plan of setup.plans.values()) {
    if (!c.alive(plan.person) || plan.monthly === null) continue;
    const m = monthsIn(plan);
    if (m > 0) paid.set(plan.person.id, plan.monthly * m * index);
  }
  if (h.people.length < 2) return paid;
  const [a, b] = h.people;
  if (!a || !b) return paid;

  // Spousal excess: both living and both claimed; needs both PIAs and verified spousal rules.
  if (c.alive(a) && c.alive(b)) {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const ps = setup.plans.get(self.id);
      const po = setup.plans.get(other.id);
      if (!ps || !po || monthsIn(ps) === 0 || monthsIn(po) === 0) continue;
      if (po.pia === 0 || (po.pia === null && po.monthly === 0)) continue; // the other has no benefit
      if (ps.pia === null || po.pia === null) {
        gaps.missing.push({
          key: 'standing:socialSecurity.spousal',
          reason:
            'Spousal benefits need both people’s PIA (an amount at full retirement age), not only a benefit at the claiming age.',
          features: ['spousalSurvivorBenefits'],
        });
        continue;
      }
      const excess = gaps.take(
        spousalBenefit(
          {
            ownPiaMonthly: toCents(ps.pia),
            otherPiaMonthly: toCents(po.pia),
            birthYear: self.birthYear as CalendarYear,
            birthMonth: self.birthMonth,
            claimAge: self.socialSecurity.claimAge,
          },
          standing,
        ),
      );
      if (excess && excess.monthlyExcess > 0) {
        const m = Math.min(monthsIn(ps), monthsIn(po));
        paid.set(self.id, (paid.get(self.id) ?? 0) + (excess.monthlyExcess / 100) * m * index);
      }
    }
    return paid;
  }

  // Survivor: one alive, the other died (first death year onward).
  const survivor = c.alive(a) ? a : c.alive(b) ? b : null;
  const deceased = survivor === a ? b : a;
  if (!survivor) return paid;
  const pd = setup.plans.get(deceased.id);
  if (!pd) return paid;
  // The survivor benefit starts no earlier than the survivor's own claim year (§7.5).
  const survivorPlan = setup.plans.get(survivor.id);
  const months = survivorPlan ? monthsIn(survivorPlan) : 12;
  if (months === 0) return paid;
  if ((pd.monthly ?? 0) === 0 && (pd.pia ?? 0) === 0) return paid; // the deceased had no benefit
  const deathAge = deceased.planningAge + 1;
  let deceasedMonthly = pd.monthly;
  if (pd.claimYear > deceased.birthYear + deceased.planningAge && pd.pia !== null) {
    // Not claimed before death: no reduction for the deceased's age, delayed credits up to the death
    // age if past FRA: PIA × max(1, factor at the death age). The claim range clamps the age.
    const claimAge = { years: Math.min(70, Math.max(62, deathAge)), months: 0 };
    const at = gaps.take(
      ssBenefitAtClaim(
        {
          piaMonthly: toCents(pd.pia),
          birthYear: deceased.birthYear as CalendarYear,
          birthMonth: deceased.birthMonth,
          claimAge,
        },
        standing,
      ),
    );
    deceasedMonthly = at ? pd.pia * Math.max(1, at.adjustmentFactor) : null;
  }
  if (deceasedMonthly === null) return paid;
  const ownPlan = setup.plans.get(survivor.id);
  const ownMonthly = ownPlan && ownPlan.monthly !== null && monthsIn(ownPlan) > 0 ? ownPlan.monthly : 0;
  const result = gaps.take(
    survivorBenefit(
      {
        survivorOwnMonthly: toCents(ownMonthly),
        deceasedBenefitMonthly: toCents(deceasedMonthly),
        deceasedPiaMonthly: toCents(pd.pia ?? 0),
      },
      standing,
    ),
  );
  if (result) paid.set(survivor.id, (result.monthly / 100) * months * index);
  return paid;
}

// ---- RMDs (§7.1 step 3) ----------------------------------------------------------------------

/** The person whose age governs RMDs on an account: the owner, or the surviving spouse after death. */
export function rmdPerson(c: YearContext, account: Account): Person | null {
  const owner = c.household.people.find((p) => p.id === account.ownerId) ?? null;
  if (owner && c.alive(owner)) return owner;
  return c.household.people.find((p) => c.alive(p)) ?? null;
}

export function rmdFor(
  c: YearContext,
  account: Account,
  priorYearEnd: number,
  standing: StandingRules,
  gaps: Gaps,
  roth401kRmd: boolean | null,
): number {
  const applies = isTaxDeferred(account) || (account.type === 'workplaceRoth' && roth401kRmd === true);
  if (!applies || priorYearEnd <= 0) return 0;
  const person = rmdPerson(c, account);
  if (!person) return 0;
  const start = gaps.take(rmdStartAge(person.birthYear as CalendarYear, standing));
  if (start === null) return 0;
  const age = c.year - person.birthYear;
  if (age < start) return 0;
  const amount = gaps.take(rmdAmount({ age, priorYearEndBalance: toCents(priorYearEnd) as Cents }, standing));
  return amount === null ? 0 : amount / 100;
}
