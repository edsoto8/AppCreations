import { CalendarPlusIcon, CoinsIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SERIES } from '@/components/charts/chartTheme';
import { saveDownload } from '@/api/client';
import type { IsoDate, ScheduleRow } from '@/api/types';
import { formatCount, formatCurrency, formatDate, parseIsoDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { buildIcs, sumCents } from './scheduleModel';

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

function dateBits(iso: IsoDate) {
  const p = parseIsoDate(iso);
  if (!p) return { month: '', weekday: '', day: '' };
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(p.year, p.month - 1, p.day);
  return { month: monthFmt.format(d), weekday: weekdayFmt.format(d), day: String(p.day) };
}

interface PaymentCalendarProps {
  rows: ScheduleRow[];
  currency: string;
  loanName: string;
  planName: string;
  today: IsoDate;
}

/** The next 12 payment dates as calendar tiles, with an .ics download. */
export function PaymentCalendar({ rows, currency, loanName, planName, today }: PaymentCalendarProps) {
  const total = sumCents(rows.map((r) => r.totalPayment));
  const fmt = (v: number) => formatCurrency(v, currency);

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="text-base">Upcoming payments</CardTitle>
        <CardDescription>
          {rows.length === 0
            ? `No payments are due on or after ${formatDate(today)} in this plan.`
            : `${formatCount(rows.length, 'payment')} from ${formatDate(rows[0].date)} · ${fmt(total)} in total · ${planName}.`}
        </CardDescription>
        {rows.length > 0 && (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                saveDownload({
                  blob: new Blob([buildIcs(rows, loanName, currency)], { type: 'text/calendar' }),
                  filename: `loanpilot-payments-${rows[0].date}.ics`,
                })
              }
            >
              <CalendarPlusIcon /> <span className="hidden sm:inline">Add to calendar</span>
              <span className="sm:hidden">.ics</span>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {rows.length > 0 && (
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Upcoming payment dates">
            {rows.map((r, i) => {
              const bits = dateBits(r.date);
              const lump = r.kind === 'lumpSum';
              const share = r.totalPayment > 0 ? Math.min(100, (r.principal / r.totalPayment) * 100) : 0;
              return (
                <li
                  key={`${r.date}-${r.number ?? `l${i}`}`}
                  className={cn(
                    'relative flex flex-col overflow-hidden rounded-xl border bg-card',
                    i === 0 && 'border-primary/40 ring-1 ring-primary/20',
                    lump && 'border-chart-3/50',
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-between gap-2 border-b px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase',
                      i === 0 ? 'bg-primary text-primary-foreground' : lump ? 'bg-chart-3/10 text-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    <span>{bits.month}</span>
                    <span className="num font-medium normal-case">{lump ? 'Lump sum' : `#${r.number}`}</span>
                  </div>
                  <div className="grid gap-2 px-3 pt-2.5 pb-3">
                    <div className="flex items-baseline gap-2">
                      <time dateTime={r.date} className="text-3xl leading-none font-semibold tracking-tight">
                        {bits.day}
                      </time>
                      <span className="text-xs text-muted-foreground">{bits.weekday}</span>
                      {i === 0 && (
                        <Badge variant="secondary" className="ml-auto">
                          Next
                        </Badge>
                      )}
                      {lump && <CoinsIcon className="ml-auto size-4 text-muted-foreground" aria-label="Lump sum" />}
                    </div>
                    <div className="num text-base font-semibold">{fmt(r.totalPayment)}</div>
                    <div
                      className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full"
                      role="img"
                      aria-label={`${fmt(r.principal)} principal, ${fmt(r.interest)} interest`}
                    >
                      <span className="h-full rounded-l-full" style={{ width: `${share}%`, backgroundColor: SERIES.principal }} />
                      {r.interest > 0 && <span className="h-full flex-1 rounded-r-full" style={{ backgroundColor: SERIES.interest }} />}
                    </div>
                    <div className="num grid gap-0.5 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden className="size-2 rounded-[2px]" style={{ backgroundColor: SERIES.principal }} />
                        {fmt(r.principal)} principal
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden className="size-2 rounded-[2px]" style={{ backgroundColor: SERIES.interest }} />
                        {fmt(r.interest)} interest
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
