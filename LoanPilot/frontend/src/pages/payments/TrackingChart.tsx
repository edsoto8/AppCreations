import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartTooltipCard, LegendItem, type TooltipRow } from '@/components/charts/ChartTooltip';
import { activeDot, gridProps, lineCursor, xAxisProps, yAxisProps } from '@/components/charts/chartTheme';
import { niceTicks } from '@/components/charts/ticks';
import type { TrackingPoint } from '@/api/types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatAxisMonth, formatCurrency, formatCurrencyCompact, formatDate } from '@/lib/format';

/** Fixed categorical order: slot 1 = what you recorded (the story), slot 2 = the schedule it is measured against. */
export const TRACKING_SERIES = { actual: 'var(--chart-1)', scheduled: 'var(--chart-2)' } as const;

export function TrackingLegend() {
  return (
    <>
      <LegendItem color={TRACKING_SERIES.actual} label="Recorded payments" shape="line" />
      <LegendItem color={TRACKING_SERIES.scheduled} label="Original schedule" shape="line" />
    </>
  );
}

const diff = (p: TrackingPoint) =>
  p.actualCumulative === null ? null : (Math.round(p.actualCumulative * 100) - Math.round(p.scheduledCumulative * 100)) / 100;

/** Cumulative paid over time: recorded payments vs what the original schedule called for. */
export function TrackingChart({ points, currency, height = 280 }: { points: TrackingPoint[]; currency: string; height?: number }) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const ticks = niceTicks(Math.max(0, ...points.flatMap((p) => [p.scheduledCumulative, p.actualCumulative ?? 0])));
  return (
    <div
      style={{ height }}
      className="w-full"
      role="img"
      aria-label="Recorded payments compared with the original schedule. Use the table view for exact values."
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" tickFormatter={formatAxisMonth} {...xAxisProps} />
          <YAxis
            ticks={ticks}
            domain={[0, ticks[ticks.length - 1]]}
            tickFormatter={(v: number) => formatCurrencyCompact(v, currency)}
            {...yAxisProps}
          />
          <Tooltip
            cursor={lineCursor}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as TrackingPoint | undefined) : undefined;
              if (!p) return null;
              const d = diff(p);
              const rows: TooltipRow[] = [
                {
                  key: 'actual',
                  label: 'Recorded',
                  value: p.actualCumulative === null ? 'No records yet' : formatCurrency(p.actualCumulative, currency),
                  color: TRACKING_SERIES.actual,
                },
                { key: 'scheduled', label: 'Schedule', value: formatCurrency(p.scheduledCumulative, currency), color: TRACKING_SERIES.scheduled },
              ];
              if (d !== null)
                rows.push({ key: 'diff', label: d >= 0 ? 'Ahead' : 'Behind', value: formatCurrency(Math.abs(d), currency), emphasis: 'total' });
              return <ChartTooltipCard title={formatDate(p.date)} rows={rows} />;
            }}
          />
          <Line
            type="linear"
            dataKey="scheduledCumulative"
            name="Original schedule"
            stroke={TRACKING_SERIES.scheduled}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={activeDot}
            isAnimationActive={!reducedMotion}
          />
          <Line
            type="linear"
            dataKey="actualCumulative"
            name="Recorded payments"
            stroke={TRACKING_SERIES.actual}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={activeDot}
            connectNulls={false}
            isAnimationActive={!reducedMotion}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrackingTable({ points, currency }: { points: TrackingPoint[]; currency: string }) {
  return (
    <Table>
      <TableHeader className="sticky top-0 bg-card">
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Recorded to date</TableHead>
          <TableHead className="text-right">Scheduled to date</TableHead>
          <TableHead className="text-right">Difference</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {points.map((p) => {
          const d = diff(p);
          return (
            <TableRow key={p.date}>
              <TableCell>{formatDate(p.date)}</TableCell>
              <TableCell className="text-right">{p.actualCumulative === null ? '—' : formatCurrency(p.actualCumulative, currency)}</TableCell>
              <TableCell className="text-right">{formatCurrency(p.scheduledCumulative, currency)}</TableCell>
              <TableCell className="text-right">{d === null ? '—' : formatCurrency(d, currency, { signDisplay: 'exceptZero' })}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
