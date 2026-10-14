import { Link } from 'react-router';
import { ArrowRightIcon, CoinsIcon, HandCoinsIcon, InfoIcon, ListChecksIcon, PlusIcon, ReceiptTextIcon, ScaleIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { ChartCard } from '@/components/charts/ChartCard';
import { Disclaimer } from '@/components/Disclaimer';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/QueryError';
import { StatCard } from '@/components/StatCard';
import { errorMessage } from '@/api/client';
import { useDashboard } from '@/api/queries';
import type { LoanListItem, LoanStatus, PaymentRecord, TrackingResult } from '@/api/types';
import { useLoanContext } from '@/context/LoanContext';
import { useCurrency } from '@/context/PreferencesContext';
import { formatCount, formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AddPaymentForm } from './AddPaymentForm';
import { ImportCard } from './ImportCard';
import { PaymentsTable } from './PaymentsTable';
import { usePaymentMutations, usePayments, useTracking } from './queries';
import { TrackingChart, TrackingLegend, TrackingTable } from './TrackingChart';

export function PaymentsPage() {
  const { loans, isLoading, isError, error, selectedLoan } = useLoanContext();
  if (isLoading) return <PaymentsSkeleton />;
  if (isError) return <QueryError error={error} title="Could not load your loans" />;
  if (!selectedLoan) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Payments" description="Optional payment records, CSV import and actual-vs-scheduled tracking." />
        <EmptyState
          icon={<ReceiptTextIcon />}
          title={loans.length === 0 ? 'Add a loan to record payments' : 'Select a loan to see its payments'}
          description="Record payments as you make them, or import them from a CSV, to compare what you paid with the original schedule."
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
  return <PaymentsForLoan key={selectedLoan.loan.id} item={selectedLoan} />;
}

function PaymentsForLoan({ item }: { item: LoanListItem }) {
  const { loan } = item;
  const currency = useCurrency();
  const payments = usePayments(loan.id);
  const tracking = useTracking(loan.id);
  const dashboard = useDashboard(loan.id);
  const { create, remove, importCsv } = usePaymentMutations(loan.id);
  const status = dashboard.data?.status ?? null;
  const records = payments.data ?? [];

  const onDelete = async (p: PaymentRecord) => {
    try {
      await remove.mutateAsync(p.id);
      toast.success('Payment deleted', { description: `${formatCurrency(p.amount, currency)} on ${formatDate(p.date)}` });
    } catch (err) {
      toast.error('Could not delete the payment', { description: errorMessage(err) });
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        eyebrow={loan.name}
        title="Payments"
        description="Keep a record of what you have paid, import it from a CSV, and see how it tracks against the original schedule."
      />

      <Alert variant="info">
        <InfoIcon />
        <AlertTitle>Payment records are optional</AlertTitle>
        <AlertDescription>
          <p>
            LoanPilot projects your loan from its balance and schedule, so you never have to record anything. Records let you check your payments
            against the schedule, and when they are complete (one record for every payment made, each with its interest split), LoanPilot can show the
            interest you have paid to date.
          </p>
        </AlertDescription>
      </Alert>

      <section aria-label="Payment record summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<ListChecksIcon />}
          label="Recorded payments"
          loading={payments.isPending}
          value={formatCount(records.length, 'payment')}
          sub={tracking.data ? `${formatCurrency(tracking.data.totalActual, currency)} recorded in total` : undefined}
        />
        <InterestToDateCard status={status} records={records} currency={currency} loading={dashboard.isPending || payments.isPending} />
        <ScheduleDiffCard tracking={tracking.data ?? null} currency={currency} loading={tracking.isPending} hasRecords={records.length > 0} />
        <EquityCard status={status} loanId={loan.id} currency={currency} loading={dashboard.isPending} />
      </section>

      {tracking.isError ? (
        <QueryError error={tracking.error} onRetry={() => void tracking.refetch()} title="Could not load payment tracking" />
      ) : tracking.data ? (
        <TrackingSection data={tracking.data} currency={currency} hasRecords={records.length > 0} refreshing={tracking.isFetching} />
      ) : (
        <Skeleton className="h-96 rounded-xl" />
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base">Payment history</CardTitle>
            <CardDescription>Newest first. Deleting a record only changes your records, never the loan itself.</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.isError ? (
              <QueryError error={payments.error} onRetry={() => void payments.refetch()} title="Could not load payments" />
            ) : payments.isPending ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <PaymentsTable payments={records} currency={currency} deleting={remove.isPending} onDelete={onDelete} />
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <AddPaymentForm
            defaultAmount={item.scheduledPayment}
            currency={currency}
            submitting={create.isPending}
            onSubmit={(input) => create.mutateAsync(input)}
          />
          <ImportCard importing={importCsv.isPending} onImport={(csv) => importCsv.mutateAsync(csv)} />
        </div>
      </div>

      <Disclaimer compact />
    </div>
  );
}

function TrackingSection({
  data,
  currency,
  hasRecords,
  refreshing,
}: {
  data: TrackingResult;
  currency: string;
  hasRecords: boolean;
  refreshing: boolean;
}) {
  if (data.points.length === 0) {
    return (
      <Card className="px-5 py-5">
        <p className="text-sm text-muted-foreground">{data.note || 'No payments were due yet, so there is nothing to track.'}</p>
      </Card>
    );
  }
  return (
    <div className="grid gap-2">
      <ChartCard
        title="Recorded vs scheduled"
        description="Cumulative amount paid: your recorded payments against what the original schedule called for, up to today."
        legend={<TrackingLegend />}
        refreshing={refreshing}
        chart={
          <div className="relative">
            <TrackingChart points={data.points} currency={currency} />
            {!hasRecords && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="rounded-lg border bg-card/95 px-4 py-2 text-sm text-muted-foreground shadow-sm">
                  Record payments to see them against the schedule.
                </p>
              </div>
            )}
          </div>
        }
        table={<TrackingTable points={data.points} currency={currency} />}
      />
      {data.note && (
        <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-muted-foreground" data-testid="tracking-note">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {data.note}
        </p>
      )}
    </div>
  );
}

function InterestToDateCard({
  status,
  records,
  currency,
  loading,
}: {
  status: LoanStatus | null;
  records: PaymentRecord[];
  currency: string;
  loading: boolean;
}) {
  const withSplit = records.filter((r) => r.interest !== null && r.interest !== undefined).length;
  if (!status) return <StatCard icon={<CoinsIcon />} label="Interest paid to date" loading={loading} value="—" />;
  const known = status.interestPaidToDate !== null && status.interestPaidSource !== 'unknown';
  const needed = Math.max(0, status.paymentsMade - withSplit);
  const sub =
    status.interestPaidSource === 'records'
      ? 'From your complete payment records.'
      : status.interestPaidSource === 'entered'
        ? 'The amount you entered in Loan Details.'
        : status.interestPaidSource === 'estimated'
          ? 'Estimated from the original schedule.'
          : needed > 0
            ? `Unknown. Record ${formatCount(needed, 'more payment')} with an interest split to show it.`
            : records.length > withSplit
              ? `Unknown. ${formatCount(records.length - withSplit, 'record')} still need an interest split.`
              : 'Unknown for this loan.';
  return (
    <StatCard
      icon={<CoinsIcon />}
      label="Interest paid to date"
      estimated={status.interestPaidSource === 'estimated'}
      value={known ? formatCurrency(status.interestPaidToDate, currency) : <span className="text-muted-foreground">Unknown</span>}
      badge={status.interestPaidSource === 'records' ? <Badge variant="positive">From records</Badge> : undefined}
      sub={`${sub} ${formatCount(withSplit, 'record')} with a split of ${formatCount(status.paymentsMade, 'payment')} made${status.paymentsMadeIsEstimated ? ' (estimated)' : ''}.`}
    />
  );
}

function ScheduleDiffCard({
  tracking,
  currency,
  loading,
  hasRecords,
}: {
  tracking: TrackingResult | null;
  currency: string;
  loading: boolean;
  hasRecords: boolean;
}) {
  if (!tracking) return <StatCard icon={<ScaleIcon />} label="Against the schedule" loading={loading} value="—" />;
  const d = tracking.difference;
  const even = Math.abs(d) < 0.005;
  return (
    <StatCard
      icon={<ScaleIcon />}
      label="Against the schedule"
      value={
        !hasRecords ? (
          <span className="text-muted-foreground">No records</span>
        ) : even ? (
          'On schedule'
        ) : (
          <span className={d > 0 ? 'text-positive' : 'text-warning'}>
            {formatCurrency(Math.abs(d), currency)} {d > 0 ? 'ahead' : 'behind'}
          </span>
        )
      }
      sub={`${formatCurrency(tracking.totalActual, currency)} recorded vs ${formatCurrency(tracking.totalScheduled, currency)} scheduled to date`}
    />
  );
}

/** Equity from the dashboard (vehicle value − estimated payoff), linking to Loan Details to update the value. */
function EquityCard({ status, loanId, currency, loading }: { status: LoanStatus | null; loanId: number; currency: string; loading: boolean }) {
  if (!status) return <StatCard icon={<HandCoinsIcon />} label="Equity" info="equity" loading={loading} value="—" />;
  const editLink = (label: string) => (
    <Button variant="link" size="sm" asChild className="mt-1 h-auto justify-start self-start px-0 has-[>svg]:px-0">
      <Link to={`/loans/${loanId}/edit`}>
        {label} <ArrowRightIcon />
      </Link>
    </Button>
  );
  if (status.equity === null || status.vehicleValue === null) {
    return (
      <StatCard
        icon={<HandCoinsIcon />}
        label="Equity"
        info="equity"
        value={<span className="text-muted-foreground">—</span>}
        sub="Add your vehicle's value to see your equity."
      >
        {editLink('Add vehicle value')}
      </StatCard>
    );
  }
  const negative = status.equity < 0;
  return (
    <StatCard
      icon={<HandCoinsIcon />}
      label="Equity"
      info="equity"
      estimated
      value={<span className={cn(negative ? 'text-negative' : 'text-positive')}>{formatCurrency(status.equity, currency)}</span>}
      badge={negative ? <Badge variant="negative">Upside down</Badge> : undefined}
      sub={`Vehicle value ${formatCurrency(status.vehicleValue, currency)} minus ${formatCurrency(status.payoffEstimate.total, currency)} estimated payoff`}
    >
      {editLink('Update vehicle value')}
    </StatCard>
  );
}

function PaymentsSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading payments">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-20 rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
