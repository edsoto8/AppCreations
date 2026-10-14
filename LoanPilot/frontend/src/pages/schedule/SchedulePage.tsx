import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Link, useSearchParams } from 'react-router';
import {
  CalendarCheckIcon,
  CalendarDaysIcon,
  CoinsIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  GitCompareArrowsIcon,
  HistoryIcon,
  ListOrderedIcon,
  LoaderCircleIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptIcon,
  SlidersHorizontalIcon,
  TablePropertiesIcon,
  WalletIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Disclaimer } from '@/components/Disclaimer';
import { EmptyState } from '@/components/EmptyState';
import { FieldInfo } from '@/components/FieldInfo';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/QueryError';
import { StatCard } from '@/components/StatCard';
import { mergeWarnings, WarningList } from '@/components/WarningList';
import { errorMessage, saveDownload } from '@/api/client';
import { exportSchedule } from '@/api/endpoints';
import { useDashboard } from '@/api/queries';
import type { ExportFormat, Loan, LoanStatus, Scenario, ScheduleResponse } from '@/api/types';
import { useLoanContext } from '@/context/LoanContext';
import { useCurrency } from '@/context/PreferencesContext';
import { cn } from '@/lib/utils';
import { formatCount, formatCurrency, formatDate, formatDuration, formatMonthYear, formatNumber, todayIso } from '@/lib/format';
import { Pagination, pageCount } from './Pagination';
import { PaymentCalendar } from './PaymentCalendar';
import { PrintSummary } from './PrintSummary';
import { useSchedule, useScenarios } from './queries';
import { ScheduleFilters } from './ScheduleFilters';
import {
  activeFilterCount,
  buildRows,
  compareAnnual,
  compareRows,
  compareSearchText,
  distinctYears,
  EMPTY_FILTERS,
  filterItems,
  nextRowIndex,
  rowSearchText,
  rowTotals,
  upcomingRows,
  yearOf,
  type CompareRow,
  type DisplayRow,
  type RowFilters,
} from './scheduleModel';
import { AnnualCompareTable, AnnualTable, CompareTable, PaymentTable } from './ScheduleTables';
import './print.css';

type View = 'payments' | 'annual' | 'calendar';
const VIEWS: readonly View[] = ['payments', 'annual', 'calendar'];

