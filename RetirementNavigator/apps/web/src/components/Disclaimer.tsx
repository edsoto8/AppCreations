import { cn } from '@/lib/utils';

/** Required disclaimer (brief §1). Shown in the app footer, printable summary and docs. */
export const DISCLAIMER_TEXT =
  'Results are model-dependent educational estimates, not guarantees, tax advice, or investment recommendations. Taxes are simplified estimates.';

export function Disclaimer({ className }: { className?: string }) {
  return <p className={cn('text-xs leading-relaxed text-muted-foreground', className)}>{DISCLAIMER_TEXT}</p>;
}
