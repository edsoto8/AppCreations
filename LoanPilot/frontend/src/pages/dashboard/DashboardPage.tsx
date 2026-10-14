import { Link } from 'react-router';
import {
  CalendarClockIcon,
  CarFrontIcon,
  CircleCheckIcon,
  CoinsIcon,
  HandCoinsIcon,
  LandmarkIcon,
  PencilIcon,
  PiggyBankIcon,
  PlusIcon,
  ReceiptTextIcon,
  ScaleIcon,
  SlidersHorizontalIcon,
  WalletIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { BalanceChart, BalanceTable, toBalancePoints } from '@/components/charts/BalanceChart';
import { ChartCard } from '@/components/charts/ChartCard';
import { SERIES } from '@/components/charts/chartTheme';
import { PaymentSplitChart, PaymentSplitLegend, PaymentSplitTable } from '@/components/charts/PaymentSplitChart';
import { SplitBar } from '@/components/charts/SplitBar';
import { Disclaimer } from '@/components/Disclaimer';
import { EmptyState } from '@/components/EmptyState';
import { FieldInfo } from '@/components/FieldInfo';
import { InsightCard } from '@/components/InsightCard';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/QueryError';
import { StatCard } from '@/components/StatCard';
import { WarningList } from '@/components/WarningList';
import { useDashboard } from '@/api/queries';
import type { Dashboard, DashboardSavingsOption, LoanStatus } from '@/api/types';
import { useLoanContext } from '@/context/LoanContext';
import { useCurrency } from '@/context/PreferencesContext';
import {
  formatCount,
  formatCurrency,
  formatDate,
  formatDuration,
  formatMonthYear,
  formatPercent,
  FREQUENCY_LABELS,
} from '@/lib/format';
import { cn } from '@/lib/utils';

export function DashboardPage() {
  const { loans, isLoading, isError, error, selectedLoanId } = useLoanContext();
  const dashboard = useDashboard(selectedLoanId);

  if (isLoading) return <DashboardSkeleton />;
  if (isError) return <QueryError error={error} title="Could not load your loans" />;
  if (loans.length === 0) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Dashboard" />
        <EmptyState
          icon={<CarFrontIcon />}
          title="Add your first loan"
          description="Enter your auto loan's terms to see your balance, payoff date, total interest and how much extra payments could save you."
          action={
            <Button asChild size="lg">
              <Link to="/loans/new">
                <PlusIcon /> Add your first loan
              </Link>
            </Button>
          }
        />
        <Disclaimer compact className="text-center" />
      </div>
    );
  }
  if (selectedLoanId === null || dashboard.isPending) return <DashboardSkeleton />;
  if (dashboard.isError) return <QueryError error={dashboard.error} onRetry={() => void dashboard.refetch()} />;

  return <DashboardView data={dashboard.data} refreshing={dashboard.isFetching} />;
}

