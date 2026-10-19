import { useId, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { HeartPulse, Info, Loader2, Play } from 'lucide-react';
import {
  applyScenario,
  optimizeRetirementAge,
  projectHousehold,
  type EngineContext,
  type Household,
  type OptimizerResult,
  type Scenario,
} from '@rn/engine';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Field } from '@/components/form/Field';
import { IntegerInput } from '@/components/form/inputs';
import { formatCents } from '@/lib/format';
import { BeforeLimitsBadge } from '@/features/dashboard/badges';
import { DataTableDisclosure } from '@/features/dashboard/DataTableDisclosure';
import { AXIS_TICK, markerLabel } from '@/features/dashboard/chartUtils';
import { beforeLimits, formatCompactCents } from '@/features/dashboard/viewModel';
import {
  defaultOptimizerRange,
  MEDICARE_AGE,
  OPTIMIZER_HEALTHCARE_NOTE,
  optimizerBlockedReason,
  optimizerBounds,
} from './compareModel';

export const OPTIMIZER_CRITERION =
  'Criterion: no depletion before the planning age and at least the minimum ending balance, in the deterministic baseline run. A Monte Carlo option arrives with Monte Carlo (M6).';

const CHART_STYLE = { width: '100%', height: 220 } as const;
type Evaluated = OptimizerResult['evaluated'][number];

function OptimizerTooltip(props: TooltipContentProps) {
  if (!props.active) return null;
  const e = (props.payload[0] as { payload?: Evaluated } | undefined)?.payload;
  if (!e) return null;
  return (
    <div className="rounded-md border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">Retire at {e.age}</p>
      <p>{e.success ? 'Meets the criterion' : 'Does not meet the criterion'}</p>
      <p className="tabular-nums">Ending balance: {formatCents(e.endingBalanceReal)} (today’s dollars)</p>
    </div>
  );
}

interface Run {
  household: Household;
  fromAge: number;
  toAge: number;
  result: ReturnType<typeof optimizeRetirementAge>;
  /** The plan's forecast uses contributions as elected (limits unverified, docs §1.7). */
  beforeLimits: boolean;
}

/**
 * Earliest retirement age meeting the deterministic criterion (`optimizeRetirementAge`), for the base
 * plan or a scenario. The first person's age is scanned; a partner shifts by the same number of years.
 */
