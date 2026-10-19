/**
 * Social Security claiming comparison (docs/financial-model.md §12.9), two input modes.
 *
 * - `pia` (the PIA from an SSA statement): `fullRetirementAge` and `ssBenefitAtClaim` at each whole
 *   claiming age 62–70. These need the verified FRA table and claim factors; with a null value the
 *   calculator returns `unverified` with the missing keys (never a substituted value).
 * - `amountsAtClaimAge` (the monthly benefit at each claiming age, as an SSA statement lists them):
 *   rule-free, because the person's own benefit at the entered claiming age needs no rule value (§7.5).
 *
 * In both modes the lifetime totals come from `projectHousehold`: one run per claiming age of a
 * retired single person whose Social Security input is that claiming age (`statement` PIA, or
 * `atClaimAge` amount), with inflation 0 so that nominal dollars are today's dollars (the COLA follows
 * inflation, §7.5). Each total is the sum of the projection's `flows.socialSecurity` from this year
 * through the chosen age, which includes the claim-year proration by birth month. Break-even ages
 * compare those cumulative sums. No formula is computed here.
 */
import { z } from 'zod';
import type { EngineContext } from '../api';
import type { AgeYearsMonths, CalendarYear, Cents } from '../domain/primitives';
import { AgeSchema, CalendarYearSchema, NonNegativeCentsSchema } from '../domain/primitives';
import type { EngineResult, UnverifiedDetail } from '../domain/results';
import type { HouseholdInput, SocialSecurityInput } from '../domain/household';
import { SocialSecurityInputSchema } from '../domain/household';
import { fullRetirementAge, ssBenefitAtClaim } from '../socialSecurity/socialSecurity';
import { RuleAccess } from '../rules/access';
import {
  CALC_IDS,
  all,
  assumptionsTemplate,
  itemAt,
  mapStep,
  parseInput,
  projectInput,
  ruleValue,
  sumOf,
  toResult,
  type CalculatorLabels,
  type Projected,
} from './common';

const ClaimAgeSchema = SocialSecurityInputSchema.shape.claimAge;

const Common = {
  birthYear: CalendarYearSchema,
  birthMonth: z
    .number()
    .int()
    .min(1, { message: 'Birth month must be 1–12' })
    .max(12, { message: 'Birth month must be 1–12' })
    .default(1),
  /** Lifetime totals are summed through this age (inclusive). */
  throughAge: AgeSchema.refine((a) => a >= 62, { message: 'Totals must run through age 62 or later' }),
};

export const SsClaimingComparisonInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('pia'),
    ...Common,
    /** Monthly benefit at full retirement age (PIA) from the SSA statement, today's dollars. */
    piaMonthly: NonNegativeCentsSchema,
  }),
  z.object({
    mode: z.literal('amountsAtClaimAge'),
    ...Common,
    /** Monthly benefit at each claiming age (today's dollars), as listed on the SSA statement. */
    options: z
      .array(z.object({ claimAge: ClaimAgeSchema, monthlyAtClaim: NonNegativeCentsSchema }))
      .min(1, { message: 'Enter at least one claiming age' })
      .max(12, { message: 'At most 12 claiming ages' })
      .refine((o) => new Set(o.map((x) => x.claimAge.years * 12 + x.claimAge.months)).size === o.length, {
        message: 'Each claiming age can be entered once',
      }),
  }),
]);
export type SsClaimingComparisonInput = z.input<typeof SsClaimingComparisonInputSchema>;

export interface ClaimingOption {
  claimAge: AgeYearsMonths;
  /** Monthly benefit at the claim, today's dollars. */
  monthly: Cents;
  /** Claim factor relative to the PIA (pia mode only). */
  adjustmentFactor: number | null;
  /** Claim months minus FRA months (pia mode only; negative = early). */
  monthsFromFra: number | null;
  /** Calendar year benefits start (prorated by birth month that year). */
  firstBenefitYear: CalendarYear;
  /** Σ benefits from this year through `throughAge`, today's dollars. */
  cumulativeThroughAge: Cents;
  /** Running total at the end of each age from this year through `throughAge`. */
  cumulativeByAge: { age: number; cumulative: Cents }[];
  /** First age at which this option's running total reaches the earliest option's; null if never by `throughAge`. */
  breakEvenAgeVsEarliest: number | null;
}

export interface SsClaimingComparisonResult extends CalculatorLabels {
  /** Full retirement age (pia mode only). */
  fullRetirementAge: AgeYearsMonths | null;
  currentAge: number;
  /** Claiming ages before this year's age cannot be compared and are left out. */
  options: ClaimingOption[];
  /** The option with the highest total through `throughAge` (ties: the earliest). */
  highestTotal: AgeYearsMonths | null;
}

function ssHousehold(
  x: { birthYear: number; birthMonth: number; throughAge: number },
  currentYear: number,
  ss: SocialSecurityInput,
): HouseholdInput {
  const age = currentYear - x.birthYear;
  return {
    id: 'calc-household',
    name: 'Calculator',
    filingStatus: 'single',
    people: [
      {
        id: CALC_IDS.person,
        name: 'You',
        birthYear: x.birthYear,
        birthMonth: x.birthMonth,
        retirementAge: age,
        planningAge: x.throughAge,
        socialSecurity: ss,
      },
    ],
    spending: { currentAnnualSpending: 0, retirementAnnualSpending: 0 },
    assumptions: assumptionsTemplate(currentYear, { inflation: 0, returnPreRetirement: 0, returnPostRetirement: 0 }),
  };
}

