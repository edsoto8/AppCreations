import { useContext } from 'react';
import { NumberField, type NumberFieldProps } from '@/components/NumberField';
import { PreferencesContextInternal } from '@/context/PreferencesContext';
import { currencySymbol, DEFAULT_CURRENCY, formatCurrency } from '@/lib/format';

export interface CurrencyInputProps
  extends Omit<NumberFieldProps, 'prefix' | 'suffix' | 'decimals' | 'minDecimals' | 'formatBound'> {
  /** ISO currency code; defaults to the user's preference. */
  currency?: string;
  /** Allow cents (default true). */
  cents?: boolean;
}

/**
 * Money input. Accepts typed digits (and one decimal point), emits number | null on every change,
 * and formats as currency (with cents) on blur. min/max produce an inline message after blur.
 */
export function CurrencyInput({ currency, cents = true, ...props }: CurrencyInputProps) {
  const prefs = useContext(PreferencesContextInternal);
  const code = currency ?? prefs?.preferences.currency ?? DEFAULT_CURRENCY;
  const symbol = currencySymbol(code);
  return (
    <NumberField
      {...props}
      decimals={cents ? 2 : 0}
      minDecimals={cents ? 2 : 0}
      prefix={symbol}
      prefixPaddingClassName={symbol.length > 1 ? (symbol.length > 2 ? 'pl-12' : 'pl-9') : 'pl-7'}
      formatBound={(n) => formatCurrency(n, code, { cents: cents && !Number.isInteger(n) })}
    />
  );
}
