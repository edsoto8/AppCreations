import type * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva('flex gap-3 rounded-lg border p-4 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0', {
  variants: {
    variant: {
      info: 'bg-card',
      attention: 'border-attention/50 bg-attention/5 [&>svg]:text-attention',
      destructive: 'border-destructive/50 bg-destructive/5 [&>svg]:text-destructive',
    },
  },
  defaultVariants: { variant: 'info' },
});

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="note" className={cn(alertVariants({ variant }), className)} {...props} />;
}
