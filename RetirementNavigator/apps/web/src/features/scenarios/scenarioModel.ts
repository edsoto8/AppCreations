/**
 * Scenario view model: preset metadata and parameters, the custom-override catalog (which base values a
 * custom scenario can override, each as a `set` op on an entity id), and plain-language descriptions
 * of ops and orphaned ops. No financial formulas: presets and the market-shock sequence come from the
 * engine's `presetScenario`.
 */
import {
  presetScenario,
  type Household,
  type OrphanedOp,
  type Scenario,
  type ScenarioOp,
  type ScenarioPreset,
  type ValidationIssue,
  type WithdrawalStrategy,
} from '@rn/engine';
import { formatCents, formatPercent } from '@/lib/format';
import { PLAN_TYPE_LABELS } from '@/features/accounts/accountModel';

// ---- Presets ------------------------------------------------------------------------------------

export type ParamValue = number | boolean;
export type PresetParams = Record<string, ParamValue>;

export interface ParamField {
  key: string;
  label: string;
  kind: 'int' | 'percent' | 'switch';
  min?: number;
  max?: number;
  example: string;
  tip: string;
}

export interface PresetMeta {
  id: ScenarioPreset;
  letter: string;
  label: string;
  description: string;
  fields: ParamField[];
  defaults: PresetParams;
  defaultName: (params: PresetParams) => string;
}

const pct = (v: number | string | boolean | undefined) => formatPercent(typeof v === 'number' ? Math.abs(v) : 0);

export const PRESETS: readonly PresetMeta[] = [
  {
    id: 'A_baseline',
    letter: 'A',
    label: 'Baseline',
    description: 'No changes: a copy of the base plan to compare against.',
    fields: [],
    defaults: {},
    defaultName: () => 'Baseline',
  },
  {
    id: 'B_earlyRetirement',
    letter: 'B',
    label: 'Early retirement',
    description: 'Everyone retires earlier (never below today’s age). Salary stop ages are cleared.',
    fields: [
      {
        key: 'years',
        label: 'Years earlier',
        kind: 'int',
        min: 1,
        max: 30,
        example: 'For example 5: a retirement age of 65 becomes 60.',
        tip: 'Each person’s retirement age moves down by this many years, but not below their age today.',
      },
    ],
    defaults: { years: 5 },
    defaultName: (p) => `Retire ${String(p.years)} years earlier`,
  },
  {
    id: 'C_aggressiveSavings',
    letter: 'C',
    label: 'Aggressive savings',
    description: 'Each workplace plan’s salary deferral goes up; IRAs can move to “maximum allowed”.',
    fields: [
      {
        key: 'deferralIncrease',
        label: 'Deferral increase (percentage points)',
        kind: 'percent',
        min: 0,
        max: 0.5,
        example: 'For example 5%: a 6% deferral becomes 11% (capped at 100%).',
        tip: 'Added to each plan’s traditional salary deferral (or the Roth deferral when the plan is Roth-only).',
      },
      {
        key: 'irasToMax',
        label: 'Move IRA contributions to “maximum allowed”',
        kind: 'switch',
        example: 'Off by default: while IRA limits are unverified, “maximum allowed” contributes nothing.',
        tip: 'Traditional and Roth IRA schedules switch to the annual limit. The limit is not filled in while it is unverified.',
      },
    ],
    defaults: { deferralIncrease: 0.05, irasToMax: false },
    defaultName: () => 'Aggressive savings',
  },
  {
    id: 'D_marketDownturn',
    letter: 'D',
    label: 'Market downturn',
    description: 'A deterministic, reproducible return shock on every account, spread over the years you choose.',
    fields: [
      {
        key: 'severity',
        label: 'Total market drop',
        kind: 'percent',
        min: -0.9,
        max: 0,
        example: 'For example −30%. Enter a negative number.',
        tip: 'The total drawdown over the shock. Over several years it is spread evenly (geometrically) across them.',
      },
      {
        key: 'durationYears',
        label: 'Duration (years)',
        kind: 'int',
        min: 1,
        max: 10,
        example: 'From 1 to 10 years.',
        tip: 'How many years the shock lasts. Every account’s return is replaced for those years.',
      },
      {
        key: 'startYear',
        label: 'Start year',
        kind: 'int',
        min: 1900,
        max: 2200,
        example: 'Defaults to the first year everyone is retired.',
        tip: 'The calendar year the shock starts.',
      },
    ],
    defaults: { severity: -0.3, durationYears: 1 },
    defaultName: (p) => `Market drop ${pct(p.severity)}`,
  },
  {
    id: 'E_delayedRetirement',
    letter: 'E',
    label: 'Delayed retirement',
    description: 'Everyone retires 3 to 5 years later (not past their planning age).',
    fields: [
      {
        key: 'years',
        label: 'Years later',
        kind: 'int',
        min: 3,
        max: 5,
        example: 'From 3 to 5 years.',
        tip: 'Each person’s retirement age moves up by this many years, capped at their planning age.',
      },
    ],
    defaults: { years: 3 },
    defaultName: (p) => `Retire ${String(p.years)} years later`,
  },
  {
    id: 'F_reducedSpending',
    letter: 'F',
    label: 'Reduced spending',
    description: 'Retirement spending and spending steps go down. Working-years spending is unchanged.',
    fields: [
      {
        key: 'cut',
        label: 'Spending cut',
        kind: 'percent',
        min: 0,
        max: 0.9,
        example: 'For example 10%: $80,000 a year becomes $72,000.',
        tip: 'Retirement spending and every spending step are reduced by this share.',
      },
    ],
    defaults: { cut: 0.1 },
    defaultName: (p) => `Spend ${pct(p.cut)} less in retirement`,
  },
  {
    id: 'G_rothStrategy',
    letter: 'G',
    label: 'Roth strategy',
    description:
      'Workplace deferrals (salary and bonus) move to Roth where the plan offers a Roth account. Compared on an after-tax ending balance.',
    fields: [],
    defaults: {},
    defaultName: () => 'Roth strategy',
  },
];

