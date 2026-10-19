/** Growth and cost calculators: compound interest, fee impact, lump sum vs recurring, inflation. */
import { useMemo } from 'react';
import { useController, type Control, type FieldValues } from 'react-hook-form';
import {
  CompoundInterestInputSchema,
  FeeImpactInputSchema,
  InflationPurchasingPowerInputSchema,
  LumpSumVsRecurringInputSchema,
  compoundInterest,
  feeImpact,
  inflationPurchasingPower,
  lumpSumVsRecurring,
  type CompoundInterestResult,
  type FeeImpactResult,
  type InflationPurchasingPowerResult,
  type LumpSumVsRecurringResult,
} from '@rn/engine';
import { IntegerField, MoneyField, PercentField, PercentSliderField } from '@/components/form/fields';
import { compoundInterestDefaults, feeImpactDefaults, inflationDefaults, lumpSumDefaults } from '../defaults';
import { ExpenseRatioField, FieldGroup, InflationField, MoreOptions, ReturnSlider, ToggleRow } from '../fields';
import { BASIS, money } from '../labels';
import { CalculatorFrame, Figure, Figures } from '../parts';
import { prefillCompoundInterest, prefillFeeImpact, prefillInflation } from '../prefill';
import { SeriesChart } from '../SeriesChart';
import { looseControl, useCalculator, type CalculatorProps } from '../useCalculator';

const priceLevelFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

// ---- Compound interest ----------------------------------------------------------------------------

function GrowthInputs({ control, feeRequired = false }: { control: Control<FieldValues>; feeRequired?: boolean }) {
  return (
    <>
      <FieldGroup legend="Savings">
        <MoneyField control={control} name="principal" label="Starting balance" />
        <MoneyField
          control={control}
          name="annualContribution"
          label="Yearly contribution"
          tip="Added evenly through each year, so each year’s contribution earns about half a year of growth."
        />
        <IntegerField control={control} name="years" label="Years" example="From 1 to 100." />
        <ReturnSlider control={control} name="annualReturn" label="Annual return" />
        {feeRequired ? (
          <PercentSliderField
            control={control}
            name="expenseRatio"
            label="Expense ratio"
            min={0}
            max={2}
            step={0.05}
            tip="The yearly fund fee as a share of the balance, modeled as a drag on the return."
            example="For example, 1 for 1% a year."
          />
        ) : null}
      </FieldGroup>
      <MoreOptions control={control} names={['contributionGrowth', 'inflation', 'expenseRatio']}>
        <PercentField
          control={control}
          name="contributionGrowth"
          label="Yearly growth of the contribution"
          example="0 keeps the contribution the same every year."
        />
        <InflationField control={control} />
        {feeRequired ? null : <ExpenseRatioField control={control} />}
      </MoreOptions>
    </>
  );
}

export function CompoundInterestCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => compoundInterestDefaults(), []);
  const calc = useCalculator({
    schema: CompoundInterestInputSchema,
    run: compoundInterest,
    defaults,
    heavy: false,
    prefill: prefillCompoundInterest,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame title="Compound interest" calc={calc} fields={<GrowthInputs control={control} />}>
      {(r) => <CompoundResults r={r} />}
    </CalculatorFrame>
  );
}

function CompoundResults({ r }: { r: CompoundInterestResult }) {
  const t = r.totals;
  return (
    <>
      <Figures>
        <Figure label="Ending balance" value={money(t.endingBalance)} basis={BASIS.nominal} />
        <Figure label="Ending balance in today’s dollars" value={money(t.endingBalanceReal)} basis={BASIS.todays} />
        <Figure label="Total contributions" value={money(t.totalContributions)} basis={BASIS.nominal} />
        <Figure label="Total growth after fees" value={money(t.totalGrowth)} basis={BASIS.nominal} />
        {t.totalFeeDrag > 0 ? <Figure label="Fees" value={money(t.totalFeeDrag)} basis={BASIS.nominal} /> : null}
      </Figures>
      <SeriesChart
        caption="Year-end balance by year (nominal and today’s dollars)"
        xLabel="Year"
        data={r.rows.map((row) => ({
          x: row.year,
          end: row.endBalance,
          real: row.endBalanceReal,
          contributions: row.contributions,
          growth: row.growth,
          fees: row.feeDrag,
        }))}
        series={[
          { key: 'end', label: 'Balance (nominal)', color: 'var(--chart-1)', style: 'solid' },
          { key: 'real', label: 'Balance (today’s dollars)', color: 'var(--chart-3)', style: 'dashed' },
        ]}
        extraColumns={[
          { key: 'contributions', label: 'Contributions' },
          { key: 'growth', label: 'Growth after fees' },
          { key: 'fees', label: 'Fees' },
        ]}
        tableLabel="compound interest data table"
      />
    </>
  );
}

