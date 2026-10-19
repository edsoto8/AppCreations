/** In-retirement calculators: withdrawal (fixed rate or sustainable rate), FI number, spending planner. */
import { useMemo } from 'react';
import { useController, useFieldArray, useWatch, type Control, type FieldValues } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import type { z } from 'zod';
import {
  FiNumberInputSchema,
  SpendingPlannerInputSchema,
  WithdrawalInputSchema,
  fiNumber,
  spendingPlanner,
  withdrawal,
  type DrawdownRun,
  type EngineContext,
  type FiNumberResult,
  type SpendingPlannerResult,
  type WithdrawalInput,
  type WithdrawalResult,
} from '@rn/engine';
import {
  IntegerField,
  MoneyField,
  PercentField,
  PercentSliderField,
  SelectField,
  TextField,
} from '@/components/form/fields';
import { Button } from '@/components/ui/button';
import { fiNumberDefaults, spendingPlannerDefaults, withdrawalDefaults, type WithdrawalFormValues } from '../defaults';
import {
  ArrayError,
  DrawdownFieldGroups,
  ExpenseRatioField,
  FieldGroup,
  InflationField,
  MoreOptions,
  ReturnSlider,
  SocialSecurityAtClaimFields,
  TaxTreatmentFields,
  TimingField,
  ToggleRow,
} from '../fields';
import { BASIS, money, pct, yesNo } from '../labels';
import { CalculatorFrame, Figure, Figures, ResultHeading } from '../parts';
import { prefillFiNumber, prefillSpendingPlanner, prefillWithdrawal } from '../prefill';
import { SeriesChart } from '../SeriesChart';
import { looseControl, useCalculator, type CalculatorProps } from '../useCalculator';

function longevityOf(run: DrawdownRun): string {
  const l = run.longevity;
  if (l.lastsThroughHorizon) return 'Lasts through the plan';
  return `Runs out at ${l.depletionAge ?? '—'} (${l.depletionYear ?? '—'})`;
}

function DrawdownChart({ run, label }: { run: DrawdownRun; label: string }) {
  const depletion = run.longevity.depletionAge;
  return (
    <SeriesChart
      caption={`Year-end savings by age, ${label} (nominal and today’s dollars)`}
      xLabel="Age"
      data={run.rows.map((row) => ({
        x: row.age,
        end: row.endBalance,
        real: row.endBalanceReal,
        need: row.spendingNeed,
        withdrawals: row.withdrawals,
        shortfall: row.shortfall,
      }))}
      series={[
        { key: 'end', label: 'Savings (nominal)', color: 'var(--chart-1)', style: 'solid' },
        { key: 'real', label: 'Savings (today’s dollars)', color: 'var(--chart-3)', style: 'dashed' },
      ]}
      extraColumns={[
        { key: 'need', label: 'Spending need' },
        { key: 'withdrawals', label: 'Withdrawals' },
        { key: 'shortfall', label: 'Shortfall' },
      ]}
      marker={depletion === null ? null : { x: depletion, label: `age ${depletion}, savings run out` }}
      tableLabel="withdrawal data table"
    />
  );
}

// ---- Withdrawal -----------------------------------------------------------------------------------

const MODES = [
  { value: 'fixedPercentage', label: 'How long a fixed rate lasts' },
  { value: 'sustainableRate', label: 'The highest rate that lasts' },
] as const;

/** The form holds both modes' fields; the engine's discriminated schema validates the chosen one. */
const withdrawalSchema = WithdrawalInputSchema as unknown as z.ZodType<unknown, WithdrawalFormValues>;
const runWithdrawal = (x: WithdrawalFormValues, ctx: EngineContext) => withdrawal(x as WithdrawalInput, ctx);

