/**
 * Employer match on the single shared EmployerMatchRule (docs/financial-model.md §3.5).
 * Tier k covers the band [a_k, a_k + β_k) of the deferral rate, with a_1 = 0 and a_{k+1} = a_k + β_k.
 */
import type { Cents, Fraction } from '../domain/primitives';
import type { EmployerMatchRule, VestingSchedule } from '../domain/household';
import type { MatchBreakdown } from '../api';
import { toCents } from '../money';

/** Float64 core: dollars in, dollars out. */
export function matchFloat(rule: EmployerMatchRule, eligibleComp: number, employeeDeferral: number) {
  const pay = Math.max(0, eligibleComp);
  const rate = pay > 0 ? Math.max(0, employeeDeferral) / pay : 0;
  const cap = rule.annualMatchCap === null ? Number.POSITIVE_INFINITY : rule.annualMatchCap / 100;

  const perTier: number[] = [];
  let start = 0;
  let uncapped = 0;
  let possibleUncapped = 0;
  for (const tier of rule.tiers) {
    const covered = Math.min(Math.max(rate - start, 0), tier.bandPctOfPay);
    const earned = tier.matchRate * covered * pay;
    perTier.push(earned);
    uncapped += earned;
    possibleUncapped += tier.matchRate * tier.bandPctOfPay * pay;
    start += tier.bandPctOfPay;
  }
  const match = Math.min(uncapped, cap);
  const possible = Math.min(possibleUncapped, cap);

  // Smallest deferral rate that earns the full possible match (the cap can bind inside a tier).
  let captureRate = 0;
  let cumulative = 0;
  let bandStart = 0;
  for (const tier of rule.tiers) {
    const tierMax = tier.matchRate * tier.bandPctOfPay * pay;
    if (tier.matchRate > 0 && pay > 0) {
      if (cumulative + tierMax >= cap) {
        captureRate = bandStart + (cap - cumulative) / (tier.matchRate * pay);
        break;
      }
      cumulative += tierMax;
      captureRate = bandStart + tier.bandPctOfPay;
    }
    bandStart += tier.bandPctOfPay;
  }

  return {
    perTier,
    match,
    flat: rule.flatPctOfPay * pay,
    possible,
    captureRate,
    captureDollars: captureRate * pay,
  };
}

export function computeMatch(rule: EmployerMatchRule, eligibleComp: Cents, employeeDeferral: Cents): MatchBreakdown {
  const f = matchFloat(rule, eligibleComp / 100, employeeDeferral / 100);
  const match = toCents(f.match);
  const flat = toCents(f.flat);
  const maxPossibleMatch = toCents(f.possible);
  return {
    perTier: f.perTier.map(toCents),
    match,
    flat,
    total: (match + flat) as Cents,
    maxPossibleMatch,
    pctToCaptureFullMatch: f.captureRate as Fraction,
    dollarsToCaptureFullMatch: toCents(f.captureDollars),
    unclaimed: Math.max(0, maxPossibleMatch - match) as Cents,
  };
}

/** Vested share of employer money after `yearsOfService` completed years. */
export function vestedFraction(vesting: VestingSchedule, yearsOfService: number): number {
  switch (vesting.kind) {
    case 'immediate':
      return 1;
    case 'cliff':
      return yearsOfService >= vesting.years ? 1 : 0;
    case 'graded': {
      if (yearsOfService < 1) return 0;
      const index = Math.min(yearsOfService, vesting.vestedByYear.length) - 1;
      return vesting.vestedByYear[index] ?? 1;
    }
  }
}