export const PRESET_BY_ID: Record<ScenarioPreset, PresetMeta> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p]),
) as Record<ScenarioPreset, PresetMeta>;

/** Range check for one preset parameter; null when valid. */
export function paramError(field: ParamField, value: ParamValue | undefined): string | null {
  if (field.kind === 'switch') return null;
  if (value === undefined) return field.key === 'startYear' ? null : 'Enter a value';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number';
  if (field.kind === 'int' && !Number.isInteger(value)) return 'Enter a whole number';
  const show = (v: number) => (field.kind === 'percent' ? formatPercent(v) : String(v));
  if (field.min !== undefined && value < field.min) return `Must be at least ${show(field.min)}`;
  if (field.max !== undefined && value > field.max) return `Must be at most ${show(field.max)}`;
  return null;
}

/** Build a preset scenario with the engine (`currentYear` is always passed, per §10). */
export function buildPreset(
  preset: ScenarioPreset,
  base: Household,
  params: PresetParams,
  ids: { scenarioId: string; name: string; baseProfileId: string },
  currentYear: number,
): Scenario {
  return presetScenario(preset, base, { ...params, currentYear }, ids);
}

/** Short summary of the parameters a preset scenario was built with. */
export function presetSummary(scenario: Scenario): string {
  const p = scenario.presetParams;
  switch (scenario.preset) {
    case null:
      return 'Custom scenario';
    case 'A_baseline':
      return 'Preset A: no changes';
    case 'B_earlyRetirement':
      return `Preset B: ${String(p.years)} years earlier`;
    case 'C_aggressiveSavings':
      return `Preset C: deferrals +${pct(p.deferralIncrease)} of pay${p.irasToMax === true ? '; IRAs to maximum allowed' : ''}`;
    case 'D_marketDownturn':
      return `Preset D: ${typeof p.severity === 'number' ? formatPercent(p.severity) : ''} over ${String(p.durationYears)} year${p.durationYears === 1 ? '' : 's'} from ${String(p.startYear)}`;
    case 'E_delayedRetirement':
      return `Preset E: ${String(p.years)} years later`;
    case 'F_reducedSpending':
      return `Preset F: retirement spending −${pct(p.cut)}`;
    case 'G_rothStrategy':
      return 'Preset G: workplace deferrals to Roth';
  }
}

