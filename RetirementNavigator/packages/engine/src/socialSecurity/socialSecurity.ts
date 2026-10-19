/**
 * Social Security (docs/financial-model.md §7.5): full retirement age, the claim factor (early
 * reduction / delayed credits), the illustrative PIA estimator, and the simple spousal and survivor
 * models. Every rule value is read through `RuleAccess`; a null value makes the call return
 * `unverified` with its key and is never replaced by a default.
 *
 * Money is integer cents at the boundary and float64 dollars inside; each output converts once with
 * round-half-even (`toCents`), except the estimator's AIME/PIA, which truncate as described below.
 */
import type { AgeYearsMonths, CalendarYear, Cents, NominalRate } from '../domain/primitives';
import type { EngineResult, EngineWarning, RuleDependentFeature, UnverifiedDetail } from '../domain/results';
import type { RuleKey, RulesSet, StandingRules } from '../domain/rules';
import { RuleAccess, unverified } from '../rules/access';
import { resolveRules } from '../rules/resolve';
import { asCents, toCents } from '../money';

/** Claiming ages the household schema accepts (domain/household.ts): 62y0m to 70y0m. */
const MIN_CLAIM_MONTHS = 62 * 12;
const MAX_CLAIM_MONTHS = 70 * 12;
/** §7.5 estimator: the top 35 years, AIME = Σ / 420 (35 years × 12 months). */
const COMPUTATION_YEARS = 35;
/** §7.5 estimator: eligibility year = the year the person turns 62. */
const ELIGIBILITY_AGE = 62;

export const ILLUSTRATIVE_LABEL = 'Illustrative estimate — not an official SSA calculation';

const totalMonths = (a: AgeYearsMonths) => a.years * 12 + a.months;

function invalid(path: (string | number)[], message: string): EngineResult<never> {
  return { status: 'invalid', issues: [{ path, message }] };
}

function gap(key: RuleKey, reason: string, feature: RuleDependentFeature): UnverifiedDetail {
  return { key, reason, features: [feature] };
}

const isYear = (y: number) => Number.isInteger(y) && y >= 1900 && y <= 2200;
const isMonth = (m: number) => Number.isInteger(m) && m >= 1 && m <= 12;
const isCents = (c: number) => Number.isSafeInteger(c) && c >= 0;

function checkBirth(birthYear: number, birthMonth: number): EngineResult<never> | null {
  if (!isYear(birthYear)) return invalid(['birthYear'], 'Birth year must be a calendar year');
  if (!isMonth(birthMonth)) return invalid(['birthMonth'], 'Birth month must be 1–12');
  return null;
}

function checkClaimAge(claimAge: AgeYearsMonths): EngineResult<never> | null {
  const m = totalMonths(claimAge);
  if (
    !Number.isInteger(claimAge.years) ||
    !Number.isInteger(claimAge.months) ||
    claimAge.months < 0 ||
    claimAge.months > 11
  ) {
    return invalid(['claimAge'], 'Claiming age must be whole years and 0–11 months');
  }
  if (m < MIN_CLAIM_MONTHS || m > MAX_CLAIM_MONTHS)
    return invalid(['claimAge'], 'Claiming age must be between 62 and 70');
  return null;
}

/** FRA from the verified table; records a gap (unverified) when the table is null or has no entry. */
function lookupFra(
  birthYear: number,
  standing: StandingRules,
  access: RuleAccess,
  feature: RuleDependentFeature,
): AgeYearsMonths | null {
  const table = access.get(standing.socialSecurity.fraByBirthYear, 'socialSecurity.fraByBirthYear', feature);
  if (table === null) return null;
  const entry = table.find(
    (e) => e.fromBirthYear <= birthYear && (e.toBirthYear === null || birthYear <= e.toBirthYear),
  );
  if (!entry) {
    access.absorb([
      gap(
        'standing:socialSecurity.fraByBirthYear',
        `Full retirement age not published for birth year ${birthYear} in the rules data.`,
        feature,
      ),
    ]);
    return null;
  }
  return { years: entry.years, months: entry.months };
}