const months = (a: AgeYearsMonths) => a.years * 12 + a.months;

export function ssClaimingComparison(
  input: SsClaimingComparisonInput,
  ctx: EngineContext,
): EngineResult<SsClaimingComparisonResult> {
  const parsed = parseInput(SsClaimingComparisonInputSchema, input);
  if (!parsed.ok) return parsed.result;
  const x = parsed.value;
  const currentAge = ctx.currentYear - x.birthYear;
  if (currentAge < 0 || currentAge > x.throughAge) {
    return {
      status: 'invalid',
      issues: [{ path: ['throughAge'], message: 'Totals must run from this year to an age not yet passed' }],
    };
  }

  // The claiming options and the Social Security input each projection uses.
  const candidates: {
    claimAge: AgeYearsMonths;
    monthly: Cents;
    adjustmentFactor: number | null;
    monthsFromFra: number | null;
    ss: SocialSecurityInput;
  }[] = [];
  let fra: AgeYearsMonths | null = null;
  if (x.mode === 'pia') {
    const missing: UnverifiedDetail[] = [];
    fra = ruleValue(fullRetirementAge(x.birthYear, x.birthMonth, ctx.rules.standing), missing);
    for (let years = 62; years <= 70; years++) {
      const claimAge = { years, months: 0 };
      const at = ruleValue(
        ssBenefitAtClaim(
          { piaMonthly: x.piaMonthly, birthYear: x.birthYear, birthMonth: x.birthMonth, claimAge },
          ctx.rules.standing,
        ),
        missing,
      );
      if (at === null) continue;
      candidates.push({
        claimAge,
        monthly: at.monthly,
        adjustmentFactor: at.adjustmentFactor,
        monthsFromFra: at.monthsFromFra,
        ss: { source: { kind: 'statement', piaMonthly: x.piaMonthly }, claimAge },
      });
    }
    // Any null rule value stops the comparison (never a substituted value); keys reported once.
    const access = new RuleAccess('standing');
    access.absorb(missing);
    if (!access.ok) return { status: 'unverified', missing: access.missing };
  } else {
    for (const o of [...x.options].sort((a, b) => months(a.claimAge) - months(b.claimAge))) {
      candidates.push({
        claimAge: o.claimAge,
        monthly: o.monthlyAtClaim,
        adjustmentFactor: null,
        monthsFromFra: null,
        ss: { source: { kind: 'atClaimAge', monthlyAtClaim: o.monthlyAtClaim }, claimAge: o.claimAge },
      });
    }
  }

  // Claim ages already passed this year cannot start benefits in the projection; leave them out.
  const comparable = candidates.filter((c) => c.claimAge.years >= currentAge);
  const runs = all<Projected[]>(...comparable.map((c) => projectInput(ssHousehold(x, ctx.currentYear, c.ss), ctx)));
  return toResult(
    mapStep(runs, (projected) => {
      const options: ClaimingOption[] = comparable.map((c, k) => {
        const byAge: { age: number; cumulative: Cents }[] = [];
        let running = 0 as Cents;
        for (const row of itemAt(projected, k).projection.rows) {
          running = sumOf([running, row.flows.socialSecurity]);
          byAge.push({ age: row.year - x.birthYear, cumulative: running });
        }
        return {
          claimAge: c.claimAge,
          monthly: c.monthly,
          adjustmentFactor: c.adjustmentFactor,
          monthsFromFra: c.monthsFromFra,
          firstBenefitYear: x.birthYear + c.claimAge.years,
          cumulativeThroughAge: running,
          cumulativeByAge: byAge,
          breakEvenAgeVsEarliest: null,
        };
      });
      const earliest = options[0];
      if (earliest) {
        for (const o of options.slice(1)) {
          // Same horizon for every option, so the running totals align by index.
          const hit = o.cumulativeByAge.find(
            (row, k) => row.cumulative > 0 && row.cumulative >= itemAt(earliest.cumulativeByAge, k).cumulative,
          );
          o.breakEvenAgeVsEarliest = hit?.age ?? null;
        }
      }
      let best: ClaimingOption | null = null;
      for (const o of options) if (!best || o.cumulativeThroughAge > best.cumulativeThroughAge) best = o;
      return {
        value: {
          fullRetirementAge: fra,
          currentAge,
          options,
          highestTotal: best?.claimAge ?? null,
          basis: { dollars: 'todaysDollars', tax: 'beforeTaxes', limits: 'notApplicable' },
          // The comparison runs only when every rule value it needs is verified (PIA mode) or when it
          // needs none (amounts mode). Benefits are gross: taxation of benefits is not part of it.
          excludedFeatures: [],
          unverified: [],
          assumptions: [
            'Benefits are in today’s dollars: the cost-of-living adjustment is assumed to match inflation.',
            'Benefits begin in the claim year, prorated by birth month; totals are gross, before any tax on benefits.',
            'Own retirement benefit only; spousal and survivor benefits and the earnings test are not part of this comparison.',
          ],
        },
        warnings: [],
      };
    }),
  );
}
