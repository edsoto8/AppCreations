/**
 * Scheduled (non-workplace) contributions for one year, with limits, in dependency order
 * (docs/financial-model.md §3.6–3.7):
 * 1. HSAs: one limit per person (shared by that person's HSA accounts); require HDHP attestation.
 * 2. Traditional IRAs: one IRA limit per person, capped at earned income, shared with Roth IRAs.
 * 3. Roth IRA eligibility for each person owning a Roth IRA (MAGI: override, or the household
 *    estimate, which needs this year's traditional deferrals and HSA contributions).
 * 4. Roth IRA schedules, capped by eligibility and the remaining IRA room.
 * 5. Taxable, cash and other accounts (no limit; "maximum" has no meaning and contributes 0).
 * Anything that needs an unknown input (an unverified rule, or a figure built from one) is null.
 */
import type { Cents, FilingStatus } from '../domain/primitives';
import type { Account, ContributionSchedule, Household, Person } from '../domain/household';
import type { EngineWarning } from '../domain/results';
import type { CashFlowPreviewRow, CappedContributions, ResolvedYearRules, RothIraYear } from '../api';
import type { CompensationFloat } from './compensation';
import { salaryStopAge } from './compensation';
import { estimateMagi, iraContributionLimit, rothIraEligibility } from '../limits/ira';
import { hsaLimit } from '../limits/hsa';
import type { RuleAccess } from '../rules/access';
import { toCents } from '../money';
import { priceIndex } from '../time';

export interface PersonYearInput {
  person: Person;
  comp: CompensationFloat;
  /** Workplace contributions after limits; null when a limit is unverified. */
  contributions: CappedContributions | null;
}

export interface ScheduledYear {
  /** Total scheduled contributions, or null if any is unknown. */
  total: number | null;
  /** HSA contributions (pre-tax for income tax), or null if any HSA amount is unknown. */
  hsaPreTax: number | null;
  byAccount: CashFlowPreviewRow['scheduled'];
  rothIra: RothIraYear[];
}

type ScheduledAccount = Exclude<Account, { type: 'workplaceTraditional' | 'workplaceRoth' }>;

const usd = (dollars: number) => `$${Math.round(dollars).toLocaleString('en-US')}`;

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

function scheduleActive(schedule: ContributionSchedule, owner: Person, year: number, firstYear: number): boolean {
  const start = schedule.startYear ?? firstYear;
  const stop = schedule.stopYear ?? owner.birthYear + salaryStopAge(owner) - 1;
  return year >= start && year <= stop;
}

/** What the schedule asks for this year (dollars), 'max', or null when not active. */
function wantedAmount(
  account: ScheduledAccount,
  state: PersonYearInput,
  inflation: number,
  t: number,
  year: number,
  firstYear: number,
): number | 'max' | null {
  const schedule = account.contribution;
  if (!schedule || !scheduleActive(schedule, state.person, year, firstYear)) return null;
  const a = schedule.amount;
  if (a.kind === 'dollars')
    return (a.amount / 100) * (a.frequency === 'monthly' ? 12 : 1) * growthFactor(schedule, inflation, t);
  if (a.kind === 'percentOfSalary') return a.pct * state.comp.baseSalary;
  return 'max';
}

const earnedIncome = (s: PersonYearInput) => s.comp.baseSalary + s.comp.bonus + s.comp.partTimeIncome;

