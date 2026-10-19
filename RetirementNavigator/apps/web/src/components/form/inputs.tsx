import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { formatDollarsInput, parseDollarsToCents, parsePercent, percentInputValue } from '@/lib/format';
import { cn } from '@/lib/utils';

type Common = {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * Text input bound to a parsed value. Keeps the user's text while focused; re-syncs from the value
 * when it changes elsewhere (e.g. a slider). Invalid text is not propagated.
 */
function useSyncedText<T>(value: T, format: (v: T) => string) {
  const [text, setText] = useState(() => format(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(format(value));
  }, [value, format]);
  const onFocus = () => {
    focused.current = true;
  };
  const onBlur = () => {
    focused.current = false;
    setText(format(value));
  };
  return { text, setText, onFocus, onBlur };
}

const formatMoney = (v: number | null) => (v === null ? '' : formatDollarsInput(v));

export function MoneyInput({
  value,
  onChange,
  ...rest
}: Common & { value: number | null; onChange: (cents: number) => void }) {
  const { text, setText, onFocus, onBlur } = useSyncedText(value, formatMoney);
  return (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">
        $
      </span>
      <Input
        {...rest}
        className={cn('pl-7', rest.className)}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => {
          setText(e.target.value);
          const cents = parseDollarsToCents(e.target.value);
          if (cents !== null) onChange(cents);
        }}
      />
    </div>
  );
}

const formatPct = (v: number | null) => (v === null ? '' : percentInputValue(v));

export function PercentInput({
  value,
  onChange,
  ...rest
}: Common & { value: number | null; onChange: (fraction: number) => void }) {
  const { text, setText, onFocus, onBlur } = useSyncedText(value, formatPct);
  return (
    <div className="relative">
      <Input
        {...rest}
        className={cn('pr-8', rest.className)}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => {
          setText(e.target.value);
          const fraction = parsePercent(e.target.value);
          if (fraction !== null) onChange(fraction);
        }}
      />
      <span aria-hidden="true" className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">
        %
      </span>
    </div>
  );
}

const formatInt = (v: number | null) => (v === null ? '' : String(v));

export function IntegerInput({
  value,
  onChange,
  ...rest
}: Common & { value: number | null; onChange: (n: number) => void }) {
  const { text, setText, onFocus, onBlur } = useSyncedText(value, formatInt);
  return (
    <Input
      {...rest}
      inputMode="numeric"
      autoComplete="off"
      value={text}
      onFocus={onFocus}
      onBlur={onBlur}
      onChange={(e) => {
        setText(e.target.value);
        if (/^-?\d+$/.test(e.target.value.trim())) onChange(Number(e.target.value.trim()));
      }}
    />
  );
}

/** Slider with a synchronized percent input (brief §5.10). `min`/`max`/`step` are percents. */
export function PercentSlider({
  value,
  onChange,
  min,
  max,
  step,
  label,
  ...rest
}: Common & {
  value: number;
  onChange: (fraction: number) => void;
  min: number;
  max: number;
  step: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Slider
        aria-label={label}
        className="flex-1"
        min={min}
        max={max}
        step={step}
        value={[Math.min(max, Math.max(min, value * 100))]}
        onValueChange={([v]) => {
          if (v !== undefined) onChange(Math.round(v * 1e6) / 1e8);
        }}
        disabled={rest.disabled}
      />
      <PercentInput {...rest} value={value} onChange={onChange} className="w-24" />
    </div>
  );
}
