import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { ShieldAlert } from 'lucide-react';
import type { DollarBasis, Household, ProjectionResult } from '@rn/engine';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BeforeLimitsBadge, BeforeTaxesBadge } from '@/features/dashboard/badges';
import { SeriesLegend, TooltipCard } from '@/features/dashboard/chartParts';
import { AXIS_TICK, DASH, forecastMarkers, markerLabel } from '@/features/dashboard/chartUtils';
import { DataTableDisclosure } from '@/features/dashboard/DataTableDisclosure';
import {
  agePrefix,
  basisName,
  beforeLimits,
  excludedFeatureLabel,
  formatCompactCents,
} from '@/features/dashboard/viewModel';
import {
  grossToNet,
  isExcluded,
  presentSeries,
  retirementExclusions,
  taxesUnverified,
  type GrossToNetPoint,
  type IncomeSeries,
} from './model';

const CHART_STYLE = { width: '100%', height: 300 } as const;
const MARGIN = { top: 8, right: 12, bottom: 4, left: 4 } as const;
const SPENDING_COLOR = 'var(--chart-marker)';

function ExcludedBadge({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="attention">
      <ShieldAlert aria-hidden="true" className="size-3" />
      {children}
    </Badge>
  );
}

function IncomeTooltip({ series, ...props }: TooltipContentProps & { series: IncomeSeries[] }) {
  const first = props.payload[0] as { payload?: GrossToNetPoint } | undefined;
  const p = props.active ? first?.payload : undefined;
  if (!p) return null;
  return (
    <TooltipCard
      title={String(p.year)}
      subtitle={`${agePrefix(p.ages)} ${p.ages}`}
      rows={[
        ...series.map((s) => ({ label: s.label, value: p[s.key], color: s.color })),
        { label: 'Gross income', value: p.grossIncome, strong: true },
        { label: 'Spending need (after tax)', value: p.spendingNeed, color: SPENDING_COLOR },
      ]}
    />
  );
}

/** "Unverified rule" or "Before taxes" in place of a tax figure that the engine did not compute. */
function NoTaxCell({ unverified }: { unverified: boolean }) {
  return <span className="text-muted-foreground">{unverified ? 'Unverified rule' : 'Before taxes'}</span>;
}

