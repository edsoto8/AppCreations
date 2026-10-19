/**
 * Employment income path (docs/financial-model.md §3.1–3.2). Rule-free: eligible compensation is
 * before the 401(a)(17) limit, which `capContributions` applies.
 */
import type { CalendarYear } from '../domain/primitives';
import type { Household, Person, Raise as EmploymentRaise } from '../domain/household';
import type { EngineResult } from '../domain/results';
import type { CompensationYear, EngineContext } from '../api';
import { toCents } from '../money';
import { priceIndex } from '../time';

/** The person's last age with salary (exclusive bound): stopAge if set, else the retirement age. */
export function salaryStopAge(person: Person): number {
  return person.employment?.stopAge ?? person.retirementAge;
}

/** The nominal raise implied by a raise setting, and the real raise after inflation. */
export function impliedRaise(raise: EmploymentRaise, inflation: number): { nominal: number; real: number } {
  const nominal = raise.mode === 'nominal' ? raise.rate : (1 + inflation) * (1 + raise.realRate) - 1;
  return { nominal, real: (1 + nominal) / (1 + inflation) - 1 };
}

/** Float64 path; exported for the projection, which converts to cents per row. */
export interface CompensationFloat {
  year: CalendarYear;
  age: number;
  working: boolean;
  baseSalary: number;
  bonus: number;
  partTimeIncome: number;
  eligibleForDeferrals: number;
  eligibleForMatch: number;
  nominalRaise: number;
  realRaise: number;
}

export function compensationPathFloat(
  person: Person,
  firstYear: CalendarYear,
  years: number,
  inflation: number,
): CompensationFloat[] {
  const employment = person.employment;
  const stopAge = salaryStopAge(person);
  const rows: CompensationFloat[] = [];
  const overrides = new Map((employment?.raiseOverrides ?? []).map((o) => [o.year, o.rate as number]));
  let base = employment ? employment.baseSalary / 100 : 0;
  let fixedBonus = employment?.bonus.kind === 'fixed' ? employment.bonus.amount / 100 : 0;

  for (let t = 1; t <= years; t++) {
    const year = firstYear + t - 1;
    const age = year - person.birthYear;
    let nominalRaise = 0;
    if (employment && t > 1) {
      const override = overrides.get(year);
      nominalRaise = override ?? impliedRaise(employment.raise, inflation).nominal;
      base *= 1 + nominalRaise;
      if (employment.bonus.kind === 'fixed') {
        const bonusGrowth =
          employment.bonusGrowth.mode === 'withSalary'
            ? nominalRaise
            : employment.bonusGrowth.mode === 'ownRate'
              ? employment.bonusGrowth.rate
              : 0;
        fixedBonus *= 1 + bonusGrowth;
      }
    }
    const working = !!employment && age < stopAge;
    const salary = working ? base : 0;
    const bonus = !working
      ? 0
      : employment.bonus.kind === 'percentOfSalary'
        ? employment.bonus.pct * base
        : employment.bonus.kind === 'fixed'
          ? fixedBonus
          : 0;
    const pt = employment?.partTime;
    // SIMPLIFICATION: part-time income is entered in today's dollars and grows with inflation.
    // Part-time pay stops after the person's planning age (modeled death, §1.4).
    const partTimeIncome =
      pt && age >= pt.startAge && age < pt.endAge && age <= person.planningAge
        ? (pt.annualIncome / 100) * priceIndex(inflation, t)
        : 0;
    rows.push({
      year,
      age,
      working,
      baseSalary: salary,
      bonus,
      partTimeIncome,
      eligibleForDeferrals: salary + (employment?.bonusCountsForDeferrals ? bonus : 0),
      eligibleForMatch: salary + (employment?.bonusCountsForMatch ? bonus : 0),
      nominalRaise: t > 1 ? nominalRaise : 0,
      realRaise: t > 1 ? (1 + nominalRaise) / (1 + inflation) - 1 : 0,
    });
  }
  return rows;
}

export function computeCompensationPath(
  household: Household,
  personId: string,
  ctx: EngineContext,
  years: number,
): EngineResult<CompensationYear[]> {
  const person = household.people.find((p) => p.id === personId);
  if (!person) return { status: 'invalid', issues: [{ path: ['personId'], message: `Unknown person "${personId}"` }] };
  if (!Number.isInteger(years) || years < 1 || years > 120) {
    return { status: 'invalid', issues: [{ path: ['years'], message: 'Years must be between 1 and 120' }] };
  }
  const rows = compensationPathFloat(person, ctx.currentYear, years, household.assumptions.inflation);
  return {
    status: 'ok',
    value: rows.map((r) => ({
      year: r.year,
      age: r.age,
      working: r.working,
      baseSalary: toCents(r.baseSalary),
      bonus: toCents(r.bonus),
      partTimeIncome: toCents(r.partTimeIncome),
      totalCompensation: toCents(r.baseSalary + r.bonus + r.partTimeIncome),
      eligibleCompForDeferrals: toCents(r.eligibleForDeferrals),
      eligibleCompForMatch: toCents(r.eligibleForMatch),
      nominalRaise: r.nominalRaise,
      realRaise: r.realRaise,
    })),
    warnings: [],
  };
}
