import { useDeferredValue, useMemo } from 'react';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import {
  applyScenario,
  compareScenarios,
  type DollarBasis,
  type EngineContext,
  type Household,
  type Scenario,
  type ScenarioOutcome,
} from '@rn/engine';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCents } from '@/lib/format';
import { BeforeLimitsBadge, BeforeTaxesBadge } from '@/features/dashboard/badges';
import { DataTableDisclosure } from '@/features/dashboard/DataTableDisclosure';
import { AXIS_TICK } from '@/features/dashboard/chartUtils';
import { basisName, formatCompactCents, formatOffset } from '@/features/dashboard/viewModel';
import {
  anyBeforeLimits,
  anyBeforeTaxes,
  endingBalance,
  longevityText,
  outcomeBeforeLimits,
  outcomeNotes,
  OUTCOME_STYLES,
  portfolioSeries,
  READINESS_LABELS,
  type PortfolioPoint,
} from './compareModel';

const CHART_STYLE = { width: '100%', height: 300 } as const;
const MARGIN = { top: 8, right: 12, bottom: 4, left: 4 } as const;

export const FUNDING_CRITERION =
  'Funding success uses the deterministic criterion (baseline run): no depletion before the planning age and at least the minimum ending balance. A Monte Carlo success rate arrives with Monte Carlo (M6).';