export function fullRetirementAge(
  birthYear: CalendarYear,
  birthMonth: number,
  standing: StandingRules,
): EngineResult<AgeYearsMonths> {
  const bad = checkBirth(birthYear, birthMonth);
  if (bad) return bad;
  // SIMPLIFICATION: the FRA depends on the birth year only; SSA's rule that a person born on
  // January 1 belongs to the prior year is not modeled (no birth day is collected).
  const access = new RuleAccess('standing');
  const fra = lookupFra(birthYear, standing, access, 'socialSecurityClaiming');
  if (fra === null) return unverified(access.missing);
  return { status: 'ok', value: fra, warnings: [] };
}

/**
 * Own retirement benefit at a claiming age, §7.5 claim factor with m = FRA months − claim months:
 * m > 0: f = 1 − (r1·min(m, 36) + r2·max(0, m − 36)); m < 0: f = 1 + d·min(−m, months to the max age).
 * `monthsFromFra` = claim months − FRA months (negative = claimed early, positive = delayed).
 */
export function ssBenefitAtClaim(
  input: { piaMonthly: Cents; birthYear: CalendarYear; birthMonth: number; claimAge: AgeYearsMonths },
  standing: StandingRules,
): EngineResult<{ monthly: Cents; adjustmentFactor: number; monthsFromFra: number }> {
  const bad =
    checkBirth(input.birthYear, input.birthMonth) ??
    checkClaimAge(input.claimAge) ??
    (isCents(input.piaMonthly) ? null : invalid(['piaMonthly'], 'PIA must be a non-negative whole number of cents'));
  if (bad) return bad;

  const feature: RuleDependentFeature = 'socialSecurityClaiming';
  const access = new RuleAccess('standing');
  const fra = lookupFra(input.birthYear, standing, access, feature);
  if (fra === null) return unverified(access.missing);

  const fraMonths = totalMonths(fra);
  const m = fraMonths - totalMonths(input.claimAge);
  const ss = standing.socialSecurity;
  let factor = 1;
  if (m > 0) {
    const r = access.get(ss.earlyReduction, 'socialSecurity.earlyReduction', feature);
    if (r === null) return unverified(access.missing);
    factor = 1 - (r.first36PerMonth * Math.min(m, 36) + r.beyond36PerMonth * Math.max(0, m - 36));
  } else if (m < 0) {
    const d = access.get(ss.delayedCreditPerMonth, 'socialSecurity.delayedCreditPerMonth', feature);
    const maxAge = access.get(ss.delayedCreditMaxAge, 'socialSecurity.delayedCreditMaxAge', feature);
    if (d === null || maxAge === null) return unverified(access.missing);
    const creditMonths = Math.min(-m, Math.max(0, maxAge * 12 - fraMonths));
    factor = 1 + d * creditMonths;
  }
  // SIMPLIFICATION: SSA truncates the reduced benefit to the dime (and the payment to the dollar);
  // the engine rounds the monthly amount to the cent (round half to even), per §1.3.
  return {
    status: 'ok',
    value: {
      monthly: toCents((input.piaMonthly / 100) * factor),
      adjustmentFactor: factor,
      monthsFromFra: totalMonths(input.claimAge) - fraMonths,
    },
    warnings: [],
  };
}

type PiaInput =
  | { kind: 'average'; birthYear: CalendarYear; averageAnnualEarnings: Cents; yearsOfEarnings: number }
  | { kind: 'history'; birthYear: CalendarYear; earnings: { year: CalendarYear; earnings: Cents }[] };