// ---- Custom overrides ---------------------------------------------------------------------------

export type OverrideKind =
  'age' | 'money' | 'rate' | 'inflation' | 'deferral' | 'strategy' | 'claimAge' | 'marketShock';
type SetOp = Extract<ScenarioOp, { op: 'set' }>;

export interface OverrideTarget {
  key: string;
  collection: SetOp['collection'];
  id: string;
  path: (string | number)[];
  label: string;
  group: string;
  kind: OverrideKind;
  /** The base plan's current value. */
  baseValue: unknown;
}

export const WITHDRAWAL_STRATEGY_LABELS: Record<WithdrawalStrategy, string> = {
  taxableFirst: 'Taxable first',
  traditionalFirst: 'Tax-deferred first',
  rothLast: 'Roth last',
  proportional: 'Proportional',
  bracketFill: 'Bracket fill (needs verified tax brackets)',
};

export const opKey = (collection: string, id: string, path: readonly (string | number)[]) =>
  `${collection}:${id}:${path.join('.')}`;

/** Every base value a custom scenario can override (brief §5.6), in display order. */
export function overrideTargets(h: Household): OverrideTarget[] {
  const t: OverrideTarget[] = [];
  const add = (target: Omit<OverrideTarget, 'key'>) =>
    t.push({ ...target, key: opKey(target.collection, target.id, target.path) });
  const multi = h.people.length > 1;
  for (const p of h.people) {
    const who = multi ? `${p.name}: ` : '';
    const group = multi ? p.name : 'You';
    add({
      collection: 'people',
      id: p.id,
      path: ['retirementAge'],
      label: `${who}Retirement age`,
      group,
      kind: 'age',
      baseValue: p.retirementAge,
    });
    add({
      collection: 'people',
      id: p.id,
      path: ['planningAge'],
      label: `${who}Planning age`,
      group,
      kind: 'age',
      baseValue: p.planningAge,
    });
    add({
      collection: 'people',
      id: p.id,
      path: ['socialSecurity', 'claimAge'],
      label: `${who}Social Security claiming age`,
      group,
      kind: 'claimAge',
      baseValue: p.socialSecurity.claimAge,
    });
    for (const plan of p.workplacePlans) {
      const planName = `${multi ? `${p.name}’s ` : ''}${PLAN_TYPE_LABELS[plan.planType]}`;
      add({
        collection: 'workplacePlans',
        id: plan.id,
        path: ['traditionalPctOfSalary'],
        label: `${planName}: traditional % of salary`,
        group,
        kind: 'deferral',
        baseValue: plan.traditionalPctOfSalary,
      });
      if (plan.planOffersRoth && plan.rothAccountId !== null) {
        add({
          collection: 'workplacePlans',
          id: plan.id,
          path: ['rothPctOfSalary'],
          label: `${planName}: Roth % of salary`,
          group,
          kind: 'deferral',
          baseValue: plan.rothPctOfSalary,
        });
      }
    }
  }
  const hh = (path: string[], label: string, kind: OverrideKind, baseValue: unknown, group = 'Household') =>
    add({ collection: 'household', id: h.id, path, label, group, kind, baseValue });
  hh(['spending', 'currentAnnualSpending'], 'Current spending (per year)', 'money', h.spending.currentAnnualSpending);
  hh(
    ['spending', 'retirementAnnualSpending'],
    'Retirement spending (per year)',
    'money',
    h.spending.retirementAnnualSpending,
  );
  hh(['assumptions', 'inflation'], 'Inflation', 'inflation', h.assumptions.inflation, 'Assumptions');
  hh(
    ['assumptions', 'returnPreRetirement'],
    'Return before retirement',
    'rate',
    h.assumptions.returnPreRetirement,
    'Assumptions',
  );
  hh(
    ['assumptions', 'returnPostRetirement'],
    'Return in retirement',
    'rate',
    h.assumptions.returnPostRetirement,
    'Assumptions',
  );
  hh(
    ['assumptions', 'withdrawalStrategy'],
    'Withdrawal strategy',
    'strategy',
    h.assumptions.withdrawalStrategy,
    'Assumptions',
  );
  hh(['assumptions', 'marketShock'], 'Market shock', 'marketShock', h.assumptions.marketShock, 'Assumptions');
  return t;
}