export function WithdrawalCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => withdrawalDefaults(), []);
  const calc = useCalculator({
    schema: withdrawalSchema,
    run: runWithdrawal,
    defaults,
    heavy: true,
    prefill: prefillWithdrawal,
    props,
  });
  const control = looseControl(calc.form.control);
  const mode = useWatch({ control, name: 'mode' }) as WithdrawalFormValues['mode'];
  return (
    <CalculatorFrame
      title="Withdrawal"
      calc={calc}
      fields={
        <>
          <SelectField control={control} name="mode" label="Calculate" options={MODES} />
          <DrawdownFieldGroups
            control={control}
            rateField={
              mode === 'fixedPercentage' ? (
                <PercentSliderField
                  control={control}
                  name="withdrawalRate"
                  label="Withdrawal rate"
                  min={0}
                  max={15}
                  step={0.1}
                  tip="The first year’s spending as a share of the starting savings; later years rise with inflation."
                  example="For example, 4 for 4%."
                />
              ) : (
                <PercentField
                  control={control}
                  name="maxRate"
                  label="Search rates up to"
                  example="The highest starting rate checked; 100 checks every rate."
                />
              )
            }
          />
        </>
      }
    >
      {(r) => <WithdrawalResults r={r} />}
    </CalculatorFrame>
  );
}

function WithdrawalResults({ r }: { r: WithdrawalResult }) {
  if (r.mode === 'fixedPercentage') {
    return (
      <>
        <Figures>
          <Figure
            label="First-year spending"
            value={money(r.annualSpending)}
            basis="Today’s dollars, rising with inflation"
          />
          <Figure label="Savings" value={longevityOf(r)} tone={r.success ? undefined : 'attention'} />
          <Figure label="Years fully funded" value={String(r.longevity.yearsFullyFunded)} basis="Years" />
          <Figure label="Ending balance" value={money(r.endingBalance)} basis={BASIS.nominal} />
          <Figure label="Ending balance in today’s dollars" value={money(r.endingBalanceReal)} basis={BASIS.todays} />
        </Figures>
        <DrawdownChart run={r} label={`at ${pct(r.withdrawalRate)}`} />
      </>
    );
  }
  const rate =
    r.sustainableRate === null
      ? 'No rate meets the goal'
      : r.search === 'atBound'
        ? `${pct(r.sustainableRate)} or more`
        : pct(r.sustainableRate);
  return (
    <>
      <Figures>
        <Figure
          label="Sustainable starting rate"
          value={rate}
          basis="Share of the starting savings"
          tone={r.sustainableRate === null ? 'attention' : undefined}
        />
        {r.plan ? (
          <>
            <Figure
              label="First-year spending at that rate"
              value={money(r.plan.annualSpending)}
              basis="Today’s dollars, rising with inflation"
            />
            <Figure label="Savings" value={longevityOf(r.plan)} />
            <Figure
              label="Ending balance in today’s dollars"
              value={money(r.plan.endingBalanceReal)}
              basis={BASIS.todays}
            />
          </>
        ) : null}
      </Figures>
      {r.plan ? <DrawdownChart run={r.plan} label="at the sustainable rate" /> : null}
    </>
  );
}

// ---- FI number ------------------------------------------------------------------------------------

function OptionalRuleOfThumb({ control }: { control: Control<FieldValues> }) {
  const { field } = useController({ control, name: 'withdrawalRate' });
  const on = field.value !== null && field.value !== undefined;
  return (
    <div className="flex flex-col gap-3">
      <ToggleRow
        label="Also show the rule-of-thumb figure"
        checked={on}
        onChange={(next) => field.onChange(next ? 0.04 : null)}
        hint="The balance whose fixed-percentage withdrawal equals the spending."
      />
      {on ? (
        <PercentSliderField
          control={control}
          name="withdrawalRate"
          label="Rule-of-thumb withdrawal rate"
          min={1}
          max={10}
          step={0.1}
          example="For example, 4 for 4%."
        />
      ) : null}
    </div>
  );
}

export function FiNumberCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => fiNumberDefaults(), []);
  const calc = useCalculator({
    schema: FiNumberInputSchema,
    run: fiNumber,
    defaults,
    heavy: true,
    prefill: prefillFiNumber,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame
      title="FI number"
      calc={calc}
      fields={
        <>
          <MoneyField
            control={control}
            name="annualSpending"
            label="Yearly spending"
            tip="A net (after-tax) need in today’s dollars, rising with inflation."
          />
          <OptionalRuleOfThumb control={control} />
          <DrawdownFieldGroups control={control} showBalance={false} />
        </>
      }
    >
      {(r) => <FiResults r={r} />}
    </CalculatorFrame>
  );
}

