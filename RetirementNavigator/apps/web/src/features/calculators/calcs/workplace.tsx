/** Workplace-plan calculators: 401(k) contributions, employer match, Roth vs traditional. */
import { useMemo } from 'react';
import { useController, useWatch, type Control, type FieldValues } from 'react-hook-form';
import {
  Contribution401kInputSchema,
  MatchOptimizerInputSchema,
  RothVsTraditionalInputSchema,
  contribution401k,
  matchOptimizer,
  rothVsTraditional,
  type Contribution401kResult,
  type MatchOptimizerResult,
  type RothVsTraditionalResult,
  type RothVsTraditionalSide,
} from '@rn/engine';
import {
  IntegerField,
  MoneyField,
  PercentField,
  PercentSliderField,
  SelectField,
  SwitchField,
} from '@/components/form/fields';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  contribution401kDefaults,
  EXAMPLE_MATCH,
  matchOptimizerDefaults,
  rothVsTraditionalDefaults,
} from '../defaults';
import { FieldGroup, InflationField, MatchFields, MoreOptions, ReturnSlider, ToggleRow } from '../fields';
import { BASIS, TAX_FEATURES, money, pct, yesNo } from '../labels';
import { CalculatorFrame, Figure, Figures, NotAvailable, ResultHeading } from '../parts';
import { prefillContribution401k, prefillMatchOptimizer, prefillRothVsTraditional } from '../prefill';
import { SeriesChart } from '../SeriesChart';
import { looseControl, useCalculator, type CalculatorProps } from '../useCalculator';

const PLAN_TYPES = [
  { value: '401k', label: '401(k)' },
  { value: '403b', label: '403(b)' },
  { value: '457b', label: '457(b)' },
] as const;

// ---- 401(k) contributions -------------------------------------------------------------------------

function OptionalMatch({ control }: { control: Control<FieldValues> }) {
  const { field } = useController({ control, name: 'match' });
  const on = field.value !== null && field.value !== undefined;
  return (
    <div className="flex flex-col gap-4">
      <ToggleRow
        label="The plan has an employer match"
        checked={on}
        onChange={(next) => field.onChange(next ? structuredClone(EXAMPLE_MATCH) : null)}
      />
      {on ? <MatchFields control={control} /> : null}
    </div>
  );
}

function OptionalFicaWages({ control }: { control: Control<FieldValues> }) {
  const { field } = useController({ control, name: 'priorYearFicaWages' });
  const on = field.value !== null && field.value !== undefined;
  return (
    <div className="flex flex-col gap-3">
      <ToggleRow
        label="Enter last year’s FICA wages"
        checked={on}
        onChange={(next) => field.onChange(next ? 0 : null)}
        hint="Box 3 of last year’s W-2. Higher earners’ catch-up contributions must be Roth; this decides whether that applies."
      />
      {on ? <MoneyField control={control} name="priorYearFicaWages" label="Last year’s FICA wages" /> : null}
    </div>
  );
}

function Contribution401kInputs({ control }: { control: Control<FieldValues> }) {
  const offersRoth = useWatch({ control, name: 'planOffersRoth' }) as boolean | undefined;
  return (
    <>
      <FieldGroup legend="You">
        <IntegerField control={control} name="age" label="Current age" />
        <IntegerField
          control={control}
          name="retirementAge"
          label="Retirement age"
          tip="Salary and contributions stop at the start of the year this age is reached."
        />
        <MoneyField control={control} name="salary" label="Base salary" />
        <PercentField
          control={control}
          name="salaryGrowth"
          label="Yearly raise"
          example="For example, 3 for 3% a year."
        />
      </FieldGroup>
      <FieldGroup legend="Plan">
        <SelectField control={control} name="planType" label="Plan type" options={PLAN_TYPES} />
        <SwitchField control={control} name="planOffersRoth" label="Plan offers Roth contributions" />
        <PercentSliderField
          control={control}
          name="traditionalPctOfSalary"
          label="Traditional (pre-tax) % of salary"
          min={0}
          max={50}
          step={0.5}
          tip="Pre-tax contributions lower taxable income now; withdrawals are taxed later."
          example="For example, 6 for 6%."
        />
        {offersRoth ? (
          <PercentSliderField
            control={control}
            name="rothPctOfSalary"
            label="Roth % of salary"
            min={0}
            max={50}
            step={0.5}
            tip="After-tax contributions; qualified withdrawals are tax-free."
          />
        ) : null}
        <MoneyField control={control} name="traditionalBalance" label="Traditional balance today" />
        {offersRoth ? <MoneyField control={control} name="rothBalance" label="Roth balance today" /> : null}
        <ReturnSlider control={control} name="annualReturn" label="Annual return" />
      </FieldGroup>
      <OptionalMatch control={control} />
      <MoreOptions control={control} names={['inflation', 'priorYearFicaWages']}>
        <InflationField control={control} />
        <OptionalFicaWages control={control} />
      </MoreOptions>
    </>
  );
}

