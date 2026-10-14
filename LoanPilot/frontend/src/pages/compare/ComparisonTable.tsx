import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, Loader2Icon, SlidersHorizontalIcon, Trash2Icon } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SeriesSwatch } from '@/components/charts/seriesPalette';
import type { ComparisonRow } from '@/api/types';
import { formatCount, formatCurrency, formatDate, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BEST_LABELS, sortRows, type BestKey, type SortKey, type SortState } from './comparisonModel';

interface ComparisonTableProps {
  rows: ComparisonRow[];
  colors: Map<string, string | null>;
  best: Map<string, BestKey[]>;
  currency: string;
  perPeriodShort: string;
  onDelete: (row: ComparisonRow) => Promise<unknown>;
}

const COLUMNS: { key: SortKey; label: string; align?: 'right'; defaultDir: 'asc' | 'desc' }[] = [
  { key: 'name', label: 'Strategy', defaultDir: 'asc' },
  { key: 'payoffDate', label: 'Payoff date', align: 'right', defaultDir: 'asc' },
  { key: 'monthsToPayoff', label: 'Payoff time', align: 'right', defaultDir: 'asc' },
  { key: 'paymentCount', label: 'Payments', align: 'right', defaultDir: 'asc' },
  { key: 'totalInterest', label: 'Interest', align: 'right', defaultDir: 'asc' },
  { key: 'interestSaved', label: 'Interest saved', align: 'right', defaultDir: 'desc' },
  { key: 'monthsSaved', label: 'Months saved', align: 'right', defaultDir: 'desc' },
  { key: 'percentInterestReduction', label: '% reduction', align: 'right', defaultDir: 'desc' },
  { key: 'recurringPayment', label: 'Regular payment', align: 'right', defaultDir: 'asc' },
  { key: 'lumpSumTotal', label: 'Lump sums', align: 'right', defaultDir: 'asc' },
  { key: 'totalPaid', label: 'Total paid', align: 'right', defaultDir: 'asc' },
];

export function ComparisonTable({ rows, colors, best, currency, perPeriodShort, onDelete }: ComparisonTableProps) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ComparisonRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const sorted = sortRows(rows, sort);
  const fmt = (v: number) => formatCurrency(v, currency);

  const toggleSort = (key: SortKey, defaultDir: 'asc' | 'desc') => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir }));
  };

  return (
    <>
      <Table className="min-w-[68rem]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((col, i) => {
              const activeSort = sort?.key === col.key ? sort.dir : null;
              return (
                <TableHead
                  key={col.key}
                  aria-sort={activeSort === 'asc' ? 'ascending' : activeSort === 'desc' ? 'descending' : 'none'}
                  className={cn(col.align === 'right' && 'text-right', i === 0 && 'sticky left-0 z-10 bg-card pl-4')}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key, col.defaultDir)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md py-1 font-medium transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                      activeSort && 'text-foreground',
                      col.align === 'right' && 'flex-row-reverse',
                    )}
                  >
                    {col.label}
                    {activeSort === 'asc' ? (
                      <ArrowUpIcon className="size-3.5" aria-hidden />
                    ) : activeSort === 'desc' ? (
                      <ArrowDownIcon className="size-3.5" aria-hidden />
                    ) : (
                      <ArrowUpDownIcon className="size-3.5 opacity-40" aria-hidden />
                    )}
                    <span className="sr-only">, sort</span>
                  </button>
                </TableHead>
              );
            })}
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => {
            const isBaseline = r.kind === 'baseline';
            const color = colors.get(r.key) ?? null;
            const picks = best.get(r.key) ?? [];
            return (
              <TableRow key={r.key} data-row-key={r.key} data-baseline={isBaseline || undefined} className={cn(isBaseline && 'bg-muted/60 hover:bg-muted/60')}>
                <TableCell className={cn('sticky left-0 z-10 min-w-40 pl-4 whitespace-normal sm:min-w-56', isBaseline ? 'bg-[color-mix(in_oklab,var(--muted)_60%,var(--card))]' : 'bg-card')}>
                  <div className="flex items-start gap-2.5">
                    <span className="mt-1.5">{color ? <SeriesSwatch color={color} dashed={isBaseline} /> : <span className="inline-block w-4" />}</span>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{r.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {isBaseline && <Badge variant="outline">Baseline</Badge>}
                        {r.kind === 'preset' && <Badge variant="secondary">Preset</Badge>}
                        {r.kind === 'saved' && <Badge variant="secondary">Saved</Badge>}
                        {picks.map((p) => (
                          <Badge key={p} variant="positive" data-best={p}>
                            {BEST_LABELS[p].badge}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right">{r.paysOff ? formatDate(r.payoffDate) : <span className="text-warning">Does not pay off</span>}</TableCell>
                <TableCell className="text-right">{r.paysOff ? formatDuration(r.monthsToPayoff) : '—'}</TableCell>
                <TableCell className="text-right">{formatNumber(r.paymentCount)}</TableCell>
                <TableCell className="text-right">{fmt(r.totalInterest)}</TableCell>
                <TableCell className={cn('text-right', r.interestSaved > 0 && 'font-medium text-positive')}>{isBaseline ? '—' : fmt(r.interestSaved)}</TableCell>
                <TableCell className="text-right">{isBaseline ? '—' : formatCount(r.monthsSaved, 'mo', 'mo')}</TableCell>
                <TableCell className="text-right">{isBaseline ? '—' : formatPercent(r.percentInterestReduction, 1)}</TableCell>
                <TableCell className="text-right">
                  {fmt(r.recurringPayment)}
                  <span className="text-xs text-muted-foreground">{perPeriodShort}</span>
                </TableCell>
                <TableCell className="text-right">{r.lumpSumTotal > 0 ? fmt(r.lumpSumTotal) : '—'}</TableCell>
                <TableCell className="text-right">{fmt(r.totalPaid)}</TableCell>
                <TableCell className="text-right">
                  {r.kind === 'saved' && r.scenarioId !== null ? (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/simulator?scenario=${r.scenarioId}`} aria-label={`Open ${r.name} in simulator`}>
                          <SlidersHorizontalIcon /> Open
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${r.name}`}
                        className="text-muted-foreground hover:text-negative"
                        onClick={() => setPendingDelete(r)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && !deleting && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The saved scenario is removed from this loan. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingDelete) return;
                setDeleting(true);
                onDelete(pendingDelete)
                  .then(() => setPendingDelete(null))
                  .catch(() => undefined)
                  .finally(() => setDeleting(false));
              }}
            >
              {deleting && <Loader2Icon className="animate-spin" />} Delete scenario
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