function FiResults({ r }: { r: FiNumberResult }) {
  const s = r.sustainable;
  const fi =
    s.search === 'atBound'
      ? '$0: other income covers the spending'
      : s.fiNumber === null
        ? 'More than the search bound'
        : money(s.fiNumber);
  const rt = r.ruleOfThumb;
  return (
    <>
      <Figures>
        <Figure label="FI number" value={fi} basis="Savings today (today’s dollars) that last through the plan" />
        <Figure
          label="Starting withdrawal rate it supports"
          value={s.sustainableRateAtFiNumber === null ? '—' : pct(s.sustainableRateAtFiNumber)}
          basis="Share of the FI number"
        />
      </Figures>
      {rt ? (
        <>
          <ResultHeading>Rule of thumb at {pct(rt.withdrawalRate)}</ResultHeading>
          <Figures label="Rule of thumb">
            <Figure
              label="Rule-of-thumb balance"
              value={rt.fiNumber === null ? 'More than the search bound' : money(rt.fiNumber)}
              basis={BASIS.todays}
            />
            <Figure
              label="Lasts under the return assumption"
              value={rt.plan ? yesNo(rt.plan.success) : '—'}
              tone={rt.plan && !rt.plan.success ? 'attention' : undefined}
            />
            {rt.plan && !rt.plan.success ? <Figure label="Savings" value={longevityOf(rt.plan)} /> : null}
          </Figures>
        </>
      ) : null}
      {s.plan ? <DrawdownChart run={s.plan} label="starting at the FI number" /> : null}
    </>
  );
}

// ---- Spending planner -----------------------------------------------------------------------------

function PersonFields({ control, index }: { control: Control<FieldValues>; index: number }) {
  const name = useWatch({ control, name: `people.${index}.name` }) as string | undefined;
  const who = name?.trim() || (index === 0 ? 'Person 1' : 'Partner');
  return (
    <FieldGroup legend={index === 0 ? 'First person' : 'Partner'}>
      <TextField control={control} name={`people.${index}.name`} label="Name" />
      <div className="grid grid-cols-2 gap-3">
        <IntegerField control={control} name={`people.${index}.age`} label="Age this year" />
        <IntegerField control={control} name={`people.${index}.planningAge`} label="Planning age" />
      </div>
      <SocialSecurityAtClaimFields
        control={control}
        name={`people.${index}.socialSecurity`}
        who={`Social Security for ${who}`}
      />
    </FieldGroup>
  );
}

function PartnerToggle({ control }: { control: Control<FieldValues> }) {
  const people = useFieldArray({ control, name: 'people' });
  return (
    <>
      <PersonFields control={control} index={0} />
      <ToggleRow
        label="Include a partner"
        checked={people.fields.length > 1}
        onChange={(on) =>
          on ? people.append({ name: 'Partner', age: 63, planningAge: 95, socialSecurity: null }) : people.remove(1)
        }
        hint="Two people file jointly; spending falls by the survivor reduction after the first death."
      />
      {people.fields.length > 1 ? <PersonFields control={control} index={1} /> : null}
    </>
  );
}

function StepsFields({ control }: { control: Control<FieldValues> }) {
  const steps = useFieldArray({ control, name: 'steps' });
  return (
    <FieldGroup legend="Spending steps">
      <p className="text-xs text-muted-foreground">
        From an age of the first person, yearly spending changes to a new amount (today’s dollars).
      </p>
      {steps.fields.map((step, i) => (
        <div key={step.id} className="grid grid-cols-[1fr_1.4fr_auto] items-end gap-2">
          <IntegerField control={control} name={`steps.${i}.fromAge`} label={`Step ${i + 1}: from age`} />
          <MoneyField control={control} name={`steps.${i}.annualSpending`} label="Spending per year" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => steps.remove(i)}
            aria-label={`Remove step ${i + 1}`}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <ArrayError control={control} name="steps" />
      {steps.fields.length < 10 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => steps.append({ fromAge: 75, annualSpending: 5_000_000 })}
        >
          <Plus aria-hidden="true" />
          Add a spending step
        </Button>
      ) : null}
    </FieldGroup>
  );
}