export function scheduledContributions(
  household: Household,
  t: number,
  year: number,
  firstYear: number,
  people: Map<string, PersonYearInput>,
  rules: ResolvedYearRules,
  access: RuleAccess,
  warnings: EngineWarning[],
): ScheduledYear {
  const inflation = household.assumptions.inflation;
  const allowed = new Map<string, number | null>();
  const requested = new Map<string, number | 'max'>();
  const accounts = household.accounts.filter(
    (a): a is ScheduledAccount => a.type !== 'workplaceTraditional' && a.type !== 'workplaceRoth',
  );
  const want = (a: ScheduledAccount) => {
    const state = people.get(a.ownerId);
    const w = state ? wantedAmount(a, state, inflation, t, year, firstYear) : null;
    if (w !== null) requested.set(a.id, w);
    return w;
  };
  const cap = (
    a: ScheduledAccount,
    w: number | 'max',
    limit: number,
    code: 'iraCapped' | 'hsaCapped',
    what: string,
  ) => {
    if (w !== 'max' && w > limit + 0.005) {
      warnings.push({
        code,
        year,
        accountId: a.id,
        message: `${a.name}: contribution capped at the allowed ${usd(limit)} (${what}).`,
      });
    }
    return w === 'max' ? limit : Math.min(w, limit);
  };

  // 1. HSAs (one limit per person).
  const hsaRoom = new Map<string, number | null>();
  const hsaByOwner = new Map<string, number>();
  const hsaUnknownOwners = new Set<string>();
  for (const a of accounts) {
    if (a.type !== 'hsa') continue;
    const w = want(a);
    if (w === null) continue;
    const state = people.get(a.ownerId);
    if (!state) continue;
    if (!hsaRoom.has(a.ownerId)) {
      const limit = hsaLimit({ coverage: a.coverage, age: state.comp.age, hdhpAttested: a.hdhpAttested }, rules);
      if (limit.status === 'unverified') access.absorb(limit.missing);
      if (limit.status === 'ok') for (const warning of limit.warnings) warnings.push({ ...warning, accountId: a.id });
      hsaRoom.set(a.ownerId, limit.status === 'ok' ? limit.value / 100 : null);
    }
    const room = hsaRoom.get(a.ownerId) ?? null;
    if (room === null) {
      allowed.set(a.id, null);
      hsaUnknownOwners.add(a.ownerId);
      continue;
    }
    const amount = cap(a, w, room, 'hsaCapped', 'HSA limit');
    hsaRoom.set(a.ownerId, room - amount);
    hsaByOwner.set(a.ownerId, (hsaByOwner.get(a.ownerId) ?? 0) + amount);
    allowed.set(a.id, amount);
  }

  // 2. Traditional IRAs (shared IRA room per person, capped at earned income).
  const iraRoom = new Map<string, { initial: number; remaining: number } | null>();
  const roomFor = (personId: string): { initial: number; remaining: number } | null => {
    if (!iraRoom.has(personId)) {
      const state = people.get(personId);
      const limit = state ? iraContributionLimit(state.comp.age, rules, access) : null;
      iraRoom.set(
        personId,
        limit === null || !state
          ? null
          : {
              initial: Math.min(limit / 100, earnedIncome(state)),
              remaining: Math.min(limit / 100, earnedIncome(state)),
            },
      );
    }
    return iraRoom.get(personId) ?? null;
  };
  for (const a of accounts) {
    if (a.type !== 'traditionalIra') continue;
    const w = want(a);
    if (w === null) continue;
    const room = roomFor(a.ownerId);
    if (room === null) {
      allowed.set(a.id, null);
      continue;
    }
    const amount = cap(a, w, room.remaining, 'iraCapped', 'IRA limit, shared by traditional and Roth IRAs');
    room.remaining -= amount;
    allowed.set(a.id, amount);
  }

  // 3. Roth IRA eligibility per owner.
  const rothIra: RothIraYear[] = [];
  const rothRoom = new Map<string, number | null>();
  const states = [...people.values()];
  const magiPeople = household.filingStatus === 'marriedFilingJointly' ? states : null;
  for (const person of household.people) {
    const roths = accounts.filter(
      (a): a is Extract<ScheduledAccount, { type: 'rothIra' }> => a.type === 'rothIra' && a.ownerId === person.id,
    );
    const state = people.get(person.id);
    if (roths.length === 0 || !state) continue;
    const group = magiPeople ?? [state];
    const deferralsKnown = group.every((s) => s.contributions !== null);
    const hsaKnown = group.every((s) => !hsaUnknownOwners.has(s.person.id));
    const sum = (f: (s: PersonYearInput) => number) => group.reduce((acc, s) => acc + f(s), 0);
    const components: RothIraYear['magiComponents'] = {
      salary: toCents(sum((s) => s.comp.baseSalary)),
      bonus: toCents(sum((s) => s.comp.bonus)),
      partTimeIncome: toCents(sum((s) => s.comp.partTimeIncome)),
      traditionalDeferrals: deferralsKnown
        ? (group.reduce((acc, s) => acc + (s.contributions?.traditional ?? 0), 0) as Cents)
        : null,
      hsaContributions: hsaKnown ? toCents(sum((s) => hsaByOwner.get(s.person.id) ?? 0)) : null,
    };
    const override = roths.find((a) => a.magiOverride !== null)?.magiOverride ?? null;
    const estimate =
      components.traditionalDeferrals === null || components.hsaContributions === null
        ? null
        : estimateMagi({
            salary: components.salary,
            bonus: components.bonus,
            traditionalDeferrals: components.traditionalDeferrals,
            hsaContributions: components.hsaContributions,
            otherIncome: components.partTimeIncome,
          });
    const magi = override ?? estimate;
    const room = roomFor(person.id);
    const other = room === null ? null : room.initial - room.remaining;
    let eligibility = null;
    if (magi !== null && room !== null && other !== null) {
      const result = rothIraEligibility(
        {
          magi: magi as Cents,
          filingStatus: household.filingStatus as FilingStatus,
          age: state.comp.age,
          earnedIncome: toCents(earnedIncome(state)),
          otherIraContributions: toCents(other),
        },
        rules,
      );
      if (result.status === 'unverified') access.absorb(result.missing);
      if (result.status === 'ok') {
        eligibility = result.value;
        for (const warning of result.warnings) warnings.push({ ...warning, personId: person.id });
      }
    }
    rothRoom.set(person.id, eligibility === null ? null : eligibility.allowed / 100);
    rothIra.push({
      personId: person.id,
      magiSource: override === null ? 'estimate' : 'override',
      magiComponents: components,
      magi: magi === null ? null : (magi as Cents),
      otherIraContributions: other === null ? null : toCents(other),
      eligibility,
    });
  }

  // 4. Roth IRA schedules.
  for (const a of accounts) {
    if (a.type !== 'rothIra') continue;
    const w = want(a);
    if (w === null) continue;
    const roomLeft = rothRoom.get(a.ownerId) ?? null;
    if (roomLeft === null) {
      allowed.set(a.id, null);
      continue;
    }
    const amount = cap(a, w, roomLeft, 'iraCapped', 'Roth IRA allowed amount');
    rothRoom.set(a.ownerId, roomLeft - amount);
    allowed.set(a.id, amount);
  }

  // 5. Taxable, cash and other accounts.
  for (const a of accounts) {
    if (a.type !== 'taxableBrokerage' && a.type !== 'cash' && a.type !== 'other') continue;
    const w = want(a);
    if (w === null) continue;
    allowed.set(a.id, w === 'max' ? 0 : w);
  }

  const byAccount: CashFlowPreviewRow['scheduled'] = [];
  let total: number | null = 0;
  for (const a of accounts) {
    if (!requested.has(a.id)) continue;
    const r = requested.get(a.id);
    const amount = allowed.get(a.id) ?? null;
    byAccount.push({
      accountId: a.id,
      requested: r === 'max' || r === undefined ? null : toCents(r),
      allowed: amount === null ? null : toCents(amount),
    });
    total = total === null || amount === null ? null : total + amount;
  }
  const hsaPreTax = hsaUnknownOwners.size > 0 ? null : [...hsaByOwner.values()].reduce((x, y) => x + y, 0);
  return { total, hsaPreTax, byAccount, rothIra };
}
