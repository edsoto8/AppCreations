import { ShieldAlertIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export const DISCLAIMER_TEXT =
  'LoanPilot figures are estimates, not a lender payoff quote. Lender rules, fees, payment posting dates and your contract terms can change your actual payoff amount and date. Confirm with your lender before making financial decisions.';

/** Standard estimate disclaimer. `compact` renders a single muted line for page footers. */
export function Disclaimer({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) {
    return <p className={cn('text-xs leading-relaxed text-muted-foreground', className)}>{DISCLAIMER_TEXT}</p>;
  }
  return (
    <div className={cn('flex gap-3 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground', className)}>
      <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="leading-relaxed">{DISCLAIMER_TEXT}</p>
    </div>
  );
}
