/**
 * Gross-up solver (docs/financial-model.md §7.2): find gross withdrawals W so that
 * fixed cash + W − tax(W) = net need, by bounded fixed-point iteration. Taxes depend on how W is
 * split across accounts (ordinary income for traditional and HSA non-medical, gains for the gain
 * part of taxable-brokerage withdrawals; Roth and cash untaxed).
 */
import type { Cents, FilingStatus, Fraction } from '../domain/primitives';
import type { EngineResult, UnverifiedDetail } from '../domain/results';
import type { GrossUpSolution, GrossUpState, ResolvedYearRules, TaxBreakdown } from '../api';
import { computeTax } from './tax';
import { asCents, toCents } from '../money';
import {
  WITHDRAWAL_ORDER,
  allocateWithdrawals,
  withdrawalCategoryOf,
  type WithdrawalCategory,
} from '../projection/accounts';

export interface SolverAccount {
  id: string;
  category: WithdrawalCategory;
  /** Available this year (after RMDs and HSA medical). */
  cap: number;
  /** Taxable brokerage: basis available (basis + contributions); 0 otherwise. */
  basis: number;
  /** HSA non-medical and traditional withdrawals are ordinary income. */
  ordinary: boolean;
  /** Taxable brokerage: the gain fraction is a long-term gain. */
  gains: boolean;
}

export interface SolverInput {
  need: number;
  /** Cash already received this year (pay, SS, pensions, other income, RMDs, HSA medical). */
  fixedCash: number;
  /** Tax inputs from the fixed income (dollars). */
  wages: number;
  wagesByPerson: number[];
  ordinary: number;
  socialSecurity: number;
  gains: number;
  filingStatus: FilingStatus;
  ages: number[];
  stateTaxRate: number;
  accounts: SolverAccount[];
  order: WithdrawalCategory[][];
  /** Bracket fill: traditional withdrawals are taken first, up to this amount; null = plain order. */
  traditionalFirstUpTo: number | null;
  maxIterations: number;
  toleranceDollars: number;
}

export interface SolverResult {
  byAccount: Map<string, number>;
  withdrawn: number;
  tax: TaxBreakdown;
  iterations: number;
  converged: boolean;
  /** Net need left unfunded (depletion). */
  unfunded: number;
  /** Net cash beyond the need when fixed income alone exceeds it (to reinvest). */
  excess: number;
  /** Long-term gains in the final tax (fixed gains plus the gain part of taxable withdrawals). */
  gains: number;
}

function gainsFor(input: SolverInput, byAccount: Map<string, number>): number {
  let gains = input.gains;
  for (const a of input.accounts) {
    const w = byAccount.get(a.id) ?? 0;
    if (w > 0 && a.gains && a.cap > 0) gains += Math.max(0, w * (1 - a.basis / a.cap));
  }
  return gains;
}

function allocate(input: SolverInput, gross: number): Map<string, number> {
  const caps = new Map(input.accounts.map((a) => [a.id, a.cap]));
  const list = input.accounts.map((a) => ({ id: a.id, category: a.category }));
  if (input.traditionalFirstUpTo === null) return allocateWithdrawals(gross, list, caps, input.order).byAccount;
  // Bracket fill: traditional first up to the bracket room, then the rest in the given order.
  const first = allocateWithdrawals(Math.min(gross, input.traditionalFirstUpTo), list, caps, [['traditional']]);
  const remaining = new Map(caps);
  let taken = 0;
  for (const [id, w] of first.byAccount) {
    remaining.set(id, (remaining.get(id) ?? 0) - w);
    taken += w;
  }
  const rest = allocateWithdrawals(gross - taken, list, remaining, input.order).byAccount;
  for (const [id, w] of first.byAccount) rest.set(id, (rest.get(id) ?? 0) + w);
  return rest;
}

function taxFor(
  input: SolverInput,
  byAccount: Map<string, number>,
  rules: ResolvedYearRules,
): EngineResult<TaxBreakdown> {
  let ordinary = input.ordinary;
  let gains = input.gains;
  for (const a of input.accounts) {
    const w = byAccount.get(a.id) ?? 0;
    if (w <= 0) continue;
    if (a.ordinary) ordinary += w;
    if (a.gains && a.cap > 0) gains += Math.max(0, w * (1 - a.basis / a.cap));
  }
  return computeTax(
    {
      filingStatus: input.filingStatus,
      ages: input.ages,
      wages: toCents(input.wages),
      wagesByPerson: input.wagesByPerson.map(toCents),
      otherOrdinaryIncome: toCents(ordinary),
      socialSecurityBenefits: toCents(input.socialSecurity),
      longTermCapitalGains: toCents(gains),
      preTaxDeductions: 0 as Cents,
      stateTaxRate: input.stateTaxRate as Fraction,
    },
    rules,
  );
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);