function DashboardView({ data, refreshing }: { data: Dashboard; refreshing: boolean }) {
  const currency = useCurrency();
  const { loan, status, baseline, savingsOptions, insights } = data;
  const fmt = (v: number | null | undefined) => formatCurrency(v, currency);
  const freq = FREQUENCY_LABELS[loan.paymentFrequency];
  const vehicle = [loan.vehicleYear, loan.vehicleMake, loan.vehicleModel].filter(Boolean).join(' ');
  const eyebrow = [vehicle, loan.lender].filter(Boolean).join(' · ') || 'Auto loan';
  const balancePoints = toBalancePoints(status.projectionStartDate, status.projectionStartBalance, baseline.rows);
  const bestSaving = bestSavingsOption(savingsOptions);

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={eyebrow}
        title={loan.name}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/loans/${loan.id}/edit`}>
                <PencilIcon /> Edit loan
              </Link>
            </Button>
            <Button asChild>
              <Link to="/simulator">
                <SlidersHorizontalIcon /> Simulate payoff
              </Link>
            </Button>
          </>
        }
      />

      <WarningList warnings={status.warnings} />

      <div className="grid gap-4 lg:grid-cols-3">
        <HeroCard status={status} originalAmount={loan.originalAmount} currency={currency} monthsToPayoff={baseline.summary.monthsToPayoff} />
        <NextPaymentCard status={status} currency={currency} />
      </div>

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<LandmarkIcon />} label="Original loan amount" info="principal" value={fmt(loan.originalAmount)} sub={`${formatPercent(loan.aprPercent)} APR · ${formatCount(loan.termMonths, 'month')}`} />
        <StatCard
          icon={<WalletIcon />}
          label={`${freq.adjective} payment`}
          info="scheduledPayment"
          value={fmt(status.scheduledPayment)}
          sub={status.paymentIsStandard ? 'Standard computed payment' : `Standard payment would be ${fmt(status.standardPayment)}`}
          badge={status.paymentIsStandard ? <Badge variant="secondary">Standard</Badge> : <Badge variant="outline">Custom</Badge>}
        />
        <StatCard
          icon={<CalendarClockIcon />}
          label="Remaining payments"
          value={formatCount(status.remainingPayments, 'payment')}
          sub={status.payoffDate ? `Last one around ${formatMonthYear(status.payoffDate)}` : 'Does not pay off on this schedule'}
        />
        <StatCard
          icon={<CoinsIcon />}
          label="Remaining interest"
          info="amortization"
          value={fmt(status.remainingInterest)}
          sub={`From ${formatDate(status.projectionStartDate)} to payoff`}
        />
        <LifetimeCostCard status={status} currency={currency} />
        <StatCard
          icon={<ReceiptTextIcon />}
          label="Estimated payoff amount today"
          info="payoffQuote"
          estimated
          estimatedLabel="Estimate"
          value={fmt(status.payoffEstimate.total)}
          sub={
            <>
              Estimate, not a lender payoff quote. {fmt(status.payoffEstimate.principal)} principal +{' '}
              {fmt(status.payoffEstimate.accruedInterest)} accrued interest as of {formatDate(status.payoffEstimate.date)}.
            </>
          }
        />
        <StatCard
          icon={<PiggyBankIcon />}
          label="Potential interest savings"
          info="recurringExtra"
          estimated
          value={<span className={bestSaving && bestSaving.interestSaved > 0 ? 'text-positive' : undefined}>{fmt(bestSaving?.interestSaved ?? 0)}</span>}
          sub={bestSaving ? `${bestSaving.label}${bestSaving.monthsSaved > 0 ? ` · ${formatDuration(bestSaving.monthsSaved)} sooner` : ''}` : 'No early-payoff options for this loan'}
        />
        <EquityCard status={status} currency={currency} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Remaining balance"
          description={`Projected principal balance from ${formatDate(status.projectionStartDate)} to payoff.`}
          refreshing={refreshing}
          chart={<BalanceChart points={balancePoints} currency={currency} />}
          table={<BalanceTable points={balancePoints} currency={currency} />}
        />
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base">Where your remaining payments go</CardTitle>
            <CardDescription>
              {fmt(status.remainingTotalCost)} left to pay over {formatCount(status.remainingPayments, 'payment')}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SplitBar
              segments={[
                { key: 'principal', label: 'Principal', value: status.currentBalance, display: fmt(status.currentBalance), color: SERIES.principal },
                { key: 'interest', label: 'Interest', value: status.remainingInterest, display: fmt(status.remainingInterest), color: SERIES.interest },
              ]}
            />
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Over the original schedule this loan costs {fmt(status.originalScheduleTotalInterest)} in interest, for a total of{' '}
              {fmt(status.originalScheduleTotalCost)}.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Principal vs interest per payment"
          description="Early payments are mostly interest; each payment shifts more toward principal."
          legend={<PaymentSplitLegend />}
          refreshing={refreshing}
          chart={<PaymentSplitChart rows={baseline.rows} currency={currency} />}
          table={<PaymentSplitTable rows={baseline.rows} currency={currency} />}
        />
        <SavingsOptionsCard options={savingsOptions} currency={currency} />
      </div>

      <section aria-labelledby="insights-heading" className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 id="insights-heading" className="text-base font-semibold tracking-tight">
            Insights
          </h2>
          <Button variant="link" size="sm" asChild className="px-0">
            <Link to="/insights">See all insights</Link>
          </Button>
        </div>
        {insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">No insights for this loan yet.</p>
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-3">
            {insights.slice(0, 3).map((insight) => (
              <InsightCard key={insight.id} insight={insight} currency={currency} />
            ))}
          </div>
        )}
      </section>

      <Disclaimer />
    </div>
  );
}

function HeroCard({
  status,
  originalAmount,
  currency,
  monthsToPayoff,
}: {
  status: LoanStatus;
  originalAmount: number;
  currency: string;
  monthsToPayoff: number;
}) {
  const fmt = (v: number | null) => formatCurrency(v, currency);
  return (
    <Card className="gap-6 px-6 py-6 lg:col-span-2">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            Current principal balance <FieldInfo term="payoffQuote" />
            {status.balanceIsEstimated && <Badge variant="estimate">Estimated</Badge>}
          </div>
          <div className="mt-2 text-5xl font-semibold tracking-tight" data-testid="hero-balance">
            {fmt(status.currentBalance)}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {status.balanceIsEstimated ? 'Estimated from the original schedule' : 'As of'} {formatDate(status.balanceAsOf)}
          </p>
        </div>
        <div className="sm:text-right">
          {status.isPaidOff ? (
            <Badge variant="positive" className="px-2.5 py-1 text-sm">
              <CircleCheckIcon /> Paid off
            </Badge>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground sm:justify-end">
                Estimated payoff <Badge variant="estimate">Estimated</Badge>
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight">
                {status.payoffDate ? formatMonthYear(status.payoffDate, 'long') : 'Not on this schedule'}
              </div>
              {status.payoffDate && (
                <p className="mt-1 text-sm text-muted-foreground">
                  in {formatDuration(monthsToPayoff)} · {formatDate(status.payoffDate)}
                </p>
              )}
            </>
          )}
        </div>
      </div>
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">{formatPercent(status.percentRepaid, 1)} of original principal repaid</span>
          <span className="text-muted-foreground">
            {fmt(status.principalRepaid)} of {fmt(originalAmount)}
          </span>
        </div>
        <Progress value={status.percentRepaid} aria-label="Original principal repaid" />
        <p className="text-xs text-muted-foreground">
          {formatCount(status.paymentsMade, 'payment')} made{status.paymentsMadeIsEstimated ? ' (estimated)' : ''} of{' '}
          {formatNumberOfPayments(status.contractPaymentCount)} · contract matures {formatDate(status.maturityDate)}
        </p>
      </div>
    </Card>
  );
}

function formatNumberOfPayments(n: number) {
  return formatCount(n, 'scheduled payment');
}

function NextPaymentCard({ status, currency }: { status: LoanStatus; currency: string }) {
  const next = status.nextPayment;
  const fmt = (v: number) => formatCurrency(v, currency);
  return (
    <Card className="gap-4 px-6 py-6">
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <CalendarClockIcon className="size-4" aria-hidden /> Next scheduled payment
      </div>
      {next ? (
        <>
          <div>
            <div className="text-3xl font-semibold tracking-tight">{fmt(next.amount)}</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Payment #{next.number} · due {formatDate(next.date, 'long')}
            </p>
          </div>
          <SplitBar
            height="h-2"
            segments={[
              { key: 'principal', label: 'To principal', value: next.principal, display: fmt(next.principal), color: SERIES.principal },
              { key: 'interest', label: 'To interest', value: next.interest, display: fmt(next.interest), color: SERIES.interest },
            ]}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{status.isPaidOff ? 'This loan is paid off. Nice work.' : 'No upcoming payment on this schedule.'}</p>
      )}
    </Card>
  );
}

function LifetimeCostCard({ status, currency }: { status: LoanStatus; currency: string }) {
  if (status.projectedLifetimeCost === null) {
    return (
      <StatCard
        icon={<ScaleIcon />}
        label="Total projected loan cost"
        info="projectedLifetimeCost"
        value={formatCurrency(status.remainingTotalCost, currency)}
        badge={<Badge variant="outline">Remaining only</Badge>}
        sub={`Interest paid before ${formatDate(status.balanceAsOf)} is unknown, so this shows only what is left to pay. Add interest paid to date for a lifetime total.`}
      />
    );
  }
  return (
    <StatCard
      icon={<ScaleIcon />}
      label="Total projected loan cost"
      info="projectedLifetimeCost"
      estimated={status.lifetimeCostIsEstimated}
      value={formatCurrency(status.projectedLifetimeCost, currency)}
      sub={
        status.lifetimeCostIsEstimated
          ? 'Includes interest before the balance date, estimated from the original schedule.'
          : 'Principal plus all interest, past and projected.'
      }
    />
  );
}

function EquityCard({ status, currency }: { status: LoanStatus; currency: string }) {
  if (status.equity === null || status.vehicleValue === null) {
    return (
      <StatCard
        icon={<HandCoinsIcon />}
        label="Equity"
        info="equity"
        value={<span className="text-muted-foreground">—</span>}
        sub="Add the vehicle's value in Loan Details to see your equity."
      />
    );
  }
  const negative = status.equity < 0;
  return (
    <StatCard
      icon={<HandCoinsIcon />}
      label="Equity"
      info="equity"
      estimated
      value={<span className={negative ? 'text-negative' : 'text-positive'}>{formatCurrency(status.equity, currency)}</span>}
      badge={negative ? <Badge variant="negative">Upside down</Badge> : undefined}
      sub={`Vehicle value ${formatCurrency(status.vehicleValue, currency)} minus ${formatCurrency(status.payoffEstimate.total, currency)} estimated payoff`}
    />
  );
}

function bestSavingsOption(options: DashboardSavingsOption[]): DashboardSavingsOption | null {
  return options.reduce<DashboardSavingsOption | null>((best, o) => (best === null || o.interestSaved > best.interestSaved ? o : best), null);
}

function SavingsOptionsCard({ options, currency, className }: { options: DashboardSavingsOption[]; currency: string; className?: string }) {
  return (
    <Card className={cn('gap-4', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Ways to save <Badge variant="estimate">Estimated</Badge>
        </CardTitle>
        <CardDescription>Extra payments go straight to principal and never replace a scheduled payment.</CardDescription>
      </CardHeader>
      <CardContent>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">No savings options for this loan.</p>
        ) : (
          <ul className="grid divide-y">
            {options.map((o) => (
              <li key={o.label} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{o.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.newPayoffDate ? `Payoff ${formatMonthYear(o.newPayoffDate)}` : 'Payoff date unchanged'}
                    {o.monthsSaved > 0 ? ` · ${formatDuration(o.monthsSaved)} sooner` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-positive">{formatCurrency(o.interestSaved, currency)}</p>
                  <p className="text-xs text-muted-foreground">interest saved</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" asChild className="mt-4 w-full">
          <Link to="/simulator">
            <SlidersHorizontalIcon /> Try your own scenario
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-12 w-64" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-56 rounded-xl lg:col-span-2" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
