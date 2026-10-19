/**
 * Insights view model: plain-language lines for an insight's what-if ops and its metric. Builds on the
 * scenario describer (`describeOp`) and adds the few fields only insights change (expense ratios,
 * account and capital-market returns, the added savings account). No financial formulas: every figure
 * comes from the engine's `computeInsights`.
 */
import type { Household, Insight, ScenarioOp } from '@rn/engine';
import { describeOp, entityName } from '@/features/scenarios/scenarioModel';
import { formatCents, formatPercent } from '@/lib/format';

const RATE_LABELS: Record<string, string> = {
  expenseRatio: 'expense ratio',
  expectedReturn: 'expected return',
  'assumptions.capitalMarket.stocks.geometricReturn': 'stock return (capital-market assumption)',
  'assumptions.capitalMarket.bonds.geometricReturn': 'bond return (capital-market assumption)',
  'assumptions.capitalMarket.cash.geometricReturn': 'cash return (capital-market assumption)',
};

const FREQUENCY: Record<string, string> = { annual: 'a year', monthly: 'a month' };

interface AddedAccount {
  name?: unknown;
  contribution?: { amount?: { kind?: unknown; amount?: unknown; frequency?: unknown } };
}

/** "Household: inflation → 3.5%", "Adds an account “Extra savings (what-if)”, contributing $12,000 a year". */
export function describeInsightOp(op: ScenarioOp, h: Household): string {
  if (op.op === 'add' && op.collection === 'accounts') {
    const entity = (op.entity ?? {}) as AddedAccount;
    const name = typeof entity.name === 'string' ? ` “${entity.name}”` : '';
    const amount = entity.contribution?.amount;
    const contribution =
      amount?.kind === 'dollars' && typeof amount.amount === 'number'
        ? `, contributing ${formatCents(amount.amount)} ${FREQUENCY[String(amount.frequency)] ?? ''}`.trimEnd()
        : '';
    return `Adds an account${name}${contribution}`;
  }
  if (op.op === 'set' && op.path.join('.') === 'spending.steps' && Array.isArray(op.value)) {
    const steps = (op.value as { fromAge?: unknown; annualSpending?: unknown }[]).map((s) =>
      typeof s.fromAge === 'number' && typeof s.annualSpending === 'number'
        ? `from age ${s.fromAge}, ${formatCents(s.annualSpending)} a year`
        : 'changed',
    );
    const name = entityName(h, op.collection, op.id) ?? 'Household';
    return `${name}: spending steps → ${steps.length === 0 ? 'none' : steps.join('; ')}`;
  }
  if (op.op === 'set') {
    const label = RATE_LABELS[op.path.join('.')];
    if (label && typeof op.value === 'number') {
      const name = entityName(h, op.collection, op.id) ?? 'Removed item';
      return `${name}: ${label} → ${formatPercent(op.value, 2)}`;
    }
  }
  return describeOp(op, h);
}

/** Signed dollars for a change: "+$1,200", "−$3,400", "$0". */
export function formatDelta(cents: number): string {
  if (cents > 0) return `+${formatCents(cents)}`;
  if (cents < 0) return `−${formatCents(-cents)}`;
  return formatCents(0);
}

export interface MetricView {
  label: string;
  baseline: string;
  whatIf: string;
  delta: string;
  basis: string;
}

export function metricView(insight: Insight): MetricView {
  const m = insight.metric;
  const notFound = insight.kind === 'savingsIncreaseForGoal' ? 'Not within $500,000 a year' : 'Not available';
  return {
    label: m.label,
    baseline: m.baseline === null ? 'Not available' : formatCents(m.baseline),
    whatIf: m.whatIf === null ? notFound : formatCents(m.whatIf),
    delta: m.delta === null ? '—' : formatDelta(m.delta),
    basis: m.basis === 'todays' ? 'Today’s dollars' : 'Future (nominal) dollars',
  };
}
