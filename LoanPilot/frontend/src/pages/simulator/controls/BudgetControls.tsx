import { Skeleton } from '@/components/ui/skeleton';
import { CurrencyInput } from '@/components/CurrencyInput';
import { FormField } from '@/components/FormField';
import type { BudgetResult } from '@/api/types';
import { formatCurrency } from '@/lib/format';
import { fieldIds, type Draft } from '../scenarioDraft';
import type { ControlsContext } from './context';

interface BudgetControlsProps {
  value: Draft['budget'];
  onChange: (next: Draft['budget']) => void;
  errors: Record<string, string>;
  ctx: ControlsContext;
  result: BudgetResult | undefined;
  loading: boolean;
}

export function BudgetControls({ value, onChange, errors, ctx, result, loading }: BudgetControlsProps) {
  const fmt = (n: number) => formatCurrency(n, ctx.currency);
  const error = errors[fieldIds.budgetAmount];
  return (
    <div className="grid gap-5">
      <FormField
        label={`I can afford ${ctx.perPeriodLabel}`}
        htmlFor="budget-amount"
        info="scheduledPayment"
        hint={`At least your scheduled payment of ${fmt(ctx.scheduledPayment)}. Everything above it goes to principal.`}
      >
        <CurrencyInput id="budget-amount" value={value.amount} onValueChange={(amount) => onChange({ amount })} error={error} placeholder={fmt(ctx.scheduledPayment)} />
      </FormField>
      {value.amount === null ? (
        <p className="text-sm text-muted-foreground">Enter what you can comfortably pay each period.</p>
      ) : error ? null : !result && loading ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : result ? (
        <div className="grid gap-1 rounded-xl border border-primary/20 bg-primary/[0.04] p-4" data-testid="budget-result" aria-live="polite">
          <span className="text-xs text-muted-foreground">Extra principal each period</span>
          <span className="text-xl font-semibold tracking-tight text-primary">
            +{fmt(result.extraAmount)}
            <span className="ml-0.5 text-xs font-normal text-muted-foreground">{ctx.perPeriodShort}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            Paying {fmt(result.budget)} instead of {fmt(ctx.scheduledPayment)}.
          </span>
        </div>
      ) : null}
    </div>
  );
}
