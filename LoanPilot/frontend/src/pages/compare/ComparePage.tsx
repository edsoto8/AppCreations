import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  CarFrontIcon,
  CoinsIcon,
  GaugeIcon,
  GitCompareArrowsIcon,
  InfoIcon,
  Loader2Icon,
  PiggyBankIcon,
  PlusIcon,
  SaveIcon,
  SlidersHorizontalIcon,
  WalletIcon,
  XIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { BalanceComparisonChart, BalanceComparisonTable, type BalanceSeries } from '@/components/charts/BalanceComparisonChart';
import { ChartCard } from '@/components/charts/ChartCard';
import { PayoffTimelineBars, PayoffTimelineTable, type TimelineItem } from '@/components/charts/PayoffTimelineBars';
import { SeriesPaletteStyle, SeriesSwatch } from '@/components/charts/seriesPalette';
import { CurrencyInput } from '@/components/CurrencyInput';
import { Disclaimer } from '@/components/Disclaimer';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/QueryError';
import { errorMessage } from '@/api/client';
import { useDashboard } from '@/api/queries';
import type { ComparisonResult, ComparisonRow, PaymentFrequency } from '@/api/types';
import { useLoanContext } from '@/context/LoanContext';
import { useCurrency, usePreferences } from '@/context/PreferencesContext';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatCurrency, formatDate, formatDuration, formatMonthYear } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useComparison, useScenarioMutations } from '../simulator/queries';
import { BEST_LABELS, BEST_ORDER, bestByRow, rowColors, type BestKey } from './comparisonModel';
import { ComparisonTable } from './ComparisonTable';

const PAGE_TITLE = 'Scenario Comparison';
const PAGE_DESCRIPTION = 'Your saved scenarios and common presets side by side: payoff date, interest and regular outlay.';

export function ComparePage() {
  const { loans, isLoading, isError, error, selectedLoanId, selectedLoan } = useLoanContext();

  if (isLoading) return <CompareSkeleton />;
  if (isError) return <QueryError error={error} title="Could not load your loans" />;
  if (loans.length === 0) {
    return (
      <div className="grid gap-6">
        <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <EmptyState
          icon={<CarFrontIcon />}
          title="Add a loan to compare strategies"
          description="Enter your auto loan's terms first; LoanPilot then lines up common payoff strategies and the ones you save."
          action={
            <Button asChild>
              <Link to="/loans/new">
                <PlusIcon /> Add a loan
              </Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (selectedLoanId === null || !selectedLoan) return <CompareSkeleton />;
  if (selectedLoan.isPaidOff) {
    return (
      <div className="grid gap-6">
        <PageHeader eyebrow={selectedLoan.loan.name} title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <EmptyState icon={<CarFrontIcon />} title="This loan is paid off" description="There's nothing left to compare. Pick another loan from the selector at the top." />
      </div>
    );
  }
  return <CompareWorkspace key={selectedLoanId} loanId={selectedLoanId} loanName={selectedLoan.loan.name} frequency={selectedLoan.loan.paymentFrequency} />;
}

function CompareWorkspace({ loanId, loanName, frequency }: { loanId: number; loanName: string; frequency: PaymentFrequency }) {
  const currency = useCurrency();
  const { preferences, isServerBacked, updatePreferences } = usePreferences();
  const savedBudget = preferences.comparisonBudget;
  const [budget, setBudget] = useState<number | null>(savedBudget);
  const [touched, setTouched] = useState(false);
  // Adopt the saved default once the server copy of the preferences arrives (until the user edits).
  useEffect(() => {
    if (!touched) setBudget(savedBudget);
  }, [savedBudget, touched]);
  const debouncedBudget = useDebouncedValue(budget, 400);
  const effectiveBudget = debouncedBudget !== null && debouncedBudget > 0 ? debouncedBudget : null;
  const comparison = useComparison(loanId, effectiveBudget);
  const dashboard = useDashboard(loanId);
  const mutations = useScenarioMutations(loanId);
  const perPeriodShort = frequency === 'monthly' ? '/mo' : '/payment';

  const deleteRow = async (row: ComparisonRow) => {
    if (row.scenarioId === null) return;
    try {
      await mutations.remove.mutateAsync(row.scenarioId);
      toast.success(`Deleted “${row.name}”`);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  };

  const saveDefault = async () => {
    await updatePreferences({ comparisonBudget: budget !== null && budget > 0 ? budget : null });
    toast.success(budget ? `Saved ${formatCurrency(budget, currency)} as your default budget` : 'Cleared your default budget');
  };

  const budgetDirty = (budget ?? null) !== (savedBudget ?? null);
  const refreshing = comparison.isFetching || budget !== debouncedBudget;

  return (
    <div className="grid grid-cols-1 gap-6">
      <SeriesPaletteStyle />
      <PageHeader
        eyebrow={loanName}
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        actions={
          <Button asChild>
            <Link to="/simulator">
              <SlidersHorizontalIcon /> New scenario
            </Link>
          </Button>
        }
      />

      {/* One filter row above everything it scopes. */}
      <Card className="gap-0 px-5 py-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="grid gap-2 md:w-64">
            <label htmlFor="compare-budget" className="flex items-center gap-1.5 text-sm font-medium">
              <WalletIcon className="size-4 text-muted-foreground" aria-hidden /> Monthly budget
              <span className="ml-auto text-xs font-normal text-muted-foreground">Optional</span>
            </label>
            <CurrencyInput
              id="compare-budget"
              value={budget}
              placeholder="e.g. 650"
              onValueChange={(v) => {
                setTouched(true);
                setBudget(v);
              }}
              aria-describedby="compare-budget-hint"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {budget !== null && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTouched(true);
                  setBudget(null);
                }}
              >
                <XIcon /> Clear
              </Button>
            )}
            {isServerBacked && budgetDirty && (
              <Button variant="outline" size="sm" onClick={() => void saveDefault()}>
                <SaveIcon /> {budget ? 'Save as default' : 'Clear default'}
              </Button>
            )}
            {refreshing && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> Updating…
              </span>
            )}
          </div>
          <p id="compare-budget-hint" className="text-xs leading-relaxed text-muted-foreground md:ml-auto md:max-w-sm md:text-right">
            Used for “Best within budget”: the lowest-interest strategy whose highest regular payment fits. Lump sums don't count against it
            {frequency !== 'monthly' ? `; ${frequency} payments are converted to a monthly amount` : ''}.
          </p>
        </div>
      </Card>

      {comparison.isPending ? (
        <CompareBodySkeleton />
      ) : comparison.isError ? (
        <QueryError error={comparison.error} onRetry={() => void comparison.refetch()} />
      ) : (
        <CompareBody
          data={comparison.data}
          refreshing={refreshing}
          currency={currency}
          perPeriodShort={perPeriodShort}
          startDate={dashboard.data?.status.projectionStartDate ?? null}
          onDelete={deleteRow}
        />
      )}

      <Disclaimer />
    </div>
  );
}