export function SchedulePage() {
  const { loans, isLoading, isError, error, selectedLoanId, selectedLoan } = useLoanContext();

  if (isLoading) return <ScheduleSkeleton />;
  if (isError) return <QueryError error={error} title="Could not load your loans" />;
  if (loans.length === 0 || !selectedLoan || selectedLoanId === null) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Amortization schedule" description="Every payment with its interest, principal and remaining balance." />
        <EmptyState
          icon={<TablePropertiesIcon />}
          title={loans.length === 0 ? 'Add a loan to see its schedule' : 'Select a loan to view its schedule'}
          description="The schedule lists every payment from today to payoff, with an annual summary, a payment calendar and CSV or Excel export."
          action={
            loans.length === 0 ? (
              <Button asChild>
                <Link to="/loans/new">
                  <PlusIcon /> Add a loan
                </Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }
  return <ScheduleForLoan key={selectedLoanId} loan={selectedLoan.loan} />;
}

/** Renders the summary only while printing, including Ctrl/Cmd+P. */
function usePrintMode() {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  const print = useCallback(() => {
    flushSync(() => setPrinting(true));
    window.print();
  }, []);
  return { printing, print };
}

function ScheduleForLoan({ loan }: { loan: Loan }) {
  const currency = useCurrency();
  const [params, setParams] = useSearchParams();
  const scenarios = useScenarios(loan.id);
  const dashboard = useDashboard(loan.id);

  // ── Plan (baseline or a saved scenario) and view live in the URL so they survive reloads.
  const rawScenario = Number(params.get('scenario'));
  const requestedScenario = Number.isInteger(rawScenario) && rawScenario > 0 ? rawScenario : null;
  const scenarioList = useMemo(() => scenarios.data ?? [], [scenarios.data]);
  const scenarioId =
    requestedScenario !== null && (!scenarios.isSuccess || scenarioList.some((s) => s.id === requestedScenario)) ? requestedScenario : null;
  const scenario = scenarioList.find((s) => s.id === scenarioId) ?? null;
  const rawView = params.get('view') as View | null;
  const view: View = rawView && VIEWS.includes(rawView) ? rawView : 'payments';

  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  // A scenario id that no longer exists (deleted, or from another loan) falls back to the baseline.
  useEffect(() => {
    if (requestedScenario !== null && scenarios.isSuccess && scenarioId === null) setParam('scenario', null);
  }, [requestedScenario, scenarios.isSuccess, scenarioId, setParam]);

  const schedule = useSchedule(loan.id, scenarioId);
  const { printing, print } = usePrintMode();
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const exportView = view === 'annual' ? 'annual' : 'monthly';

  const runExport = async (format: ExportFormat) => {
    setExporting(format);
    try {
      const file = await exportSchedule(loan.id, format, exportView, scenarioId !== null ? { scenarioId } : {});
      saveDownload(file);
      toast.success(`Downloaded ${file.filename}`);
    } catch (err) {
      toast.error('Export failed', { description: errorMessage(err) });
    } finally {
      setExporting(null);
    }
  };

  const data = schedule.data;
  const planName = scenario?.name ?? 'Baseline';
  const viewLabel = loan.paymentFrequency === 'monthly' ? 'Monthly' : 'Every payment';

  const header = (
    <PageHeader
      eyebrow={loan.name}
      title="Amortization schedule"
      description="Every payment with its interest, principal and remaining balance, from the first payment to payoff."
      actions={
        <>
          <div role="group" aria-label={`Export the ${exportView} view`} className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={!data || exporting !== null}
              onClick={() => void runExport('csv')}
              aria-label={`Export ${exportView} schedule as CSV`}
            >
              {exporting === 'csv' ? <LoaderCircleIcon className="animate-spin" /> : <FileTextIcon />} CSV
            </Button>
            <Button
              variant="outline"
              disabled={!data || exporting !== null}
              onClick={() => void runExport('xlsx')}
              aria-label={`Export ${exportView} schedule as Excel`}
            >
              {exporting === 'xlsx' ? <LoaderCircleIcon className="animate-spin" /> : <FileSpreadsheetIcon />} Excel
            </Button>
          </div>
          <Button disabled={!data} onClick={print}>
            <PrinterIcon /> Print summary
          </Button>
        </>
      }
    />
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {header}

      <Tabs value={view} onValueChange={(v) => setParam('view', v === 'payments' ? null : v)} className="gap-6">
        <Card className="gap-0 py-0">
          <CardContent className="flex flex-col gap-4 px-4 py-4 sm:px-5 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="schedule-plan" className="text-xs text-muted-foreground">
                  Plan
                </Label>
                <PlanSelect
                  scenarios={scenarioList}
                  loading={scenarios.isPending}
                  value={scenarioId}
                  onChange={(id) => {
                    setParam('scenario', id === null ? null : String(id));
                  }}
                />
              </div>
              {scenarioId !== null ? (
                <CompareToggle checked={params.get('compare') === '1'} onChange={(on) => setParam('compare', on ? '1' : null)} />
              ) : (
                scenarios.isSuccess &&
                scenarioList.length === 0 && (
                  <Button variant="link" size="sm" asChild className="h-auto min-h-9 justify-start px-0 text-left whitespace-normal">
                    <Link to="/simulator">
                      <SlidersHorizontalIcon /> Save a scenario in the Simulator to compare it here
                    </Link>
                  </Button>
                )
              )}
            </div>
            <TabsList aria-label="Schedule view" className="w-full sm:w-fit">
              <TabsTrigger value="payments">
                <ListOrderedIcon /> {viewLabel}
              </TabsTrigger>
              <TabsTrigger value="annual">
                <CalendarDaysIcon /> Annual
              </TabsTrigger>
              <TabsTrigger value="calendar">
                <CalendarCheckIcon /> Calendar
              </TabsTrigger>
            </TabsList>
          </CardContent>
        </Card>

        {schedule.isError && !data ? (
          <QueryError error={schedule.error} onRetry={() => void schedule.refetch()} title="Could not load the schedule" />
        ) : !data ? (
          <ScheduleBodySkeleton />
        ) : (
          <ScheduleBody
            data={data}
            loan={loan}
            status={dashboard.data?.status ?? null}
            scenarioId={scenarioId}
            planName={planName}
            compare={scenarioId !== null && data.scenario !== null && params.get('compare') === '1'}
            currency={currency}
            refreshing={schedule.isPlaceholderData || schedule.isFetching}
            printing={printing}
          />
        )}
      </Tabs>
    </div>
  );
}

function PlanSelect({
  scenarios,
  loading,
  value,
  onChange,
}: {
  scenarios: Scenario[];
  loading: boolean;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <Select value={value === null ? 'baseline' : String(value)} onValueChange={(v) => onChange(v === 'baseline' ? null : Number(v))}>
      <SelectTrigger id="schedule-plan" className="w-full sm:w-72" aria-label="Plan">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="baseline">Baseline (scheduled payments)</SelectItem>
        {(scenarios.length > 0 || loading) && <SelectSeparator />}
        {scenarios.length > 0 && (
          <SelectGroup>
            <SelectLabel>Saved scenarios</SelectLabel>
            {scenarios.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {loading && (
          <SelectGroup>
            <SelectLabel>Loading scenarios…</SelectLabel>
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

function CompareToggle({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex h-9 items-center gap-2.5 rounded-lg border px-3">
      <GitCompareArrowsIcon className="size-4 text-muted-foreground" aria-hidden />
      <Label htmlFor="schedule-compare" className="text-sm font-normal">
        Compare with baseline
      </Label>
      <Switch id="schedule-compare" checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

interface ScheduleBodyProps {
  data: ScheduleResponse;
  loan: Loan;
  status: LoanStatus | null;
  scenarioId: number | null;
  planName: string;
  compare: boolean;
  currency: string;
  refreshing: boolean;
  printing: boolean;
}

function ScheduleBody({ data, loan, status, scenarioId, planName, compare, currency, refreshing, printing }: ScheduleBodyProps) {
  const today = todayIso();
  const projection = scenarioId !== null && data.scenario ? data.scenario : data.baseline;
  const annual = scenarioId !== null && data.scenarioAnnual ? data.scenarioAnnual : data.baselineAnnual;
  const summary = projection.summary;
  const fmt = (v: number) => formatCurrency(v, currency);
  const hasHistory = data.history.length > 0;
  const isScenario = scenarioId !== null && data.scenario !== null;

  const rows = useMemo(() => buildRows(data.history, projection.rows), [data.history, projection.rows]);
  const estimatedYears = useMemo(() => new Set(data.history.map((r) => yearOf(r.date))), [data.history]);
  const projectionStartDate = status?.projectionStartDate ?? loan.balanceAsOf ?? projection.rows[0]?.date ?? null;
  const cumulativeNote =
    data.cumulativeInterestFrom === 'origination'
      ? 'Cumulative interest counts from the first payment of the loan, including the estimated past payments.'
      : `Cumulative interest counts from ${formatDate(projectionStartDate)}, the date of your entered balance. Interest paid before then is not included.`;

  // Warnings for the plan on screen (the baseline's own warnings would contradict a scenario's).
  const warnings = mergeWarnings(summary.warnings);
  const baseSummary = data.baseline.summary;
  const interestSaved = isScenario ? baseSummary.totalInterest - summary.totalInterest : 0;
  const monthsSooner = isScenario ? baseSummary.monthsToPayoff - summary.monthsToPayoff : 0;

  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-6 transition-opacity', refreshing && 'opacity-60')} aria-busy={refreshing}>
      <section aria-label="Plan summary" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon={<CalendarCheckIcon />}
          label="Estimated payoff"
          estimated={hasHistory}
          value={summary.payoffDate ? formatMonthYear(summary.payoffDate) : 'Never'}
          sub={
            summary.payoffDate
              ? `${formatDate(summary.payoffDate)} · in ${formatDuration(summary.monthsToPayoff)}`
              : 'The payment never repays the balance'
          }
          trend={
            isScenario && monthsSooner !== 0
              ? {
                  direction: monthsSooner > 0 ? 'down' : 'up',
                  tone: monthsSooner > 0 ? 'positive' : 'negative',
                  label: `${formatDuration(Math.abs(monthsSooner))} ${monthsSooner > 0 ? 'sooner' : 'later'}`,
                }
              : undefined
          }
        />
        <StatCard
          icon={<ReceiptIcon />}
          label="Payments left"
          value={formatNumber(summary.paymentCount)}
          sub={`Final payment ${fmt(summary.finalPayment)}`}
        />
        <StatCard
          icon={<CoinsIcon />}
          label="Remaining interest"
          info="amortization"
          estimated={hasHistory}
          value={fmt(summary.totalInterest)}
          sub="From the current balance to payoff"
          trend={
            isScenario && Math.abs(interestSaved) >= 0.005
              ? {
                  direction: interestSaved > 0 ? 'down' : 'up',
                  tone: interestSaved > 0 ? 'positive' : 'negative',
                  label: `${fmt(Math.abs(interestSaved))} ${interestSaved > 0 ? 'less' : 'more'} than baseline`,
                }
              : undefined
          }
        />
        <StatCard
          icon={<WalletIcon />}
          label="Remaining total to pay"
          value={fmt(summary.totalPaid)}
          sub={summary.totalExtra > 0 ? `Includes ${fmt(summary.totalExtra)} of extra payments` : 'Principal plus remaining interest'}
        />
      </section>

      {hasHistory && (
        <Alert variant="info" data-testid="history-banner">
          <HistoryIcon />
          <AlertTitle>Past payments are estimated</AlertTitle>
          <AlertDescription>
            <p>
              No current balance is entered for this loan, so the first {formatCount(data.history.length, 'payment')} (through{' '}
              {formatDate(data.history[data.history.length - 1].date)}) are reconstructed from the original schedule, assuming every payment was made
              on time with no extras. They are greyed out and marked <span className="font-medium text-foreground">Estimated</span>. Enter the balance
              from a recent statement for an exact schedule.
            </p>
            <Button variant="link" size="sm" asChild className="h-auto px-0">
              <Link to={`/loans/${loan.id}/edit`}>Update loan details</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <WarningList warnings={warnings} />

      <TabsContent value="payments">
        <PaymentsView
          rows={rows}
          data={data}
          compare={compare}
          planName={planName}
          currency={currency}
          today={today}
          projectionStartDate={projectionStartDate}
          scenarioId={scenarioId}
        />
      </TabsContent>
      <TabsContent value="annual">
        <section aria-label="Annual view" className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <ViewCaption
            title={compare ? `Annual summary: baseline vs ${planName}` : 'Annual summary'}
            text={
              compare
                ? 'Totals per calendar year for both plans. Negative differences mean the scenario pays less interest or owes less.'
                : `Totals per calendar year${hasHistory ? ', including the estimated past payments' : ''}.`
            }
          />
          {compare && data.scenarioAnnual ? (
            <AnnualCompareTable rows={compareAnnual(data.baselineAnnual, data.scenarioAnnual)} currency={currency} scenarioName={planName} />
          ) : (
            <AnnualTable rows={annual} currency={currency} estimatedYears={estimatedYears} />
          )}
        </section>
      </TabsContent>
      <TabsContent value="calendar">
        <PaymentCalendar rows={upcomingRows(projection.rows, today)} currency={currency} loanName={loan.name} planName={planName} today={today} />
      </TabsContent>

      <div className="grid gap-2">
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <FieldInfo term="amortization" className="mt-px" />
          <span>
            {cumulativeNote} Extra payments go entirely to principal and never replace a scheduled payment. Every figure is an estimate from
            LoanPilot&apos;s engine.
          </span>
        </p>
        <Disclaimer compact />
      </div>

      {printing && (
        <PrintSummary
          loan={loan}
          status={status}
          summary={summary}
          startBalance={projection.rows[0]?.startingBalance ?? 0}
          planName={planName}
          annual={annual}
          estimatedYears={estimatedYears}
          cumulativeNote={cumulativeNote}
          currency={currency}
        />
      )}
    </div>
  );
}

function ViewCaption({ title, text, actions }: { title: string; text: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      {actions}
    </div>
  );
}

interface PaymentsViewProps {
  rows: DisplayRow[];
  data: ScheduleResponse;
  compare: boolean;
  planName: string;
  currency: string;
  today: string;
  projectionStartDate: string | null;
  scenarioId: number | null;
}

function PaymentsView({ rows, data, compare, planName, currency, today, projectionStartDate, scenarioId }: PaymentsViewProps) {
  const [filters, setFilters] = useState<RowFilters>(EMPTY_FILTERS);
  const deferredFilters = useDeferredValue(filters);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);

  // A new plan or comparison starts again from the first page.
  useEffect(() => {
    setPage(0);
  }, [scenarioId, compare]);

  const updateFilters = (patch: Partial<RowFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };

  // ── Per-payment rows
  const haystacks = useMemo(() => new Map(rows.map((r) => [r.key, rowSearchText(r, currency)])), [rows, currency]);
  const filteredRows = useMemo(
    () =>
      filterItems(rows, deferredFilters, {
        date: (r) => r.date,
        text: (r) => haystacks.get(r.key) ?? '',
        hasExtra: (r) => r.extraPayment > 0,
      }),
    [rows, deferredFilters, haystacks],
  );

  // ── Baseline vs scenario rows
  const comparison = useMemo<CompareRow[]>(
    () => (compare && data.scenario ? compareRows(data.baseline.rows, data.scenario.rows) : []),
    [compare, data.baseline.rows, data.scenario],
  );
  const compareHaystacks = useMemo(() => new Map(comparison.map((r) => [r.key, compareSearchText(r, currency)])), [comparison, currency]);
  const filteredCompare = useMemo(
    () =>
      filterItems(comparison, deferredFilters, {
        date: (r) => r.date,
        text: (r) => compareHaystacks.get(r.key) ?? '',
        hasExtra: (r) => (r.scenario?.extraPayment ?? 0) > 0,
      }),
    [comparison, deferredFilters, compareHaystacks],
  );

  const total = compare ? filteredCompare.length : filteredRows.length;
  const allCount = compare ? comparison.length : rows.length;
  const pages = pageCount(total, pageSize);
  const safePage = Math.min(page, pages - 1);
  const start = safePage * pageSize;
  const years = useMemo(() => distinctYears(rows.map((r) => r.date)), [rows]);
  const filtering = activeFilterCount(deferredFilters) > 0;
  const showUnpaid = useMemo(() => rows.some((r) => r.unpaidInterest > 0), [rows]);
  const next = nextRowIndex(rows, today);
  const nextKey = next >= 0 ? rows[next].key : null;
  const projectionStartKey = data.history.length > 0 ? (rows.find((r) => r.phase === 'projection')?.key ?? null) : null;
  const pageRows = filteredRows.slice(start, start + pageSize);
  const totals = useMemo(() => rowTotals(filteredRows), [filteredRows]);
  const totalsLabel = filtering ? `Total of ${formatCount(total, 'shown row')}` : 'Total';

  const jumpToNext = () => {
    if (next < 0) return;
    setFilters(EMPTY_FILTERS);
    setPage(Math.floor(next / pageSize));
    requestAnimationFrame(() => frameRef.current?.querySelector('[aria-current="date"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  const shownLabel = total === allCount ? formatCount(allCount, 'row') : `${formatCount(total, 'row')} of ${formatNumber(allCount)} match`;

  return (
    <section aria-label={compare ? 'Baseline compared with scenario' : 'Payment schedule'} className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <ViewCaption
        title={compare ? `Baseline vs ${planName}` : planName === 'Baseline' ? 'Payment schedule' : `Payment schedule: ${planName}`}
        text={
          compare
            ? 'Each payment number in both plans. Negative differences mean the scenario charges less interest or leaves a lower balance.'
            : `${shownLabel}${data.history.length > 0 ? `, including ${data.history.length} estimated past payments` : ''}.`
        }
        actions={
          !compare && nextKey ? (
            <Button variant="outline" size="sm" onClick={jumpToNext}>
              <CalendarCheckIcon /> Jump to next payment
            </Button>
          ) : compare ? (
            <Badge variant="secondary">{shownLabel}</Badge>
          ) : undefined
        }
      />
      <ScheduleFilters filters={filters} years={years} onChange={updateFilters} onClear={() => updateFilters(EMPTY_FILTERS)} />
      {compare && data.history.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Estimated past payments are the same in both plans, so the comparison starts at the projection.
        </p>
      )}
      <div ref={frameRef}>
        {compare ? (
          <CompareTable
            rows={filteredCompare.slice(start, start + pageSize)}
            currency={currency}
            scenarioName={planName}
            totalsLabel={filtering ? `Total of ${formatCount(total, 'shown row')}` : 'Total'}
          />
        ) : (
          <PaymentTable
            rows={pageRows}
            currency={currency}
            showUnpaid={showUnpaid}
            totals={totals}
            totalsLabel={totalsLabel}
            projectionStartKey={filtering ? null : projectionStartKey}
            projectionStartDate={projectionStartDate}
            nextKey={nextKey}
          />
        )}
      </div>
      {total > 0 && (
        <Pagination
          page={safePage}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
        />
      )}
      <Legend
        showUnpaid={showUnpaid}
        hasHistory={data.history.length > 0}
        hasNext={!compare && nextKey !== null}
        hasLump={(compare ? comparison : rows).some((r) => r.kind === 'lumpSum')}
        compare={compare}
      />
    </section>
  );
}

function Legend({
  showUnpaid,
  hasHistory,
  hasNext,
  hasLump,
  compare,
}: {
  showUnpaid: boolean;
  hasHistory: boolean;
  hasNext: boolean;
  hasLump: boolean;
  compare: boolean;
}) {
  if (!hasNext && !hasLump && !(hasHistory && !compare) && !(showUnpaid && !compare)) return null;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground" aria-label="Row legend">
      {hasNext && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-[3px] rounded-full bg-primary" /> Next payment due
        </li>
      )}
      {hasLump && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-[3px] rounded-full bg-chart-3" /> Lump sum (principal only, on its own date)
        </li>
      )}
      {hasHistory && !compare && (
        <li className="flex items-center gap-1.5">
          <Badge variant="estimate" className="px-1.5 py-0 text-[10px]">
            Estimated
          </Badge>
          Reconstructed past payment
        </li>
      )}
      {showUnpaid && !compare && <li>Unpaid interest: interest the payment did not cover, carried to the next payment (never compounded).</li>}
    </ul>
  );
}

function ScheduleBodySkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading schedule">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-full max-w-3xl" />
      <Skeleton className="h-[28rem] rounded-xl" />
    </div>
  );
}

function ScheduleSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading schedule">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-20 rounded-xl" />
      <ScheduleBodySkeleton />
    </div>
  );
}
