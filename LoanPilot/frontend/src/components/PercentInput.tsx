import { NumberField, type NumberFieldProps } from '@/components/NumberField';
import { formatNumber } from '@/lib/format';

export interface PercentInputProps extends Omit<NumberFieldProps, 'prefix' | 'suffix' | 'formatBound'> {}

/** Percent input (value in percent units: 6.49 means 6.49%). Defaults: 0–100, up to 3 decimals. */
export function PercentInput({ min = 0, max = 100, decimals = 3, minDecimals = 2, ...props }: PercentInputProps) {
  return (
    <NumberField
      {...props}
      min={min}
      max={max}
      decimals={decimals}
      minDecimals={minDecimals}
      grouping={false}
      suffix="%"
      formatBound={(n) => `${formatNumber(n, Number.isInteger(n) ? 0 : 2)}%`}
    />
  );
}
