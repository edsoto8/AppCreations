import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

interface AmountSliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max: number;
  step?: number;
  /** Accessible name of the thumb (the focusable element). */
  label: string;
  /** Spoken value, e.g. "$150.00 per month". */
  valueText: string;
  minLabel?: string;
  maxLabel?: string;
  className?: string;
}

/**
 * Single-thumb slider. Composed from the Radix primitive (rather than ui/slider) so the thumb
 * itself carries the accessible name and a formatted aria-valuetext; arrow keys step, Page Up/Down
 * jump by 10 steps, Home/End go to the ends.
 */
export function AmountSlider({ value, onValueChange, min = 0, max, step = 5, label, valueText, minLabel, maxLabel, className }: AmountSliderProps) {
  const clamped = Math.min(max, Math.max(min, value));
  return (
    <div className={cn('grid gap-2', className)}>
      <SliderPrimitive.Root
        data-slot="slider"
        value={[clamped]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onValueChange(v[0] ?? min)}
        className="relative flex h-5 w-full touch-none items-center select-none data-[disabled]:opacity-50"
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/15">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={label}
          aria-valuetext={valueText}
          className="block size-5 shrink-0 rounded-full border-2 border-primary bg-background shadow-sm ring-ring/40 transition-[box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden"
        />
      </SliderPrimitive.Root>
      {(minLabel || maxLabel) && (
        <div className="num flex justify-between text-xs text-muted-foreground" aria-hidden>
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}
