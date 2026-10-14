import { useMemo, useState } from 'react';
import { CalendarCheck2Icon, CoinsIcon, HandCoinsIcon, ListOrderedIcon, Loader2Icon, ReceiptIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  BalanceComparisonChart,
  BalanceComparisonLegend,
  BalanceComparisonTable,
  type BalanceSeries,
} from '@/components/charts/BalanceComparisonChart';
import { ChartCard } from '@/components/charts/ChartCard';
import { SERIES } from '@/components/charts/chartTheme';
import { InterestSavingsBars, InterestSavingsTable } from '@/components/charts/InterestSavingsBars';
import { PaymentSplitChart, PaymentSplitLegend, PaymentSplitTable } from '@/components/charts/PaymentSplitChart';
import { PayoffTimelineBars, PayoffTimelineTable, type TimelineItem } from '@/components/charts/PayoffTimelineBars';
import { BASELINE_SERIES_COLOR } from '@/components/charts/seriesPalette';
import { StatCard } from '@/components/StatCard';
import { WarningList } from '@/components/WarningList';
import type { ComparisonRow, IsoDate, Projection, SimulationResult } from '@/api/types';
import { formatCount, formatCurrency, formatNumber, formatDate, formatDuration, formatMonthYear, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ResultsPanelProps {
  result: SimulationResult;
  /** A newer result is loading (or the inputs are still settling): dim, never blank. */
  refreshing: boolean;
  /** The inputs currently have errors, so this result is from the last valid inputs. */
  stale: boolean;
  currency: string;
  startDate: IsoDate;
  startBalance: number;
  scenarioName: string;
  /** Saved scenarios (from the comparison) to show as context on the payoff timeline. */
  savedRows: ComparisonRow[];
  activeScenarioId: number | null;
}

function balanceSeriesOf(p: Projection, startDate: IsoDate, startBalance: number) {
  return [{ date: startDate, balance: startBalance }, ...p.rows.map((r) => ({ date: r.date, balance: r.endingBalance }))];
}

export function ResultsPanel({
  result,
  refreshing,
  stale,
  currency,
  startDate,
  startBalance,
  scenarioName,
  savedRows,
  activeScenarioId,
}: ResultsPanelProps) {
  const { baseline, scenario, comparison: c } = result;
  const fmt = (v: number | null | undefined) => formatCurrency(v, currency);
  const hasSavings = c.interestSaved > 0 || c.monthsSaved > 0 || c.totalExtraPaid > 0;
  const [splitView, setSplitView] = useState<'scenario' | 'baseline'>('scenario');

  const series = useMemo<BalanceSeries[]>(
    () => [
      {
        key: 'baseline',
        name: 'Current schedule',
        color: BASELINE_SERIES_COLOR,
        dashed: true,
        points: balanceSeriesOf(baseline, startDate, startBalance),
        payoffDate: baseline.summary.payoffDate,
      },
      {
        key: 'scenario',
        name: scenarioName,
        color: SERIES.balance,
        area: true,
        points: balanceSeriesOf(scenario, startDate, startBalance),
        payoffDate: scenario.summary.payoffDate,
      },
    ],
    [baseline, scenario, startDate, startBalance, scenarioName],
  );

  const timeline: TimelineItem[] = [
    {
      key: 'baseline',
      label: 'Current schedule',
      months: baseline.summary.monthsToPayoff,
      payoffDate: baseline.summary.payoffDate,
      paysOff: baseline.summary.paysOff,
      color: BASELINE_SERIES_COLOR,
      tag: <Badge variant="outline" className="text-[10px]">Baseline</Badge>,
    },
    {
      key: 'scenario',
      label: scenarioName,
      months: scenario.summary.monthsToPayoff,
      payoffDate: scenario.summary.payoffDate,
      paysOff: scenario.summary.paysOff,
      color: SERIES.balance,
      emphasis: true,
    },
    ...savedRows
      .filter((r) => r.scenarioId !== activeScenarioId)
      .map<TimelineItem>((r) => ({
        key: r.key,
        label: r.name,
        months: r.monthsToPayoff,
        payoffDate: r.payoffDate,
        paysOff: r.paysOff,
        color: 'color-mix(in oklab, var(--muted-foreground) 45%, transparent)',
        tag: <Badge variant="secondary" className="text-[10px]">Saved</Badge>,
        emphasis: false,
      })),
  ];

  const splitRows = splitView === 'scenario' ? scenario.rows : baseline.rows;

  return (
    <div className={cn('grid gap-4 transition-opacity duration-200', refreshing && 'opacity-70')} aria-busy={refreshing}>
      <div className="sr-only" aria-live="polite">
        {refreshing
          ? 'Updating results'
          : `Payoff ${formatMonthYear(c.newPayoffDate, 'long')}, ${formatDuration(c.monthsSaved)} sooner, ${fmt(c.interestSaved)} interest saved.`}
      </div>

      <HeroCard result={result} currency={currency} refreshing={refreshing} stale={stale} hasSavings={hasSavings} />

      <section aria-label="Scenario figures" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon={<CoinsIcon />}
          label="Total interest"
          info="amortization"
          value={fmt(c.newInterest)}
          sub={`was ${fmt(c.baselineInterest)}`}
        />
        <StatCard
          icon={<HandCoinsIcon />}
          label="Extra paid"
          info="recurringExtra"
          value={fmt(c.totalExtraPaid)}
          sub="All of it goes to principal"
        />
        <StatCard
          icon={<ListOrderedIcon />}
          label="Payments left"
          value={formatNumber(scenario.summary.paymentCount)}
          sub={c.paymentsSaved > 0 ? formatCount(c.paymentsSaved, 'fewer payment', 'fewer payments') : 'Same as now'}
        />
        <StatCard
          icon={<ReceiptIcon />}
          label="Final payment"
          info="scheduledPayment"
          value={fmt(scenario.summary.finalPayment)}
          sub={scenario.summary.payoffDate ? `on ${formatDate(scenario.summary.payoffDate)}` : 'Does not pay off'}
        />
      </section>

      <WarningList warnings={scenario.summary.warnings} />

      <ChartCard
        title="Loan balance over time"
        description={`Remaining principal from ${formatDate(startDate)}, on your current schedule and with this plan.`}
        refreshing={refreshing}
        legend={<BalanceComparisonLegend series={series} />}
        chart={<BalanceComparisonChart series={series} currency={currency} annotatePayoffs height={300} ariaLabel="Remaining balance over time, current schedule versus this plan. Use the table view for exact values." />}
        table={<BalanceComparisonTable series={series} currency={currency} />}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Interest savings"
          description="Remaining interest from today to payoff."
          refreshing={refreshing}
          chart={
            <InterestSavingsBars
              baselineInterest={c.baselineInterest}
              scenarioInterest={c.newInterest}
              interestSaved={c.interestSaved}
              percentReduction={c.percentInterestReduction}
              currency={currency}
            />
          }
          table={
            <InterestSavingsTable
              baselineInterest={c.baselineInterest}
              scenarioInterest={c.newInterest}
              interestSaved={c.interestSaved}
              percentReduction={c.percentInterestReduction}
              currency={currency}
            />
          }
        />
        <ChartCard
          title="Payoff timeline"
          description="Time from today until the last payment."
          refreshing={refreshing}
          chart={
            <>
              <PayoffTimelineBars items={timeline} />
              {savedRows.length === 0 && (
                <p className="mt-5 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
                  Save this plan to line it up against other strategies here and in the comparison.
                </p>
              )}
            </>
          }
          table={<PayoffTimelineTable items={timeline} />}
        />
      </div>

      <ChartCard
        title="Principal vs interest per payment"
        description={
          splitView === 'scenario'
            ? 'Each bar is one payment with this plan; extra payments add to the principal part.'
            : 'Each bar is one payment on your current schedule, for comparison.'
        }
        refreshing={refreshing}
        legend={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-4">
              <PaymentSplitLegend />
            </div>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={splitView}
              onValueChange={(v) => v && setSplitView(v as 'scenario' | 'baseline')}
              aria-label="Show payments for"
            >
              <ToggleGroupItem value="scenario" className="flex-none px-3 text-xs">
                This plan
              </ToggleGroupItem>
              <ToggleGroupItem value="baseline" className="flex-none px-3 text-xs">
                Current schedule
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        }
        chart={<PaymentSplitChart rows={splitRows} currency={currency} height={260} />}
        table={<PaymentSplitTable rows={splitRows} currency={currency} />}
      />
    </div>
  );
}

function HeroCard({
  result,
  currency,
  refreshing,
  stale,
  hasSavings,
}: {
  result: SimulationResult;
  currency: string;
  refreshing: boolean;
  stale: boolean;
  hasSavings: boolean;
}) {
  const c = result.comparison;
  const paysOff = result.scenario.summary.paysOff;
  return (
    <Card className="relative gap-0 overflow-hidden px-6 py-6" data-testid="simulation-hero">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/70 via-primary/40 to-transparent" />
      <div className="mb-4 flex min-h-5 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="estimate">Estimated</Badge>
        {stale ? (
          <span className="font-medium text-warning">Showing the last valid result — fix the highlighted fields to update.</span>
        ) : refreshing ? (
          <span className="inline-flex items-center gap-1">
            <Loader2Icon className="size-3 animate-spin" aria-hidden /> Updating…
          </span>
        ) : (
          <span>Updated live as you change the plan</span>
        )}
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <CalendarCheck2Icon className="size-4" aria-hidden /> Debt-free by
          </div>
          <div className="mt-1.5 text-4xl font-semibold tracking-tight [font-variant-numeric:proportional-nums]" data-testid="new-payoff-date">
            {paysOff ? formatMonthYear(c.newPayoffDate, 'long') : 'Not on this plan'}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {c.monthsSaved > 0 ? (
              <>
                <span className="font-semibold text-positive" data-testid="months-saved">
                  {formatDuration(c.monthsSaved)} sooner
                </span>{' '}
                than {formatMonthYear(c.baselinePayoffDate)}
              </>
            ) : (
              <>Same as your current schedule ({formatMonthYear(c.baselinePayoffDate)})</>
            )}
          </p>
        </div>
        <div className="sm:border-l sm:pl-6">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <CoinsIcon className="size-4" aria-hidden /> Interest saved
          </div>
          <div
            className={cn('mt-1.5 text-4xl font-semibold tracking-tight [font-variant-numeric:proportional-nums]', c.interestSaved > 0 && 'text-positive')}
            data-testid="interest-saved"
          >
            {formatCurrency(c.interestSaved, currency)}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {hasSavings ? (
              <>
                <span className="font-semibold text-foreground">{formatPercent(c.percentInterestReduction, 1)}</span> less remaining interest
              </>
            ) : (
              'Add an extra payment to start saving.'
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading results">
      <Skeleton className="h-44 rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
