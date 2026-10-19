import type * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/** Determinate progress bar (role="progressbar" with aria-valuenow / aria-valuemax from Radix). */
export function Progress({
  className,
  value,
  max = 100,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const pct = max > 0 && value != null ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <ProgressPrimitive.Root
      value={value}
      max={max}
      className={cn('relative h-2.5 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full bg-primary transition-[width] duration-150"
        style={{ width: `${pct}%` }}
      />
    </ProgressPrimitive.Root>
  );
}