// ---- Fee impact -----------------------------------------------------------------------------------

export function FeeImpactCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => feeImpactDefaults(), []);
  const calc = useCalculator({
    schema: FeeImpactInputSchema,
    run: feeImpact,
    defaults,
    heavy: false,
    prefill: prefillFeeImpact,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame title="Fee impact" calc={calc} fields={<GrowthInputs control={control} feeRequired />}>
      {(r) => <FeeResults r={r} />}
    </CalculatorFrame>
  );
}

function FeeResults({ r }: { r: FeeImpactResult }) {
  return (
    <>
      <Figures>
        <Figure
          label="Lifetime cost of fees"
          value={money(r.lifetimeCost)}
          basis="Nominal dollars: fees plus the growth they would have earned"
          tone="attention"
        />
        <Figure label="Lifetime cost in today’s dollars" value={money(r.lifetimeCostReal)} basis={BASIS.todays} />
        <Figure label="Fees charged" value={money(r.feesCharged)} basis={BASIS.nominal} />
        <Figure label="Ending balance with fees" value={money(r.withFees.endingBalance)} basis={BASIS.nominal} />
        <Figure label="Ending balance without fees" value={money(r.withoutFees.endingBalance)} basis={BASIS.nominal} />
      </Figures>
      <SeriesChart
        caption="Year-end balance with and without fees, and the cumulative cost (nominal dollars)"
        xLabel="Year"
        data={r.rows.map((row) => ({
          x: row.year,
          without: row.balanceWithoutFees,
          with: row.balanceWithFees,
          cost: row.cumulativeCost,
          fee: row.feeDrag,
        }))}
        series={[
          { key: 'without', label: 'Without fees', color: 'var(--chart-3)', style: 'dashed' },
          { key: 'with', label: 'With fees', color: 'var(--chart-1)', style: 'solid' },
          { key: 'cost', label: 'Cumulative cost', color: 'var(--chart-2)', style: 'dotted' },
        ]}
        extraColumns={[{ key: 'fee', label: 'Fees charged that year' }]}
        tableLabel="fee impact data table"
      />
    </>
  );
}

// ---- Lump sum vs recurring ------------------------------------------------------------------------

export function LumpSumCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => lumpSumDefaults(), []);
  const calc = useCalculator({
    schema: LumpSumVsRecurringInputSchema,
    run: lumpSumVsRecurring,
    defaults,
    heavy: false,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame
      title="Lump sum vs recurring"
      calc={calc}
      fields={
        <>
          <FieldGroup legend="Amount and timing">
            <MoneyField control={control} name="total" label="Amount to invest" />
            <IntegerField
              control={control}
              name="spreadYears"
              label="Years to spread it over"
              tip="The recurring alternative invests the amount in equal parts, evenly through each of these years."
            />
            <IntegerField
              control={control}
              name="horizonYears"
              label="Years to compare over"
              example="At least the years it is spread over."
            />
            <ReturnSlider control={control} name="annualReturn" label="Annual return" />
          </FieldGroup>
          <MoreOptions control={control} names={['inflation', 'expenseRatio']}>
            <InflationField control={control} />
            <ExpenseRatioField control={control} />
          </MoreOptions>
        </>
      }
    >
      {(r) => <LumpSumResults r={r} />}
    </CalculatorFrame>
  );
}