export function Contribution401kCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => contribution401kDefaults(), []);
  const calc = useCalculator({
    schema: Contribution401kInputSchema,
    run: contribution401k,
    defaults,
    heavy: false,
    prefill: prefillContribution401k,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame title="401(k) contributions" calc={calc} fields={<Contribution401kInputs control={control} />}>
      {(r) => <Contribution401kResults r={r} />}
    </CalculatorFrame>
  );
}

function Contribution401kResults({ r }: { r: Contribution401kResult }) {
  const y = r.yearOne;
  const t = r.totals;
  const limitRules = r.unverified.filter((u) => u.features.includes('workplaceLimits'));
  return (
    <>
      <ResultHeading>This year ({y.year})</ResultHeading>
      <Figures label="This year">
        <Figure
          label="Traditional contributions as elected"
          value={money(y.requestedTraditional)}
          basis={BASIS.nominal}
        />
        <Figure label="Roth contributions as elected" value={money(y.requestedRoth)} basis={BASIS.nominal} />
        <Figure
          label="Employer match before limits"
          value={money(y.matchBeforeLimits.total)}
          basis="Nominal dollars, match plus any non-elective contribution"
        />
        {y.capped ? (
          <>
            <Figure label="Traditional after limits" value={money(y.capped.traditional)} basis={BASIS.nominal} />
            <Figure label="Roth after limits" value={money(y.capped.roth)} basis={BASIS.nominal} />
            <Figure label="Employer match after limits" value={money(y.capped.employerMatch)} basis={BASIS.nominal} />
          </>
        ) : null}
      </Figures>
      {y.capped === null ? (
        <NotAvailable missing={limitRules.length > 0 ? limitRules : r.unverified} what="The after-limit amounts need" />
      ) : null}
      {y.limitWarnings.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {y.limitWarnings.map((w) => (
            <li key={w.message}>{w.message}</li>
          ))}
        </ul>
      ) : null}
      <ResultHeading>Through retirement</ResultHeading>
      <Figures label="Through retirement">
        <Figure label="Balance at retirement" value={money(t.balanceAtRetirement)} basis={BASIS.nominal} />
        <Figure
          label="Balance at retirement in today’s dollars"
          value={money(t.balanceAtRetirementReal)}
          basis={BASIS.todays}
        />
        <Figure label="Your contributions" value={money(t.employeeContributions)} basis={BASIS.nominal} />
        <Figure label="Employer contributions" value={money(t.employerContributions)} basis={BASIS.nominal} />
        <Figure label="Growth after fees" value={money(t.growth)} basis={BASIS.nominal} />
      </Figures>
      <SeriesChart
        caption="Plan balance at each year end by age (nominal and today’s dollars)"
        xLabel="Age"
        data={r.rows.map((row) => ({
          x: row.age,
          total: row.totalBalance,
          real: row.totalBalanceReal,
          salary: row.salary,
          trad: row.employeeTraditional,
          roth: row.employeeRoth,
          match: row.employerMatch,
          flat: row.employerFlat,
        }))}
        series={[
          { key: 'total', label: 'Balance (nominal)', color: 'var(--chart-1)', style: 'solid' },
          { key: 'real', label: 'Balance (today’s dollars)', color: 'var(--chart-3)', style: 'dashed' },
        ]}
        extraColumns={[
          { key: 'salary', label: 'Salary' },
          { key: 'trad', label: 'Traditional' },
          { key: 'roth', label: 'Roth' },
          { key: 'match', label: 'Employer match' },
          { key: 'flat', label: 'Non-elective' },
        ]}
        tableLabel="401(k) contributions data table"
      />
    </>
  );
}