export function SpendingPlannerCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => spendingPlannerDefaults(), []);
  const calc = useCalculator({
    schema: SpendingPlannerInputSchema,
    run: spendingPlanner,
    defaults,
    heavy: false,
    prefill: prefillSpendingPlanner,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame
      title="Spending planner"
      calc={calc}
      fields={
        <>
          <PartnerToggle control={control} />
          <FieldGroup legend="Savings and spending">
            <MoneyField control={control} name="startingBalance" label="Savings today" />
            <ReturnSlider control={control} name="annualReturn" label="Annual return" />
            <InflationField control={control} />
            <MoneyField
              control={control}
              name="retirementSpending"
              label="Yearly spending"
              tip="A net (after-tax) need in today’s dollars, rising with inflation."
            />
          </FieldGroup>
          <StepsFields control={control} />
          <MoreOptions
            control={control}
            names={[
              'realGlide',
              'healthcareBeforeMedicare',
              'survivorSpendingReduction',
              'taxTreatment',
              'costBasis',
              'expenseRatio',
              'withdrawalTiming',
            ]}
          >
            <PercentField
              control={control}
              name="realGlide"
              label="Yearly real change in spending"
              example="For example, −1 for 1% less each year after inflation."
            />
            <MoneyField
              control={control}
              name="healthcareBeforeMedicare"
              label="Healthcare before Medicare"
              tip="Per year, in today’s dollars, while a retired person is under 65. The only pre-Medicare healthcare cost in the plan."
            />
            <PercentField
              control={control}
              name="survivorSpendingReduction"
              label="Survivor spending reduction"
              tip="For couples: spending falls by this share from the first death year (a labeled assumption)."
            />
            <TaxTreatmentFields control={control} />
            <ExpenseRatioField control={control} />
            <TimingField control={control} />
          </MoreOptions>
        </>
      }
    >
      {(r) => <SpendingResults r={r} />}
    </CalculatorFrame>
  );
}

function SpendingResults({ r }: { r: SpendingPlannerResult }) {
  const l = r.longevity;
  const lastRow = r.rows[r.rows.length - 1];
  return (
    <>
      <Figures>
        <Figure
          label="Savings"
          value={l.lastsThroughPlanningAge ? 'Last through the planning age' : `Run out in ${l.depletionYear ?? '—'}`}
          basis={l.depletionAge === null ? undefined : `First person’s age then: ${l.depletionAge}`}
          tone={l.lastsThroughPlanningAge ? undefined : 'attention'}
        />
        <Figure label="Total spending need" value={money(r.totalSpendingNeed)} basis={BASIS.nominal} />
        <Figure
          label="Total spending need in today’s dollars"
          value={money(r.totalSpendingNeedReal)}
          basis={BASIS.todays}
        />
        {r.firstDeathYear !== null ? (
          <Figure label="First death year (planning age)" value={String(r.firstDeathYear)} />
        ) : null}
        {lastRow ? (
          <Figure
            label="Ending balance in today’s dollars"
            value={money(lastRow.endBalanceReal)}
            basis={BASIS.todays}
          />
        ) : null}
      </Figures>
      <SeriesChart
        caption="Year-end savings and spending need by year (nominal and today’s dollars)"
        xLabel="Year"
        data={r.rows.map((row) => ({
          x: row.year,
          end: row.endBalance,
          real: row.endBalanceReal,
          need: row.spendingNeed,
          ss: row.socialSecurity,
          withdrawals: row.withdrawals,
          shortfall: row.shortfall,
        }))}
        series={[
          { key: 'end', label: 'Savings (nominal)', color: 'var(--chart-1)', style: 'solid' },
          { key: 'real', label: 'Savings (today’s dollars)', color: 'var(--chart-3)', style: 'dashed' },
          { key: 'need', label: 'Spending need (nominal)', color: 'var(--chart-2)', style: 'dotted' },
        ]}
        extraColumns={[
          { key: 'ss', label: 'Social Security' },
          { key: 'withdrawals', label: 'Withdrawals' },
          { key: 'shortfall', label: 'Shortfall' },
        ]}
        marker={l.depletionYear === null ? null : { x: l.depletionYear, label: `${l.depletionYear}, savings run out` }}
        tableLabel="spending plan data table"
      />
    </>
  );
}