/** Legend in HTML (wraps at phone width); each swatch repeats the line's dash pattern. */
function OutcomeLegend({ names }: { names: string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-label="Legend">
      {names.map((name, i) => {
        const style = OUTCOME_STYLES[i] ?? OUTCOME_STYLES[0];
        return (
          <li key={i} className="flex items-center gap-1.5">
            <svg aria-hidden="true" width="28" height="10" viewBox="0 0 28 10" className="shrink-0">
              <line x1="1" y1="5" x2="27" y2="5" stroke={style.color} strokeWidth={2} strokeDasharray={style.dash} />
            </svg>
            <span>{name}</span>
            <span className="sr-only">({style.pattern})</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Tooltip: the year and every plan's value (rendered by Recharts through a content function). */
function compareTooltip(props: TooltipContentProps, names: string[]) {
  if (!props.active) return null;
  const point = (props.payload[0] as { payload?: PortfolioPoint } | undefined)?.payload;
  if (!point) return null;
  return (
    <div className="min-w-48 rounded-md border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">{point.year}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
        {names.map((name, i) => {
          const v = point[`o${i}`];
          return (
            <div key={i} className="contents">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="text-right">{v === null || v === undefined ? '—' : formatCents(v)}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function money(v: number | null): string {
  return v === null ? '—' : formatCents(v);
}

/** Footnote marker for a figure that uses contributions as elected (docs §1.7), with its words for screen readers. */
function LimitsMark() {
  return (
    <>
      <span aria-hidden="true">*</span>
      <span className="sr-only"> (before plan limits, unverified)</span>
    </>
  );
}

/**
 * Each outcome's forecast notes (the dashboard's, for example the pre-Medicare healthcare note for an
 * early retirement), labeled with the plan's name and always visible (brief §1).
 */
function OutcomeNotes({ outcomes }: { outcomes: readonly ScenarioOutcome[] }) {
  const withNotes = outcomes.map((o) => ({ name: o.name, notes: outcomeNotes(o) })).filter((o) => o.notes.length > 0);
  if (withNotes.length === 0) return null;
  return (
    <Alert variant="attention" aria-label="Forecast notes by plan">
      <AlertTriangle aria-hidden="true" />
      <ul className="flex flex-col gap-2">
        {withNotes.map((o, i) => (
          <li key={i}>
            <p className="font-medium">{o.name}</p>
            <ul className="list-disc pl-5" aria-label={`Forecast notes for ${o.name}`}>
              {o.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

interface MetricRow {
  label: string;
  /** Depends on balances, so on contributions (before plan limits while limits are unverified). */
  balanceDerived: boolean;
  cell: (o: ScenarioOutcome, household: Household | null) => React.ReactNode;
}

/** Side-by-side outcomes for the base plan and up to four scenarios (`compareScenarios`). */
export function CompareView({
  household,
  scenarios,
  basis,
  ctx,
}: {
  household: Household;
  scenarios: Scenario[];
  basis: DollarBasis;
  ctx: EngineContext;
}) {
  // Several dashboards take tens of milliseconds each; defer so typing elsewhere stays responsive.
  const deferredHousehold = useDeferredValue(household);
  const deferredScenarios = useDeferredValue(scenarios);
  const outcomes = useMemo(
    () => compareScenarios(deferredHousehold, deferredScenarios, ctx),
    [deferredHousehold, deferredScenarios, ctx],
  );
  const households = useMemo(
    () => [deferredHousehold, ...deferredScenarios.map((s) => applyScenario(deferredHousehold, s).household)],
    [deferredHousehold, deferredScenarios],
  );
  const stale = deferredHousehold !== household || deferredScenarios !== scenarios;
  const points = useMemo(() => portfolioSeries(outcomes, basis), [outcomes, basis]);
  const names = outcomes.map((o) => o.name);
  const key = basis === 'todays' ? 'real' : 'nominal';
  const unit = basisName(basis);
  const limits = anyBeforeLimits(outcomes);
  const limited = outcomes.map(outcomeBeforeLimits);
  const limitedNames = outcomes.filter((_, i) => limited[i]).map((o) => o.name);
  const taxes = anyBeforeTaxes(outcomes);
  const first = points[0]?.year ?? 0;
  const last = points[points.length - 1]?.year ?? 0;
  const offset = formatOffset(household.assumptions.deterministicOffsets.pessimistic);

  const rows: MetricRow[] = [
    {
      label: 'First retirement year',
      balanceDerived: false,
      cell: (o) => (o.dashboard ? String(o.dashboard.cards.firstRetirementYear) : '—'),
    },
    {
      label: `Savings at retirement (${unit})`,
      balanceDerived: true,
      cell: (o) => money(o.dashboard?.cards.savingsAtRetirement[key] ?? null),
    },
    {
      label: `Monthly retirement income (${unit})`,
      balanceDerived: true,
      cell: (o) => {
        const income = o.dashboard?.cards.monthlyRetirementIncome;
        if (!income) return '—';
        return (
          <span className="flex flex-col">
            <span>{formatCents(income[key])}</span>
            <span className="text-xs text-muted-foreground">
              {income.taxBasis === 'beforeTaxes' ? 'Before taxes' : 'After estimated taxes'}
            </span>
          </span>
        );
      },
    },
    { label: `Ending balance (${unit})`, balanceDerived: true, cell: (o) => money(endingBalance(o, basis)) },
    { label: 'Portfolio longevity', balanceDerived: true, cell: (o, h) => longevityText(o, h) },
    {
      label: 'Funding success (deterministic)',
      balanceDerived: true,
      cell: (o) => {
        const s = o.dashboard?.baseline.summary;
        if (!s) return '—';
        return s.deterministicSuccess ? 'Yes: lasts' : 'No: falls short';
      },
    },
    {
      label: 'Readiness (heuristic)',
      balanceDerived: true,
      cell: (o) => (o.dashboard ? READINESS_LABELS[o.dashboard.cards.readiness.status] : '—'),
    },
    {
      label: 'After-tax ending balance (today’s dollars)',
      balanceDerived: true,
      cell: (o) =>
        o.status !== 'ok' ? (
          '—'
        ) : o.afterTaxEndingBalanceReal === null ? (
          <span className="font-medium text-attention">Unverified rule</span>
        ) : (
          formatCents(o.afterTaxEndingBalanceReal)
        ),
    },
  ];

  return (
    <Card aria-labelledby="compare-title">
      <CardHeader>
        <CardTitle id="compare-title">Compare outcomes</CardTitle>
        <CardDescription>
          The base plan and the selected scenarios, each run through the same forecast. Figures in {unit} unless marked.
        </CardDescription>
        <div className="flex flex-wrap gap-1.5">
          {limits ? <BeforeLimitsBadge /> : null}
          {taxes ? <BeforeTaxesBadge /> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5" aria-busy={stale}>
        {outcomes.some((o) => o.status !== 'ok' || o.orphaned.length > 0) ? (
          <ul className="flex flex-col gap-1 text-sm text-attention">
            {outcomes.map((o, i) =>
              o.status !== 'ok' ? (
                <li key={i}>“{o.name}” cannot run: its changes make the plan invalid. It is shown as “—”.</li>
              ) : o.orphaned.length > 0 ? (
                <li key={i}>
                  “{o.name}”: {o.orphaned.length} change{o.orphaned.length === 1 ? '' : 's'} not applied (see the
                  scenario’s warning).
                </li>
              ) : null,
            )}
          </ul>
        ) : null}

        <OutcomeNotes outcomes={outcomes} />

        <Table label="Scenario comparison">
          <TableHeader>
            <TableRow>
              <TableHead>Outcome</TableHead>
              {outcomes.map((o, i) => (
                <TableHead key={i} className="min-w-28 whitespace-normal text-right align-bottom">
                  {o.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.label}>
                <th scope="row" className="min-w-36 px-3 py-2 text-left align-top text-sm font-medium">
                  {r.label}
                  {limits && r.balanceDerived ? <LimitsMark /> : null}
                </th>
                {outcomes.map((o, i) => (
                  <TableCell key={i} className="min-w-28 whitespace-normal text-right align-top">
                    {r.cell(o, households[i] ?? null)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          {limits ? (
            <p>
              * Before plan limits (unverified): contributions are as elected because plan, IRA or HSA limits are
              unverified, which can overstate savings
              {limitedNames.length < outcomes.length ? ` (${limitedNames.join(', ')})` : ''}. Every balance-based figure
              carries it.
            </p>
          ) : null}
          <p>{FUNDING_CRITERION}</p>
          <p>
            Readiness is a labeled heuristic: On track when the baseline and pessimistic runs ({offset} points, a fixed
            return offset) both last; Borderline when only the baseline lasts; At risk when the baseline runs out.
          </p>
          <p>
            After-tax ending balance: the real ending balance minus an assumed tax on tax-deferred money at the model’s
            marginal ordinary rate in the final year (preset G’s comparison). It shows “Unverified rule” while tax rules
            are unverified; it is never estimated.
          </p>
        </div>

        <figure className="flex flex-col gap-2">
          <figcaption className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
            Portfolio value at year end ({unit}) by year, baseline run of each plan
            {limits ? <BeforeLimitsBadge /> : null}
          </figcaption>
          <OutcomeLegend names={names} />
          <LineChart
            responsive
            style={CHART_STYLE}
            data={points}
            margin={MARGIN}
            title={`Portfolio value at year end by scenario, ${unit}${limits ? ', before plan limits (unverified)' : ''}`}
            desc={`One line per plan from ${first} to ${last}, each with its own dash pattern. A data table follows the chart.`}
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
            <Tooltip content={(props) => compareTooltip(props, names)} cursor={{ stroke: 'var(--chart-axis)' }} />
            {outcomes.map((o, i) => {
              const style = OUTCOME_STYLES[i] ?? OUTCOME_STYLES[0];
              return (
                <Line
                  key={i}
                  dataKey={`o${i}`}
                  name={o.name}
                  type="monotone"
                  stroke={style.color}
                  strokeWidth={2}
                  strokeDasharray={style.dash}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
          <p className="text-center text-xs text-muted-foreground">Year</p>
        </figure>
        <DataTableDisclosure label="comparison data table">
          <Table
            label={`Portfolio value at year end by scenario, ${unit}${limits ? ', before plan limits (unverified)' : ''}`}
          >
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                {names.map((n, i) => (
                  <TableHead key={i} className="text-right">
                    {n}
                    {limited[i] ? <LimitsMark /> : null}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((p) => (
                <TableRow key={p.year}>
                  <TableCell>{p.year}</TableCell>
                  {names.map((_, i) => (
                    <TableCell key={i} className="text-right">
                      {money(p[`o${i}`] ?? null)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {limits ? (
            <p className="text-xs text-muted-foreground">
              * Contributions as elected, before plan limits (unverified).
            </p>
          ) : null}
        </DataTableDisclosure>
      </CardContent>
    </Card>
  );
}
