import { ArrowRightIcon, CalendarX2Icon, TargetIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DateInput } from '@/components/DateInput';
import { FormField } from '@/components/FormField';
import type { IsoDate, TargetPayoffResult } from '@/api/types';
import { addMonthsIso, formatCurrency, formatDate, formatMonthYear } from '@/lib/format';
import { fieldIds, type Draft } from '../scenarioDraft';
import type { ControlsContext } from './context';

interface TargetControlsProps {
  value: Draft['target'];
  onChange: (next: Draft['target']) => void;
  errors: Record<string, string>;
  ctx: ControlsContext;
  result: TargetPayoffResult | undefined;
  loading: boolean;
  onUseAsScenario: (additionalAmount: number) => void;
}

/** Quick picks relative to the baseline payoff date (pure calendar arithmetic). */
export function targetQuickPicks(baselinePayoff: IsoDate | null, minDate: IsoDate): { label: string; date: IsoDate }[] {
  if (!baselinePayoff) return [];
  return [
    { label: '6 months sooner', months: 6 },
    { label: '1 year sooner', months: 12 },
    { label: '2 years sooner', months: 24 },
  ]
    .map((p) => ({ label: p.label, date: addMonthsIso(baselinePayoff, -p.months) }))
    .filter((p) => p.date > minDate);
}

export function TargetControls({ value, onChange, errors, ctx, result, loading, onUseAsScenario }: TargetControlsProps) {
  const fmt = (n: number | null) => formatCurrency(n, ctx.currency);
  const picks = targetQuickPicks(ctx.baselinePayoffDate, ctx.minDate);
  const pick = picks.find((p) => p.date === value.date)?.date ?? '';
  const current = result;

  return (
    <div className="grid gap-5">
      <FormField
        label="Pay off by"
        htmlFor="target-date"
        hint={ctx.baselinePayoffDate ? `On your current schedule you finish ${formatDate(ctx.baselinePayoffDate, 'long')}.` : undefined}
      >
        {picks.length > 0 && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={pick}
            onValueChange={(v) => v && onChange({ date: v })}
            aria-label="Quick target dates"
            className="w-full"
          >
            {picks.map((p) => (
              <ToggleGroupItem key={p.date} value={p.date} className="text-xs data-[state=on]:bg-primary/10 data-[state=on]:font-semibold data-[state=on]:text-primary">
                {p.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <DateInput id="target-date" value={value.date} min={ctx.minDate} onValueChange={(date) => onChange({ date })} error={errors[fieldIds.targetDate]} />
      </FormField>

      {!value.date ? (
        <p className="text-sm text-muted-foreground">Choose a date to see the payment it takes.</p>
      ) : !current && loading ? (
        <Skeleton className="h-36 rounded-xl" />
      ) : current && !current.achievable ? (
        <Alert variant="warning" data-testid="target-unachievable">
          <CalendarX2Icon />
          <AlertTitle>That date can't be reached with regular payments</AlertTitle>
          <AlertDescription>
            <p>{current.message}</p>
          </AlertDescription>
        </Alert>
      ) : current && current.requiredPayment !== null ? (
        <div className="grid gap-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-4" data-testid="target-result" aria-live="polite">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <TargetIcon className="size-4" aria-hidden /> Paid off by {formatMonthYear(current.targetDate, 'long')}
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted-foreground">Required payment</dt>
              <dd className="mt-0.5 text-xl font-semibold tracking-tight">
                {fmt(current.requiredPayment)}
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">{ctx.perPeriodShort}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Above your scheduled</dt>
              <dd className="mt-0.5 text-xl font-semibold tracking-tight text-primary">
                +{fmt(current.additionalAmount ?? 0)}
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">{ctx.perPeriodShort}</span>
              </dd>
            </div>
          </dl>
          <p className="text-sm leading-relaxed text-muted-foreground">{current.message}</p>
          {(current.additionalAmount ?? 0) > 0 && (
            <Button variant="outline" size="sm" className="justify-self-start" onClick={() => onUseAsScenario(current.additionalAmount ?? 0)}>
              Use this as a scenario <ArrowRightIcon />
            </Button>
          )}
        </div>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">
        LoanPilot searches for the smallest regular payment, to the cent, that finishes on or before your date — using the same engine as
        your schedule, so accrual method and due dates are respected. Your scheduled payment is {fmt(ctx.scheduledPayment)} {ctx.perPeriodLabel}.
      </p>
    </div>
  );
}
