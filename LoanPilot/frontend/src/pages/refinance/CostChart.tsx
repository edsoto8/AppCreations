import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartTooltipCard, LegendItem } from '@/components/charts/ChartTooltip';
import { activeDot, gridProps, lineCursor, SURFACE, xAxisProps, yAxisProps } from '@/components/charts/chartTheme';
import type { IsoDate, RefinanceCostPoint } from '@/api/types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatCurrency, formatCurrencyCompact, formatDate, formatMonthYear } from '@/lib/format';
import { niceRangeTicks } from './niceRange';

/** Fixed categorical order: slot 1 = the current loan, slot 2 = the refinance (validated pair). */
export const COST_SERIES = { current: 'var(--chart-1)', refinance: 'var(--chart-2)' } as const;

export function CostLegend() {
  return (
    <>
      <LegendItem color={COST_SERIES.current} label="Keep current loan" shape="line" />
      <LegendItem color={COST_SERIES.refinance} label="Refinance" shape="line" />
    </>
  );
}

/** The cost-series point on the break-even date (or null when refinancing never breaks even). */
export function breakEvenPoint(series: RefinanceCostPoint[], breakEvenDate: IsoDate | null): RefinanceCostPoint | null {
  if (!breakEvenDate) return null;
  return series.find((p) => p.date === breakEvenDate) ?? series.find((p) => p.date >= breakEvenDate) ?? null;
}

function gap(p: RefinanceCostPoint) {
  return (Math.round(p.currentCost * 100) - Math.round(p.refinanceCost * 100)) / 100;
}

interface CostChartProps {
  series: RefinanceCostPoint[];
  breakEvenDate: IsoDate | null;
  currency: string;
  height?: number;
}

/**
 * Two lines on one axis: your position after each payment (paid so far + fees paid + still owed)
 * if you keep the loan vs refinance. The break-even payment is marked with a hairline and a dot.
 */
export function CostChart({ series, breakEvenDate, currency, height = 300 }: CostChartProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const narrow = useMediaQuery('(max-width: 639px)');
  const values = series.flatMap((p) => [p.currentCost, p.refinanceCost]);
  const ticks = niceRangeTicks(Math.min(...values), Math.max(...values));
  const be = breakEvenPoint(series, breakEvenDate);
  const lastMonth = series[series.length - 1]?.month ?? 0;
  const beLabelRight = be ? be.month < lastMonth * 0.7 : true;

  return (
    <div
      style={{ height }}
      className="w-full"
      role="img"
      aria-label="Cost of keeping the loan versus refinancing over time. Use the table view for exact values."
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 24, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="month"
            type="number"
            domain={[0, lastMonth]}
            allowDecimals={false}
            tickFormatter={(m: number) => (m === 0 ? 'Now' : `#${m}`)}
            {...xAxisProps}
          />
          <YAxis
            ticks={ticks}
            domain={[ticks[0], ticks[ticks.length - 1]]}
            tickFormatter={(v: number) => formatCurrencyCompact(v, currency)}
            {...yAxisProps}
            width={60}
          />
          <Tooltip
            cursor={lineCursor}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as RefinanceCostPoint | undefined) : undefined;
              if (!p) return null;
              const g = gap(p);
              return (
                <ChartTooltipCard
                  title={p.month === 0 ? `Today · ${formatDate(p.date)}` : `Payment ${p.month} · ${formatDate(p.date)}`}
                  rows={[
                    { key: 'current', label: 'Keep current loan', value: formatCurrency(p.currentCost, currency), color: COST_SERIES.current },
                    { key: 'refinance', label: 'Refinance', value: formatCurrency(p.refinanceCost, currency), color: COST_SERIES.refinance },
                    {
                      key: 'gap',
                      label: Math.abs(g) < 0.005 ? 'Even' : g > 0 ? 'Refinance ahead' : 'Current loan ahead',
                      value: formatCurrency(Math.abs(g), currency),
                      emphasis: 'total',
                    },
                  ]}
                />
              );
            }}
          />
          {be && (
            <ReferenceLine
              x={be.month}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.6}
              strokeWidth={1}
              label={{
                value: narrow ? `Break-even #${be.month}` : `Break-even · ${formatMonthYear(be.date)}`,
                position: beLabelRight ? 'insideTopLeft' : 'insideTopRight',
                offset: 6,
                fill: 'var(--foreground)',
                fontSize: 12,
                fontWeight: 600,
                dy: -22,
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="currentCost"
            name="Keep current loan"
            stroke={COST_SERIES.current}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={activeDot}
            isAnimationActive={!reducedMotion}
          />
          <Line
            type="monotone"
            dataKey="refinanceCost"
            name="Refinance"
            stroke={COST_SERIES.refinance}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={activeDot}
            isAnimationActive={!reducedMotion}
          />
          {be && (
            <ReferenceDot x={be.month} y={be.refinanceCost} r={5} fill="var(--foreground)" stroke={SURFACE} strokeWidth={2} ifOverflow="visible" />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CostTable({ series, breakEvenDate, currency }: { series: RefinanceCostPoint[]; breakEvenDate: IsoDate | null; currency: string }) {
  const be = breakEvenPoint(series, breakEvenDate);
  return (
    <Table>
      <TableHeader className="sticky top-0 bg-card">
        <TableRow>
          <TableHead>Payment</TableHead>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Keep current loan</TableHead>
          <TableHead className="text-right">Refinance</TableHead>
          <TableHead className="text-right">Refinance ahead by</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {series.map((p) => (
          <TableRow key={p.month} className={p === be ? 'bg-primary/5 font-medium' : undefined}>
            <TableCell>
              {p.month === 0 ? 'Today' : `#${p.month}`}
              {p === be ? ' · break-even' : ''}
            </TableCell>
            <TableCell>{formatDate(p.date)}</TableCell>
            <TableCell className="text-right">{formatCurrency(p.currentCost, currency)}</TableCell>
            <TableCell className="text-right">{formatCurrency(p.refinanceCost, currency)}</TableCell>
            <TableCell className="text-right">{formatCurrency(gap(p), currency)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
