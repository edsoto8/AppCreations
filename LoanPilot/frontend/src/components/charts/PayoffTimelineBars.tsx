import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { IsoDate } from '@/api/types';
import { formatDate, formatDuration, formatMonthYear } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface TimelineItem {
  key: string;
  label: string;
  /** Calendar months from projection start to payoff (from the engine). */
  months: number;
  payoffDate: IsoDate | null;
  paysOff: boolean;
  color: string;
  /** Short tag shown beside the label, e.g. "Baseline" or "Fastest". */
  tag?: ReactNode;
  /** The row the chart is about: full-strength label. Others are context. */
  emphasis?: boolean;
}

/**
 * Horizontal bars: time to payoff for each strategy, from one shared zero baseline. Bars are 14px
 * (capped well under 24px) with a 4px rounded data-end and a square start; the duration label sits
 * outside the bar end in text ink, so values never depend on colour or hover.
 */
export function PayoffTimelineBars({ items, className }: { items: TimelineItem[]; className?: string }) {
  const max = Math.max(1, ...items.map((i) => i.months));
  return (
    <ul className={cn('grid gap-3.5', className)} aria-label="Time to payoff by strategy">
      {items.map((item) => {
        const share = Math.max(0, Math.min(1, item.months / max));
        const duration = item.paysOff ? formatDuration(item.months) : 'Does not pay off';
        return (
          <li key={item.key} className="grid gap-1.5">
            <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
              <span className={cn('flex min-w-0 items-center gap-2', item.emphasis ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                <span className="truncate">{item.label}</span>
                {item.tag}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{item.payoffDate ? formatMonthYear(item.payoffDate) : '—'}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* The hit target is the full row track, not just the painted bar. */}
                  <div
                    tabIndex={0}
                    aria-label={`${item.label}: ${duration}${item.payoffDate ? `, paid off ${formatDate(item.payoffDate)}` : ''}`}
                    className="group relative flex h-3.5 min-w-0 flex-1 items-center rounded-r-[4px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <div
                      className="h-full rounded-r-[4px] transition-[width,filter] duration-300 group-hover:brightness-110"
                      style={{ width: `${share * 100}%`, minWidth: 3, backgroundColor: item.color, opacity: item.emphasis === false ? 0.85 : 1 }}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {item.label}: {duration}
                  {item.payoffDate ? ` · ${formatDate(item.payoffDate)}` : ''}
                </TooltipContent>
              </Tooltip>
              <span className={cn('num w-20 shrink-0 text-right text-xs', item.emphasis ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                {duration}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PayoffTimelineTable({ items }: { items: TimelineItem[] }) {
  return (
    <Table>
      <TableHeader className="sticky top-0 bg-card">
        <TableRow>
          <TableHead>Strategy</TableHead>
          <TableHead className="text-right">Time to payoff</TableHead>
          <TableHead className="text-right">Payoff date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((i) => (
          <TableRow key={i.key}>
            <TableCell>{i.label}</TableCell>
            <TableCell className="text-right">{i.paysOff ? formatDuration(i.months) : 'Does not pay off'}</TableCell>
            <TableCell className="text-right">{formatDate(i.payoffDate)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
