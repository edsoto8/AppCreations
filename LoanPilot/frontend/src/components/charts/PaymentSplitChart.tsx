import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ScheduleRow } from '@/api/types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatAxisMonth, formatCurrency, formatCurrencyCompact, formatDate } from '@/lib/format';
import { niceTicks } from './ticks';
import { ChartTooltipCard, LegendItem } from './ChartTooltip';
import { barCursor, gridProps, SERIES, SURFACE, xAxisProps, yAxisProps } from './chartTheme';

interface PaymentSplitChartProps {
  rows: ScheduleRow[];
  currency: string;
  height?: number;
}

export function PaymentSplitLegend() {
  return (
    <>
      <LegendItem color={SERIES.principal} label="Principal" />
      <LegendItem color={SERIES.interest} label="Interest" />
    </>
  );
}

/** Stacked columns: how each scheduled payment splits between principal and interest. */
export function PaymentSplitChart({ rows, currency, height = 260 }: PaymentSplitChartProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const payments = rows.filter((r) => r.kind === 'payment');
  // 4px rounded data-end on wide columns; dense schedules get a smaller radius so thin bars stay bars.
  const radius = payments.length > 60 ? 2 : 4;
  const ticks = niceTicks(Math.max(0, ...payments.map((r) => r.principal + r.interest)));
  return (
    <div
      style={{ height }}
      className="w-full"
      role="img"
      aria-label="Principal and interest per payment chart. Use the table view for exact values."
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={payments} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="12%">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" tickFormatter={formatAxisMonth} {...xAxisProps} />
          <YAxis ticks={ticks} domain={[0, ticks[ticks.length - 1]]} tickFormatter={(v: number) => formatCurrencyCompact(v, currency)} {...yAxisProps} />
          <Tooltip
            cursor={barCursor}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as ScheduleRow | undefined) : undefined;
              if (!row) return null;
              return (
                <ChartTooltipCard
                  title={`${formatDate(row.date)}${row.number !== null ? ` · Payment #${row.number}` : ''}`}
                  rows={[
                    { key: 'principal', label: 'Principal', value: formatCurrency(row.principal, currency), color: SERIES.principal },
                    { key: 'interest', label: 'Interest', value: formatCurrency(row.interest, currency), color: SERIES.interest },
                    { key: 'total', label: 'Payment', value: formatCurrency(row.totalPayment, currency), emphasis: 'total' },
                  ]}
                />
              );
            }}
          />
          {/* The 1px surface stroke on each segment yields the 2px surface gap between touching marks. */}
          <Bar
            dataKey="principal"
            name="Principal"
            stackId="split"
            fill={SERIES.principal}
            stroke={SURFACE}
            strokeWidth={1}
            maxBarSize={24}
            isAnimationActive={!reducedMotion}
          />
          <Bar
            dataKey="interest"
            name="Interest"
            stackId="split"
            fill={SERIES.interest}
            stroke={SURFACE}
            strokeWidth={1}
            radius={[radius, radius, 0, 0]}
            maxBarSize={24}
            isAnimationActive={!reducedMotion}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PaymentSplitTable({ rows, currency }: { rows: ScheduleRow[]; currency: string }) {
  return (
    <Table>
      <TableHeader className="sticky top-0 bg-card">
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>#</TableHead>
          <TableHead className="text-right">Principal</TableHead>
          <TableHead className="text-right">Interest</TableHead>
          <TableHead className="text-right">Payment</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows
          .filter((r) => r.kind === 'payment')
          .map((r) => (
            <TableRow key={`${r.date}-${r.number}`}>
              <TableCell>{formatDate(r.date)}</TableCell>
              <TableCell className="text-muted-foreground">{r.number}</TableCell>
              <TableCell className="text-right">{formatCurrency(r.principal, currency)}</TableCell>
              <TableCell className="text-right">{formatCurrency(r.interest, currency)}</TableCell>
              <TableCell className="text-right">{formatCurrency(r.totalPayment, currency)}</TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}
