/**
 * Sequence-of-returns illustration (engine `sequenceRiskIllustration`): the same return deviations
 * from the first retirement year, applied bad-years-first and good-years-first, beside the baseline.
 */
import { useMemo } from 'react';
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
import type { DollarBasis, Household, SequenceRiskIllustration } from '@rn/engine';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCents } from '@/lib/format';
import { BeforeLimitsBadge, BeforeTaxesBadge } from '@/features/dashboard/badges';
import { SeriesLegend, TooltipCard, type LegendItem } from '@/features/dashboard/chartParts';
import { AXIS_TICK, DASH } from '@/features/dashboard/chartUtils';
import { DataTableDisclosure } from '@/features/dashboard/DataTableDisclosure';
import { agePrefix, basisName, formatCompactCents } from '@/features/dashboard/viewModel';
import { formatDeviation, sequencePoints, type SequencePoint } from './viewModel';

const CHART_STYLE = { width: '100%', height: 280 } as const;

function SequenceTooltip(props: TooltipContentProps) {
  const first = props.payload[0] as { payload?: SequencePoint } | undefined;
  const p = props.active ? first?.payload : undefined;
  if (!p) return null;
  return (
    <TooltipCard
      title={String(p.year)}
      subtitle={`${agePrefix(p.ages)} ${p.ages}`}
      rows={[
        { label: 'Bad years first', value: p.bad, color: 'var(--chart-2)' },
        { label: 'Good years first', value: p.good, color: 'var(--chart-3)' },
        { label: 'Baseline', value: p.baseline, color: 'var(--chart-1)' },
      ]}
    />
  );
}

export function SequenceRisk({
  illustration,
  household,
  basis,
  beforeLimits,
  beforeTaxes,
}: {
  illustration: SequenceRiskIllustration;
  household: Household;
  basis: DollarBasis;
  beforeLimits: boolean;
  beforeTaxes: boolean;
}) {
  const points = useMemo(() => sequencePoints(illustration, household, basis), [illustration, household, basis]);
  const unit = basisName(basis);
  const first = points[0]?.year ?? 0;
  const last = points[points.length - 1]?.year ?? 0;
  const lastPoint = points[points.length - 1];
  const devs = illustration.deviations;
  const windowEnd = illustration.startYear + devs.length - 1;
  const legend: LegendItem[] = [
    { label: 'Bad years first', color: 'var(--chart-2)', style: 'dotted' },
    { label: 'Good years first', color: 'var(--chart-3)', style: 'dashed' },
    { label: 'Baseline (expected returns every year)', color: 'var(--chart-1)', style: 'solid' },
  ];
  return (
    <Card aria-labelledby="sequence-title">
      <CardHeader>
        <CardTitle id="sequence-title">Sequence of returns: same average, different order</CardTitle>
        <CardDescription>
          From {illustration.startYear} (the first retirement year) through {windowEnd}, each account’s expected return
          is shifted by the same {devs.length} amounts in two orders. The amounts add up to zero, so both runs have the
          same average return. Withdrawals taken while the portfolio is down lock in the losses, so the order changes
          the outcome. A deterministic illustration, not a Monte Carlo path.
        </CardDescription>
        {beforeLimits || beforeTaxes ? (
          <div className="flex flex-wrap gap-1.5">
            {beforeLimits ? <BeforeLimitsBadge /> : null}
            {beforeTaxes ? <BeforeTaxesBadge /> : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-sm">
          <p>
            <span className="font-medium">Bad years first:</span>{' '}
            <span className="tabular-nums">{devs.map(formatDeviation).join(', ')}</span>
          </p>
          <p>
            <span className="font-medium">Good years first:</span>{' '}
            <span className="tabular-nums">{[...devs].reverse().map(formatDeviation).join(', ')}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Percentage points added to each account’s expected return, one per year.
          </p>
        </div>
        {lastPoint ? (
          <dl className="grid gap-3 sm:grid-cols-3">
            {[
              { label: 'Bad years first', value: lastPoint.bad },
              { label: 'Good years first', value: lastPoint.good },
              { label: 'Baseline', value: lastPoint.baseline },
            ].map((t) => (
              <div key={t.label} className="flex flex-col gap-1 rounded-lg border p-3">
                <dt className="text-xs font-medium text-muted-foreground">{t.label}: ending balance</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatCents(t.value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <figure className="flex flex-col gap-2">
          <figcaption className="text-xs font-medium text-muted-foreground">
            Year-end portfolio value ({unit}) by year
          </figcaption>
          <SeriesLegend items={legend} />
          <LineChart
            responsive
            style={CHART_STYLE}
            data={points}
            margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
            title={`Sequence-of-returns illustration, ${unit}`}
            desc="Bad years first, good years first and the baseline. A data table follows the chart."
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
            <YAxis tickFormatter={formatCompactCents} tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} />
            <Tooltip content={SequenceTooltip} cursor={{ stroke: 'var(--chart-axis)' }} />
            <ReferenceLine x={illustration.startYear} stroke="var(--chart-marker)" strokeDasharray="3 3" />
            <Line
              dataKey="bad"
              name="Bad years first"
              stroke="var(--chart-2)"
              strokeWidth={2}
              strokeDasharray={DASH.dotted}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="good"
              name="Good years first"
              stroke="var(--chart-3)"
              strokeWidth={2}
              strokeDasharray={DASH.dashed}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="baseline"
              name="Baseline"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
          <p className="text-center text-xs text-muted-foreground">
            Year (dashed vertical line: {illustration.startYear}, the first year shifted)
          </p>
        </figure>
        <DataTableDisclosure label="sequence of returns data table">
          <Table label={`Sequence-of-returns illustration by year, ${unit}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Age</TableHead>
                <TableHead className="text-right">Shift, bad first</TableHead>
                <TableHead className="text-right">Bad years first</TableHead>
                <TableHead className="text-right">Shift, good first</TableHead>
                <TableHead className="text-right">Good years first</TableHead>
                <TableHead className="text-right">Baseline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((p) => (
                <TableRow key={p.year}>
                  <TableCell>{p.year}</TableCell>
                  <TableCell>{p.ages}</TableCell>
                  <TableCell className="text-right">
                    {p.badDeviation === null ? '—' : formatDeviation(p.badDeviation)}
                  </TableCell>
                  <TableCell className="text-right">{formatCents(p.bad)}</TableCell>
                  <TableCell className="text-right">
                    {p.goodDeviation === null ? '—' : formatDeviation(p.goodDeviation)}
                  </TableCell>
                  <TableCell className="text-right">{formatCents(p.good)}</TableCell>
                  <TableCell className="text-right">{formatCents(p.baseline)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableDisclosure>
      </CardContent>
    </Card>
  );
}
