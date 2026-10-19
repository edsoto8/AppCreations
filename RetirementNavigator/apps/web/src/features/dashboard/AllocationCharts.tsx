import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import type { DashboardResult, DollarBasis, Household } from '@rn/engine';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCents } from '@/lib/format';
import { BeforeLimitsBadge } from './badges';
import { SeriesLegend, TooltipCard } from './chartParts';
import { AXIS_TICK } from './chartUtils';
import { DataTableDisclosure } from './DataTableDisclosure';
import {
  agePrefix,
  allocationByAccountType,
  allocationByTaxTreatment,
  basisName,
  formatCompactCents,
  type AllocationView,
} from './viewModel';

const CHART_STYLE = { width: '100%', height: 260 } as const;

const value = (point: AllocationView['points'][number], key: string) => Number(point[key] ?? 0);

function AllocationTooltip({ view, ...props }: TooltipContentProps & { view: AllocationView }) {
  const first = props.payload[0] as { payload?: AllocationView['points'][number] } | undefined;
  const point = props.active ? first?.payload : undefined;
  if (!point) return null;
  const rows = view.series.map((s) => ({ label: s.label, value: value(point, s.key), color: s.color }));
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return (
    <TooltipCard
      title={String(point.year)}
      subtitle={`${agePrefix(point.ages)} ${point.ages}`}
      rows={[...rows, { label: 'Total', value: total, strong: true }]}
    />
  );
}

function StackedAllocation({
  id,
  title,
  description,
  view,
  unit,
  beforeLimits,
}: {
  id: string;
  title: string;
  description: string;
  view: AllocationView;
  unit: string;
  beforeLimits: boolean;
}) {
  const first = view.points[0]?.year ?? 0;
  const last = view.points[view.points.length - 1]?.year ?? 0;

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <figure className="flex flex-col gap-2">
        <figcaption className="text-xs font-medium text-muted-foreground">
          Year-end balances ({unit}) by year, stacked
        </figcaption>
        <SeriesLegend items={view.series.map((s) => ({ label: s.label, color: s.color, style: 'area' as const }))} />
        <AreaChart
          responsive
          style={CHART_STYLE}
          data={view.points}
          margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
          title={`${title}, ${unit}`}
          desc="Stacked year-end balances, baseline forecast. A data table follows the chart."
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
          <Tooltip
            content={(props) => <AllocationTooltip {...props} view={view} />}
            cursor={{ stroke: 'var(--chart-axis)' }}
          />
          {view.series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="balance"
              type="monotone"
              stroke="var(--card)"
              strokeWidth={1}
              fill={s.color}
              fillOpacity={0.85}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
        <p className="text-center text-xs text-muted-foreground">Year</p>
      </figure>
      <DataTableDisclosure label={`${title.toLowerCase()} data table`}>
        <Table label={`${title} by year, ${unit}`}>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead>Age</TableHead>
              {view.series.map((s) => (
                <TableHead key={s.key} className="text-right">
                  {s.label}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.points.map((point) => (
              <TableRow key={point.year}>
                <TableCell>{point.year}</TableCell>
                <TableCell>{point.ages}</TableCell>
                {view.series.map((s) => (
                  <TableCell key={s.key} className="text-right">
                    {formatCents(value(point, s.key))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium">
                  {formatCents(view.series.reduce((sum, s) => sum + value(point, s.key), 0))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {beforeLimits ? (
          <p className="text-xs text-muted-foreground">
            Balances include contributions as elected, before plan limits (unverified).
          </p>
        ) : null}
      </DataTableDisclosure>
    </section>
  );
}

export function AllocationCharts({
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
  const byType = useMemo(
    () => allocationByAccountType(dashboard.baseline, household, basis),
    [dashboard, household, basis],
  );
  const byTax = useMemo(
    () => allocationByTaxTreatment(dashboard.baseline, household, basis),
    [dashboard, household, basis],
  );
  const unit = basisName(basis);
  return (
    <Card aria-labelledby="allocation-title">
      <CardHeader>
        <CardTitle id="allocation-title">Where the money is</CardTitle>
        <CardDescription>Baseline forecast, year-end balances in {unit}.</CardDescription>
        {beforeLimits ? (
          <div className="flex flex-wrap gap-1.5">
            <BeforeLimitsBadge />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        <StackedAllocation
          id="allocation-account-type"
          title="By account type"
          description="Each account type’s combined balance."
          view={byType}
          unit={unit}
          beforeLimits={beforeLimits}
        />
        <StackedAllocation
          id="allocation-tax-treatment"
          title="By tax treatment"
          description="Tax-deferred: traditional workplace plans and IRAs. Tax-free: Roth accounts and HSAs (qualified medical use). Taxable: brokerage and cash."
          view={byTax}
          unit={unit}
          beforeLimits={beforeLimits}
        />
        <section aria-labelledby="allocation-asset-class" className="flex flex-col gap-1">
          <h3 id="allocation-asset-class" className="text-sm font-semibold">
            By asset class
          </h3>
          <p className="text-sm text-muted-foreground">
            Coming in M6, together with Monte Carlo. Stocks, bonds and cash are not projected separately yet, so no
            figures are shown.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
