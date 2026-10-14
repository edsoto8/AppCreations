import { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { IsoDate } from '@/api/types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatAxisMonth, formatCurrency, formatCurrencyCompact, formatDate, formatMonthYear } from '@/lib/format';
import { ChartTooltipCard } from './ChartTooltip';
import { activeDot, gridProps, lineCursor, SURFACE, xAxisProps, yAxisProps } from './chartTheme';
import { BASELINE_SERIES_COLOR, SeriesSwatch } from './seriesPalette';
import { niceTicks } from './ticks';
import { dayToIso, isoToDay, monthTicks } from './timeScale';

/** One balance series: points in date order, ending at zero when the loan pays off. */
export interface BalanceSeries {
  key: string;
  name: string;
  color: string;
  /** Neutral reference series (dashed). */
  dashed?: boolean;
  /** Draw a ~10% wash under the line (use for the one series the chart is about). */
  area?: boolean;
  points: { date: IsoDate; balance: number }[];
  /** null when the strategy does not pay the loan off. */
  payoffDate: IsoDate | null;
}

type Datum = { day: number; date: IsoDate } & Record<string, number | IsoDate | null>;

/**
 * Merges several series onto one time axis. Between its own postings a balance does not change,
 * so each series carries its last balance forward to dates that only another series has (a lump
 * sum, say); after its payoff date it is null, so its line stops at zero.
 */
export function mergeBalanceSeries(series: BalanceSeries[]): Datum[] {
  const days = new Set<number>();
  for (const s of series) for (const p of s.points) days.add(isoToDay(p.date));
  const sorted = [...days].filter(Number.isFinite).sort((a, b) => a - b);
  const cursors = series.map(() => 0);
  const last: (number | null)[] = series.map(() => null);
  return sorted.map((day) => {
    const datum: Datum = { day, date: dayToIso(day) };
    series.forEach((s, i) => {
      while (cursors[i] < s.points.length && isoToDay(s.points[cursors[i]].date) <= day) {
        last[i] = s.points[cursors[i]].balance;
        cursors[i]++;
      }
      const end = s.points.length > 0 ? isoToDay(s.points[s.points.length - 1].date) : -Infinity;
      const start = s.points.length > 0 ? isoToDay(s.points[0].date) : Infinity;
      datum[s.key] = day < start || day > end ? null : last[i];
    });
    return datum;
  });
}

interface BalanceComparisonChartProps {
  series: BalanceSeries[];
  currency: string;
  height?: number;
  /** Keys hidden from the plot (legend toggles); the axis keeps its range so nothing jumps. */
  hidden?: ReadonlySet<string>;
  /** Annotate each visible series' payoff with a marker and label (best for two or three series). */
  annotatePayoffs?: boolean;
  ariaLabel?: string;
}

/**
 * Multi-series remaining balance on a true time axis. The baseline is a dashed neutral line, the
 * featured series a 2px line over a 10% wash; payoff dates get a ringed marker at zero and, when
 * `annotatePayoffs` is set, a hairline with a short label at the top of the plot.
 */
export function BalanceComparisonChart({
  series,
  currency,
  height = 300,
  hidden,
  annotatePayoffs = false,
  ariaLabel = 'Remaining balance over time chart. Use the table view for exact values.',
}: BalanceComparisonChartProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const narrow = useMediaQuery('(max-width: 639px)');
  const data = useMemo(() => mergeBalanceSeries(series), [series]);
  const visible = series.filter((s) => !hidden?.has(s.key));
  const maxBalance = Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.balance)));
  const yTicks = niceTicks(maxBalance);
  const minDay = data[0]?.day ?? 0;
  const maxDay = data[data.length - 1]?.day ?? 1;
  const xTicks = monthTicks(minDay, maxDay, narrow ? 4 : 7);
  const payoffs = visible.filter((s) => s.payoffDate !== null);
  // Labels stack in rows from the top so neighbouring payoffs never overlap; latest payoff first.
  const labelled = annotatePayoffs ? [...payoffs].sort((a, b) => isoToDay(b.payoffDate!) - isoToDay(a.payoffDate!)) : [];

  return (
    <div style={{ height }} className="w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: annotatePayoffs ? 12 + labelled.length * 16 : 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="day"
            type="number"
            scale="time"
            domain={[minDay, maxDay]}
            ticks={xTicks}
            tickFormatter={(d: number) => formatAxisMonth(dayToIso(d))}
            {...xAxisProps}
          />
          <YAxis
            ticks={yTicks}
            domain={[0, yTicks[yTicks.length - 1]]}
            tickFormatter={(v: number) => formatCurrencyCompact(v, currency)}
            {...yAxisProps}
          />
          <Tooltip
            cursor={lineCursor}
            content={({ active, payload }) => {
              const datum = active ? (payload?.[0]?.payload as Datum | undefined) : undefined;
              if (!datum) return null;
              return (
                <ChartTooltipCard
                  title={formatDate(datum.date as IsoDate)}
                  rows={visible.map((s) => {
                    const value = datum[s.key];
                    const paidOff = value === null && s.payoffDate !== null && isoToDay(s.payoffDate) < datum.day;
                    return {
                      key: s.key,
                      label: s.name,
                      value: typeof value === 'number' ? formatCurrency(value, currency) : paidOff ? 'Paid off' : '—',
                      color: s.color,
                    };
                  })}
                />
              );
            }}
          />
          {annotatePayoffs &&
            labelled.map((s, i) => (
              <ReferenceLine
                key={`payoff-line-${s.key}`}
                x={isoToDay(s.payoffDate!)}
                stroke="var(--chart-axis)"
                strokeWidth={1}
                ifOverflow="extendDomain"
                label={(props: { viewBox?: { x?: number; y?: number } }) => (
                  <PayoffLabel x={props.viewBox?.x ?? 0} y={(props.viewBox?.y ?? 0) - 6 - (labelled.length - 1 - i) * 16} text={`${s.name} · ${formatMonthYear(s.payoffDate)}`} anchorEnd={(isoToDay(s.payoffDate!) - minDay) / Math.max(1, maxDay - minDay) > 0.5} />
                )}
              />
            ))}
          {visible.map((s) =>
            s.area ? (
              <Area
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={0.1}
                connectNulls={false}
                activeDot={activeDot}
                isAnimationActive={!reducedMotion}
                animationDuration={400}
              />
            ) : (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                connectNulls={false}
                activeDot={activeDot}
                isAnimationActive={!reducedMotion}
                animationDuration={400}
              />
            ),
          )}
          {payoffs.map((s) => (
            <ReferenceDot
              key={`payoff-dot-${s.key}`}
              x={isoToDay(s.payoffDate!)}
              y={0}
              r={5}
              fill={s.color}
              stroke={SURFACE}
              strokeWidth={2}
              ifOverflow="visible"
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function PayoffLabel({ x, y, text, anchorEnd }: { x: number; y: number; text: string; anchorEnd: boolean }) {
  return (
    <text x={anchorEnd ? x - 4 : x + 4} y={y} textAnchor={anchorEnd ? 'end' : 'start'} fontSize={11} fill="var(--muted-foreground)" className="num">
      {text}
    </text>
  );
}

/** Legend row: line keys (dashed for the baseline) with the payoff date, so identity never depends on colour. */
export function BalanceComparisonLegend({ series }: { series: BalanceSeries[] }) {
  return (
    <>
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <SeriesSwatch color={s.color} dashed={s.dashed} />
          <span className="font-medium text-foreground">{s.name}</span>
          <span>{s.payoffDate ? `paid off ${formatMonthYear(s.payoffDate)}` : 'does not pay off'}</span>
        </span>
      ))}
    </>
  );
}

/** Table twin: every date with each series' balance. */
export function BalanceComparisonTable({ series, currency }: { series: BalanceSeries[]; currency: string }) {
  const data = useMemo(() => mergeBalanceSeries(series), [series]);
  return (
    <Table>
      <TableHeader className="sticky top-0 bg-card">
        <TableRow>
          <TableHead>Date</TableHead>
          {series.map((s) => (
            <TableHead key={s.key} className="text-right">
              {s.name}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((d) => (
          <TableRow key={d.day}>
            <TableCell>{formatDate(d.date as IsoDate)}</TableCell>
            {series.map((s) => {
              const v = d[s.key];
              return (
                <TableCell key={s.key} className="text-right">
                  {typeof v === 'number' ? formatCurrency(v, currency) : <span className="text-muted-foreground">Paid off</span>}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export { BASELINE_SERIES_COLOR };
