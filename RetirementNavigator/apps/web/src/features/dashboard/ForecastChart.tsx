import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { DashboardResult, DollarBasis, Household } from '@rn/engine';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCents } from '@/lib/format';
import { BeforeLimitsBadge, BeforeTaxesBadge } from './badges';
import { SeriesLegend, TooltipCard, type LegendItem } from './chartParts';
import { AXIS_TICK, DASH, forecastMarkers, markerLabel, type Marker } from './chartUtils';
import { DataTableDisclosure } from './DataTableDisclosure';
import {
  basisName,
  forecastSeries,
  formatCompactCents,
  formatOffset,
  agePrefix,
  phaseLabel,
  type ForecastPoint,
} from './viewModel';

const CHART_STYLE = { width: '100%', height: 300 } as const;
const MARGIN = { top: 8, right: 12, bottom: 4, left: 4 } as const;

function pointOf(props: TooltipContentProps): ForecastPoint | null {
  if (!props.active) return null;
  const first = props.payload[0] as { payload?: ForecastPoint } | undefined;
  return first?.payload ?? null;
}

function PortfolioTooltip(props: TooltipContentProps) {
  const p = pointOf(props);
  if (!p) return null;
  const rows = [
    { label: 'Start of year', value: p.start },
    { label: 'Contributions', value: p.contributions },
    { label: 'Growth (net of fees)', value: p.growth },
    { label: 'Withdrawals', value: p.withdrawals },
    ...(p.forfeited > 0 ? [{ label: 'Forfeited (unvested)', value: p.forfeited }] : []),
    { label: 'End of year', value: p.end, color: 'var(--chart-1)', strong: true },
    ...(p.optimistic !== null ? [{ label: 'Optimistic end', value: p.optimistic, color: 'var(--chart-3)' }] : []),
    ...(p.pessimistic !== null ? [{ label: 'Pessimistic end', value: p.pessimistic, color: 'var(--chart-2)' }] : []),
  ];
  return (
    <TooltipCard
      title={String(p.year)}
      subtitle={`${agePrefix(p.ages)} ${p.ages} · ${phaseLabel(p.phase)}`}
      rows={rows}
    />
  );
}

function FlowsTooltip(props: TooltipContentProps) {
  const p = pointOf(props);
  if (!p) return null;
  return (
    <TooltipCard
      title={String(p.year)}
      subtitle={`${agePrefix(p.ages)} ${p.ages} · ${phaseLabel(p.phase)}`}
      rows={[
        { label: 'Contributions', value: p.contributions, color: 'var(--chart-1)' },
        { label: 'Investment growth', value: p.growth, color: 'var(--chart-3)' },
        { label: 'Withdrawals', value: p.withdrawals, color: 'var(--chart-2)' },
      ]}
    />
  );
}

function MarkerLines({ markers, first, last }: { markers: Marker[]; first: number; last: number }) {
  const middle = (first + last) / 2;
  return (
    <>
      {markers.map((m, i) => (
        <ReferenceLine
          key={m.label}
          x={m.year}
          stroke="var(--chart-marker)"
          strokeDasharray="3 3"
          label={markerLabel(`${m.label} ${m.year}`, i, m.year > middle)}
        />
      ))}
    </>
  );
}

function MarkerList({ markers }: { markers: Marker[] }) {
  if (markers.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Marked on the chart: {markers.map((m) => `${m.description} in ${m.year}`).join('; ')}.
    </p>
  );
}

