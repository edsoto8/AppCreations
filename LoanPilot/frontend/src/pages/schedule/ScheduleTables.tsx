import { Fragment, type ReactNode } from 'react';
import { CoinsIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AnnualSummaryRow, IsoDate } from '@/api/types';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AnnualCompareRow, AnnualTotals, CompareRow, DisplayRow, RowTotals } from './scheduleModel';
import { annualTotals, sumCents } from './scheduleModel';

/**
 * Scroll container for wide tables: scrolls both ways inside itself (never the page), with a
 * sticky header row. Uses the shadcn table parts around our own <table> so the header can stick.
 */
export function TableFrame({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div
      className={cn('max-h-[min(72vh,760px)] overflow-auto overscroll-x-contain rounded-lg border bg-card', className)}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="num w-full caption-bottom text-sm">{children}</table>
    </div>
  );
}

const stickyHead = 'sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-0';
const stickyFoot = 'sticky bottom-0 z-10 bg-muted shadow-[inset_0_1px_0_var(--border)] [&_td]:py-2.5';

function Money({ value, currency, muted, zeroDash }: { value: number; currency: string; muted?: boolean; zeroDash?: boolean }) {
  if (zeroDash && value === 0) return <span className="text-muted-foreground/60">–</span>;
  return <span className={muted ? 'text-muted-foreground' : undefined}>{formatCurrency(value, currency)}</span>;
}

/** Signed difference: negative (scenario lower) is good, shown with its sign and in the positive tone. */
export function Diff({
  value,
  currency,
  goodWhen = 'negative',
}: {
  value: number | null;
  currency: string;
  /** Which sign is good news; "neutral" when neither is (e.g. paying more this year). */
  goodWhen?: 'negative' | 'positive' | 'neutral';
}) {
  if (value === null) return <span className="text-muted-foreground/60">–</span>;
  if (Math.abs(value) < 0.005) return <span className="text-muted-foreground">{formatCurrency(0, currency)}</span>;
  const tone = goodWhen === 'neutral' ? 'text-foreground' : (goodWhen === 'negative' ? value < 0 : value > 0) ? 'text-positive' : 'text-negative';
  return <span className={cn('font-medium', tone)}>{formatCurrency(value, currency, { signDisplay: 'exceptZero' })}</span>;
}

// ── Every payment ────────────────────────────────────────────────────────────

interface PaymentTableProps {
  rows: DisplayRow[];
  currency: string;
  showUnpaid: boolean;
  totals: RowTotals;
  totalsLabel: string;
  /** Key of the first projection row; a divider is drawn above it when estimated history precedes it. */
  projectionStartKey: string | null;
  projectionStartDate: IsoDate | null;
  nextKey: string | null;
}

