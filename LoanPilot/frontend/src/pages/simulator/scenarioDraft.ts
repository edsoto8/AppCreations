/**
 * The simulator's editor state and how it turns into a ScenarioInput for the API.
 * Each mode keeps its own inputs, so switching tabs never loses what the user typed. Nothing here
 * does financial math: the engine computes every figure; this only shapes requests.
 */
import type { IsoDate, LumpSumInput, RecurringExtraInput, Scenario, ScenarioInput } from '@/api/types';
import type { FieldErrors } from '@/api/client';

export type SimulatorMode = 'extra' | 'lump' | 'combined' | 'target' | 'budget';

export const MODES: { value: SimulatorMode; label: string; short: string }[] = [
  { value: 'extra', label: 'Extra payment', short: 'Extra' },
  { value: 'lump', label: 'One-time lump sum', short: 'Lump sum' },
  { value: 'combined', label: 'Combined strategy', short: 'Combined' },
  { value: 'target', label: 'Target payoff date', short: 'Target' },
  { value: 'budget', label: 'Budget', short: 'Budget' },
];

export function isMode(value: string | null | undefined): value is SimulatorMode {
  return MODES.some((m) => m.value === value);
}

export interface RecurringRow {
  id: string;
  amount: number | null;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
}

export interface LumpRow {
  id: string;
  amount: number | null;
  date: IsoDate | null;
  note: string;
}

export interface Draft {
  mode: SimulatorMode;
  extra: { amount: number | null; startDate: IsoDate | null };
  lump: { amount: number | null; date: IsoDate | null; note: string };
  combined: { recurring: RecurringRow[]; lumps: LumpRow[]; budget: number | null };
  target: { date: IsoDate | null };
  budget: { amount: number | null };
}

let rowSeq = 0;
export function newRowId(prefix: 'r' | 'l'): string {
  rowSeq += 1;
  return `${prefix}${rowSeq}`;
}

export const QUICK_EXTRA_AMOUNTS = [25, 50, 100, 250] as const;
export const DEFAULT_EXTRA = 100;

export interface DraftContext {
  /** Default lump-sum date: today, or the projection start when that is later. */
  defaultLumpDate: IsoDate;
  /** Default target payoff date (e.g. one year before the baseline payoff), if known. */
  defaultTargetDate: IsoDate | null;
}

export function initialDraft(ctx: DraftContext): Draft {
  return {
    mode: 'extra',
    extra: { amount: DEFAULT_EXTRA, startDate: null },
    lump: { amount: 1000, date: ctx.defaultLumpDate, note: '' },
    combined: {
      recurring: [{ id: newRowId('r'), amount: DEFAULT_EXTRA, startDate: null, endDate: null }],
      lumps: [{ id: newRowId('l'), amount: 1000, date: ctx.defaultLumpDate, note: '' }],
      budget: null,
    },
    target: { date: ctx.defaultTargetDate },
    budget: { amount: null },
  };
}

// ── Field ids: one per input, so server errors can be shown next to the right control ──────────

export const fieldIds = {
  extraAmount: 'extra.amount',
  extraStart: 'extra.startDate',
  lumpAmount: 'lump.amount',
  lumpDate: 'lump.date',
  lumpNote: 'lump.note',
  combinedBudget: 'combined.budget',
  recurring: (rowId: string, field: 'amount' | 'startDate' | 'endDate') => `combined.recurring.${rowId}.${field}`,
  lumpRow: (rowId: string, field: 'amount' | 'date' | 'note') => `combined.lumps.${rowId}.${field}`,
  targetDate: 'target.date',
  budgetAmount: 'budget.amount',
} as const;

/** A request for the active mode plus where each server error key should be displayed. */
export interface SimulationRequest {
  input: ScenarioInput;
  /** Server error key (e.g. "lumpSums[0].date") → field id. Unmapped keys show as a general error. */
  errorTargets: Record<string, string>;
}

const SIMULATION_NAME = 'Simulation';

function emptyInput(): ScenarioInput {
  return { name: SIMULATION_NAME, description: null, budgetPayment: null, recurringExtras: [], lumpSums: [] };
}

