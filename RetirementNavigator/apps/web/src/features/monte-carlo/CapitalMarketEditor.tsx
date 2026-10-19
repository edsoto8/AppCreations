/**
 * Capital-market assumptions editor (part of the household: `assumptions.capitalMarket`). Edits go
 * through the profile form (engine HouseholdSchema) and are saved with the profile. Correlations are
 * entered once per pair and written to both halves of the matrix, so it stays symmetric.
 */
import { useController, useWatch, type UseFormReturn } from 'react-hook-form';
import { AlertTriangle } from 'lucide-react';
import type { Household, HouseholdInput, MonteCarloResult } from '@rn/engine';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/form/Field';
import { DecimalInput } from '@/components/form/inputs';
import { PercentField } from '@/components/form/fields';
import { formatPercent } from '@/lib/format';
import { ASSET_CLASSES, ASSET_LABELS, type AssetClassKey } from './viewModel';

type HouseholdForm = UseFormReturn<HouseholdInput, unknown, Household>;

const PAIRS: { i: number; j: number; label: string; example: string }[] = [
  { i: 0, j: 1, label: 'Stocks and bonds', example: 'Default 0.1: they move slightly together.' },
  { i: 0, j: 2, label: 'Stocks and cash', example: 'Default 0: unrelated.' },
  { i: 1, j: 2, label: 'Bonds and cash', example: 'Default 0.2.' },
];

function CorrelationField({ form, i, j, label, example }: { form: HouseholdForm } & (typeof PAIRS)[number]) {
  const { field, fieldState } = useController({ control: form.control, name: 'assumptions.capitalMarket.correlation' });
  const matrix = (field.value as number[][] | undefined) ?? [];
  const value = matrix[i]?.[j] ?? null;
  const error = fieldState.error as
    { message?: string } | (({ message?: string } | undefined)[] | undefined)[] | undefined;
  const cellError = Array.isArray(error) ? error[i]?.[j]?.message : undefined;
  const message =
    cellError !== undefined
      ? 'Enter a correlation between −1 and 1'
      : !Array.isArray(error)
        ? error?.message
        : undefined;
  return (
    <Field
      label={label}
      tip="Correlation of annual log returns, from −1 (always opposite) through 0 (unrelated) to 1 (always together). It is entered once and applies both ways."
      example={example}
      error={message}
    >
      {(a) => (
        <DecimalInput
          {...a}
          value={value}
          onChange={(v) => {
            const next = matrix.map((row) => [...row]);
            if (next[i]) next[i][j] = v;
            if (next[j]) next[j][i] = v;
            field.onChange(next);
          }}
        />
      )}
    </Field>
  );
}

