/**
 * Simulation settings (validated by the engine's MonteCarloConfigSchema) with the Run / Cancel
 * controls and the progress bar. The correlation check (positive semi-definite) uses the engine's
 * `isPositiveSemiDefinite` on the matrix the engine will factor; a failing check blocks the run.
 */
import { useId } from 'react';
import { useController, useWatch, type FieldError } from 'react-hook-form';
import { AlertTriangle, Dices, Loader2, Play, Square } from 'lucide-react';
import type { MonteCarloConfig } from '@rn/engine';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/form/Field';
import { DecimalInput, IntegerInput, PercentInput } from '@/components/form/inputs';
import { formatPercent } from '@/lib/format';
import { useMonteCarloStore } from './runStore';
import type { ConfigControl, RunSettingsForm } from './settingsForm';
import {
  ASSET_CLASSES,
  ASSET_LABELS,
  DEFAULT_INFLATION_CORRELATION,
  DEFAULT_INFLATION_VOLATILITY,
  DEFAULT_SEED,
  formatCount,
  randomSeed,
} from './viewModel';

/** Plain-language range messages instead of Zod's defaults. */
function rangeMessage(error: FieldError | undefined, range: string): string | undefined {
  if (!error) return undefined;
  if (error.type === 'too_small' || error.type === 'too_big' || error.type === 'invalid_type') return range;
  if (error.type === 'custom' || error.message?.startsWith('Invalid input')) return range;
  return error.message;
}

function NumberSetting({
  control,
  name,
  label,
  tip,
  example,
  range,
  kind,
}: {
  control: ConfigControl;
  name: 'paths' | 'seed' | 'inflation.median' | 'inflation.volatility';
  label: string;
  tip: string;
  example: string;
  range: string;
  kind: 'integer' | 'percent';
}) {
  const { field, fieldState } = useController({ control, name });
  const Input = kind === 'integer' ? IntegerInput : PercentInput;
  return (
    <Field label={label} tip={tip} example={example} error={rangeMessage(fieldState.error, range)}>
      {(a) => <Input {...a} value={(field.value as number | undefined) ?? null} onChange={field.onChange} />}
    </Field>
  );
}

function InflationCorrelation({ control, index }: { control: ConfigControl; index: number }) {
  const asset = ASSET_CLASSES[index] ?? 'stocks';
  const { field, fieldState } = useController({
    control,
    name: `inflation.correlationWithAssets.${index}` as 'inflation.correlationWithAssets.0',
  });
  return (
    <Field
      label={`Inflation and ${ASSET_LABELS[asset].toLowerCase()}`}
      tip="Correlation between the inflation shock and this asset class’s return shock, from −1 to 1."
      example="Default 0 (unrelated)."
      error={rangeMessage(fieldState.error, 'Enter a correlation between −1 and 1')}
    >
      {(a) => <DecimalInput {...a} value={(field.value as number | undefined) ?? null} onChange={field.onChange} />}
    </Field>
  );
}

/** Progress bar with its own store subscription, so progress updates re-render only this. */
function RunProgress() {
  const progress = useMonteCarloStore((s) => s.progress);
  const statusId = useId();
  if (!progress) return null;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <Progress
        value={progress.done}
        max={progress.total}
        aria-label="Simulation progress"
        aria-describedby={statusId}
        getValueLabel={(v, m) => `${formatCount(v)} of ${formatCount(m)} paths`}
      />
      <p id={statusId} className="text-xs text-muted-foreground">
        {progress.phase === 'quick' ? 'Quick run' : 'Refining'}: {formatCount(progress.done)} of{' '}
        {formatCount(progress.total)} paths ({pct}%)
      </p>
    </div>
  );
}

