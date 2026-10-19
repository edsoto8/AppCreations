/** Social Security claiming comparison: lifetime totals by claiming age, from a PIA or the statement's amounts. */
import { useMemo } from 'react';
import { useFieldArray, useWatch, type Control, type FieldValues } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import type { z } from 'zod';
import {
  SsClaimingComparisonInputSchema,
  ssClaimingComparison,
  type EngineContext,
  type SsClaimingComparisonInput,
  type SsClaimingComparisonResult,
} from '@rn/engine';
import { IntegerField, MoneyField, SelectField } from '@/components/form/fields';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ssClaimingDefaults, type SsClaimingFormValues } from '../defaults';
import { ArrayError, ClaimAgeFields, FieldGroup } from '../fields';
import { BASIS, formatClaimAge, money } from '../labels';
import { CalculatorFrame, Figure, Figures, ResultHeading } from '../parts';
import { prefillSsClaiming } from '../prefill';
import { SeriesChart, type ChartPoint, type ChartSeries } from '../SeriesChart';
import { looseControl, useCalculator, type CalculatorProps } from '../useCalculator';

const MODES = [
  { value: 'amountsAtClaimAge', label: 'Amounts at each claiming age' },
  { value: 'pia', label: 'Benefit at full retirement age (PIA)' },
] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
].map((label, i) => ({ value: String(i + 1), label }));

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-7)',
  'var(--chart-4)',
  'var(--chart-5)',
];
const STYLES: ChartSeries['style'][] = ['solid', 'dashed', 'dotted'];

const factorFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const ssSchema = SsClaimingComparisonInputSchema as unknown as z.ZodType<unknown, SsClaimingFormValues>;
const runSs = (x: SsClaimingFormValues, ctx: EngineContext) =>
  ssClaimingComparison(x as SsClaimingComparisonInput, ctx);

function OptionsFields({ control }: { control: Control<FieldValues> }) {
  const options = useFieldArray({ control, name: 'options' });
  return (
    <FieldGroup legend="Claiming ages">
      <p className="text-xs text-muted-foreground">
        The monthly benefit at each age, as the SSA statement lists it (today’s dollars).
      </p>
      <ol className="flex flex-col gap-3">
        {options.fields.map((o, i) => (
          <li key={o.id} className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Option {i + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => options.remove(i)}
                aria-label={`Remove claiming option ${i + 1}`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            <ClaimAgeFields control={control} name={`options.${i}.claimAge`} label={`Option ${i + 1} claiming age`} />
            <MoneyField
              control={control}
              name={`options.${i}.monthlyAtClaim`}
              label={`Option ${i + 1} monthly benefit`}
            />
          </li>
        ))}
      </ol>
      <ArrayError control={control} name="options" />
      {options.fields.length < 12 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => options.append({ claimAge: { years: 65, months: 0 }, monthlyAtClaim: 180_000 })}
        >
          <Plus aria-hidden="true" />
          Add a claiming age
        </Button>
      ) : null}
    </FieldGroup>
  );
}

export function SsClaimingCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => ssClaimingDefaults(), []);
  const calc = useCalculator({
    schema: ssSchema,
    run: runSs,
    defaults,
    heavy: false,
    prefill: prefillSsClaiming,
    props,
  });
  const control = looseControl(calc.form.control);
  const mode = useWatch({ control, name: 'mode' }) as SsClaimingFormValues['mode'];
  return (
    <CalculatorFrame
      title="Social Security claiming"
      calc={calc}
      fields={
        <>
          <SelectField control={control} name="mode" label="Compare using" options={MODES} />
          <FieldGroup legend="You">
            <div className="grid grid-cols-2 gap-3">
              <IntegerField control={control} name="birthYear" label="Birth year" />
              <SelectField control={control} name="birthMonth" label="Birth month" options={MONTHS} numeric />
            </div>
            <IntegerField
              control={control}
              name="throughAge"
              label="Add up benefits through age"
              tip="Lifetime totals include every benefit from this year through the end of this age."
            />
          </FieldGroup>
          {mode === 'pia' ? (
            <MoneyField
              control={control}
              name="piaMonthly"
              label="Monthly benefit at full retirement age"
              tip="The primary insurance amount (PIA) from the SSA statement, in today’s dollars. The amount at each claiming age needs the verified claiming rules."
            />
          ) : (
            <OptionsFields control={control} />
          )}
        </>
      }
    >
      {(r) => <SsResults r={r} />}
    </CalculatorFrame>
  );
}

function SsResults({ r }: { r: SsClaimingComparisonResult }) {
  const best = r.options.find(
    (o) => r.highestTotal && o.claimAge.years === r.highestTotal.years && o.claimAge.months === r.highestTotal.months,
  );
  const ages = r.options[0]?.cumulativeByAge.map((row) => row.age) ?? [];
  const data: ChartPoint[] = ages.map((age, k) => {
    const point: ChartPoint = { x: age };
    r.options.forEach((o, i) => {
      point[`o${i}`] = o.cumulativeByAge[k]?.cumulative ?? null;
    });
    return point;
  });
  const series: ChartSeries[] = r.options.map((o, i) => ({
    key: `o${i}`,
    label: `Claim at ${formatClaimAge(o.claimAge)}`,
    color: COLORS[i % COLORS.length] ?? 'var(--chart-1)',
    style: STYLES[i % STYLES.length] ?? 'solid',
  }));
  const throughAge = ages[ages.length - 1];
  return (
    <>
      <Figures>
        {r.fullRetirementAge ? (
          <Figure label="Full retirement age" value={formatClaimAge(r.fullRetirementAge)} basis="Age" />
        ) : null}
        <Figure
          label="Highest total"
          value={best ? `Claiming at ${formatClaimAge(best.claimAge)}` : '—'}
          basis={throughAge === undefined ? undefined : `Benefits through age ${throughAge}`}
        />
        {best ? <Figure label="Its total" value={money(best.cumulativeThroughAge)} basis={BASIS.todays} /> : null}
      </Figures>
      {r.options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every entered claiming age is before this year’s age ({r.currentAge}), so there is nothing to compare.
        </p>
      ) : (
        <>
          <ResultHeading>By claiming age</ResultHeading>
          <Table label="Social Security by claiming age">
            <TableHeader>
              <TableRow>
                <TableHead>Claiming age</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                {r.fullRetirementAge ? <TableHead className="text-right">Factor</TableHead> : null}
                <TableHead className="text-right">First year</TableHead>
                <TableHead className="text-right">Total through {throughAge ?? '—'}</TableHead>
                <TableHead className="text-right">Break-even age vs earliest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.options.map((o, i) => (
                <TableRow key={`${o.claimAge.years}-${o.claimAge.months}`}>
                  <TableCell>{formatClaimAge(o.claimAge)}</TableCell>
                  <TableCell className="text-right">{money(o.monthly)}</TableCell>
                  {r.fullRetirementAge ? (
                    <TableCell className="text-right">
                      {o.adjustmentFactor === null ? '—' : factorFormat.format(o.adjustmentFactor)}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">{o.firstBenefitYear}</TableCell>
                  <TableCell className="text-right">{money(o.cumulativeThroughAge)}</TableCell>
                  <TableCell className="text-right">
                    {i === 0
                      ? 'Earliest'
                      : o.breakEvenAgeVsEarliest === null
                        ? 'Not by then'
                        : o.breakEvenAgeVsEarliest}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <SeriesChart
            caption="Running total of benefits by age, for each claiming age (today’s dollars)"
            xLabel="Age"
            data={data}
            series={series}
            tableLabel="Social Security running totals data table"
          />
        </>
      )}
    </>
  );
}
