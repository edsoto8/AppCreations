import { CircleCheckIcon } from 'lucide-react';
import type { IsoDate } from '@/api/types';
import { formatDate } from '@/lib/format';

/**
 * Shown on a lump sum dated before the balance date: the engine treats it as already paid (it is
 * part of the current balance), so it is kept in the plan but not applied again.
 */
export function AlreadyPaidNote({ date, balanceDate }: { date: IsoDate | null; balanceDate: IsoDate }) {
  if (date === null || date >= balanceDate) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground" data-testid="already-paid">
      <CircleCheckIcon className="mt-px size-3.5 shrink-0 text-positive" aria-hidden />
      <span>
        <span className="font-medium text-foreground">Already paid.</span> It is dated before your balance date ({formatDate(balanceDate)}),
        so it is counted in your current balance and not applied again. Remove it or keep it as a record of your plan.
      </span>
    </p>
  );
}
