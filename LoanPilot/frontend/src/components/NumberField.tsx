import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { FieldError } from '@/components/FormField';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface NumberFieldProps
  extends Omit<ComponentProps<'input'>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'prefix'> {
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** Maximum decimal places accepted while typing and shown on blur. */
  decimals?: number;
  /** Decimal places always shown on blur (e.g. 2 for cents). Defaults to `decimals`. */
  minDecimals?: number;
  min?: number;
  max?: number;
  /** Formats a bound for the built-in range messages. */
  formatBound?: (n: number) => string;
  /** External error (e.g. from validation or the server). Takes precedence over range errors. */
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Extra left/right padding classes to make room for the adornments. */
  prefixPaddingClassName?: string;
  suffixPaddingClassName?: string;
  /** Show grouping separators on blur (default true). */
  grouping?: boolean;
}

/** Strips everything but digits and one decimal point; limits decimals. */
export function sanitizeNumericText(text: string, decimals: number): string {
  let cleaned = text.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    const intPart = cleaned.slice(0, firstDot);
    const fracPart = cleaned.slice(firstDot + 1).replace(/\./g, '');
    cleaned = decimals > 0 ? `${intPart}.${fracPart.slice(0, decimals)}` : intPart;
  }
  return cleaned;
}

export function parseNumericText(text: string): number | null {
  if (text === '' || text === '.') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function rawText(value: number | null, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return '';
  const fixed = value.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/**
 * Numeric text input that keeps a number | null value. While focused it shows the raw digits
 * the user types; on blur it shows the formatted value and checks min/max.
 */
export function NumberField({
  value,
  onValueChange,
  decimals = 2,
  minDecimals,
  min,
  max,
  formatBound = (n) => formatNumber(n, decimals),
  error,
  prefix,
  suffix,
  prefixPaddingClassName = 'pl-7',
  suffixPaddingClassName = 'pr-8',
  grouping = true,
  className,
  id: idProp,
  onFocus,
  onBlur,
  disabled,
  'aria-describedby': describedBy,
  ...props
}: NumberFieldProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => rawText(value, decimals));
  const [touched, setTouched] = useState(false);
  const lastEmitted = useRef<number | null>(value);

  // Value changed from outside while editing (e.g. a quick-pick button): show it.
  useEffect(() => {
    if (focused && value !== lastEmitted.current) {
      setText(rawText(value, decimals));
      lastEmitted.current = value;
    }
  }, [value, focused, decimals]);

  const shownDecimals = minDecimals ?? decimals;
  const display = focused
    ? text
    : value === null || !Number.isFinite(value)
      ? ''
      : grouping
        ? new Intl.NumberFormat('en-US', {
            minimumFractionDigits: shownDecimals,
            maximumFractionDigits: decimals,
          }).format(value)
        : rawText(value, decimals);

  let rangeError: string | undefined;
  if (touched && value !== null) {
    if (min !== undefined && value < min) rangeError = `Enter at least ${formatBound(min)}.`;
    else if (max !== undefined && value > max) rangeError = `Enter no more than ${formatBound(max)}.`;
  }
  const shownError = error ?? rangeError;
  const errorId = `${id}-error`;

  return (
    <div className="grid content-start gap-1.5">
      <div className="relative">
        {prefix !== undefined && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
          >
            {prefix}
          </span>
        )}
        <Input
          {...props}
          id={id}
          type="text"
          inputMode={decimals > 0 ? 'decimal' : 'numeric'}
          autoComplete="off"
          disabled={disabled}
          value={display}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={[describedBy, shownError ? errorId : undefined].filter(Boolean).join(' ') || undefined}
          className={cn('num', prefix !== undefined && prefixPaddingClassName, suffix !== undefined && suffixPaddingClassName, className)}
          onFocus={(e) => {
            setText(rawText(value, decimals));
            lastEmitted.current = value;
            setFocused(true);
            onFocus?.(e);
          }}
          onChange={(e) => {
            const next = sanitizeNumericText(e.target.value, decimals);
            setText(next);
            const parsed = parseNumericText(next);
            lastEmitted.current = parsed;
            onValueChange(parsed);
          }}
          onBlur={(e) => {
            setFocused(false);
            setTouched(true);
            onBlur?.(e);
          }}
        />
        {suffix !== undefined && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
          >
            {suffix}
          </span>
        )}
      </div>
      {shownError && <FieldError id={errorId}>{shownError}</FieldError>}
    </div>
  );
}