function hasAmount(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * ScenarioInput for the extra / lump / combined modes (POST /simulate). Rows without an amount are
 * still being typed and are left out; the error map follows the indexes actually posted.
 */
export function buildSimulationRequest(draft: Draft): SimulationRequest {
  const input = emptyInput();
  const errorTargets: Record<string, string> = {};

  if (draft.mode === 'extra') {
    if (hasAmount(draft.extra.amount)) {
      input.recurringExtras = [{ amount: draft.extra.amount, startDate: draft.extra.startDate, endDate: null }];
      errorTargets['recurringExtras[0].amount'] = fieldIds.extraAmount;
      errorTargets['recurringExtras[0].startDate'] = fieldIds.extraStart;
      errorTargets['recurringExtras[0].endDate'] = fieldIds.extraStart;
    }
  } else if (draft.mode === 'lump') {
    if (hasAmount(draft.lump.amount) && draft.lump.date) {
      input.lumpSums = [{ amount: draft.lump.amount, date: draft.lump.date, note: draft.lump.note.trim() || null }];
      errorTargets['lumpSums[0].amount'] = fieldIds.lumpAmount;
      errorTargets['lumpSums[0].date'] = fieldIds.lumpDate;
      errorTargets['lumpSums[0].note'] = fieldIds.lumpNote;
    }
  } else if (draft.mode === 'combined') {
    const recurring: RecurringExtraInput[] = [];
    for (const row of draft.combined.recurring) {
      if (!hasAmount(row.amount)) continue;
      const i = recurring.length;
      recurring.push({ amount: row.amount, startDate: row.startDate, endDate: row.endDate });
      errorTargets[`recurringExtras[${i}].amount`] = fieldIds.recurring(row.id, 'amount');
      errorTargets[`recurringExtras[${i}].startDate`] = fieldIds.recurring(row.id, 'startDate');
      errorTargets[`recurringExtras[${i}].endDate`] = fieldIds.recurring(row.id, 'endDate');
    }
    const lumps: LumpSumInput[] = [];
    for (const row of draft.combined.lumps) {
      if (!hasAmount(row.amount) || !row.date) continue;
      const i = lumps.length;
      lumps.push({ amount: row.amount, date: row.date, note: row.note.trim() || null });
      errorTargets[`lumpSums[${i}].amount`] = fieldIds.lumpRow(row.id, 'amount');
      errorTargets[`lumpSums[${i}].date`] = fieldIds.lumpRow(row.id, 'date');
      errorTargets[`lumpSums[${i}].note`] = fieldIds.lumpRow(row.id, 'note');
    }
    input.recurringExtras = recurring;
    input.lumpSums = lumps;
    if (hasAmount(draft.combined.budget)) {
      input.budgetPayment = draft.combined.budget;
      errorTargets.budgetPayment = fieldIds.combinedBudget;
    }
  }
  return { input, errorTargets };
}

/** Maps server field errors onto field ids; anything unmapped is returned under `general`. */
export function mapFieldErrors(errors: FieldErrors, targets: Record<string, string>): { byField: Record<string, string>; general: string[] } {
  const byField: Record<string, string> = {};
  const general: string[] = [];
  for (const [key, messages] of Object.entries(errors)) {
    const target = targets[key];
    const message = messages[0];
    if (!message) continue;
    if (target) {
      if (!byField[target]) byField[target] = message;
    } else {
      general.push(...messages);
    }
  }
  return { byField, general };
}

/**
 * What would be saved for the current editor state. Target mode saves the solved extra amount;
 * budget mode saves the budget. Returns null when there is nothing meaningful to save.
 */
export function scenarioForSave(draft: Draft, solvedTargetExtra: number | null): Omit<ScenarioInput, 'name' | 'description'> | null {
  if (draft.mode === 'target') {
    if (!hasAmount(solvedTargetExtra)) return null;
    return { budgetPayment: null, recurringExtras: [{ amount: solvedTargetExtra, startDate: null, endDate: null }], lumpSums: [] };
  }
  if (draft.mode === 'budget') {
    if (!hasAmount(draft.budget.amount)) return null;
    return { budgetPayment: draft.budget.amount, recurringExtras: [], lumpSums: [] };
  }
  const { input } = buildSimulationRequest(draft);
  if (input.recurringExtras.length === 0 && input.lumpSums.length === 0 && input.budgetPayment == null) return null;
  return { budgetPayment: input.budgetPayment ?? null, recurringExtras: input.recurringExtras, lumpSums: input.lumpSums };
}

/** Comparable fingerprint of a scenario's strategy (ignores name/description). */
export function strategyKey(s: Pick<ScenarioInput, 'budgetPayment' | 'recurringExtras' | 'lumpSums'>): string {
  return JSON.stringify({
    b: s.budgetPayment ?? null,
    r: s.recurringExtras.map((r) => [r.amount, r.startDate ?? null, r.endDate ?? null]),
    l: s.lumpSums.map((l) => [l.amount, l.date, l.note?.trim() || null]),
  });
}

/**
 * Loads a saved scenario into the editor, picking the simplest mode that represents it exactly:
 * a budget alone → Budget; one open-ended recurring extra → Extra; one lump sum → Lump sum;
 * anything else → Combined.
 */
export function draftFromScenario(scenario: Scenario, base: Draft): Draft {
  const { recurringExtras: rec, lumpSums: lumps } = scenario;
  const budget = scenario.budgetPayment ?? null;
  if (budget !== null && rec.length === 0 && lumps.length === 0) {
    return { ...base, mode: 'budget', budget: { amount: budget } };
  }
  if (budget === null && rec.length === 1 && lumps.length === 0 && !rec[0].endDate) {
    return { ...base, mode: 'extra', extra: { amount: rec[0].amount, startDate: rec[0].startDate ?? null } };
  }
  if (budget === null && rec.length === 0 && lumps.length === 1) {
    return { ...base, mode: 'lump', lump: { amount: lumps[0].amount, date: lumps[0].date, note: lumps[0].note ?? '' } };
  }
  return {
    ...base,
    mode: 'combined',
    combined: {
      recurring: rec.map((r) => ({ id: newRowId('r'), amount: r.amount, startDate: r.startDate ?? null, endDate: r.endDate ?? null })),
      lumps: lumps.map((l) => ({ id: newRowId('l'), amount: l.amount, date: l.date, note: l.note ?? '' })),
      budget,
    },
  };
}

/** One-line plain-language summary of a strategy, e.g. "+$100/mo · $2,000 lump sum". */
export function describeStrategy(
  s: Pick<ScenarioInput, 'budgetPayment' | 'recurringExtras' | 'lumpSums'>,
  fmt: (n: number) => string,
  perPeriod: string,
): string {
  const parts: string[] = [];
  if (s.budgetPayment != null) parts.push(`Budget ${fmt(s.budgetPayment)}${perPeriod}`);
  for (const r of s.recurringExtras) parts.push(`+${fmt(r.amount)}${perPeriod}${r.endDate ? ' (limited time)' : ''}`);
  if (s.lumpSums.length === 1) parts.push(`${fmt(s.lumpSums[0].amount)} lump sum`);
  else if (s.lumpSums.length > 1) parts.push(`${s.lumpSums.length} lump sums`);
  return parts.join(' · ') || 'No extra payments';
}
