/**
 * A line chart of engine series over years, ages or rates, with an HTML legend (line style as a
 * second channel), a tooltip and a data-table disclosure holding the same series (and optional extra
 * columns) as the accessible alternative. Values are engine cents; this file only formats them.
 */
import { useId } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCents } from '@/lib/format';
import { SeriesLegend, TooltipCard } from '@/features/dashboard/chartParts';
import { AXIS_TICK, DASH, type LineStyle } from '@/features/dashboard/chartUtils';
import { DataTableDisclosure } from '@/features/dashboard/DataTableDisclosure';
import { formatCompactCents } from '@/features/dashboard/viewModel';

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  style: Exclude<LineStyle, 'area'>;
}

export interface TableColumn {
  key: string;
  label: string;
  /** Default: dollars from cents. */
  format?: (value: number) => string;
}

export type ChartPoint = { x: number } & Record<string, number | null>;

const CHART_STYLE = { width: '100%', height: 260 } as const;

function renderTooltip(
  props: TooltipContentProps,
  series: ChartSeries[],
  xLabel: string,
  formatX: (x: number) => string,
) {
  const point = (props.payload[0] as { payload?: ChartPoint } | undefined)?.payload;
  if (!props.active || !point) return null;
  return (
    <TooltipCard
      title={`${xLabel} ${formatX(point.x)}`}
      rows={series
        .filter((s) => typeof point[s.key] === 'number')
        .map((s) => ({ label: s.label, value: point[s.key] as number, color: s.color }))}
    />
  );
}

export function SeriesChart({
  caption,
  xLabel,
  data,
  series,
  extraColumns = [],
  formatX = String,
  marker,
  tableLabel,
}: {
  /** Figure caption, including the dollar basis, e.g. "Year-end balance (nominal dollars) by year". */
  caption: string;
  xLabel: string;
  data: ChartPoint[];
  series: ChartSeries[];
  /** Table-only columns (after the series). */
  extraColumns?: TableColumn[];
  formatX?: (x: number) => string;
  marker?: { x: number; label: string } | null;
  /** Name of the data table, e.g. "fee impact data table". */
  tableLabel: string;
}) {
  const captionId = useId();
  const first = data[0]?.x ?? 0;
  const last = data[data.length - 1]?.x ?? 0;
  const columns: TableColumn[] = [...series.map((s) => ({ key: s.key, label: s.label })), ...extraColumns];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <figure className="flex min-w-0 flex-col gap-2" aria-labelledby={captionId}>
        <figcaption id={captionId} className="text-xs font-medium text-muted-foreground">
          {caption}
        </figcaption>
        <SeriesLegend items={series} />
        <LineChart
          responsive
          style={CHART_STYLE}
          data={data}
          margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
          title={caption}
          desc={`${series.map((s) => s.label).join(', ')}. A data table follows the chart.`}
        >
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            domain={[first, last]}
            tick={AXIS_TICK}
            tickFormatter={formatX}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-grid)' }}
            allowDecimals={false}
          />
          <YAxis tickFormatter={formatCompactCents} tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} />
          <Tooltip
            content={(props: TooltipContentProps) => renderTooltip(props, series, xLabel, formatX)}
            cursor={{ stroke: 'var(--chart-axis)' }}
          />
          {marker ? <ReferenceLine x={marker.x} stroke="var(--chart-marker)" strokeDasharray="3 3" /> : null}
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={DASH[s.style]}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
        <p className="text-center text-xs text-muted-foreground">
          {xLabel}
          {marker ? ` (dashed vertical line: ${marker.label})` : ''}
        </p>
      </figure>
      <DataTableDisclosure label={tableLabel}>
        <Table label={caption}>
          <TableHeader>
            <TableRow>
              <TableHead>{xLabel}</TableHead>
              {columns.map((c) => (
                <TableHead key={c.key} className="text-right">
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((p) => (
              <TableRow key={p.x}>
                <TableCell>{formatX(p.x)}</TableCell>
                {columns.map((c) => {
                  const v = p[c.key];
                  return (
                    <TableCell key={c.key} className="text-right">
                      {typeof v === 'number' ? (c.format ?? formatCents)(v) : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableDisclosure>
    </div>
  );
}
