import { formatWhole } from '../core/money';
import {
  CASSETTE_IDS,
  denomCents,
  type CassetteId,
  type CassetteState,
  type Cents,
  type DispensePlan,
  type DispenseStrategy,
  type PlanResult,
} from '../core/types';

export interface DispenseLimits {
  minCents: Cents;
  maxCents: Cents;
  /** Amounts must be a multiple of this (e.g. $10). */
  multipleCents: Cents;
  /** Presenter capacity: the most notes one bundle can hold. */
  maxNotes: number;
}

export const STRATEGY_INFO: Record<DispenseStrategy, string> = {
  'min-notes': 'Fewest notes: uses the largest denominations first (fast, fewer picks, less wear).',
  balanced: 'Balanced: draws value preferentially from the fullest cassettes so they empty evenly.',
  'small-notes': 'Small notes: as many small notes as possible (up to the note limit) — handy change for customers.',
};

/**
 * Plan which notes to dispense. PURE: it only reads the cassettes' LOGICAL counters and never plans a note
 * that the counters say is not there. Only installed, non-faulted cassettes are used.
 *
 * Exact search: every combination of note counts is explored (depth-first with the last cassette solved
 * directly), so if any combination exists it is found; the strategy only chooses between valid plans.
 */
export function planDispense(
  amountCents: Cents,
  cassettes: readonly CassetteState[] | Readonly<Record<CassetteId, CassetteState>>,
  strategy: DispenseStrategy,
  limits: DispenseLimits,
): PlanResult {
  const list: CassetteState[] = Array.isArray(cassettes) ? [...cassettes] : CASSETTE_IDS.map((id) => (cassettes as Record<CassetteId, CassetteState>)[id]);

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: 'UNSUPPORTED_AMOUNT', detail: 'Please enter an amount greater than zero.' };
  }
  if (amountCents < limits.minCents || amountCents > limits.maxCents || amountCents % limits.multipleCents !== 0) {
    return {
      ok: false,
      reason: 'UNSUPPORTED_AMOUNT',
      detail: `Amounts must be multiples of ${formatWhole(limits.multipleCents)} between ${formatWhole(limits.minCents)} and ${formatWhole(limits.maxCents)}.`,
    };
  }

  // Largest denomination first (deterministic order for tie-breaks).
  const usable = list
    .filter((c) => c.installed && c.status !== 'FAULT' && c.status !== 'OFFLINE' && c.counter > 0)
    .sort((a, b) => b.denom - a.denom || a.id.localeCompare(b.id));
  const available = usable.reduce((s, c) => s + c.counter * denomCents(c.denom), 0);
  if (amountCents > available) {
    return { ok: false, reason: 'INSUFFICIENT_ATM_CASH', detail: `This ATM can dispense at most ${formatWhole(available)} right now.` };
  }

  const n = usable.length;
  const counts = new Array<number>(n).fill(0);
  let best: number[] | undefined;
  let bestKey: number[] | undefined;
  let feasibleOverLimit = false;

  const keyFor = (c: number[]): number[] => {
    const total = c.reduce((s, x) => s + x, 0);
    switch (strategy) {
      case 'min-notes':
        return [total, ...c.map((x) => -x)];
      case 'small-notes':
        return [-total, ...c];
      case 'balanced': {
        // Cost: value drawn from a cassette, weighted by how EMPTY it is. Full cassettes are cheap to draw from.
        let cost = 0;
        for (let i = 0; i < n; i++) cost += c[i] * usable[i].denom * (1 - usable[i].counter / Math.max(1, usable[i].capacity));
        return [Math.round(cost * 1000), total, ...c.map((x) => -x)];
      }
    }
  };
  const less = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };

  const consider = (): void => {
    const total = counts.reduce((s, x) => s + x, 0);
    if (total > limits.maxNotes) {
      feasibleOverLimit = true;
      return;
    }
    const key = keyFor(counts);
    if (!bestKey || less(key, bestKey)) {
      bestKey = key;
      best = [...counts];
    }
  };

  const search = (i: number, rem: Cents): void => {
    if (rem === 0) {
      for (let k = i; k < n; k++) counts[k] = 0;
      consider();
      return;
    }
    if (i >= n) return;
    const d = denomCents(usable[i].denom);
    if (i === n - 1) {
      if (rem % d === 0 && rem / d <= usable[i].counter) {
        counts[i] = rem / d;
        consider();
        counts[i] = 0;
      }
      return;
    }
    const maxHere = Math.min(usable[i].counter, Math.floor(rem / d));
    for (let k = maxHere; k >= 0; k--) {
      counts[i] = k;
      search(i + 1, rem - k * d);
    }
    counts[i] = 0;
  };
  search(0, amountCents);

  if (!best) {
    if (feasibleOverLimit) {
      return { ok: false, reason: 'TOO_MANY_NOTES', detail: `That amount would need more than ${limits.maxNotes} notes. Please choose a smaller amount.` };
    }
    const denoms = [...new Set(usable.map((c) => c.denom))].sort((a, b) => a - b);
    return {
      ok: false,
      reason: 'NO_FEASIBLE_COMBINATION',
      detail: `This ATM only has ${denoms.map((d) => `$${d}`).join(', ')} notes available and cannot make exactly ${formatWhole(amountCents)}.`,
    };
  }

  const picks: DispensePlan['picks'] = [];
  for (let i = 0; i < n; i++) if (best[i] > 0) picks.push({ cassette: usable[i].id, denom: usable[i].denom, count: best[i] });
  picks.sort((a, b) => a.cassette.localeCompare(b.cassette));
  return { ok: true, plan: { amountCents, picks, totalNotes: picks.reduce((s, p) => s + p.count, 0) } };
}

/** Nearest amounts below/above `amountCents` that the ATM can dispense right now (for helpful messages). */
export function suggestAmounts(
  amountCents: Cents,
  cassettes: readonly CassetteState[] | Readonly<Record<CassetteId, CassetteState>>,
  strategy: DispenseStrategy,
  limits: DispenseLimits,
): Cents[] {
  const out: Cents[] = [];
  const step = limits.multipleCents;
  for (let a = amountCents - step; a >= limits.minCents; a -= step) {
    if (planDispense(a, cassettes, strategy, limits).ok) {
      out.push(a);
      break;
    }
  }
  for (let a = amountCents + step; a <= limits.maxCents; a += step) {
    if (planDispense(a, cassettes, strategy, limits).ok) {
      out.push(a);
      break;
    }
  }
  return out;
}
