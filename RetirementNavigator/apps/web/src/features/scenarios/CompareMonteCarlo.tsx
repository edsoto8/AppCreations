/**
 * The Compare view's opt-in Monte Carlo success rates: the switch, the paths setting, run / cancel
 * with progress, the stale notice, each plan's rate cell and the assumptions beside the rates. Every
 * rate is the engine's `successRate` for that plan; nothing is computed here.
 */
import { useId } from 'react';
import { Link } from 'react-router';
import { Loader2, Play, Square } from 'lucide-react';
import type { MonteCarloConfig } from '@rn/engine';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Field } from '@/components/form/Field';
import { IntegerInput } from '@/components/form/inputs';
import { formatPercent } from '@/lib/format';
import { REQUIRED_WORDING } from '@/features/monte-carlo/ResultsPanel';
import {
  inflationLabel,
  settingsSourceText,
  settingsSummary,
  type SharedMonteCarloSettings,
} from '@/features/monte-carlo/sharedSettings';
import { formatCount } from '@/features/monte-carlo/viewModel';
import { pathsError, type CompareMonteCarloState, type McPlan, type PlanRate } from './compareMonteCarlo';

const LINK = 'font-medium text-foreground underline underline-offset-4';

export const MC_COMPARE_LABEL = 'Monte Carlo success rate';

/** Fixed inflation in a comparison follows each plan's own assumption (a scenario may change it). */
const FIXED_NOTE = 'each plan’s own inflation assumption';