export function ForecastChart({
  dashboard,
  household,
  basis,
  beforeLimits,
}: {
  dashboard: DashboardResult;
  household: Household;
  basis: DollarBasis;
  beforeLimits: boolean;
}) {
  const points = useMemo(() => forecastSeries(dashboard, household, basis), [dashboard, household, basis]);
  const markers = forecastMarkers(dashboard.baseline, household);
  const offsets = household.assumptions.deterministicOffsets;
  const opt = formatOffset(offsets.optimistic);
  const pes = formatOffset(offsets.pessimistic);
  const first = points[0]?.year ?? 0;
  const last = points[points.length - 1]?.year ?? 0;
  const unit = basisName(basis);
  const anyForfeited = points.some((p) => p.forfeited > 0);
  const legend: LegendItem[] = [
    { label: 'Baseline', color: 'var(--chart-1)', style: 'area' },
    { label: `Optimistic (${opt} points)`, color: 'var(--chart-3)', style: 'dashed' },
    { label: `Pessimistic (${pes} points)`, color: 'var(--chart-2)', style: 'dotted' },
  ];
  const flowLegend: LegendItem[] = [
    { label: 'Contributions', color: 'var(--chart-1)', style: 'solid' },
    { label: 'Investment growth (net of fees)', color: 'var(--chart-3)', style: 'dashed' },
    { label: 'Withdrawals', color: 'var(--chart-2)', style: 'dotted' },
  ];
  const offsetNote = `Optimistic and pessimistic lines are fixed return offsets (${opt}/${pes} points), not confidence intervals.`;

  return (
    <Card aria-labelledby="forecast-title">
      <CardHeader>
        <CardTitle id="forecast-title">Forecast</CardTitle>
        <CardDescription>
          Year-by-year portfolio value in {unit}. {offsetNote}
        </CardDescription>
        <div className="flex flex-wrap gap-1.5">
          {beforeLimits ? <BeforeLimitsBadge /> : null}
          <BeforeTaxesBadge />
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="value" className="flex flex-col gap-4">
          <TabsList aria-label="Forecast chart" className="self-start">
            <TabsTrigger value="value">Portfolio value</TabsTrigger>
            <TabsTrigger value="flows">Annual flows</TabsTrigger>
          </TabsList>

          <TabsContent value="value" className="flex flex-col gap-3">
            <figure className="flex flex-col gap-2">
              <figcaption className="text-xs font-medium text-muted-foreground">
                Portfolio value at year end ({unit}) by year
              </figcaption>
              <SeriesLegend items={legend} />
              <ComposedChart
                responsive
                style={CHART_STYLE}
                data={points}
                margin={MARGIN}
                title={`Portfolio value at year end, ${unit}`}
                desc={`Baseline from ${first} to ${last}, with optimistic and pessimistic fixed return offsets. A data table follows the chart.`}
              >
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="year"
                  type="number"
                  domain={[first, last]}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--chart-grid)' }}
                  allowDecimals={false}
                />
                <YAxis
                  tickFormatter={formatCompactCents}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
                <Tooltip content={PortfolioTooltip} cursor={{ stroke: 'var(--chart-axis)' }} />
                <Area
                  dataKey="end"
                  name="Baseline"
                  type="monotone"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill="var(--chart-1)"
                  fillOpacity={0.15}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="optimistic"
                  name="Optimistic"
                  type="monotone"
                  stroke="var(--chart-3)"
                  strokeWidth={2}
                  strokeDasharray={DASH.dashed}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="pessimistic"
                  name="Pessimistic"
                  type="monotone"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  strokeDasharray={DASH.dotted}
                  dot={false}
                  isAnimationActive={false}
                />
                {MarkerLines({ markers, first, last })}
              </ComposedChart>
              <p className="text-center text-xs text-muted-foreground">Year</p>
            </figure>
            <MarkerList markers={markers} />
            <DataTableDisclosure label="portfolio value data table">
              <Table label={`Portfolio value by year, ${unit}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Year</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead className="text-right">Start of year</TableHead>
                    <TableHead className="text-right">Contributions{beforeLimits ? '*' : ''}</TableHead>
                    <TableHead className="text-right">Growth (net)</TableHead>
                    <TableHead className="text-right">Withdrawals</TableHead>
                    {anyForfeited ? <TableHead className="text-right">Forfeited (unvested)</TableHead> : null}
                    <TableHead className="text-right">Baseline end</TableHead>
                    <TableHead className="text-right">Optimistic end</TableHead>
                    <TableHead className="text-right">Pessimistic end</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.map((p) => (
                    <TableRow key={p.year}>
                      <TableCell>{p.year}</TableCell>
                      <TableCell>{p.ages}</TableCell>
                      <TableCell className="text-right">{formatCents(p.start)}</TableCell>
                      <TableCell className="text-right">{formatCents(p.contributions)}</TableCell>
                      <TableCell className="text-right">{formatCents(p.growth)}</TableCell>
                      <TableCell className="text-right">{formatCents(p.withdrawals)}</TableCell>
                      {anyForfeited ? <TableCell className="text-right">{formatCents(p.forfeited)}</TableCell> : null}
                      <TableCell className="text-right font-medium">{formatCents(p.end)}</TableCell>
                      <TableCell className="text-right">
                        {p.optimistic === null ? '—' : formatCents(p.optimistic)}
                      </TableCell>
                      <TableCell className="text-right">
                        {p.pessimistic === null ? '—' : formatCents(p.pessimistic)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                {beforeLimits ? '* As elected, before plan limits (unverified). ' : ''}
                {offsetNote}
              </p>
            </DataTableDisclosure>
          </TabsContent>

          <TabsContent value="flows" className="flex flex-col gap-3">
            <figure className="flex flex-col gap-2">
              <figcaption className="text-xs font-medium text-muted-foreground">
                Annual flows ({unit}) by year, baseline forecast
              </figcaption>
              <SeriesLegend items={flowLegend} />
              <LineChart
                responsive
                style={CHART_STYLE}
                data={points}
                margin={MARGIN}
                title={`Annual contributions, investment growth and withdrawals, ${unit}`}
                desc="Baseline forecast. A data table follows the chart."
              >
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="year"
                  type="number"
                  domain={[first, last]}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--chart-grid)' }}
                  allowDecimals={false}
                />
                <YAxis
                  tickFormatter={formatCompactCents}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
                <Tooltip content={FlowsTooltip} cursor={{ stroke: 'var(--chart-axis)' }} />
                <ReferenceLine y={0} stroke="var(--chart-axis)" />
                <Line
                  dataKey="contributions"
                  name="Contributions"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="growth"
                  name="Investment growth"
                  stroke="var(--chart-3)"
                  strokeWidth={2}
                  strokeDasharray={DASH.dashed}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="withdrawals"
                  name="Withdrawals"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  strokeDasharray={DASH.dotted}
                  dot={false}
                  isAnimationActive={false}
                />
                {MarkerLines({ markers, first, last })}
              </LineChart>
              <p className="text-center text-xs text-muted-foreground">Year</p>
            </figure>
            <DataTableDisclosure label="annual flows data table">
              <Table label={`Annual flows by year, ${unit}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Year</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead className="text-right">Contributions{beforeLimits ? '*' : ''}</TableHead>
                    <TableHead className="text-right">Investment growth (net)</TableHead>
                    <TableHead className="text-right">Withdrawals</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.map((p) => (
                    <TableRow key={p.year}>
                      <TableCell>{p.year}</TableCell>
                      <TableCell>{p.ages}</TableCell>
                      <TableCell className="text-right">{formatCents(p.contributions)}</TableCell>
                      <TableCell className="text-right">{formatCents(p.growth)}</TableCell>
                      <TableCell className="text-right">{formatCents(p.withdrawals)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {beforeLimits ? (
                <p className="text-xs text-muted-foreground">* As elected, before plan limits (unverified).</p>
              ) : null}
            </DataTableDisclosure>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
