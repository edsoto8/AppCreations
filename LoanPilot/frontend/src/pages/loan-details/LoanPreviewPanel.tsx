import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalculatorIcon, LoaderCircleIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { FieldInfo } from '@/components/FieldInfo';
import { mergeWarnings, WarningList } from '@/components/WarningList';
import { isApiError } from '@/api/client';
import { previewLoan } from '@/api/endpoints';
import { queryKeys } from '@/api/queries';
import type { LoanInput } from '@/api/types';
import { formatCount, formatCurrency, formatDate, formatDuration, FREQUENCY_LABELS } from '@/lib/format';
import { cn } from '@/lib/utils';

/** POST /calculate/preview for a debounced, client-valid input (null while the form is incomplete). */
export function useLoanPreview(input: LoanInput | null) {
  return useQuery({
    queryKey: queryKeys.preview(input),
    queryFn: ({ signal }) => previewLoan(input as LoanInput, { signal }),
    enabled: input !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });
}

interface LoanPreviewPanelProps {
  input: LoanInput | null;
  preview: ReturnType<typeof useLoanPreview>;
  currency: string;
  inProgress: boolean;
}

/** Live estimate panel. Holds the previous result at reduced opacity while recalculating. */
export function LoanPreviewPanel({ input, preview: query, currency, inProgress }: LoanPreviewPanelProps) {

  const freq = FREQUENCY_LABELS[input?.paymentFrequency ?? 'monthly'];
  const data = input ? query.data : undefined;
  const status = data?.status;
  const baseline = data?.baseline;
  const warnings = mergeWarnings(status?.warnings, baseline?.warnings);
  const previewErrors = isApiError(query.error) && input ? Object.values(query.error.errors).flat() : [];

  return (
    <Card className="gap-4" aria-live="polite" aria-busy={query.isFetching}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalculatorIcon className="size-4 text-primary" aria-hidden />
          Live estimate
          {query.isFetching && <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" aria-label="Recalculating" />}
        </CardTitle>
        <CardDescription>Updates as you type. Nothing is saved until you press Save.</CardDescription>
      </CardHeader>
      <CardContent className={cn('grid gap-4 transition-opacity', query.isFetching && data && 'opacity-60')}>
        {!input ? (
          <p className="text-sm text-muted-foreground">
            Enter the loan amount, APR, term and dates to see your payment, payoff date and total interest.
          </p>
        ) : query.isError && !data ? (
          <div className="grid gap-1 text-sm">
            <p className="font-medium text-negative">{isApiError(query.error) && query.error.isNetwork ? 'The calculator is offline.' : 'These values cannot be calculated yet.'}</p>
            {(previewErrors.length ? previewErrors : [query.error instanceof Error ? query.error.message : '']).filter(Boolean).map((m) => (
              <p key={m} className="text-muted-foreground">
                {m}
              </p>
            ))}
          </div>
        ) : !status || !baseline ? (
          <div className="grid gap-3">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : (
          <>
            <div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                Standard {freq.adjective.toLowerCase()} payment <FieldInfo term="scheduledPayment" />
              </div>
              <div className="mt-1 text-3xl font-semibold tracking-tight">{formatCurrency(status.standardPayment, currency)}</div>
              {!status.paymentIsStandard && (
                <p className="mt-1 text-xs text-muted-foreground">
                  You pay {formatCurrency(status.scheduledPayment, currency)}
                  {freq.perPeriod}
                </p>
              )}
            </div>
            <Separator />
            <dl className="grid gap-3 text-sm">
              <PreviewRow
                label="Estimated payoff"
                value={baseline.paysOff ? formatDate(baseline.payoffDate) : 'Does not pay off'}
                sub={baseline.paysOff ? `${formatDuration(baseline.monthsToPayoff)} · ${formatCount(baseline.paymentCount, 'payment')}` : undefined}
                tone={baseline.paysOff ? undefined : 'negative'}
              />
              <PreviewRow
                label={inProgress ? 'Remaining interest' : 'Total interest'}
                value={formatCurrency(baseline.totalInterest, currency)}
              />
              <PreviewRow label={inProgress ? 'Remaining payments total' : 'Total of payments'} value={formatCurrency(baseline.totalPaid, currency)} />
              {baseline.paysOff && Math.abs(baseline.finalPayment - status.scheduledPayment) >= 0.01 && (
                <PreviewRow label="Final payment" value={formatCurrency(baseline.finalPayment, currency)} />
              )}
            </dl>
            {warnings.length > 0 && <WarningList warnings={warnings} compact />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PreviewRow({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'negative' }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">
        <span className={cn('font-medium', tone === 'negative' && 'text-negative')}>{value}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </dd>
    </div>
  );
}
