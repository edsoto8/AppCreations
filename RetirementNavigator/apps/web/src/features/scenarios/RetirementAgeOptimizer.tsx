import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
import { AlertTriangle, HeartPulse, Info, Loader2, Play, Square } from 'lucide-react';
import {
  applyScenario,
  projectHousehold,
  type EngineContext,
  type EngineResult,
  type Household,
  type MonteCarloConfig,
  type OptimizerResult,
  type Scenario,
} from '@rn/engine';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { NativeSelect } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Field } from '@/components/form/Field';
import { IntegerInput, PercentInput } from '@/components/form/inputs';
import { formatCents, formatPercent } from '@/lib/format';
import { BeforeLimitsBadge } from '@/features/dashboard/badges';
import { DataTableDisclosure } from '@/features/dashboard/DataTableDisclosure';
import { AXIS_TICK, markerLabel } from '@/features/dashboard/chartUtils';
import { beforeLimits, formatCompactCents } from '@/features/dashboard/viewModel';
import { REQUIRED_WORDING } from '@/features/monte-carlo/ResultsPanel';
import type { OptimizerCriterion } from '@/features/monte-carlo/optimizeSteps';
import { getOptimizerExecutor } from '@/features/monte-carlo/optimizerRunner';
import { RunCancelled } from '@/features/monte-carlo/runner';
import {
  configFor,
  settingsSourceText,
  settingsSummary,
  useSharedMonteCarloSettings,
  type SharedMonteCarloSettings,
} from '@/features/monte-carlo/sharedSettings';
import { formatCount, QUICK_RUN_PATHS, sameConfig } from '@/features/monte-carlo/viewModel';
import {
  defaultOptimizerRange,
  MEDICARE_AGE,
  monteCarloCriterionText,
  OPTIMIZER_HEALTHCARE_NOTE,
  optimizerBlockedReason,
  optimizerBounds,
} from './compareModel';

export const OPTIMIZER_CRITERION =
  'Criterion: no depletion before the planning age and at least the minimum ending balance, in the deterministic baseline run.';

/** Default Monte Carlo target (the readiness "on track" band starts at 85%). */
export const DEFAULT_TARGET_SUCCESS = 0.85;

const CHART_STYLE = { width: '100%', height: 220 } as const;
type Evaluated = OptimizerResult['evaluated'][number];
type CriterionKind = OptimizerCriterion['kind'];

function OptimizerTooltip(props: TooltipContentProps) {
  if (!props.active) return null;
  const e = (props.payload[0] as { payload?: Evaluated } | undefined)?.payload;
  if (!e) return null;
  return (
    <div className="rounded-md border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">Retire at {e.age}</p>
      <p>{e.success ? 'Meets the criterion' : 'Does not meet the criterion'}</p>
      {e.successRate !== null ? (
        <p className="tabular-nums">Monte Carlo success rate: {formatPercent(e.successRate, 1)}</p>
      ) : null}
      <p className="tabular-nums">Ending balance: {formatCents(e.endingBalanceReal)} (today’s dollars, baseline run)</p>
    </div>
  );
}

interface Run {
  household: Household;
  fromAge: number;
  toAge: number;
  criterion: OptimizerCriterion;
  /** Shared Monte Carlo settings at the time of the scan (for the assumptions text). */
  settings: SharedMonteCarloSettings;
  result: EngineResult<OptimizerResult>;
  /** The plan's forecast uses contributions as elected (limits unverified, docs §1.7). */
  beforeLimits: boolean;
}

function sameCriterion(a: OptimizerCriterion, b: OptimizerCriterion): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'deterministic' || b.kind === 'deterministic') return true;
  return a.minSuccessRate === b.minSuccessRate && sameConfig(a.config, b.config);
}

/** The assumptions beside a Monte Carlo optimizer result. */
function McCriterionAssumptions({
  config,
  settings,
  household,
}: {
  config: MonteCarloConfig;
  settings: SharedMonteCarloSettings;
  household: Household;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <h3 id={titleId} className="font-semibold">
        Assumptions behind these success rates
      </h3>
      <p className="font-medium">{REQUIRED_WORDING}</p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>
          {settingsSummary(config.quickRunPaths, { ...settings, seed: config.seed, inflation: config.inflation })} for
          every age scanned.
        </li>
        <li>{settingsSourceText(settings)}</li>
        <li>
          Lognormal annual returns, independent across years; rebalanced every year. Capital-market assumptions:{' '}
          {household.assumptions.capitalMarket.note}
        </li>
        <li>Not modeled: fat tails, mean reversion, regime changes.</li>
      </ul>
    </section>
  );
}