function LumpSumResults({ r }: { r: LumpSumVsRecurringResult }) {
  return (
    <>
      <Figures>
        <Figure label="Lump sum: ending balance" value={money(r.lumpSum.endingBalance)} basis={BASIS.nominal} />
        <Figure label="Recurring: ending balance" value={money(r.recurring.endingBalance)} basis={BASIS.nominal} />
        <Figure label="Lump sum minus recurring" value={money(r.difference)} basis={BASIS.nominal} />
        <Figure label="Difference in today’s dollars" value={money(r.differenceReal)} basis={BASIS.todays} />
        <Figure label="Recurring amount per year" value={money(r.recurringAnnualAmount)} basis={BASIS.nominal} />
        <Figure
          label="Recurring: total invested"
          value={money(r.recurring.totalContributions)}
          basis="Nominal dollars (whole-cent payments)"
        />
      </Figures>
      <SeriesChart
        caption="Year-end balance of each alternative by year (nominal dollars)"
        xLabel="Year"
        data={r.rows.map((row) => ({ x: row.year, lump: row.lumpSumBalance, recurring: row.recurringBalance }))}
        series={[
          { key: 'lump', label: 'Lump sum', color: 'var(--chart-1)', style: 'solid' },
          { key: 'recurring', label: 'Recurring', color: 'var(--chart-2)', style: 'dashed' },
        ]}
        tableLabel="lump sum vs recurring data table"
      />
    </>
  );
}

// ---- Inflation and purchasing power ---------------------------------------------------------------

function FutureAmountField({ control }: { control: Control<FieldValues> }) {
  const { field } = useController({ control, name: 'futureAmount' });
  const on = field.value !== null && field.value !== undefined;
  return (
    <div className="flex flex-col gap-3">
      <ToggleRow
        label="Use a different future amount"
        checked={on}
        onChange={(next) => field.onChange(next ? 5_000_000 : null)}
        hint="Off: the same number of dollars as the amount above, received in the future."
      />
      {on ? (
        <MoneyField
          control={control}
          name="futureAmount"
          label="Fixed future amount"
          tip="A fixed number of dollars received in the future, such as a pension without cost-of-living increases."
        />
      ) : null}
    </div>
  );
}

export function InflationCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => inflationDefaults(), []);
  const calc = useCalculator({
    schema: InflationPurchasingPowerInputSchema,
    run: inflationPurchasingPower,
    defaults,
    heavy: false,
    prefill: prefillInflation,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame
      title="Inflation and purchasing power"
      calc={calc}
      fields={
        <FieldGroup legend="Amount and years">
          <MoneyField control={control} name="amount" label="Amount in today’s dollars" />
          <IntegerField control={control} name="years" label="Years from now" example="From 1 to 100." />
          <PercentSliderField
            control={control}
            name="inflation"
            label="Inflation"
            min={0}
            max={10}
            step={0.1}
            tip="The yearly rise in prices, the same every year."
            example="For example, 3 for 3% a year."
          />
          <FutureAmountField control={control} />
        </FieldGroup>
      }
    >
      {(r) => <InflationResults r={r} />}
    </CalculatorFrame>
  );
}

function InflationResults({ r }: { r: InflationPurchasingPowerResult }) {
  const last = r.rows[r.rows.length - 1];
  const years = last?.yearsFromNow ?? 0;
  return (
    <>
      <Figures>
        <Figure label={`Cost in ${years} years of today’s amount`} value={money(r.futureCost)} basis={BASIS.nominal} />
        <Figure
          label={`Today’s value of the future amount in ${years} years`}
          value={money(r.todaysValue)}
          basis={BASIS.todays}
        />
        <Figure
          label="Price level then (today = 1)"
          value={priceLevelFormat.format(r.priceLevel)}
          basis="Engine price index"
        />
      </Figures>
      <SeriesChart
        caption="Cost of today’s amount (nominal) and today’s value of the future amount (today’s dollars) by year"
        xLabel="Year"
        data={r.rows.map((row) => ({
          x: row.year,
          cost: row.costOfTodaysAmount,
          value: row.todaysValueOfFutureAmount,
          price: row.priceLevel,
        }))}
        series={[
          { key: 'cost', label: 'Cost of today’s amount (nominal)', color: 'var(--chart-2)', style: 'solid' },
          {
            key: 'value',
            label: 'Today’s value of the future amount',
            color: 'var(--chart-1)',
            style: 'dashed',
          },
        ]}
        extraColumns={[{ key: 'price', label: 'Price level', format: (v) => priceLevelFormat.format(v) }]}
        tableLabel="purchasing power data table"
      />
    </>
  );
}