function checkPiaInput(input: PiaInput): EngineResult<never> | null {
  if (!isYear(input.birthYear)) return invalid(['birthYear'], 'Birth year must be a calendar year');
  if (input.kind === 'average') {
    if (!isCents(input.averageAnnualEarnings)) {
      return invalid(['averageAnnualEarnings'], 'Average earnings must be a non-negative whole number of cents');
    }
    if (!Number.isInteger(input.yearsOfEarnings) || input.yearsOfEarnings < 0 || input.yearsOfEarnings > 80) {
      return invalid(['yearsOfEarnings'], 'Years of earnings must be a whole number from 0 to 80');
    }
    return null;
  }
  const seen = new Set<number>();
  for (const [i, e] of input.earnings.entries()) {
    if (!isYear(e.year)) return invalid(['earnings', i, 'year'], 'Earnings year must be a calendar year');
    if (seen.has(e.year)) return invalid(['earnings', i, 'year'], `Earnings for ${e.year} are entered twice`);
    seen.add(e.year);
    if (!isCents(e.earnings)) {
      return invalid(['earnings', i, 'earnings'], 'Earnings must be a non-negative whole number of cents');
    }
  }
  return null;
}

/**
 * Illustrative PIA estimate — NOT an official SSA calculation (§7.5).
 *
 * - Eligibility year E = birthYear + 62.
 * - History: each year's earnings are wage-indexed to the indexing year I = E − 2 with the AWI series
 *   (`earnings · AWI_I / AWI_year`); years after I count at nominal value. When AWI for I is not yet
 *   in the rules (a younger worker), earnings are indexed to the latest AWI year instead, so the
 *   estimate is at that year's wage level (labeled). The top 35 indexed years are summed.
 * - Average: Σ = average · min(years, 35) (so AIME = avg·min(years,35)/35/12).
 * - AIME = Σ / 420, TRUNCATED to the whole dollar; PIA from the three factors and two bend points,
 *   TRUNCATED to the dime. (Our reading of SSA practice: AIME is rounded down to the dollar and the
 *   PIA down to the dime; the doc states only the dime truncation of the PIA.)
 * - Bend points: history mode uses E's bend points, resolved with `resolveRules` (anchor = the latest
 *   tax year in the rules, index rate 0). If E is later than the published years, the latest verified
 *   year ≤ E is carried unchanged (labeled "projected", consistent with indexing earnings to the latest
 *   AWI year: both are at today's wage level). If no year ≤ E exists, the result is `unverified`.
 *   Average mode uses the current year's bend points; the signature has no current year, so this is
 *   the latest tax year present in `rules.years` (stated in the label).
 */
