/**
 * One account-year update (docs/financial-model.md §1.5–1.6, §4). Every timing mode is linear in the
 * flows: E = gS·S + gC·C − gW·W, with growth factors that depend only on the rate, the withdrawal
 * timing and the granularity. The withdrawal cap is the largest W that keeps E (and, for start-of-year
 * withdrawals, the start balance) non-negative.
 */
import type { Account, TaxTreatment } from '../domain/household';

export type WithdrawalTiming = 'midYear' | 'startOfYear';
export type Granularity = 'annual' | 'monthly';

export interface GrowthFactors {
  gS: number;
  gC: number;
  gW: number;
  /** Start-of-year withdrawals cannot exceed the start balance. */
  capAtStart: boolean;
}

/** Monthly rate equivalent to an annual rate: (1 + ρ)^(1/12) − 1. */
export function monthlyRate(rate: number): number {
  return Math.pow(1 + rate, 1 / 12) - 1;
}

export function growthFactors(rate: number, timing: WithdrawalTiming, granularity: Granularity): GrowthFactors {
  const gS = 1 + rate;
  if (granularity === 'annual') {
    const half = Math.sqrt(1 + rate);
    // Contributions are always mid-year; withdrawals mid-year or (conservative) at the start.
    return timing === 'midYear'
      ? { gS, gC: half, gW: half, capAtStart: false }
      : { gS, gC: half, gW: gS, capAtStart: true };
  }
  // Monthly: each month the balance grows by ρ_m, then C/12 is added and W/12 removed (end of month);
  // conservative timing takes W/12 at the start of each month instead.
  const rm = monthlyRate(rate);
  const endOfMonth = Math.abs(rm) < 1e-15 ? 1 : rate / (12 * rm);
  return timing === 'midYear'
    ? { gS, gC: endOfMonth, gW: endOfMonth, capAtStart: false }
    : { gS, gC: endOfMonth, gW: endOfMonth * (1 + rm), capAtStart: false };
}

/** Largest withdrawal that keeps the account non-negative. */
export function withdrawalCap(start: number, contributions: number, f: GrowthFactors): number {
  if (start <= 0 && contributions <= 0) return 0;
  if (f.capAtStart) return Math.max(0, start);
  return Math.max(0, (f.gS * start + f.gC * contributions) / f.gW);
}

export function endBalance(start: number, contributions: number, withdrawals: number, f: GrowthFactors): number {
  const end = f.gS * start + f.gC * contributions - f.gW * withdrawals;
  // Withdrawals never exceed the cap, so only float noise can make this negative.
  return end < 0 ? 0 : end;
}

export type WithdrawalCategory = 'cash' | 'taxable' | 'traditional' | 'roth' | 'hsa';

export function taxTreatmentOf(account: Account): TaxTreatment {
  switch (account.type) {
    case 'workplaceTraditional':
    case 'traditionalIra':
      return 'taxDeferred';
    case 'workplaceRoth':
    case 'rothIra':
    case 'hsa':
      return 'taxFree';
    case 'taxableBrokerage':
    case 'cash':
      return 'taxable';
    case 'other':
      return account.taxTreatment;
  }
}

export function withdrawalCategoryOf(account: Account): WithdrawalCategory {
  switch (account.type) {
    case 'cash':
      return 'cash';
    case 'taxableBrokerage':
      return 'taxable';
    case 'workplaceTraditional':
    case 'traditionalIra':
      return 'traditional';
    case 'workplaceRoth':
    case 'rothIra':
      return 'roth';
    case 'hsa':
      return 'hsa';
    case 'other':
      return account.taxTreatment === 'taxDeferred'
        ? 'traditional'
        : account.taxTreatment === 'taxFree'
          ? 'roth'
          : 'taxable';
  }
}

/** Accounts in each group are drawn pro rata by available balance; groups are drawn in order. */
export const WITHDRAWAL_ORDER: Record<
  'taxableFirst' | 'traditionalFirst' | 'rothLast' | 'proportional',
  WithdrawalCategory[][]
> = {
  taxableFirst: [['cash'], ['taxable'], ['traditional'], ['roth'], ['hsa']],
  traditionalFirst: [['traditional'], ['cash'], ['taxable'], ['roth'], ['hsa']],
  rothLast: [['cash', 'taxable', 'traditional'], ['hsa'], ['roth']],
  proportional: [['cash', 'taxable', 'traditional', 'roth', 'hsa']],
};

/**
 * Allocate a withdrawal need across accounts. Returns per-account withdrawals and the unfunded rest.
 * `caps` are the per-account maxima; the result never exceeds them.
 */
export function allocateWithdrawals(
  need: number,
  accounts: readonly { id: string; category: WithdrawalCategory }[],
  caps: ReadonlyMap<string, number>,
  order: WithdrawalCategory[][],
): { byAccount: Map<string, number>; unfunded: number } {
  const byAccount = new Map<string, number>();
  let remaining = Math.max(0, need);
  for (const group of order) {
    if (remaining <= 0) break;
    const members = accounts.filter((a) => group.includes(a.category));
    const available = members.reduce((sum, a) => sum + (caps.get(a.id) ?? 0), 0);
    if (available <= 0) continue;
    const take = Math.min(remaining, available);
    for (const a of members) {
      const cap = caps.get(a.id) ?? 0;
      if (cap > 0) byAccount.set(a.id, take === available ? cap : (take * cap) / available);
    }
    remaining -= take;
  }
  return { byAccount, unfunded: remaining };
}