/** The rationale/source note: a textarea, since it is usually a sentence or two. */
function NoteField({ form }: { form: HouseholdForm }) {
  const { field, fieldState } = useController({ control: form.control, name: 'assumptions.capitalMarket.note' });
  return (
    <Field
      label="Source or rationale"
      tip="Why these values: shown beside every Monte Carlo result that uses them."
      example="For example: “Round numbers from long-run US history; not a forecast.”"
      error={fieldState.error ? 'Describe where these values come from (it cannot be empty)' : undefined}
    >
      {(a) => (
        <textarea
          {...a}
          rows={2}
          className="w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm aria-invalid:border-destructive"
          value={(field.value as string | undefined) ?? ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      )}
    </Field>
  );
}

function ArithmeticMean({
  asset,
  result,
  current,
}: {
  asset: AssetClassKey;
  result: MonteCarloResult | null;
  /** Whether the result was computed from the capital-market values on screen. */
  current: boolean;
}) {
  if (!result) {
    return (
      <p className="text-xs text-muted-foreground">Arithmetic mean: shown after a run (computed by the engine).</p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Arithmetic mean{current ? '' : ' at the last run'}:{' '}
      <span className="font-medium text-foreground tabular-nums">
        {formatPercent(result.impliedArithmeticMeans[asset], 2)}
      </span>
      {current ? ' (from the engine)' : ' — run again to update'}
    </p>
  );
}

function CorrelationMatrixTable({ form }: { form: HouseholdForm }) {
  const matrix = (useWatch({ control: form.control, name: 'assumptions.capitalMarket.correlation' }) ??
    []) as number[][];
  return (
    <table className="w-full max-w-sm text-xs tabular-nums" aria-label="Correlation matrix (symmetric)">
      <thead>
        <tr>
          <td />
          {ASSET_CLASSES.map((a) => (
            <th key={a} scope="col" className="px-2 py-1 text-right font-semibold text-muted-foreground">
              {ASSET_LABELS[a]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ASSET_CLASSES.map((a, i) => (
          <tr key={a} className="border-t">
            <th scope="row" className="px-2 py-1 text-left font-semibold text-muted-foreground">
              {ASSET_LABELS[a]}
            </th>
            {ASSET_CLASSES.map((b, j) => (
              <td key={b} className="px-2 py-1 text-right">
                {String(matrix[i]?.[j] ?? '—')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CapitalMarketEditor({
  form,
  result,
  resultIsCurrent,
  psd,
}: {
  form: HouseholdForm;
  result: MonteCarloResult | null;
  resultIsCurrent: boolean;
  /** Whether the 3×3 asset correlation matrix is positive semi-definite (`isPositiveSemiDefinite`). */
  psd: boolean;
}) {
  const control = form.control;
  return (
    <Card aria-labelledby="cma-title">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle id="cma-title">Capital-market assumptions</CardTitle>
          <Badge variant="outline">Assumptions</Badge>
        </div>
        <CardDescription>
          Editable defaults, not forecasts. Returns are geometric (median) nominal annual returns; the engine derives
          the arithmetic mean from each return and volatility. Saved with this profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-5 sm:grid-cols-3">
          {ASSET_CLASSES.map((asset) => (
            <fieldset key={asset} className="flex min-w-0 flex-col gap-3">
              <legend className="mb-2 text-sm font-semibold">{ASSET_LABELS[asset]}</legend>
              <PercentField
                control={control}
                name={`assumptions.capitalMarket.${asset}.geometricReturn`}
                label={`${ASSET_LABELS[asset]} median return`}
                tip="Geometric (median) nominal annual return: half of simulated years compound above it and half below. The deterministic forecast uses the same value, so the Monte Carlo median reconciles with it."
                example="−50% to 50%."
              />
              <ArithmeticMean asset={asset} result={result} current={resultIsCurrent} />
              <PercentField
                control={control}
                name={`assumptions.capitalMarket.${asset}.volatility`}
                label={`${ASSET_LABELS[asset]} volatility`}
                tip="Standard deviation of annual log returns. Higher volatility widens the range of outcomes and raises the arithmetic mean for the same median."
                example="0% to 100%."
              />
            </fieldset>
          ))}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold">Correlations</legend>
          <p className="text-xs text-muted-foreground">
            Each pair is entered once and applies both ways, so the matrix stays symmetric with 1s on the diagonal.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {PAIRS.map((p) => (
              <CorrelationField key={`${p.i}-${p.j}`} form={form} {...p} />
            ))}
          </div>
          <CorrelationMatrixTable form={form} />
          {!psd ? (
            <Alert variant="destructive" aria-label="Correlation problem">
              <AlertTriangle aria-hidden="true" />
              <p>
                These correlations are not positive semi-definite: no set of returns can have all three at once, so
                Monte Carlo cannot run. Make the pairs consistent (for example, if stocks move with bonds and bonds move
                with cash, stocks cannot move strongly opposite to cash).
              </p>
            </Alert>
          ) : null}
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <PercentField
            control={control}
            name="assumptions.capitalMarket.blendedVolatility"
            label="Blended volatility"
            tip="Volatility for accounts with no stock/bond/cash allocation (they use their own expected return). In each simulated year they move with the stock shock (a documented simplification)."
            example="Default 12%."
          />
          <NoteField form={form} />
        </div>
      </CardContent>
    </Card>
  );
}