export function estimatePia(
  input: PiaInput,
  rules: RulesSet,
): EngineResult<{ piaMonthly: Cents; aimeMonthly: Cents; eligibilityYear: CalendarYear; label: string }> {
  const bad = checkPiaInput(input);
  if (bad) return bad;
  const feature: RuleDependentFeature = 'socialSecurityEstimator';
  const eligibilityYear = input.birthYear + ELIGIBILITY_AGE;
  const notes: string[] = [];
  const warnings: EngineWarning[] = [];

  const years = Object.keys(rules.years)
    .map(Number)
    .sort((a, b) => a - b);
  const latestYear = years[years.length - 1];
  const bendYear = input.kind === 'average' ? latestYear : eligibilityYear;
  const standingAccess = new RuleAccess('standing');
  const factors = standingAccess.get(rules.standing.socialSecurity.piaFactors, 'socialSecurity.piaFactors', feature);

  // Bend points (tax-year rule).
  const yearAccess = new RuleAccess(bendYear ?? eligibilityYear);
  let bend: { first: number; second: number } | null = null;
  if (latestYear === undefined || bendYear === undefined) {
    standingAccess.absorb([
      gap(`${eligibilityYear}:socialSecurity.bendPoints`, 'No tax-year rules data to read bend points from.', feature),
    ]);
  } else {
    const resolved = resolveRules(rules, {
      anchorYear: latestYear,
      targetYear: bendYear,
      indexRate: 0 as NominalRate,
    });
    const bp = yearAccess.get(resolved.values.socialSecurity.bendPoints, 'socialSecurity.bendPoints', feature);
    if (bp !== null) {
      bend = { first: bp.first / 100, second: bp.second / 100 };
      if (resolved.projected) {
        notes.push(`bend points of ${resolved.baseYear} carried to eligibility year ${bendYear} (projected)`);
        warnings.push({
          code: 'rulesProjected',
          year: bendYear,
          message: `Bend points for ${bendYear} are not published; the ${resolved.baseYear} bend points are used (projected, today's wage level).`,
        });
      } else if (input.kind === 'average') {
        notes.push(`bend points of ${bendYear}, the latest tax year in the rules (used as the current year)`);
      }
    }
  }

  // Sum of the top 35 years (dollars).
  let total = 0;
  if (input.kind === 'average') {
    total = (input.averageAnnualEarnings / 100) * Math.min(input.yearsOfEarnings, COMPUTATION_YEARS);
    notes.push(`average earnings × min(years, ${COMPUTATION_YEARS})`);
  } else {
    const awi = standingAccess.get(rules.standing.socialSecurity.awiSeries, 'socialSecurity.awiSeries', feature);
    if (awi !== null) {
      const awiBy = new Map(awi.map((a) => [a.year, a.awi / 100]));
      const latestAwi = awi.reduce<number | null>((m, a) => (m === null || a.year > m ? a.year : m), null);
      const target = latestAwi === null ? eligibilityYear - 2 : Math.min(eligibilityYear - 2, latestAwi);
      const targetAwi = awiBy.get(target);
      const missingYears: number[] = [];
      const indexed: number[] = [];
      for (const e of input.earnings) {
        const nominal = e.earnings / 100;
        if (nominal === 0) continue;
        if (e.year >= target) {
          indexed.push(nominal);
          continue;
        }
        const yearAwi = awiBy.get(e.year);
        if (yearAwi === undefined || targetAwi === undefined) missingYears.push(e.year);
        else indexed.push((nominal * targetAwi) / yearAwi);
      }
      if (missingYears.length > 0 && targetAwi === undefined) missingYears.push(target);
      if (missingYears.length > 0) {
        const list = [...new Set(missingYears)].sort((a, b) => a - b).join(', ');
        standingAccess.absorb([
          gap(
            'standing:socialSecurity.awiSeries',
            `The AWI series in the rules data has no value for ${list}.`,
            feature,
          ),
        ]);
      } else {
        indexed.sort((a, b) => b - a);
        total = indexed.slice(0, COMPUTATION_YEARS).reduce((s, v) => s + v, 0);
        notes.push(
          target < eligibilityYear - 2
            ? `earnings indexed to ${target}, the latest AWI year (today's wage level), not ${eligibilityYear - 2}`
            : `earnings indexed to ${target}`,
        );
        notes.push(`top ${COMPUTATION_YEARS} of ${indexed.length} year(s) with earnings`);
        notes.push("entered earnings assumed already capped at each year's taxable maximum");
      }
    }
  }

  const missing = [...standingAccess.missing, ...yearAccess.missing];
  if (missing.length > 0 || factors === null || bend === null) return unverified(missing);

  const aime = Math.floor(total / (COMPUTATION_YEARS * 12) + 1e-9);
  const [f1, f2, f3] = factors;
  const { first: b1, second: b2 } = bend;
  const pia = f1 * Math.min(aime, b1) + f2 * Math.min(Math.max(aime - b1, 0), b2 - b1) + f3 * Math.max(0, aime - b2);
  const dimes = Math.floor(pia * 10 + 1e-9);
  warnings.unshift({
    code: 'ssEstimateIllustrative',
    message: `${ILLUSTRATIVE_LABEL}. Use the PIA from your SSA statement for a better figure.`,
  });
  return {
    status: 'ok',
    value: {
      piaMonthly: asCents(dimes * 10),
      aimeMonthly: asCents(aime * 100),
      eligibilityYear,
      label: `${ILLUSTRATIVE_LABEL} (${notes.join('; ')}; AIME truncated to the dollar, PIA to the dime).`,
    },
    warnings,
  };
}

