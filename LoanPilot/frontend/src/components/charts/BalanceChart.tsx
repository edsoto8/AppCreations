import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { IsoDate, ScheduleRow } from '@/api/types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatAxisMonth, formatCurrency, formatCurrencyCompact, formatDate } from '@/lib/format';
import { niceTicks } from './ticks';
import { ChartTooltipCard } from './ChartTooltip';
import { activeDot, gridProps, lineCursor, SERIES, xAxisProps, yAxisProps } from './chartTheme';

export interface BalancePoint {
  date: IsoDate;
  balance: number;
  number: number | null;
}

/** Projection start (today's balance) followed by each row's ending balance. */
export function toBalancePoints(startDate: IsoDate, startBalance: number, rows: ScheduleRow[]): BalancePoint[] {
  return [{ date: startDate, balance: startBalance, number: null }, ...rows.map((r) => ({ date: r.date, balance: r.endingBalance, number: r.number }))];
}

interface BalanceChartProps {
  points: BalancePoint[];
  currency: string;
  height?: number;
}

/** Single-series area: remaining principal balance over time, with a crosshair tooltip. */
export function BalanceChart({ points, currency, height = 260 }: BalanceChartProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const ticks = niceTicks(Math.max(0, ...points.map((p) => p.balance)));
  return (
    <div style={{ height }} className="w-full" role="img" aria-label="Remaining balance over time chart. Use the table view for exact values.">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" tickFormatter={formatAxisMonth} {...xAxisProps} />
          <YAxis ticks={ticks} domain={[0, ticks[ticks.length - 1]]} tickFormatter={(v: number) => formatCurrencyCompact(v, currency)} {...yAxisProps} />
          <Tooltip
            cursor={lineCursor}
            content={({ active, payload }) => {
              const point = active ? (payload?.[0]?.payload as BalancePoint | undefined) : undefined;
              if (!point) return null;
              return (
                <ChartTooltipCard
                  title={formatDate(point.date)}
                  rows={[{ key: 'balance', label: 'Balance', value: formatCurrency(point.balance, currency), color: SERIES.balance }]}
                  footer={point.number !== null ? `After payment #${point.number}` : 'Projection start'}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="balance"
            name="Balance"
            stroke={SERIES.balance}
            strokeWidth={2}
            fill={SERIES.balance}
            fillOpacity={0.1}
            activeDot={activeDot}
            isAnimationActive={!reducedMotion}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BalanceTable({ points, currency }: { points: BalancePoint[]; currency: string }) {
  return (
    <Table>
      <TableHeader className="sticky top-0 bg-card">
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Payment</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {points.map((p) => (
          <TableRow key={`${p.date}-${p.number ?? 'start'}`}>
            <TableCell>{formatDate(p.date)}</TableCell>
            <TableCell className="text-muted-foreground">{p.number !== null ? `#${p.number}` : 'Start'}</TableCell>
            <TableCell className="text-right">{formatCurrency(p.balance, currency)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