export function RunSettings({
  form,
  planInflation,
  running,
  blockers,
  onRun,
  onCancel,
}: {
  form: RunSettingsForm;
  /** The plan's inflation assumption (used when inflation is fixed). */
  planInflation: number;
  running: boolean;
  /** Reasons the run cannot start (shown beside the Run button). */
  blockers: string[];
  onRun: (config: MonteCarloConfig) => void;
  onCancel: () => void;
}) {
  const control = form.control;
  const mode = useWatch({ control, name: 'inflation.mode' });
  const blockersId = useId();

  return (
    <Card aria-labelledby="mc-settings-title">
      <CardHeader>
        <CardTitle id="mc-settings-title">Simulation settings</CardTitle>
        <CardDescription>
          Each path draws a different sequence of annual returns and runs your full plan through it. The first 1,000
          paths are shown first, then the result refines to the number you choose.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(e) => void form.handleSubmit((config) => onRun(config))(e)}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <NumberSetting
              control={control}
              name="paths"
              kind="integer"
              label="Number of paths"
              tip="How many simulated market histories to run. More paths give steadier percentages but take longer."
              example="1,000 to 10,000. Default 10,000."
              range="Use 1,000 to 10,000 paths"
            />
            <div className="flex flex-col gap-2">
              <NumberSetting
                control={control}
                name="seed"
                kind="integer"
                label="Seed"
                tip="The starting number for the random sequence. The same seed and inputs always give the same result; a new seed shows how much results move by chance."
                example={`A whole number from 0 to 4,294,967,295. Default ${DEFAULT_SEED}.`}
                range="Use a whole number from 0 to 4,294,967,295"
              />
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => form.setValue('seed', randomSeed(), { shouldValidate: true, shouldDirty: true })}
                >
                  <Dices aria-hidden="true" />
                  New seed
                </Button>
              </div>
            </div>
          </div>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-sm font-semibold">Inflation</legend>
            <Field
              label="Inflation model"
              tip="Fixed uses your plan’s inflation assumption every year. Stochastic draws each year’s inflation, so every path has its own price level (used for its today’s-dollar values, spending and Social Security cost-of-living adjustments)."
              example={`Fixed uses the plan’s ${formatPercent(planInflation)} a year.`}
            >
              {(a) => (
                <NativeSelect
                  {...a}
                  value={mode}
                  onChange={(e) => {
                    if (e.target.value === 'stochastic') {
                      form.setValue(
                        'inflation',
                        {
                          mode: 'stochastic',
                          median: planInflation,
                          volatility: DEFAULT_INFLATION_VOLATILITY,
                          correlationWithAssets: [...DEFAULT_INFLATION_CORRELATION],
                        },
                        { shouldValidate: true },
                      );
                    } else {
                      form.setValue('inflation', { mode: 'fixed' }, { shouldValidate: true });
                    }
                  }}
                >
                  <option value="fixed">Fixed ({formatPercent(planInflation)} a year, from the plan)</option>
                  <option value="stochastic">Stochastic (varies by year and path)</option>
                </NativeSelect>
              )}
            </Field>
            {mode === 'stochastic' ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Assumptions: the defaults below (median = your plan’s inflation, 1% volatility, no correlation) are
                  illustrative, not a forecast.
                </p>
                <div className="grid gap-5 sm:grid-cols-2">
                  <NumberSetting
                    control={control}
                    name="inflation.median"
                    kind="percent"
                    label="Median inflation"
                    tip="The middle of each year’s inflation draw (lognormal)."
                    example={`−5% to 20%. Your plan uses ${formatPercent(planInflation)}.`}
                    range="Use −5% to 20%"
                  />
                  <NumberSetting
                    control={control}
                    name="inflation.volatility"
                    kind="percent"
                    label="Inflation volatility"
                    tip="Standard deviation of annual log inflation."
                    example="0% to 20%. Default 1%."
                    range="Use 0% to 20%"
                  />
                </div>
                <div className="grid gap-5 sm:grid-cols-3">
                  {[0, 1, 2].map((i) => (
                    <InflationCorrelation key={i} control={control} index={i} />
                  ))}
                </div>
              </>
            ) : null}
          </fieldset>

          <p className="text-xs text-muted-foreground">Rebalancing: every year, back to each account’s target mix.</p>

          {blockers.length > 0 ? (
            <Alert variant="destructive" id={blockersId} aria-label="Cannot run yet">
              <AlertTriangle aria-hidden="true" />
              <ul className="flex flex-col gap-1">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                disabled={running || blockers.length > 0}
                aria-describedby={blockers.length > 0 ? blockersId : undefined}
              >
                {running ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Play aria-hidden="true" />}
                {running ? 'Running…' : 'Run simulation'}
              </Button>
              <Button type="button" variant="outline" disabled={!running} onClick={onCancel}>
                <Square aria-hidden="true" />
                Cancel
              </Button>
            </div>
            {running ? <RunProgress /> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