/**
 * Spousal excess (§7.5): max(0, maxShareOfPia·PIA_other − PIA_own), reduced for claiming before the
 * claimant's own FRA by s1 per month for the first 36 months and s2 beyond. No delayed credits.
 */
export function spousalBenefit(
  input: {
    ownPiaMonthly: Cents;
    otherPiaMonthly: Cents;
    birthYear: CalendarYear;
    birthMonth: number;
    claimAge: AgeYearsMonths;
  },
  standing: StandingRules,
): EngineResult<{ monthlyExcess: Cents }> {
  const bad =
    checkBirth(input.birthYear, input.birthMonth) ??
    checkClaimAge(input.claimAge) ??
    (isCents(input.ownPiaMonthly)
      ? null
      : invalid(['ownPiaMonthly'], 'PIA must be a non-negative whole number of cents')) ??
    (isCents(input.otherPiaMonthly)
      ? null
      : invalid(['otherPiaMonthly'], 'PIA must be a non-negative whole number of cents'));
  if (bad) return bad;

  const feature: RuleDependentFeature = 'spousalSurvivorBenefits';
  const access = new RuleAccess('standing');
  const spousal = access.get(standing.socialSecurity.spousal, 'socialSecurity.spousal', feature);
  if (spousal === null) return unverified(access.missing);
  const excess = Math.max(0, (spousal.maxShareOfPia * input.otherPiaMonthly) / 100 - input.ownPiaMonthly / 100);
  // The FRA is needed only when there is an excess to reduce.
  if (excess === 0) return { status: 'ok', value: { monthlyExcess: asCents(0) }, warnings: [] };
  const fra = lookupFra(input.birthYear, standing, access, feature);
  if (fra === null) return unverified(access.missing);
  const m = totalMonths(fra) - totalMonths(input.claimAge);
  const factor =
    m > 0 ? 1 - (spousal.first36PerMonth * Math.min(m, 36) + spousal.beyond36PerMonth * Math.max(0, m - 36)) : 1;
  return { status: 'ok', value: { monthlyExcess: toCents(excess * factor) }, warnings: [] };
}

/**
 * Survivor benefit, simple model (§7.5): max(own, maxShareOfDeceased·deceased's benefit, and — when a
 * PIA is known — ribLimFloorShareOfPia·deceased PIA). The survivor's own early-claim survivor
 * reduction is not modeled (SIMPLIFICATION, §7.5).
 */
export function survivorBenefit(
  input: { survivorOwnMonthly: Cents; deceasedBenefitMonthly: Cents; deceasedPiaMonthly: Cents },
  standing: StandingRules,
): EngineResult<{ monthly: Cents }> {
  for (const k of ['survivorOwnMonthly', 'deceasedBenefitMonthly', 'deceasedPiaMonthly'] as const) {
    if (!isCents(input[k])) return invalid([k], 'Amount must be a non-negative whole number of cents');
  }
  const access = new RuleAccess('standing');
  const survivor = access.get(standing.socialSecurity.survivor, 'socialSecurity.survivor', 'spousalSurvivorBenefits');
  if (survivor === null) return unverified(access.missing);
  const fromDeceased = (survivor.maxShareOfDeceased * input.deceasedBenefitMonthly) / 100;
  const floor = input.deceasedPiaMonthly > 0 ? (survivor.ribLimFloorShareOfPia * input.deceasedPiaMonthly) / 100 : 0;
  const monthly = Math.max(input.survivorOwnMonthly / 100, fromDeceased, floor);
  return { status: 'ok', value: { monthly: toCents(monthly) }, warnings: [] };
}
