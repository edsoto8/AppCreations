/**
 * Retirement-readiness calculators on the one-person plan household: retirement age, savings gap,
 * Coast FIRE and Barista FIRE. Each runs a search (an age scan or a bisection), so it is computed
 * deferred after the inputs settle.
 */
import { useMemo } from 'react';
import {
  BaristaFireInputSchema,
  CoastFireInputSchema,
  RetirementAgeInputSchema,
  SavingsGapInputSchema,
  baristaFire,
  coastFire,
  retirementAge,
  savingsGap,
  type BaristaFireResult,
  type CoastFireResult,
  type PlanOutcome,
  type RetirementAgeResult,
  type SavingsGapResult,
} from '@rn/engine';
import { IntegerField, MoneyField } from '@/components/form/fields';
import { baristaFireDefaults, coastFireDefaults, retirementAgeDefaults, savingsGapDefaults } from '../defaults';
import { FieldGroup, PlanFieldGroups } from '../fields';
import { BASIS, money, yesNo } from '../labels';
import { CalculatorFrame, Figure, Figures, ResultHeading } from '../parts';
import { prefillBaristaFire, prefillCoastFire, prefillRetirementAge, prefillSavingsGap } from '../prefill';
import { SeriesChart } from '../SeriesChart';
import { looseControl, useCalculator, type CalculatorProps } from '../useCalculator';

/** "Lasts through the planning age" or "Runs out at 84 (2066)". */
function longevityText(o: PlanOutcome): string {
  if (o.depletionYear === null) return o.success ? 'Lasts through the planning age' : 'Does not meet the minimum';
  return `Runs out at ${o.depletionAge ?? '—'} (${o.depletionYear})`;
}

function OutcomeFigures({ title, outcome }: { title: string; outcome: PlanOutcome }) {
  return (
    <>
      <Figure
        label={`${title}: savings`}
        value={longevityText(outcome)}
        tone={outcome.success ? undefined : 'attention'}
      />
      <Figure label={`${title}: ending balance`} value={money(outcome.endingBalanceReal)} basis={BASIS.todays} />
    </>
  );
}

// ---- Retirement age -------------------------------------------------------------------------------

export function RetirementAgeCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => retirementAgeDefaults(), []);
  const calc = useCalculator({
    schema: RetirementAgeInputSchema,
    run: retirementAge,
    defaults,
    heavy: true,
    prefill: prefillRetirementAge,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame
      title="Retirement age"
      calc={calc}
      fields={
        <PlanFieldGroups
          control={control}
          showRetirementAge={false}
          afterAges={
            <div className="grid grid-cols-2 gap-3">
              <IntegerField control={control} name="fromAge" label="Earliest age to check" />
              <IntegerField control={control} name="toAge" label="Latest age to check" />
            </div>
          }
        />
      }
    >
      {(r) => <RetirementAgeResults r={r} />}
    </CalculatorFrame>
  );
}

function RetirementAgeResults({ r }: { r: RetirementAgeResult }) {
  const earliest = r.evaluated.find((e) => e.age === r.earliestAge);
  return (
    <>
      <Figures>
        <Figure
          label="Earliest retirement age that lasts"
          value={r.earliestAge === null ? 'None in this range' : String(r.earliestAge)}
          basis="Age (no shortfall through the planning age)"
          tone={r.earliestAge === null ? 'attention' : undefined}
        />
        <OutcomeFigures title={`Retiring at ${r.shown.retirementAge}`} outcome={r.shown.outcome} />
      </Figures>
      <SeriesChart
        caption="Ending balance at the planning age by retirement age (today’s dollars)"
        xLabel="Retirement age"
        data={r.evaluated.map((e) => ({ x: e.age, ending: e.endingBalanceReal, lasts: e.success ? 1 : 0 }))}
        series={[{ key: 'ending', label: 'Ending balance (today’s dollars)', color: 'var(--chart-1)', style: 'solid' }]}
        extraColumns={[{ key: 'lasts', label: 'Lasts', format: (v) => yesNo(v === 1) }]}
        marker={earliest ? { x: earliest.age, label: `${earliest.age}, the earliest age that lasts` } : null}
        tableLabel="retirement age data table"
      />
    </>
  );
}

// ---- Savings gap ----------------------------------------------------------------------------------

export function SavingsGapCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => savingsGapDefaults(), []);
  const calc = useCalculator({
    schema: SavingsGapInputSchema,
    run: savingsGap,
    defaults,
    heavy: true,
    prefill: prefillSavingsGap,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame title="Savings gap" calc={calc} fields={<PlanFieldGroups control={control} />}>
      {(r) => <SavingsGapResults r={r} />}
    </CalculatorFrame>
  );
}