export function RetirementAgeOptimizer({
  household,
  scenarios,
  ctx,
}: {
  household: Household;
  scenarios: Scenario[];
  ctx: EngineContext;
}) {
  const [planId, setPlanId] = useState<string>('base');
  const scenario = scenarios.find((s) => s.id === planId) ?? null;
  const applied = useMemo(() => (scenario ? applyScenario(household, scenario) : null), [household, scenario]);
  const target = scenario ? (applied?.household ?? null) : household;
  const bounds = optimizerBounds(target ?? household, ctx.currentYear);
  const [range, setRange] = useState(() => defaultOptimizerRange(household, ctx.currentYear));
  const [run, setRun] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  const selectId = useId();
  const first = (target ?? household).people[0];
  const multi = household.people.length > 1;
  const blocked = target ? optimizerBlockedReason(target, ctx.currentYear) : null;
  const rangeError = blocked
    ? null
    : range.fromAge > range.toAge
      ? 'The first age must not be after the last age'
      : range.fromAge < bounds.min || range.toAge > bounds.max
        ? `Ages must be between ${bounds.min} (today) and ${bounds.max} (planning age)`
        : null;

  const start = () => {
    if (!target || rangeError || blocked) return;
    const fromAge = range.fromAge;
    const toAge = range.toAge;
    setRunning(true);
    // Let the "Running…" state paint before the synchronous scan.
    setTimeout(() => {
      const result = optimizeRetirementAge(target, ctx, { kind: 'deterministic' }, { fromAge, toAge });
      // Which rule-dependent steps are left out depends on the plan's rules, not on the scanned age.
      const projection = projectHousehold(target, ctx);
      const limits = projection.status === 'ok' && beforeLimits(projection.value);
      setRun({ household: target, fromAge, toAge, result, beforeLimits: limits });
      setRunning(false);
    }, 0);
  };

  const value = run?.result.status === 'ok' ? run.result.value : null;
  const stale = run !== null && run.household !== target;
  const skipped = value && run ? run.toAge - run.fromAge + 1 - value.evaluated.length : 0;
  const limits = run?.beforeLimits ?? false;
  // Brief §1: retiring before Medicare age carries the healthcare note.
  const early =
    value !== null &&
    (value.evaluated.some((e) => e.age < MEDICARE_AGE) ||
      (value.earliestAge !== null && value.earliestAge < MEDICARE_AGE));

  return (
    <Card aria-labelledby="optimizer-title">
      <CardHeader>
        <CardTitle id="optimizer-title">Earliest retirement age</CardTitle>
        <CardDescription>
          Scans every retirement age in the range for {first?.name ?? 'the first person'}
          {multi
            ? ' (a partner’s retirement age shifts by the same number of years; salary stop ages are cleared)'
            : ''}{' '}
          and reports the earliest one that meets the criterion.
        </CardDescription>
        <p className="text-sm text-muted-foreground">{OPTIMIZER_CRITERION}</p>
        {limits ? (
          <div className="flex flex-wrap gap-1.5">
            <BeforeLimitsBadge />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={selectId} className="text-sm font-medium">
              Plan
            </label>
            <NativeSelect id={selectId} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="base">Base plan</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Field label="From age" error={rangeError ?? undefined}>
            {(a) => (
              <IntegerInput {...a} value={range.fromAge} onChange={(fromAge) => setRange((r) => ({ ...r, fromAge }))} />
            )}
          </Field>
          <Field label="To age">
            {(a) => (
              <IntegerInput {...a} value={range.toAge} onChange={(toAge) => setRange((r) => ({ ...r, toAge }))} />
            )}
          </Field>
          <Button type="submit" disabled={running || !target || rangeError !== null || blocked !== null}>
            {running ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Play aria-hidden="true" />}
            {running ? 'Running…' : 'Find earliest age'}
          </Button>
        </form>
        {scenario && !target ? (
          <p className="text-sm text-destructive">This scenario cannot run, so it cannot be scanned.</p>
        ) : null}
        {blocked ? (
          <Alert aria-label="Optimizer unavailable">
            <Info aria-hidden="true" />
            <p>{blocked} Choose another plan, or change the retirement age in the base plan.</p>
          </Alert>
        ) : null}

        <div role="status" aria-live="polite" className="flex flex-col gap-3">
          {run && run.result.status === 'invalid' ? (
            <Alert variant="destructive" aria-label="The scan could not run">
              <ul className="flex flex-col gap-1">
                {run.result.issues.map((issue, i) => (
                  <li key={i}>{issue.message}.</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {value && run ? (
            <>
              <p className="text-lg font-semibold">
                {value.earliestAge !== null
                  ? `Earliest age that meets the criterion: ${value.earliestAge}`
                  : `No age from ${run.fromAge} to ${run.toAge} meets the criterion.`}
              </p>
              {stale ? (
                <p className="text-sm text-attention">The plan changed since this scan. Run it again to update.</p>
              ) : null}
              {early ? (
                <Alert variant="attention" aria-label="Healthcare before Medicare">
                  <HeartPulse aria-hidden="true" />
                  <p>{OPTIMIZER_HEALTHCARE_NOTE}</p>
                </Alert>
              ) : null}
              {skipped > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {skipped} age{skipped === 1 ? ' was' : 's were'} skipped because the plan is not valid at that age
                  (for example, past a planning age).
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        {value && value.evaluated.length > 0 ? (
          <>
            <figure className="flex flex-col gap-2">
              <figcaption className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
                Ending balance (today’s dollars) by retirement age. Filled bars meet the criterion; outlined bars do
                not.
                {limits ? <BeforeLimitsBadge /> : null}
              </figcaption>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
                <li className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-chart-1" />
                  Meets the criterion (filled)
                </li>
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 rounded-sm border-2 border-dashed border-chart-2"
                  />
                  Does not (outlined)
                </li>
              </ul>
              <BarChart
                responsive
                style={CHART_STYLE}
                data={value.evaluated}
                margin={{ top: 20, right: 12, bottom: 4, left: 4 }}
                title={`Ending balance in today’s dollars by retirement age${limits ? ', before plan limits (unverified)' : ''}`}
                desc="One bar per evaluated retirement age. A data table follows the chart."
              >
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="age" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} />
                <YAxis
                  tickFormatter={formatCompactCents}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
                <Tooltip content={OptimizerTooltip} cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.4 }} />
                <Bar dataKey="endingBalanceReal" name="Ending balance" isAnimationActive={false}>
                  {value.evaluated.map((e) => (
                    <Cell
                      key={e.age}
                      fill={e.success ? 'var(--chart-1)' : 'transparent'}
                      stroke={e.success ? 'var(--chart-1)' : 'var(--chart-2)'}
                      strokeWidth={2}
                      strokeDasharray={e.success ? undefined : '4 2'}
                    />
                  ))}
                </Bar>
                {value.earliestAge !== null ? (
                  <ReferenceLine
                    x={value.earliestAge}
                    stroke="var(--chart-marker)"
                    strokeDasharray="3 3"
                    label={markerLabel(`Earliest ${value.earliestAge}`, 0, false)}
                  />
                ) : null}
              </BarChart>
              <p className="text-center text-xs text-muted-foreground">Retirement age</p>
            </figure>
            <DataTableDisclosure label="retirement age data table">
              <Table label={`Retirement ages evaluated${limits ? ', before plan limits (unverified)' : ''}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Retirement age</TableHead>
                    <TableHead>Meets the criterion</TableHead>
                    <TableHead className="text-right">
                      Ending balance (today’s dollars)
                      {limits ? (
                        <>
                          <span aria-hidden="true">*</span>
                          <span className="sr-only"> (before plan limits, unverified)</span>
                        </>
                      ) : null}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {value.evaluated.map((e) => (
                    <TableRow key={e.age}>
                      <TableCell>{e.age}</TableCell>
                      <TableCell>{e.success ? 'Yes' : 'No'}</TableCell>
                      <TableCell className="text-right">{formatCents(e.endingBalanceReal)}</TableCell>
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
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