export function GrossToNet({
  result,
  household,
  basis,
}: {
  result: ProjectionResult;
  household: Household;
  basis: DollarBasis;
}) {
  const points = useMemo(() => grossToNet(result, household, basis), [result, household, basis]);
  const series = useMemo(() => presentSeries(points), [points]);
  const unit = basisName(basis);
  const limits = beforeLimits(result);
  const noTaxes = taxesUnverified(result);
  const anyTaxNull = points.some((p) => p.tax === null);
  const anyTax = points.some((p) => p.tax !== null);
  const rmdExcluded = isExcluded(result, 'rmd');
  const ssExcluded = result.excludedFeatures.includes('socialSecurityClaiming');
  const spousalExcluded = household.people.length > 1 && result.excludedFeatures.includes('spousalSurvivorBenefits');
  const exclusions = retirementExclusions(result);
  const anyEarned = points.some((p) => p.earned > 0);
  const anyReinvested = points.some((p) => p.reinvested > 0);
  const anyShortfall = points.some((p) => p.shortfall > 0);
  const anyUnconverged = points.some((p) => p.tax && !p.tax.converged);
  const first = points[0]?.year ?? 0;
  const last = points[points.length - 1]?.year ?? 0;
  const middle = (first + last) / 2;
  const markers = forecastMarkers(result, household).filter((m) => m.year > first && m.year <= last);

  return (
    <Card aria-labelledby="gross-to-net-title">
      <CardHeader>
        <CardTitle id="gross-to-net-title">Retirement income, gross to net</CardTitle>
        <CardDescription>
          Each retirement year of the baseline forecast in {unit}: income by source, taxes and what is left to spend.
        </CardDescription>
        <div className="flex flex-wrap gap-1.5">
          {limits ? <BeforeLimitsBadge /> : null}
          {anyTaxNull ? <BeforeTaxesBadge /> : null}
          {ssExcluded ? <ExcludedBadge>Some Social Security left out (unverified)</ExcludedBadge> : null}
          {spousalExcluded ? <ExcludedBadge>No spousal or survivor benefits (unverified)</ExcludedBadge> : null}
          {rmdExcluded ? <ExcludedBadge>No required minimum distributions (unverified)</ExcludedBadge> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {exclusions.length > 0 ? (
          <div className="flex flex-col gap-1 text-sm" aria-label="Left out of this view">
            <p className="font-medium">Left out because their rule values are not verified yet:</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {exclusions.map((f) => (
                <li key={f}>{excludedFeatureLabel(f)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">This plan has no retirement years before the planning age.</p>
        ) : (
          <>
            <figure className="flex flex-col gap-2">
              <figcaption className="text-xs font-medium text-muted-foreground">
                Gross income by source ({unit}) by year, stacked, with the spending need as a line
              </figcaption>
              <SeriesLegend
                items={[
                  ...series.map((s) => ({ label: s.label, color: s.color, style: 'area' as const })),
                  { label: 'Spending need (after tax)', color: SPENDING_COLOR, style: 'dashed' as const },
                ]}
              />
              <ComposedChart
                responsive
                style={CHART_STYLE}
                data={points}
                margin={MARGIN}
                title={`Gross retirement income by source, ${unit}`}
                desc="Stacked income sources for each retirement year with the spending need as a dashed line. A data table follows the chart."
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
                <Tooltip
                  content={(props) => <IncomeTooltip {...props} series={series} />}
                  cursor={{ stroke: 'var(--chart-axis)' }}
                />
                {series.map((s) => (
                  <Area
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    stackId="income"
                    type="monotone"
                    stroke="var(--card)"
                    strokeWidth={1}
                    fill={s.color}
                    fillOpacity={0.85}
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  dataKey="spendingNeed"
                  name="Spending need"
                  type="monotone"
                  stroke={SPENDING_COLOR}
                  strokeWidth={2}
                  strokeDasharray={DASH.dashed}
                  dot={false}
                  isAnimationActive={false}
                />
                {markers.map((m, i) => (
                  <ReferenceLine
                    key={m.label}
                    x={m.year}
                    stroke="var(--chart-marker)"
                    strokeDasharray="3 3"
                    label={markerLabel(`${m.label} ${m.year}`, i, m.year > middle)}
                  />
                ))}
              </ComposedChart>
              <p className="text-center text-xs text-muted-foreground">Year</p>
            </figure>
            {markers.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Marked on the chart: {markers.map((m) => `${m.description} in ${m.year}`).join('; ')}.
              </p>
            ) : null}
            <DataTableDisclosure label="income sources data table">
              <Table label={`Gross retirement income by source, ${unit}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Year</TableHead>
                    <TableHead>Age</TableHead>
                    {series.map((s) => (
                      <TableHead key={s.key} className="text-right">
                        {s.label}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Gross income</TableHead>
                    <TableHead className="text-right">Spending need</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.map((p) => (
                    <TableRow key={p.year}>
                      <TableCell>{p.year}</TableCell>
                      <TableCell>{p.ages}</TableCell>
                      {series.map((s) => (
                        <TableCell key={s.key} className="text-right">
                          {formatCents(p[s.key])}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium">{formatCents(p.grossIncome)}</TableCell>
                      <TableCell className="text-right">{formatCents(p.spendingNeed)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DataTableDisclosure>

            <section aria-labelledby="gross-to-net-table-title" className="flex flex-col gap-2">
              <h3 id="gross-to-net-table-title" className="text-sm font-semibold">
                Year by year
              </h3>
              <Table label={`Gross to net by year, ${unit}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Year</TableHead>
                    <TableHead>Age</TableHead>
                    {anyEarned ? <TableHead className="text-right">Part-time pay</TableHead> : null}
                    <TableHead className="text-right">Social Security</TableHead>
                    <TableHead className="text-right">Pensions</TableHead>
                    <TableHead className="text-right">Other income</TableHead>
                    <TableHead className="text-right">Withdrawals</TableHead>
                    <TableHead className="text-right">of which RMDs</TableHead>
                    <TableHead className="text-right">of which HSA medical</TableHead>
                    {anyReinvested ? <TableHead className="text-right">Reinvested</TableHead> : null}
                    <TableHead className="text-right">Gross income</TableHead>
                    <TableHead className="text-right">Taxes</TableHead>
                    {anyTax ? (
                      <>
                        <TableHead className="text-right">Federal income tax</TableHead>
                        <TableHead className="text-right">Capital gains tax</TableHead>
                        <TableHead className="text-right">State tax</TableHead>
                        <TableHead className="text-right">Taxable Social Security</TableHead>
                      </>
                    ) : null}
                    <TableHead className="text-right">Net income</TableHead>
                    <TableHead className="text-right">Spending need</TableHead>
                    {anyShortfall ? <TableHead className="text-right">Shortfall</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.map((p) => {
                    const money = (cents: number) => formatCents(cents);
                    return (
                      <TableRow key={p.year} className={cn(p.shortfall > 0 && 'bg-destructive/5')}>
                        <TableCell>{p.year}</TableCell>
                        <TableCell>{p.ages}</TableCell>
                        {anyEarned ? <TableCell className="text-right">{money(p.earned)}</TableCell> : null}
                        <TableCell className="text-right">{money(p.socialSecurity)}</TableCell>
                        <TableCell className="text-right">{money(p.pensions)}</TableCell>
                        <TableCell className="text-right">{money(p.otherIncome)}</TableCell>
                        <TableCell className="text-right">{money(p.withdrawals)}</TableCell>
                        <TableCell className="text-right">
                          {rmdExcluded ? <span className="text-muted-foreground">Unverified rule</span> : money(p.rmd)}
                        </TableCell>
                        <TableCell className="text-right">{money(p.hsaMedical)}</TableCell>
                        {anyReinvested ? <TableCell className="text-right">{money(p.reinvested)}</TableCell> : null}
                        <TableCell className="text-right font-medium">{money(p.grossIncome)}</TableCell>
                        <TableCell className="text-right">
                          {p.tax ? (
                            <>
                              {money(p.tax.totalTax)}
                              {p.tax.converged ? null : (
                                <>
                                  <span aria-hidden="true">†</span>
                                  <span className="sr-only"> (estimate did not fully converge)</span>
                                </>
                              )}
                            </>
                          ) : (
                            <NoTaxCell unverified={noTaxes} />
                          )}
                        </TableCell>
                        {anyTax ? (
                          p.tax ? (
                            <>
                              <TableCell className="text-right">{money(p.tax.federalOrdinaryTax)}</TableCell>
                              <TableCell className="text-right">{money(p.tax.capitalGainsTax)}</TableCell>
                              <TableCell className="text-right">{money(p.tax.stateTax)}</TableCell>
                              <TableCell className="text-right">{money(p.tax.taxableSocialSecurity)}</TableCell>
                            </>
                          ) : (
                            <>
                              {[0, 1, 2, 3].map((k) => (
                                <TableCell key={k} className="text-right">
                                  <NoTaxCell unverified={noTaxes} />
                                </TableCell>
                              ))}
                            </>
                          )
                        ) : null}
                        <TableCell className="text-right font-medium">
                          {p.netIncome === null ? <NoTaxCell unverified={noTaxes} /> : money(p.netIncome)}
                        </TableCell>
                        <TableCell className="text-right">{money(p.spendingNeed)}</TableCell>
                        {anyShortfall ? (
                          <TableCell className={cn('text-right', p.shortfall > 0 && 'font-medium text-destructive')}>
                            {money(p.shortfall)}
                            {p.shortfall > 0 ? <span className="sr-only"> (not funded)</span> : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                Withdrawals include required minimum distributions (RMDs) and HSA withdrawals for medical expenses.
                Gross income is before taxes; net income is gross income minus estimated taxes.{' '}
                {anyTaxNull
                  ? noTaxes
                    ? 'Taxes need rule values that are not verified yet, so they are not estimated and net income is not shown. '
                    : 'Retirement taxes are not estimated in this version, so net income is not shown. '
                  : ''}
                {anyUnconverged
                  ? '† The tax estimate stopped before settling within $1; the figure is approximate. '
                  : ''}
                The spending need is an after-tax amount.
              </p>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