/**
 * Earliest retirement age meeting the chosen criterion (`optimizeRetirementAge`), for the base plan
 * or a scenario: deterministic (baseline run) or a Monte Carlo success-rate target. The first
 * person's age is scanned; a partner shifts by the same number of years. The scan runs in a worker
 * (`optimize` message), one age at a time, with progress and cancel.
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
  const [kind, setKind] = useState<CriterionKind>('deterministic');
  const [targetRate, setTargetRate] = useState<number | null>(DEFAULT_TARGET_SUCCESS);
  const [run, setRun] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const activeToken = useRef<symbol | null>(null);
  const selectId = useId();
  const criterionName = useId();
  const progressId = useId();
  const settings = useSharedMonteCarloSettings(household.id);
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
  const targetError =
    kind === 'monteCarlo' && (targetRate === null || !(targetRate > 0 && targetRate <= 1))
      ? 'Use a target above 0% and at most 100%'
      : null;

  const { seed, inflation } = settings;
  const mcConfig = useMemo(
    () => configFor({ seed, inflation, source: 'defaults' }, QUICK_RUN_PATHS),
    [seed, inflation],
  );
  const criterion: OptimizerCriterion = useMemo(
    () =>
      kind === 'monteCarlo'
        ? { kind: 'monteCarlo', config: mcConfig, minSuccessRate: targetRate ?? DEFAULT_TARGET_SUCCESS }
        : { kind: 'deterministic' },
    [kind, mcConfig, targetRate],
  );

  // Stop a scan in flight when the optimizer unmounts (the page changes).
  useEffect(() => {
    const live = activeToken;
    return () => {
      if (live.current) getOptimizerExecutor().cancel();
      live.current = null;
    };
  }, []);

  const start = () => {
    if (!target || rangeError || blocked || targetError) return;
    const fromAge = range.fromAge;
    const toAge = range.toAge;
    const ranWith = { household: target, criterion, settings };
    const token = Symbol('scan');
    activeToken.current = token;
    setRunning(true);
    setFailure(null);
    setCancelled(false);
    setProgress({ done: 0, total: toAge - fromAge + 1 });
    getOptimizerExecutor()
      .run({ household: target, ctx, criterion, range: { fromAge, toAge } }, (done, total) => {
        if (activeToken.current === token) setProgress({ done, total });
      })
      .then(
        (result) => {
          if (activeToken.current !== token) return;
          // Which rule-dependent steps are left out depends on the plan's rules, not on the scanned age.
          const projection = projectHousehold(ranWith.household, ctx);
          const limits = projection.status === 'ok' && beforeLimits(projection.value);
          setRun({ ...ranWith, fromAge, toAge, result, beforeLimits: limits });
        },
        (err: unknown) => {
          if (activeToken.current !== token) return;
          if (err instanceof RunCancelled) setCancelled(true);
          else setFailure(err instanceof Error ? err.message : String(err));
        },
      )
      .finally(() => {
        if (activeToken.current !== token) return;
        activeToken.current = null;
        setRunning(false);
        setProgress(null);
      });
  };

  const cancel = () => {
    if (activeToken.current) getOptimizerExecutor().cancel();
  };

  const value = run?.result.status === 'ok' ? run.result.value : null;
  const ranCriterion = run?.criterion ?? null;
  const ranMc = ranCriterion?.kind === 'monteCarlo' ? ranCriterion : null;
  const stale = run !== null && (run.household !== target || !sameCriterion(run.criterion, criterion));
  const skipped = value && run ? run.toAge - run.fromAge + 1 - value.evaluated.length : 0;
  const limits = run?.beforeLimits ?? false;
  // Brief §1: retiring before Medicare age carries the healthcare note.
  const early =
    value !== null &&
    (value.evaluated.some((e) => e.age < MEDICARE_AGE) ||
      (value.earliestAge !== null && value.earliestAge < MEDICARE_AGE));
  const criterionText =
    kind === 'monteCarlo'
      ? monteCarloCriterionText(targetRate ?? DEFAULT_TARGET_SUCCESS, mcConfig.quickRunPaths)
      : OPTIMIZER_CRITERION;

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
        <p className="text-sm text-muted-foreground">{criterionText}</p>
        {kind === 'monteCarlo' ? (
          <p className="text-xs text-muted-foreground">
            {settingsSummary(mcConfig.quickRunPaths, settings)}. {settingsSourceText(settings)} {REQUIRED_WORDING}
          </p>
        ) : null}
        {limits ? (
          <div className="flex flex-wrap gap-1.5">
            <BeforeLimitsBadge />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
          noValidate
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Criterion</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={criterionName}
                  value="deterministic"
                  checked={kind === 'deterministic'}
                  onChange={() => setKind('deterministic')}
                  className="size-4 accent-primary"
                />
                Deterministic (baseline run)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={criterionName}
                  value="monteCarlo"
                  checked={kind === 'monteCarlo'}
                  onChange={() => setKind('monteCarlo')}
                  className="size-4 accent-primary"
                />
                Monte Carlo success rate
              </label>
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
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
                <IntegerInput
                  {...a}
                  value={range.fromAge}
                  onChange={(fromAge) => setRange((r) => ({ ...r, fromAge }))}
                />
              )}
            </Field>
            <Field label="To age">
              {(a) => (
                <IntegerInput {...a} value={range.toAge} onChange={(toAge) => setRange((r) => ({ ...r, toAge }))} />
              )}
            </Field>
          </div>
          {kind === 'monteCarlo' ? (
            <Field
              className="sm:max-w-56"
              label="Target success rate"
              tip="The share of simulated market paths in which the plan must succeed for an age to count. Default 85%, where the dashboard's Monte Carlo “On track” band starts."
              example="Above 0% to 100%. Default 85%."
              error={targetError ?? undefined}
            >
              {(a) => <PercentInput {...a} value={targetRate} onChange={setTargetRate} />}
            </Field>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              disabled={running || !target || rangeError !== null || blocked !== null || targetError !== null}
            >
              {running ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Play aria-hidden="true" />}
              {running ? 'Running…' : 'Find earliest age'}
            </Button>
            <Button type="button" variant="outline" disabled={!running} onClick={cancel}>
              <Square aria-hidden="true" />
              Cancel scan
            </Button>
          </div>
          {running && progress ? (
            <div className="flex flex-col gap-1.5">
              <Progress
                value={progress.done}
                max={progress.total}
                aria-label="Optimizer progress"
                aria-describedby={progressId}
                getValueLabel={(v, m) => `${v} of ${m} ages`}
              />
              <p id={progressId} className="text-xs text-muted-foreground">
                {progress.done} of {progress.total} ages scanned
              </p>
            </div>
          ) : null}
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
          {cancelled ? <p className="text-sm text-muted-foreground">Scan cancelled.</p> : null}
          {failure ? (
            <Alert variant="destructive" aria-label="The scan stopped">
              <AlertTriangle aria-hidden="true" />
              <p>The scan stopped unexpectedly: {failure}</p>
            </Alert>
          ) : null}
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
              <p className="text-sm text-muted-foreground">
                {ranMc
                  ? monteCarloCriterionText(ranMc.minSuccessRate, ranMc.config.quickRunPaths)
                  : OPTIMIZER_CRITERION}
              </p>
              {ranMc && value.monteCarloPaths !== null ? (
                <p className="text-sm font-medium">
                  Scored on the first {formatCount(value.monteCarloPaths)} paths for every age.
                </p>
              ) : null}
              {ranMc ? (
                <McCriterionAssumptions config={ranMc.config} settings={run.settings} household={run.household} />
              ) : null}
              {stale ? (
                <p className="text-sm text-attention">
                  The plan or criterion changed since this scan. Run it again to update.
                </p>
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

        {value && run && value.evaluated.length > 0 ? (
          <>
            <figure className="flex flex-col gap-2">
              <figcaption className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {ranMc
                  ? 'Monte Carlo success rate by retirement age. Filled bars meet the target; outlined bars do not.'
                  : 'Ending balance (today’s dollars) by retirement age. Filled bars meet the criterion; outlined bars do not.'}
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
                title={
                  ranMc
                    ? `Monte Carlo success rate by retirement age, target ${formatPercent(ranMc.minSuccessRate, 1)}${limits ? ', before plan limits (unverified)' : ''}`
                    : `Ending balance in today’s dollars by retirement age${limits ? ', before plan limits (unverified)' : ''}`
                }
                desc="One bar per evaluated retirement age. A data table follows the chart."
              >
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="age" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} />
                {ranMc ? (
                  <YAxis
                    domain={[0, 1]}
                    tickFormatter={(v: number) => formatPercent(v, 0)}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                ) : (
                  <YAxis
                    tickFormatter={formatCompactCents}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                  />
                )}
                <Tooltip content={OptimizerTooltip} cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.4 }} />
                <Bar
                  dataKey={ranMc ? 'successRate' : 'endingBalanceReal'}
                  name={ranMc ? 'Monte Carlo success rate' : 'Ending balance'}
                  isAnimationActive={false}
                >
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
                {ranMc ? (
                  <ReferenceLine
                    y={ranMc.minSuccessRate}
                    stroke="var(--chart-marker)"
                    strokeDasharray="6 3"
                    label={markerLabel(`Target ${formatPercent(ranMc.minSuccessRate, 1)}`, 0, false)}
                  />
                ) : null}
                {value.earliestAge !== null ? (
                  <ReferenceLine
                    x={value.earliestAge}
                    stroke="var(--chart-marker)"
                    strokeDasharray="3 3"
                    label={markerLabel(
                      `Earliest ${value.earliestAge}`,
                      ranMc ? 1 : 0,
                      // Label left of the line in the second half of the range, so it is not clipped.
                      value.earliestAge > (run.fromAge + run.toAge) / 2,
                    )}
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
                    {ranMc ? <TableHead className="text-right">Monte Carlo success rate</TableHead> : null}
                    <TableHead className="text-right">
                      Ending balance (today’s dollars{ranMc ? ', baseline run' : ''})
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
                      {ranMc ? (
                        <TableCell className="text-right">
                          {e.successRate === null ? '—' : formatPercent(e.successRate, 1)}
                        </TableCell>
                      ) : null}
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
              {ranMc ? <p className="text-xs text-muted-foreground">{REQUIRED_WORDING}</p> : null}
            </DataTableDisclosure>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
