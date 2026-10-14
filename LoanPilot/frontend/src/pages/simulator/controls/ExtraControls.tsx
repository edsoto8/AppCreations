import { CurrencyInput } from '@/components/CurrencyInput';
import { DateInput } from '@/components/DateInput';
import { FormField } from '@/components/FormField';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { IsoDate } from '@/api/types';
import { formatCurrency } from '@/lib/format';
import { AmountSlider } from '../AmountSlider';
import { fieldIds, QUICK_EXTRA_AMOUNTS, type Draft } from '../scenarioDraft';
import type { ControlsContext } from './context';

interface ExtraControlsProps {
  value: Draft['extra'];
  onChange: (next: Draft['extra']) => void;
  errors: Record<string, string>;
  ctx: ControlsContext;
}

export function ExtraControls({ value, onChange, errors, ctx }: ExtraControlsProps) {
  const fmt = (n: number) => formatCurrency(n, ctx.currency, { cents: !Number.isInteger(n) });
  const chip = value.amount !== null && (QUICK_EXTRA_AMOUNTS as readonly number[]).includes(value.amount) ? String(value.amount) : '';
  return (
    <div className="grid gap-5">
      <FormField
        label={`Extra amount ${ctx.perPeriodLabel}`}
        htmlFor="extra-amount"
        info="recurringExtra"
        hint={ctx.frequency === 'monthly' ? 'Added to every monthly payment.' : `Added to every ${ctx.frequency} payment.`}
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={chip}
          onValueChange={(v) => v && onChange({ ...value, amount: Number(v) })}
          aria-label="Quick extra amounts"
          className="w-full"
        >
          {QUICK_EXTRA_AMOUNTS.map((n) => (
            <ToggleGroupItem key={n} value={String(n)} aria-label={`${fmt(n)} ${ctx.perPeriodLabel}`} className="num data-[state=on]:bg-primary/10 data-[state=on]:font-semibold data-[state=on]:text-primary">
              +{fmt(n)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <CurrencyInput
          id="extra-amount"
          value={value.amount}
          onValueChange={(amount) => onChange({ ...value, amount })}
          error={errors[fieldIds.extraAmount]}
          placeholder="Custom amount"
          max={1_000_000}
        />
        <AmountSlider
          className="mt-1"
          value={value.amount ?? 0}
          onValueChange={(amount) => onChange({ ...value, amount: amount === 0 ? null : amount })}
          max={ctx.sliderMax}
          step={5}
          label="Adjust extra amount"
          valueText={`${formatCurrency(value.amount ?? 0, ctx.currency)} ${ctx.perPeriodLabel}`}
          minLabel={fmt(0)}
          maxLabel={fmt(ctx.sliderMax)}
        />
      </FormField>

      <FormField label="Start date" htmlFor="extra-start" optional hint="Leave blank to start with your next payment.">
        <DateInput
          id="extra-start"
          value={value.startDate}
          min={ctx.minDate}
          onValueChange={(startDate: IsoDate | null) => onChange({ ...value, startDate })}
          error={errors[fieldIds.extraStart]}
        />
      </FormField>
    </div>
  );
}
