import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  BadgeCheckIcon,
  CalendarClockIcon,
  CircleSlashIcon,
  PiggyBankIcon,
  PlusIcon,
  RefreshCcwIcon,
  ScaleIcon,
  TriangleAlertIcon,
  WalletIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChartCard } from '@/components/charts/ChartCard';
import { CurrencyInput } from '@/components/CurrencyInput';
import { Disclaimer } from '@/components/Disclaimer';
import { EmptyState } from '@/components/EmptyState';
import { FormField } from '@/components/FormField';
import { NumberField } from '@/components/NumberField';
import { PageHeader } from '@/components/PageHeader';
import { PercentInput } from '@/components/PercentInput';
import { QueryError } from '@/components/QueryError';
import { StatCard } from '@/components/StatCard';
import { isApiError } from '@/api/client';
import type { Loan, RefinanceInput, RefinanceResult } from '@/api/types';
import { useLoanContext } from '@/context/LoanContext';
import { useCurrency } from '@/context/PreferencesContext';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatCount, formatCurrency, formatDate, formatMonthYear, formatPercent, FREQUENCY_LABELS } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CostChart, CostLegend, CostTable } from './CostChart';
import { useRefinance } from './queries';

export const TERM_PICKS = [36, 48, 60, 72] as const;

interface FormState {
  apr: number | null;
  term: number | null;
  fees: number | null;
  financed: boolean;
}

/** A starting point: one point under the current APR, 48 months, no fees. */
export function defaultForm(loan: Loan): FormState {
  return { apr: Math.max(0, Math.round((loan.aprPercent - 1) * 100) / 100), term: 48, fees: 0, financed: false };
}

/** Client-side completeness check; the server validates ranges and answers 400 with field errors. */
function toInput(form: FormState): { input: RefinanceInput | null; missing: Partial<Record<keyof RefinanceInput, string>> } {
  const missing: Partial<Record<keyof RefinanceInput, string>> = {};
  if (form.apr === null) missing.newAprPercent = 'Enter the APR the new lender offers.';
  if (form.term === null) missing.newTermMonths = 'Enter the new term in months.';
  else if (!Number.isInteger(form.term)) missing.newTermMonths = 'Use a whole number of months.';
  if (Object.keys(missing).length > 0) return { input: null, missing };
  return { input: { newAprPercent: form.apr!, newTermMonths: form.term!, fees: form.fees ?? 0, feesFinanced: form.financed }, missing };
}

export function RefinancePage() {
  const { loans, isLoading, isError, error, selectedLoan } = useLoanContext();

  if (isLoading) return <RefinanceSkeleton />;
  if (isError) return <QueryError error={error} title="Could not load your loans" />;
  if (!selectedLoan) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Refinance" description="Compare keeping your loan with refinancing at a new rate and term." />
        <EmptyState
          icon={<RefreshCcwIcon />}
          title={loans.length === 0 ? 'Add a loan to compare a refinance' : 'Select a loan to compare a refinance'}
          description="Enter a new APR, term and fees to see the new payment, lifetime savings and when refinancing pays for itself."
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
  if (selectedLoan.isPaidOff) {
    return (
      <div className="grid gap-6">
        <PageHeader eyebrow={selectedLoan.loan.name} title="Refinance" />
        <EmptyState icon={<BadgeCheckIcon />} title="This loan is paid off" description="There is nothing left to refinance." />
      </div>
    );
  }
  return <RefinanceForLoan key={selectedLoan.loan.id} loan={selectedLoan.loan} />;
}