function SavingsGapResults({ r }: { r: SavingsGapResult }) {
  const extra =
    r.search === 'atBound'
      ? 'None: the plan as entered lasts'
      : r.extraAnnualContribution === null
        ? 'More than the search bound'
        : money(r.extraAnnualContribution);
  return (
    <>
      <Figures>
        <Figure
          label="Extra yearly contribution"
          value={extra}
          basis="Today’s dollars, rising with inflation until retirement"
          tone={r.search === 'found' ? 'attention' : undefined}
        />
        <Figure
          label="Total yearly contribution"
          value={r.totalAnnualContribution === null ? '—' : money(r.totalAnnualContribution)}
          basis={BASIS.todays}
        />
      </Figures>
      <ResultHeading>Outcomes</ResultHeading>
      <Figures label="Outcomes">
        <OutcomeFigures title="As entered" outcome={r.current} />
        <OutcomeFigures title="With the extra contribution" outcome={r.withExtra} />
      </Figures>
    </>
  );
}

// ---- Coast FIRE -----------------------------------------------------------------------------------

export function CoastFireCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => coastFireDefaults(), []);
  const calc = useCalculator({
    schema: CoastFireInputSchema,
    run: coastFire,
    defaults,
    heavy: true,
    prefill: prefillCoastFire,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame title="Coast FIRE" calc={calc} fields={<PlanFieldGroups control={control} />}>
      {(r) => <CoastResults r={r} />}
    </CalculatorFrame>
  );
}

function CoastResults({ r }: { r: CoastFireResult }) {
  const coastNumber =
    r.search === 'atBound'
      ? '$0: other income covers the spending'
      : r.coastNumber === null
        ? 'More than the search bound'
        : money(r.coastNumber);
  return (
    <>
      <Figures>
        <Figure
          label="Coasts with no further contributions"
          value={yesNo(r.coasts)}
          tone={r.coasts ? undefined : 'attention'}
        />
        <Figure label="Coast number (balance today)" value={coastNumber} basis={BASIS.todays} />
        <Figure
          label="Gap to the coast number"
          value={r.gap === null ? '—' : money(r.gap)}
          basis="Today’s dollars (0 when already coasting)"
        />
      </Figures>
      <ResultHeading>Outcomes</ResultHeading>
      <Figures label="Outcomes">
        <OutcomeFigures title="Coasting from today" outcome={r.coasting} />
        <OutcomeFigures title="With the entered contributions" outcome={r.withContributions} />
      </Figures>
    </>
  );
}

// ---- Barista FIRE ---------------------------------------------------------------------------------

export function BaristaFireCalculator(props: CalculatorProps) {
  const defaults = useMemo(() => baristaFireDefaults(), []);
  const calc = useCalculator({
    schema: BaristaFireInputSchema,
    run: baristaFire,
    defaults,
    heavy: true,
    prefill: prefillBaristaFire,
    props,
  });
  const control = looseControl(calc.form.control);
  return (
    <CalculatorFrame
      title="Barista FIRE"
      calc={calc}
      fields={
        <PlanFieldGroups
          control={control}
          extraGroup={
            <FieldGroup legend="Part-time work">
              <div className="grid grid-cols-2 gap-3">
                <IntegerField control={control} name="partTime.startAge" label="From age" />
                <IntegerField
                  control={control}
                  name="partTime.endAge"
                  label="Until age"
                  tip="Part-time pay stops at the start of the year this age is reached."
                />
              </div>
              <MoneyField
                control={control}
                name="partTime.annualIncome"
                label="Part-time pay per year"
                tip="In today’s dollars, rising with inflation. In retirement it covers spending before any withdrawal."
              />
            </FieldGroup>
          }
        />
      }
    >
      {(r) => <BaristaResults r={r} />}
    </CalculatorFrame>
  );
}

function BaristaResults({ r }: { r: BaristaFireResult }) {
  const minimum =
    r.search === 'atBound'
      ? '$0: no part-time income is needed'
      : r.minimumPartTimeIncome === null
        ? 'More than the search bound'
        : money(r.minimumPartTimeIncome);
  return (
    <>
      <Figures>
        <Figure
          label="Lasts with the entered part-time pay"
          value={yesNo(r.success)}
          tone={r.success ? undefined : 'attention'}
        />
        <Figure label="Minimum part-time pay per year" value={minimum} basis={BASIS.todays} />
        <Figure
          label="Part-time pay over the phase"
          value={money(r.totalPartTimeIncome)}
          basis="Nominal dollars, gross, at the entered pay"
        />
      </Figures>
      <ResultHeading>Outcomes</ResultHeading>
      <Figures label="Outcomes">
        <OutcomeFigures title="At the entered pay" outcome={r.outcome} />
        <OutcomeFigures title="At the minimum pay" outcome={r.atMinimum} />
      </Figures>
    </>
  );
}