/** Index of the `set` op that overrides `target`, or −1. */
export function findOverride(ops: readonly ScenarioOp[], target: OverrideTarget): number {
  return ops.findIndex((op) => op.op === 'set' && opKey(op.collection, op.id, op.path) === target.key);
}

/** Ops with `target` set to `value` (replacing an existing override of the same target, else appended). */
export function withOverride(ops: readonly ScenarioOp[], target: OverrideTarget, value: unknown): ScenarioOp[] {
  const op: ScenarioOp = {
    op: 'set',
    collection: target.collection,
    id: target.id as SetOp['id'],
    path: target.path,
    value,
  };
  const index = findOverride(ops, target);
  if (index < 0) return [...ops, op];
  return ops.map((o, i) => (i === index ? op : o));
}

export const withoutOp = (ops: readonly ScenarioOp[], index: number): ScenarioOp[] => ops.filter((_, i) => i !== index);

export interface ShockParams {
  severity: number;
  durationYears: number;
  startYear: number;
}

/** A market shock's total drop (the compounded per-year returns), duration and start year, for display. */
export function shockParams(value: unknown): ShockParams | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as { startYear?: unknown; returns?: unknown };
  if (typeof v.startYear !== 'number' || !Array.isArray(v.returns) || v.returns.length === 0) return null;
  const returns = v.returns.filter((r): r is number => typeof r === 'number');
  const total = returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
  return { severity: Math.round(total * 1e6) / 1e6, durationYears: returns.length, startYear: v.startYear };
}

/**
 * The engine's market-shock value (preset D's per-year sequence) for these parameters. Without a start
 * year the engine uses the first year everyone is retired.
 */
export function marketShockValue(
  base: Household,
  params: Omit<ShockParams, 'startYear'> & { startYear?: number },
  currentYear: number,
): unknown {
  const s = presetScenario(
    'D_marketDownturn',
    base,
    { ...params, currentYear },
    {
      scenarioId: 'shock',
      name: 'shock',
      baseProfileId: base.id,
    },
  );
  const op = s.ops[0];
  return op && op.op === 'set' ? op.value : null;
}

/** Initial value when an override is first added. */
export function initialOverrideValue(target: OverrideTarget, base: Household, currentYear: number): unknown {
  if (target.kind === 'marketShock') {
    return target.baseValue ?? marketShockValue(base, { severity: -0.3, durationYears: 1 }, currentYear);
  }
  return structuredClone(target.baseValue);
}

// ---- Describing ops -----------------------------------------------------------------------------

const PATH_LABELS: Record<string, string> = {
  retirementAge: 'retirement age',
  planningAge: 'planning age',
  'employment.stopAge': 'salary stop age',
  'socialSecurity.claimAge': 'Social Security claiming age',
  traditionalPctOfSalary: 'traditional % of salary',
  rothPctOfSalary: 'Roth % of salary',
  traditionalPctOfBonus: 'traditional % of bonus',
  rothPctOfBonus: 'Roth % of bonus',
  contribution: 'contribution schedule',
  'spending.currentAnnualSpending': 'current spending',
  'spending.retirementAnnualSpending': 'retirement spending',
  'spending.steps': 'spending steps',
  'assumptions.inflation': 'inflation',
  'assumptions.returnPreRetirement': 'return before retirement',
  'assumptions.returnPostRetirement': 'return in retirement',
  'assumptions.withdrawalStrategy': 'withdrawal strategy',
  'assumptions.marketShock': 'market shock',
};