export function solveWithdrawals(
  input: SolverInput,
  rules: ResolvedYearRules,
): { status: 'ok'; value: SolverResult } | { status: 'unverified'; missing: UnverifiedDetail[] } {
  const totalCap = input.accounts.reduce((s, a) => s + Math.max(0, a.cap), 0);
  const evaluate = (gross: number) => {
    const byAccount = allocate(input, Math.min(Math.max(0, gross), totalCap));
    const tax = taxFor(input, byAccount, rules);
    return { byAccount, tax };
  };
  const zero = evaluate(0);
  if (zero.tax.status === 'unverified') return { status: 'unverified', missing: zero.tax.missing };
  if (zero.tax.status !== 'ok') throw new RangeError('tax input invalid');
  const net0 = input.fixedCash - zero.tax.value.totalTax / 100;
  if (net0 >= input.need) {
    return {
      status: 'ok',
      value: {
        byAccount: zero.byAccount,
        withdrawn: 0,
        tax: zero.tax.value,
        iterations: 0,
        converged: true,
        unfunded: 0,
        excess: net0 - input.need,
        gains: gainsFor(input, zero.byAccount),
      },
    };
  }
  let gross = input.need - net0;
  let current = evaluate(gross);
  let iterations = 1;
  let converged = false;
  for (; iterations <= input.maxIterations; iterations++) {
    if (current.tax.status === 'unverified') return { status: 'unverified', missing: current.tax.missing };
    if (current.tax.status !== 'ok') throw new RangeError('tax input invalid');
    const next = Math.max(0, input.need + current.tax.value.totalTax / 100 - input.fixedCash);
    const effective = Math.min(next, totalCap);
    const previous = Math.min(gross, totalCap);
    gross = next;
    if (Math.abs(effective - previous) <= input.toleranceDollars) {
      converged = true;
      current = evaluate(gross);
      break;
    }
    current = evaluate(gross);
  }
  if (current.tax.status === 'unverified') return { status: 'unverified', missing: current.tax.missing };
  if (current.tax.status !== 'ok') throw new RangeError('tax input invalid');
  const withdrawn = sum(current.byAccount);
  const netFunded = input.fixedCash + withdrawn - current.tax.value.totalTax / 100;
  return {
    status: 'ok',
    value: {
      byAccount: current.byAccount,
      withdrawn,
      tax: current.tax.value,
      iterations: Math.min(iterations, input.maxIterations),
      converged,
      // Unfunded only when the accounts are exhausted (§7.2): a converged solve within the tolerance
      // is fully funded even if net income lands a few cents under the need.
      unfunded: withdrawn >= totalCap - 0.005 ? Math.max(0, input.need - netFunded) : 0,
      excess: 0,
      gains: gainsFor(input, current.byAccount),
    },
  };
}

/**
 * Public API (frozen signature): solve one year from a caller-built state. Fixed income counts as
 * cash equal to its tax figures (wages + other ordinary income + Social Security); the projection
 * uses `solveWithdrawals` directly with its exact cash figures.
 */
export function solveGrossUp(
  netNeed: Cents,
  state: GrossUpState,
  rules: ResolvedYearRules,
  opts: { maxIterations: number; toleranceCents: number },
): EngineResult<GrossUpSolution> {
  const h = state.household;
  const strategy =
    h.assumptions.withdrawalStrategy === 'bracketFill' ? 'taxableFirst' : h.assumptions.withdrawalStrategy;
  const accounts: SolverAccount[] = h.accounts.flatMap((acc) => {
    const b = state.balances[acc.id];
    if (!b) return [];
    const category = withdrawalCategoryOf(acc);
    return [
      {
        id: acc.id,
        category,
        cap: Math.max(0, (b.balance - (state.rmdTaken[acc.id] ?? 0)) / 100),
        basis: acc.type === 'taxableBrokerage' ? b.basis / 100 : 0,
        ordinary: category === 'traditional' || category === 'hsa',
        gains: acc.type === 'taxableBrokerage',
      },
    ];
  });
  const f = state.fixedIncome;
  const rmd = Object.values(state.rmdTaken).reduce((s, c) => s + c, 0) / 100;
  const solved = solveWithdrawals(
    {
      need: netNeed / 100,
      fixedCash: (f.wages + f.otherOrdinaryIncome + f.socialSecurityBenefits) / 100 + rmd,
      wages: f.wages / 100,
      wagesByPerson: f.wagesByPerson.map((w) => w / 100),
      ordinary: f.otherOrdinaryIncome / 100 + rmd,
      socialSecurity: f.socialSecurityBenefits / 100,
      gains: f.longTermCapitalGains / 100,
      filingStatus: state.filingStatus,
      ages: state.ages,
      stateTaxRate: h.assumptions.stateTaxRate,
      accounts,
      order: WITHDRAWAL_ORDER[strategy],
      traditionalFirstUpTo: null,
      maxIterations: opts.maxIterations,
      toleranceDollars: opts.toleranceCents / 100,
    },
    rules,
  );
  if (solved.status === 'unverified') return solved;
  const v = solved.value;
  const withdrawals: Record<string, Cents> = {};
  for (const [id, w] of v.byAccount) withdrawals[id] = toCents(w);
  const gross = (f.wages + f.otherOrdinaryIncome + f.socialSecurityBenefits) / 100 + rmd + v.withdrawn;
  return {
    status: 'ok',
    value: {
      withdrawals,
      grossIncome: toCents(gross),
      taxes: v.tax,
      netIncome: asCents(toCents(gross) - v.tax.totalTax),
      iterations: v.iterations,
      converged: v.converged,
      unfunded: toCents(v.unfunded),
    },
    warnings: v.converged
      ? []
      : [
          {
            code: 'grossUpNotConverged',
            year: state.year,
            message: `The tax gross-up did not converge in ${state.year}.`,
          },
        ],
  };
}
