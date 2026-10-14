import { useState } from 'react';
import { ReceiptTextIcon, Trash2Icon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PaymentRecord } from '@/api/types';
import { formatCurrency, formatDate } from '@/lib/format';

const sumCents = (values: number[]) => values.reduce((s, v) => s + Math.round(v * 100), 0) / 100;

interface PaymentsTableProps {
  payments: PaymentRecord[];
  currency: string;
  deleting: boolean;
  onDelete: (payment: PaymentRecord) => Promise<unknown>;
}

/** Recorded payments, newest first, with a confirmed delete per row and totals. */
export function PaymentsTable({ payments, currency, deleting, onDelete }: PaymentsTableProps) {
  const [pending, setPending] = useState<PaymentRecord | null>(null);
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? null : formatCurrency(v, currency));
  const rows = [...payments].reverse();
  const withSplit = payments.filter((p) => p.interest !== null && p.interest !== undefined);

  if (payments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ReceiptTextIcon className="size-5" aria-hidden />
        </span>
        <p className="text-sm font-medium">No payments recorded</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          That is fine: LoanPilot works from your balance and schedule. Add payments here or import a CSV if you want to track them.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="max-h-[32rem] overflow-auto rounded-lg border" role="region" aria-label="Recorded payments" tabIndex={0}>
        <table className="num w-full text-sm">
          <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-0">
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Principal</TableHead>
              <TableHead className="text-right">Interest</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="w-12 pr-3">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="pl-4 font-medium">{formatDate(p.date)}</TableCell>
                <TableCell className="text-right font-medium">{fmt(p.amount)}</TableCell>
                <TableCell className="text-right">{fmt(p.principal) ?? <span className="text-muted-foreground/60">–</span>}</TableCell>
                <TableCell className="text-right">{fmt(p.interest) ?? <span className="text-muted-foreground/60">–</span>}</TableCell>
                <TableCell className="max-w-56 truncate text-muted-foreground" title={p.note ?? undefined}>
                  {p.note || <span className="text-muted-foreground/60">–</span>}
                </TableCell>
                <TableCell className="pr-3 text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete the ${formatCurrency(p.amount, currency)} payment on ${formatDate(p.date)}`}
                    onClick={() => setPending(p)}
                  >
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="sticky bottom-0 bg-muted shadow-[inset_0_1px_0_var(--border)]">
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-4 font-semibold">Total</TableCell>
              <TableCell className="text-right font-semibold">{fmt(sumCents(payments.map((p) => p.amount)))}</TableCell>
              <TableCell className="text-right font-semibold">
                {withSplit.length ? fmt(sumCents(withSplit.map((p) => p.principal ?? 0))) : '–'}
              </TableCell>
              <TableCell className="text-right font-semibold">
                {withSplit.length ? fmt(sumCents(withSplit.map((p) => p.interest ?? 0))) : '–'}
              </TableCell>
              <TableCell colSpan={2} className="pr-4 text-xs text-muted-foreground">
                {withSplit.length < payments.length ? `${withSplit.length} of ${payments.length} with a split` : 'All with a split'}
              </TableCell>
            </TableRow>
          </TableFooter>
        </table>
      </div>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this payment record?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending &&
                `The ${formatCurrency(pending.amount, currency)} payment on ${formatDate(pending.date, 'long')} will be removed from your records. `}
              This does not change your loan&apos;s balance or terms.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                if (!pending) return;
                void onDelete(pending).finally(() => setPending(null));
              }}
            >
              Delete payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