const COLLECTION_NOUNS: Record<ScenarioOp['collection'], string> = {
  household: 'the household',
  people: 'a person',
  workplacePlans: 'a workplace plan',
  accounts: 'an account',
  otherIncome: 'an income source',
  pensions: 'a pension',
  oneTimeEvents: 'a one-time event',
};

/** Display name of an entity in the base plan, or null when it no longer exists. */
export function entityName(h: Household, collection: ScenarioOp['collection'], id: string): string | null {
  switch (collection) {
    case 'household':
      return h.id === id ? 'Household' : null;
    case 'people':
      return h.people.find((p) => p.id === id)?.name ?? null;
    case 'workplacePlans': {
      for (const p of h.people) {
        const plan = p.workplacePlans.find((w) => w.id === id);
        if (plan) return `${p.name}’s ${PLAN_TYPE_LABELS[plan.planType]} plan`;
      }
      return null;
    }
    case 'accounts':
      return h.accounts.find((a) => a.id === id)?.name ?? null;
    case 'otherIncome':
      return h.otherIncome.find((a) => a.id === id)?.name ?? null;
    case 'pensions':
      return h.pensions.find((a) => a.id === id)?.name ?? null;
    case 'oneTimeEvents':
      return h.oneTimeEvents.find((a) => a.id === id)?.name ?? null;
  }
}

function formatValue(pathKey: string, value: unknown): string {
  if (value === null) return 'cleared';
  if (pathKey === 'socialSecurity.claimAge' && typeof value === 'object') {
    const v = value as { years?: number; months?: number };
    return `${String(v.years)} years${v.months ? ` ${String(v.months)} months` : ''}`;
  }
  if (pathKey === 'assumptions.marketShock') {
    const s = shockParams(value);
    return s
      ? `${formatPercent(s.severity)} over ${String(s.durationYears)} year${s.durationYears === 1 ? '' : 's'} from ${String(s.startYear)}`
      : 'changed';
  }
  if (pathKey === 'assumptions.withdrawalStrategy' && typeof value === 'string') {
    return WITHDRAWAL_STRATEGY_LABELS[value as WithdrawalStrategy] ?? value;
  }
  if (pathKey === 'contribution' && typeof value === 'object') {
    const kind = (value as { amount?: { kind?: string } }).amount?.kind;
    return kind === 'maxAllowed' ? 'maximum allowed' : 'changed';
  }
  if (typeof value === 'number') {
    if (pathKey.startsWith('spending.')) return formatCents(value);
    if (/Pct|inflation|return/.test(pathKey)) return formatPercent(value, 2);
    return String(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return 'changed';
}

/** "Sam: retirement age → 60" (or, when the entity is gone, "a person (“sam”): retirement age"). */
export function describeOp(op: ScenarioOp, h: Household): string {
  if (op.op === 'add') return `Adds to ${op.collection}`;
  const name = entityName(h, op.collection, op.id) ?? `${COLLECTION_NOUNS[op.collection]} (“${op.id}”)`;
  if (op.op === 'unset' && op.path === null) return `${name}: removed in this scenario`;
  const pathKey = (op.path ?? []).join('.');
  const field = PATH_LABELS[pathKey] ?? pathKey;
  if (op.op === 'unset') return `${name}: ${field} reset to its default`;
  return `${name}: ${field} → ${formatValue(pathKey, op.value)}`;
}

/** The warning for an op that is not applied (brief §5.6 diff semantics). */
export function orphanMessage(o: OrphanedOp, h: Household): string {
  const what = describeOp(o.op, h);
  if (o.reason === 'missingParent')
    return `This scenario adds something to a person who no longer exists: ${what}. It is not applied.`;
  if (o.reason === 'invalidPath')
    return `This scenario changes a setting that does not exist in the base plan: ${what}. It is not applied.`;
  return `This scenario changes something that no longer exists in the base plan: ${what}. It is not applied.`;
}

export function issueText(issue: ValidationIssue): string {
  return `${issue.path.length > 0 ? `${issue.path.join(' › ')}: ` : ''}${issue.message}`;
}