export function PaymentTable({
  rows,
  currency,
  showUnpaid,
  totals,
  totalsLabel,
  projectionStartKey,
  projectionStartDate,
  nextKey,
}: PaymentTableProps) {
  const columns = showUnpaid ? 10 : 9;
  return (
    <TableFrame label="Amortization schedule">
      <TableHeader className={stickyHead}>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-4">Payment #</TableHead>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Starting balance</TableHead>
          <TableHead className="text-right">Scheduled payment</TableHead>
          <TableHead className="text-right">Extra payment</TableHead>
          <TableHead className="text-right">Interest</TableHead>
          <TableHead className="text-right">Principal</TableHead>
          <TableHead className="text-right">Ending balance</TableHead>
          <TableHead className="text-right">Cumulative interest</TableHead>
          {showUnpaid && <TableHead className="pr-4 text-right">Unpaid interest</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columns} className="py-10 text-center text-muted-foreground">
              No payments match these filters.
            </TableCell>
          </TableRow>
        )}
        {rows.map((row) => {
          const estimated = row.phase === 'history';
          const lump = row.kind === 'lumpSum';
          const next = row.key === nextKey;
          return (
            <Fragment key={row.key}>
              {row.key === projectionStartKey && (
                <TableRow className="hover:bg-transparent" data-testid="projection-divider">
                  <TableCell colSpan={columns} className="bg-primary/5 py-2 pl-4 text-xs font-medium text-primary">
                    Projection from {formatDate(projectionStartDate)}. Rows above are estimated; rows below are projected from that balance.
                  </TableCell>
                </TableRow>
              )}
              <TableRow
                data-row-kind={lump ? 'lumpSum' : estimated ? 'estimated' : 'payment'}
                aria-current={next ? 'date' : undefined}
                className={cn(
                  estimated && 'bg-muted/40 text-muted-foreground',
                  lump && 'bg-chart-3/[0.07] shadow-[inset_3px_0_0_var(--chart-3)] hover:bg-chart-3/10',
                  next && 'bg-primary/[0.06] shadow-[inset_3px_0_0_var(--primary)] hover:bg-primary/10',
                )}
              >
                <TableCell className="pl-4">
                  <span className="inline-flex items-center gap-2">
                    {lump ? (
                      <Badge variant="outline" className="border-chart-3/50 text-foreground">
                        <CoinsIcon aria-hidden /> Lump sum
                      </Badge>
                    ) : (
                      <span className={cn('min-w-7 font-medium', estimated ? 'text-muted-foreground' : 'text-foreground')}>{row.number}</span>
                    )}
                    {estimated && <Badge variant="estimate">Estimated</Badge>}
                    {next && <Badge variant="default">Next</Badge>}
                  </span>
                </TableCell>
                <TableCell>{formatDate(row.date)}</TableCell>
                <TableCell className="text-right">
                  <Money value={row.startingBalance} currency={currency} muted={!estimated} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={row.scheduledPayment} currency={currency} zeroDash />
                </TableCell>
                <TableCell className="text-right">
                  {row.extraPayment > 0 ? (
                    <span className={cn('font-medium', !estimated && 'text-positive')}>{formatCurrency(row.extraPayment, currency)}</span>
                  ) : (
                    <Money value={0} currency={currency} zeroDash />
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Money value={row.interest} currency={currency} zeroDash={lump} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={row.principal} currency={currency} />
                </TableCell>
                <TableCell className="text-right font-medium">
                  <Money value={row.endingBalance} currency={currency} />
                </TableCell>
                <TableCell className={cn('text-right', !showUnpaid && 'pr-4')}>
                  <Money value={row.cumulativeInterest} currency={currency} muted />
                </TableCell>
                {showUnpaid && (
                  <TableCell className="pr-4 text-right">
                    {row.unpaidInterest > 0 ? (
                      <span className="font-medium text-warning">{formatCurrency(row.unpaidInterest, currency)}</span>
                    ) : (
                      <Money value={0} currency={currency} zeroDash />
                    )}
                  </TableCell>
                )}
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
      {rows.length > 0 && (
        <TableFooter className={stickyFoot}>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={3} className="pl-4 font-semibold">
              {totalsLabel}
            </TableCell>
            <TableCell className="text-right font-semibold">{formatCurrency(totals.scheduledPayment, currency)}</TableCell>
            <TableCell className="text-right font-semibold">{formatCurrency(totals.extraPayment, currency)}</TableCell>
            <TableCell className="text-right font-semibold">{formatCurrency(totals.interest, currency)}</TableCell>
            <TableCell className="text-right font-semibold">{formatCurrency(totals.principal, currency)}</TableCell>
            <TableCell colSpan={showUnpaid ? 3 : 2} className="pr-4 text-right text-xs text-muted-foreground">
              Paid in total {formatCurrency(totals.totalPayment, currency)}
            </TableCell>
          </TableRow>
        </TableFooter>
      )}
    </TableFrame>
  );
}

// ── Baseline vs scenario, per payment ────────────────────────────────────────

function GroupHead({ children, span }: { children: ReactNode; span: number }) {
  return (
    <TableHead colSpan={span} className="h-8 border-l text-center text-[11px] tracking-wide text-muted-foreground uppercase">
      {children}
    </TableHead>
  );
}

export function CompareTable({
  rows,
  currency,
  scenarioName,
  totalsLabel,
}: {
  rows: CompareRow[];
  currency: string;
  scenarioName: string;
  totalsLabel: string;
}) {
  const t = {
    bPaid: sumCents(rows.map((r) => r.baseline?.totalPayment ?? 0)),
    sPaid: sumCents(rows.map((r) => r.scenario?.totalPayment ?? 0)),
    bInt: sumCents(rows.map((r) => r.baseline?.interest ?? 0)),
    sInt: sumCents(rows.map((r) => r.scenario?.interest ?? 0)),
  };
  return (
    <TableFrame label={`Baseline compared with ${scenarioName}`}>
      <TableHeader className={stickyHead}>
        <TableRow className="hover:bg-transparent">
          <TableHead colSpan={2} className="h-8" />
          <GroupHead span={2}>Payment</GroupHead>
          <GroupHead span={3}>Interest</GroupHead>
          <GroupHead span={3}>Ending balance</GroupHead>
        </TableRow>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-4">Payment #</TableHead>
          <TableHead>Date</TableHead>
          <TableHead className="border-l text-right">Baseline</TableHead>
          <TableHead className="text-right">Scenario</TableHead>
          <TableHead className="border-l text-right">Baseline</TableHead>
          <TableHead className="text-right">Scenario</TableHead>
          <TableHead className="text-right">Difference</TableHead>
          <TableHead className="border-l text-right">Baseline</TableHead>
          <TableHead className="text-right">Scenario</TableHead>
          <TableHead className="pr-4 text-right">Difference</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
              No payments match these filters.
            </TableCell>
          </TableRow>
        )}
        {rows.map((row) => {
          const lump = row.kind === 'lumpSum';
          const paidOff = !lump && row.scenario === null;
          return (
            <TableRow
              key={row.key}
              data-row-kind={lump ? 'lumpSum' : 'payment'}
              className={cn(lump && 'bg-chart-3/[0.07] shadow-[inset_3px_0_0_var(--chart-3)] hover:bg-chart-3/10')}
            >
              <TableCell className="pl-4">
                {lump ? (
                  <Badge variant="outline" className="border-chart-3/50 text-foreground">
                    <CoinsIcon aria-hidden /> Lump sum
                  </Badge>
                ) : (
                  <span className="font-medium">{row.number}</span>
                )}
              </TableCell>
              <TableCell>{formatDate(row.date)}</TableCell>
              <TableCell className="border-l text-right">
                {row.baseline ? <Money value={row.baseline.totalPayment} currency={currency} /> : <Money value={0} currency={currency} zeroDash />}
              </TableCell>
              <TableCell className="text-right">
                {row.scenario ? (
                  <span className={row.scenario.extraPayment > 0 ? 'font-medium text-positive' : undefined}>
                    {formatCurrency(row.scenario.totalPayment, currency)}
                  </span>
                ) : paidOff ? (
                  <Badge variant="positive">Paid off</Badge>
                ) : (
                  <Money value={0} currency={currency} zeroDash />
                )}
              </TableCell>
              <TableCell className="border-l text-right">
                {row.baseline ? <Money value={row.baseline.interest} currency={currency} /> : <Money value={0} currency={currency} zeroDash />}
              </TableCell>
              <TableCell className="text-right">
                {row.scenario && !lump ? (
                  <Money value={row.scenario.interest} currency={currency} />
                ) : (
                  <Money value={0} currency={currency} zeroDash />
                )}
              </TableCell>
              <TableCell className="text-right">
                <Diff value={row.interestDiff} currency={currency} />
              </TableCell>
              <TableCell className="border-l text-right">
                {row.baseline ? <Money value={row.baseline.endingBalance} currency={currency} /> : <Money value={0} currency={currency} zeroDash />}
              </TableCell>
              <TableCell className="text-right">
                {row.scenario ? (
                  <Money value={row.scenario.endingBalance} currency={currency} />
                ) : paidOff ? (
                  <Money value={0} currency={currency} />
                ) : (
                  <Money value={0} currency={currency} zeroDash />
                )}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <Diff value={row.balanceDiff} currency={currency} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      {rows.length > 0 && (
        <TableFooter className={stickyFoot}>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={2} className="pl-4 font-semibold">
              {totalsLabel}
            </TableCell>
            <TableCell className="border-l text-right font-semibold">{formatCurrency(t.bPaid, currency)}</TableCell>
            <TableCell className="text-right font-semibold">{formatCurrency(t.sPaid, currency)}</TableCell>
            <TableCell className="border-l text-right font-semibold">{formatCurrency(t.bInt, currency)}</TableCell>
            <TableCell className="text-right font-semibold">{formatCurrency(t.sInt, currency)}</TableCell>
            <TableCell className="text-right">
              <Diff value={(Math.round(t.sInt * 100) - Math.round(t.bInt * 100)) / 100} currency={currency} />
            </TableCell>
            <TableCell colSpan={3} className="border-l pr-4" />
          </TableRow>
        </TableFooter>
      )}
    </TableFrame>
  );
}

// ── Annual ───────────────────────────────────────────────────────────────────

export function AnnualTable({
  rows,
  currency,
  estimatedYears,
  totals = annualTotals(rows),
  frameless = false,
}: {
  rows: AnnualSummaryRow[];
  currency: string;
  estimatedYears: Set<number>;
  totals?: AnnualTotals;
  /** Plain table (used by the print summary). */
  frameless?: boolean;
}) {
  const body = (
    <>
      <TableHeader className={frameless ? undefined : stickyHead}>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-4">Year</TableHead>
          <TableHead className="text-right">Payments</TableHead>
          <TableHead className="text-right">Total paid</TableHead>
          <TableHead className="text-right">Principal</TableHead>
          <TableHead className="text-right">Interest</TableHead>
          <TableHead className="text-right">Extra</TableHead>
          <TableHead className="pr-4 text-right">Ending balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const estimated = estimatedYears.has(r.year);
          return (
            <TableRow key={r.year} className={cn(estimated && 'text-muted-foreground')} data-row-kind={estimated ? 'estimated' : 'year'}>
              <TableCell className="pl-4">
                <span className="inline-flex items-center gap-2">
                  <span className="font-medium text-foreground">{r.year}</span>
                  {estimated && <Badge variant="estimate">Includes estimated</Badge>}
                </span>
              </TableCell>
              <TableCell className="text-right">{formatNumber(r.payments)}</TableCell>
              <TableCell className="text-right">{formatCurrency(r.totalPaid, currency)}</TableCell>
              <TableCell className="text-right">{formatCurrency(r.principal, currency)}</TableCell>
              <TableCell className="text-right">{formatCurrency(r.interest, currency)}</TableCell>
              <TableCell className="text-right">
                {r.extra > 0 ? (
                  <span className="font-medium text-positive">{formatCurrency(r.extra, currency)}</span>
                ) : (
                  <Money value={0} currency={currency} zeroDash />
                )}
              </TableCell>
              <TableCell className="pr-4 text-right font-medium">{formatCurrency(r.endingBalance, currency)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter className={frameless ? undefined : stickyFoot}>
        <TableRow className="hover:bg-transparent">
          <TableCell className="pl-4 font-semibold">Total</TableCell>
          <TableCell className="text-right font-semibold">{formatNumber(totals.payments)}</TableCell>
          <TableCell className="text-right font-semibold">{formatCurrency(totals.totalPaid, currency)}</TableCell>
          <TableCell className="text-right font-semibold">{formatCurrency(totals.principal, currency)}</TableCell>
          <TableCell className="text-right font-semibold">{formatCurrency(totals.interest, currency)}</TableCell>
          <TableCell className="text-right font-semibold">{formatCurrency(totals.extra, currency)}</TableCell>
          <TableCell className="pr-4" />
        </TableRow>
      </TableFooter>
    </>
  );
  if (frameless) return <table className="num w-full text-sm">{body}</table>;
  return <TableFrame label="Annual summary">{body}</TableFrame>;
}

export function AnnualCompareTable({ rows, currency, scenarioName }: { rows: AnnualCompareRow[]; currency: string; scenarioName: string }) {
  const sum = (pick: (r: AnnualCompareRow) => number) => sumCents(rows.map(pick));
  const bInt = sum((r) => r.baseline?.interest ?? 0);
  const sInt = sum((r) => r.scenario?.interest ?? 0);
  const bPaid = sum((r) => r.baseline?.totalPaid ?? 0);
  const sPaid = sum((r) => r.scenario?.totalPaid ?? 0);
  return (
    <TableFrame label={`Annual summary, baseline compared with ${scenarioName}`}>
      <TableHeader className={stickyHead}>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-8" />
          <GroupHead span={3}>Total paid</GroupHead>
          <GroupHead span={3}>Interest</GroupHead>
          <GroupHead span={3}>Ending balance</GroupHead>
        </TableRow>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-4">Year</TableHead>
          {['Total paid', 'Interest', 'Ending balance'].map((g, i) => (
            <Fragment key={g}>
              <TableHead className="border-l text-right">Baseline</TableHead>
              <TableHead className="text-right">Scenario</TableHead>
              <TableHead className={cn('text-right', i === 2 && 'pr-4')}>Difference</TableHead>
            </Fragment>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.year}>
            <TableCell className="pl-4 font-medium">{r.year}</TableCell>
            <TableCell className="border-l text-right">{formatCurrency(r.baseline?.totalPaid ?? 0, currency)}</TableCell>
            <TableCell className="text-right">{formatCurrency(r.scenario?.totalPaid ?? 0, currency)}</TableCell>
            <TableCell className="text-right">
              <Diff value={r.paidDiff} currency={currency} goodWhen="neutral" />
            </TableCell>
            <TableCell className="border-l text-right">{formatCurrency(r.baseline?.interest ?? 0, currency)}</TableCell>
            <TableCell className="text-right">{formatCurrency(r.scenario?.interest ?? 0, currency)}</TableCell>
            <TableCell className="text-right">
              <Diff value={r.interestDiff} currency={currency} />
            </TableCell>
            <TableCell className="border-l text-right">{formatCurrency(r.baseline?.endingBalance ?? 0, currency)}</TableCell>
            <TableCell className="text-right">{formatCurrency(r.scenario?.endingBalance ?? 0, currency)}</TableCell>
            <TableCell className="pr-4 text-right">
              <Diff value={r.balanceDiff} currency={currency} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter className={stickyFoot}>
        <TableRow className="hover:bg-transparent">
          <TableCell className="pl-4 font-semibold">Total</TableCell>
          <TableCell className="border-l text-right font-semibold">{formatCurrency(bPaid, currency)}</TableCell>
          <TableCell className="text-right font-semibold">{formatCurrency(sPaid, currency)}</TableCell>
          <TableCell className="text-right">
            <Diff value={(Math.round(sPaid * 100) - Math.round(bPaid * 100)) / 100} currency={currency} />
          </TableCell>
          <TableCell className="border-l text-right font-semibold">{formatCurrency(bInt, currency)}</TableCell>
          <TableCell className="text-right font-semibold">{formatCurrency(sInt, currency)}</TableCell>
          <TableCell className="text-right">
            <Diff value={(Math.round(sInt * 100) - Math.round(bInt * 100)) / 100} currency={currency} />
          </TableCell>
          <TableCell colSpan={3} className="border-l pr-4" />
        </TableRow>
      </TableFooter>
    </TableFrame>
  );
}
