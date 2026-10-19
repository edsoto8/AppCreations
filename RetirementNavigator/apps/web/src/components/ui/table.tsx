import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Horizontally scrollable on small screens without scrolling the page. Focusable for keyboard scrolling. */
export function Table({ className, label, ...props }: React.ComponentProps<'table'> & { label: string }) {
  return (
    <div className="w-full overflow-x-auto rounded-md border" role="region" aria-label={label} tabIndex={0}>
      <table className={cn('w-full caption-bottom text-sm tabular-nums', className)} {...props} />
    </div>
  );
}
export const TableHeader = (p: React.ComponentProps<'thead'>) => (
  <thead className={cn('bg-muted/60', p.className)} {...p} />
);
export const TableBody = (p: React.ComponentProps<'tbody'>) => (
  <tbody className={cn('[&_tr:last-child]:border-0', p.className)} {...p} />
);
export const TableRow = (p: React.ComponentProps<'tr'>) => <tr className={cn('border-b', p.className)} {...p} />;
export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn('whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-muted-foreground', className)}
      {...props}
    />
  );
}
export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('whitespace-nowrap px-3 py-2', className)} {...props} />;
}
