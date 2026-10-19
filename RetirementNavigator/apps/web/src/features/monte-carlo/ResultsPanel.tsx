/**
 * Monte Carlo results: success rate with its assumptions beside it, the required wording, ending
 * balance percentiles, year-by-year percentile bands, the real ending-balance histogram and
 * depletion ages. Every chart has a data-table disclosure. All numbers come from the engine result.
 */
import { useMemo } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { AlertTriangle, Clock } from 'lucide-react';
import type { DollarBasis, Household, MonteCarloResult, ProjectionResult } from '@rn/engine';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCents, formatPercent } from '@/lib/format';
import { BeforeLimitsBadge, BeforeTaxesBadge } from '@/features/dashboard/badges';
import { SeriesLegend } from '@/features/dashboard/chartParts';
import { AXIS_TICK } from '@/features/dashboard/chartUtils';
import { DataTableDisclosure } from '@/features/dashboard/DataTableDisclosure';
import { agePrefix, basisName, formatCompactCents } from '@/features/dashboard/viewModel';
import type { TimedResult } from './runner';
import {
  bandPoints,
  depletedPaths,
  depletionRows,
  endingPercentiles,
  formatCount,
  formatSeconds,
  histogramRows,
  type BandPoint,
} from './viewModel';

const CHART_STYLE = { width: '100%', height: 300 } as const;
const SMALL_CHART = { width: '100%', height: 220 } as const;
const MARGIN = { top: 8, right: 12, bottom: 4, left: 4 } as const;

export const REQUIRED_WORDING = 'Model-dependent estimate, not a guarantee.';