export function CompareMonteCarloControls({
  enabled,
  onEnabledChange,
  paths,
  onPathsChange,
  settings,
  state,
  runnablePlans,
}: {
  enabled: boolean;
  onEnabledChange: (on: boolean) => void;
  paths: number | null;
  onPathsChange: (n: number) => void;
  settings: SharedMonteCarloSettings;
  state: CompareMonteCarloState;
  /** Plans that can be simulated (invalid scenarios are skipped). */
  runnablePlans: number;
}) {
  const switchId = useId();
  const descId = useId();
  const statusId = useId();
  const error = pathsError(paths);
  const { running, progress, run, stale, cancelled } = state;
  return (
    <section aria-labelledby={`${switchId}-label`} className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <Switch
          id={switchId}
          checked={enabled}
          onCheckedChange={(on) => {
            if (!on) state.cancel();
            onEnabledChange(on);
          }}
          aria-describedby={descId}
        />
        <div className="flex flex-col gap-1">
          <Label id={`${switchId}-label`} htmlFor={switchId}>
            Add Monte Carlo success rates
          </Label>
          <p id={descId} className="text-xs text-muted-foreground">
            Runs every plan on the same simulated market paths (the same seed and number of paths for each plan), so
            differences between plans are not from different random draws. Runs in the background; it can take a few
            seconds per plan.
          </p>
        </div>
      </div>
      {enabled ? (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_auto] sm:items-end">
            <Field
              label="Paths per plan"
              tip="How many simulated market histories to run for each plan. More paths give steadier percentages but take longer."
              example="1,000 to 10,000. Default 1,000."
              error={error ?? undefined}
            >
              {(a) => <IntegerInput {...a} value={paths} onChange={onPathsChange} />}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={state.start} disabled={running || error !== null || runnablePlans === 0}>
                {running ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Play aria-hidden="true" />}
                {running ? 'Running…' : run ? 'Run Monte Carlo again' : 'Run Monte Carlo for these plans'}
              </Button>
              <Button type="button" variant="outline" onClick={state.cancel} disabled={!running}>
                <Square aria-hidden="true" />
                Cancel
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {settingsSourceText(settings)}{' '}
            <Link to="/monte-carlo" className={LINK}>
              Monte Carlo page
            </Link>
          </p>
          {running && progress ? (
            <div className="flex flex-col gap-1.5">
              <Progress
                value={progress.done}
                max={progress.total}
                aria-label="Comparison Monte Carlo progress"
                aria-describedby={statusId}
                getValueLabel={(v, m) => `${formatCount(v)} of ${formatCount(m)} paths`}
              />
              <p id={statusId} className="text-xs text-muted-foreground">
                Plan {progress.planIndex + 1} of {progress.plans} ({progress.name}): {formatCount(progress.done)} of{' '}
                {formatCount(progress.total)} paths across all plans
              </p>
            </div>
          ) : null}
          <div aria-live="polite" className="text-sm">
            {!running && cancelled ? <p className="text-muted-foreground">Monte Carlo cancelled.</p> : null}
            {!running && run && stale ? (
              <p className="font-medium text-attention">
                The plans or settings changed since these success rates were computed. Run Monte Carlo again to update
                them.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Row header text: the label plus the run's assumptions (paths, seed, inflation, required wording). */
export function McRowHeader({
  config,
  settings,
}: {
  config: MonteCarloConfig | null;
  settings: SharedMonteCarloSettings;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span>{MC_COMPARE_LABEL}</span>
      {config ? (
        <span className="text-xs font-normal text-muted-foreground">
          {settingsSummary(config.paths, { ...settings, seed: config.seed, inflation: config.inflation }, FIXED_NOTE)};
          the same paths for every plan. {REQUIRED_WORDING}
        </span>
      ) : (
        <span className="text-xs font-normal text-muted-foreground">Not computed yet. {REQUIRED_WORDING}</span>
      )}
    </span>
  );
}

export function McRateCell({ rate, stale }: { rate: PlanRate | undefined; stale: boolean }) {
  if (!rate) return <span className="text-muted-foreground">Not computed</span>;
  if (rate.status === 'skipped') return <>—</>;
  if (rate.status === 'failed') {
    const unverified = 'result' in rate.failure && rate.failure.result.status === 'unverified';
    return <span className="font-medium text-attention">{unverified ? 'Unverified rule' : 'Could not run'}</span>;
  }
  const r = rate.result;
  const successes = Math.round(r.successRate * r.paths);
  return (
    <span className={stale ? 'flex flex-col text-muted-foreground' : 'flex flex-col'}>
      <span className="font-semibold">{formatPercent(r.successRate, 0)}</span>
      <span className="text-xs text-muted-foreground">
        {formatCount(successes)} of {formatCount(r.paths)} paths
      </span>
      {stale ? <span className="text-xs">Out of date</span> : null}
    </span>
  );
}

/** The assumptions behind the comparison's success rates, always visible next to the table. */
export function McAssumptions({
  config,
  settings,
  plans,
  rates,
}: {
  config: MonteCarloConfig;
  settings: SharedMonteCarloSettings;
  plans: readonly McPlan[];
  rates: Record<string, PlanRate>;
}) {
  const titleId = useId();
  const withResults = plans.flatMap((p) => {
    const r = rates[p.key];
    return r?.status === 'ok' ? [{ name: p.name, assumptions: r.result.assumptions }] : [];
  });
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
      <h3 id={titleId} className="font-semibold">
        Assumptions behind these success rates
      </h3>
      <p className="font-medium">{REQUIRED_WORDING}</p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>
          {formatCount(config.paths)} paths and seed {config.seed} for every plan: each plan runs on the same simulated
          market paths, so differences between plans come from the plans, not from different random draws.
        </li>
        <li>Inflation: {inflationLabel(config.inflation, FIXED_NOTE)}.</li>
        <li>{settingsSourceText(settings)}</li>
        <li>
          Success: the plan funds its modeled spending through the planning age and ends with at least its minimum
          ending balance (today’s dollars).
        </li>
        <li>
          Lognormal annual returns, independent across years, from each plan’s capital-market assumptions; rebalanced
          every year. Not modeled: fat tails, mean reversion, regime changes.
        </li>
      </ul>
      {withResults.length > 0 ? (
        <details className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer font-medium">Full assumptions by plan</summary>
          <div className="mt-2 flex flex-col gap-3">
            {withResults.map((p, i) => (
              <div key={i} className="flex flex-col gap-1">
                <p className="font-medium">{p.name}</p>
                <ul
                  className="list-disc pl-5 text-muted-foreground"
                  aria-label={`Monte Carlo assumptions for ${p.name}`}
                >
                  {p.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