// ---- Employer match -------------------------------------------------------------------------------

export function MatchOptimizerCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => matchOptimizerDefaults(), []);
  const calc = useCalculator({
    schema: MatchOptimizerInputSchema,
    run: matchOptimizer,
    defaults,
    heavy: false,
    prefill: prefillMatchOptimizer,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame
      title="Employer match"
      calc={calc}
      fields={
        <>
          <FieldGroup legend="Pay and deferral">
            <MoneyField
              control={control}
              name="eligiblePay"
              label="Eligible pay"
              tip="The pay the plan matches on this year (often base salary, sometimes including bonus)."
            />
            <PercentSliderField
              control={control}
              name="currentDeferralRate"
              label="Current deferral"
              min={0}
              max={30}
              step={0.5}
              tip="Your contribution as a share of eligible pay."
              example="For example, 3 for 3%."
            />
          </FieldGroup>
          <MatchFields control={control} />
          <MoreOptions control={control} names={['scanStep', 'scanTo']}>
            <PercentField
              control={control}
              name="scanStep"
              label="Scan step"
              example="Rates checked in steps of this size."
            />
            <PercentField control={control} name="scanTo" label="Scan up to" />
          </MoreOptions>
        </>
      }
    >
      {(r) => <MatchResults r={r} />}
    </CalculatorFrame>
  );
}

function MatchResults({ r }: { r: MatchOptimizerResult }) {
  return (
    <>
      <Figures>
        <Figure
          label="Deferral that captures the full match"
          value={pct(r.pctToCaptureFullMatch)}
          basis="Share of eligible pay"
        />
        <Figure
          label="Deferral dollars for the full match"
          value={money(r.dollarsToCaptureFullMatch)}
          basis={BASIS.nominal}
        />
        <Figure label="Full match per year" value={money(r.maxPossibleMatch)} basis={BASIS.nominal} />
        <Figure label="Match at the current rate" value={money(r.current.readout.match)} basis={BASIS.nominal} />
        <Figure
          label="Match left unclaimed per year"
          value={money(r.unclaimedAtCurrentRate)}
          basis={BASIS.nominal}
          tone={r.unclaimedAtCurrentRate > 0 ? 'attention' : undefined}
        />
        <Figure
          label="Additional deferral for the full match"
          value={money(r.additionalDeferralNeeded)}
          basis="Nominal dollars per year"
        />
      </Figures>
      <p className="text-sm text-muted-foreground">
        In the scan, the lowest rate whose match equals the full match is{' '}
        {r.lowestScannedFullCaptureRate === null ? 'not within the scanned range' : pct(r.lowestScannedFullCaptureRate)}
        .
      </p>
      <SeriesChart
        caption="Employer contribution by deferral rate (nominal dollars per year)"
        xLabel="Deferral rate"
        formatX={(x) => pct(x / 1000)}
        data={r.scan.map((row) => ({
          // Thousandths of pay on the axis (whole numbers), shown as percents.
          x: Math.round(row.deferralRate * 1000),
          match: row.match,
          total: row.total,
          deferral: row.deferral,
        }))}
        series={[
          { key: 'match', label: 'Match', color: 'var(--chart-1)', style: 'solid' },
          { key: 'total', label: 'Match plus non-elective', color: 'var(--chart-2)', style: 'dashed' },
        ]}
        extraColumns={[{ key: 'deferral', label: 'Your deferral' }]}
        tableLabel="match scan data table"
      />
    </>
  );
}

// ---- Roth vs traditional --------------------------------------------------------------------------