function RefinanceForLoan({ loan }: { loan: Loan }) {
  const currency = useCurrency();
  const id = useId();
  const [form, setForm] = useState<FormState>(() => defaultForm(loan));
  const { input, missing } = useMemo(() => toInput(form), [form]);
  const debounced = useDebouncedValue(input, 400);
  const query = useRefinance(loan.id, debounced);
  const freq = FREQUENCY_LABELS[loan.paymentFrequency];

  const serverErrors = isApiError(query.error) && query.error.isValidation ? query.error.errors : {};
  const fieldError = (key: keyof RefinanceInput) => serverErrors[key]?.[0];
  const otherErrors = Object.entries(serverErrors)
    .filter(([k]) => !['newAprPercent', 'newTermMonths', 'fees', 'feesFinanced'].includes(k))
    .flatMap(([, v]) => v);
  const pending = input !== null && (input !== debounced || query.isFetching);
  const result = query.isError ? undefined : query.data;

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        eyebrow={loan.name}
        title="Refinance"
        description="Compare keeping your loan with refinancing the remaining balance at a new rate and term."
      />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="gap-5 lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle className="text-base">New loan offer</CardTitle>
            <CardDescription>
              Your current loan: {formatPercent(loan.aprPercent)} APR, {formatCount(loan.termMonths, 'month')} term.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <FormField label="New APR" htmlFor={`${id}-apr`} info="apr" hint={`Current APR ${formatPercent(loan.aprPercent)}.`}>
              <PercentInput
                id={`${id}-apr`}
                value={form.apr}
                onValueChange={(v) => set({ apr: v })}
                error={fieldError('newAprPercent') ?? (form.apr === null ? missing.newAprPercent : undefined)}
              />
            </FormField>

            <div className="grid gap-2">
              <Label htmlFor={`${id}-term`}>New term</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={form.term !== null && (TERM_PICKS as readonly number[]).includes(form.term) ? String(form.term) : ''}
                onValueChange={(v) => v && set({ term: Number(v) })}
                aria-label="Quick term picks"
                className="w-full"
              >
                {TERM_PICKS.map((m) => (
                  <ToggleGroupItem key={m} value={String(m)} aria-label={`${m} months`} className="num">
                    {m}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <NumberField
                id={`${id}-term`}
                value={form.term}
                onValueChange={(v) => set({ term: v })}
                decimals={0}
                grouping={false}
                suffix="months"
                suffixPaddingClassName="pr-20"
                min={1}
                max={240}
                formatBound={(n) => `${n} months`}
                error={fieldError('newTermMonths') ?? (form.term === null || !Number.isInteger(form.term) ? missing.newTermMonths : undefined)}
                aria-describedby={`${id}-term-hint`}
              />
              <p id={`${id}-term-hint`} className="text-xs text-muted-foreground">
                Months from your next payment. Pick one or type your own (1–240).
              </p>
            </div>

            <FormField label="Refinance fees" htmlFor={`${id}-fees`} hint="Origination, title and lender fees. Leave at 0 if there are none.">
              <CurrencyInput id={`${id}-fees`} value={form.fees} onValueChange={(v) => set({ fees: v })} min={0} error={fieldError('fees')} />
            </FormField>

            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="grid gap-1">
                <Label htmlFor={`${id}-financed`}>Roll fees into the loan</Label>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {form.financed
                    ? 'Fees are added to the new principal and accrue interest.'
                    : 'Fees are paid upfront and count toward the cost of refinancing.'}
                </p>
                {fieldError('feesFinanced') && <p className="text-xs font-medium text-negative">{fieldError('feesFinanced')}</p>}
              </div>
              <Switch id={`${id}-financed`} checked={form.financed} onCheckedChange={(v) => set({ financed: v })} />
            </div>

            <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
              {pending ? (
                <>
                  <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden /> Updating comparison…
                </>
              ) : input === null ? (
                'Complete the offer to compare.'
              ) : query.isError ? (
                'Fix the highlighted fields to compare.'
              ) : (
                'Comparison is up to date.'
              )}
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          {query.isError ? (
            isApiError(query.error) && query.error.isValidation ? (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>Check the highlighted fields</AlertTitle>
                <AlertDescription>
                  <p>The comparison updates as soon as the offer can be calculated.</p>
                  {otherErrors.map((m) => (
                    <p key={m}>{m}</p>
                  ))}
                </AlertDescription>
              </Alert>
            ) : (
              <QueryError error={query.error} onRetry={() => void query.refetch()} title="Could not compare the refinance" />
            )
          ) : !result ? (
            input === null ? (
              <EmptyState icon={<RefreshCcwIcon />} title="Enter the new loan's terms" description="The comparison updates as you type." />
            ) : (
              <ResultsSkeleton />
            )
          ) : (
            <Results
              result={result}
              input={debounced}
              loan={loan}
              currency={currency}
              refreshing={pending || query.isPlaceholderData}
              freq={freq}
              onPickRate={(apr) => set({ apr })}
            />
          )}
          <Disclaimer />
        </div>
      </div>
    </div>
  );
}

interface ResultsProps {
  result: RefinanceResult;
  input: RefinanceInput | null;
  loan: Loan;
  currency: string;
  refreshing: boolean;
  freq: (typeof FREQUENCY_LABELS)[keyof typeof FREQUENCY_LABELS];
  onPickRate: (apr: number) => void;
}

function Results({ result, input, loan, currency, refreshing, freq, onPickRate }: ResultsProps) {
  const fmt = (v: number) => formatCurrency(v, currency);
  const { current, refinanced } = result;
  const saves = result.lifetimeSavings > 0.005;
  const costsMore = result.lifetimeSavings < -0.005;
  const change = result.monthlyPaymentChange;
  const perWhat = loan.paymentFrequency === 'monthly' ? 'per month' : `per ${freq.adjective.toLowerCase()} payment`;
  const paymentWord = Math.abs(change) < 0.005 ? 'No change' : change < 0 ? `${fmt(Math.abs(change))} lower` : `${fmt(change)} higher`;
  const interestDiff = (Math.round(refinanced.totalInterest * 100) - Math.round(current.remainingInterest * 100)) / 100;
  const paymentsDiff = refinanced.payments - current.remainingPayments;

  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-6 transition-opacity', refreshing && 'opacity-60')} aria-busy={refreshing}>
      <Card
        className={cn(
          'flex-row items-start gap-4 px-5 py-5',
          saves ? 'border-positive/30 bg-positive/5' : costsMore ? 'border-warning/30 bg-warning/5' : '',
        )}
        data-testid="refinance-verdict"
      >
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl',
            saves ? 'bg-positive/15 text-positive' : costsMore ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground',
          )}
        >
          {saves ? (
            <BadgeCheckIcon className="size-5" aria-hidden />
          ) : costsMore ? (
            <TriangleAlertIcon className="size-5" aria-hidden />
          ) : (
            <ScaleIcon className="size-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {saves ? 'Refinancing saves money' : costsMore ? 'Refinancing costs more' : 'About the same'}
          </p>
          <p className="mt-1 text-base leading-relaxed font-medium text-balance">{result.verdict}</p>
        </div>
      </Card>

      <section aria-label="Refinance results" className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<WalletIcon />}
          label={loan.paymentFrequency === 'monthly' ? 'Monthly payment change' : 'Payment change'}
          value={<span className={cn(change < -0.005 && 'text-positive', change > 0.005 && 'text-negative')}>{paymentWord}</span>}
          sub={`${perWhat}: ${fmt(current.payment)} → ${fmt(refinanced.payment)}${loan.paymentFrequency === 'monthly' ? '' : '. Shown per payment, not per month.'}`}
        />
        <StatCard
          icon={<PiggyBankIcon />}
          label="Lifetime savings"
          estimated
          value={
            <span className={cn(saves && 'text-positive', costsMore && 'text-negative')} data-testid="lifetime-savings">
              {saves ? `Saves ${fmt(result.lifetimeSavings)}` : costsMore ? `Costs ${fmt(-result.lifetimeSavings)} more` : 'Breaks even'}
            </span>
          }
          sub={`${fmt(current.totalRemainingCost)} to keep vs ${fmt(refinanced.totalCost)} to refinance, fees included`}
        />
        <StatCard
          icon={<CalendarClockIcon />}
          label="Break-even"
          info="refinanceBreakEven"
          value={
            <span data-testid="break-even">
              {result.breakEvenMonth === null ? 'Never' : result.breakEvenMonth === 0 ? 'Immediately' : formatCount(result.breakEvenMonth, 'month')}
            </span>
          }
          sub={
            result.breakEvenMonth === null
              ? 'Refinancing never becomes cheaper than keeping your loan.'
              : result.breakEvenDate
                ? `From ${formatMonthYear(result.breakEvenDate, 'long')}, refinancing is never more expensive.`
                : undefined
          }
          badge={
            result.breakEvenMonth === null ? (
              <Badge variant="negative">
                <CircleSlashIcon /> No break-even
              </Badge>
            ) : undefined
          }
        />
      </section>

      <section aria-label="Current loan compared with refinance" className="grid gap-4 md:grid-cols-2">
        <SideCard title="Keep current loan" subtitle={`${formatPercent(loan.aprPercent)} APR`} tone="neutral">
          <Row label={`${freq.adjective} payment`} value={fmt(current.payment)} />
          <Row label="Payments left" value={formatCount(current.remainingPayments, 'payment')} />
          <Row label="Remaining interest" value={fmt(current.remainingInterest)} />
          <Row label="Fees" value={fmt(0)} />
          <Row label="Total remaining cost" value={fmt(current.totalRemainingCost)} strong />
          <Row label="Payoff date" value={current.payoffDate ? formatDate(current.payoffDate) : 'Never on this payment'} />
        </SideCard>
        <SideCard
          title="Refinance"
          subtitle={input ? `${formatPercent(input.newAprPercent)} APR · ${formatCount(input.newTermMonths, 'month')}` : ''}
          tone={saves ? 'positive' : costsMore ? 'warning' : 'neutral'}
        >
          <Row label={`${freq.adjective} payment`} value={fmt(refinanced.payment)} delta={<Delta value={change} currency={currency} />} />
          <Row
            label="Payments"
            value={formatCount(refinanced.payments, 'payment')}
            delta={
              paymentsDiff !== 0 ? <span className="text-muted-foreground">{paymentsDiff > 0 ? `+${paymentsDiff}` : paymentsDiff}</span> : undefined
            }
          />
          <Row label="Total interest" value={fmt(refinanced.totalInterest)} delta={<Delta value={interestDiff} currency={currency} />} />
          <Row
            label={input?.feesFinanced ? 'Fees (financed)' : 'Fees (paid upfront)'}
            value={fmt(refinanced.fees)}
            hint={input?.feesFinanced && refinanced.fees > 0 ? `New principal ${fmt(refinanced.principal)}` : undefined}
          />
          <Row label="Total cost" value={fmt(refinanced.totalCost)} strong delta={<Delta value={-result.lifetimeSavings} currency={currency} />} />
          <Row label="Payoff date" value={refinanced.payoffDate ? formatDate(refinanced.payoffDate) : '—'} />
        </SideCard>
      </section>

      <ChartCard
        title="Cost over time"
        description={
          <>
            Your position after each payment: what you have paid so far (plus fees paid upfront) plus what you still owe. Where the refinance line
            stays below, refinancing has paid for itself.
          </>
        }
        legend={<CostLegend />}
        refreshing={refreshing}
        chart={<CostChart series={result.costSeries} breakEvenDate={result.breakEvenDate} currency={currency} />}
        table={<CostTable series={result.costSeries} breakEvenDate={result.breakEvenDate} currency={currency} />}
      />

      <RateComparison
        result={result}
        chosenApr={input?.newAprPercent ?? null}
        term={input?.newTermMonths ?? null}
        currency={currency}
        freq={freq}
        onPick={onPickRate}
      />
    </div>
  );
}

