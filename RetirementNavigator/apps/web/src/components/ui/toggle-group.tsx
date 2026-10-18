import type * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn('inline-flex items-center rounded-md border bg-card p-0.5', className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-sm px-2.5 text-xs font-medium text-muted-foreground',
        'hover:text-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}