export function RothVsTraditionalCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => rothVsTraditionalDefaults(), []);
  const calc = useCalculator({
    schema: RothVsTraditionalInputSchema,
    run: rothVsTraditional,
    defaults,
    heavy: false,
    prefill: prefillRothVsTraditional,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame
      title="Roth vs traditional"
      calc={calc}
      fields={
        <>
          <FieldGroup legend="Ages">
            <IntegerField control={control} name="age" label="Current age" />
            <IntegerField control={control} name="retirementAge" label="Retirement age" />
            <IntegerField control={control} name="planningAge" label="Planning age" />
          </FieldGroup>
          <FieldGroup legend="Pay and deferral">
            <MoneyField control={control} name="salary" label="Base salary" />
            <PercentField control={control} name="salaryGrowth" label="Yearly raise" example="For example, 3 for 3%." />
            <PercentSliderField
              control={control}
              name="deferralPct"
              label="Deferral % of salary"
              min={0}
              max={50}
              step={0.5}
              tip="The same share of salary in both cases: traditional (pre-tax) in one, Roth (after tax) in the other."
            />
          </FieldGroup>
          <FieldGroup legend="Spending, returns and taxes">
            <MoneyField
              control={control}
              name="currentSpending"
              label="Yearly spending while working"
              tip="Paid from take-home pay, in today’s dollars."
            />
            <MoneyField
              control={control}
              name="retirementSpending"
              label="Yearly retirement spending"
              tip="A net (after-tax) need in today’s dollars."
            />
            <ReturnSlider control={control} name="returnBeforeRetirement" label="Return before retirement" />
            <ReturnSlider control={control} name="returnInRetirement" label="Return in retirement" />
            <InflationField control={control} />
            <PercentField
              control={control}
              name="stateTaxRate"
              label="State income tax rate"
              tip="A flat effective rate, the only state tax in the model."
            />
          </FieldGroup>
        </>
      }
    >
      {(r) => <RothResults r={r} />}
    </CalculatorFrame>
  );
}

function sideCells(s: RothVsTraditionalSide) {
  return {
    ending: money(s.endingBalance),
    endingReal: money(s.endingBalanceReal),
    deferred: money(s.endingTaxDeferred),
    afterTax: s.afterTaxEndingBalanceReal === null ? 'Not available yet' : money(s.afterTaxEndingBalanceReal),
    rate: s.marginalRate === null ? 'Not available yet' : pct(s.marginalRate),
    lasts: s.depletionYear === null ? 'Lasts through the planning age' : `Runs out in ${s.depletionYear}`,
  };
}

function RothResults({ r }: { r: RothVsTraditionalResult }) {
  const t = sideCells(r.traditional);
  const ro = sideCells(r.roth);
  const rows: { label: string; key: keyof typeof t }[] = [
    { label: 'Ending balance (nominal)', key: 'ending' },
    { label: 'Ending balance (today’s dollars)', key: 'endingReal' },
    { label: 'Of which tax-deferred (nominal)', key: 'deferred' },
    { label: 'After-tax ending balance (today’s dollars)', key: 'afterTax' },
    { label: 'Final-year marginal rate used', key: 'rate' },
    { label: 'Savings', key: 'lasts' },
  ];
  const taxRules = r.unverified.filter((u) => u.features.some((f) => (TAX_FEATURES as readonly string[]).includes(f)));
  return (
    <>
      <Figures>
        <Figure
          label="Roth minus traditional, after tax"
          value={r.afterTaxDifferenceReal === null ? 'Not available yet' : money(r.afterTaxDifferenceReal)}
          basis={BASIS.todays}
        />
        <Figure
          label="Roth minus traditional, before tax"
          value={money(r.beforeTaxDifferenceReal)}
          basis={BASIS.todays}
        />
        <Figure label="Traditional lasts through the planning age" value={yesNo(r.traditional.success)} />
        <Figure label="Roth lasts through the planning age" value={yesNo(r.roth.success)} />
      </Figures>
      {r.afterTaxDifferenceReal === null ? (
        <>
          <NotAvailable missing={taxRules.length > 0 ? taxRules : r.unverified} what="The after-tax comparison needs" />
          <p className="text-sm text-muted-foreground">
            While tax rules are unverified, no tax is computed, so in this model the two cases have the same balances
            before taxes.
          </p>
        </>
      ) : null}
      <Table label="Roth and traditional side by side">
        <TableHeader>
          <TableRow>
            <TableHead>At the planning age</TableHead>
            <TableHead className="text-right">Traditional</TableHead>
            <TableHead className="text-right">Roth</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="whitespace-normal">{row.label}</TableCell>
              <TableCell className="whitespace-normal text-right">{t[row.key]}</TableCell>
              <TableCell className="whitespace-normal text-right">{ro[row.key]}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