function BandTooltip(props: TooltipContentProps) {
  const first = props.payload[0] as { payload?: BandPoint } | undefined;
  const p = props.active ? first?.payload : undefined;
  if (!p) return null;
  const rows = [
    ['90th percentile', p.p90],
    ['75th percentile', p.p75],
    ['Median (50th)', p.p50],
    ['25th percentile', p.p25],
    ['10th percentile', p.p10],
  ] as const;
  return (
    <div className="min-w-48 rounded-md border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">{p.year}</p>
      {p.ages ? (
        <p className="mb-1.5 text-muted-foreground">
          {agePrefix(p.ages)} {p.ages}
        </p>
      ) : null}
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
        {rows.map(([label, v]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={label.startsWith('Median') ? 'text-right font-semibold' : 'text-right'}>{formatCents(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CountTooltip(props: TooltipContentProps & { paths: number }) {
  const first = props.payload[0] as { payload?: { label: string; count: number; share: number } } | undefined;
  const p = props.active ? first?.payload : undefined;
  if (!p) return null;
  return (
    <div className="rounded-md border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">{p.label}</p>
      <p className="tabular-nums text-muted-foreground">
        {formatCount(p.count)} of {formatCount(props.paths)} paths ({formatPercent(p.share, 1)})
      </p>
    </div>
  );
}

function SuccessBlock({ result }: { result: MonteCarloResult }) {
  const successes = Math.round(result.successRate * result.paths);
  return (
    <section
      aria-labelledby="mc-success-title"
      className="grid gap-5 rounded-lg border p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
    >
      <div className="flex flex-col gap-2">
        <h3 id="mc-success-title" className="text-sm font-semibold">
          Probability of funding modeled spending
        </h3>
        <p className="text-4xl font-semibold tabular-nums">{formatPercent(result.successRate, 0)}</p>
        <p className="text-sm text-muted-foreground">
          {formatCount(successes)} of {formatCount(result.paths)} paths fund the spending in your plan through the
          planning age and end with at least your minimum balance.
        </p>
        <p className="text-base font-semibold">{result.label}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <h4 id="mc-assumptions-title" className="text-sm font-semibold">
          Assumptions behind this number
        </h4>
        <ul aria-labelledby="mc-assumptions-title" className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {result.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function EndingBalances({ result, basis }: { result: MonteCarloResult; basis: DollarBasis }) {
  const e = endingPercentiles(result, basis);
  const unit = basisName(basis);
  const tiles = [
    { label: '10th percentile', value: e.p10, note: '10% of paths end below this' },
    { label: 'Median', value: e.p50, note: 'half of paths end below this' },
    { label: '90th percentile', value: e.p90, note: '10% of paths end above this' },
  ];
  return (
    <section aria-labelledby="mc-ending-title" className="flex flex-col gap-3">
      <div>
        <h3 id="mc-ending-title" className="text-sm font-semibold">
          Ending balance at the planning age
        </h3>
        <p className="text-xs text-muted-foreground">
          In {unit}
          {basis === 'todays' ? ', using each path’s own price level' : ''}.
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-1 rounded-lg border p-3">
            <dt className="text-xs font-medium text-muted-foreground">{t.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{formatCents(t.value)}</dd>
            <dd className="text-xs text-muted-foreground">{t.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BandsChart({
  result,
  basis,
  baseline,
  household,
}: {
  result: MonteCarloResult;
  basis: DollarBasis;
  baseline: ProjectionResult | null;
  household: Household;
}) {
  const points = useMemo(() => bandPoints(result, basis, baseline, household), [result, basis, baseline, household]);
  const unit = basisName(basis);
  const first = points[0]?.year ?? 0;
  const last = points[points.length - 1]?.year ?? 0;
  return (
    <section aria-labelledby="mc-bands-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id="mc-bands-title" className="text-sm font-semibold">
          Portfolio value by year: percentile bands
        </h3>
        <p className="text-xs text-muted-foreground">
          Percentile bands, not confidence intervals. In each year, 10% of paths fall below the lower edge of the outer
          band and 10% above its upper edge; the inner band holds the middle half of paths.
        </p>
      </div>
      <figure className="flex flex-col gap-2">
        <figcaption className="text-xs font-medium text-muted-foreground">
          Year-end portfolio value ({unit}) by year
        </figcaption>
        <SeriesLegend
          items={[
            { label: '10th–90th percentile band', color: 'var(--chart-1)', style: 'area' },
            { label: '25th–75th percentile band', color: 'var(--chart-7)', style: 'area' },
            { label: 'Median (50th percentile) each year', color: 'var(--chart-1)', style: 'solid' },
          ]}
        />
        <ComposedChart
          responsive
          style={CHART_STYLE}
          data={points}
          margin={MARGIN}
          title={`Monte Carlo percentile bands, ${unit}`}
          desc={`10th to 90th and 25th to 75th percentile bands with the median, ${first} to ${last}. A data table follows the chart.`}
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
          <Tooltip content={BandTooltip} cursor={{ stroke: 'var(--chart-axis)' }} />
          <Area
            dataKey="outer"
            name="10th–90th percentile"
            type="monotone"
            stroke="var(--chart-1)"
            strokeOpacity={0.5}
            fill="var(--chart-1)"
            fillOpacity={0.15}
            isAnimationActive={false}
          />
          <Area
            dataKey="inner"
            name="25th–75th percentile"
            type="monotone"
            stroke="var(--chart-7)"
            strokeOpacity={0.6}
            fill="var(--chart-7)"
            fillOpacity={0.3}
            isAnimationActive={false}
          />
          <Line
            dataKey="p50"
            name="Median"
            type="monotone"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
        <p className="text-center text-xs text-muted-foreground">Year</p>
      </figure>
      <DataTableDisclosure label="percentile bands data table">
        <Table label={`Percentile bands by year, ${unit}`}>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead>Age</TableHead>
              <TableHead className="text-right">10th</TableHead>
              <TableHead className="text-right">25th</TableHead>
              <TableHead className="text-right">Median</TableHead>
              <TableHead className="text-right">75th</TableHead>
              <TableHead className="text-right">90th</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((p) => (
              <TableRow key={p.year}>
                <TableCell>{p.year}</TableCell>
                <TableCell>{p.ages}</TableCell>
                <TableCell className="text-right">{formatCents(p.p10)}</TableCell>
                <TableCell className="text-right">{formatCents(p.p25)}</TableCell>
                <TableCell className="text-right font-medium">{formatCents(p.p50)}</TableCell>
                <TableCell className="text-right">{formatCents(p.p75)}</TableCell>
                <TableCell className="text-right">{formatCents(p.p90)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableDisclosure>
    </section>
  );
}

function Histogram({ result }: { result: MonteCarloResult }) {
  const rows = useMemo(
    () =>
      histogramRows(result).map((r) => ({
        ...r,
        label: r.openEnded
          ? `${formatCompactCents(r.from)} and above`
          : `${formatCompactCents(r.from)} to ${formatCompactCents(r.to)}`,
      })),
    [result],
  );
  return (
    <section aria-labelledby="mc-hist-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id="mc-hist-title" className="text-sm font-semibold">
          Distribution of ending balances
        </h3>
        <p className="text-xs text-muted-foreground">
          Paths by ending balance at the planning age, in today’s dollars (each path’s own price level). The last bar
          also holds every path above it.
        </p>
      </div>
      <figure className="flex flex-col gap-2">
        <figcaption className="text-xs font-medium text-muted-foreground">
          Number of paths by ending balance (today’s dollars)
        </figcaption>
        <BarChart
          responsive
          style={SMALL_CHART}
          data={rows}
          margin={MARGIN}
          title="Histogram of ending balances, today’s dollars"
          desc="Number of paths in each ending-balance range. A data table follows the chart."
        >
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="from"
            tickFormatter={formatCompactCents}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-grid)' }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
          <Tooltip
            content={(props) => <CountTooltip {...props} paths={result.paths} />}
            cursor={{ fill: 'var(--muted)' }}
          />
          <Bar dataKey="count" name="Paths" fill="var(--chart-1)" isAnimationActive={false} />
        </BarChart>
        <p className="text-center text-xs text-muted-foreground">Ending balance (lower edge of each range)</p>
      </figure>
      <DataTableDisclosure label="ending balance distribution data table">
        <Table label="Ending balance distribution, today’s dollars">
          <TableHeader>
            <TableRow>
              <TableHead>Ending balance</TableHead>
              <TableHead className="text-right">Paths</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.from}>
                <TableCell>
                  {r.openEnded ? `${formatCents(r.from)} and above` : `${formatCents(r.from)} to ${formatCents(r.to)}`}
                </TableCell>
                <TableCell className="text-right">{formatCount(r.count)}</TableCell>
                <TableCell className="text-right">{formatPercent(r.share, 1)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableDisclosure>
    </section>
  );
}

function DepletionAges({ result }: { result: MonteCarloResult }) {
  const rows = useMemo(() => depletionRows(result).map((r) => ({ ...r, label: `Age ${r.age}` })), [result]);
  const depleted = depletedPaths(result);
  return (
    <section aria-labelledby="mc-depletion-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id="mc-depletion-title" className="text-sm font-semibold">
          When paths run out
        </h3>
        <p className="text-xs text-muted-foreground">
          {depleted === 0
            ? 'No path runs out of money before the planning age.'
            : `${formatCount(depleted)} of ${formatCount(result.paths)} paths (${formatPercent(depleted / result.paths, 1)}) run out before the planning age. Ages are the first listed person’s age that year (or the survivor’s).`}
        </p>
      </div>
      {rows.length > 0 ? (
        <>
          <figure className="flex flex-col gap-2">
            <figcaption className="text-xs font-medium text-muted-foreground">
              Number of paths by depletion age
            </figcaption>
            <BarChart
              responsive
              style={SMALL_CHART}
              data={rows}
              margin={MARGIN}
              title="Depletion ages"
              desc="Number of paths that run out of money at each age. A data table follows the chart."
            >
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="age"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-grid)' }}
                interval="preserveStartEnd"
                minTickGap={8}
              />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
              <Tooltip
                content={(props) => <CountTooltip {...props} paths={result.paths} />}
                cursor={{ fill: 'var(--muted)' }}
              />
              <Bar dataKey="count" name="Paths" fill="var(--chart-2)" isAnimationActive={false} />
            </BarChart>
            <p className="text-center text-xs text-muted-foreground">Age when the portfolio runs out</p>
          </figure>
          <DataTableDisclosure label="depletion ages data table">
            <Table label="Paths by depletion age">
              <TableHeader>
                <TableRow>
                  <TableHead>Age</TableHead>
                  <TableHead className="text-right">Paths</TableHead>
                  <TableHead className="text-right">Share of all paths</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.age}>
                    <TableCell>{r.age}</TableCell>
                    <TableCell className="text-right">{formatCount(r.count)}</TableCell>
                    <TableCell className="text-right">{formatPercent(r.share, 1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableDisclosure>
        </>
      ) : null}
    </section>
  );
}

export function ResultsPanel({
  quick,
  full,
  plannedPaths,
  running,
  cancelled,
  stale,
  executors,
  basis,
  baseline,
  household,
  beforeLimits,
  beforeTaxes,
}: {
  quick: TimedResult | null;
  full: TimedResult | null;
  /** Paths requested for the run the results belong to. */
  plannedPaths: number;
  running: boolean;
  cancelled: boolean;
  stale: boolean;
  executors: number;
  basis: DollarBasis;
  baseline: ProjectionResult | null;
  household: Household;
  beforeLimits: boolean;
  beforeTaxes: boolean;
}) {
  const shown = full ?? quick;
  if (!shown) {
    return (
      <Card aria-labelledby="mc-results-title">
        <CardHeader>
          <CardTitle id="mc-results-title">Results</CardTitle>
          <CardDescription>
            {running ? 'The quick run is computing…' : 'Run the simulation to see the range of outcomes for this plan.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const preliminary = full === null && plannedPaths > shown.result.paths;
  const worker = executors === 1 ? '1 worker' : `${executors} workers`;
  return (
    <Card aria-labelledby="mc-results-title">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle id="mc-results-title">Results</CardTitle>
          {preliminary ? (
            <Badge variant="attention">Preliminary: first {formatCount(shown.result.paths)} paths</Badge>
          ) : (
            <Badge variant="secondary">{formatCount(shown.result.paths)} paths</Badge>
          )}
          {beforeLimits ? <BeforeLimitsBadge /> : null}
          {beforeTaxes ? <BeforeTaxesBadge /> : null}
        </div>
        <CardDescription>
          {preliminary
            ? running
              ? `A quick first look from the first ${formatCount(shown.result.paths)} paths; it refines to ${formatCount(plannedPaths)} paths when the run finishes.`
              : `Only the first ${formatCount(shown.result.paths)} paths finished${cancelled ? ' (the run was cancelled)' : ''}. Run again for all ${formatCount(plannedPaths)}.`
            : `Seed ${shown.result.seed}. Values in ${basisName(basis)} unless noted.`}
        </CardDescription>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Run time">
          <Clock aria-hidden="true" className="size-3.5" />
          {quick ? (
            <span>
              Quick run ({formatCount(quick.result.paths)} paths) computed in {formatSeconds(quick.elapsedMs)}
            </span>
          ) : null}
          {full && full !== quick ? (
            <span>
              Full run ({formatCount(full.result.paths)} paths) computed in {formatSeconds(full.elapsedMs)}, {worker}
            </span>
          ) : null}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        {stale ? (
          <Alert variant="attention" aria-label="Results out of date">
            <AlertTriangle aria-hidden="true" />
            <p>
              Your plan or the simulation settings changed after this run, so these results describe the earlier inputs.
              Run the simulation again to update them.
            </p>
          </Alert>
        ) : null}
        <SuccessBlock result={shown.result} />
        <EndingBalances result={shown.result} basis={basis} />
        <BandsChart result={shown.result} basis={basis} baseline={baseline} household={household} />
        <Histogram result={shown.result} />
        <DepletionAges result={shown.result} />
      </CardContent>
    </Card>
  );
}