function SideCard({
  title,
  subtitle,
  tone,
  children,
}: {
  title: string;
  subtitle: string;
  tone: 'neutral' | 'positive' | 'warning';
  children: ReactNode;
}) {
  return (
    <Card className={cn('gap-3', tone === 'positive' && 'border-positive/30', tone === 'warning' && 'border-warning/40')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {title}
          {tone === 'positive' && <Badge variant="positive">Lower cost</Badge>}
          {tone === 'warning' && <Badge variant="warning">Higher cost</Badge>}
        </CardTitle>
        <CardDescription className="num">{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid divide-y">{children}</dl>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, delta, strong, hint }: { label: string; value: string; delta?: ReactNode; strong?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted-foreground">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </dt>
      <dd className="num flex items-baseline gap-2 text-right">
        {delta && <span className="text-xs">{delta}</span>}
        <span className={cn('text-sm', strong ? 'text-base font-semibold' : 'font-medium')}>{value}</span>
      </dd>
    </div>
  );
}

/** Lower is better for every refinance delta shown (payment, interest, cost). */
function Delta({ value, currency }: { value: number; currency: string }) {
  if (Math.abs(value) < 0.005) return null;
  const good = value < 0;
  const Icon = good ? ArrowDownRightIcon : ArrowUpRightIcon;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium', good ? 'text-positive' : 'text-negative')}>
      <Icon className="size-3" aria-hidden />
      {formatCurrency(value, currency, { signDisplay: 'exceptZero' })}
    </span>
  );
}

function RateComparison({
  result,
  chosenApr,
  term,
  currency,
  freq,
  onPick,
}: {
  result: RefinanceResult;
  chosenApr: number | null;
  term: number | null;
  currency: string;
  freq: (typeof FREQUENCY_LABELS)[keyof typeof FREQUENCY_LABELS];
  onPick: (apr: number) => void;
}) {
  const fmt = (v: number) => formatCurrency(v, currency);
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Interest rate comparison</CardTitle>
        <CardDescription>The same {term ? formatCount(term, 'month') : ''} term and fees at nearby rates. Select a rate to try it.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table aria-label="Interest rate comparison">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">APR</TableHead>
              <TableHead className="text-right">{freq.adjective} payment</TableHead>
              <TableHead className="text-right">Total interest</TableHead>
              <TableHead className="text-right">Lifetime savings</TableHead>
              <TableHead className="pr-5 text-right">
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rateComparison.map((r) => {
              const chosen = chosenApr !== null && Math.abs(r.aprPercent - chosenApr) < 0.0005;
              return (
                <TableRow
                  key={r.aprPercent}
                  aria-current={chosen ? 'true' : undefined}
                  data-chosen={chosen || undefined}
                  className={cn(chosen && 'bg-primary/[0.06] shadow-[inset_3px_0_0_var(--primary)] hover:bg-primary/10')}
                >
                  <TableCell className="pl-5">
                    <span className="inline-flex items-center gap-2">
                      <span className="font-medium">{formatPercent(r.aprPercent)}</span>
                      {chosen && <Badge>Your rate</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{fmt(r.payment)}</TableCell>
                  <TableCell className="text-right">{fmt(r.totalInterest)}</TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-medium',
                      r.lifetimeSavings > 0.005 ? 'text-positive' : r.lifetimeSavings < -0.005 ? 'text-negative' : 'text-muted-foreground',
                    )}
                  >
                    {r.lifetimeSavings > 0.005
                      ? `Saves ${fmt(r.lifetimeSavings)}`
                      : r.lifetimeSavings < -0.005
                        ? `Costs ${fmt(-r.lifetimeSavings)} more`
                        : 'Even'}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {!chosen && (
                      <Button variant="ghost" size="sm" onClick={() => onPick(r.aprPercent)} aria-label={`Use ${formatPercent(r.aprPercent)} APR`}>
                        Use
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Calculating refinance">
      <Skeleton className="h-24 rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

function RefinanceSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading refinance">
      <Skeleton className="h-12 w-64" />
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Skeleton className="h-96 rounded-xl" />
        <ResultsSkeleton />
      </div>
    </div>
  );
}