function CompareBody({
  data,
  refreshing,
  currency,
  perPeriodShort,
  startDate,
  onDelete,
}: {
  data: ComparisonResult;
  refreshing: boolean;
  currency: string;
  perPeriodShort: string;
  startDate: string | null;
  onDelete: (row: ComparisonRow) => Promise<unknown>;
}) {
  const colors = useMemo(() => rowColors(data.rows), [data.rows]);
  const best = useMemo(() => bestByRow(data.best), [data.best]);
  const savedCount = data.rows.filter((r) => r.kind === 'saved').length;
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const plotted = useMemo(() => data.rows.filter((r) => colors.get(r.key)), [data.rows, colors]);
  const series = useMemo<BalanceSeries[]>(
    () =>
      plotted.map((r) => ({
        key: r.key,
        name: r.name,
        color: colors.get(r.key) as string,
        dashed: r.kind === 'baseline',
        points: r.balanceSeries,
        payoffDate: r.paysOff ? r.payoffDate : null,
      })),
    [plotted, colors],
  );
  const timeline: TimelineItem[] = data.rows.map((r) => ({
    key: r.key,
    label: r.name,
    months: r.monthsToPayoff,
    payoffDate: r.payoffDate,
    paysOff: r.paysOff,
    color: colors.get(r.key) ?? 'var(--chart-axis)',
    emphasis: true,
    tag: r.kind === 'baseline' ? <Badge variant="outline" className="text-[10px]">Baseline</Badge> : best.has(r.key) && best.get(r.key)!.includes('fastestPayoff') ? <Badge variant="positive" className="text-[10px]">Fastest</Badge> : undefined,
  }));

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <section aria-label="Best strategies" className={cn('grid gap-4 transition-opacity sm:grid-cols-2 xl:grid-cols-4', refreshing && 'opacity-70')}>
        {BEST_ORDER.map((key) => (
          <BestCard key={key} bestKey={key} data={data} currency={currency} perPeriodShort={perPeriodShort} />
        ))}
      </section>

      {savedCount === 0 && (
        <EmptyState
          className="py-10"
          icon={<GitCompareArrowsIcon />}
          title="No saved scenarios yet"
          description="Below, your current schedule is compared with a few common presets. Build your own plan in the simulator and save it to see it here."
          action={
            <Button asChild>
              <Link to="/simulator">
                <SlidersHorizontalIcon /> Open the simulator
              </Link>
            </Button>
          }
        />
      )}

      <Card className={cn('gap-0 py-0 transition-opacity', refreshing && 'opacity-70')}>
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">All strategies</CardTitle>
          <CardDescription>Remaining interest and payments from {startDate ? formatDate(startDate) : 'today'}. Select a column to sort; the baseline stays on top.</CardDescription>
        </CardHeader>
        <ComparisonTable rows={data.rows} colors={colors} best={best} currency={currency} perPeriodShort={perPeriodShort} onDelete={onDelete} />
        {data.notes.length > 0 && (
          <ul className="grid gap-1.5 border-t bg-muted/30 px-5 py-3.5 text-xs leading-relaxed text-muted-foreground">
            {data.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ChartCard
        title="Balance over time"
        description="Remaining principal for every strategy. Select a strategy in the legend to show or hide it."
        refreshing={refreshing}
        legend={
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show or hide strategies">
            {plotted.map((r) => {
              const on = !hidden.has(r.key);
              return (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(r.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                    on ? 'bg-card text-foreground hover:bg-accent' : 'border-dashed bg-transparent text-muted-foreground line-through decoration-muted-foreground/50 hover:bg-accent',
                  )}
                >
                  <span className={cn(!on && 'opacity-40')}>
                    <SeriesSwatch color={colors.get(r.key) as string} dashed={r.kind === 'baseline'} />
                  </span>
                  {r.name}
                </button>
              );
            })}
            {plotted.length < data.rows.length && (
              <span className="self-center text-xs text-muted-foreground">
                The chart shows the first {plotted.length} strategies; all appear in the table.
              </span>
            )}
          </div>
        }
        chart={<BalanceComparisonChart series={series} hidden={hidden} currency={currency} height={320} ariaLabel="Remaining balance over time for each strategy. Use the table view for exact values." />}
        table={<BalanceComparisonTable series={series} currency={currency} />}
      />

      <ChartCard
        title="Payoff timeline"
        description="Time from today until the last payment, for each strategy."
        refreshing={refreshing}
        chart={<PayoffTimelineBars items={timeline} />}
        table={<PayoffTimelineTable items={timeline} />}
      />
    </>
  );
}

const BEST_ICONS: Record<BestKey, ReactNode> = {
  fastestPayoff: <GaugeIcon />,
  lowestInterest: <CoinsIcon />,
  lowestRecurringPayment: <PiggyBankIcon />,
  bestWithinBudget: <WalletIcon />,
};

function BestCard({ bestKey, data, currency, perPeriodShort }: { bestKey: BestKey; data: ComparisonResult; currency: string; perPeriodShort: string }) {
  const rowKey = data.best[bestKey];
  const row = rowKey ? data.rows.find((r) => r.key === rowKey) : undefined;
  const fmt = (v: number) => formatCurrency(v, currency);
  let value: ReactNode = '—';
  let detail: ReactNode;
  if (row) {
    if (bestKey === 'fastestPayoff') {
      value = formatMonthYear(row.payoffDate, 'long');
      detail = `${formatDuration(row.monthsToPayoff)} to payoff${row.monthsSaved > 0 ? ` · ${formatDuration(row.monthsSaved)} sooner` : ''}`;
    } else if (bestKey === 'lowestInterest') {
      value = fmt(row.totalInterest);
      detail = `${fmt(row.interestSaved)} less than your current schedule`;
    } else if (bestKey === 'lowestRecurringPayment') {
      value = (
        <>
          {fmt(row.recurringPayment)}
          <span className="ml-0.5 text-sm font-normal text-muted-foreground">{perPeriodShort}</span>
        </>
      );
      detail = `Saves ${fmt(row.interestSaved)} in interest`;
    } else {
      value = fmt(row.totalInterest);
      detail = `Interest with a ${fmt(row.recurringPayment)}${perPeriodShort} regular payment`;
    }
  } else if (bestKey === 'bestWithinBudget') {
    detail = data.budget === null ? 'Enter a monthly budget above to find the best strategy that fits it.' : `No strategy's regular payment fits within ${fmt(data.budget)}.`;
  } else if (bestKey === 'lowestRecurringPayment') {
    detail = 'No strategy saves interest yet.';
  } else {
    detail = 'No strategy pays the loan off.';
  }
  return (
    <Card className={cn('gap-0 px-5 py-4', row && 'border-positive/25')} data-best-card={bestKey}>
      <CardHeader className="px-0">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground [&_svg]:size-4">
          {BEST_ICONS[bestKey]} {BEST_LABELS[bestKey].title}
        </CardTitle>
        {row && (
          <CardAction>
            <Badge variant="positive">Best</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="mt-2 px-0">
        <div className="truncate text-base font-semibold" title={row?.name}>
          {row ? row.name : <span className="text-muted-foreground">—</span>}
        </div>
        {row && <div className="mt-0.5 text-2xl font-semibold tracking-tight">{value}</div>}
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function CompareBodySkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading comparison">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

function CompareSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-20 rounded-xl" />
      <CompareBodySkeleton />
    </div>
  );
}
